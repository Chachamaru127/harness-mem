/**
 * postgres-adapter-integration.test.ts
 *
 * PostgresStorageAdapter の全非同期メソッドを mock PgClientLike で検証する統合テスト。
 * 実 PostgreSQL サーバーは不要。
 */
import { describe, expect, test } from "bun:test";
import {
  PostgresStorageAdapter,
  type PgClientLike,
  rewriteParams,
  translateSql,
} from "../../src/db/postgres-adapter";
import { createStorageAdapter } from "../../src/db/adapter-factory";
import { SqliteStorageAdapter } from "../../src/db/sqlite-adapter";
import { POSTGRES_INIT_SQL } from "../../src/db/postgres-schema";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockPgClient(
  responses: Array<{ rows: unknown[]; rowCount: number | null }> = []
): PgClientLike & { calls: Array<{ text: string; values?: unknown[] }> } {
  let callIndex = 0;
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  return {
    calls,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return responses[callIndex++] ?? { rows: [], rowCount: 0 };
    },
    async end() {},
  };
}

// ---------------------------------------------------------------------------
// queryAllAsync
// ---------------------------------------------------------------------------

describe("PostgresStorageAdapter.queryAllAsync", () => {
  test("returns all rows from the mock client", async () => {
    const rows = [{ id: 1, name: "alpha" }, { id: 2, name: "beta" }];
    const client = createMockPgClient([{ rows, rowCount: 2 }]);
    const adapter = new PostgresStorageAdapter(client);

    const result = await adapter.queryAllAsync<{ id: number; name: string }>(
      "SELECT id, name FROM mem_observations WHERE project = ?",
      ["test-project"]
    );

    expect(result).toEqual(rows);
    expect(client.calls).toHaveLength(1);
    // ? should be rewritten to $1
    expect(client.calls[0]!.text).toBe(
      "SELECT id, name FROM mem_observations WHERE project = $1"
    );
    expect(client.calls[0]!.values).toEqual(["test-project"]);
  });

  test("returns empty array when no rows", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: 0 }]);
    const adapter = new PostgresStorageAdapter(client);

    const result = await adapter.queryAllAsync("SELECT 1 WHERE false");
    expect(result).toEqual([]);
  });

  test("passes multiple parameters in order", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: 0 }]);
    const adapter = new PostgresStorageAdapter(client);

    await adapter.queryAllAsync(
      "SELECT * FROM t WHERE a = ? AND b = ? AND c = ?",
      ["x", 42, true]
    );

    expect(client.calls[0]!.text).toBe(
      "SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3"
    );
    expect(client.calls[0]!.values).toEqual(["x", 42, true]);
  });
});

// ---------------------------------------------------------------------------
// queryOneAsync
// ---------------------------------------------------------------------------

describe("PostgresStorageAdapter.queryOneAsync", () => {
  test("returns first row when result has rows", async () => {
    const row = { session_id: "sess-1", platform: "claude" };
    const client = createMockPgClient([{ rows: [row], rowCount: 1 }]);
    const adapter = new PostgresStorageAdapter(client);

    const result = await adapter.queryOneAsync<typeof row>(
      "SELECT session_id, platform FROM mem_sessions WHERE session_id = ?",
      ["sess-1"]
    );

    expect(result).toEqual(row);
  });

  test("returns null when result has no rows", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: 0 }]);
    const adapter = new PostgresStorageAdapter(client);

    const result = await adapter.queryOneAsync(
      "SELECT * FROM mem_sessions WHERE session_id = ?",
      ["nonexistent"]
    );

    expect(result).toBeNull();
  });

  test("returns only first row when multiple rows returned", async () => {
    const rows = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ];
    const client = createMockPgClient([{ rows, rowCount: 3 }]);
    const adapter = new PostgresStorageAdapter(client);

    const result = await adapter.queryOneAsync<{ id: string }>(
      "SELECT id FROM mem_observations"
    );

    expect(result).toEqual({ id: "a" });
  });
});

// ---------------------------------------------------------------------------
// runAsync
// ---------------------------------------------------------------------------

describe("PostgresStorageAdapter.runAsync", () => {
  test("returns rowCount from the client response", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: 3 }]);
    const adapter = new PostgresStorageAdapter(client);

    const count = await adapter.runAsync(
      "UPDATE mem_sessions SET ended_at = ? WHERE project = ?",
      ["2026-02-21T00:00:00Z", "proj-a"]
    );

    expect(count).toBe(3);
    expect(client.calls[0]!.text).toBe(
      "UPDATE mem_sessions SET ended_at = $1 WHERE project = $2"
    );
  });

  test("returns 0 when rowCount is null", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: null }]);
    const adapter = new PostgresStorageAdapter(client);

    const count = await adapter.runAsync("DELETE FROM mem_meta WHERE key = ?", ["noop"]);
    expect(count).toBe(0);
  });

  test("returns 0 when rowCount is 0", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: 0 }]);
    const adapter = new PostgresStorageAdapter(client);

    const count = await adapter.runAsync("DELETE FROM mem_meta WHERE key = ?", ["missing"]);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// execAsync
// ---------------------------------------------------------------------------

describe("PostgresStorageAdapter.execAsync", () => {
  test("sends SQL to the client without params", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: null }]);
    const adapter = new PostgresStorageAdapter(client);

    await adapter.execAsync("CREATE TABLE IF NOT EXISTS tmp_test (id TEXT PRIMARY KEY)");

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.text).toBe(
      "CREATE TABLE IF NOT EXISTS tmp_test (id TEXT PRIMARY KEY)"
    );
    expect(client.calls[0]!.values).toBeUndefined();
  });

  test("execAsync does not rewrite params (DDL has no ?)", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: null }]);
    const adapter = new PostgresStorageAdapter(client);

    const ddl = "ALTER TABLE mem_sessions ADD COLUMN IF NOT EXISTS new_col TEXT";
    await adapter.execAsync(ddl);

    expect(client.calls[0]!.text).toBe(ddl);
  });
});

// ---------------------------------------------------------------------------
// transactionAsync
// ---------------------------------------------------------------------------

describe("PostgresStorageAdapter.transactionAsync", () => {
  test("commits on success: sends BEGIN, user queries, then COMMIT", async () => {
    const client = createMockPgClient([
      { rows: [], rowCount: null }, // BEGIN
      { rows: [], rowCount: 1 },   // INSERT
      { rows: [], rowCount: null }, // COMMIT
    ]);
    const adapter = new PostgresStorageAdapter(client);

    const returnValue = await adapter.transactionAsync(async () => {
      await adapter.runAsync("INSERT INTO mem_meta(key, value) VALUES(?, ?)", ["k", "v"]);
      return 42;
    });

    expect(returnValue).toBe(42);
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]!.text).toBe("BEGIN");
    expect(client.calls[1]!.text).toBe(
      "INSERT INTO mem_meta(key, value) VALUES($1, $2)"
    );
    expect(client.calls[2]!.text).toBe("COMMIT");
  });

  test("rolls back on error: sends BEGIN, user queries, then ROLLBACK and rethrows", async () => {
    const client = createMockPgClient([
      { rows: [], rowCount: null }, // BEGIN
      { rows: [], rowCount: null }, // ROLLBACK (client.query after throw)
    ]);
    const adapter = new PostgresStorageAdapter(client);

    const boom = new Error("intentional failure");

    await expect(
      adapter.transactionAsync(async () => {
        throw boom;
      })
    ).rejects.toThrow("intentional failure");

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]!.text).toBe("BEGIN");
    expect(client.calls[1]!.text).toBe("ROLLBACK");
  });

  test("nested work inside transaction receives correct results", async () => {
    const rows = [{ fact_id: "f1" }];
    const client = createMockPgClient([
      { rows: [], rowCount: null }, // BEGIN
      { rows, rowCount: 1 },        // SELECT inside fn
      { rows: [], rowCount: 1 },    // UPDATE inside fn
      { rows: [], rowCount: null }, // COMMIT
    ]);
    const adapter = new PostgresStorageAdapter(client);

    const selected = await adapter.transactionAsync(async () => {
      const found = await adapter.queryAllAsync<{ fact_id: string }>(
        "SELECT fact_id FROM mem_facts WHERE project = ?",
        ["proj"]
      );
      await adapter.runAsync(
        "UPDATE mem_facts SET fact_value = ? WHERE fact_id = ?",
        ["new", "f1"]
      );
      return found;
    });

    expect(selected).toEqual(rows);
    expect(client.calls[3]!.text).toBe("COMMIT");
  });
});

// ---------------------------------------------------------------------------
// SQL rewriting end-to-end
// ---------------------------------------------------------------------------

describe("rewriteParams", () => {
  test("replaces ? with sequential $N placeholders", () => {
    expect(rewriteParams("SELECT * FROM t WHERE a = ? AND b = ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b = $2"
    );
  });

  test("does not replace ? inside single-quoted strings", () => {
    expect(rewriteParams("SELECT '?' AS literal WHERE id = ?")).toBe(
      "SELECT '?' AS literal WHERE id = $1"
    );
  });

  test("does not replace ? inside double-quoted identifiers", () => {
    expect(rewriteParams('SELECT "col?" FROM t WHERE id = ?')).toBe(
      'SELECT "col?" FROM t WHERE id = $1'
    );
  });

  test("handles SQL with no placeholders", () => {
    const sql = "SELECT NOW()";
    expect(rewriteParams(sql)).toBe(sql);
  });
});

describe("translateSql - INSERT OR IGNORE end-to-end", () => {
  test("rewrites INSERT OR IGNORE to INSERT ... ON CONFLICT DO NOTHING", async () => {
    const client = createMockPgClient([{ rows: [], rowCount: 0 }]);
    const adapter = new PostgresStorageAdapter(client);

    await adapter.runAsync(
      "INSERT OR IGNORE INTO mem_meta(key, value) VALUES(?, ?)",
      ["schema_version", "1"]
    );

    const sentSql = client.calls[0]!.text;
    expect(sentSql).not.toContain("OR IGNORE");
    expect(sentSql).toContain("INSERT");
    expect(sentSql).toContain("ON CONFLICT DO NOTHING");
    expect(sentSql).toContain("$1");
    expect(sentSql).toContain("$2");
  });

  test("translateSql preserves plain INSERT without ON CONFLICT", () => {
    const result = translateSql("INSERT INTO mem_meta(key, value) VALUES(?, ?)");
    expect(result).toBe("INSERT INTO mem_meta(key, value) VALUES($1, $2)");
    expect(result).not.toContain("ON CONFLICT");
  });

  test("translateSql handles INSERT OR IGNORE with multiple columns", () => {
    const result = translateSql(
      "INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type) VALUES(?, ?, ?)"
    );
    expect(result).not.toContain("OR IGNORE");
    expect(result).toContain("ON CONFLICT DO NOTHING");
    expect(result).toContain("$1");
    expect(result).toContain("$2");
    expect(result).toContain("$3");
  });
});

// ---------------------------------------------------------------------------
// adapter-factory
// ---------------------------------------------------------------------------

describe("createStorageAdapter", () => {
  test("local mode returns SqliteStorageAdapter, managedRequired=false", () => {
    const { adapter, managedRequired } = createStorageAdapter({
      backendMode: "local",
      dbPath: ":memory:",
    });
    try {
      expect(adapter.backend).toBe("sqlite");
      expect(adapter).toBeInstanceOf(SqliteStorageAdapter);
      expect(managedRequired).toBe(false);
    } finally {
      adapter.close();
    }
  });

  test("hybrid mode returns SqliteStorageAdapter, managedRequired=false", () => {
    const { adapter, managedRequired } = createStorageAdapter({
      backendMode: "hybrid",
      dbPath: ":memory:",
    });
    try {
      expect(adapter.backend).toBe("sqlite");
      expect(adapter).toBeInstanceOf(SqliteStorageAdapter);
      expect(managedRequired).toBe(false);
    } finally {
      adapter.close();
    }
  });

  test("managed mode returns SqliteStorageAdapter (local cache), managedRequired=true", () => {
    const { adapter, managedRequired } = createStorageAdapter({
      backendMode: "managed",
      dbPath: ":memory:",
      managedEndpoint: "https://example.com/managed",
    });
    try {
      expect(adapter.backend).toBe("sqlite");
      expect(adapter).toBeInstanceOf(SqliteStorageAdapter);
      expect(managedRequired).toBe(true);
    } finally {
      adapter.close();
    }
  });

  test("local mode throws when dbPath is missing", () => {
    expect(() =>
      createStorageAdapter({ backendMode: "local" })
    ).toThrow("dbPath is required");
  });

  test("hybrid mode throws when dbPath is missing", () => {
    expect(() =>
      createStorageAdapter({ backendMode: "hybrid" })
    ).toThrow("dbPath is required");
  });

  test("managed mode throws when dbPath is missing", () => {
    expect(() =>
      createStorageAdapter({
        backendMode: "managed",
        managedEndpoint: "https://example.com",
      })
    ).toThrow("dbPath is required");
  });

  test("managed mode throws when managedEndpoint is missing", () => {
    expect(() =>
      createStorageAdapter({ backendMode: "managed", dbPath: ":memory:" })
    ).toThrow("managedEndpoint is required");
  });

  test("unknown backendMode throws", () => {
    expect(() =>
      // @ts-expect-error intentional invalid value
      createStorageAdapter({ backendMode: "unknown" })
    ).toThrow("Unknown backend mode");
  });
});

// ---------------------------------------------------------------------------
// POSTGRES_INIT_SQL schema validation
// ---------------------------------------------------------------------------

describe("POSTGRES_INIT_SQL", () => {
  test("contains vector extension creation", () => {
    expect(POSTGRES_INIT_SQL).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  });

  test("contains tsvector column (full-text search)", () => {
    expect(POSTGRES_INIT_SQL).toContain("tsvector");
  });

  test("contains GIN index for full-text search", () => {
    expect(POSTGRES_INIT_SQL).toContain("USING GIN");
  });

  test("contains core tables", () => {
    const tables = [
      "mem_sessions",
      "mem_events",
      "mem_observations",
      "mem_tags",
      "mem_entities",
      "mem_observation_entities",
      "mem_links",
      "mem_vectors",
      "mem_facts",
      "mem_audit_log",
      "mem_consolidation_queue",
      "mem_retry_queue",
      "mem_ingest_offsets",
      "mem_meta",
      "mem_import_jobs",
    ];
    for (const table of tables) {
      expect(POSTGRES_INIT_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  test("contains vector column type for pgvector", () => {
    expect(POSTGRES_INIT_SQL).toContain("embedding vector");
  });

  test("contains TIMESTAMPTZ (timezone-aware timestamps)", () => {
    expect(POSTGRES_INIT_SQL).toContain("TIMESTAMPTZ");
  });

  test("contains JSONB columns", () => {
    expect(POSTGRES_INIT_SQL).toContain("JSONB");
  });

  test("contains SERIAL PRIMARY KEY (auto-increment)", () => {
    expect(POSTGRES_INIT_SQL).toContain("SERIAL PRIMARY KEY");
  });

  test("mem_observations has generated search_vector with setweight", () => {
    expect(POSTGRES_INIT_SQL).toContain("setweight");
    expect(POSTGRES_INIT_SQL).toContain("to_tsvector");
    expect(POSTGRES_INIT_SQL).toContain("GENERATED ALWAYS AS");
    expect(POSTGRES_INIT_SQL).toContain("STORED");
  });

  test("contains ON DELETE CASCADE for referential integrity", () => {
    expect(POSTGRES_INIT_SQL).toContain("ON DELETE CASCADE");
  });
});
