import { describe, expect, test } from "bun:test";
import { rewriteParams, translateSql } from "../../src/db/postgres-adapter";

describe("PostgresStorageAdapter SQL rewriting", () => {
  test("rewriteParams converts ? to $N", () => {
    expect(rewriteParams("SELECT * FROM t WHERE a = ? AND b = ?"))
      .toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
  });

  test("rewriteParams preserves ? inside single quotes", () => {
    expect(rewriteParams("SELECT * FROM t WHERE a = '?' AND b = ?"))
      .toBe("SELECT * FROM t WHERE a = '?' AND b = $1");
  });

  test("rewriteParams preserves ? inside double quotes", () => {
    expect(rewriteParams('SELECT * FROM t WHERE "col?" = ?'))
      .toBe('SELECT * FROM t WHERE "col?" = $1');
  });

  test("rewriteParams handles no placeholders", () => {
    expect(rewriteParams("SELECT 1")).toBe("SELECT 1");
  });

  test("rewriteParams handles multiple consecutive placeholders", () => {
    expect(rewriteParams("INSERT INTO t VALUES (?, ?, ?)"))
      .toBe("INSERT INTO t VALUES ($1, $2, $3)");
  });

  test("translateSql converts INSERT OR IGNORE", () => {
    const result = translateSql("INSERT OR IGNORE INTO t (a) VALUES (?)");
    expect(result).toContain("$1");
    expect(result).not.toContain("OR IGNORE");
  });

  test("translateSql preserves normal INSERT", () => {
    const result = translateSql("INSERT INTO t (a) VALUES (?)");
    expect(result).toBe("INSERT INTO t (a) VALUES ($1)");
  });
});

describe("PostgresStorageAdapter interface", () => {
  test("module exports PostgresStorageAdapter class", async () => {
    const mod = await import("../../src/db/postgres-adapter");
    expect(mod.PostgresStorageAdapter).toBeDefined();
    expect(typeof mod.PostgresStorageAdapter).toBe("function");
  });

  test("adapter has postgres backend type", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    const mockClient = {
      query: async () => ({ rows: [], rowCount: 0 }),
      end: async () => {},
    };
    const adapter = new PostgresStorageAdapter(mockClient);
    expect(adapter.backend).toBe("postgres");
    adapter.close();
  });
});

describe("PostgresStorageAdapter sync methods throw", () => {
  const { PostgresStorageAdapter } = require("../../src/db/postgres-adapter");
  const mockClient = {
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => {},
  };

  test("query().all() throws with descriptive message", () => {
    const adapter = new PostgresStorageAdapter(mockClient);
    const stmt = adapter.query("SELECT 1");
    expect(() => stmt.all()).toThrow("not yet callable synchronously");
  });

  test("query().get() throws with descriptive message", () => {
    const adapter = new PostgresStorageAdapter(mockClient);
    const stmt = adapter.query("SELECT 1");
    expect(() => stmt.get()).toThrow("not yet callable synchronously");
  });

  test("query().run() throws with descriptive message", () => {
    const adapter = new PostgresStorageAdapter(mockClient);
    const stmt = adapter.query("SELECT 1");
    expect(() => stmt.run()).toThrow("not yet callable synchronously");
  });

  test("exec() throws with descriptive message", () => {
    const adapter = new PostgresStorageAdapter(mockClient);
    expect(() => adapter.exec("CREATE TABLE t (id INT)")).toThrow("not yet callable synchronously");
  });

  test("transaction() throws with descriptive message", () => {
    const adapter = new PostgresStorageAdapter(mockClient);
    expect(() => adapter.transaction(() => {})).toThrow("not yet implemented");
  });
});

describe("PostgresStorageAdapter async API", () => {
  function createMockClient(rows: unknown[] = [], rowCount = 0) {
    const calls: { text: string; values: unknown[] }[] = [];
    return {
      calls,
      client: {
        query: async (text: string, values?: unknown[]) => {
          calls.push({ text, values: values ?? [] });
          return { rows, rowCount };
        },
        end: async () => {},
      },
    };
  }

  test("queryAllAsync returns all rows", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    const { client } = createMockClient([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    const adapter = new PostgresStorageAdapter(client);

    const result = await adapter.queryAllAsync<{ id: number; name: string }>(
      "SELECT * FROM t WHERE active = ?",
      [true]
    );

    expect(result).toEqual([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
  });

  test("queryAllAsync translates ? to $N", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    const { client, calls } = createMockClient();
    const adapter = new PostgresStorageAdapter(client);

    await adapter.queryAllAsync("SELECT * FROM t WHERE a = ? AND b = ?", ["x", "y"]);

    expect(calls[0]!.text).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
    expect(calls[0]!.values).toEqual(["x", "y"]);
  });

  test("queryOneAsync returns first row or null", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");

    // With results
    const { client: client1 } = createMockClient([{ id: 1 }]);
    const adapter1 = new PostgresStorageAdapter(client1);
    expect(await adapter1.queryOneAsync("SELECT * FROM t WHERE id = ?", [1])).toEqual({ id: 1 });

    // Without results
    const { client: client2 } = createMockClient([]);
    const adapter2 = new PostgresStorageAdapter(client2);
    expect(await adapter2.queryOneAsync("SELECT * FROM t WHERE id = ?", [999])).toBeNull();
  });

  test("runAsync returns affected row count", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    const { client } = createMockClient([], 3);
    const adapter = new PostgresStorageAdapter(client);

    const count = await adapter.runAsync("UPDATE t SET active = ? WHERE group_id = ?", [false, 5]);
    expect(count).toBe(3);
  });

  test("execAsync executes DDL without return value", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    const { client, calls } = createMockClient();
    const adapter = new PostgresStorageAdapter(client);

    await adapter.execAsync("CREATE TABLE test (id INT PRIMARY KEY)");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe("CREATE TABLE test (id INT PRIMARY KEY)");
  });

  test("transactionAsync commits on success", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    const { client, calls } = createMockClient();
    const adapter = new PostgresStorageAdapter(client);

    const result = await adapter.transactionAsync(async () => {
      return 42;
    });

    expect(result).toBe(42);
    expect(calls[0]!.text).toBe("BEGIN");
    expect(calls[1]!.text).toBe("COMMIT");
  });

  test("transactionAsync rolls back on error", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    const { client, calls } = createMockClient();
    const adapter = new PostgresStorageAdapter(client);

    await expect(
      adapter.transactionAsync(async () => {
        throw new Error("test failure");
      })
    ).rejects.toThrow("test failure");

    expect(calls[0]!.text).toBe("BEGIN");
    expect(calls[1]!.text).toBe("ROLLBACK");
  });

  test("queryAllAsync with INSERT OR IGNORE adds ON CONFLICT DO NOTHING", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    const { client, calls } = createMockClient();
    const adapter = new PostgresStorageAdapter(client);

    await adapter.queryAllAsync(
      "INSERT OR IGNORE INTO t (id, name) VALUES (?, ?)",
      [1, "test"]
    );

    expect(calls[0]!.text).not.toContain("OR IGNORE");
    expect(calls[0]!.text).toContain("$1");
    expect(calls[0]!.text).toContain("$2");
  });
});
