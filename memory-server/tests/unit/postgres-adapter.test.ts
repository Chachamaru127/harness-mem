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
