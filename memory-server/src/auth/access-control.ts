/**
 * TEAM-005: データアクセス制御
 *
 * スコープ別アクセス制御フィルタを生成する純粋関数モジュール。
 *
 * スコープ:
 *   - admin: 全データアクセス可（フィルタなし）
 *   - member: 自分(user_id) OR 同チーム(team_id) のデータのみ
 *   - factsMode: mem_facts は全社共有なのでフィルタなし
 */

import type { TokenRole } from "./token-resolver";

export interface AccessContext {
  user_id: string;
  team_id?: string;
  role: TokenRole;
}

export interface AccessFilterOptions {
  /** true にすると mem_facts 用（全社共有）でフィルタを省略する */
  factsMode?: boolean;
}

export interface AccessFilter {
  /** クエリに追加する SQL 句。空文字の場合はフィルタなし（全許可） */
  sql: string;
  /** sql 中の ? に対応するパラメータ配列 */
  params: unknown[];
}

/**
 * リクエスト者のアクセスコンテキストに基づき、SQLクエリに追加するフィルタ句を生成する。
 *
 * @param tableAlias - フィルタを適用するテーブルエイリアス（例: "o", "s"）
 * @param ctx - アクセスコンテキスト（user_id, team_id, role）
 * @param options - オプション（factsMode など）
 * @returns { sql, params } - "AND (..." の形式のSQL句とパラメータ配列
 */
export function buildAccessFilter(
  tableAlias: string,
  ctx: AccessContext,
  options: AccessFilterOptions = {}
): AccessFilter {
  // admin は全バイパス
  if (ctx.role === "admin") {
    return { sql: "", params: [] };
  }

  // factsMode は全社共有（mem_facts はチームフィルタなし）
  if (options.factsMode) {
    return { sql: "", params: [] };
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  // 自分のデータ（user_id 一致）
  conditions.push(`${tableAlias}.user_id = ?`);
  params.push(ctx.user_id);

  // 同チームのデータ（team_id 一致）
  if (ctx.team_id) {
    conditions.push(`${tableAlias}.team_id = ?`);
    params.push(ctx.team_id);
  }

  const sql = `AND (${conditions.join(" OR ")})`;
  return { sql, params };
}
