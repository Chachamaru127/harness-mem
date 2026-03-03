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
 *   - backup (実装)
 *   - reindexVectors (実装)
 *   - getManagedStatus (委譲)
 *   - runConsolidation (委譲)
 *   - shutdown (委譲)
 */

import { dirname, join } from "node:path";
import { statSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { ManagedBackendStatus } from "../projector/managed-backend";
import type {
  ApiResponse,
  AuditLogRequest,
  Config,
  ConsolidationRunRequest,
  ProjectsStatsRequest,
} from "./types.js";
export type { Config, ApiResponse } from "./types.js";
export { getConfig } from "./core-utils.js";
import {
  clampLimit,
  ensureDir,
  makeErrorResponse,
  makeResponse,
  nowIso,
  parseJsonSafe,
  resolveHomePath,
  visibilityFilterSql as visibilityFilterSqlUtil,
} from "./core-utils.js";

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
  /** getManagedStatus() の実装委譲 */
  doGetManagedStatus: () => ManagedBackendStatus | null;
  /** shutdown() の実装委譲 */
  doShutdown: (signal: string) => void;
  /** isConsolidationEnabled のバインド済みバージョン */
  isConsolidationEnabled: () => boolean;
  /** getConsolidationIntervalMs のバインド済みバージョン */
  getConsolidationIntervalMs: () => number;
  /** 監査ログ書き込み */
  writeAuditLog: (action: string, targetType: string, targetId: string, details?: Record<string, unknown>) => void;
  /** ベクトルエンジン ("disabled" | "sqlite-vec" など) — 呼び出し時に現在値を取得 */
  getVectorEngine: () => string;
  /** 現在のベクトルモデルバージョン — 呼び出し時に現在値を取得 */
  getVectorModelVersion: () => string;
  /** 埋め込みプロバイダー名 */
  embeddingProviderName: string;
  /** 埋め込みヘルスステータス（呼び出し時に現在値を取得） */
  getEmbeddingHealthStatus: () => string;
  /** 観察ベクトルを再インデックスするコールバック */
  reindexObservationVector: (id: string, content: string, createdAt: string) => void;
  /** Antigravity ingest が有効か（platformVisibilityFilterSql 用） */
  isAntigravityIngestEnabled: () => boolean;
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

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

  getManagedStatus(): ManagedBackendStatus | null {
    return this.deps.doGetManagedStatus();
  }

  shutdown(signal: string): void {
    return this.deps.doShutdown(signal);
  }

  // ---------------------------------------------------------------------------
  // backup
  // ---------------------------------------------------------------------------

  backup(options?: { destDir?: string }): ApiResponse {
    if (!this.deps.db) {
      throw new Error("Backup is only supported in local (SQLite) mode");
    }
    const startedAt = performance.now();
    const resolvedDbPath = resolveHomePath(this.deps.config.dbPath);
    const defaultDestDir = dirname(resolvedDbPath);
    const destDir = options?.destDir ? resolveHomePath(options.destDir) : defaultDestDir;

    ensureDir(destDir);

    // ISO timestamp: 2026-02-26T12-34-56-789Z (colons replaced for filesystem compat)
    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
    const filename = `harness-mem-backup-${ts}.db`;
    const destPath = join(destDir, filename);

    try {
      this.deps.db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeErrorResponse(startedAt, `backup failed: ${message}`, {});
    }

    let size = 0;
    try {
      size = statSync(destPath).size;
    } catch {
      // best effort
    }

    this.deps.writeAuditLog("admin.backup", "backup", destPath, { size_bytes: size });

    return makeResponse(
      startedAt,
      [{ path: destPath, size_bytes: size }],
      {},
      { backup_path: destPath, size_bytes: size }
    );
  }

  // ---------------------------------------------------------------------------
  // reindexVectors
  // ---------------------------------------------------------------------------

  reindexVectors(limitInput?: number): ApiResponse {
    const startedAt = performance.now();
    if (this.deps.getVectorEngine() === "disabled") {
      return makeResponse(startedAt, [], {}, { reindexed: 0, skipped: "vector_disabled" });
    }

    const limit = clampLimit(limitInput, 100, 1, 10000);

    // Prioritize observations whose vectors are on a legacy model (not the current one).
    // This enables incremental, no-downtime migration: each call processes a batch of
    // stale vectors first, then falls back to all observations if none are stale.
    // Searches continue to serve results from the legacy model during migration.
    const legacyRows = this.deps.db
      .query(`
        SELECT o.id, o.content_redacted, o.created_at
        FROM mem_observations o
        JOIN mem_vectors v ON v.observation_id = o.id
        WHERE v.model != ?
        ORDER BY o.created_at DESC
        LIMIT ?
      `)
      .all(this.deps.getVectorModelVersion(), limit) as Array<{ id: string; content_redacted: string; created_at: string }>;

    const rows: Array<{ id: string; content_redacted: string; created_at: string }> = legacyRows.length > 0
      ? legacyRows
      : (this.deps.db
          .query(`
            SELECT id, content_redacted, created_at
            FROM mem_observations
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(limit) as Array<{ id: string; content_redacted: string; created_at: string }>);

    // Count total legacy vectors before reindexing for progress reporting
    const beforeCounts = this.deps.db
      .query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN model = ? THEN 1 ELSE 0 END) AS current_count
         FROM mem_vectors`
      )
      .get(this.deps.getVectorModelVersion()) as { total: number; current_count: number } | null;
    const totalBefore = Number(beforeCounts?.total ?? 0);
    const currentBefore = Number(beforeCounts?.current_count ?? 0);

    let reindexed = 0;
    for (const row of rows) {
      this.deps.reindexObservationVector(row.id, row.content_redacted || "", row.created_at || nowIso());
      reindexed += 1;
    }

    const currentAfter = currentBefore + reindexed;
    const remaining = Math.max(0, totalBefore - currentAfter);
    const pct = totalBefore === 0 ? 100 : Math.round((currentAfter / totalBefore) * 100);

    return makeResponse(
      startedAt,
      [
        {
          reindexed,
          limit,
          total_vectors: totalBefore,
          current_model_vectors: currentAfter,
          legacy_vectors_remaining: remaining,
          progress_pct: pct,
        },
      ],
      { limit },
      {
        vector_engine: this.deps.getVectorEngine(),
        embedding_provider: this.deps.embeddingProviderName,
        embedding_provider_model: this.deps.getVectorModelVersion(),
        embedding_provider_status: this.deps.getEmbeddingHealthStatus(),
        migration_complete: remaining === 0,
      }
    );
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

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<{
      id: number;
      action: string;
      actor: string;
      target_type: string;
      target_id: string;
      details_json: string;
      created_at: string;
    }>;

    const items = rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.actor,
      target_type: row.target_type,
      target_id: row.target_id,
      details: parseJsonSafe(row.details_json),
      created_at: row.created_at,
    }));

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
    const visibility = visibilityFilterSqlUtil("o", includePrivate);
    const platformVisibility = this.deps.isAntigravityIngestEnabled()
      ? ""
      : ` AND o.platform <> 'antigravity' `;

    const rows = this.deps.db
      .query(`
        SELECT
          o.project AS project,
          COUNT(*) AS observations,
          COUNT(DISTINCT o.session_id) AS sessions,
          MAX(o.created_at) AS updated_at
        FROM mem_observations o
        WHERE 1 = 1
        ${platformVisibility}
        ${visibility}
        GROUP BY o.project
        ORDER BY updated_at DESC
      `)
      .all() as Array<{ project: string; observations: number; sessions: number; updated_at: string | null }>;

    const items = rows
      .map((row) => ({
        project: row.project,
        observations: Number(row.observations || 0),
        sessions: Number(row.sessions || 0),
        updated_at: row.updated_at || null,
      }))
      .filter((row) => shouldExposeProjectInStats(row.project));

    return makeResponse(startedAt, items, { include_private: includePrivate }, { ranking: "projects_stats_v1" });
  }
}
