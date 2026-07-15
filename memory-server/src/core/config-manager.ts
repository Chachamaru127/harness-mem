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
import { parseEmbeddingDefaultModelFlag } from "../embedding/model-catalog";
import {
  ensureSqliteVecTableForModel,
  getSqliteVecMapTableName,
  getSqliteVecTableName,
  upsertSqliteVecRow as defaultUpsertSqliteVecRow,
  type SqliteVecUpsertOptions,
} from "../vector/providers";
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
} from "./core-utils.js";

// S154-403: embedding default-model atomic flag.
// The flag is a single mem_meta upsert; flipping it never touches vector
// tables (both stay resident per S154-401), so rollback is one atomic write.
export const EMBEDDING_DEFAULT_MODEL_KEY = "embedding_default_model";
export const INCUMBENT_EMBEDDING_MODEL = "multilingual-e5";
export const REFERENCE_DEFAULT_EMBEDDING_MODEL_FLAG = "granite-embedding-311m-r2@384";
export const INSTALLATION_MARKER_META_KEY = "installation_marker_at";

export function getEmbeddingDefaultModel(db: Database): string {
  const row = db
    .query("SELECT value FROM mem_meta WHERE key = ?")
    .get(EMBEDDING_DEFAULT_MODEL_KEY) as { value: string } | null;
  const value = row?.value?.trim();
  return value ? value : INCUMBENT_EMBEDDING_MODEL;
}

/**
 * Atomically set the embedding default-model flag. Returns the previous value.
 *
 * The writer (this setter) and the reader (registry flag parse) accept the same
 * `<modelId>[@<dimension>]` format via parseEmbeddingDefaultModelFlag, so the
 * Granite MRL target `granite-embedding-311m-r2@384` is writable through this
 * audited API. Validates flag *format* only: store-dimension agreement is
 * intentionally not checked here because the flag may be written before the
 * S154-511 backfill changes the store dimension — that mismatch is the reader's
 * fail-safe (registry), not the writer's concern.
 */
export function setEmbeddingDefaultModel(db: Database, modelId: string): string {
  const normalized = modelId.trim();
  if (!normalized) {
    throw new Error("[s154-403] embedding default model id must be non-empty");
  }
  const parsed = parseEmbeddingDefaultModelFlag(normalized);
  if (!parsed.ok) {
    throw new Error(`[s154-403] invalid embedding model flag "${normalized}": ${parsed.reason}`);
  }
  const previous = getEmbeddingDefaultModel(db);
  db.query(
    `INSERT INTO mem_meta(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(EMBEDDING_DEFAULT_MODEL_KEY, normalized, nowIso());
  return previous;
}

export interface RepairSqliteVecMapOptions {
  model?: string;
  dimension?: number;
  limit?: number;
  execute?: boolean;
  rebuild_existing?: boolean;
  rebuild_before?: string;
  status_counts?: boolean;
}

export interface ReindexVectorsOptions {
  status_counts?: boolean;
}

type SqliteVecRowUpsert = (
  db: Database,
  observationId: string,
  vectorJson: string,
  updatedAt: string,
  options: SqliteVecUpsertOptions,
) => boolean;

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
  /** sqlite-vec table readiness — 呼び出し時に現在値を取得 */
  getVecTableReady?: () => boolean;
  /** sqlite-vec table readiness を更新する */
  setVecTableReady?: (ready: boolean) => void;
  /** 現在のベクトルモデルバージョン — 呼び出し時に現在値を取得 */
  getVectorModelVersion: () => string;
  /** 埋め込みプロバイダー名 */
  embeddingProviderName: string;
  /** 埋め込みヘルスステータス（呼び出し時に現在値を取得） */
  getEmbeddingHealthStatus: () => string;
  /** 観察ベクトルを再インデックスするコールバック */
  reindexObservationVector: (id: string, content: string, createdAt: string) => void;
  /** sqlite-vec model-specific row upsert。テストでは vec0 extension なしで差し替える */
  upsertSqliteVecRow?: SqliteVecRowUpsert;
  /** ローカル ONNX など、同期 embed 前に async prime が必要な provider 用 */
  prepareReindexEmbedding?: (content: string) => Promise<void>;
  /** reindex の小 batch 単位でまとめて prime できる provider 用 */
  prepareReindexEmbeddings?: (contents: string[]) => Promise<void>;
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

function projectsStatsVisibilityFilterSql(alias: string, includePrivate: boolean): string {
  if (includePrivate) {
    return "";
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid SQL alias: ${alias}`);
  }

  return `
    AND (
      ${alias}.privacy_tags_json IS NULL
      OR (
        json_valid(${alias}.privacy_tags_json)
        AND lower(${alias}.privacy_tags_json) NOT LIKE '%"private"%'
        AND lower(${alias}.privacy_tags_json) NOT LIKE '%"sensitive"%'
      )
    )
  `;
}

function currentVectorModelPredicate(alias: string, model: string): { sql: string; params: string[] } {
  const column = `${alias}.model`;
  if (model.startsWith("adaptive:")) {
    return { sql: `${column} LIKE 'adaptive:%'`, params: [] };
  }
  return { sql: `${column} = ?`, params: [model] };
}

function compatibleLegacyAdaptiveGeneralModel(model: string): { source: string; target: string } | null {
  if (!model.startsWith("adaptive:")) {
    return null;
  }
  return {
    source: "local:multilingual-e5",
    target: "adaptive:general:local:multilingual-e5",
  };
}

function resolveReindexPriorityOrder(alias: string): { priority: string; orderBy: string } {
  const priority = (process.env.HARNESS_MEM_REINDEX_PRIORITY || "recent").trim().toLowerCase();
  if (priority === "general-first") {
    return {
      priority,
      orderBy: `CASE WHEN ${alias}.content_redacted GLOB '*[ぁ-んァ-ン一-龯]*' THEN 1 ELSE 0 END ASC, ${alias}.created_at DESC`,
    };
  }
  if (priority === "shortest") {
    return {
      priority,
      orderBy: `LENGTH(${alias}.content_redacted) ASC, ${alias}.created_at DESC`,
    };
  }
  return {
    priority: "recent",
    orderBy: `${alias}.created_at DESC`,
  };
}

function sqliteTableExists(db: Database, tableName: string): boolean {
  const row = db
    .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { name?: string } | null;
  return typeof row?.name === "string";
}

function countRows(db: Database, tableName: string): number {
  if (!sqliteTableExists(db, tableName)) {
    return 0;
  }
  const row = db.query(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: number } | null;
  return Number(row?.count ?? 0);
}

function estimateSqliteVecIndexRows(db: Database, tableName: string, mapCount: number): { count: number; estimated: boolean } {
  if (!sqliteTableExists(db, tableName)) {
    return { count: 0, estimated: false };
  }
  return { count: mapCount, estimated: true };
}

function countVectorsForModel(db: Database, model: string, dimension: number): number {
  const row = db
    .query(`
      SELECT COUNT(*) AS count
      FROM mem_vectors
      WHERE model = ?
        AND dimension = ?
    `)
    .get(model, dimension) as { count?: number } | null;
  return Number(row?.count ?? 0);
}

function countMissingSqliteVecMapRows(
  db: Database,
  model: string,
  dimension: number,
  tableName: string,
  mapTableName: string,
): number {
  if (!sqliteTableExists(db, tableName) || !sqliteTableExists(db, mapTableName)) {
    return countVectorsForModel(db, model, dimension);
  }

  const row = db
    .query(`
      SELECT COUNT(*) AS count
      FROM mem_vectors v
      WHERE v.model = ?
        AND v.dimension = ?
        AND NOT EXISTS (
          SELECT 1
          FROM ${mapTableName} m
          WHERE m.observation_id = v.observation_id
        )
    `)
    .get(model, dimension) as { count?: number } | null;
  return Number(row?.count ?? 0);
}

function selectSqliteVecRebuildRows(
  db: Database,
  model: string,
  dimension: number,
  mapTableName: string,
  limit: number,
  rebuildBefore?: string,
): Array<{ observation_id: string; vector_json: string; updated_at: string }> {
  const rows: Array<{ observation_id: string; vector_json: string; updated_at: string }> = [];
  const missingRows = db
    .query(`
      SELECT v.observation_id, v.vector_json, v.updated_at
      FROM mem_vectors v
      WHERE v.model = ?
        AND v.dimension = ?
        AND NOT EXISTS (
          SELECT 1
          FROM ${mapTableName} m
          WHERE m.observation_id = v.observation_id
        )
      ORDER BY v.updated_at ASC, v.observation_id ASC
      LIMIT ?
    `)
    .all(model, dimension, limit) as Array<{
      observation_id: string;
      vector_json: string;
      updated_at: string;
    }>;
  rows.push(...missingRows);

  const remainingLimit = limit - rows.length;
  if (remainingLimit <= 0) {
    return rows;
  }

  const cutoff = typeof rebuildBefore === "string" && rebuildBefore.trim()
    ? rebuildBefore.trim()
    : null;
  const staleRows = (cutoff
    ? db
        .query(`
          SELECT v.observation_id, v.vector_json, v.updated_at
          FROM ${mapTableName} m
          JOIN mem_vectors v
            ON v.observation_id = m.observation_id
          WHERE v.model = ?
            AND v.dimension = ?
            AND m.updated_at < ?
          ORDER BY m.updated_at ASC, m.observation_id ASC
          LIMIT ?
        `)
        .all(model, dimension, cutoff, remainingLimit)
    : db
        .query(`
          SELECT v.observation_id, v.vector_json, v.updated_at
          FROM ${mapTableName} m
          JOIN mem_vectors v
            ON v.observation_id = m.observation_id
          WHERE v.model = ?
            AND v.dimension = ?
          ORDER BY m.updated_at ASC, m.observation_id ASC
          LIMIT ?
        `)
        .all(model, dimension, remainingLimit)) as Array<{
    observation_id: string;
    vector_json: string;
    updated_at: string;
  }>;
  rows.push(...staleRows);
  return rows;
}

function validateVectorJsonForRepair(
  vectorJson: string,
  dimension: number,
): { ok: true } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(vectorJson);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, reason: "not_array" };
  }
  if (parsed.length !== dimension) {
    return { ok: false, reason: "dimension_mismatch" };
  }
  if (!parsed.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return { ok: false, reason: "non_finite_value" };
  }
  return { ok: true };
}

function bulkRepairSqliteVecMapRows(
  db: Database,
  model: string,
  dimension: number,
  limit: number,
): { repaired: number; skipped: number; failed: number; errors: string[] } {
  const { tableName, mapTableName } = ensureSqliteVecTableForModel(db, model, dimension);
  const tempTable = "temp_sqlite_vec_map_repair_batch";
  const errors: string[] = [];

  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(`DROP TABLE IF EXISTS ${tempTable}`);
    db.exec(`
      CREATE TEMP TABLE ${tempTable} (
        rowid INTEGER PRIMARY KEY,
        observation_id TEXT NOT NULL UNIQUE,
        vector_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.query(`
	      INSERT INTO ${tempTable}(rowid, observation_id, vector_json, updated_at)
	      WITH max_row AS (
	        SELECT COALESCE(MAX(rowid), 0) AS base_rowid FROM ${mapTableName}
	      ),
      missing AS (
        SELECT
          v.observation_id,
          v.vector_json,
          COALESCE(v.updated_at, ?) AS updated_at,
          ROW_NUMBER() OVER (ORDER BY v.updated_at DESC, v.observation_id ASC) AS rn
        FROM mem_vectors v
        WHERE v.model = ?
          AND v.dimension = ?
          AND json_valid(v.vector_json)
          AND json_array_length(v.vector_json) = ?
	          AND NOT EXISTS (
	            SELECT 1
	            FROM ${mapTableName} m
	            WHERE m.observation_id = v.observation_id
	          )
        ORDER BY v.updated_at DESC, v.observation_id ASC
        LIMIT ?
      )
      SELECT
        max_row.base_rowid + missing.rn AS rowid,
        missing.observation_id,
        missing.vector_json,
        missing.updated_at
      FROM missing, max_row;
    `).run(nowIso(), model, dimension, dimension, limit);

    const row = db.query(`SELECT COUNT(*) AS count FROM ${tempTable}`).get() as { count?: number } | null;
    const repaired = Number(row?.count ?? 0);
    if (repaired > 0) {
      db.exec(`
        INSERT INTO ${tableName}(rowid, embedding)
        SELECT rowid, vector_json FROM ${tempTable};
        INSERT OR REPLACE INTO ${mapTableName}(rowid, observation_id, updated_at)
        SELECT rowid, observation_id, updated_at FROM ${tempTable};
      `);
    }
    db.exec(`DROP TABLE IF EXISTS ${tempTable}`);
    db.exec("COMMIT");
    return { repaired, skipped: 0, failed: 0, errors };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback errors; the original error is more useful
    }
    errors.push(errorMessage(error));
    return { repaired: 0, skipped: 0, failed: 1, errors };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRetryableEmbeddingWarmup(error: unknown): boolean {
  const maybe = error as { code?: unknown; retryable?: unknown; readiness?: { retryable?: unknown } };
  const code = typeof maybe.code === "string" ? maybe.code.toLowerCase() : "";
  const lowered = errorMessage(error).toLowerCase();
  const retryable = maybe.retryable !== false && maybe.readiness?.retryable !== false;

  return retryable && (
    code === "prime_required" ||
    code === "warming" ||
    lowered.includes("requires async prime before sync embed") ||
    (lowered.includes("local onnx model") && lowered.includes("warming up"))
  );
}

function summarizeRetryableEmbeddingWarmup(error: unknown): string {
  const maybe = error as { code?: unknown; modelId?: unknown };
  const code = typeof maybe.code === "string" ? maybe.code : "warmup";
  const modelId = typeof maybe.modelId === "string" ? maybe.modelId : "local ONNX";
  return `${modelId}: retryable embedding ${code}`;
}

// ---------------------------------------------------------------------------
// ConfigManager クラス
// ---------------------------------------------------------------------------

export class ConfigManager {
  constructor(private readonly deps: ConfigManagerDeps) {}

  // ---------------------------------------------------------------------------
  // S154-403: embedding default-model atomic flag (audited)
  // ---------------------------------------------------------------------------

  getEmbeddingDefaultModel(): string {
    return getEmbeddingDefaultModel(this.deps.db);
  }

  setEmbeddingDefaultModel(modelId: string): string {
    const previous = setEmbeddingDefaultModel(this.deps.db, modelId);
    this.deps.writeAuditLog("admin.embedding_default_model", "mem_meta", modelId.trim(), {
      previous,
    });
    return previous;
  }

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

    async reindexVectors(limitInput?: number, options: ReindexVectorsOptions = {}): Promise<ApiResponse> {
      const startedAt = performance.now();
      if (this.deps.getVectorEngine() === "disabled") {
        return makeResponse(startedAt, [], {}, { reindexed: 0, skipped: "vector_disabled" });
      }

      const limit = clampLimit(limitInput, 100, 1, 10000);
      const includeStatusCounts = options.status_counts !== false;
      const model = this.deps.getVectorModelVersion();
      const currentVector = currentVectorModelPredicate("v", model);
      const currentVectorForLegacy = currentVectorModelPredicate("v_current", model);
      const now = nowIso();
      const activeFilter = `o.archived_at IS NULL${expiredFilterSql("o", now)}`;
      const legacyAdoption = compatibleLegacyAdaptiveGeneralModel(model);
      const reindexPriority = resolveReindexPriorityOrder("o");

      const adoptableLegacyRows = legacyAdoption
        ? this.deps.db
            .query(`
              SELECT o.id, v.vector_json, v.dimension, COALESCE(v.created_at, o.created_at) AS created_at
              FROM mem_observations o
              JOIN mem_vectors v
                ON v.observation_id = o.id
               AND v.model = ?
              WHERE ${activeFilter}
                AND NOT EXISTS (
                  SELECT 1 FROM mem_vectors v_current
                  WHERE v_current.observation_id = o.id
                    AND ${currentVectorForLegacy.sql}
                )
              ORDER BY ${reindexPriority.orderBy}
              LIMIT ?
            `)
            .all(legacyAdoption.source, ...currentVectorForLegacy.params, limit) as Array<{
              id: string;
              vector_json: string;
              dimension: number;
              created_at: string;
            }>
        : [];

      let adoptedLegacy = 0;
      if (legacyAdoption && adoptableLegacyRows.length > 0) {
        const updatedAt = nowIso();
        let transactionStarted = false;
        try {
          this.deps.db.exec("BEGIN IMMEDIATE");
          transactionStarted = true;
          for (const row of adoptableLegacyRows) {
            this.deps.db
              .query(`
                INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(observation_id, model) DO UPDATE SET
                  dimension = excluded.dimension,
                  vector_json = excluded.vector_json,
                  updated_at = excluded.updated_at
              `)
              .run(
                row.id,
                legacyAdoption.target,
                Number(row.dimension || this.deps.config.vectorDimension),
                row.vector_json,
                row.created_at || updatedAt,
                updatedAt,
              );
            if (
              this.deps.getVectorEngine() === "sqlite-vec" &&
              (this.deps.getVecTableReady?.() ?? false)
            ) {
              const upsertSqliteVecRow = this.deps.upsertSqliteVecRow ?? defaultUpsertSqliteVecRow;
              const ok = upsertSqliteVecRow(this.deps.db, row.id, row.vector_json, updatedAt, {
                model: legacyAdoption.target,
                vectorDimension: Number(row.dimension || this.deps.config.vectorDimension),
              });
              if (!ok) {
                this.deps.setVecTableReady?.(false);
              }
            }
            adoptedLegacy += 1;
          }
          this.deps.db.exec("COMMIT");
          transactionStarted = false;
        } catch (error) {
          if (transactionStarted) {
            try {
              this.deps.db.exec("ROLLBACK");
            } catch {
              // keep the original error
            }
          }
          throw error;
        }
      }

      // Priority order:
      // 0. compatible legacy vectors that can be safely adopted without
      //    recomputing (for example local:multilingual-e5 -> adaptive general),
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
          ORDER BY ${reindexPriority.orderBy}
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
                AND ${currentVectorForLegacy.sql}
            )
          ORDER BY ${reindexPriority.orderBy}
          LIMIT ?
        `)
        .all(...currentVectorForLegacy.params, limit) as Array<{ id: string; content_redacted: string; created_at: string }>;

      const rows: Array<{ id: string; content_redacted: string; created_at: string }> = adoptedLegacy > 0
        ? []
        : missingRows.length > 0
        ? missingRows
        : legacyRows.length > 0
        ? legacyRows
        : (this.deps.db
            .query(`
              SELECT o.id, o.content_redacted, o.created_at
              FROM mem_observations o
              WHERE ${activeFilter}
              ORDER BY ${reindexPriority.orderBy}
              LIMIT ?
            `)
            .all(limit) as Array<{ id: string; content_redacted: string; created_at: string }>);

      const beforeCounts = includeStatusCounts
        ? this.deps.db
            .query(
              `SELECT
                 COUNT(DISTINCT o.id) AS total_observations,
                 COUNT(DISTINCT CASE WHEN ${currentVector.sql} THEN o.id END) AS current_count
               FROM mem_observations o
               LEFT JOIN mem_vectors v ON v.observation_id = o.id
               WHERE ${activeFilter}`
            )
            .get(...currentVector.params) as { total_observations: number; current_count: number } | null
        : null;
      const totalBefore = Number(beforeCounts?.total_observations ?? 0);
      const currentBefore = Number(beforeCounts?.current_count ?? 0);

    let reindexed = 0;
    let skippedRetryable = 0;
    const retryableEmbeddingErrors = new Set<string>();
      const concurrency = clampLimit(
        Number(process.env.HARNESS_MEM_REINDEX_VECTORS_CONCURRENCY || 4),
        4,
        1,
        16,
      );
    const maxContentChars = clampLimit(
      Number(process.env.HARNESS_MEM_REINDEX_VECTOR_MAX_CHARS || 2000),
      2000,
      256,
      20000,
    );
    const primeBatchSize = clampLimit(
      Number(process.env.HARNESS_MEM_REINDEX_PRIME_BATCH_SIZE || 32),
      32,
      1,
      128,
    );
    const reindexEmbeddingContent = (content: string): string => {
      const normalized = content || "";
      return normalized.length > maxContentChars ? normalized.slice(0, maxContentChars) : normalized;
    };
    let nextRowIndex = 0;
    const processRow = async (
      row: { id: string; content_redacted: string; created_at: string },
      shouldPrepare = true,
    ): Promise<void> => {
      const embeddingContent = reindexEmbeddingContent(row.content_redacted || "");
      try {
        if (shouldPrepare && this.deps.prepareReindexEmbedding) {
          await this.deps.prepareReindexEmbedding(embeddingContent);
        }
        this.deps.reindexObservationVector(row.id, embeddingContent, row.created_at || nowIso());
        reindexed += 1;
      } catch (error) {
        if (!isRetryableEmbeddingWarmup(error)) {
          throw error;
        }
        skippedRetryable += 1;
        retryableEmbeddingErrors.add(summarizeRetryableEmbeddingWarmup(error));
      }
    };

    if (this.deps.prepareReindexEmbeddings && rows.length > 0) {
      for (let offset = 0; offset < rows.length; offset += primeBatchSize) {
        const chunk = rows.slice(offset, offset + primeBatchSize);
        try {
          await this.deps.prepareReindexEmbeddings(
            chunk.map((row) => reindexEmbeddingContent(row.content_redacted || ""))
          );
        } catch (error) {
          if (!isRetryableEmbeddingWarmup(error)) {
            throw error;
          }
          skippedRetryable += chunk.length;
          retryableEmbeddingErrors.add(summarizeRetryableEmbeddingWarmup(error));
          continue;
        }
        for (const row of chunk) {
          await processRow(row, false);
        }
      }
    } else {
      const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
        while (nextRowIndex < rows.length) {
          const row = rows[nextRowIndex];
          nextRowIndex += 1;
          if (row) {
            await processRow(row);
          }
        }
      });
      await Promise.all(workers);
    }

      const afterCounts = includeStatusCounts
        ? this.deps.db
            .query(
              `SELECT
                 COUNT(DISTINCT o.id) AS total_observations,
                 COUNT(DISTINCT CASE WHEN ${currentVector.sql} THEN o.id END) AS current_count
               FROM mem_observations o
               LEFT JOIN mem_vectors v ON v.observation_id = o.id
               WHERE ${activeFilter}`
            )
            .get(...currentVector.params) as { total_observations: number; current_count: number } | null
        : null;
      const totalAfter = includeStatusCounts ? Number(afterCounts?.total_observations ?? totalBefore) : undefined;
      const currentAfter = includeStatusCounts
        ? Number(afterCounts?.current_count ?? (currentBefore + reindexed + adoptedLegacy))
        : undefined;
      const missingRemaining =
        totalAfter !== undefined && currentAfter !== undefined
          ? Math.max(0, totalAfter - currentAfter)
          : undefined;
      const legacyRemainingRow = includeStatusCounts
        ? this.deps.db
            .query(`
              SELECT COUNT(*) AS count
              FROM mem_observations o
              WHERE ${activeFilter}
                AND EXISTS (SELECT 1 FROM mem_vectors v_any WHERE v_any.observation_id = o.id)
                AND NOT EXISTS (
                  SELECT 1 FROM mem_vectors v_current
                  WHERE v_current.observation_id = o.id
                    AND ${currentVectorForLegacy.sql}
                )
            `)
            .get(...currentVectorForLegacy.params) as { count: number } | null
        : null;
      const legacyRemaining = includeStatusCounts ? Number(legacyRemainingRow?.count ?? 0) : undefined;
      const coverage =
        totalAfter !== undefined && currentAfter !== undefined
          ? totalAfter === 0
            ? 1
            : currentAfter / totalAfter
          : undefined;
      const pct = coverage === undefined ? undefined : Math.round(coverage * 100);
      const item: Record<string, unknown> = {
        reindexed,
        adopted_legacy_vectors: adoptedLegacy,
        skipped_retryable: skippedRetryable,
        limit,
        max_content_chars: maxContentChars,
        prime_batch_size: this.deps.prepareReindexEmbeddings ? primeBatchSize : 0,
        priority: reindexPriority.priority,
        status_counts: includeStatusCounts,
      };
      if (includeStatusCounts) {
        item.total_observations = totalAfter;
        item.current_model_vectors = currentAfter;
        item.missing_vectors_remaining = missingRemaining;
        item.legacy_vectors_remaining = legacyRemaining;
        item.vector_coverage = coverage;
        item.target_coverage = 0.95;
        item.progress_pct = pct;
      }

      return makeResponse(
        startedAt,
        [item],
      { limit },
      {
        vector_engine: this.deps.getVectorEngine(),
          embedding_provider: this.deps.embeddingProviderName,
          embedding_provider_model: model,
          embedding_provider_status: this.deps.getEmbeddingHealthStatus(),
          migration_complete: includeStatusCounts
            ? missingRemaining === 0 && legacyRemaining === 0
            : undefined,
          vector_coverage: coverage,
          target_coverage: 0.95,
          status_counts: includeStatusCounts,
          skipped_retryable: skippedRetryable,
          retryable_embedding_errors: [...retryableEmbeddingErrors],
        }
      );
    }

    repairSqliteVecMap(options: RepairSqliteVecMapOptions = {}): ApiResponse {
      const startedAt = performance.now();
      const model = typeof options.model === "string" && options.model.trim()
        ? options.model.trim()
        : this.deps.getVectorModelVersion();
      const dimension = clampLimit(options.dimension, this.deps.config.vectorDimension, 1, 8192);
      const limit = clampLimit(options.limit, 100, 1, 5000);
      const execute = options.execute === true;
      const dryRun = !execute;
      const rebuildExisting = options.rebuild_existing === true;
      const rebuildBefore = typeof options.rebuild_before === "string" && options.rebuild_before.trim()
        ? options.rebuild_before.trim()
        : undefined;
      const includeStatusCounts = options.status_counts !== false;
      const tableName = getSqliteVecTableName(model);
      const mapTableName = getSqliteVecMapTableName(model);
      const vectorCount = includeStatusCounts ? countVectorsForModel(this.deps.db, model, dimension) : undefined;
      const mapCount = includeStatusCounts ? countRows(this.deps.db, mapTableName) : undefined;
      const indexCountResult = includeStatusCounts
        ? estimateSqliteVecIndexRows(this.deps.db, tableName, mapCount ?? 0)
        : undefined;
      const indexCount = indexCountResult?.count;
      const indexCountEstimated = indexCountResult?.estimated;
      const missingBefore =
        includeStatusCounts || !rebuildExisting
          ? countMissingSqliteVecMapRows(
              this.deps.db,
              model,
              dimension,
              tableName,
              mapTableName,
            )
          : undefined;

      let repaired = 0;
      let skipped = 0;
      let failed = 0;
      const errors: string[] = [];
      const rebuildBatchUpdatedAt = rebuildExisting && execute ? nowIso() : null;

      if (execute && (rebuildExisting || Number(missingBefore ?? 0) > 0)) {
        const hasIndexTables = sqliteTableExists(this.deps.db, tableName) && sqliteTableExists(this.deps.db, mapTableName);
        const rows = (rebuildExisting
          ? hasIndexTables
            ? selectSqliteVecRebuildRows(this.deps.db, model, dimension, mapTableName, limit, rebuildBefore)
            : this.deps.db
                .query(`
                  SELECT v.observation_id, v.vector_json, v.updated_at
                  FROM mem_vectors v
                  WHERE v.model = ?
                    AND v.dimension = ?
                  ORDER BY v.updated_at ASC, v.observation_id ASC
                  LIMIT ?
                `)
                .all(model, dimension, limit)
          : hasIndexTables
          ? this.deps.db
              .query(`
                SELECT v.observation_id, v.vector_json, v.updated_at
                FROM mem_vectors v
                WHERE v.model = ?
                  AND v.dimension = ?
	                  AND NOT EXISTS (
	                    SELECT 1
	                    FROM ${mapTableName} m
	                    WHERE m.observation_id = v.observation_id
	                  )
                ORDER BY v.updated_at DESC, v.observation_id ASC
                LIMIT ?
              `)
              .all(model, dimension, limit)
          : this.deps.db
              .query(`
                SELECT v.observation_id, v.vector_json, v.updated_at
                FROM mem_vectors v
                WHERE v.model = ?
                  AND v.dimension = ?
                ORDER BY v.updated_at DESC, v.observation_id ASC
                LIMIT ?
              `)
              .all(model, dimension, limit)) as Array<{
                observation_id: string;
                vector_json: string;
                updated_at: string;
              }>;

        const upsertSqliteVecRow = this.deps.upsertSqliteVecRow ?? defaultUpsertSqliteVecRow;
        let transactionStarted = false;
        try {
          this.deps.db.exec("BEGIN IMMEDIATE");
          transactionStarted = true;
          for (const row of rows) {
            const validation = validateVectorJsonForRepair(row.vector_json, dimension);
            if (!validation.ok) {
              skipped += 1;
              if (errors.length < 5) {
                errors.push(`${row.observation_id}: ${validation.reason}`);
              }
              continue;
            }

            try {
              const ok = upsertSqliteVecRow(
                this.deps.db,
                row.observation_id,
                row.vector_json,
                rebuildBatchUpdatedAt ?? row.updated_at ?? nowIso(),
                { model, vectorDimension: dimension },
              );
              if (ok) {
                repaired += 1;
              } else {
                failed += 1;
                if (errors.length < 5) {
                  errors.push(`${row.observation_id}: sqlite_vec_upsert_failed`);
                }
              }
            } catch (error) {
              failed += 1;
              if (errors.length < 5) {
                errors.push(`${row.observation_id}: ${errorMessage(error)}`);
              }
            }
          }
          this.deps.db.exec("COMMIT");
          transactionStarted = false;
        } catch (error) {
          if (transactionStarted) {
            try {
              this.deps.db.exec("ROLLBACK");
            } catch {
              // keep the original error
            }
          }
            failed += 1;
            if (errors.length < 5) {
              errors.push(`transaction: ${errorMessage(error)}`);
            }
        }
      }

      const missingAfter = execute && includeStatusCounts
        ? countMissingSqliteVecMapRows(this.deps.db, model, dimension, tableName, mapTableName)
        : undefined;
      const mapCountAfter = execute && includeStatusCounts ? countRows(this.deps.db, mapTableName) : undefined;
      const indexCountAfterResult = execute && includeStatusCounts
        ? estimateSqliteVecIndexRows(this.deps.db, tableName, mapCountAfter ?? 0)
        : undefined;
      const indexCountAfter = indexCountAfterResult?.count;
      const indexCountAfterEstimated = indexCountAfterResult?.estimated;
      const action = execute ? "admin.sqlite_vec_map_repair" : "admin.sqlite_vec_map_repair.plan";
      this.deps.writeAuditLog(action, "mem_vectors", model, {
        model,
        dimension,
        limit,
        dry_run: dryRun,
        rebuild_existing: rebuildExisting,
        rebuild_before: rebuildBefore,
        rebuild_batch_updated_at: rebuildBatchUpdatedAt,
        vector_count: vectorCount,
        map_count: mapCount,
        index_count: indexCount,
        index_count_estimated: indexCountEstimated,
        missing_before: missingBefore,
        repaired,
        skipped,
        failed,
        missing_after: missingAfter,
      });

      const item: Record<string, unknown> = {
        model,
        dimension,
        vector_count: vectorCount,
        map_count: mapCount,
        index_count: indexCount,
        index_count_estimated: indexCountEstimated,
        missing_before: missingBefore,
        repaired,
        skipped,
        failed,
        dry_run: dryRun,
        rebuild_existing: rebuildExisting,
        rebuild_before: rebuildBefore,
        limit,
      };
      if (rebuildBatchUpdatedAt) {
        item.rebuild_batch_updated_at = rebuildBatchUpdatedAt;
      }
      if (execute) {
        item.missing_after = missingAfter;
        item.map_count_after = mapCountAfter;
        item.index_count_after = indexCountAfter;
        item.index_count_after_estimated = indexCountAfterEstimated;
      }
      if (errors.length > 0) {
        item.errors = errors;
      }

      return makeResponse(
        startedAt,
        [item],
        { limit, model, dimension, rebuild_existing: rebuildExisting },
        {
          model,
          dimension,
          dry_run: dryRun,
          rebuild_existing: rebuildExisting,
          rebuild_before: rebuildBefore,
          rebuild_batch_updated_at: rebuildBatchUpdatedAt,
          vector_count: vectorCount,
          map_count: mapCount,
          index_count: indexCount,
          index_count_estimated: indexCountEstimated,
          missing_before: missingBefore,
          repaired,
          skipped,
          failed,
          missing_after: missingAfter,
          map_count_after: mapCountAfter,
          index_count_after: indexCountAfter,
          index_count_after_estimated: indexCountAfterEstimated,
        },
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

    // S154-201: expose queue counts by job reason so the dreaming path is
    // observable as a distinct job type via the admin status endpoint.
    const reasonRows = this.deps.db
      .query(`SELECT reason, COUNT(*) AS n FROM mem_consolidation_queue GROUP BY reason`)
      .all() as Array<{ reason: string | null; n: number }>;
    const jobs_by_reason: Record<string, number> = {};
    for (const row of reasonRows) {
      jobs_by_reason[row.reason ?? "unknown"] = Number(row.n);
    }

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
          jobs_by_reason,
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
    const visibility = projectsStatsVisibilityFilterSql("o", includePrivate);
    const projectMembers = Array.isArray(request.project_members)
      ? request.project_members.filter((project) => typeof project === "string" && project.trim().length > 0)
      : typeof request.project === "string" && request.project.trim().length > 0
        ? [request.project.trim()]
        : [];
    const projectFilter = projectMembers.length > 0
      ? ` AND o.project IN (${projectMembers.map(() => "?").join(", ")}) `
      : "";
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
        ${projectFilter}
        ${archivedFilter}
        ${visibility}
        GROUP BY o.project
        ORDER BY updated_at DESC
      `)
      .all(...projectMembers) as Array<{ project: string; observations: number; sessions: number; updated_at: string | null }>;

    const sessionRows = this.deps.db
      .query(`
        SELECT DISTINCT
          o.project AS project,
          o.session_id AS session_id
        FROM mem_observations o
        WHERE 1 = 1
        ${platformVisibility}
        ${projectFilter}
        ${archivedFilter}
        ${visibility}
      `)
      .all(...projectMembers) as Array<{ project: string; session_id: string }>;

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

    return makeResponse(
      startedAt,
      items,
      {
        include_private: includePrivate,
        project: request.project,
      },
      { ranking: "projects_stats_v1" }
    );
  }
}
