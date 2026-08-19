import type { PeriodicIngestSource } from "./ingest-coordinator";
import { stopOwnedSearchWorkerProcess } from "./search-worker-lifecycle";

type WorkerProcess = ReturnType<typeof Bun.spawn>;
type WorkerStdin = {
  write(chunk: Uint8Array): number | Promise<number>;
  flush?: () => number | Promise<number>;
  end?: () => void;
};

interface WorkerReply {
  id?: unknown;
  ok?: unknown;
}

const SAFE_TELEMETRY_KEYS = new Set([
  "kind", "tick_available", "tick_started_at", "source", "elapsed_ms", "event_count",
  "distinct_session_count", "phases", "wal_size_available", "wal_bytes",
  "wal_checkpoint_available", "wal_checkpoint_age_available", "wal_checkpoint_age_ms", "wal_checkpoint",
  "os_fs_read_ops", "os_major_page_faults", "transaction_fs_read_ops",
  "transaction_major_page_faults", "io_counter_scope", "successful_lock_wait_available",
  "sqlite_db_read_latency_available", "lock_observation_scope", "sqlite_busy_count",
  "sqlite_locked_count", "sqlite_busy_failure_elapsed_ms", "sqlite_last_code",
  "sqlite_last_extended_code", "code", "extended_code", "busy_or_locked",
]);

export interface PeriodicIngestWorkerClientOptions {
  scriptPath: string;
  cwd: string;
  env: Record<string, string | undefined>;
  busyLogMs: number;
  onError?: (source: PeriodicIngestSource, reason: "exit" | "protocol") => void;
  stopOwnedProcess?: typeof stopOwnedSearchWorkerProcess;
}

export class PeriodicIngestWorkerClient {
  private proc: WorkerProcess | null = null;
  private stdin: WorkerStdin | null = null;
  private readonly queue: PeriodicIngestSource[] = [];
  private readonly scheduled = new Set<PeriodicIngestSource>();
  private active: { id: string; source: PeriodicIngestSource; startedAtMs: number } | null = null;
  private sequence = 0;
  private stopped = false;
  private terminating = false;
  private stopPromise: Promise<void> | null = null;
  private lastBusyLogAtMs = 0;

  constructor(private readonly options: PeriodicIngestWorkerClientOptions) {}

  schedule(source: PeriodicIngestSource): boolean {
    if (this.stopped) return false;
    if (this.scheduled.has(source)) {
      this.recordBusyState();
      return false;
    }
    this.scheduled.add(source);
    this.queue.push(source);
    this.drain();
    return true;
  }

  pendingSources(): readonly PeriodicIngestSource[] {
    return [...this.queue];
  }

  activeSource(): PeriodicIngestSource | null {
    return this.active?.source ?? null;
  }

  workerPid(): number | null {
    return typeof this.proc?.pid === "number" ? this.proc.pid : null;
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.queue.length = 0;
    this.scheduled.clear();
    return this.stopWorker();
  }

  private ensureStarted(): void {
    if (this.proc && this.stdin) return;
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", this.options.scriptPath],
      cwd: this.options.cwd,
      env: { ...this.options.env, HARNESS_MEM_INGEST_WORKER_PROCESS: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.proc = proc;
    if (!proc.stdin) {
      void this.stopWorker();
      throw new Error("periodic ingest worker stdin unavailable");
    }
    this.stdin = proc.stdin as unknown as WorkerStdin;
    void this.readStdout(proc);
    void this.readSafeTelemetry(proc);
    void proc.exited.then(() => this.handleExit(proc));
  }

  private drain(): void {
    if (this.stopped || this.terminating || this.active || this.queue.length === 0) return;
    const source = this.queue.shift()!;
    const id = `ingest-${++this.sequence}`;
    try {
      this.ensureStarted();
      if (!this.stdin) throw new Error("periodic ingest worker unavailable");
      this.active = { id, source, startedAtMs: Date.now() };
      const written = this.stdin.write(new TextEncoder().encode(`${JSON.stringify({ id, source })}\n`));
      if (written instanceof Promise) {
        void written.catch(() => this.failActive("exit"));
      }
      const flushed = this.stdin.flush?.();
      if (flushed instanceof Promise) {
        void flushed.catch(() => this.failActive("exit"));
      }
    } catch {
      this.options.onError?.(source, "exit");
      this.scheduled.delete(source);
      void this.stopWorker();
      queueMicrotask(() => this.drain());
    }
  }

  private async readStdout(proc: WorkerProcess): Promise<void> {
    if (!proc.stdout || typeof proc.stdout === "number") return;
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          this.handleLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
    } catch {
      if (this.proc === proc) this.failActive("protocol");
    }
  }

  private async readSafeTelemetry(proc: WorkerProcess): Promise<void> {
    if (!proc.stderr || typeof proc.stderr === "number") return;
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          this.forwardSafeTelemetryLine(buffer.slice(0, newline).trim());
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
    } catch {
      // Diagnostics must never affect worker scheduling.
    }
  }

  private forwardSafeTelemetryLine(line: string): void {
    const prefix = "[sqlite-perf] ";
    if (!line.startsWith(prefix)) return;
    try {
      const payload = JSON.parse(line.slice(prefix.length)) as { kind?: unknown };
      if (payload.kind !== "slow_ingest_tick" && payload.kind !== "sqlite_error") return;
      if (Object.keys(payload).some((key) => !SAFE_TELEMETRY_KEYS.has(key))) return;
      console.warn(`${prefix}${JSON.stringify(payload)}`);
    } catch {
      // Only schema-checked structured telemetry crosses the process boundary.
    }
  }

  private handleLine(line: string): void {
    if (!line.startsWith("{")) return;
    let reply: WorkerReply;
    try {
      reply = JSON.parse(line) as WorkerReply;
    } catch {
      return;
    }
    if (!this.active || reply.id !== this.active.id) return;
    if (reply.ok !== true) this.options.onError?.(this.active.source, "protocol");
    this.finishActive();
    this.drain();
  }

  private finishActive(): void {
    if (!this.active) return;
    this.scheduled.delete(this.active.source);
    this.active = null;
  }

  private recordBusyState(): void {
    if (!this.active) return;
    const now = Date.now();
    const activeAgeMs = now - this.active.startedAtMs;
    if (activeAgeMs < this.options.busyLogMs || now - this.lastBusyLogAtMs < this.options.busyLogMs) return;
    this.lastBusyLogAtMs = now;
    console.warn(`[ingest-worker] ${JSON.stringify({
      kind: "busy",
      source: this.active.source,
      active_age_ms: activeAgeMs,
      queue_depth: this.queue.length,
    })}`);
  }

  private failActive(reason: "exit" | "protocol"): void {
    if (this.active) this.options.onError?.(this.active.source, reason);
    this.finishActive();
    void this.stopWorker();
  }

  private handleExit(proc: WorkerProcess): void {
    if (this.proc !== proc) return;
    this.proc = null;
    this.stdin = null;
    if (this.active) {
      this.options.onError?.(this.active.source, "exit");
      this.finishActive();
    }
    this.drain();
  }

  private stopWorker(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const proc = this.proc;
    const stdin = this.stdin;
    this.proc = null;
    this.stdin = null;
    if (this.active) this.finishActive();
    if (!proc) return Promise.resolve();
    this.terminating = true;
    try { stdin?.end?.(); } catch { /* best effort */ }
    this.stopPromise = (async () => {
      const result = await (this.options.stopOwnedProcess ?? stopOwnedSearchWorkerProcess)({
        proc,
        warn: (message) => console.warn(message.replace("search worker", "ingest worker")),
      });
      if (result.status !== "terminated" && result.status !== "killed") {
        // Core shutdown must not complete while the authoritative handle is live.
        for (;;) {
          const exited = await Promise.race([
            proc.exited.then(() => true, () => true),
            Bun.sleep(250).then(() => false),
          ]);
          if (exited) break;
          try { proc.kill("SIGKILL"); } catch { /* retain and retry the owned handle */ }
        }
      }
    })().finally(() => {
      this.stopPromise = null;
      this.terminating = false;
      this.drain();
    });
    return this.stopPromise;
  }
}
