import { randomUUID } from "node:crypto";
import type { ApiResponse, ConsolidationRunRequest } from "./types";
import { buildSearchWorkerIdentityArgs, stopOwnedSearchWorkerProcess } from "./search-worker-lifecycle";

type WorkerProcess = ReturnType<typeof Bun.spawn>;
type WorkerStdin = {
  write(chunk: Uint8Array): number | Promise<number>;
  flush?: () => number | Promise<number>;
  end?: () => void;
};

export type MaintenanceTask = "consolidation" | "wal_checkpoint" | "search_audit_flush";
type WorkerTask = MaintenanceTask | "recover_consolidation";

interface WorkerReply {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  progress?: unknown;
  error_code?: unknown;
}

interface QueueEntry {
  id: string;
  task: WorkerTask;
  request?: ConsolidationRunRequest;
  scheduler: boolean;
  resolve?: (value: ApiResponse) => void;
  reject?: (error: Error) => void;
}

export interface MaintenanceProgress {
  kind: "started" | "completed" | "failed" | "busy";
  task: MaintenanceTask;
  elapsed_ms?: number;
  queue_depth: number;
  jobs_processed?: number;
  observations_scanned?: number;
  existing_facts_scanned?: number;
  pending_jobs?: number;
  busy?: number;
  log?: number;
  checkpointed?: number;
  wal_bytes_before?: number | null;
  wal_bytes_after?: number | null;
  wal_limit_bytes?: number;
  wal_above_limit?: boolean;
  error_code?: string;
  intents_applied?: number;
  intents_replayed?: number;
  intents_remaining?: number;
}

export interface BackgroundMaintenanceWorkerClientOptions {
  scriptPath: string;
  cwd: string;
  env: Record<string, string | undefined>;
  dbPath: string;
  busyLogMs: number;
  consolidationTimeoutMs: number;
  restartBackoffMs?: number;
  maxConsecutiveStartFailures?: number;
  searchAuditFlushMaxRetries?: number;
  spawnWorker?: () => WorkerProcess;
  onProgress?: (event: MaintenanceProgress) => void;
  stopOwnedProcess?: typeof stopOwnedSearchWorkerProcess;
}

export interface SearchAuditFlushRunState {
  readonly run_id: string;
  readonly started_at_ms: number;
  finished_at_ms: number | null;
}

export function shouldRetryWalCheckpoint(event: MaintenanceProgress): boolean {
  if (event.task !== "wal_checkpoint") return false;
  if (event.kind === "failed") return true;
  const busy = event.busy ?? 0;
  const log = event.log ?? 0;
  const checkpointed = event.checkpointed ?? 0;
  return busy > 0 || log > checkpointed;
}

export function resolveSchedulerConsolidationLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  const value = Number(env.HARNESS_MEM_CONSOLIDATION_SCHEDULER_BATCH_SIZE || 1);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(10, Math.floor(value));
}

const SAFE_RESULT_KEYS = new Set([
  "jobs_processed", "observations_scanned", "existing_facts_scanned", "pending_jobs", "facts_extracted", "facts_merged",
  "derives_links_created", "dreaming_rewrites_created", "busy", "log",
  "checkpointed", "wal_bytes_before", "wal_bytes_after", "wal_limit_bytes",
  "wal_above_limit", "elapsed_ms",
  "intents_applied", "intents_replayed", "intents_remaining",
]);

/**
 * One daemon-owned process serializes consolidation and explicit PASSIVE WAL
 * checkpoints. Scheduler duplicates coalesce; manual consolidation requests
 * remain FIFO. A waiting checkpoint takes priority after an active
 * consolidation so WAL growth cannot be starved by manual requests.
 */
export class BackgroundMaintenanceWorkerClient {
  private proc: WorkerProcess | null = null;
  private stoppingProc: WorkerProcess | null = null;
  private stdin: WorkerStdin | null = null;
  private readonly queue: QueueEntry[] = [];
  private readonly scheduled = new Set<MaintenanceTask>();
  private active: (QueueEntry & { startedAtMs: number }) | null = null;
  private sequence = 0;
  private stopped = false;
  private terminating = false;
  private stopPromise: Promise<void> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private lastBusyLogAtMs = 0;
  private readonly workerToken = randomUUID();
  private consecutiveStartFailures = 0;
  private disabled = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private searchAuditFlushRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private searchAuditFlushRetryAttempt = 0;
  private activeSearchAuditFlushRunState: SearchAuditFlushRunState | null = null;

  constructor(private readonly options: BackgroundMaintenanceWorkerClientOptions) {}

  schedule(task: MaintenanceTask): boolean {
    if (this.stopped || this.disabled) return false;
    if (this.scheduled.has(task)) {
      this.recordBusyState(task);
      return false;
    }
    this.scheduled.add(task);
    const entry: QueueEntry = {
      id: `maintenance-${++this.sequence}`,
      task,
      scheduler: true,
      request: task === "consolidation"
        ? { reason: "scheduler", limit: resolveSchedulerConsolidationLimit(this.options.env) }
        : undefined,
    };
    if (task === "search_audit_flush") {
      this.queue.unshift(entry);
    } else if (task === "wal_checkpoint" && this.active?.task === "consolidation") {
      this.queue.unshift(entry);
    } else {
      this.queue.push(entry);
    }
    this.drain();
    return true;
  }

  runConsolidation(request: ConsolidationRunRequest): Promise<ApiResponse> {
    if (this.stopped || this.disabled) return Promise.reject(new Error("maintenance worker unavailable"));
    return new Promise<ApiResponse>((resolve, reject) => {
      this.queue.push({
        id: `maintenance-${++this.sequence}`,
        task: "consolidation",
        request,
        scheduler: false,
        resolve,
        reject,
      });
      this.drain();
    });
  }

  pendingTasks(): readonly MaintenanceTask[] {
    return this.queue
      .map((entry) => entry.task)
      .filter((task): task is MaintenanceTask => task !== "recover_consolidation");
  }

  activeTask(): MaintenanceTask | null {
    const task = this.active?.task;
    return task === "recover_consolidation" ? null : task ?? null;
  }

  activeSearchAuditFlushRun(): SearchAuditFlushRunState | null {
    return this.activeSearchAuditFlushRunState;
  }

  workerPid(): number | null {
    const proc = this.proc ?? this.stoppingProc;
    return typeof proc?.pid === "number" ? proc.pid : null;
  }

  hasLiveProcess(): boolean {
    return this.proc !== null || this.stoppingProc !== null;
  }

  stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.searchAuditFlushRetryTimer) clearTimeout(this.searchAuditFlushRetryTimer);
    this.searchAuditFlushRetryTimer = null;
    for (const entry of this.queue.splice(0)) entry.reject?.(new Error("maintenance worker stopped"));
    this.scheduled.clear();
    if (this.active) this.active.reject?.(new Error("maintenance worker stopped"));
    this.finishActive();
    return this.stopWorker();
  }

  private ensureStarted(): void {
    if (this.proc && this.stdin) return;
    const proc = this.options.spawnWorker?.() ?? Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        this.options.scriptPath,
        ...buildSearchWorkerIdentityArgs(this.options.dbPath, process.pid, this.workerToken),
      ],
      cwd: this.options.cwd,
      env: {
        ...this.options.env,
        HARNESS_MEM_BACKGROUND_MAINTENANCE_WORKER_PROCESS: "1",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.proc = proc;
    if (!proc.stdin) {
      void this.stopWorker();
      throw new Error("background maintenance worker stdin unavailable");
    }
    this.stdin = proc.stdin as unknown as WorkerStdin;
    void this.readStdout(proc);
    void this.readStderr(proc);
    void proc.exited.then(() => this.handleExit(proc));
  }

  private drain(): void {
    if (this.stopped || this.terminating || this.active || this.queue.length === 0) return;
    const entry = this.queue.shift()!;
    try {
      this.ensureStarted();
      if (!this.stdin) throw new Error("background maintenance worker unavailable");
      this.active = { ...entry, startedAtMs: Date.now() };
      if (entry.task === "search_audit_flush") {
        this.activeSearchAuditFlushRunState = {
          run_id: entry.id,
          started_at_ms: this.active.startedAtMs,
          finished_at_ms: null,
        };
      }
      if (entry.task !== "recover_consolidation") {
        this.emit({ kind: "started", task: entry.task, queue_depth: this.queue.length });
      }
      const payload = JSON.stringify({ id: entry.id, task: entry.task, request: entry.request }) + "\n";
      const written = this.stdin.write(new TextEncoder().encode(payload));
      if (written instanceof Promise) void written.catch(() => this.failActive("worker_write_failed"));
      const flushed = this.stdin.flush?.();
      if (flushed instanceof Promise) void flushed.catch(() => this.failActive("worker_flush_failed"));
      if (entry.task === "consolidation") {
        this.timeout = setTimeout(() => this.timeoutActive(), this.options.consolidationTimeoutMs);
      }
    } catch {
      if (this.active?.id === entry.id) this.finishActive();
      this.handleWorkerFailure(entry, "worker_start_failed", false);
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
      if (this.proc === proc) this.failActive("worker_protocol_failed");
    }
  }

  private async readStderr(proc: WorkerProcess): Promise<void> {
    if (!proc.stderr || typeof proc.stderr === "number") return;
    const reader = proc.stderr.getReader();
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // Worker diagnostics never affect scheduling and raw stderr is not forwarded.
    }
  }

  private handleLine(line: string): void {
    if (!line.startsWith("{") || !this.active) return;
    let reply: WorkerReply;
    try { reply = JSON.parse(line) as WorkerReply; } catch { return; }
    if (reply.id !== this.active.id) return;
    const active = this.active;
    const elapsedMs = Date.now() - active.startedAtMs;
    if (active.task === "recover_consolidation") {
      this.finishActive();
      this.drain();
      return;
    }
    let continueSearchAuditFlush = false;
    let retrySearchAuditFlush = false;
    if (reply.ok === true) {
      this.consecutiveStartFailures = 0;
      const result = reply.progress && typeof reply.progress === "object"
        ? reply.progress as Record<string, unknown>
        : {};
      const safe = Object.fromEntries(
        Object.entries(result).filter(([key, value]) => SAFE_RESULT_KEYS.has(key) &&
          (typeof value === "number" || typeof value === "boolean" || value === null)),
      );
      this.emit({
        kind: "completed",
        task: active.task,
        elapsed_ms: elapsedMs,
        queue_depth: this.queue.length,
        ...safe,
      } as MaintenanceProgress);
      continueSearchAuditFlush = active.task === "search_audit_flush" &&
        Number(safe.intents_remaining ?? 0) > 0;
      if (active.task === "search_audit_flush") {
        this.searchAuditFlushRetryAttempt = 0;
        if (this.searchAuditFlushRetryTimer) clearTimeout(this.searchAuditFlushRetryTimer);
        this.searchAuditFlushRetryTimer = null;
      }
      if (!active.scheduler) active.resolve?.(reply.result as ApiResponse);
    } else {
      const errorCode = typeof reply.error_code === "string" ? reply.error_code : "worker_failure";
      this.emit({ kind: "failed", task: active.task, elapsed_ms: elapsedMs, queue_depth: this.queue.length, error_code: errorCode });
      active.reject?.(new Error(errorCode));
      retrySearchAuditFlush = active.task === "search_audit_flush";
    }
    this.finishActive();
    if (continueSearchAuditFlush) this.schedule("search_audit_flush");
    if (retrySearchAuditFlush) this.scheduleSearchAuditFlushRetry();
    this.drain();
  }

  private emit(event: MaintenanceProgress): void {
    this.options.onProgress?.(event);
  }

  private recordBusyState(task: MaintenanceTask): void {
    const now = Date.now();
    if (now - this.lastBusyLogAtMs < this.options.busyLogMs) return;
    this.lastBusyLogAtMs = now;
    this.emit({ kind: "busy", task, queue_depth: this.queue.length, elapsed_ms: this.active ? now - this.active.startedAtMs : 0 });
  }

  private timeoutActive(): void {
    const active = this.active;
    if (!active || active.task !== "consolidation") return;
    this.emit({ kind: "failed", task: active.task, elapsed_ms: Date.now() - active.startedAtMs, queue_depth: this.queue.length, error_code: "timeout" });
    active.reject?.(new Error("consolidation worker timeout"));
    this.finishActive();
    this.prioritizeConsolidationRecovery(active.scheduler ? active : undefined);
    void this.stopWorker().then(() => this.drain());
  }

  private failActive(reason: string): void {
    const active = this.active;
    this.finishActive();
    if (active) this.handleWorkerFailure(active, reason);
  }

  private handleWorkerFailure(entry: QueueEntry, reason: string, mayHaveRun = true): void {
    this.consecutiveStartFailures += 1;
    if (this.consecutiveStartFailures >= (this.options.maxConsecutiveStartFailures ?? 5)) {
      this.disableAfterFailures(entry);
      void this.stopWorker();
      return;
    }
    if (entry.task === "consolidation" && mayHaveRun) {
      entry.reject?.(new Error(reason));
      this.prioritizeConsolidationRecovery(entry.scheduler ? entry : undefined);
    } else {
      this.requeueOrReject(entry, reason);
    }
    void this.stopWorker().then(() => this.scheduleDrain());
  }

  private disableAfterFailures(entry: QueueEntry): void {
    this.disabled = true;
    this.scheduled.clear();
    entry.reject?.(new Error("maintenance worker disabled after repeated start failures"));
    for (const queued of this.queue.splice(0)) {
      queued.reject?.(new Error("maintenance worker disabled after repeated start failures"));
    }
    const task = entry.task === "recover_consolidation" ? "consolidation" : entry.task;
    this.emit({
      kind: "failed",
      task,
      queue_depth: 0,
      error_code: "worker_disabled",
    });
  }

  private scheduleDrain(): void {
    if (this.stopped || this.disabled || this.retryTimer) return;
    const base = Math.max(1, this.options.restartBackoffMs ?? 250);
    const delay = Math.min(5_000, base * (2 ** Math.max(0, this.consecutiveStartFailures - 1)));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.drain();
    }, delay);
  }

  private scheduleSearchAuditFlushRetry(): void {
    if (this.stopped || this.disabled || this.searchAuditFlushRetryTimer) return;
    const maxRetries = Math.max(0, this.options.searchAuditFlushMaxRetries ?? 5);
    if (this.searchAuditFlushRetryAttempt >= maxRetries) return;
    this.searchAuditFlushRetryAttempt += 1;
    const base = Math.max(1, this.options.restartBackoffMs ?? 250);
    const delay = Math.min(5_000, base * (2 ** Math.max(0, this.searchAuditFlushRetryAttempt - 1)));
    this.searchAuditFlushRetryTimer = setTimeout(() => {
      this.searchAuditFlushRetryTimer = null;
      this.schedule("search_audit_flush");
    }, delay);
  }

  private requeueOrReject(entry: QueueEntry, reason: string): void {
    if (entry.task === "recover_consolidation" && !this.stopped) {
      this.queue.unshift(entry);
      return;
    }
    if (entry.scheduler && entry.task !== "recover_consolidation" && !this.stopped) {
      this.scheduled.add(entry.task);
      this.queue.unshift(entry);
    } else {
      entry.reject?.(new Error(reason));
    }
  }

  private prioritizeConsolidationRecovery(_entry?: QueueEntry): void {
    if (this.stopped) return;
    if (this.queue.some((candidate) => candidate.task === "recover_consolidation")) return;
    const recovery: QueueEntry = {
      id: `maintenance-${++this.sequence}`,
      task: "recover_consolidation",
      scheduler: false,
    };
    let insertAt = 0;
    while (insertAt < this.queue.length && this.queue[insertAt]?.task === "wal_checkpoint") insertAt += 1;
    this.queue.splice(insertAt, 0, recovery);
  }

  private finishActive(): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    if (this.active?.task === "search_audit_flush") {
      if (this.activeSearchAuditFlushRunState?.run_id === this.active.id) {
        this.activeSearchAuditFlushRunState.finished_at_ms = Date.now();
      }
      this.activeSearchAuditFlushRunState = null;
    }
    if (this.active?.scheduler && this.active.task !== "recover_consolidation") {
      this.scheduled.delete(this.active.task);
    }
    this.active = null;
  }

  private handleExit(proc: WorkerProcess): void {
    if (this.proc !== proc) return;
    this.proc = null;
    this.stdin = null;
    if (this.active) {
      const active = this.active;
      this.finishActive();
      this.handleWorkerFailure(active, "worker_exit");
      return;
    }
    if (!this.stopped) this.scheduleDrain();
  }

  private stopWorker(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const proc = this.proc;
    const stdin = this.stdin;
    this.proc = null;
    this.stdin = null;
    if (!proc) return Promise.resolve();
    this.stoppingProc = proc;
    this.terminating = true;
    try { stdin?.end?.(); } catch { /* best effort */ }
    this.stopPromise = (async () => {
      const result = await (this.options.stopOwnedProcess ?? stopOwnedSearchWorkerProcess)({
        proc,
        warn: (message) => console.warn(message.replace("search worker", "maintenance worker")),
      });
      if (result.status !== "terminated" && result.status !== "killed") {
        for (;;) {
          const exited = await Promise.race([proc.exited.then(() => true, () => true), Bun.sleep(250).then(() => false)]);
          if (exited) break;
          try { proc.kill("SIGKILL"); } catch { /* retain and retry authoritative handle */ }
        }
      }
    })().finally(() => {
      if (this.stoppingProc === proc) this.stoppingProc = null;
      this.stopPromise = null;
      this.terminating = false;
    });
    return this.stopPromise;
  }
}
