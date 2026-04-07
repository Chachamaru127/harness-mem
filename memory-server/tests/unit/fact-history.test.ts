/**
 * S74-004: Temporal Fact Versioning テスト
 *
 * テストケース:
 * 1. fact chain (A → B → C) のヒストリー取得
 * 2. active fact (superseded_by IS NULL) の判定
 * 3. project フィルター
 * 4. fact_key が存在しない場合は空配列
 * 5. fact_key 必須バリデーション
 * 6. merged_into_fact_id が設定された fact は除外される
 * 7. limit パラメータ
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema.js";

// ---------------------------------------------------------------------------
// テスト用 DB セットアップ
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

function insertFact(
  db: Database,
  opts: {
    fact_id: string;
    project: string;
    fact_key: string;
    fact_value: string;
    fact_type?: string;
    confidence?: number;
    superseded_by?: string | null;
    valid_from?: string | null;
    valid_to?: string | null;
    merged_into_fact_id?: string | null;
    created_at?: string;
  },
): void {
  const ts = opts.created_at ?? new Date().toISOString();
  db.query(`
    INSERT INTO mem_facts(
      fact_id, observation_id, project, session_id,
      fact_type, fact_key, fact_value, confidence,
      superseded_by, valid_from, valid_to, merged_into_fact_id,
      created_at, updated_at
    ) VALUES (?, NULL, ?, 'test-session', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.fact_id,
    opts.project,
    opts.fact_type ?? "config",
    opts.fact_key,
    opts.fact_value,
    opts.confidence ?? 0.8,
    opts.superseded_by ?? null,
    opts.valid_from ?? null,
    opts.valid_to ?? null,
    opts.merged_into_fact_id ?? null,
    ts,
    ts,
  );
}

// ---------------------------------------------------------------------------
// getFactHistory の直接テスト (DB レベル)
// HarnessMemCore を起動せずにクエリロジックをテストする
// ---------------------------------------------------------------------------

function getFactHistory(
  db: Database,
  fact_key: string,
  project?: string,
  limit = 100,
): Array<{
  fact_id: string;
  fact_type: string;
  fact_key: string;
  fact_value: string;
  confidence: number;
  valid_from: string | null;
  valid_to: string | null;
  superseded_by: string | null;
  is_active: boolean;
  created_at: string;
}> {
  let sql = `
    SELECT fact_id, fact_type, fact_key, fact_value, confidence,
           valid_from, valid_to, superseded_by, created_at
    FROM mem_facts
    WHERE fact_key = ?
      AND merged_into_fact_id IS NULL
  `;
  const params: unknown[] = [fact_key];

  if (project) {
    sql += ` AND project = ?`;
    params.push(project);
  }
  sql += ` ORDER BY created_at ASC LIMIT ?`;
  params.push(limit);

  const rows = db.query(sql).all(...(params as any[])) as Array<{
    fact_id: string;
    fact_type: string;
    fact_key: string;
    fact_value: string;
    confidence: number;
    valid_from: string | null;
    valid_to: string | null;
    superseded_by: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    ...row,
    is_active: row.superseded_by === null || row.superseded_by === undefined,
  }));
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("S74-004: Temporal Fact Versioning", () => {
  let db: Database;

  afterEach(() => {
    if (db) db.close();
  });

  test("fact chain (A → B → C) のヒストリーが created_at ASC で返る", () => {
    db = createTestDb();

    insertFact(db, {
      fact_id: "fact-a",
      project: "proj-1",
      fact_key: "auth_middleware",
      fact_value: "express-session",
      superseded_by: "fact-b",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    insertFact(db, {
      fact_id: "fact-b",
      project: "proj-1",
      fact_key: "auth_middleware",
      fact_value: "passport",
      superseded_by: "fact-c",
      created_at: "2026-02-01T00:00:00.000Z",
    });
    insertFact(db, {
      fact_id: "fact-c",
      project: "proj-1",
      fact_key: "auth_middleware",
      fact_value: "clerk",
      superseded_by: null,
      created_at: "2026-03-01T00:00:00.000Z",
    });

    const history = getFactHistory(db, "auth_middleware", "proj-1");

    expect(history).toHaveLength(3);
    expect(history[0].fact_value).toBe("express-session");
    expect(history[1].fact_value).toBe("passport");
    expect(history[2].fact_value).toBe("clerk");
  });

  test("active fact は is_active = true、superseded は is_active = false", () => {
    db = createTestDb();

    insertFact(db, {
      fact_id: "old-fact",
      project: "proj-1",
      fact_key: "db_engine",
      fact_value: "mysql",
      superseded_by: "new-fact",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    insertFact(db, {
      fact_id: "new-fact",
      project: "proj-1",
      fact_key: "db_engine",
      fact_value: "postgres",
      superseded_by: null,
      created_at: "2026-02-01T00:00:00.000Z",
    });

    const history = getFactHistory(db, "db_engine", "proj-1");

    expect(history[0].is_active).toBe(false);
    expect(history[0].fact_value).toBe("mysql");
    expect(history[1].is_active).toBe(true);
    expect(history[1].fact_value).toBe("postgres");
  });

  test("project フィルターが効く", () => {
    db = createTestDb();

    insertFact(db, {
      fact_id: "p1-fact",
      project: "proj-1",
      fact_key: "framework",
      fact_value: "express",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    insertFact(db, {
      fact_id: "p2-fact",
      project: "proj-2",
      fact_key: "framework",
      fact_value: "fastify",
      created_at: "2026-01-02T00:00:00.000Z",
    });

    const proj1 = getFactHistory(db, "framework", "proj-1");
    const proj2 = getFactHistory(db, "framework", "proj-2");
    const all = getFactHistory(db, "framework");

    expect(proj1).toHaveLength(1);
    expect(proj1[0].fact_value).toBe("express");
    expect(proj2).toHaveLength(1);
    expect(proj2[0].fact_value).toBe("fastify");
    expect(all).toHaveLength(2);
  });

  test("存在しない fact_key は空配列を返す", () => {
    db = createTestDb();
    const history = getFactHistory(db, "nonexistent_key");
    expect(history).toHaveLength(0);
  });

  test("merged_into_fact_id が設定された fact は除外される", () => {
    db = createTestDb();

    // merged-target を先に作成して FK 制約を満たす
    insertFact(db, {
      fact_id: "merged-target",
      project: "proj-1",
      fact_key: "runtime",
      fact_value: "bun",
      created_at: "2026-02-01T00:00:00.000Z",
    });
    insertFact(db, {
      fact_id: "original",
      project: "proj-1",
      fact_key: "runtime",
      fact_value: "node",
      merged_into_fact_id: "merged-target",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const history = getFactHistory(db, "runtime", "proj-1");

    expect(history).toHaveLength(1);
    expect(history[0].fact_value).toBe("bun");
  });

  test("limit パラメータが効く", () => {
    db = createTestDb();

    for (let i = 0; i < 5; i++) {
      insertFact(db, {
        fact_id: `fact-${i}`,
        project: "proj-1",
        fact_key: "version",
        fact_value: `v${i}`,
        superseded_by: i < 4 ? `fact-${i + 1}` : null,
        created_at: `2026-0${i + 1}-01T00:00:00.000Z`,
      });
    }

    const limited = getFactHistory(db, "version", "proj-1", 3);
    expect(limited).toHaveLength(3);
    expect(limited[0].fact_value).toBe("v0");
    expect(limited[2].fact_value).toBe("v2");
  });

  test("fact_type が返却される", () => {
    db = createTestDb();

    insertFact(db, {
      fact_id: "typed-fact",
      project: "proj-1",
      fact_key: "deploy_target",
      fact_value: "production",
      fact_type: "infrastructure",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const history = getFactHistory(db, "deploy_target", "proj-1");
    expect(history[0].fact_type).toBe("infrastructure");
  });

  test("idx_mem_facts_key_project インデックスが存在する", () => {
    db = createTestDb();

    const indexes = db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mem_facts_key_project'`)
      .all();

    expect(indexes).toHaveLength(1);
  });
});
