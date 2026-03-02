/**
 * TEAM-005: データアクセス制御 のテスト
 *
 * スコープ別アクセス制御:
 *   - 自分: R/W
 *   - 同チーム: R のみ
 *   - 別チーム: NG
 *   - Admin: 全バイパス
 *   - mem_facts: 全社共有 R
 */
import { describe, expect, test } from "bun:test";
import { buildAccessFilter, type AccessContext } from "../../src/auth/access-control";

describe("TEAM-005: データアクセス制御", () => {
  test("admin ロールはフィルタが空（全バイパス）", () => {
    const ctx: AccessContext = { user_id: "admin", team_id: undefined, role: "admin" };
    const { sql, params } = buildAccessFilter("o", ctx);
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  test("member は自分のデータを読める（user_id 一致）", () => {
    const ctx: AccessContext = { user_id: "ohashi", team_id: "it-team", role: "member" };
    const { sql, params } = buildAccessFilter("o", ctx);
    expect(sql).toContain("o.user_id = ?");
    expect(params).toContain("ohashi");
  });

  test("member は同チームのデータを読める（team_id 一致）", () => {
    const ctx: AccessContext = { user_id: "ohashi", team_id: "it-team", role: "member" };
    const { sql, params } = buildAccessFilter("o", ctx);
    expect(sql).toContain("o.team_id = ?");
    expect(params).toContain("it-team");
  });

  test("user_id と team_id の条件は OR で結合される", () => {
    const ctx: AccessContext = { user_id: "ohashi", team_id: "it-team", role: "member" };
    const { sql } = buildAccessFilter("o", ctx);
    expect(sql).toContain(" OR ");
  });

  test("team_id が未設定の member は自分のデータのみ（OR team_id なし）", () => {
    const ctx: AccessContext = { user_id: "solo", team_id: undefined, role: "member" };
    const { sql, params } = buildAccessFilter("o", ctx);
    expect(sql).toContain("o.user_id = ?");
    expect(params).toContain("solo");
    // team_id 条件は含まれない
    expect(sql).not.toContain("team_id");
  });

  test("テーブルエイリアスが正しく使われる", () => {
    const ctx: AccessContext = { user_id: "alice", team_id: "dev", role: "member" };
    const { sql } = buildAccessFilter("s", ctx);
    expect(sql).toContain("s.user_id = ?");
    expect(sql).toContain("s.team_id = ?");
  });

  test("factsMode=true は team_id フィルタなし（全社共有）", () => {
    const ctx: AccessContext = { user_id: "ohashi", team_id: "it-team", role: "member" };
    const { sql, params } = buildAccessFilter("f", ctx, { factsMode: true });
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  test("sql は AND で始まる句として使える形式", () => {
    const ctx: AccessContext = { user_id: "ohashi", team_id: "it-team", role: "member" };
    const { sql } = buildAccessFilter("o", ctx);
    // sql は " AND (...)" の形式 または 空文字
    if (sql) {
      expect(sql.trimStart()).toMatch(/^AND\s/);
    }
  });
});
