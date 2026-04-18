/**
 * PgObservationRepository
 *
 * IObservationRepository の PostgreSQL 実装。
 * PostgresStorageAdapter の async メソッド（queryAllAsync / queryOneAsync / runAsync）を使用する。
 *
 * SQLite との差異:
 *   - INSERT OR IGNORE → INSERT ... ON CONFLICT(id) DO NOTHING
 *   - LIKE '%private%' → NOT (privacy_tags_json @> '["private"]')
 *   - tags_json / privacy_tags_json は JSONB 型なので返却時に JSON.stringify で文字列化
 *   - パラメータプレースホルダは ? ではなく $1, $2, ... (queryAllAsync 内で変換済み)
 *   - TIMESTAMPTZ 型は ISO 文字列として返る
 */

import type { AsyncStorageAdapter } from "../storage-adapter.js";
import type {
  IObservationRepository,
  ObservationRow,
  InsertObservationInput,
  FindObservationsFilter,
} from "./IObservationRepository.js";

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

/** PG の JSONB カラムは object/array で返ってくるため文字列に変換する */
function toJsonString(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null);
}

/** PG の TIMESTAMPTZ は Date オブジェクトで返ってくることがあるため ISO 文字列に変換する */
function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value ?? "");
}

/** PG の行を ObservationRow に正規化する */
function normalizeRow(row: Record<string, unknown>): ObservationRow {
  return {
    id: String(row.id ?? ""),
    event_id: row.event_id != null ? String(row.event_id) : null,
    platform: String(row.platform ?? ""),
    project: String(row.project ?? ""),
    workspace_uid: String(row.workspace_uid ?? ""),
    session_id: String(row.session_id ?? ""),
    title: row.title != null ? String(row.title) : null,
    content: String(row.content ?? ""),
    content_redacted: String(row.content_redacted ?? ""),
    observation_type: String(row.observation_type ?? "context"),
    memory_type: String(row.memory_type ?? "semantic"),
    tags_json: toJsonString(row.tags_json ?? []),
    privacy_tags_json: toJsonString(row.privacy_tags_json ?? []),
    signal_score: Number(row.signal_score ?? 0),
    access_count: Number(row.access_count ?? 0),
    last_accessed_at: row.last_accessed_at != null ? toIsoString(row.last_accessed_at) : null,
    cognitive_sector: String(row.cognitive_sector ?? "meta"),
    user_id: String(row.user_id ?? "default"),
    team_id: row.team_id != null ? String(row.team_id) : null,
    // S78-B02: 階層メタデータ
    thread_id: row.thread_id != null ? String(row.thread_id) : null,
    topic: row.topic != null ? String(row.topic) : null,
    // S78-D01: Temporal forgetting
    expires_at: row.expires_at != null ? toIsoString(row.expires_at) : null,
    // S78-E02: Branch-scoped memory
    branch: row.branch != null ? String(row.branch) : null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/** SELECT 句（全カラム）*/
const SELECT_COLS = `
  id, event_id, platform, project, COALESCE(workspace_uid, '') AS workspace_uid, session_id,
  title, content, content_redacted, observation_type, memory_type,
  tags_json, privacy_tags_json,
  COALESCE(signal_score, 0) AS signal_score,
  COALESCE(access_count, 0) AS access_count,
  last_accessed_at,
  COALESCE(cognitive_sector, 'meta') AS cognitive_sector,
  COALESCE(user_id, 'default') AS user_id, team_id,
  thread_id, topic, expires_at, branch,
  created_at, updated_at
`.trim();

// ---------------------------------------------------------------------------
// PgObservationRepository
// ---------------------------------------------------------------------------

export class PgObservationRepository implements IObservationRepository {
  constructor(private readonly adapter: AsyncStorageAdapter) {}

  async insert(input: InsertObservationInput): Promise<string> {
    await this.adapter.runAsync(
      `INSERT INTO mem_observations(
        id, event_id, platform, project, session_id,
        title, content, content_redacted, observation_type, memory_type,
        tags_json, privacy_tags_json,
        signal_score, user_id, team_id,
        thread_id, topic, expires_at, branch,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
      [
        input.id,
        input.event_id ?? null,
        input.platform,
        input.project,
        input.session_id,
        input.title ?? null,
        input.content,
        input.content_redacted,
        input.observation_type,
        input.memory_type ?? "semantic",
        // PG の JSONB カラムに文字列で渡す（PG ドライバが JSONB にキャストする）
        input.tags_json,
        input.privacy_tags_json,
        input.signal_score ?? 0,
        input.user_id ?? "default",
        input.team_id ?? null,
        // S78-B02: 階層メタデータ
        input.thread_id ?? null,
        input.topic ?? null,
        // S78-D01: Temporal forgetting
        input.expires_at ?? null,
        // S78-E02: Branch-scoped memory
        input.branch ?? null,
        input.created_at,
        input.updated_at,
      ]
    );
    return input.id;
  }

  async findById(id: string): Promise<ObservationRow | null> {
    const row = await this.adapter.queryOneAsync<Record<string, unknown>>(
      `SELECT ${SELECT_COLS} FROM mem_observations WHERE id = ?`,
      [id]
    );
    return row != null ? normalizeRow(row) : null;
  }

  async findByIds(ids: string[]): Promise<ObservationRow[]> {
    if (ids.length === 0) return [];

    // PG では $1, $2, ... 形式。adapter 内で ? → $N 変換するため ? を使う
    const MAX_BATCH = 500;
    const results: ObservationRow[] = [];

    for (let offset = 0; offset < ids.length; offset += MAX_BATCH) {
      const batch = ids.slice(offset, offset + MAX_BATCH);
      const placeholders = batch.map(() => "?").join(", ");
      const rows = await this.adapter.queryAllAsync<Record<string, unknown>>(
        `SELECT ${SELECT_COLS} FROM mem_observations WHERE id IN (${placeholders})`,
        batch
      );
      results.push(...rows.map(normalizeRow));
    }

    return results;
  }

  async findMany(filter: FindObservationsFilter): Promise<ObservationRow[]> {
    const params: unknown[] = [];
    let sql = `SELECT ${SELECT_COLS} FROM mem_observations WHERE 1 = 1`;

    if (filter.project) {
      sql += " AND project = ?";
      params.push(filter.project);
    }

    if (filter.session_id) {
      sql += " AND session_id = ?";
      params.push(filter.session_id);
    }

    if (!filter.include_private) {
      // JSONB で "private" タグを含まない行のみ（SQLite の LIKE '%private%' を JSONB @> に変換）
      sql += " AND NOT (privacy_tags_json @> '[\"private\"]'::jsonb)";
    }

    if (filter.since) {
      sql += " AND created_at >= ?";
      params.push(filter.since);
    }

    if (filter.until) {
      sql += " AND created_at <= ?";
      params.push(filter.until);
    }

    if (filter.memory_type !== undefined) {
      const types = Array.isArray(filter.memory_type) ? filter.memory_type : [filter.memory_type];
      if (types.length === 1) {
        sql += " AND memory_type = ?";
        params.push(types[0]);
      } else if (types.length > 1) {
        const placeholders = types.map(() => "?").join(", ");
        sql += ` AND memory_type IN (${placeholders})`;
        params.push(...types);
      }
    }

    // S78-E02: Branch-scoped memory フィルタ
    // branch が指定された場合: そのブランチ OR branch IS NULL（レガシー行）を返す。
    // これにより branch=NULL の既存観察は全ブランチから参照可能（後方互換）。
    // branch が未指定の場合: 全観察を返す（後方互換）。
    if (filter.branch !== undefined) {
      sql += " AND (branch = ? OR branch IS NULL)";
      params.push(filter.branch);
    }

    // S78-D01: 期限切れフィルタ（デフォルト: 除外）
    if (!filter.include_expired) {
      sql += " AND (expires_at IS NULL OR expires_at > ?)";
      params.push(new Date().toISOString());
    }

    if (filter.cursor) {
      sql += " AND created_at < ?";
      params.push(filter.cursor);
    }

    sql += " ORDER BY created_at DESC, id DESC";

    if (filter.limit !== undefined && filter.limit > 0) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    const rows = await this.adapter.queryAllAsync<Record<string, unknown>>(sql, params);
    return rows.map(normalizeRow);
  }

  async updatePrivacyTags(id: string, privacyTagsJson: string): Promise<void> {
    // PG の JSONB カラムに文字列で渡す
    await this.adapter.runAsync(
      "UPDATE mem_observations SET privacy_tags_json = ?::jsonb WHERE id = ?",
      [privacyTagsJson, id]
    );
  }

  async delete(id: string): Promise<void> {
    await this.adapter.runAsync(
      "DELETE FROM mem_observations WHERE id = ?",
      [id]
    );
  }

  async count(filter?: Pick<FindObservationsFilter, "project" | "include_private">): Promise<number> {
    const params: unknown[] = [];
    let sql = "SELECT COUNT(*) AS cnt FROM mem_observations WHERE 1 = 1";

    if (filter?.project) {
      sql += " AND project = ?";
      params.push(filter.project);
    }

    if (!filter?.include_private) {
      sql += " AND NOT (privacy_tags_json @> '[\"private\"]'::jsonb)";
    }

    const row = await this.adapter.queryOneAsync<{ cnt: string | number }>(sql, params);
    return Number(row?.cnt ?? 0);
  }
}
