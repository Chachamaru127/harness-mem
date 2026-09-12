import { join } from "node:path";
import type { Config } from "./types";
import type { ReferenceProcessReservations } from "./reference-process-ledger";
import { stopOwnedSearchWorkerProcess } from "./search-worker-lifecycle";
import {
  encodeReaderPacket, SOURCE_READER_MAX_PACKET_BYTES, SOURCE_READER_MAX_PATH_BYTES,
  sourceReaderConfig, type SourceReaderOperation, type SourceReaderSource,
} from "./source-reader-protocol";

type ReaderProcess = ReturnType<typeof Bun.spawn>;
export interface SourceReaderOptions {
  ledger?: ReferenceProcessReservations;
  slots?: number;
  maxQueued?: number;
  ioTimeoutMs?: number;
  startupTimeoutMs?: number;
  quarantineMs?: number;
  scriptPath?: string;
  env?: Record<string, string | undefined>;
  spawnReader?: (args: { cmd: string[]; cwd: string; env: Record<string, string | undefined>; stdin: "pipe"; stdout: "pipe"; stderr: "pipe" }) => ReaderProcess;
  stopOwnedProcess?: typeof stopOwnedSearchWorkerProcess;
}
type Job = {
  source: SourceReaderSource;
  mode: "periodic" | "explicit";
  resolve(value: unknown): void;
};
type Slot = {
  proc: ReaderProcess;
  job: Job;
  id: string;
  settled: boolean;
  stopping: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  path: string | null;
  waitingForOwner: boolean;
  token: string | null;
};
const failed = () => ({ ok: false, error_code: "record_write_failed", retryable: true });
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;
}

/** A reader never opens the memory DB. Only the owner executes the limited operation protocol. */
export class SourceReaderPool {
  private readonly queue: Job[] = [];
  private readonly slots = new Set<Slot>();
  private readonly quarantined = new Map<string, number>();
  private stopped = false;
  private sequence = 0;
  private readonly capacity: number;
  private readonly queueLimit: number;
  constructor(
    private readonly config: Config,
    private readonly handle: (operation: SourceReaderOperation) => unknown | Promise<unknown>,
    private readonly options: SourceReaderOptions = {},
    private readonly memoryIdentity?: { device: string; inode: string },
  ) {
    this.capacity = bounded(options.slots, 2, 1, 4);
    this.queueLimit = bounded(options.maxQueued, 12, 1, 64);
  }

  snapshot(): { live: number; queued: number; stopping: number; quarantined: number; reserved?: number; unconfirmed?: number } {
    return { live: this.slots.size, queued: this.queue.length, stopping: [...this.slots].filter((s) => s.stopping).length, quarantined: this.quarantined.size, ...this.options.ledger?.status() };
  }

  run(source: SourceReaderSource, mode: "periodic" | "explicit"): Promise<unknown> {
    if (this.stopped || this.queue.length >= this.queueLimit) return Promise.resolve(failed());
    if (this.slots.size >= this.capacity && [...this.slots].every((s) => s.stopping)) return Promise.resolve(failed());
    return new Promise((resolve) => { this.queue.push({ source, mode, resolve }); this.drain(); });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const job of this.queue.splice(0)) job.resolve(failed());
    await Promise.all([...this.slots].map((slot) => this.stopSlot(slot)));
  }

  private drain(): void {
    if (this.stopped) return;
    while (this.slots.size < this.capacity && this.queue.length) {
      const index = this.queue.findIndex((job) => ![...this.slots].some((slot) => !slot.settled && slot.job.source === job.source));
      if (index < 0) break;
      const [job] = this.queue.splice(index, 1);
      let token: string | null = null;
      let spawned: Slot | null = null;
      try {
        token = this.options.ledger?.reserve(this.capacity) ?? null;
        if (this.options.ledger && !token) {
          job.resolve(failed());
          for (const pending of this.queue.splice(0)) pending.resolve(failed());
          return;
        }
        const scriptPath = this.options.scriptPath ?? join(import.meta.dir, "../tools/source-reader-worker.ts");
        const proc = (this.options.spawnReader ?? ((args) => Bun.spawn(args)))({
          cmd: [process.execPath, "run", scriptPath, ...(token ? [`--harness-mem-source-reader-token=${token}`, `--harness-mem-parent-pid=${process.pid}`] : [])],
          cwd: import.meta.dir,
          env: {
            PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
            NODE_ENV: process.env.NODE_ENV,
            ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^HARNESS_MEM_INGEST_(TICK|READ|MAX|SLOW)/.test(key))),
            ...this.options.env, HARNESS_MEM_SOURCE_READER_PROCESS: "1",
          },
          stdin: "pipe", stdout: "pipe", stderr: "pipe",
        });
        const slot: Slot = { proc, job, id: `reader-${++this.sequence}`, settled: false, stopping: false, timer: null, path: null, waitingForOwner: false, token };
        this.slots.add(slot);
        spawned = slot;
        try { if (token) this.options.ledger!.attach(token, proc.pid); }
        catch { void this.stopSlot(slot); }
        this.arm(slot, bounded(this.options.startupTimeoutMs, 10_000, 10, 60_000));
        void this.read(slot);
        void this.discardErrors(proc);
        void proc.exited.then(() => {
          this.settle(slot, failed());
          if (slot.token) this.options.ledger?.release(slot.token);
          this.slots.delete(slot);
          this.drain();
        }, () => { void this.stopSlot(slot); });
        const now = Date.now();
        for (const [path, until] of this.quarantined) if (until <= now) this.quarantined.delete(path);
        void this.send(slot, {
          id: slot.id, source: job.source, mode: job.mode,
          config: sourceReaderConfig(this.config), quarantine: [...this.quarantined.keys()],
          memoryIdentity: this.memoryIdentity,
        }).catch(() => this.stopSlot(slot));
      } catch {
        // Spawn itself failed: there is no process whose exit could remain unknown.
        if (spawned) void this.stopSlot(spawned);
        else if (token) this.options.ledger?.release(token);
        job.resolve(failed());
      }
    }
  }

  private arm(slot: Slot, timeoutMs = bounded(this.options.ioTimeoutMs, 2_000, 10, 60_000)): void {
    if (slot.timer) clearTimeout(slot.timer);
    if (slot.settled || slot.waitingForOwner) return;
    slot.timer = setTimeout(() => {
      if (slot.path) {
        if (this.quarantined.size >= 32) this.quarantined.delete(this.quarantined.keys().next().value!);
        this.quarantined.set(slot.path, Date.now() + bounded(this.options.quarantineMs, 30_000, 100, 300_000));
      }
      void this.stopSlot(slot);
    }, timeoutMs);
  }

  private settle(slot: Slot, result: unknown): void {
    if (slot.settled) return;
    slot.settled = true;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.job.resolve(result);
  }

  private async stopSlot(slot: Slot): Promise<void> {
    this.settle(slot, failed());
    if (slot.stopping) return;
    slot.stopping = true;
    this.drain();
    try {
      await (this.options.stopOwnedProcess ?? stopOwnedSearchWorkerProcess)({ proc: slot.proc, warn: () => {} });
    } catch { /* The authoritative handle remains in slots until exited resolves. */ }
    if (this.slots.size >= this.capacity && [...this.slots].every((s) => s.stopping)) {
      for (const job of this.queue.splice(0)) job.resolve(failed());
    }
  }

  private async send(slot: Slot, packet: unknown): Promise<void> {
    if (!slot.proc.stdin || typeof slot.proc.stdin === "number") throw new Error("source_reader_pipe");
    const input = slot.proc.stdin as { write(value: Uint8Array): number | Promise<number>; flush?: () => number | Promise<number> };
    await input.write(encodeReaderPacket(packet));
    await input.flush?.();
  }

  private async read(slot: Slot): Promise<void> {
    if (!slot.proc.stdout || typeof slot.proc.stdout === "number") { await this.stopSlot(slot); return; }
    const reader = slot.proc.stdout.getReader();
    let buffer = Buffer.alloc(0);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = Buffer.concat([buffer, Buffer.from(value)]);
        let newline: number;
        while ((newline = buffer.indexOf(10)) >= 0) {
          if (newline + 1 > SOURCE_READER_MAX_PACKET_BYTES) throw new Error("source_reader_packet_limit");
          const packet = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
          buffer = buffer.subarray(newline + 1);
          if (slot.settled || packet.id !== slot.id) continue;
          if (packet.kind === "fs_begin") {
            if (typeof packet.path !== "string" || Buffer.byteLength(packet.path) > SOURCE_READER_MAX_PATH_BYTES) throw new Error("source_reader_path_limit");
            slot.path = packet.path;
            this.arm(slot);
          } else if (packet.kind === "fs_end") {
            slot.path = null;
            this.arm(slot, 30_000);
          } else if (packet.kind === "call") {
            if (!Number.isSafeInteger(packet.callId)) throw new Error("source_reader_protocol");
            slot.waitingForOwner = true;
            if (slot.timer) clearTimeout(slot.timer);
            let result: unknown;
            try { result = await this.handle(packet.operation); }
            catch { result = { reader_error: "source_owner_failed" }; }
            // A cancelled generation cannot ACK or start later writes.
            if (!slot.settled) await this.send(slot, { id: slot.id, callId: packet.callId, result });
            slot.waitingForOwner = false;
            this.arm(slot, slot.path ? undefined : 30_000);
          } else if (packet.kind === "done") {
            this.settle(slot, packet.result);
            void this.stopSlot(slot);
          } else throw new Error("source_reader_protocol");
        }
        if (buffer.length > SOURCE_READER_MAX_PACKET_BYTES) throw new Error("source_reader_packet_limit");
      }
    } catch { await this.stopSlot(slot); }
  }

  private async discardErrors(proc: ReaderProcess): Promise<void> {
    if (!proc.stderr || typeof proc.stderr === "number") return;
    try { const reader = proc.stderr.getReader(); while (!(await reader.read()).done) { /* never forward source paths or content */ } }
    catch { /* diagnostics do not affect ownership */ }
  }
}
