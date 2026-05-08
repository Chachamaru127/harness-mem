/**
 * reindex-vectors-scheduler.ts
 *
 * S89-003: Daemon-side scheduler that periodically calls reindexVectors()
 * with bounded batch size until vector_coverage reaches the target (default
 * 0.95). Lets fresh installs and post-migration deployments converge to
 * full coverage in the background instead of requiring manual
 * /v1/admin/reindex-vectors calls.
 *
 * Design decisions:
 * - opt-in: enabled only when config.reindexVectorsEnabled === true (default false)
 * - setInterval-based loop inside the daemon process (no external cron dependency)
 * - per-tick cap: limited by config.reindexVectorsBatchSize (default 100)
 * - converged auto-stop: once a tick reports migration_complete=true and
 *   vector_coverage >= targetCoverage, the scheduler logs and remains
 *   idle (still ticking but each tick exits cheaply)
 * - errors are logged and swallowed; the loop itself never stops on a single failure
 *
 * 24h convergence math (defaults):
 *   intervalMs=600_000 (10 min) × batchSize=100 → 14_400 obs/24h
 *   covers any installation up to ~14k observations within 24h of daemon start.
 *   For larger installs, raise HARNESS_MEM_REINDEX_VECTORS_BATCH_SIZE.
 */

import type { Database } from "bun:sqlite";
import type { ApiResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReindexVectorsSchedulerDeps {
  /** SQLite database (read-only here; writes happen inside reindexVectors) */
  db: Database;
  /**
   * Callback that performs one bounded reindex pass.
   * Mapped to HarnessMemCore.reindexVectors(limit) in production.
   */
  reindexVectors: (limit: number) => ApiResponse;
  /** Optional logger — defaults to console.* */
  logger?: SchedulerLogger;
}

export interface SchedulerLogger {
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
}

export interface ReindexVectorsSchedulerConfig {
  /** Enable the scheduler (default: false — opt-in) */
  enabled: boolean;
  /** Tick interval in milliseconds (default: 600_000 = 10 min) */
  intervalMs: number;
  /** Max observations reindexed per tick (default: 100) */
  batchSize: number;
  /** Coverage at which the scheduler stops doing work (default: 0.95) */
  targetCoverage: number;
}

export const DEFAULT_REINDEX_SCHEDULER_CONFIG: ReindexVectorsSchedulerConfig = {
  enabled: false,
  intervalMs: 600_000,
  batchSize: 100,
  targetCoverage: 0.95,
};

// ---------------------------------------------------------------------------
// ReindexVectorsScheduler
// ---------------------------------------------------------------------------

export class ReindexVectorsScheduler {
  private readonly config: ReindexVectorsSchedulerConfig;
  private readonly deps: ReindexVectorsSchedulerDeps;
  private readonly logger: SchedulerLogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private converged = false;
  private lastCoverage: number | null = null;
  private lastReindexed = 0;
  private totalReindexed = 0;
  private tickCount = 0;

  constructor(
    deps: ReindexVectorsSchedulerDeps,
    config: Partial<ReindexVectorsSchedulerConfig> = {}
  ) {
    this.deps = deps;
    this.config = { ...DEFAULT_REINDEX_SCHEDULER_CONFIG, ...config };
    this.logger = deps.logger ?? {
      warn: (msg, extra) => console.warn(`[reindex-vectors-scheduler] WARN: ${msg}`, extra ?? ""),
      error: (msg, extra) =>
        console.error(`[reindex-vectors-scheduler] ERROR: ${msg}`, extra ?? ""),
      info: (msg, extra) => console.info(`[reindex-vectors-scheduler] INFO: ${msg}`, extra ?? ""),
    };
  }

  start(): void {
    if (!this.config.enabled) {
      this.logger.info("scheduler disabled (reindex_vectors_enabled=false); not starting");
      return;
    }
    if (this.timer !== null) {
      this.logger.warn("start() called while scheduler is already running");
      return;
    }
    this.logger.info("starting scheduler", {
      intervalMs: this.config.intervalMs,
      batchSize: this.config.batchSize,
      targetCoverage: this.config.targetCoverage,
    });
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error("tick() threw unexpected error", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("scheduler stopped", {
        ticks: this.tickCount,
        total_reindexed: this.totalReindexed,
        last_coverage: this.lastCoverage,
        converged: this.converged,
      });
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Test / health helper — current state snapshot. */
  status(): {
    running: boolean;
    converged: boolean;
    last_coverage: number | null;
    last_reindexed: number;
    total_reindexed: number;
    ticks: number;
  } {
    return {
      running: this.isRunning(),
      converged: this.converged,
      last_coverage: this.lastCoverage,
      last_reindexed: this.lastReindexed,
      total_reindexed: this.totalReindexed,
      ticks: this.tickCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Tick — exported for testing
  // ---------------------------------------------------------------------------

  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn("tick() skipped — previous tick is still in progress");
      return;
    }
    this.running = true;
    this.tickCount += 1;
    try {
      // Cheap exit: when coverage already converged, just touch a count and bail.
      // We still call reindexVectors with a tiny limit to refresh metrics in
      // case new observations were ingested since convergence.
      const limit = this.converged ? 1 : this.config.batchSize;
      const response = this.deps.reindexVectors(limit);
      const item = (Array.isArray(response.items) && response.items[0]) as
        | { reindexed?: number; vector_coverage?: number; missing_vectors_remaining?: number; legacy_vectors_remaining?: number }
        | undefined;
      const reindexed = Number(item?.reindexed ?? 0);
      const coverage = typeof item?.vector_coverage === "number" ? item.vector_coverage : null;
      const missingRemaining = Number(item?.missing_vectors_remaining ?? 0);
      const legacyRemaining = Number(item?.legacy_vectors_remaining ?? 0);

      this.lastReindexed = reindexed;
      this.totalReindexed += reindexed;
      if (coverage !== null) {
        this.lastCoverage = coverage;
      }

      const justConverged =
        coverage !== null &&
        coverage >= this.config.targetCoverage &&
        missingRemaining === 0 &&
        legacyRemaining === 0;

      if (justConverged && !this.converged) {
        this.converged = true;
        this.logger.info("converged — vector coverage target reached", {
          coverage,
          target: this.config.targetCoverage,
          total_reindexed: this.totalReindexed,
          ticks: this.tickCount,
        });
      } else if (!justConverged && this.converged) {
        // New observations dropped coverage below target — re-enter active mode.
        this.converged = false;
        this.logger.info("re-entering active mode — coverage dropped below target", {
          coverage,
          missingRemaining,
          legacyRemaining,
        });
      } else if (reindexed > 0) {
        this.logger.info("tick: reindexed batch", {
          reindexed,
          coverage,
          missingRemaining,
          legacyRemaining,
        });
      }
    } finally {
      this.running = false;
    }
  }
}

export function createReindexVectorsScheduler(
  deps: ReindexVectorsSchedulerDeps,
  config: Partial<ReindexVectorsSchedulerConfig> = {}
): ReindexVectorsScheduler {
  return new ReindexVectorsScheduler(deps, config);
}
