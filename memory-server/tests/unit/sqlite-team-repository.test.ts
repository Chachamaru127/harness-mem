/**
 * SqliteTeamRepository ユニットテスト (TEAM-002)
 *
 * インメモリ SQLite を使って ITeamRepository の全メソッドを検証する。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { SqliteTeamRepository } from "../../src/db/repositories/SqliteTeamRepository";
import type { CreateTeamInput } from "../../src/db/repositories/ITeamRepository";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function createDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

function makeTeamInput(overrides: Partial<CreateTeamInput> = {}): CreateTeamInput {
  const now = new Date().toISOString();
  return {
    team_id: `team_${Math.random().toString(36).slice(2, 10)}`,
    name: "Test Team",
    description: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const openDbs: Database[] = [];

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
});

// ---------------------------------------------------------------------------
// create / findById
// ---------------------------------------------------------------------------

describe("SqliteTeamRepository: create", () => {
  test("create 後に findById で取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    const input = makeTeamInput({ team_id: "team-001", name: "Engineering" });

    const created = await repo.create(input);

    expect(created.team_id).toBe("team-001");
    expect(created.name).toBe("Engineering");
    expect(created.description).toBeNull();
    expect(created.created_at).toBe(input.created_at);
  });

  test("description が設定されている場合は保存される", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    const input = makeTeamInput({
      team_id: "team-002",
      name: "Design",
      description: "Design team",
    });

    const created = await repo.create(input);

    expect(created.description).toBe("Design team");
  });

  test("findById: 存在しない team_id は null を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);

    const result = await repo.findById("nonexistent-team");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe("SqliteTeamRepository: findAll", () => {
  test("チームが存在しない場合は空配列を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);

    const result = await repo.findAll();

    expect(result).toEqual([]);
  });

  test("複数チームを作成後に全件取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);

    await repo.create(makeTeamInput({ team_id: "team-a", name: "Alpha" }));
    await repo.create(makeTeamInput({ team_id: "team-b", name: "Beta" }));
    await repo.create(makeTeamInput({ team_id: "team-c", name: "Gamma" }));

    const result = await repo.findAll();

    expect(result).toHaveLength(3);
    const ids = result.map((r) => r.team_id);
    expect(ids).toContain("team-a");
    expect(ids).toContain("team-b");
    expect(ids).toContain("team-c");
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("SqliteTeamRepository: update", () => {
  test("name を更新できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    const now = new Date().toISOString();
    await repo.create(makeTeamInput({ team_id: "team-upd", name: "Old Name" }));

    const updated = await repo.update("team-upd", { name: "New Name", updated_at: now });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("New Name");
    expect(updated!.team_id).toBe("team-upd");
  });

  test("description を null に更新できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    const now = new Date().toISOString();
    await repo.create(
      makeTeamInput({ team_id: "team-desc", name: "Team", description: "Some desc" })
    );

    const updated = await repo.update("team-desc", { description: null, updated_at: now });

    expect(updated!.description).toBeNull();
  });

  test("存在しない team_id の update は null を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    const now = new Date().toISOString();

    const result = await repo.update("ghost-team", { name: "Ghost", updated_at: now });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("SqliteTeamRepository: delete", () => {
  test("存在するチームを削除すると true が返り findById が null になる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    await repo.create(makeTeamInput({ team_id: "team-del" }));

    const result = await repo.delete("team-del");
    const row = await repo.findById("team-del");

    expect(result).toBe(true);
    expect(row).toBeNull();
  });

  test("存在しない team_id の delete は false を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);

    const result = await repo.delete("nonexistent");

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addMember / removeMember / getMembers
// ---------------------------------------------------------------------------

describe("SqliteTeamRepository: メンバー管理", () => {
  test("addMember 後に getMembers でメンバーを取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    await repo.create(makeTeamInput({ team_id: "team-mem" }));

    await repo.addMember("team-mem", "user-1", "admin");
    await repo.addMember("team-mem", "user-2", "member");

    const members = await repo.getMembers("team-mem");

    expect(members).toHaveLength(2);
    const userIds = members.map((m) => m.user_id);
    expect(userIds).toContain("user-1");
    expect(userIds).toContain("user-2");
  });

  test("addMember は同じユーザーを重複追加しても無視される（冪等）", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    await repo.create(makeTeamInput({ team_id: "team-dup" }));

    await repo.addMember("team-dup", "user-dup", "member");
    await repo.addMember("team-dup", "user-dup", "admin"); // 重複 → IGNORE

    const members = await repo.getMembers("team-dup");

    expect(members).toHaveLength(1);
    // 最初の role が保持される
    expect(members[0].role).toBe("member");
  });

  test("removeMember でメンバーを削除できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    await repo.create(makeTeamInput({ team_id: "team-rm" }));
    await repo.addMember("team-rm", "user-a", "member");
    await repo.addMember("team-rm", "user-b", "member");

    const result = await repo.removeMember("team-rm", "user-a");
    const members = await repo.getMembers("team-rm");

    expect(result).toBe(true);
    expect(members).toHaveLength(1);
    expect(members[0].user_id).toBe("user-b");
  });

  test("removeMember: 存在しないメンバーは false を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    await repo.create(makeTeamInput({ team_id: "team-nouser" }));

    const result = await repo.removeMember("team-nouser", "ghost-user");

    expect(result).toBe(false);
  });

  test("getMembers: チームが存在しない場合は空配列を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);

    const members = await repo.getMembers("nonexistent-team");

    expect(members).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateMemberRole
// ---------------------------------------------------------------------------

describe("SqliteTeamRepository: updateMemberRole", () => {
  test("メンバーのロールを更新できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    await repo.create(makeTeamInput({ team_id: "team-role" }));
    await repo.addMember("team-role", "user-r", "member");

    const result = await repo.updateMemberRole("team-role", "user-r", "admin");
    const members = await repo.getMembers("team-role");

    expect(result).toBe(true);
    expect(members[0].role).toBe("admin");
  });

  test("存在しないメンバーのロール更新は false を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    await repo.create(makeTeamInput({ team_id: "team-norole" }));

    const result = await repo.updateMemberRole("team-norole", "ghost", "admin");

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CASCADE 削除の検証
// ---------------------------------------------------------------------------

describe("SqliteTeamRepository: CASCADE 削除", () => {
  test("チーム削除時にメンバーも削除される", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteTeamRepository(db);
    await repo.create(makeTeamInput({ team_id: "team-cascade" }));
    await repo.addMember("team-cascade", "user-x", "member");
    await repo.addMember("team-cascade", "user-y", "admin");

    await repo.delete("team-cascade");

    // メンバーも消えているか確認
    const members = await repo.getMembers("team-cascade");
    expect(members).toEqual([]);
  });
});
