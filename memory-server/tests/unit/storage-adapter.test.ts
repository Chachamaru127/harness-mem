import { describe, expect, test } from "bun:test";
import { SqliteStorageAdapter } from "../../src/db/sqlite-adapter";
import { createStorageAdapter } from "../../src/db/adapter-factory";
import type { StorageAdapter } from "../../src/db/storage-adapter";

describe("SqliteStorageAdapter", () => {
  test("implements StorageAdapter interface", () => {
    const adapter = new SqliteStorageAdapter(":memory:");
    expect(adapter.backend).toBe("sqlite");
    expect(typeof adapter.query).toBe("function");
    expect(typeof adapter.exec).toBe("function");
    expect(typeof adapter.transaction).toBe("function");
    expect(typeof adapter.close).toBe("function");
    adapter.close();
  });

  test("exec and query work for basic DDL and DML", () => {
    const adapter = new SqliteStorageAdapter(":memory:");
    adapter.exec("CREATE TABLE test_t (id INTEGER PRIMARY KEY, name TEXT)");
    adapter.query("INSERT INTO test_t (id, name) VALUES (?, ?)").run(1, "alice");
    adapter.query("INSERT INTO test_t (id, name) VALUES (?, ?)").run(2, "bob");

    const all = adapter.query<{ id: number; name: string }>("SELECT * FROM test_t ORDER BY id").all();
    expect(all).toHaveLength(2);
    expect(all[0]?.name).toBe("alice");
    expect(all[1]?.name).toBe("bob");

    const one = adapter.query<{ id: number; name: string }>("SELECT * FROM test_t WHERE id = ?").get(1);
    expect(one?.name).toBe("alice");

    const none = adapter.query<{ id: number; name: string }>("SELECT * FROM test_t WHERE id = ?").get(999);
    expect(none).toBeNull();

    adapter.close();
  });

  test("transaction commits on success", () => {
    const adapter = new SqliteStorageAdapter(":memory:");
    adapter.exec("CREATE TABLE tx_t (val TEXT)");

    const txFn = adapter.transaction(() => {
      adapter.query("INSERT INTO tx_t (val) VALUES (?)").run("a");
      adapter.query("INSERT INTO tx_t (val) VALUES (?)").run("b");
    });
    txFn();

    const rows = adapter.query<{ val: string }>("SELECT val FROM tx_t ORDER BY rowid").all();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.val).toBe("a");
    expect(rows[1]?.val).toBe("b");
    adapter.close();
  });

  test("raw exposes underlying bun:sqlite Database", () => {
    const adapter = new SqliteStorageAdapter(":memory:");
    expect(adapter.raw).toBeDefined();
    expect(typeof adapter.raw.exec).toBe("function");
    adapter.close();
  });
});

describe("createStorageAdapter", () => {
  test("returns SqliteStorageAdapter for local mode, managedRequired=false", () => {
    const { adapter, managedRequired } = createStorageAdapter({
      backendMode: "local",
      dbPath: ":memory:",
    });
    expect(adapter.backend).toBe("sqlite");
    expect(managedRequired).toBe(false);
    adapter.close();
  });

  test("returns SqliteStorageAdapter for hybrid mode, managedRequired=false", () => {
    const { adapter, managedRequired } = createStorageAdapter({
      backendMode: "hybrid",
      dbPath: ":memory:",
    });
    expect(adapter.backend).toBe("sqlite");
    expect(managedRequired).toBe(false);
    adapter.close();
  });

  test("throws for managed mode without managedEndpoint", () => {
    expect(() =>
      createStorageAdapter({
        backendMode: "managed",
        dbPath: ":memory:",
      })
    ).toThrow("managedEndpoint is required");
  });

  test("returns SqliteStorageAdapter for managed mode with endpoint, managedRequired=true", () => {
    const { adapter, managedRequired } = createStorageAdapter({
      backendMode: "managed",
      dbPath: ":memory:",
      managedEndpoint: "postgresql://localhost:5432/harness_mem",
    });
    expect(adapter.backend).toBe("sqlite");
    expect(managedRequired).toBe(true);
    adapter.close();
  });

  test("throws for local mode without dbPath", () => {
    expect(() =>
      createStorageAdapter({
        backendMode: "local",
      })
    ).toThrow("dbPath is required");
  });
});
