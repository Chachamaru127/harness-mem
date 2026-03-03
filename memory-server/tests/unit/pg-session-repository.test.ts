/**
 * PgSessionRepository ユニットテスト
 *
 * 実際の PostgreSQL 接続なしで ISessionRepository の全メソッドを検証する。
 * インメモリ SQLite を AsyncStorageAdapter として薄くラップし、
 * PgSessionRepository のロジック（SQL、パラメーター構築）を検証する。
 *
 * テストケース（8件以上）:
 *  upsert:
 *   1. upsert 後に findById で取得できる
 *   2. 重複 session_id を upsert しても上書きされない（ON CONFLICT DO NOTHING）
 *   3. correlation_id が保存される
 *   4. user_id / team_id が保存される
 *  findMany:
 *   5. project フィルターで絞り込める
 *   6. limit で件数を制限できる
 *   7. include_private=false で __private platform を除外
 *  finalize:
 *   8. finalize 後に ended_at / summary / summary_mode が更新される
 *   9. 存在しない session_id を finalize してもエラーにならない
 *  findByCorrelationId:
 *  10. 同一 correlation_id のチェーンを取得できる
 *  11. 異なる project は除外される
 *  count:
 *  12. upsert 件数と一致する
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import type { AsyncStorageAdapter } from "../../src/db/storage-adapter";
import { PgSessionRepository } from "../../src/db/repositories/PgSessionRepository";
import type { UpsertSessionInput } from "../../src/db/repositories/ISessionRepository";

// ---------------------------------------------------------------------------
// SQLite を AsyncStorageAdapter として薄くラップするテスト用アダプター
// ---------------------------------------------------------------------------

/**
 * インメモリ SQLite を AsyncStorageAdapter に適合させる。
 * ? プレースホルダーをそのまま使用する（translateSql 不要）。
 */
class SqliteAsyncAdapter implements AsyncStorageAdapter {
  constructor(private readonly db: Database) {}

  async queryAllAsync<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.query<T, never[]>(sql).all(...(params as never[]));
  }

  async queryOneAsync<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const row = this.db.query<T, never[]>(sql).get(...(params as never[]));
    return row ?? null;
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<number> {
    // INSERT OR IGNORE → ON CONFLICT DO NOTHING（同じ意味で SQLite でも動作する）
    const normalized = sql.replace(/INSERT\s+OR\s+IGNORE/gi, "INSERT OR IGNORE");
    // ON CONFLICT DO NOTHING は SQLite でも有効
    const result = this.db.query(sql).run(...(params as never[]));
    return Number(result.changes);
  }

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function createAdapter(): { db: Database; adapter: SqliteAsyncAdapter } {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return { db, adapter: new SqliteAsyncAdapter(db) };
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
// upsert / findById
// ---------------------------------------------------------------------------

describe("PgSessionRepository: upsert", () => {
  test("upsert 後に findById で取得できる", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const input = makeInput({ session_id: "pg_sess_001" });
    await repo.upsert(input);
    const row = await repo.findById("pg_sess_001");
    expect(row).not.toBeNull();
    expect(row?.session_id).toBe("pg_sess_001");
    expect(row?.platform).toBe("claude");
    expect(row?.project).toBe("test-project");
  });

  test("重複 session_id を upsert しても ON CONFLICT DO NOTHING で上書きされない", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const now = new Date().toISOString();
    const input = makeInput({ session_id: "pg_sess_dup", platform: "claude" });
    await repo.upsert(input);
    await repo.upsert({ ...input, platform: "codex" }); // 上書きされない
    const row = await repo.findById("pg_sess_dup");
    expect(row?.platform).toBe("claude"); // 元のまま
  });

  test("correlation_id が保存される", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const input = makeInput({ session_id: "pg_sess_corr", correlation_id: "corr-pg-xyz" });
    await repo.upsert(input);
    const row = await repo.findById("pg_sess_corr");
    expect(row?.correlation_id).toBe("corr-pg-xyz");
  });

  test("user_id / team_id が保存される", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const input = makeInput({ session_id: "pg_sess_user", user_id: "alice", team_id: "team-pg" });
    await repo.upsert(input);
    const row = await repo.findById("pg_sess_user");
    expect(row?.user_id).toBe("alice");
    expect(row?.team_id).toBe("team-pg");
  });
});

describe("PgSessionRepository: findById", () => {
  test("存在しない session_id で null を返す", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const row = await repo.findById("nonexistent-pg");
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findMany
// ---------------------------------------------------------------------------

describe("PgSessionRepository: findMany", () => {
  test("project フィルターで絞り込める", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    await repo.upsert(makeInput({ session_id: "pg_s1", project: "proj-pg-a" }));
    await repo.upsert(makeInput({ session_id: "pg_s2", project: "proj-pg-b" }));
    const rows = await repo.findMany({ project: "proj-pg-a" });
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("pg_s1");
  });

  test("limit で件数を制限できる", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    for (let i = 0; i < 5; i++) {
      await repo.upsert(makeInput({ session_id: `pg_limit_${i}` }));
    }
    const rows = await repo.findMany({ limit: 3 });
    expect(rows.length).toBe(3);
  });

  test("include_private=false で platform='__private' のセッションを除外する", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    await repo.upsert(makeInput({ session_id: "pg_pub", platform: "claude" }));
    await repo.upsert(makeInput({ session_id: "pg_priv", platform: "__private" }));
    const rows = await repo.findMany({ include_private: false });
    const ids = rows.map((r) => r.session_id);
    expect(ids).toContain("pg_pub");
    expect(ids).not.toContain("pg_priv");
  });

  test("フィルターなしで全件返す", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    await repo.upsert(makeInput({ session_id: "pg_all_1" }));
    await repo.upsert(makeInput({ session_id: "pg_all_2" }));
    const rows = await repo.findMany({});
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

describe("PgSessionRepository: finalize", () => {
  test("finalize 後に ended_at / summary / summary_mode が更新される", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const input = makeInput({ session_id: "pg_sess_fin" });
    await repo.upsert(input);

    const now = new Date().toISOString();
    await repo.finalize({
      session_id: "pg_sess_fin",
      ended_at: now,
      summary: "PG Test summary",
      summary_mode: "standard",
      updated_at: now,
    });

    const row = await repo.findById("pg_sess_fin");
    expect(row?.ended_at).toBe(now);
    expect(row?.summary).toBe("PG Test summary");
    expect(row?.summary_mode).toBe("standard");
  });

  test("存在しない session_id を finalize してもエラーにならない", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const now = new Date().toISOString();
    await expect(
      repo.finalize({
        session_id: "pg_sess_ghost",
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

describe("PgSessionRepository: findByCorrelationId", () => {
  test("同一 correlation_id のセッションチェーンを取得できる", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const corrId = "pg-corr-abc";
    await repo.upsert(makeInput({ session_id: "pg_sc1", correlation_id: corrId, project: "pg-project" }));
    await repo.upsert(makeInput({ session_id: "pg_sc2", correlation_id: corrId, project: "pg-project" }));
    await repo.upsert(makeInput({ session_id: "pg_sc3", correlation_id: "other-corr", project: "pg-project" }));

    const rows = await repo.findByCorrelationId(corrId, "pg-project");
    const ids = rows.map((r) => r.session_id);
    expect(ids).toContain("pg_sc1");
    expect(ids).toContain("pg_sc2");
    expect(ids).not.toContain("pg_sc3");
  });

  test("異なる project は除外される", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const corrId = "pg-corr-proj";
    await repo.upsert(makeInput({ session_id: "pg_sp1", correlation_id: corrId, project: "pg-proj-a" }));
    await repo.upsert(makeInput({ session_id: "pg_sp2", correlation_id: corrId, project: "pg-proj-b" }));

    const rows = await repo.findByCorrelationId(corrId, "pg-proj-a");
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("pg_sp1");
  });

  test("該当なし の場合は空配列を返す", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const rows = await repo.findByCorrelationId("pg-nonexistent-corr", "any-project");
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

describe("PgSessionRepository: count", () => {
  test("upsert 件数と一致する", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const before = await repo.count();
    await repo.upsert(makeInput());
    await repo.upsert(makeInput());
    const after = await repo.count();
    expect(after - before).toBe(2);
  });

  test("0件の場合は 0 を返す", async () => {
    const { db, adapter } = createAdapter();
    openDbs.push(db);
    const repo = new PgSessionRepository(adapter);
    const cnt = await repo.count();
    expect(cnt).toBe(0);
  });
});
