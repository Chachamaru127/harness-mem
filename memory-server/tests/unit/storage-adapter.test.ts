import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SqliteStorageAdapter } from "../../src/db/sqlite-adapter";
import { createStorageAdapter } from "../../src/db/adapter-factory";
import {
  configureBunCustomSqliteForSqliteVec,
  resolveSqliteVecExtensionPath,
  resetCustomSqlitePreflightForTests,
} from "../../src/db/custom-sqlite-preflight";
import type { StorageAdapter } from "../../src/db/storage-adapter";

const originalEnv = { ...process.env };
const originalSetCustomSQLite = (Database as unknown as { setCustomSQLite?: (path: string) => void }).setCustomSQLite;
const tempDirs: string[] = [];

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createFakeFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-sqlite-preflight-"));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  writeFileSync(filePath, "");
  return filePath;
}

afterEach(() => {
  restoreEnv();
  (Database as unknown as { setCustomSQLite?: (path: string) => void }).setCustomSQLite = originalSetCustomSQLite;
  resetCustomSqlitePreflightForTests();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

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

  test("runs Bun custom SQLite preflight before opening the database when sqlite-vec is configured", () => {
    const vecPath = createFakeFile("vec0.dylib");
    const sqliteLibPath = createFakeFile("libsqlite3.dylib");
    const calls: string[] = [];
    process.env.HARNESS_MEM_SQLITE_VEC_PATH = vecPath;
    process.env.HARNESS_MEM_SQLITE_LIB_PATH = sqliteLibPath;
    (Database as unknown as { setCustomSQLite?: (path: string) => void }).setCustomSQLite = (path: string) => {
      calls.push(path);
    };

    const adapter = new SqliteStorageAdapter(":memory:");
    adapter.close();

    expect(calls).toEqual([sqliteLibPath]);
  });

  test("does not repeat setCustomSQLite for the same library path in one process", () => {
    const vecPath = createFakeFile("vec0.dylib");
    const sqliteLibPath = createFakeFile("libsqlite3.dylib");
    const calls: string[] = [];
    process.env.HARNESS_MEM_SQLITE_VEC_PATH = vecPath;
    process.env.HARNESS_MEM_SQLITE_LIB_PATH = sqliteLibPath;
    (Database as unknown as { setCustomSQLite?: (path: string) => void }).setCustomSQLite = (path: string) => {
      calls.push(path);
    };

    const first = new SqliteStorageAdapter(":memory:");
    const second = new SqliteStorageAdapter(":memory:");
    first.close();
    second.close();

    expect(calls).toEqual([sqliteLibPath]);
  });

  test("skips custom SQLite preflight without throwing when the sqlite library path is missing", () => {
    const vecPath = createFakeFile("vec0.dylib");
    const calls: string[] = [];
    process.env.HARNESS_MEM_SQLITE_VEC_PATH = vecPath;
    process.env.HARNESS_MEM_SQLITE_LIB_PATH = "/non/existent/libsqlite3.dylib";
    (Database as unknown as { setCustomSQLite?: (path: string) => void }).setCustomSQLite = (path: string) => {
      calls.push(path);
    };

    const adapter = new SqliteStorageAdapter(":memory:");
    adapter.close();

    expect(calls).toEqual([]);
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

describe("configureBunCustomSqliteForSqliteVec", () => {
  test("uses the Homebrew SQLite default path on macOS when no custom library env is set", () => {
    const calls: string[] = [];
    const result = configureBunCustomSqliteForSqliteVec({
      platform: "darwin",
      env: {
        HARNESS_MEM_SQLITE_VEC_PATH: "/tmp/vec0.dylib",
      } as NodeJS.ProcessEnv,
      exists: () => true,
      database: { setCustomSQLite: (path: string) => calls.push(path) },
    });

    expect(result.reason).toBe("configured");
    expect(calls).toEqual(["/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib"]);
  });

  test("discovers the packaged sqlite-vec extension by default on macOS", () => {
    const result = resolveSqliteVecExtensionPath({
      platform: "darwin",
      env: {} as NodeJS.ProcessEnv,
      cwd: "/repo",
      moduleDir: "/repo/memory-server/src/db",
      home: "/home/tester",
      exists: (path: string) => path === "/repo/node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
      readDir: () => [],
    });

    expect(result).toBe("/repo/node_modules/sqlite-vec-darwin-arm64/vec0.dylib");
  });

  test("keeps explicit HARNESS_MEM_SQLITE_VEC_PATH ahead of macOS defaults", () => {
    const result = resolveSqliteVecExtensionPath({
      platform: "darwin",
      env: {
        HARNESS_MEM_SQLITE_VEC_PATH: "/custom/vec0.dylib",
      } as NodeJS.ProcessEnv,
      cwd: "/repo",
      moduleDir: "/repo/memory-server/src/db",
      exists: () => true,
    });

    expect(result).toBe("/custom/vec0.dylib");
  });

  test("falls back to the Bun install cache when node_modules package is absent", () => {
    const result = resolveSqliteVecExtensionPath({
      platform: "darwin",
      env: {} as NodeJS.ProcessEnv,
      cwd: "/repo",
      moduleDir: "/repo/memory-server/src/db",
      home: "/home/tester",
      exists: (path: string) =>
        path === "/home/tester/.bun/install/cache" ||
        path === "/home/tester/.bun/install/cache/sqlite-vec-darwin-arm64@0.1.9/vec0.dylib",
      readDir: () => ["sqlite-vec-darwin-arm64@0.1.7", "sqlite-vec-darwin-arm64@0.1.9"],
    });

    expect(result).toBe("/home/tester/.bun/install/cache/sqlite-vec-darwin-arm64@0.1.9/vec0.dylib");
  });

  test("skips preflight outside macOS", () => {
    const calls: string[] = [];
    const result = configureBunCustomSqliteForSqliteVec({
      platform: "linux",
      env: {
        HARNESS_MEM_SQLITE_VEC_PATH: "/tmp/vec0.dylib",
        HARNESS_MEM_SQLITE_LIB_PATH: "/tmp/libsqlite3.dylib",
      } as NodeJS.ProcessEnv,
      exists: () => true,
      database: { setCustomSQLite: (path: string) => calls.push(path) },
    });

    expect(result.reason).toBe("unsupported-platform");
    expect(calls).toEqual([]);
  });

  test("skips preflight when Bun does not expose setCustomSQLite", () => {
    const result = configureBunCustomSqliteForSqliteVec({
      platform: "darwin",
      env: {
        HARNESS_MEM_SQLITE_VEC_PATH: "/tmp/vec0.dylib",
        HARNESS_MEM_SQLITE_LIB_PATH: "/tmp/libsqlite3.dylib",
      } as NodeJS.ProcessEnv,
      exists: () => true,
      database: {},
    });

    expect(result.reason).toBe("set-custom-sqlite-unavailable");
    expect(result.configured).toBe(false);
  });
});
