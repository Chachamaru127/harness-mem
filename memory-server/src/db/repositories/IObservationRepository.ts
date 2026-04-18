/**
 * IObservationRepository
 *
 * 観察データの永続化に関する async-first リポジトリインターフェース。
 * 実装は SQLite / PostgreSQL 等のバックエンドに依存しない。
 */

// ---------------------------------------------------------------------------
// 行型定義
// ---------------------------------------------------------------------------

export interface ObservationRow {
  id: string;
  event_id: string | null;
  platform: string;
  project: string;
  workspace_uid: string;
  session_id: string;
  title: string | null;
  content: string;
  content_redacted: string;
  observation_type: string;
  memory_type: string;
  tags_json: string;
  privacy_tags_json: string;
  signal_score: number;
  access_count: number;
  last_accessed_at: string | null;
  cognitive_sector: string;
  user_id: string;
  team_id: string | null;
  created_at: string;
  updated_at: string;
  /** S78-B02: 階層メタデータ */
  thread_id: string | null;
  topic: string | null;
}

export interface InsertObservationInput {
  id: string;
  event_id: string | null;
  platform: string;
  project: string;
  session_id: string;
  title: string | null;
  content: string;
  content_redacted: string;
  observation_type: string;
  memory_type?: string;
  tags_json: string;
  privacy_tags_json: string;
  signal_score?: number;
  user_id?: string;
  team_id?: string | null;
  created_at: string;
  updated_at: string;
  /** S78-B02: 階層メタデータ */
  thread_id?: string | null;
  topic?: string | null;
}

export interface FindObservationsFilter {
  project?: string;
  session_id?: string;
  include_private?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  memory_type?: string | string[];
  /** S78-B02: 階層メタデータフィルタ */
  thread_id?: string;
  topic?: string;
}

// ---------------------------------------------------------------------------
// インターフェース
// ---------------------------------------------------------------------------

export interface IObservationRepository {
  /**
   * 観察を1件挿入する（重複時は無視）。
   * @returns 挿入された観察の ID
   */
  insert(input: InsertObservationInput): Promise<string>;

  /**
   * ID で観察を1件取得する。存在しない場合は null。
   */
  findById(id: string): Promise<ObservationRow | null>;

  /**
   * 複数 ID で観察をまとめて取得する。
   */
  findByIds(ids: string[]): Promise<ObservationRow[]>;

  /**
   * フィルター条件に一致する観察を取得する。
   */
  findMany(filter: FindObservationsFilter): Promise<ObservationRow[]>;

  /**
   * 観察の privacy_tags を更新する。
   */
  updatePrivacyTags(id: string, privacyTagsJson: string): Promise<void>;

  /**
   * 観察を削除する（物理削除）。
   */
  delete(id: string): Promise<void>;

  /**
   * 観察の総数を返す。
   */
  count(filter?: Pick<FindObservationsFilter, "project" | "include_private">): Promise<number>;
}
