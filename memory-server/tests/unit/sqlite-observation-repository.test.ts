/**
 * SqliteObservationRepository ユニットテスト
 *
 * インメモリ SQLite を使って IObservationRepository の全メソッドを検証する。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { SqliteObservationRepository } from "../../src/db/repositories/SqliteObservationRepository";
import type { InsertObservationInput } from "../../src/db/repositories/IObservationRepository";

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

function makeInput(overrides: Partial<InsertObservationInput> = {}): InsertObservationInput {
  const now = new Date().toISOString();
  return {
    id: `obs_${Math.random().toString(36).slice(2, 10)}`,
    event_id: null,
    platform: "claude",
    project: "test-project",
    session_id: "session-001",
    title: "Test observation",
    content: "Test content body",
    content_redacted: "Test content body",
    observation_type: "context",
    memory_type: "semantic",
    tags_json: "[]",
    privacy_tags_json: "[]",
    signal_score: 0,
    user_id: "default",
    team_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function ensureSession(db: Database, sessionId: string, project = "test-project"): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_sessions
     (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, "claude", project, now, now, now);
}

const openDbs: Database[] = [];

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
});

// ---------------------------------------------------------------------------
// insert
// ---------------------------------------------------------------------------

describe("SqliteObservationRepository: insert", () => {
  test("insert が観察 ID を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const input = makeInput({ id: "obs_abc123" });
    const id = await repo.insert(input);
    expect(id).toBe("obs_abc123");
  });

  test("insert 後に findById で取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const input = makeInput({ title: "my title", content: "hello world" });
    await repo.insert(input);
    const row = await repo.findById(input.id);
    expect(row).not.toBeNull();
    expect(row?.title).toBe("my title");
    expect(row?.content).toBe("hello world");
  });

  test("重複 ID を INSERT すると無視される（INSERT OR IGNORE）", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const input = makeInput({ id: "obs_dup" });
    await repo.insert(input);
    await repo.insert({ ...input, title: "overwritten" });
    const row = await repo.findById("obs_dup");
    expect(row?.title).toBe(input.title); // 元のまま
  });

  test("memory_type のデフォルトが semantic", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const { memory_type: _, ...rest } = makeInput();
    await repo.insert(rest as InsertObservationInput);
    const row = await repo.findById(rest.id);
    expect(row?.memory_type).toBe("semantic");
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe("SqliteObservationRepository: findById", () => {
  test("存在しない ID で null を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteObservationRepository(db);
    const row = await repo.findById("nonexistent");
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByIds
// ---------------------------------------------------------------------------

describe("SqliteObservationRepository: findByIds", () => {
  test("空配列で空配列を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = new SqliteObservationRepository(db);
    const rows = await repo.findByIds([]);
    expect(rows).toEqual([]);
  });

  test("複数 ID で対応する行を取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const a = makeInput({ id: "obs_a" });
    const b = makeInput({ id: "obs_b" });
    const c = makeInput({ id: "obs_c" });
    await repo.insert(a);
    await repo.insert(b);
    await repo.insert(c);
    const rows = await repo.findByIds(["obs_a", "obs_c"]);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs_a", "obs_c"]);
  });
});

// ---------------------------------------------------------------------------
// findMany
// ---------------------------------------------------------------------------

describe("SqliteObservationRepository: findMany", () => {
  test("project フィルターで絞り込める", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001", "proj-a");
    ensureSession(db, "session-002", "proj-b");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs_1", project: "proj-a", session_id: "session-001" }));
    await repo.insert(makeInput({ id: "obs_2", project: "proj-b", session_id: "session-002" }));
    const rows = await repo.findMany({ project: "proj-a" });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("obs_1");
  });

  test("limit で件数を制限できる", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    for (let i = 0; i < 5; i++) {
      await repo.insert(makeInput({ id: `obs_limit_${i}` }));
    }
    const rows = await repo.findMany({ limit: 3 });
    expect(rows.length).toBe(3);
  });

  test("memory_type フィルターが機能する", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs_ep", memory_type: "episodic" }));
    await repo.insert(makeInput({ id: "obs_se", memory_type: "semantic" }));
    const rows = await repo.findMany({ memory_type: "episodic" });
    expect(rows.every((r) => r.memory_type === "episodic")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updatePrivacyTags
// ---------------------------------------------------------------------------

describe("SqliteObservationRepository: updatePrivacyTags", () => {
  test("privacy_tags_json が更新される", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const input = makeInput({ id: "obs_priv" });
    await repo.insert(input);
    await repo.updatePrivacyTags("obs_priv", '["private"]');
    const row = await repo.findById("obs_priv");
    expect(row?.privacy_tags_json).toBe('["private"]');
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("SqliteObservationRepository: delete", () => {
  test("delete 後に findById で null を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const input = makeInput({ id: "obs_del" });
    await repo.insert(input);
    await repo.delete("obs_del");
    const row = await repo.findById("obs_del");
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

describe("SqliteObservationRepository: count", () => {
  test("挿入件数と一致する", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const before = await repo.count();
    await repo.insert(makeInput());
    await repo.insert(makeInput());
    const after = await repo.count();
    expect(after - before).toBe(2);
  });

  test("project フィルターで絞り込める", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001", "proj-x");
    ensureSession(db, "session-002", "proj-y");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs_cx1", project: "proj-x", session_id: "session-001" }));
    await repo.insert(makeInput({ id: "obs_cx2", project: "proj-x", session_id: "session-001" }));
    await repo.insert(makeInput({ id: "obs_cy1", project: "proj-y", session_id: "session-002" }));
    const count = await repo.count({ project: "proj-x" });
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PG-001: 後付けカラムのデフォルト値検証
// ---------------------------------------------------------------------------

describe("SqliteObservationRepository: PG-001 後付けカラム", () => {
  test("findById が access_count / last_accessed_at / cognitive_sector / workspace_uid を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    const input = makeInput({ id: "obs_pg001_a" });
    await repo.insert(input);
    const row = await repo.findById("obs_pg001_a");
    expect(row).not.toBeNull();
    // access_count はデフォルト 0
    expect(row?.access_count).toBe(0);
    // last_accessed_at はデフォルト null
    expect(row?.last_accessed_at).toBeNull();
    // cognitive_sector はデフォルト 'meta'
    expect(row?.cognitive_sector).toBe("meta");
    // workspace_uid はデフォルト ''（COALESCE で空文字列に正規化）
    expect(row?.workspace_uid).toBe("");
    // signal_score はデフォルト 0
    expect(row?.signal_score).toBe(0);
  });

  test("findByIds が複数行で後付けカラムを正しく返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs_pg001_b1" }));
    await repo.insert(makeInput({ id: "obs_pg001_b2", signal_score: 0.8 }));
    const rows = await repo.findByIds(["obs_pg001_b1", "obs_pg001_b2"]);
    expect(rows.length).toBe(2);
    const b1 = rows.find((r) => r.id === "obs_pg001_b1");
    const b2 = rows.find((r) => r.id === "obs_pg001_b2");
    expect(b1?.signal_score).toBe(0);
    expect(b2?.signal_score).toBeCloseTo(0.8, 5);
    // 全行で workspace_uid が文字列として返る
    for (const row of rows) {
      expect(typeof row.workspace_uid).toBe("string");
      expect(typeof row.cognitive_sector).toBe("string");
      expect(typeof row.access_count).toBe("number");
    }
  });
});
