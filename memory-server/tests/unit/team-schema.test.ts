/**
 * TEAM-001: チーム関連テーブルのスキーマテスト
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";

function createTestDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

describe("TEAM-001: mem_teams テーブル", () => {
  test("mem_teams / mem_team_members / mem_team_invitations が作成される", () => {
    const db = createTestDb();

    const tables = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mem_team%' ORDER BY name"
    ).all();

    const names = tables.map((t) => t.name);
    expect(names).toContain("mem_teams");
    expect(names).toContain("mem_team_members");
    expect(names).toContain("mem_team_invitations");

    db.close();
  });

  test("mem_teams への INSERT / SELECT が正常動作する", () => {
    const db = createTestDb();
    const now = new Date().toISOString();

    db.query(
      "INSERT INTO mem_teams (team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("team-1", "Engineering", "Engineering team", now, now);

    const row = db.query<{
      team_id: string;
      name: string;
      description: string | null;
    }>("SELECT team_id, name, description FROM mem_teams WHERE team_id = ?").get("team-1");

    expect(row?.team_id).toBe("team-1");
    expect(row?.name).toBe("Engineering");
    expect(row?.description).toBe("Engineering team");

    db.close();
  });

  test("mem_team_members は team_id 削除時に CASCADE 削除される", () => {
    const db = createTestDb();
    const now = new Date().toISOString();

    db.query(
      "INSERT INTO mem_teams (team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("team-x", "Temp", null, now, now);

    db.query(
      "INSERT INTO mem_team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
    ).run("team-x", "user-1", "admin", now);

    db.query(
      "INSERT INTO mem_team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
    ).run("team-x", "user-2", "member", now);

    const beforeDelete = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM mem_team_members WHERE team_id = ?"
    ).get("team-x");
    expect(beforeDelete?.cnt).toBe(2);

    db.query("DELETE FROM mem_teams WHERE team_id = ?").run("team-x");

    const afterDelete = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM mem_team_members WHERE team_id = ?"
    ).get("team-x");
    expect(afterDelete?.cnt).toBe(0);

    db.close();
  });
});

describe("TEAM-001: migrateSchema による既存DB対応", () => {
  test("initSchema + migrateSchema を重複実行してもエラーにならない（冪等性）", () => {
    // 既存DBに対して initSchema + migrateSchema が2回呼ばれるケースをシミュレート
    const db = new Database(":memory:");
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    // 2回目の実行でもエラーにならないことを確認
    expect(() => {
      initSchema(db);
      migrateSchema(db);
    }).not.toThrow();

    const tables = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mem_team%' ORDER BY name"
    ).all();

    const names = tables.map((t) => t.name);
    expect(names).toContain("mem_teams");
    expect(names).toContain("mem_team_members");
    expect(names).toContain("mem_team_invitations");

    db.close();
  });
});
