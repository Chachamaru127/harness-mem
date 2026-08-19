import { statSync } from "node:fs";
import type { Database } from "bun:sqlite";

interface PhaseAggregate {
  count: number;
  totalMs: number;
  maxMs: number;
}

interface EnsuredSessionState {
  platform: string;
  project: string;
  startedAt: string;
  correlationId: string | null;
  userId: string;
  teamId: string | null;
}

export interface IngestTickTelemetryContext {
  readonly source: string;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly fsReadStart: number;
  readonly majorPageFaultStart: number;
  readonly phases: Map<string, PhaseAggregate>;
  readonly ensuredSessions: Map<string, EnsuredSessionState>;
  readonly activitySessions: Set<string>;
  eventCount: number;
  transactionFsReadOps: number;
  transactionMajorPageFaults: number;
  sqliteBusyCount: number;
  sqliteLockedCount: number;
  sqliteLastCode: string | null;
  sqliteLastExtendedCode: number | null;
  sqliteBusyFailureElapsedMs: number;
  sqliteLastError: unknown;
}

let currentTick: IngestTickTelemetryContext | null = null;
let lastWalCheckpointCompletedAtMs: number | null = null;
let lastWalCheckpointResult: { busy: number; log: number; checkpointed: number } | null = null;

const SQLITE_PHASES = new Set([
  "ensure_session", "ensure_session_skipped", "event_insert", "observation_insert",
  "observation_insert_retry", "dedupe_conflict_lookup", "dedupe_expired_archive",
  "tags_insert", "vector_upsert", "extract_entities", "extract_graph_relations",
  "auto_link", "auto_supersedes", "semantic_auto_linker", "insert_nuggets", "audit_log",
  "record_event_transaction_total", "record_event_commit_residual",
  "session_activity_update",
]);

function readFsOperations(): number {
  try {
    return Number(process.resourceUsage().fsRead ?? 0);
  } catch {
    return 0;
  }
}

const WAL_CHECKPOINT_META_KEY = "ingest.telemetry.wal_checkpoint";

function walBytes(db: Database): number | null {
  const filename = (db as unknown as { filename?: string }).filename;
  if (!filename || filename === ":memory:") return null;
  try {
    return statSync(`${filename}-wal`).size;
  } catch {
    return null;
  }
}

function readDurableWalCheckpoint(db: Database): {
  completedAtMs: number;
  result: { busy: number; log: number; checkpointed: number };
} | null {
  try {
    const row = db.query<{ value: string }, [string]>("SELECT value FROM mem_meta WHERE key = ?")
      .get(WAL_CHECKPOINT_META_KEY);
    if (!row) return null;
    const value = JSON.parse(row.value) as Record<string, unknown>;
    const completedAtMs = Number(value.completed_at_ms);
    const busy = Number(value.busy);
    const log = Number(value.log);
    const checkpointed = Number(value.checkpointed);
    if (![completedAtMs, busy, log, checkpointed].every(Number.isFinite)) return null;
    return { completedAtMs, result: { busy, log, checkpointed } };
  } catch {
    return null;
  }
}

export function beginIngestTickTelemetry(source: string): IngestTickTelemetryContext {
  const now = Date.now();
  const context: IngestTickTelemetryContext = {
    source,
    startedAt: new Date(now).toISOString(),
    startedAtMs: now,
    fsReadStart: readFsOperations(),
    majorPageFaultStart: Number(process.resourceUsage().majorPageFault ?? 0),
    phases: new Map(),
    ensuredSessions: new Map(),
    activitySessions: new Set(),
    eventCount: 0,
    transactionFsReadOps: 0,
    transactionMajorPageFaults: 0,
    sqliteBusyCount: 0,
    sqliteLockedCount: 0,
    sqliteLastCode: null,
    sqliteLastExtendedCode: null,
    sqliteBusyFailureElapsedMs: 0,
    sqliteLastError: null,
  };
  currentTick = context;
  return context;
}

export function getCurrentIngestTickTelemetry(): IngestTickTelemetryContext | null {
  return currentTick;
}

export function recordSqlitePhase(label: string, elapsedMs: number): void {
  const context = currentTick;
  if (!context || !SQLITE_PHASES.has(label)) return;
  const aggregate = context.phases.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
  aggregate.count += 1;
  aggregate.totalMs += elapsedMs;
  aggregate.maxMs = Math.max(aggregate.maxMs, elapsedMs);
  context.phases.set(label, aggregate);
}

export function shouldEnsureSessionForCurrentTick(sessionId: string, next: EnsuredSessionState): boolean {
  const context = currentTick;
  if (!context) return true;
  context.eventCount += 1;
  const previous = context.ensuredSessions.get(sessionId);
  if (!previous) return true;
  const needsRefresh =
    next.startedAt < previous.startedAt ||
    (previous.correlationId === null && next.correlationId !== null);
  return needsRefresh;
}

export function recordSessionEnsuredForCurrentTick(sessionId: string, next: EnsuredSessionState): void {
  const context = currentTick;
  if (!context) return;
  const previous = context.ensuredSessions.get(sessionId);
  context.ensuredSessions.set(sessionId, previous
    ? {
      platform: next.platform,
      project: next.project,
      startedAt: next.startedAt < previous.startedAt ? next.startedAt : previous.startedAt,
      correlationId: previous.correlationId ?? next.correlationId,
      userId: previous.userId,
      teamId: previous.teamId,
    }
    : next);
}

export function shouldPersistSessionActivityForCurrentTick(sessionId: string): boolean {
  const context = currentTick;
  return context ? !context.activitySessions.has(sessionId) : true;
}

export function recordSessionActivityPersistedForCurrentTick(sessionId: string): void {
  currentTick?.activitySessions.add(sessionId);
}

export function recordWalCheckpointCompleted(
  db: Database,
  result: { busy: number; log: number; checkpointed: number },
): void {
  lastWalCheckpointCompletedAtMs = Date.now();
  lastWalCheckpointResult = result;
  try {
    db.query(`
      INSERT INTO mem_meta(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(WAL_CHECKPOINT_META_KEY, JSON.stringify({
      completed_at_ms: lastWalCheckpointCompletedAtMs,
      busy: result.busy,
      log: result.log,
      checkpointed: result.checkpointed,
    }), new Date(lastWalCheckpointCompletedAtMs).toISOString());
  } catch {
    // Telemetry persistence must never affect checkpoint behavior.
  }
}

export function readProcessIoCounters(): { fsReadOps: number; majorPageFaults: number } {
  const usage = process.resourceUsage();
  return {
    fsReadOps: Number(usage.fsRead ?? 0),
    majorPageFaults: Number(usage.majorPageFault ?? 0),
  };
}

export function recordTransactionIoDelta(
  before: { fsReadOps: number; majorPageFaults: number },
  after: { fsReadOps: number; majorPageFaults: number },
): void {
  const context = currentTick;
  if (!context) return;
  context.transactionFsReadOps += Math.max(0, after.fsReadOps - before.fsReadOps);
  context.transactionMajorPageFaults += Math.max(0, after.majorPageFaults - before.majorPageFaults);
}

export function sqliteErrorCodes(error: unknown): { code: string | null; extendedCode: number | null; busyOrLocked: boolean } {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : null;
  const extendedCode = typeof candidate?.errno === "number" ? candidate.errno : null;
  const normalized = (code ?? "").toUpperCase();
  return {
    code,
    extendedCode,
    busyOrLocked: normalized.includes("BUSY") || normalized.includes("LOCKED") || extendedCode === 5 || extendedCode === 6,
  };
}

export function recordSqliteError(error: unknown, failedElapsedMs = 0): void {
  const context = currentTick;
  const codes = sqliteErrorCodes(error);
  if (!codes.code?.startsWith("SQLITE_")) return;
  if (context) {
    if (context.sqliteLastError !== error) {
      if (codes.code.startsWith("SQLITE_BUSY")) context.sqliteBusyCount += 1;
      if (codes.code.startsWith("SQLITE_LOCKED")) context.sqliteLockedCount += 1;
      context.sqliteLastError = error;
    }
    if (codes.busyOrLocked) {
      context.sqliteBusyFailureElapsedMs = Math.max(context.sqliteBusyFailureElapsedMs, failedElapsedMs);
    }
    context.sqliteLastCode = codes.code;
    context.sqliteLastExtendedCode = codes.extendedCode;
    return;
  }
  console.warn(`[sqlite-perf] ${JSON.stringify({
    kind: "sqlite_error",
    tick_available: false,
    code: codes.code,
    extended_code: codes.extendedCode,
    busy_or_locked: codes.busyOrLocked,
  })}`);
}

export function endIngestTickTelemetry(
  context: IngestTickTelemetryContext,
  db: Database,
  elapsedMs: number,
  slowThresholdMs: number,
): void {
  if (currentTick === context) currentTick = null;
  if (elapsedMs < slowThresholdMs && context.sqliteBusyCount === 0 && context.sqliteLockedCount === 0) return;

  const phases = Object.fromEntries(
    [...context.phases.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => [label, {
        count: value.count,
        total_ms: Number(value.totalMs.toFixed(3)),
        max_ms: Number(value.maxMs.toFixed(3)),
      }]),
  );
  const now = Date.now();
  const durableCheckpoint = readDurableWalCheckpoint(db);
  const checkpointCompletedAtMs = durableCheckpoint?.completedAtMs ?? lastWalCheckpointCompletedAtMs;
  const checkpointResult = durableCheckpoint?.result ?? lastWalCheckpointResult;
  const walSize = walBytes(db);
  console.warn(`[sqlite-perf] ${JSON.stringify({
    kind: "slow_ingest_tick",
    tick_available: true,
    tick_started_at: context.startedAt,
    source: context.source,
    elapsed_ms: elapsedMs,
    event_count: context.eventCount,
    distinct_session_count: context.ensuredSessions.size,
    phases,
    wal_size_available: walSize !== null,
    ...(walSize !== null ? { wal_bytes: walSize } : {}),
    wal_checkpoint_available: checkpointResult !== null,
    wal_checkpoint_age_available: checkpointCompletedAtMs !== null,
    ...(checkpointCompletedAtMs !== null ? { wal_checkpoint_age_ms: Math.max(0, now - checkpointCompletedAtMs) } : {}),
    ...(checkpointResult !== null ? { wal_checkpoint: checkpointResult } : {}),
    os_fs_read_ops: Math.max(0, readFsOperations() - context.fsReadStart),
    os_major_page_faults: Math.max(0, Number(process.resourceUsage().majorPageFault ?? 0) - context.majorPageFaultStart),
    transaction_fs_read_ops: context.transactionFsReadOps,
    transaction_major_page_faults: context.transactionMajorPageFaults,
    io_counter_scope: "process_delta_not_bytes",
    successful_lock_wait_available: false,
    sqlite_db_read_latency_available: false,
    lock_observation_scope: "failed_busy_or_locked_only",
    sqlite_busy_count: context.sqliteBusyCount,
    sqlite_locked_count: context.sqliteLockedCount,
    sqlite_busy_failure_elapsed_ms: Number(context.sqliteBusyFailureElapsedMs.toFixed(3)),
    sqlite_last_code: context.sqliteLastCode,
    sqlite_last_extended_code: context.sqliteLastExtendedCode,
  })}`);
}
