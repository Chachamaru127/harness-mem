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
  expiredFilterSql,
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
  /** raw project を UI 用 canonical 名へ変換 */
  canonicalizeProject: (project: string) => string;
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
      const model = this.deps.getVectorModelVersion();
      const now = nowIso();
      const activeFilter = `o.archived_at IS NULL${expiredFilterSql("o", now)}`;

      // Priority order:
      // 1. live observations with no vector for the current model,
      // 2. legacy-vector-only observations,
      // 3. a bounded refresh pass over live observations.
      // This makes coverage monotonically improve instead of reprocessing rows that
      // already have current vectors while old rows remain uncovered.
      const missingRows = this.deps.db
        .query(`
          SELECT o.id, o.content_redacted, o.created_at
          FROM mem_observations o
          LEFT JOIN mem_vectors v
            ON v.observation_id = o.id
          WHERE v.observation_id IS NULL
            AND ${activeFilter}
          ORDER BY o.created_at DESC
          LIMIT ?
        `)
        .all(limit) as Array<{ id: string; content_redacted: string; created_at: string }>;

      const legacyRows = this.deps.db
        .query(`
          SELECT o.id, o.content_redacted, o.created_at
          FROM mem_observations o
          WHERE ${activeFilter}
            AND EXISTS (
              SELECT 1 FROM mem_vectors v_any
              WHERE v_any.observation_id = o.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM mem_vectors v_current
              WHERE v_current.observation_id = o.id
                AND v_current.model = ?
            )
          ORDER BY o.created_at DESC
          LIMIT ?
        `)
        .all(model, limit) as Array<{ id: string; content_redacted: string; created_at: string }>;

      const rows: Array<{ id: string; content_redacted: string; created_at: string }> = missingRows.length > 0
        ? missingRows
        : legacyRows.length > 0
        ? legacyRows
        : (this.deps.db
            .query(`
              SELECT o.id, o.content_redacted, o.created_at
              FROM mem_observations o
              WHERE ${activeFilter}
              ORDER BY created_at DESC
              LIMIT ?
            `)
            .all(limit) as Array<{ id: string; content_redacted: string; created_at: string }>);

      const beforeCounts = this.deps.db
        .query(
          `SELECT
             COUNT(DISTINCT o.id) AS total_observations,
             COUNT(DISTINCT CASE WHEN v.model = ? THEN o.id END) AS current_count
           FROM mem_observations o
           LEFT JOIN mem_vectors v ON v.observation_id = o.id
           WHERE ${activeFilter}`
        )
        .get(model) as { total_observations: number; current_count: number } | null;
      const totalBefore = Number(beforeCounts?.total_observations ?? 0);
      const currentBefore = Number(beforeCounts?.current_count ?? 0);

    let reindexed = 0;
    for (const row of rows) {
      this.deps.reindexObservationVector(row.id, row.content_redacted || "", row.created_at || nowIso());
      reindexed += 1;
    }

      const afterCounts = this.deps.db
        .query(
          `SELECT
             COUNT(DISTINCT o.id) AS total_observations,
             COUNT(DISTINCT CASE WHEN v.model = ? THEN o.id END) AS current_count
           FROM mem_observations o
           LEFT JOIN mem_vectors v ON v.observation_id = o.id
           WHERE ${activeFilter}`
        )
        .get(model) as { total_observations: number; current_count: number } | null;
      const totalAfter = Number(afterCounts?.total_observations ?? totalBefore);
      const currentAfter = Number(afterCounts?.current_count ?? (currentBefore + reindexed));
      const missingRemaining = Math.max(0, totalAfter - currentAfter);
      const legacyRemainingRow = this.deps.db
        .query(`
          SELECT COUNT(*) AS count
          FROM mem_observations o
          WHERE ${activeFilter}
            AND EXISTS (SELECT 1 FROM mem_vectors v_any WHERE v_any.observation_id = o.id)
            AND NOT EXISTS (
              SELECT 1 FROM mem_vectors v_current
              WHERE v_current.observation_id = o.id
                AND v_current.model = ?
            )
        `)
        .get(model) as { count: number } | null;
      const legacyRemaining = Number(legacyRemainingRow?.count ?? 0);
      const coverage = totalAfter === 0 ? 1 : currentAfter / totalAfter;
      const pct = Math.round(coverage * 100);

      return makeResponse(
        startedAt,
        [
          {
            reindexed,
            limit,
            total_observations: totalAfter,
            current_model_vectors: currentAfter,
            missing_vectors_remaining: missingRemaining,
            legacy_vectors_remaining: legacyRemaining,
            vector_coverage: coverage,
            target_coverage: 0.95,
            progress_pct: pct,
          },
        ],
      { limit },
      {
        vector_engine: this.deps.getVectorEngine(),
          embedding_provider: this.deps.embeddingProviderName,
          embedding_provider_model: model,
          embedding_provider_status: this.deps.getEmbeddingHealthStatus(),
          migration_complete: missingRemaining === 0 && legacyRemaining === 0,
          vector_coverage: coverage,
          target_coverage: 0.95,
        }
      );
    }

    cleanupDuplicateObservations(options: { execute?: boolean; limit?: number } = {}): ApiResponse {
      const startedAt = performance.now();
      const execute = options.execute === true;
      const limit = clampLimit(options.limit, 100, 1, 10000);
      const scanLimit = Math.min(limit * 10, 10000);
      const now = nowIso();
      const rows = this.deps.db
        .query(`
          SELECT id, session_id, observation_type, content_redacted, content_dedupe_hash, created_at
          FROM mem_observations
          WHERE archived_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(now, scanLimit) as Array<{
          id: string;
          session_id: string;
          observation_type: string;
          content_redacted: string;
          content_dedupe_hash: string | null;
          created_at: string;
        }>;

      const groups = new Map<string, typeof rows>();
      for (const row of rows) {
        const normalized = (row.content_redacted || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!normalized) {
          continue;
        }
        const key = row.content_dedupe_hash
          ? `hash:${row.content_dedupe_hash}`
          : `legacy:${row.session_id}:${row.observation_type}:${normalized}`;
        const bucket = groups.get(key) ?? [];
        bucket.push(row);
        groups.set(key, bucket);
      }

      const items: Array<Record<string, unknown>> = [];
      let candidateRows = 0;
      let archivedRows = 0;
      for (const [groupKey, groupRows] of groups) {
        if (groupRows.length < 2) {
          continue;
        }
        const sorted = [...groupRows].sort((a, b) => {
          const byDate = b.created_at.localeCompare(a.created_at);
          return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
        });
        const keep = sorted[0];
        const archivedIds = sorted.slice(1).map((row) => row.id);
        if (archivedIds.length === 0) {
          continue;
        }
        candidateRows += archivedIds.length;
        if (execute) {
          const placeholders = archivedIds.map(() => "?").join(", ");
          this.deps.db
            .query(`UPDATE mem_observations SET archived_at = ?, updated_at = ? WHERE id IN (${placeholders}) AND archived_at IS NULL`)
            .run(now, now, ...archivedIds);
          archivedRows += archivedIds.length;
        }
        this.deps.writeAuditLog(
          execute ? "admin.cleanup_duplicates" : "admin.cleanup_duplicates.plan",
          "observation_group",
          groupKey.slice(0, 255),
          { dry_run: !execute, kept_id: keep.id, archived_ids: archivedIds }
        );
        items.push({
          group_key: groupKey,
          kept_id: keep.id,
          archived_ids: archivedIds,
          duplicate_count: archivedIds.length,
          dry_run: !execute,
        });
        if (items.length >= limit) {
          break;
        }
      }

      return makeResponse(
        startedAt,
        items,
        { execute, limit, scan_limit: scanLimit },
        {
          scan_limit: scanLimit,
          scanned_rows: rows.length,
          duplicate_groups: items.length,
          candidate_rows: candidateRows,
          archived_rows: archivedRows,
          dry_run: !execute,
          audit_logged: true,
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
    const canonicalByProject = new Map<string, string>();
    const canonicalizeProjectCached = (project: string): string => {
      const cached = canonicalByProject.get(project);
      if (cached !== undefined) {
        return cached;
      }
      const canonical = this.deps.canonicalizeProject(project);
      canonicalByProject.set(project, canonical);
      return canonical;
    };

    // S81-B02 (Codex round 9 P2): soft-archive visibility gated on its
    // own dedicated flag so asking for private notes does not also
    // resurrect forgotten rows. Admin tooling can still opt in.
    // §78-D01: expired rows follow the same admin flag.
    const includeArchived = Boolean((request as { include_archived?: boolean }).include_archived);
    const archivedFilter = includeArchived
      ? ""
      : ` AND o.archived_at IS NULL ${expiredFilterSql("o")} `;

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
        ${archivedFilter}
        ${visibility}
        GROUP BY o.project
        ORDER BY updated_at DESC
      `)
      .all() as Array<{ project: string; observations: number; sessions: number; updated_at: string | null }>;

    const sessionRows = this.deps.db
      .query(`
        SELECT DISTINCT
          o.project AS project,
          o.session_id AS session_id
        FROM mem_observations o
        WHERE 1 = 1
        ${platformVisibility}
        ${archivedFilter}
        ${visibility}
      `)
      .all() as Array<{ project: string; session_id: string }>;

    const grouped = new Map<string, {
      project: string;
      observations: number;
      updated_at: string | null;
      member_projects: Set<string>;
      session_ids: Set<string>;
    }>();

    for (const row of rows) {
      if (!shouldExposeProjectInStats(row.project)) {
        continue;
      }
      const canonical = canonicalizeProjectCached(row.project);
      if (!canonical) {
        continue;
      }
      const entry = grouped.get(canonical) ?? {
        project: canonical,
        observations: 0,
        updated_at: null,
        member_projects: new Set<string>(),
        session_ids: new Set<string>(),
      };
      entry.observations += Number(row.observations || 0);
      entry.member_projects.add(row.project);
      if (!entry.updated_at || (row.updated_at || "") > entry.updated_at) {
        entry.updated_at = row.updated_at || entry.updated_at;
      }
      grouped.set(canonical, entry);
    }

    for (const row of sessionRows) {
      if (!shouldExposeProjectInStats(row.project)) {
        continue;
      }
      const canonical = canonicalizeProjectCached(row.project);
      if (!canonical) {
        continue;
      }
      const entry = grouped.get(canonical);
      if (!entry) {
        continue;
      }
      if (typeof row.session_id === "string" && row.session_id.trim()) {
        entry.session_ids.add(row.session_id);
      }
    }

    const items = [...grouped.values()]
      .map((entry) => ({
        project: entry.project,
        canonical_project: entry.project,
        observations: entry.observations,
        sessions: entry.session_ids.size,
        updated_at: entry.updated_at,
        member_projects: [...entry.member_projects].sort((lhs, rhs) => lhs.localeCompare(rhs)),
      }))
      .sort((lhs, rhs) =>
        (rhs.updated_at || "").localeCompare(lhs.updated_at || "") ||
        rhs.observations - lhs.observations ||
        lhs.project.localeCompare(rhs.project)
      );

    return makeResponse(startedAt, items, { include_private: includePrivate }, { ranking: "projects_stats_v1" });
  }
}
