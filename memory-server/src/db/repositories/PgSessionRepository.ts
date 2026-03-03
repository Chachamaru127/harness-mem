/**
 * PgSessionRepository
 *
 * ISessionRepository の PostgreSQL 実装。
 * AsyncStorageAdapter の queryAllAsync / queryOneAsync / runAsync を経由して
 * 全メソッドを実装する。
 *
 * SQL は SqliteSessionRepository と同じロジックだが、
 * INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING に変換する。
 * パラメーター プレースホルダーは adapter 側で ? → $N 変換が行われる。
 */

import type { AsyncStorageAdapter } from "../storage-adapter.js";
import type {
  ISessionRepository,
  SessionRow,
  UpsertSessionInput,
  FinalizeSessionInput,
  FindSessionsFilter,
} from "./ISessionRepository.js";

export class PgSessionRepository implements ISessionRepository {
  constructor(private readonly adapter: AsyncStorageAdapter) {}

  async upsert(input: UpsertSessionInput): Promise<void> {
    await this.adapter.runAsync(
      `
      INSERT INTO mem_sessions
        (session_id, platform, project, started_at, correlation_id, user_id, team_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (session_id) DO NOTHING
      `,
      [
        input.session_id,
        input.platform,
        input.project,
        input.started_at,
        input.correlation_id ?? null,
        input.user_id ?? "default",
        input.team_id ?? null,
        input.created_at,
        input.updated_at,
      ]
    );
  }

  async findById(sessionId: string): Promise<SessionRow | null> {
    return this.adapter.queryOneAsync<SessionRow>(
      `
      SELECT
        session_id, platform, project,
        COALESCE(workspace_uid, '') AS workspace_uid,
        started_at, ended_at,
        summary, summary_mode, correlation_id,
        COALESCE(user_id, 'default') AS user_id,
        team_id, created_at, updated_at
      FROM mem_sessions
      WHERE session_id = ?
      `,
      [sessionId]
    );
  }

  async findMany(filter: FindSessionsFilter): Promise<SessionRow[]> {
    const params: unknown[] = [];
    let sql = `
      SELECT
        session_id, platform, project,
        COALESCE(workspace_uid, '') AS workspace_uid,
        started_at, ended_at,
        summary, summary_mode, correlation_id,
        COALESCE(user_id, 'default') AS user_id,
        team_id, created_at, updated_at
      FROM mem_sessions
      WHERE 1 = 1
    `;

    if (filter.project) {
      sql += " AND project = ?";
      params.push(filter.project);
    }

    if (!filter.include_private) {
      sql += " AND platform != '__private'";
    }

    sql += " ORDER BY updated_at DESC";

    if (filter.limit !== undefined && filter.limit > 0) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    return this.adapter.queryAllAsync<SessionRow>(sql, params);
  }

  async finalize(input: FinalizeSessionInput): Promise<void> {
    await this.adapter.runAsync(
      `
      UPDATE mem_sessions
      SET ended_at = ?, summary = ?, summary_mode = ?, updated_at = ?
      WHERE session_id = ?
      `,
      [
        input.ended_at,
        input.summary,
        input.summary_mode,
        input.updated_at,
        input.session_id,
      ]
    );
  }

  async findByCorrelationId(correlationId: string, project: string): Promise<SessionRow[]> {
    return this.adapter.queryAllAsync<SessionRow>(
      `
      SELECT
        session_id, platform, project,
        COALESCE(workspace_uid, '') AS workspace_uid,
        started_at, ended_at,
        summary, summary_mode, correlation_id,
        COALESCE(user_id, 'default') AS user_id,
        team_id, created_at, updated_at
      FROM mem_sessions
      WHERE correlation_id = ? AND project = ?
      ORDER BY started_at ASC
      `,
      [correlationId, project]
    );
  }

  async count(): Promise<number> {
    const row = await this.adapter.queryOneAsync<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM mem_sessions"
    );
    return Number(row?.cnt ?? 0);
  }
}
