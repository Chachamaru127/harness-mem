/**
 * vector-backfill-worker.ts
 *
 * S124-007: on-demand worker for sqlite-vec compact rebuild + vector
 * reindex/backfill. Admin HTTP handlers only start/stop/read this worker; they
 * do not run long loops in the request path.
 */

import type { Database } from "bun:sqlite";
import { getSqliteVecMapTableName } from "../vector/providers";
import { clampLimit, makeResponse, nowIso } from "./core-utils";
import type { ApiResponse } from "./types";

export interface VectorBackfillWorkerDeps {
  db: Database;
  getVectorModelVersion: () => string;
  getVectorDimension: () => number;
  repairSqliteVecMap: (options: {
    model?: string;
    dimension?: number;
    limit?: number;
    execute?: boolean;
    rebuild_existing?: boolean;
    rebuild_before?: string;
  }) => ApiResponse;
  reindexVectors: (
    limit?: number,
    options?: { status_counts?: boolean },
  ) => ApiResponse | Promise<ApiResponse>;
  runExternalOperation?: (operation: VectorBackfillOperation) => Promise<ApiResponse>;
  writeAuditLog?: (
    action: string,
    targetType: string,
    targetId: string,
    details?: Record<string, unknown>,
  ) => void;
  logger?: VectorBackfillWorkerLogger;
}

export type VectorBackfillOperation =
  | {
      type: "compact";
      model: string;
      dimension: number;
      limit: number;
      rebuild_before?: string;
    }
  | {
      type: "reindex";
      limit: number;
      status_counts?: boolean;
    };

export interface VectorBackfillWorkerLogger {
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
}

export interface VectorBackfillStartOptions {
  model?: string;
  dimension?: number;
  compact_batch_size?: number;
  reindex_batch_size?: number;
  interval_ms?: number;
  target_coverage?: number;
  reset?: boolean;
}

export interface VectorBackfillWorkerStatus {
  status: "idle" | "running" | "stopping" | "stopped" | "completed" | "failed";
  running: boolean;
  job_id: string | null;
  model: string | null;
  dimension: number | null;
  compact_started_at: string | null;
  compact_remaining: number | null;
  compact_total_repaired: number;
  reindex_processed: number;
  reindex_total: number;
  reindex_current_model_vectors: number;
  reindex_missing_vectors_remaining: number;
  reindex_legacy_vectors_remaining: number;
  reindex_coverage: number | null;
  target_coverage: number;
  next_phase: "compact" | "reindex";
  ticks: number;
  last_tick_started_at: string | null;
  last_tick_finished_at: string | null;
  last_tick_latency_ms: number | null;
  last_error: string | null;
  stop_requested: boolean;
  interval_ms: number;
  compact_batch_size: number;
  reindex_batch_size: number;
}

export interface VectorBackfillWorkerConfig {
  compactBatchSize: number;
  reindexBatchSize: number;
  intervalMs: number;
  targetCoverage: number;
  autoSchedule: boolean;
}

const STATE_TABLE = "mem_vector_backfill_worker_state";
const STATE_KEY = "default";

export const DEFAULT_VECTOR_BACKFILL_WORKER_CONFIG: VectorBackfillWorkerConfig = {
  compactBatchSize: 25,
  reindexBatchSize: 5,
  intervalMs: 1000,
  targetCoverage: 0.95,
  autoSchedule: true,
};

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultStatus(config: VectorBackfillWorkerConfig): VectorBackfillWorkerStatus {
  return {
    status: "idle",
    running: false,
    job_id: null,
    model: null,
    dimension: null,
    compact_started_at: null,
    compact_remaining: null,
    compact_total_repaired: 0,
    reindex_processed: 0,
    reindex_total: 0,
    reindex_current_model_vectors: 0,
    reindex_missing_vectors_remaining: 0,
    reindex_legacy_vectors_remaining: 0,
    reindex_coverage: null,
    target_coverage: config.targetCoverage,
    next_phase: "compact",
    ticks: 0,
    last_tick_started_at: null,
    last_tick_finished_at: null,
    last_tick_latency_ms: null,
    last_error: null,
    stop_requested: false,
    interval_ms: config.intervalMs,
    compact_batch_size: config.compactBatchSize,
    reindex_batch_size: config.reindexBatchSize,
  };
}

function sqliteTableExists(db: Database, tableName: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | null;
  return typeof row?.name === "string";
}

function responseItem(response: ApiResponse): Record<string, unknown> {
  return (Array.isArray(response.items) && response.items[0]
    ? response.items[0]
    : {}) as Record<string, unknown>;
}

function numberFrom(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampCoverage(input: unknown, fallback: number): number {
  const value = numberFrom(input, fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0.0001, Math.min(1, value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeWorkerResponse(
  startedAt: number,
  status: VectorBackfillWorkerStatus,
  extraMeta: Record<string, unknown> = {},
): ApiResponse {
  return makeResponse(
    startedAt,
    [jsonClone(status) as unknown as Record<string, unknown>],
    {},
    {
      vector_backfill_worker: jsonClone(status),
      ...extraMeta,
    },
  );
}

export class VectorBackfillWorker {
  private readonly deps: VectorBackfillWorkerDeps;
  private readonly config: VectorBackfillWorkerConfig;
  private readonly logger: VectorBackfillWorkerLogger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;

  constructor(
    deps: VectorBackfillWorkerDeps,
    config: Partial<VectorBackfillWorkerConfig> = {},
  ) {
    this.deps = deps;
    this.config = { ...DEFAULT_VECTOR_BACKFILL_WORKER_CONFIG, ...config };
    this.logger = deps.logger ?? {
      warn: (msg, extra) => console.warn(`[vector-backfill-worker] WARN: ${msg}`, extra ?? ""),
      error: (msg, extra) => console.error(`[vector-backfill-worker] ERROR: ${msg}`, extra ?? ""),
      info: (msg, extra) => console.info(`[vector-backfill-worker] INFO: ${msg}`, extra ?? ""),
    };
    this.ensureStateTable();
  }

  start(options: VectorBackfillStartOptions = {}): ApiResponse {
    const startedAt = performance.now();
    const current = this.loadStatus();
    if (current.running && !options.reset) {
      if (this.timer === null && !this.ticking) {
        this.schedule(0);
      }
      return makeWorkerResponse(startedAt, current, { already_running: true });
    }
    if (options.reset) {
      this.clearTimer();
    }

    const model = typeof options.model === "string" && options.model.trim()
      ? options.model.trim()
      : current.model || this.deps.getVectorModelVersion();
    const dimension = clampLimit(options.dimension, current.dimension || this.deps.getVectorDimension(), 1, 8192);
    const compactBatchSize = clampLimit(options.compact_batch_size, this.config.compactBatchSize, 1, 1000);
    const reindexBatchSize = clampLimit(options.reindex_batch_size, this.config.reindexBatchSize, 1, 500);
    const intervalMs = clampLimit(options.interval_ms, this.config.intervalMs, 25, 60_000);
    const targetCoverage = clampCoverage(
      options.target_coverage,
      current.target_coverage || this.config.targetCoverage,
    );
    const compactStartedAt =
      !options.reset && current.compact_started_at ? current.compact_started_at : nowIso();
    const persistedCompactRemaining =
      typeof current.compact_remaining === "number" && Number.isFinite(current.compact_remaining)
        ? current.compact_remaining
        : null;
    const compactRemaining =
      options.reset || persistedCompactRemaining === null
        ? this.countCompactRemaining(model, dimension, compactStartedAt)
        : Math.max(0, persistedCompactRemaining);

    const status: VectorBackfillWorkerStatus = {
      ...defaultStatus(this.config),
      status: "running",
      running: true,
      job_id: !options.reset && current.job_id ? current.job_id : `vector-backfill-${Date.now()}`,
      model,
      dimension,
      compact_started_at: compactStartedAt,
      compact_remaining: compactRemaining,
      compact_total_repaired: options.reset ? 0 : current.compact_total_repaired,
      reindex_processed: options.reset ? 0 : current.reindex_processed,
      reindex_total: options.reset ? 0 : current.reindex_total,
      reindex_current_model_vectors: options.reset ? 0 : current.reindex_current_model_vectors,
      reindex_missing_vectors_remaining: options.reset ? 0 : current.reindex_missing_vectors_remaining,
      reindex_legacy_vectors_remaining: options.reset ? 0 : current.reindex_legacy_vectors_remaining,
      reindex_coverage: options.reset ? null : current.reindex_coverage,
      target_coverage: targetCoverage,
      next_phase: options.reset ? "compact" : current.next_phase || "compact",
      ticks: options.reset ? 0 : current.ticks,
      last_error: null,
      stop_requested: false,
      interval_ms: intervalMs,
      compact_batch_size: compactBatchSize,
      reindex_batch_size: reindexBatchSize,
    };
    this.saveStatus(status);
    this.deps.writeAuditLog?.("admin.vector_backfill.start", "vector_backfill", status.job_id || "unknown", {
      model,
      dimension,
      compact_batch_size: compactBatchSize,
      reindex_batch_size: reindexBatchSize,
      interval_ms: intervalMs,
      target_coverage: targetCoverage,
      reset: options.reset === true,
    });
    this.schedule(0);
    return makeWorkerResponse(startedAt, status);
  }

  stop(): ApiResponse {
    const startedAt = performance.now();
    const current = this.loadStatus();
    this.clearTimer();
    const status: VectorBackfillWorkerStatus = {
      ...current,
      status: current.status === "running" ? "stopped" : current.status,
      running: false,
      stop_requested: true,
      last_tick_finished_at: current.last_tick_finished_at || nowIso(),
    };
    this.saveStatus(status);
    this.deps.writeAuditLog?.("admin.vector_backfill.stop", "vector_backfill", status.job_id || "unknown", {
      status: status.status,
      ticks: status.ticks,
      compact_remaining: status.compact_remaining,
      reindex_coverage: status.reindex_coverage,
      reindex_total: status.reindex_total,
      reindex_processed: status.reindex_processed,
    });
    return makeWorkerResponse(startedAt, status);
  }

  status(): ApiResponse {
    const status = this.loadStatus();
    if (status.running && !status.stop_requested && this.timer === null && !this.ticking) {
      this.schedule(0);
    }
    return makeWorkerResponse(performance.now(), status);
  }

  isRunning(): boolean {
    return this.loadStatus().running;
  }

  async tick(): Promise<void> {
    if (this.ticking) {
      this.logger.warn("tick skipped because previous tick is still running");
      return;
    }
    this.ticking = true;
    const startedAtMs = performance.now();
    const tickStartedAt = nowIso();
    let status = this.loadStatus();
    try {
      if (!status.running || status.stop_requested) {
        return;
      }
      if (!status.model || !status.dimension || !status.compact_started_at) {
        throw new Error("worker status is missing model, dimension, or compact_started_at");
      }
      const model = status.model;
      const dimension = status.dimension;
      const compactStartedAt = status.compact_started_at;

      const compactRemainingBefore = Math.max(0, numberFrom(status.compact_remaining, 0));
      status = {
        ...status,
        ticks: status.ticks + 1,
        compact_remaining: compactRemainingBefore,
        last_tick_started_at: tickStartedAt,
        last_error: null,
      };

      const shouldCompact = compactRemainingBefore > 0;
      const shouldReindex =
        status.reindex_coverage === null || status.reindex_coverage < status.target_coverage;
      let compactRemainingAfter = compactRemainingBefore;
      const phase = shouldCompact ? "compact" : "reindex";

      if (phase === "compact" && shouldCompact) {
        const repairResponse = this.deps.runExternalOperation
          ? await this.deps.runExternalOperation({
              type: "compact",
              model,
              dimension,
              limit: status.compact_batch_size,
              rebuild_before: compactStartedAt,
            })
          : this.deps.repairSqliteVecMap({
              model,
              dimension,
              execute: true,
              rebuild_existing: true,
              rebuild_before: compactStartedAt,
              limit: status.compact_batch_size,
            });
        const item = responseItem(repairResponse);
        const repaired = numberFrom(item.repaired);
        status.compact_total_repaired += repaired;
        compactRemainingAfter = repaired > 0
          ? Math.max(0, compactRemainingBefore - repaired)
          : Math.min(
              compactRemainingBefore,
              this.countCompactRemaining(model, dimension, compactStartedAt),
            );
        status.compact_remaining = compactRemainingAfter;
        status.next_phase = compactRemainingAfter > 0 ? "compact" : shouldReindex ? "reindex" : "compact";
      } else if (shouldReindex) {
        const shouldRefreshReindexStatus =
          status.reindex_coverage === null ||
          status.reindex_total === 0 ||
          status.ticks % 25 === 0;
        const reindexResponse = this.deps.runExternalOperation
          ? await this.deps.runExternalOperation({
              type: "reindex",
              limit: status.reindex_batch_size,
              status_counts: shouldRefreshReindexStatus,
            })
          : await this.deps.reindexVectors(status.reindex_batch_size, {
              status_counts: shouldRefreshReindexStatus,
            });
        const item = responseItem(reindexResponse);
        const processed =
          numberFrom(item.reindexed) + numberFrom(item.adopted_legacy_vectors);
        status.reindex_processed += processed;
        status.reindex_total = numberFrom(item.total_observations, status.reindex_total);
        status.reindex_current_model_vectors = numberFrom(
          item.current_model_vectors,
          status.reindex_current_model_vectors > 0
            ? status.reindex_current_model_vectors + processed
            : status.reindex_current_model_vectors,
        );
        status.reindex_missing_vectors_remaining = numberFrom(
          item.missing_vectors_remaining,
          Math.max(0, status.reindex_missing_vectors_remaining - processed),
        );
        status.reindex_legacy_vectors_remaining = numberFrom(
          item.legacy_vectors_remaining,
          Math.max(0, status.reindex_legacy_vectors_remaining - processed),
        );
        const coverage = numberFrom(item.vector_coverage, NaN);
        if (Number.isFinite(coverage)) {
          status.reindex_coverage = coverage;
        }
        status.next_phase = "reindex";
      }

      compactRemainingAfter = Math.max(
        0,
        numberFrom(status.compact_remaining, compactRemainingAfter),
      );
      status.compact_remaining = compactRemainingAfter;
      const coverageDone =
        status.reindex_coverage !== null && status.reindex_coverage >= status.target_coverage;
      if (compactRemainingAfter === 0 && coverageDone) {
        status.status = "completed";
        status.running = false;
      }
    } catch (error) {
      status = {
        ...status,
        status: "failed",
        running: false,
        last_error: errorMessage(error),
      };
      this.logger.error("tick failed", { error: status.last_error ?? "unknown" });
    } finally {
      const latest = this.loadStatus();
      const stopRequested =
        latest.stop_requested === true || latest.status === "stopped" || latest.status === "stopping";
      if (stopRequested && status.status !== "failed") {
        status.status = "stopped";
        status.running = false;
        status.stop_requested = true;
      }
      status.last_tick_finished_at = nowIso();
      status.last_tick_latency_ms = Math.round(performance.now() - startedAtMs);
      this.saveStatus(status);
      this.ticking = false;
      if (status.running && !status.stop_requested) {
        this.schedule(status.interval_ms);
      } else {
        this.clearTimer();
      }
    }
  }

  private ensureStateTable(): void {
    this.deps.db.exec(`
      CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
        key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  private loadStatus(): VectorBackfillWorkerStatus {
    this.ensureStateTable();
    const row = this.deps.db
      .query(`SELECT state_json FROM ${STATE_TABLE} WHERE key = ?`)
      .get(STATE_KEY) as { state_json?: string } | null;
    if (!row?.state_json) {
      return defaultStatus(this.config);
    }
    try {
      return { ...defaultStatus(this.config), ...(JSON.parse(row.state_json) as Record<string, unknown>) };
    } catch {
      return defaultStatus(this.config);
    }
  }

  private saveStatus(status: VectorBackfillWorkerStatus): void {
    this.ensureStateTable();
    this.deps.db
      .query(`
        INSERT INTO ${STATE_TABLE}(key, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `)
      .run(STATE_KEY, JSON.stringify(status), nowIso());
  }

  private schedule(delayMs: number): void {
    if (!this.config.autoSchedule) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick().catch((error) => {
        const current = this.loadStatus();
        this.saveStatus({
          ...current,
          status: "failed",
          running: false,
          last_error: errorMessage(error),
          last_tick_finished_at: nowIso(),
        });
      });
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private countCompactRemaining(model: string, dimension: number, compactStartedAt: string): number {
    const mapTableName = getSqliteVecMapTableName(model);
    const vectorRow = this.deps.db
      .query(`
        SELECT COUNT(*) AS count
        FROM mem_vectors
        WHERE model = ?
          AND dimension = ?
      `)
      .get(model, dimension) as { count?: number } | null;
    const vectorCount = Number(vectorRow?.count ?? 0);
    if (vectorCount === 0) return 0;
    if (!sqliteTableExists(this.deps.db, mapTableName)) {
      return vectorCount;
    }
    const remainingRow = this.deps.db
      .query(`
        SELECT COUNT(*) AS count
        FROM mem_vectors v
        LEFT JOIN ${mapTableName} m
          ON m.observation_id = v.observation_id
        WHERE v.model = ?
          AND v.dimension = ?
          AND (
            m.observation_id IS NULL
            OR COALESCE(m.updated_at, '') < ?
          )
      `)
      .get(model, dimension, compactStartedAt) as { count?: number } | null;
    return Number(remainingRow?.count ?? vectorCount);
  }
}

export function createVectorBackfillWorker(
  deps: VectorBackfillWorkerDeps,
  config: Partial<VectorBackfillWorkerConfig> = {},
): VectorBackfillWorker {
  return new VectorBackfillWorker(deps, config);
}
