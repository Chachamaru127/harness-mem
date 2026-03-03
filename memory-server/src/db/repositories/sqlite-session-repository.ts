/**
 * SqliteSessionRepository
 *
 * ISessionRepository の SQLite 実装。
 * bun:sqlite の Database を直接使用し、同期 API を Promise でラップする。
 * SQL クエリは session-manager.ts から移植。
 */

import type { Database } from "bun:sqlite";
import type {
  ISessionRepository,
  SessionRow,
  UpsertSessionInput,
  FinalizeSessionInput,
  FindSessionsFilter,
} from "./ISessionRepository.js";

export class SqliteSessionRepository implements ISessionRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: UpsertSessionInput): Promise<void> {
    this.db
      .query(
        `
        INSERT OR IGNORE INTO mem_sessions
          (session_id, platform, project, started_at, correlation_id, user_id, team_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.session_id,
        input.platform,
        input.project,
        input.started_at,
        input.correlation_id ?? null,
        input.user_id ?? "default",
        input.team_id ?? null,
        input.created_at,
        input.updated_at
      );
  }

  async findById(sessionId: string): Promise<SessionRow | null> {
    const row = this.db
      .query<SessionRow, [string]>(
        `
        SELECT
          session_id, platform, project, started_at, ended_at,
          summary, summary_mode, correlation_id,
          user_id, team_id, created_at, updated_at
        FROM mem_sessions
        WHERE session_id = ?
      `
      )
      .get(sessionId);
    return row ?? null;
  }

  async findMany(filter: FindSessionsFilter): Promise<SessionRow[]> {
    const params: unknown[] = [];
    let sql = `
      SELECT
        session_id, platform, project, started_at, ended_at,
        summary, summary_mode, correlation_id,
        user_id, team_id, created_at, updated_at
      FROM mem_sessions
      WHERE 1 = 1
    `;

    if (filter.project) {
      sql += " AND project = ?";
      params.push(filter.project);
    }

    if (!filter.include_private) {
      // platform が '__private' のものは除外（platformVisibilityFilterSql 相当）
      sql += " AND platform != '__private'";
    }

    sql += " ORDER BY updated_at DESC";

    if (filter.limit !== undefined && filter.limit > 0) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    return this.db
      .query<SessionRow, never[]>(sql)
      .all(...(params as never[]));
  }

  async finalize(input: FinalizeSessionInput): Promise<void> {
    this.db
      .query(
        `
        UPDATE mem_sessions
        SET ended_at = ?, summary = ?, summary_mode = ?, updated_at = ?
        WHERE session_id = ?
      `
      )
      .run(
        input.ended_at,
        input.summary,
        input.summary_mode,
        input.updated_at,
        input.session_id
      );
  }

  async findByCorrelationId(correlationId: string, project: string): Promise<SessionRow[]> {
    return this.db
      .query<SessionRow, [string, string]>(
        `
        SELECT session_id, platform, project, started_at, ended_at,
               summary, summary_mode, correlation_id,
               user_id, team_id, created_at, updated_at
        FROM mem_sessions
        WHERE correlation_id = ? AND project = ?
        ORDER BY started_at ASC
      `
      )
      .all(correlationId, project);
  }

  async count(): Promise<number> {
    const row = this.db
      .query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM mem_sessions")
      .get();
    return Number(row?.cnt ?? 0);
  }
}
