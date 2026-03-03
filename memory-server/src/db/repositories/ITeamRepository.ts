/**
 * ITeamRepository
 *
 * チームデータの永続化に関する async-first リポジトリインターフェース。
 * 実装は SQLite / PostgreSQL 等のバックエンドに依存しない。
 */

// ---------------------------------------------------------------------------
// 行型定義
// ---------------------------------------------------------------------------

export interface TeamRow {
  team_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

export interface CreateTeamInput {
  team_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// インターフェース
// ---------------------------------------------------------------------------

export interface ITeamRepository {
  /**
   * チームを1件作成する。
   * @returns 作成されたチームの行データ
   */
  create(input: CreateTeamInput): Promise<TeamRow>;

  /**
   * team_id でチームを1件取得する。存在しない場合は null。
   */
  findById(teamId: string): Promise<TeamRow | null>;

  /**
   * 全チームを取得する。
   */
  findAll(): Promise<TeamRow[]>;

  /**
   * チームを更新する。存在しない場合は null。
   */
  update(teamId: string, input: UpdateTeamInput): Promise<TeamRow | null>;

  /**
   * チームを削除する（メンバーも CASCADE 削除）。
   * @returns 削除できた場合 true、対象が存在しなかった場合 false
   */
  delete(teamId: string): Promise<boolean>;

  /**
   * チームにメンバーを追加する。既に追加済みの場合は何もしない（IGNORE）。
   */
  addMember(teamId: string, userId: string, role: string): Promise<void>;

  /**
   * チームからメンバーを削除する。
   * @returns 削除できた場合 true、対象が存在しなかった場合 false
   */
  removeMember(teamId: string, userId: string): Promise<boolean>;

  /**
   * チームのメンバー一覧を取得する。
   */
  getMembers(teamId: string): Promise<TeamMemberRow[]>;

  /**
   * チームメンバーのロールを更新する。
   * @returns 更新できた場合 true、対象が存在しなかった場合 false
   */
  updateMemberRole(teamId: string, userId: string, role: string): Promise<boolean>;
}
