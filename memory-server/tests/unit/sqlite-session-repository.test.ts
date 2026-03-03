/**
 * SqliteSessionRepository ユニットテスト
 *
 * インメモリ SQLite を使って ISessionRepository の全メソッドを検証する。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { SqliteSessionRepository } from "../../src/db/repositories/sqlite-session-repository";
import type { UpsertSessionInput } from "../../src/db/repositories/ISessionRepository";

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

function makeInput(overrides: Partial<UpsertSessionInput> = {}): UpsertSessionInput {
  const now = new Date().toISOString();
  return {
    session_id: `sess_${Math.random().toString(36).slice(2, 10)}`,
    platform: "claude",
    project: "test-project",
    started_at: now,
    correlation_id: null,
    user_id: "default",
    team_id: null,
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
// upsert
// ---------------------------------------------------------------------------

describe("SqliteSessionRepository: upsert", () => {
  test("upsert 後に findById で取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const input = makeInput({ session_id: "sess_001" });
    await repo.upsert(input);
    const row = await repo.findById("sess_001");
    expect(row).not.toBeNull();
    expect(row?.session_id).toBe("sess_001");
    expect(row?.platform).toBe("claude");
    expect(row?.project).toBe("test-project");
  });

  test("重複 session_id を upsert しても INSERT OR IGNORE で無視される", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const now = new Date().toISOString();
    const input = makeInput({ session_id: "sess_dup", platform: "claude" });
    await repo.upsert(input);
    await repo.upsert({ ...input, platform: "codex" }); // 上書きされない
    const row = await repo.findById("sess_dup");
    expect(row?.platform).toBe("claude"); // 元のまま
  });

  test("correlation_id が保存される", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const input = makeInput({ session_id: "sess_corr", correlation_id: "corr-xyz" });
    await repo.upsert(input);
    const row = await repo.findById("sess_corr");
    expect(row?.correlation_id).toBe("corr-xyz");
  });

  test("user_id / team_id が保存される", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const input = makeInput({ session_id: "sess_user", user_id: "alice", team_id: "team-a" });
    await repo.upsert(input);
    const row = await repo.findById("sess_user");
    expect(row?.user_id).toBe("alice");
    expect(row?.team_id).toBe("team-a");
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe("SqliteSessionRepository: findById", () => {
  test("存在しない session_id で null を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const row = await repo.findById("nonexistent");
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findMany
// ---------------------------------------------------------------------------

describe("SqliteSessionRepository: findMany", () => {
  test("project フィルターで絞り込める", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    await repo.upsert(makeInput({ session_id: "s1", project: "proj-a" }));
    await repo.upsert(makeInput({ session_id: "s2", project: "proj-b" }));
    const rows = await repo.findMany({ project: "proj-a" });
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("s1");
  });

  test("limit で件数を制限できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    for (let i = 0; i < 5; i++) {
      await repo.upsert(makeInput({ session_id: `s_limit_${i}` }));
    }
    const rows = await repo.findMany({ limit: 3 });
    expect(rows.length).toBe(3);
  });

  test("フィルターなしで全件返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    await repo.upsert(makeInput({ session_id: "sAll1" }));
    await repo.upsert(makeInput({ session_id: "sAll2" }));
    const rows = await repo.findMany({});
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

describe("SqliteSessionRepository: finalize", () => {
  test("finalize 後に ended_at / summary / summary_mode が更新される", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const input = makeInput({ session_id: "sess_fin" });
    await repo.upsert(input);

    const now = new Date().toISOString();
    await repo.finalize({
      session_id: "sess_fin",
      ended_at: now,
      summary: "Test summary",
      summary_mode: "standard",
      updated_at: now,
    });

    const row = await repo.findById("sess_fin");
    expect(row?.ended_at).toBe(now);
    expect(row?.summary).toBe("Test summary");
    expect(row?.summary_mode).toBe("standard");
  });

  test("存在しない session_id を finalize してもエラーにならない", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const now = new Date().toISOString();
    await expect(
      repo.finalize({
        session_id: "sess_ghost",
        ended_at: now,
        summary: "ghost",
        summary_mode: "standard",
        updated_at: now,
      })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findByCorrelationId
// ---------------------------------------------------------------------------

describe("SqliteSessionRepository: findByCorrelationId", () => {
  test("同一 correlation_id のセッションチェーンを取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const corrId = "corr-abc";
    await repo.upsert(makeInput({ session_id: "sc1", correlation_id: corrId, project: "myproject" }));
    await repo.upsert(makeInput({ session_id: "sc2", correlation_id: corrId, project: "myproject" }));
    await repo.upsert(makeInput({ session_id: "sc3", correlation_id: "other", project: "myproject" }));

    const rows = await repo.findByCorrelationId(corrId, "myproject");
    const ids = rows.map((r) => r.session_id);
    expect(ids).toContain("sc1");
    expect(ids).toContain("sc2");
    expect(ids).not.toContain("sc3");
  });

  test("異なる project は除外される", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const corrId = "corr-proj";
    await repo.upsert(makeInput({ session_id: "sp1", correlation_id: corrId, project: "proj-a" }));
    await repo.upsert(makeInput({ session_id: "sp2", correlation_id: corrId, project: "proj-b" }));

    const rows = await repo.findByCorrelationId(corrId, "proj-a");
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("sp1");
  });

  test("該当なし の場合は空配列を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const rows = await repo.findByCorrelationId("nonexistent-corr", "any-project");
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

describe("SqliteSessionRepository: count", () => {
  test("upsert 件数と一致する", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const before = await repo.count();
    await repo.upsert(makeInput());
    await repo.upsert(makeInput());
    const after = await repo.count();
    expect(after - before).toBe(2);
  });

  test("0件の場合は 0 を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteSessionRepository(db);
    const cnt = await repo.count();
    expect(cnt).toBe(0);
  });
});
