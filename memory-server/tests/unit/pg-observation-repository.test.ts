/**
 * PgObservationRepository ユニットテスト
 *
 * AsyncStorageAdapter のモックを使って全メソッドを検証する。
 * 実際の PostgreSQL 接続は不要。
 */

import { describe, expect, test } from "bun:test";
import { PgObservationRepository } from "../../src/db/repositories/PgObservationRepository";
import type { AsyncStorageAdapter } from "../../src/db/storage-adapter";
import type { InsertObservationInput } from "../../src/db/repositories/IObservationRepository";

// ---------------------------------------------------------------------------
// モック AsyncStorageAdapter
// ---------------------------------------------------------------------------

interface CallRecord {
  method: string;
  sql: string;
  params: unknown[];
}

/**
 * テスト用モックアダプタ。
 * - `store`: INSERT された行を保持するインメモリストア
 * - `calls`: 呼び出し履歴
 */
function createMockAdapter(initialRows: Record<string, unknown>[] = []): {
  adapter: AsyncStorageAdapter;
  store: Map<string, Record<string, unknown>>;
  calls: CallRecord[];
} {
  const store = new Map<string, Record<string, unknown>>(
    initialRows.map((r) => [String(r.id), r])
  );
  const calls: CallRecord[] = [];

  const adapter: AsyncStorageAdapter = {
    async queryAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      calls.push({ method: "queryAllAsync", sql, params });
      const lowerSql = sql.toLowerCase().trim();

      // INSERT ... ON CONFLICT DO NOTHING は行を追加して 0 件返す
      if (lowerSql.startsWith("insert")) return [] as T[];

      // findByIds: WHERE id IN (...)
      if (lowerSql.includes("where id in")) {
        const ids = params as string[];
        return ids.flatMap((id) => {
          const row = store.get(id);
          return row ? [normalizeForPg(row)] : [];
        }) as T[];
      }

      // findMany: WHERE 1 = 1 ...
      if (lowerSql.startsWith("select") && lowerSql.includes("where 1 = 1")) {
        let rows = [...store.values()].map(normalizeForPg);

        // project フィルター
        const projectMatch = sql.match(/AND project = \?/i);
        if (projectMatch) {
          const projectIdx = extractParamIndexForClause(sql, "AND project = ?");
          const projectVal = params[projectIdx] as string | undefined;
          if (projectVal) rows = rows.filter((r) => r.project === projectVal);
        }

        // session_id フィルター
        const sessionMatch = sql.match(/AND session_id = \?/i);
        if (sessionMatch) {
          const sessionIdx = extractParamIndexForClause(sql, "AND session_id = ?");
          const sessionVal = params[sessionIdx] as string | undefined;
          if (sessionVal) rows = rows.filter((r) => r.session_id === sessionVal);
        }

        // privacy フィルター (private タグ除外)
        if (sql.includes("privacy_tags_json @>")) {
          rows = rows.filter((r) => {
            const tags = Array.isArray(r.privacy_tags_json) ? r.privacy_tags_json : [];
            return !tags.includes("private");
          });
        }

        // memory_type フィルター
        const memTypeMatch = sql.match(/AND memory_type = \?/i);
        if (memTypeMatch) {
          const mtIdx = extractParamIndexForClause(sql, "AND memory_type = ?");
          const mtVal = params[mtIdx] as string | undefined;
          if (mtVal) rows = rows.filter((r) => r.memory_type === mtVal);
        }

        // cursor (created_at <)
        if (sql.includes("AND created_at < ?")) {
          const cursorIdx = extractParamIndexForClause(sql, "AND created_at < ?");
          const cursorVal = params[cursorIdx] as string | undefined;
          if (cursorVal) rows = rows.filter((r) => String(r.created_at) < cursorVal);
        }

        // limit
        const limitMatch = sql.match(/LIMIT \?/i);
        if (limitMatch) {
          const limitIdx = params.length - 1;
          const limitVal = Number(params[limitIdx]);
          if (limitVal > 0) rows = rows.slice(0, limitVal);
        }

        return rows as T[];
      }

      return [] as T[];
    },

    async queryOneAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      calls.push({ method: "queryOneAsync", sql, params });
      const lowerSql = sql.toLowerCase().trim();

      // findById: WHERE id = ?
      if (lowerSql.includes("where id = ?")) {
        const id = params[0] as string;
        const row = store.get(id);
        return row != null ? (normalizeForPg(row) as T) : null;
      }

      // count: SELECT COUNT(*)
      if (lowerSql.startsWith("select count(*)")) {
        let rows = [...store.values()];
        if (sql.includes("AND project = ?")) {
          const projectVal = params[0] as string | undefined;
          if (projectVal) rows = rows.filter((r) => r.project === projectVal);
        }
        if (sql.includes("privacy_tags_json @>")) {
          rows = rows.filter((r) => {
            const tags = Array.isArray(r.privacy_tags_json) ? r.privacy_tags_json : [];
            return !tags.includes("private");
          });
        }
        return { cnt: rows.length } as T;
      }

      return null;
    },

    async runAsync(sql: string, params: unknown[] = []): Promise<number> {
      calls.push({ method: "runAsync", sql, params });
      const lowerSql = sql.toLowerCase().trim();

      if (lowerSql.startsWith("insert")) {
        // ON CONFLICT DO NOTHING: id が既存なら何もしない
        const id = params[0] as string;
        if (!store.has(id)) {
          const now = params[15] as string ?? new Date().toISOString();
          store.set(id, {
            id,
            event_id: params[1] ?? null,
            platform: params[2],
            project: params[3],
            session_id: params[4],
            title: params[5] ?? null,
            content: params[6],
            content_redacted: params[7],
            observation_type: params[8],
            memory_type: params[9],
            tags_json: params[10] ?? "[]",
            privacy_tags_json: params[11] ?? "[]",
            signal_score: params[12] ?? 0,
            user_id: params[13] ?? "default",
            team_id: params[14] ?? null,
            created_at: params[15],
            updated_at: params[16],
            workspace_uid: "",
            access_count: 0,
            last_accessed_at: null,
            cognitive_sector: "meta",
          });
          return 1;
        }
        return 0;
      }

      if (lowerSql.startsWith("update mem_observations set privacy_tags_json")) {
        const privacyTagsJson = params[0] as string;
        const id = params[1] as string;
        const row = store.get(id);
        if (row) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(privacyTagsJson);
          } catch {
            parsed = [];
          }
          store.set(id, { ...row, privacy_tags_json: parsed });
          return 1;
        }
        return 0;
      }

      if (lowerSql.startsWith("delete from mem_observations")) {
        const id = params[0] as string;
        if (store.has(id)) {
          store.delete(id);
          return 1;
        }
        return 0;
      }

      return 0;
    },

    async execAsync(_sql: string): Promise<void> {
      // noop
    },

    async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };

  return { adapter, store, calls };
}

/** store の行を PG 返却値（JSONB は配列/オブジェクト）に変換 */
function normalizeForPg(row: Record<string, unknown>): Record<string, unknown> {
  const parseJson = (v: unknown) => {
    if (Array.isArray(v) || (typeof v === "object" && v !== null)) return v;
    try {
      return JSON.parse(String(v ?? "[]"));
    } catch {
      return [];
    }
  };
  return {
    ...row,
    tags_json: parseJson(row.tags_json),
    privacy_tags_json: parseJson(row.privacy_tags_json),
  };
}

/** SQL 内でのパラメータ位置（0-indexed）を ? の出現順で算出する簡易ヘルパー */
function extractParamIndexForClause(sql: string, clause: string): number {
  const before = sql.indexOf(clause);
  if (before === -1) return 0;
  const prefix = sql.slice(0, before);
  return (prefix.match(/\?/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// テストデータヘルパー
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// insert
// ---------------------------------------------------------------------------

describe("PgObservationRepository: insert", () => {
  test("insert が観察 ID を返す", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const input = makeInput({ id: "obs_pg_001" });
    const id = await repo.insert(input);
    expect(id).toBe("obs_pg_001");
  });

  test("insert 後に findById で取得できる", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const input = makeInput({ id: "obs_pg_002", title: "pg title" });
    await repo.insert(input);
    const row = await repo.findById("obs_pg_002");
    expect(row).not.toBeNull();
    expect(row?.title).toBe("pg title");
  });

  test("重複 ID では ON CONFLICT DO NOTHING が動く（元データが保持される）", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const input = makeInput({ id: "obs_pg_dup", title: "original" });
    await repo.insert(input);
    await repo.insert({ ...input, title: "overwritten" });
    const row = await repo.findById("obs_pg_dup");
    expect(row?.title).toBe("original");
  });

  test("memory_type のデフォルトが semantic", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const { memory_type: _, ...rest } = makeInput({ id: "obs_pg_memtype" });
    await repo.insert(rest as InsertObservationInput);
    const row = await repo.findById("obs_pg_memtype");
    expect(row?.memory_type).toBe("semantic");
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe("PgObservationRepository: findById", () => {
  test("存在しない ID で null を返す", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const row = await repo.findById("nonexistent");
    expect(row).toBeNull();
  });

  test("PG JSONB カラムが文字列として返る", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const input = makeInput({ id: "obs_pg_json", tags_json: '["ai","memory"]' });
    await repo.insert(input);
    const row = await repo.findById("obs_pg_json");
    expect(typeof row?.tags_json).toBe("string");
    expect(JSON.parse(row!.tags_json)).toEqual(["ai", "memory"]);
  });
});

// ---------------------------------------------------------------------------
// findByIds
// ---------------------------------------------------------------------------

describe("PgObservationRepository: findByIds", () => {
  test("空配列で空配列を返す", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const rows = await repo.findByIds([]);
    expect(rows).toEqual([]);
  });

  test("複数 ID で対応する行を返す", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const a = makeInput({ id: "obs_pg_a" });
    const b = makeInput({ id: "obs_pg_b" });
    const c = makeInput({ id: "obs_pg_c" });
    await repo.insert(a);
    await repo.insert(b);
    await repo.insert(c);
    const rows = await repo.findByIds(["obs_pg_a", "obs_pg_c"]);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs_pg_a", "obs_pg_c"]);
  });
});

// ---------------------------------------------------------------------------
// findMany
// ---------------------------------------------------------------------------

describe("PgObservationRepository: findMany", () => {
  test("project フィルターで絞り込める", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    await repo.insert(makeInput({ id: "obs_pm1", project: "proj-a" }));
    await repo.insert(makeInput({ id: "obs_pm2", project: "proj-b" }));
    const rows = await repo.findMany({ project: "proj-a" });
    expect(rows.length).toBe(1);
    expect(rows[0].project).toBe("proj-a");
  });

  test("private タグを持つ行は include_private=false で除外される", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    await repo.insert(makeInput({ id: "obs_pub", privacy_tags_json: "[]" }));
    await repo.insert(makeInput({ id: "obs_priv", privacy_tags_json: '["private"]' }));
    const rows = await repo.findMany({ include_private: false });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain("obs_priv");
    expect(ids).toContain("obs_pub");
  });

  test("memory_type フィルターが機能する", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    await repo.insert(makeInput({ id: "obs_ep", memory_type: "episodic" }));
    await repo.insert(makeInput({ id: "obs_se", memory_type: "semantic" }));
    const rows = await repo.findMany({ memory_type: "episodic" });
    expect(rows.every((r) => r.memory_type === "episodic")).toBe(true);
  });

  test("limit で件数を制限できる", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    for (let i = 0; i < 5; i++) {
      await repo.insert(makeInput({ id: `obs_lim_${i}` }));
    }
    const rows = await repo.findMany({ limit: 3 });
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// updatePrivacyTags
// ---------------------------------------------------------------------------

describe("PgObservationRepository: updatePrivacyTags", () => {
  test("privacy_tags_json が更新される", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const input = makeInput({ id: "obs_upd_priv" });
    await repo.insert(input);
    await repo.updatePrivacyTags("obs_upd_priv", '["private"]');
    // findById で更新後の値を確認
    const row = await repo.findById("obs_upd_priv");
    // モックでは privacy_tags_json は配列→文字列化される
    expect(JSON.parse(row!.privacy_tags_json)).toContain("private");
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("PgObservationRepository: delete", () => {
  test("delete 後に findById で null を返す", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const input = makeInput({ id: "obs_del_pg" });
    await repo.insert(input);
    await repo.delete("obs_del_pg");
    const row = await repo.findById("obs_del_pg");
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

describe("PgObservationRepository: count", () => {
  test("挿入件数と一致する", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const before = await repo.count({ include_private: true });
    await repo.insert(makeInput());
    await repo.insert(makeInput());
    const after = await repo.count({ include_private: true });
    expect(after - before).toBe(2);
  });

  test("project フィルターで絞り込める", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    await repo.insert(makeInput({ id: "obs_cnt1", project: "proj-x" }));
    await repo.insert(makeInput({ id: "obs_cnt2", project: "proj-x" }));
    await repo.insert(makeInput({ id: "obs_cnt3", project: "proj-y" }));
    const count = await repo.count({ project: "proj-x", include_private: true });
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// normalizeRow: ObservationRow 型フィールド検証
// ---------------------------------------------------------------------------

describe("PgObservationRepository: ObservationRow 型フィールド", () => {
  test("全フィールドが正しい型で返る", async () => {
    const { adapter } = createMockAdapter();
    const repo = new PgObservationRepository(adapter);
    const input = makeInput({ id: "obs_fields", signal_score: 0.5 });
    await repo.insert(input);
    const row = await repo.findById("obs_fields");
    expect(row).not.toBeNull();
    expect(typeof row!.id).toBe("string");
    expect(typeof row!.workspace_uid).toBe("string");
    expect(typeof row!.access_count).toBe("number");
    expect(typeof row!.signal_score).toBe("number");
    expect(typeof row!.cognitive_sector).toBe("string");
    expect(row!.last_accessed_at).toBeNull();
    expect(typeof row!.tags_json).toBe("string");
    expect(typeof row!.privacy_tags_json).toBe("string");
  });
});
