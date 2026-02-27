/**
 * config-manager.ts
 *
 * 設定管理モジュール。
 * HarnessMemCore から分割された設定・診断・管理責務を担う。
 *
 * 担当 API:
 *   - health (委譲)
 *   - metrics (委譲)
 *   - environmentSnapshot (委譲)
 *   - getConsolidationStatus
 *   - getAuditLog
 *   - projectsStats
 *   - backup (委譲)
 *   - reindexVectors (委譲)
 *   - getManagedStatus (委譲)
 *   - runConsolidation (委譲)
 *   - shutdown (委譲)
 */

import type { Database } from "bun:sqlite";
import type { ManagedBackendStatus } from "../projector/managed-backend";
import type {
  ApiResponse,
  AuditLogRequest,
  Config,
  ConsolidationRunRequest,
  ProjectsStatsRequest,
} from "./harness-mem-core";

// ---------------------------------------------------------------------------
// ConfigManagerDeps: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface ConfigManagerDeps {
  db: Database;
  config: Config;
  /** health() の実装委譲 */
  doHealth: () => ApiResponse;
  /** metrics() の実装委譲 */
  doMetrics: () => ApiResponse;
  /** environmentSnapshot() の実装委譲 */
  doEnvironmentSnapshot: () => ApiResponse;
  /** runConsolidation() の実装委譲 */
  doRunConsolidation: (request: ConsolidationRunRequest) => Promise<ApiResponse>;
  /** backup() の実装委譲 */
  doBackup: (options?: { destDir?: string }) => ApiResponse;
  /** reindexVectors() の実装委譲 */
  doReindexVectors: (limitInput?: number) => ApiResponse;
  /** getManagedStatus() の実装委譲 */
  doGetManagedStatus: () => ManagedBackendStatus | null;
  /** shutdown() の実装委譲 */
  doShutdown: (signal: string) => void;
  /** isConsolidationEnabled のバインド済みバージョン */
  isConsolidationEnabled: () => boolean;
  /** getConsolidationIntervalMs のバインド済みバージョン */
  getConsolidationIntervalMs: () => number;
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

function clampLimit(input: unknown, fallback: number, min = 1, max = 500): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function makeResponse(
  startedAt: number,
  items: unknown[],
  filters: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): ApiResponse {
  const latency = performance.now() - startedAt;
  return {
    ok: true,
    source: "core",
    items,
    meta: {
      count: items.length,
      latency_ms: Math.round(latency * 100) / 100,
      sla_latency_ms: 200,
      filters,
      ranking: "default",
      ...extra,
    },
  };
}

function shouldExposeProjectInStats(project: string): boolean {
  const normalized = project.trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (lower === "unknown") return false;
  const withoutLeadingSlash = lower.startsWith("/") ? lower.slice(1) : lower;
  if (withoutLeadingSlash.startsWith("shadow-")) return false;
  if (normalized.startsWith("/")) {
    const segments = normalized.split("/").filter(Boolean);
    for (const segment of segments) {
      if (segment.startsWith(".")) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// ConfigManager クラス
// ---------------------------------------------------------------------------

export class ConfigManager {
  constructor(private readonly deps: ConfigManagerDeps) {}

  // ---------------------------------------------------------------------------
  // 委譲メソッド
  // ---------------------------------------------------------------------------

  health(): ApiResponse {
    return this.deps.doHealth();
  }

  metrics(): ApiResponse {
    return this.deps.doMetrics();
  }

  environmentSnapshot(): ApiResponse {
    return this.deps.doEnvironmentSnapshot();
  }

  async runConsolidation(request: ConsolidationRunRequest = {}): Promise<ApiResponse> {
    return this.deps.doRunConsolidation(request);
  }

  backup(options?: { destDir?: string }): ApiResponse {
    return this.deps.doBackup(options);
  }

  reindexVectors(limitInput?: number): ApiResponse {
    return this.deps.doReindexVectors(limitInput);
  }

  getManagedStatus(): ManagedBackendStatus | null {
    return this.deps.doGetManagedStatus();
  }

  shutdown(signal: string): void {
    return this.deps.doShutdown(signal);
  }

  // ---------------------------------------------------------------------------
  // getConsolidationStatus
  // ---------------------------------------------------------------------------

  getConsolidationStatus(): ApiResponse {
    const startedAt = performance.now();
    const queue = this.deps.db
      .query(
        `
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_jobs,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_jobs,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_jobs
        FROM mem_consolidation_queue
      `
      )
      .get() as
      | {
          pending_jobs?: number;
          running_jobs?: number;
          failed_jobs?: number;
          completed_jobs?: number;
        }
      | null;

    const facts = this.deps.db
      .query(
        `
        SELECT
          COUNT(*) AS facts_total,
          SUM(CASE WHEN merged_into_fact_id IS NULL THEN 0 ELSE 1 END) AS facts_merged
        FROM mem_facts
        WHERE valid_to IS NULL
      `
      )
      .get() as { facts_total?: number; facts_merged?: number } | null;

    return makeResponse(
      startedAt,
      [
        {
          pending_jobs: Number(queue?.pending_jobs ?? 0),
          running_jobs: Number(queue?.running_jobs ?? 0),
          failed_jobs: Number(queue?.failed_jobs ?? 0),
          completed_jobs: Number(queue?.completed_jobs ?? 0),
          facts_total: Number(facts?.facts_total ?? 0),
          facts_merged: Number(facts?.facts_merged ?? 0),
          enabled: this.deps.isConsolidationEnabled(),
          interval_ms: this.deps.getConsolidationIntervalMs(),
        },
      ],
      {},
      { ranking: "consolidation_status_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // getAuditLog
  // ---------------------------------------------------------------------------

  getAuditLog(request: AuditLogRequest = {}): ApiResponse {
    const startedAt = performance.now();
    const limit = clampLimit(request.limit, 50, 1, 500);
    const params: unknown[] = [];

    let sql = `
      SELECT id, action, actor, target_type, target_id, details_json, created_at
      FROM mem_audit_log
      WHERE 1 = 1
    `;

    if (request.action) {
      sql += " AND action = ?";
      params.push(request.action);
    }

    if (request.target_type) {
      sql += " AND target_type = ?";
      params.push(request.target_type);
    }

    sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
    params.push(limit);

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;

    const items = rows.map((row) => {
      let details: Record<string, unknown> = {};
      try {
        if (typeof row.details_json === "string") {
          details = JSON.parse(row.details_json) as Record<string, unknown>;
        }
      } catch {
        // ignore
      }
      return {
        id: row.id,
        action: row.action,
        actor: row.actor,
        target_type: row.target_type,
        target_id: row.target_id,
        details,
        created_at: row.created_at,
      };
    });

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "audit_log_v1",
    });
  }

  // ---------------------------------------------------------------------------
  // projectsStats
  // ---------------------------------------------------------------------------

  projectsStats(request: ProjectsStatsRequest = {}): ApiResponse {
    const startedAt = performance.now();
    const includePrivate = Boolean(request.include_private);

    const privacyFilter = includePrivate
      ? ""
      : `
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(
            CASE
              WHEN json_valid(COALESCE(o.privacy_tags_json, '[]')) THEN COALESCE(o.privacy_tags_json, '[]')
              ELSE '["private"]'
            END
          ) AS jt
          WHERE lower(CAST(jt.value AS TEXT)) IN ('private', 'sensitive')
        )
      `;

    const rows = this.deps.db
      .query(
        `
        SELECT
          o.project,
          COUNT(DISTINCT o.session_id) AS sessions,
          COUNT(o.id) AS observations,
          MIN(o.created_at) AS first_seen,
          MAX(o.created_at) AS last_seen,
          GROUP_CONCAT(DISTINCT o.platform) AS platforms_csv
        FROM mem_observations o
        WHERE 1 = 1
        ${privacyFilter}
        GROUP BY o.project
        ORDER BY MAX(o.created_at) DESC
        LIMIT 100
      `
      )
      .all() as Array<{
      project: string;
      sessions: number;
      observations: number;
      first_seen: string;
      last_seen: string;
      platforms_csv: string | null;
    }>;

    const items = rows
      .filter((row) => shouldExposeProjectInStats(row.project))
      .map((row) => ({
        project: row.project,
        sessions: Number(row.sessions || 0),
        observations: Number(row.observations || 0),
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        platforms: row.platforms_csv ? row.platforms_csv.split(",").filter(Boolean) : [],
      }));

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "projects_stats_v1",
    });
  }
}
