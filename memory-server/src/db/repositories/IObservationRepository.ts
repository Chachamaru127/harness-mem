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
  /** S78-D01: Temporal forgetting — TTL。null = 無期限 */
  expires_at: string | null;
  /** S78-E02: Branch-scoped memory — git ブランチ名。null = スコープなし */
  branch: string | null;
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
  /** S78-D01: Temporal forgetting — ISO-8601 または Unix 秒。null = 無期限 */
  expires_at?: string | null;
  /** S78-E02: Branch-scoped memory — git ブランチ名。null = スコープなし */
  branch?: string | null;
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
  /** S78-D01: true のとき期限切れ観察も含む（デフォルト false = 除外）*/
  include_expired?: boolean;
  /**
   * S78-E02: Branch-scoped memory フィルタ。
   * - 未指定: 全観察を返す（後方互換）
   * - "main" または任意のブランチ名: そのブランチの観察 + branch IS NULL（レガシー行）を返す。
   *   これにより main スコープのコンテキストは常に全ブランチから参照可能。
   */
  branch?: string;
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
