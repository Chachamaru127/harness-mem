/**
 * SqliteObservationRepository
 *
 * IObservationRepository の SQLite 実装。
 * bun:sqlite の Database を直接使用し、同期 API を Promise でラップする。
 */

import type { Database } from "bun:sqlite";
import type {
  IObservationRepository,
  ObservationRow,
  InsertObservationInput,
  FindObservationsFilter,
} from "./IObservationRepository.js";
import { segmentJapaneseForFts } from "../../core/core-utils.js";

export class SqliteObservationRepository implements IObservationRepository {
  constructor(private readonly db: Database) {}

  async insert(input: InsertObservationInput): Promise<string> {
    // §45: 日本語形態素解析済みテキストを FTS 用に事前計算
    const titleFts = input.title ? segmentJapaneseForFts(input.title) : null;
    const contentFts = segmentJapaneseForFts(input.content_redacted);

    this.db
      .query(`
        INSERT OR IGNORE INTO mem_observations(
          id, event_id, platform, project, session_id,
          title, content, content_redacted, observation_type, memory_type,
          tags_json, privacy_tags_json,
          signal_score, user_id, team_id,
          created_at, updated_at,
          title_fts, content_fts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
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
        input.tags_json,
        input.privacy_tags_json,
        input.signal_score ?? 0,
        input.user_id ?? "default",
        input.team_id ?? null,
        input.created_at,
        input.updated_at,
        titleFts,
        contentFts,
      );
    return input.id;
  }

  async findById(id: string): Promise<ObservationRow | null> {
    const row = this.db
      .query<ObservationRow, [string]>(`
        SELECT
          id, event_id, platform, project, COALESCE(workspace_uid, '') AS workspace_uid, session_id,
          title, content, content_redacted, observation_type, memory_type,
          tags_json, privacy_tags_json,
          COALESCE(signal_score, 0) AS signal_score,
          COALESCE(access_count, 0) AS access_count,
          last_accessed_at,
          COALESCE(cognitive_sector, 'meta') AS cognitive_sector,
          COALESCE(user_id, 'default') AS user_id, team_id,
          created_at, updated_at
        FROM mem_observations
        WHERE id = ?
      `)
      .get(id);
    return row ?? null;
  }

  async findByIds(ids: string[]): Promise<ObservationRow[]> {
    if (ids.length === 0) return [];

    const MAX_BATCH = 500;
    const results: ObservationRow[] = [];

    for (let offset = 0; offset < ids.length; offset += MAX_BATCH) {
      const batch = ids.slice(offset, offset + MAX_BATCH);
      const placeholders = batch.map(() => "?").join(", ");
      const rows = this.db
        .query<ObservationRow, string[]>(`
          SELECT
            id, event_id, platform, project, COALESCE(workspace_uid, '') AS workspace_uid, session_id,
            title, content, content_redacted, observation_type, memory_type,
            tags_json, privacy_tags_json,
            COALESCE(signal_score, 0) AS signal_score,
            COALESCE(access_count, 0) AS access_count,
            last_accessed_at,
            COALESCE(cognitive_sector, 'meta') AS cognitive_sector,
            COALESCE(user_id, 'default') AS user_id, team_id,
            created_at, updated_at
          FROM mem_observations
          WHERE id IN (${placeholders})
        `)
        .all(...batch);
      results.push(...rows);
    }

    return results;
  }

  async findMany(filter: FindObservationsFilter): Promise<ObservationRow[]> {
    const params: unknown[] = [];
    let sql = `
      SELECT
        id, event_id, platform, project, COALESCE(workspace_uid, '') AS workspace_uid, session_id,
        title, content, content_redacted, observation_type, memory_type,
        tags_json, privacy_tags_json,
        COALESCE(signal_score, 0) AS signal_score,
        COALESCE(access_count, 0) AS access_count,
        last_accessed_at,
        COALESCE(cognitive_sector, 'meta') AS cognitive_sector,
        COALESCE(user_id, 'default') AS user_id, team_id,
        created_at, updated_at
      FROM mem_observations
      WHERE 1 = 1
    `;

    if (filter.project) {
      sql += " AND project = ?";
      params.push(filter.project);
    }

    if (filter.session_id) {
      sql += " AND session_id = ?";
      params.push(filter.session_id);
    }

    if (!filter.include_private) {
      sql += " AND (privacy_tags_json IS NULL OR privacy_tags_json = '[]' OR privacy_tags_json NOT LIKE '%private%')";
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

    if (filter.cursor) {
      sql += " AND created_at < ?";
      params.push(filter.cursor);
    }

    sql += " ORDER BY created_at DESC, id DESC";

    if (filter.limit !== undefined && filter.limit > 0) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    return this.db
      .query<ObservationRow, never[]>(sql)
      .all(...(params as never[]));
  }

  async updatePrivacyTags(id: string, privacyTagsJson: string): Promise<void> {
    this.db
      .query("UPDATE mem_observations SET privacy_tags_json = ? WHERE id = ?")
      .run(privacyTagsJson, id);
  }

  async delete(id: string): Promise<void> {
    this.db
      .query("DELETE FROM mem_observations WHERE id = ?")
      .run(id);
  }

  async count(filter?: Pick<FindObservationsFilter, "project" | "include_private">): Promise<number> {
    const params: unknown[] = [];
    let sql = "SELECT COUNT(*) AS cnt FROM mem_observations WHERE 1 = 1";

    if (filter?.project) {
      sql += " AND project = ?";
      params.push(filter.project);
    }

    if (!filter?.include_private) {
      sql += " AND (privacy_tags_json IS NULL OR privacy_tags_json = '[]' OR privacy_tags_json NOT LIKE '%private%')";
    }

    const row = this.db
      .query<{ cnt: number }, never[]>(sql)
      .get(...(params as never[]));
    return Number(row?.cnt ?? 0);
  }
}
