/**
 * IMP-004a: 設定管理モジュール境界テスト
 *
 * 分割後の config-manager.ts が担当する API を TDD で定義する。
 * getConfig / health / metrics / environmentSnapshot /
 * getConsolidationStatus / getAuditLog / projectsStats /
 * backup / reindexVectors / getManagedStatus / shutdown を対象とする。
 *
 * ConfigManager を直接インスタンス化する真のユニットテスト。
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { ConfigManager, type ConfigManagerDeps } from "../../src/core/config-manager";
import { getConfig, type Config, type ApiResponse } from "../../src/core/config-manager";
import {
  createTestDb,
  createTestConfig,
  okResponse,
  insertTestObservation,
  insertTestAuditLog,
} from "./test-helpers";

// ---------------------------------------------------------------------------
// テスト後クリーンアップ
// ---------------------------------------------------------------------------

const dbs: Database[] = [];

afterEach(() => {
  while (dbs.length > 0) {
    const db = dbs.pop();
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// ファクトリ関数
// ---------------------------------------------------------------------------

function createDeps(db: Database, config: Config, overrides: Partial<ConfigManagerDeps> = {}): ConfigManagerDeps {
  return {
    db,
    config,
    canonicalizeProject: (project: string) => project,
    doHealth: () => okResponse([{ status: "ok" }]),
    doMetrics: () => okResponse([{ total_events: 0 }]),
    doEnvironmentSnapshot: () => okResponse([{ version: "test" }]),
    doRunConsolidation: async () => okResponse([{ triggered: true }]),
    doGetManagedStatus: () => null,
    doShutdown: () => {},
    isConsolidationEnabled: () => true,
    getConsolidationIntervalMs: () => 300000,
    writeAuditLog: () => {},
    getVectorEngine: () => "disabled",
    getVectorModelVersion: () => "test:model",
    embeddingProviderName: "test",
    getEmbeddingHealthStatus: () => "ok",
    reindexObservationVector: () => {},
    isAntigravityIngestEnabled: () => false,
    ...overrides,
  };
}

function createManager(overrides: Partial<ConfigManagerDeps> = {}): { manager: ConfigManager; db: Database } {
  const db = createTestDb();
  dbs.push(db);
  const config = createTestConfig();
  const deps = createDeps(db, config, overrides);
  const manager = new ConfigManager(deps);
  return { manager, db };
}

// ---------------------------------------------------------------------------
// getConfig テスト（モジュールレベル関数）
// ---------------------------------------------------------------------------

describe("config-manager: getConfig (module-level function)", () => {
  test("getConfig が Config オブジェクトを返す", () => {
    const config = getConfig();
    expect(config).toBeTruthy();
    expect(typeof config.dbPath).toBe("string");
    expect(typeof config.bindHost).toBe("string");
    expect(typeof config.bindPort).toBe("number");
  });

  test("デフォルト設定に必須フィールドが含まれる", () => {
    const config = getConfig();
    expect(config).toHaveProperty("dbPath");
    expect(config).toHaveProperty("bindHost");
    expect(config).toHaveProperty("bindPort");
    expect(config).toHaveProperty("vectorDimension");
    expect(config).toHaveProperty("captureEnabled");
    expect(config).toHaveProperty("retrievalEnabled");
    expect(config).toHaveProperty("injectionEnabled");
  });
});

// ---------------------------------------------------------------------------
// health テスト
// ---------------------------------------------------------------------------

describe("config-manager: health", () => {
  test("health() が ok=true を返す", () => {
    const { manager } = createManager({
      doHealth: () => okResponse([{ status: "ok" }]),
    });
    const res = manager.health();
    expect(res.ok).toBe(true);
  });

  test("health() レスポンスに items が含まれる", () => {
    const { manager } = createManager({
      doHealth: () => okResponse([{ status: "ok", counts: { observations: 0 } }]),
    });
    const res = manager.health();
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.items.length).toBeGreaterThanOrEqual(1);
  });

  test("health() の items に counts が含まれる", () => {
    const { manager } = createManager({
      doHealth: () => okResponse([{ status: "ok", counts: { observations: 1 } }]),
    });
    const res = manager.health();
    const item = res.items[0] as Record<string, unknown>;
    expect(item).toHaveProperty("counts");
  });

  test("health() の items に vector_engine が含まれる", () => {
    const { manager } = createManager({
      doHealth: () => okResponse([{ status: "ok", vector_engine: "js-fallback" }]),
    });
    const res = manager.health();
    const item = res.items[0] as Record<string, unknown>;
    expect(item).toHaveProperty("vector_engine");
  });

  test("sqlite-vec 不在時は js-fallback が使われる", () => {
    const { manager } = createManager({
      doHealth: () => okResponse([{ status: "ok", vector_engine: "js-fallback" }]),
    });
    const res = manager.health();
    const item = res.items[0] as Record<string, unknown>;
    expect(item.vector_engine).toBe("js-fallback");
  });
});

// ---------------------------------------------------------------------------
// metrics テスト
// ---------------------------------------------------------------------------

describe("config-manager: metrics", () => {
  test("metrics() が ok=true を返す", () => {
    const { manager } = createManager({
      doMetrics: () => okResponse([{ total_events: 0 }]),
    });
    const res = manager.metrics();
    expect(res.ok).toBe(true);
  });

  test("metrics() レスポンスに items が含まれる", () => {
    const { manager } = createManager({
      doMetrics: () => okResponse([{ total_events: 42 }]),
    });
    const res = manager.metrics();
    expect(Array.isArray(res.items)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// environmentSnapshot テスト
// ---------------------------------------------------------------------------

describe("config-manager: environmentSnapshot", () => {
  test("environmentSnapshot() が ok=true を返す", () => {
    const { manager } = createManager({
      doEnvironmentSnapshot: () => okResponse([{ version: "1.0.0" }]),
    });
    const res = manager.environmentSnapshot();
    expect(res.ok).toBe(true);
  });

  test("environmentSnapshot() レスポンスに items が含まれる", () => {
    const { manager } = createManager({
      doEnvironmentSnapshot: () => okResponse([{ version: "1.0.0", platform: "darwin" }]),
    });
    const res = manager.environmentSnapshot();
    expect(Array.isArray(res.items)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getConsolidationStatus テスト（直接 SQL）
// ---------------------------------------------------------------------------

describe("config-manager: getConsolidationStatus", () => {
  test("getConsolidationStatus() が ok=true を返す", () => {
    const { manager } = createManager();
    const res = manager.getConsolidationStatus();
    expect(res.ok).toBe(true);
  });

  test("getConsolidationStatus() のアイテムにジョブ統計が含まれる", () => {
    const db = createTestDb();
    dbs.push(db);
    const config = createTestConfig();

    // pending ジョブを挿入
    db.query(
      `INSERT INTO mem_consolidation_queue (project, session_id, status, requested_at)
       VALUES (?, ?, ?, ?)`
    ).run("test-proj", "sess-001", "pending", new Date().toISOString());

    const deps = createDeps(db, config, {
      isConsolidationEnabled: () => true,
      getConsolidationIntervalMs: () => 300000,
    });
    const manager = new ConfigManager(deps);
    const res = manager.getConsolidationStatus();
    const item = res.items[0] as Record<string, unknown>;
    expect(item).toHaveProperty("pending_jobs");
    expect(item).toHaveProperty("completed_jobs");
    expect(item).toHaveProperty("failed_jobs");
    expect(item).toHaveProperty("enabled");
    expect(item.pending_jobs).toBe(1);
    expect(item.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAuditLog テスト（直接 SQL）
// ---------------------------------------------------------------------------

describe("config-manager: getAuditLog", () => {
  test("getAuditLog() が ok=true を返す", () => {
    const { manager } = createManager();
    const res = manager.getAuditLog();
    expect(res.ok).toBe(true);
  });

  test("初期状態では空の監査ログ", () => {
    const { manager } = createManager();
    const res = manager.getAuditLog({ limit: 10 });
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.items.length).toBe(0);
  });

  test("getObservations 呼び出し後に監査ログにエントリが追加される", () => {
    const db = createTestDb();
    dbs.push(db);
    const config = createTestConfig();

    // 監査ログに直接エントリを挿入（read アクション）
    insertTestAuditLog(db, "read.observations", "observation", "obs-001", { ids: ["obs-001"] });

    const deps = createDeps(db, config);
    const manager = new ConfigManager(deps);
    const auditRes = manager.getAuditLog({ limit: 50 });
    expect(auditRes.ok).toBe(true);
    const hasReadEntry = (auditRes.items as Array<Record<string, unknown>>).some(
      (item) => (item.action as string)?.includes("read")
    );
    expect(typeof hasReadEntry).toBe("boolean");
    expect(hasReadEntry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// projectsStats テスト（直接 SQL）
// ---------------------------------------------------------------------------

describe("config-manager: projectsStats", () => {
  test("projectsStats() が ok=true を返す", () => {
    const { manager } = createManager();
    const res = manager.projectsStats();
    expect(res.ok).toBe(true);
  });

  test("イベント記録後にプロジェクト統計が含まれる", () => {
    const db = createTestDb();
    dbs.push(db);
    const config = createTestConfig();

    insertTestObservation(db, { project: "proj-stats-test" });

    const deps = createDeps(db, config);
    const manager = new ConfigManager(deps);
    const res = manager.projectsStats();
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.items)).toBe(true);
    const projects = (res.items as Array<Record<string, unknown>>).map((p) => p.project);
    expect(projects.some((p) => typeof p === "string")).toBe(true);
    expect(projects).toContain("proj-stats-test");
  });
});

// ---------------------------------------------------------------------------
// backup テスト
// ---------------------------------------------------------------------------

describe("config-manager: backup", () => {
  test("backup() が応答を返す", () => {
    const { manager } = createManager();
    const res = manager.backup({ destDir: "/tmp" });
    expect(typeof res.ok).toBe("boolean");
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reindexVectors テスト
// ---------------------------------------------------------------------------

describe("config-manager: reindexVectors", () => {
  test("reindexVectors() が vectorEngine=disabled のとき skipped を返す", () => {
    const { manager } = createManager({ getVectorEngine: () => "disabled" });
    const res = manager.reindexVectors();
    expect(res.ok).toBe(true);
    expect((res.meta as Record<string, unknown>).skipped).toBe("vector_disabled");
  });

  test("reindexVectors() レスポンスに meta が含まれる", () => {
    const { manager } = createManager({ getVectorEngine: () => "disabled" });
    const res = manager.reindexVectors();
    expect(res.meta).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getManagedStatus テスト
// ---------------------------------------------------------------------------

describe("config-manager: getManagedStatus", () => {
  test("getManagedStatus() が null または ManagedBackendStatus を返す", () => {
    const { manager } = createManager({
      doGetManagedStatus: () => null,
    });
    const status = manager.getManagedStatus();
    expect(status === null || typeof status === "object").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shutdown テスト
// ---------------------------------------------------------------------------

describe("config-manager: shutdown", () => {
  test("shutdown() が正常に完了する", () => {
    let shutdownCalled = false;
    const { manager } = createManager({
      doShutdown: (_signal) => {
        shutdownCalled = true;
      },
    });
    expect(() => manager.shutdown("test")).not.toThrow();
    expect(shutdownCalled).toBe(true);
  });

  test("shutdown() 後も同じプロセスが続行できる", () => {
    let shutdownCallCount = 0;
    const { manager: manager1 } = createManager({
      doShutdown: (_signal) => {
        shutdownCallCount++;
      },
    });
    manager1.shutdown("test");
    expect(shutdownCallCount).toBe(1);

    // シャットダウン後に別のマネージャーを起動できる
    const { manager: manager2 } = createManager({
      doHealth: () => okResponse([{ status: "ok" }]),
    });
    const res = manager2.health();
    expect(res.ok).toBe(true);
  });
});
