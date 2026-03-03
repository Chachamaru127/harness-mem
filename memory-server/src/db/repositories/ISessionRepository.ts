/**
 * ISessionRepository
 *
 * セッションデータの永続化に関する async-first リポジトリインターフェース。
 */

// ---------------------------------------------------------------------------
// 行型定義
// ---------------------------------------------------------------------------

export interface SessionRow {
  session_id: string;
  platform: string;
  project: string;
  workspace_uid: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  summary_mode: string | null;
  correlation_id: string | null;
  user_id: string;
  team_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertSessionInput {
  session_id: string;
  platform: string;
  project: string;
  started_at: string;
  correlation_id?: string | null;
  user_id?: string;
  team_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinalizeSessionInput {
  session_id: string;
  ended_at: string;
  summary: string;
  summary_mode: string;
  updated_at: string;
}

export interface FindSessionsFilter {
  project?: string;
  include_private?: boolean;
  limit?: number;
}

// ---------------------------------------------------------------------------
// インターフェース
// ---------------------------------------------------------------------------

export interface ISessionRepository {
  /**
   * セッションを upsert する（存在しない場合は INSERT、存在する場合は IGNORE）。
   */
  upsert(input: UpsertSessionInput): Promise<void>;

  /**
   * session_id でセッションを1件取得する。存在しない場合は null。
   */
  findById(sessionId: string): Promise<SessionRow | null>;

  /**
   * フィルター条件に一致するセッション一覧を取得する。
   */
  findMany(filter: FindSessionsFilter): Promise<SessionRow[]>;

  /**
   * セッションを完了状態にする（summary, ended_at を更新）。
   */
  finalize(input: FinalizeSessionInput): Promise<void>;

  /**
   * correlation_id でセッションチェーンを解決する。
   */
  findByCorrelationId(correlationId: string, project: string): Promise<SessionRow[]>;

  /**
   * セッションの総数を返す。
   */
  count(): Promise<number>;
}
