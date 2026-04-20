/**
 * partial-finalize-scheduler.ts
 *
 * §91-002 (XR-004): Daemon-side scheduler that periodically calls
 * finalizeSession({ partial: true }) on active sessions that have new
 * events since their last session_summary observation.
 *
 * Design decisions:
 * - opt-in: enabled only when config.partialFinalizeEnabled === true (default false)
 * - setInterval-based loop inside the daemon process (no external cron dependency)
 * - CPU guard: max 5 sessions per tick, sequential (concurrency = 1)
 * - per-session timeout: 30 s (via Promise.race + timer)
 * - errors are logged and swallowed; the loop itself never stops on a single failure
 */

import type { Database } from "bun:sqlite";
import type { FinalizeSessionRequest } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PartialFinalizeSchedulerDeps {
  /** SQLite database (read-only queries, no mutations here) */
  db: Database;
  /**
   * Callback that executes the actual partial finalize.
   * Mapped to SessionManager.finalizeSession in production.
   */
  finalizeSession: (request: FinalizeSessionRequest) => unknown;
  /** Optional logger — defaults to console.error / console.warn */
  logger?: SchedulerLogger;
}

export interface SchedulerLogger {
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
}

export interface PartialFinalizeSchedulerConfig {
  /** Enable the scheduler (default: false — opt-in) */
  enabled: boolean;
  /** Tick interval in milliseconds (default: 300_000 = 5 min) */
  intervalMs: number;
  /** Max sessions processed per tick (default: 5) */
  maxSessionsPerTick: number;
  /** Per-session timeout in milliseconds (default: 30_000) */
  sessionTimeoutMs: number;
}

export interface ActiveSessionCandidate {
  session_id: string;
  platform: string;
  project: string;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_SCHEDULER_CONFIG: PartialFinalizeSchedulerConfig = {
  enabled: false,
  intervalMs: 300_000,
  maxSessionsPerTick: 5,
  sessionTimeoutMs: 30_000,
};

// ---------------------------------------------------------------------------
// PartialFinalizeScheduler
// ---------------------------------------------------------------------------

export class PartialFinalizeScheduler {
  private readonly config: PartialFinalizeSchedulerConfig;
  private readonly deps: PartialFinalizeSchedulerDeps;
  private readonly logger: SchedulerLogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    deps: PartialFinalizeSchedulerDeps,
    config: Partial<PartialFinalizeSchedulerConfig> = {}
  ) {
    this.deps = deps;
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.logger = deps.logger ?? {
      warn: (msg, extra) => console.warn(`[partial-finalize-scheduler] WARN: ${msg}`, extra ?? ""),
      error: (msg, extra) =>
        console.error(`[partial-finalize-scheduler] ERROR: ${msg}`, extra ?? ""),
      info: (msg, extra) => console.info(`[partial-finalize-scheduler] INFO: ${msg}`, extra ?? ""),
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  start(): void {
    if (!this.config.enabled) {
      this.logger.info("scheduler disabled (partial_finalize_enabled=false); not starting");
      return;
    }
    if (this.timer !== null) {
      this.logger.warn("start() called while scheduler is already running");
      return;
    }
    this.logger.info("starting scheduler", { intervalMs: this.config.intervalMs });
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
      this.logger.info("scheduler stopped");
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
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
    try {
      const candidates = this.queryActiveSessions();
      if (candidates.length === 0) {
        return;
      }
      this.logger.info(`tick: ${candidates.length} session(s) to partial-finalize`);
      for (const session of candidates) {
        await this.processSession(session);
      }
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Query active sessions that have new events since their last session_summary.
   *
   * A session is a candidate when:
   *   ended_at IS NULL                         → still active
   *   AND MAX(all observations.created_at)     → latest event
   *       > MAX(session_end observations.created_at) OR no session_end yet
   */
  queryActiveSessions(): ActiveSessionCandidate[] {
    const sql = `
      SELECT
        s.session_id,
        s.platform,
        s.project,
        MAX(o.created_at) AS latest_event_at,
        (
          SELECT MAX(o2.created_at)
          FROM mem_observations o2
          JOIN mem_events e2 ON e2.event_id = o2.event_id
          WHERE o2.session_id = s.session_id
            AND e2.event_type = 'session_end'
            AND o2.archived_at IS NULL
        ) AS latest_summary_at
      FROM mem_sessions s
      JOIN mem_observations o ON o.session_id = s.session_id
      WHERE s.ended_at IS NULL
        AND o.archived_at IS NULL
      GROUP BY s.session_id, s.platform, s.project
      HAVING latest_event_at > COALESCE(latest_summary_at, '')
      ORDER BY latest_event_at DESC
      LIMIT ?
    `;
    const rows = this.deps.db.query(sql).all(this.config.maxSessionsPerTick) as Array<{
      session_id: string;
      platform: string;
      project: string;
      latest_event_at: string;
      latest_summary_at: string | null;
    }>;
    return rows.map((r) => ({
      session_id: r.session_id,
      platform: r.platform,
      project: r.project,
    }));
  }

  private async processSession(session: ActiveSessionCandidate): Promise<void> {
    const { session_id, platform, project } = session;
    try {
      const result = await this.withTimeout(
        Promise.resolve(
          this.deps.finalizeSession({ session_id, platform, project, partial: true })
        ),
        this.config.sessionTimeoutMs,
        `partial finalize timed out for session ${session_id}`
      );
      this.logger.info("partial finalize completed", { session_id, result: "ok" });
      void result; // suppress unused-variable lint
    } catch (err) {
      this.logger.error("partial finalize failed — continuing", {
        session_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Factory helper (used by harness-mem-core)
// ---------------------------------------------------------------------------

export function createPartialFinalizeScheduler(
  deps: PartialFinalizeSchedulerDeps,
  config: Partial<PartialFinalizeSchedulerConfig>
): PartialFinalizeScheduler {
  return new PartialFinalizeScheduler(deps, config);
}
