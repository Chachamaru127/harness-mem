import { fileURLToPath } from "node:url";
import type { ReferenceProcessReservations } from "./reference-process-ledger";

export type ProjectPathResolution = {
  input: string;
  canonical: string;
  kind: "confirmed" | "unresolved";
  reason?: "unreadable" | "invalid_path" | "invalid_git" | "depth_limit" | "timeout" | "protocol" | "exit" | "spawn";
};

export interface ProjectResolverProcess {
  pid?: number;
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
}

export interface ProjectPathResolverOptions {
  reservations?: ReferenceProcessReservations;
  onResult: (input: string, result: ProjectPathResolution) => void;
  maxChildren?: number;
  maxQueue?: number;
  timeoutMs?: number;
  cooldownMs?: number;
  scriptPath?: string;
  spawn?: (input: string, scriptPath: string) => ProjectResolverProcess;
}

interface Slot {
  reservation?: string;
  input: string;
  proc: ProjectResolverProcess;
  timer?: ReturnType<typeof setTimeout>;
  exited: boolean;
  exitCode?: number;
  readDone: boolean;
  settled: boolean;
  result?: ProjectPathResolution;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
}

const MAX_INPUT = 8192;
const MAX_REPLY_BYTES = 65536;
const CHILD_REASONS = new Set(["unreadable", "invalid_path", "invalid_git", "depth_limit"]);

/** Filesystem access belongs exclusively to the disposable worker. */
export class ProjectPathResolver {
  private readonly slots = new Set<Slot>();
  private readonly queue: string[] = [];
  private readonly scheduled = new Set<string>();
  private readonly maxChildren: number;
  private readonly maxQueue: number;
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;
  private readonly cooldowns = new Map<string, number>();
  private readonly scriptPath: string;
  private stopped = false;

  constructor(private readonly options: ProjectPathResolverOptions) {
    this.maxChildren = bounded(options.maxChildren, 2, 1, 16);
    this.maxQueue = bounded(options.maxQueue, 64, 0, 4096);
    this.timeoutMs = bounded(options.timeoutMs, 1000, 1, 60000);
    this.cooldownMs = bounded(options.cooldownMs, 30000, 1, 300000);
    this.scriptPath = options.scriptPath ?? fileURLToPath(new URL("../tools/project-path-resolver-worker.ts", import.meta.url));
  }

  schedule(input: string): boolean {
    if (this.stopped || typeof input !== "string" || !input.startsWith("/") || input.includes("\0") || input.length > MAX_INPUT || this.scheduled.has(input)) return false;
    const now = Date.now();
    for (const [key, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(key);
    if (this.cooldowns.has(input) || this.cooldowns.size >= 4096) return false;
    if (this.slots.size >= this.maxChildren && this.queue.length >= this.maxQueue) return false;
    this.scheduled.add(input);
    this.queue.push(input);
    this.drain();
    return this.scheduled.has(input);
  }

  stop(): void {
    this.stopped = true;
    for (const input of this.queue) this.scheduled.delete(input);
    this.queue.length = 0;
    this.cooldowns.clear();
    for (const slot of this.slots) {
      slot.settled = true;
      clearTimeout(slot.timer);
      void slot.reader?.cancel().catch(() => {});
      this.kill(slot);
      this.retire(slot);
    }
  }

  status(): { active: number; queued: number; stopping: number; stopped: boolean; reserved?: number; unconfirmed?: number } {
    return { ...(this.options.reservations?.status() ?? {}), active: this.slots.size, queued: this.queue.length, stopping: [...this.slots].filter((slot) => slot.settled && !slot.exited).length, stopped: this.stopped };
  }

  private drain(): void {
    while (!this.stopped && this.slots.size < this.maxChildren && this.queue.length > 0) {
      const reservation = this.options.reservations?.reserve(this.maxChildren);
      if (this.options.reservations && !reservation) {
        for (const input of this.queue.splice(0)) {
          this.scheduled.delete(input);
          this.cooldown(input);
          this.notify(input, { input, canonical: input, kind: "unresolved", reason: "spawn" });
        }
        return;
      }
      const input = this.queue.shift()!;
      let proc: ProjectResolverProcess;
      try {
        proc = this.options.spawn ? this.options.spawn(input, this.scriptPath) : Bun.spawn({
          cmd: [process.execPath, "run", this.scriptPath, ...(reservation ? [`--harness-mem-reference-token=${reservation}`, `--harness-mem-parent-pid=${process.pid}`] : [])],
          cwd: "/",
          stdin: new Blob([JSON.stringify({ input })]),
          stdout: "pipe",
          stderr: "ignore",
        });
      } catch {
        if (reservation) this.options.reservations?.release(reservation);
        this.scheduled.delete(input);
        this.cooldown(input);
        this.notify(input, { input, canonical: input, kind: "unresolved", reason: "spawn" });
        continue;
      }
      const slot: Slot = { reservation: reservation ?? undefined, input, proc, exited: false, readDone: false, settled: false };
      this.slots.add(slot);
      let attached = true;
      if (reservation) {
        try { this.options.reservations?.attach(reservation, proc.pid!); } catch { attached = false; }
      }
      slot.timer = setTimeout(() => this.fail(slot, "timeout"), this.timeoutMs);
      void this.read(slot);
      void proc.exited.then((code) => {
        slot.exited = true;
        if (slot.reservation) this.options.reservations?.release(slot.reservation);
        slot.exitCode = code;
        if (code !== 0) this.fail(slot, "exit");
        else this.finish(slot);
        this.retire(slot);
      }, () => {
        // A rejected exit observer is not confirmation that the process exited.
        this.fail(slot, "exit");
      });
      if (!attached) this.fail(slot, "spawn");
    }
  }

  private async read(slot: Slot): Promise<void> {
    const reader = slot.proc.stdout.getReader();
    slot.reader = reader;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let body = "";
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (slot.settled) break;
        if (done) {
          body += decoder.decode();
          const result = JSON.parse(body) as ProjectPathResolution;
          if (!result || result.input !== slot.input || typeof result.canonical !== "string" || !result.canonical.startsWith("/") || result.canonical.includes("\0") || result.canonical.length > MAX_INPUT || (result.kind !== "confirmed" && result.kind !== "unresolved") || (result.kind === "unresolved" && (!CHILD_REASONS.has(result.reason ?? "") || result.canonical !== slot.input)) || (result.kind === "confirmed" && result.reason !== undefined)) throw new Error("protocol");
          slot.result = { input: slot.input, canonical: result.canonical, kind: result.kind, ...(result.reason ? { reason: result.reason } : {}) };
          slot.readDone = true;
          this.finish(slot);
          break;
        }
        bytes += value.byteLength;
        if (bytes > MAX_REPLY_BYTES) throw new Error("protocol");
        body += decoder.decode(value, { stream: true });
      }
    } catch {
      this.fail(slot, "protocol");
    } finally {
      void reader.cancel().catch(() => {});
    }
  }

  private finish(slot: Slot): void {
    if (slot.settled || !slot.exited || slot.exitCode !== 0 || !slot.readDone || !slot.result) return;
    slot.settled = true;
    clearTimeout(slot.timer);
    if (slot.result.kind === "unresolved") this.cooldown(slot.input);
    if (!this.stopped) this.notify(slot.input, slot.result);
    this.retire(slot);
  }

  private fail(slot: Slot, reason: ProjectPathResolution["reason"]): void {
    if (!slot.settled) {
      slot.settled = true;
      clearTimeout(slot.timer);
      this.cooldown(slot.input);
      void slot.reader?.cancel().catch(() => {});
      if (!this.stopped) this.notify(slot.input, { input: slot.input, canonical: slot.input, kind: "unresolved", reason });
      this.kill(slot);
    }
    this.retire(slot);
  }

  private kill(slot: Slot): void {
    if (slot.exited) return;
    try { slot.proc.kill("SIGKILL"); } catch { /* Retain the slot until exit is observed. */ }
  }

  private retire(slot: Slot): void {
    if (!slot.exited || !slot.settled || !this.slots.delete(slot)) return;
    this.scheduled.delete(slot.input);
    queueMicrotask(() => this.drain());
  }

  private notify(input: string, result: ProjectPathResolution): void {
    try { this.options.onResult(input, result); } catch { /* Consumer failures do not release process ownership. */ }
  }

  private cooldown(input: string): void {
    if (this.cooldowns.size < 4096) this.cooldowns.set(input, Date.now() + this.cooldownMs);
  }
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(min, Math.min(max, Math.floor(value)));
}
