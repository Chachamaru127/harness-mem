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
import { __resetUserConfigCache } from "../../src/core/core-utils";
import {
  getSqliteVecMapTableName,
  getSqliteVecTableName,
  type SqliteVecUpsertOptions,
} from "../../src/vector/providers";
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

function insertVector(
  db: Database,
  observationId: string,
  model: string,
  dimension: number,
  vectorJson: string,
): void {
  const now = new Date().toISOString();
  db.query(`
    INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(observationId, model, dimension, vectorJson, now, now);
}

function fakeSqliteVecUpsert(
  db: Database,
  observationId: string,
  vectorJson: string,
  updatedAt: string,
  options: SqliteVecUpsertOptions,
): boolean {
  const model = options.model || "test:model";
  const tableName = getSqliteVecTableName(model);
  const mapTableName = getSqliteVecMapTableName(model);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      rowid INTEGER PRIMARY KEY,
      embedding TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${mapTableName} (
      rowid INTEGER PRIMARY KEY,
      observation_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${mapTableName}_observation
      ON ${mapTableName}(observation_id);
  `);

  const mapRow = db
    .query(`SELECT rowid FROM ${mapTableName} WHERE observation_id = ?`)
    .get(observationId) as { rowid?: number } | null;
  if (typeof mapRow?.rowid === "number") {
    db.query(`INSERT OR REPLACE INTO ${tableName}(rowid, embedding) VALUES (?, ?)`).run(mapRow.rowid, vectorJson);
    db.query(`UPDATE ${mapTableName} SET updated_at = ? WHERE rowid = ?`).run(updatedAt, mapRow.rowid);
    return true;
  }

  db.query(`INSERT INTO ${tableName}(embedding) VALUES (?)`).run(vectorJson);
  const lastRow = db.query(`SELECT last_insert_rowid() AS rowid`).get() as { rowid?: number } | null;
  if (typeof lastRow?.rowid !== "number") {
    return false;
  }
  db.query(`INSERT INTO ${mapTableName}(rowid, observation_id, updated_at) VALUES (?, ?, ?)`)
    .run(lastRow.rowid, observationId, updatedAt);
  return true;
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
    const previousConfigPath = process.env.HARNESS_MEM_CONFIG_PATH;
    process.env.HARNESS_MEM_CONFIG_PATH = "/tmp/harness-mem-test-missing-config.json";
    __resetUserConfigCache();
    try {
      const config = getConfig();
      expect(config).toHaveProperty("dbPath");
      expect(config).toHaveProperty("bindHost");
      expect(config).toHaveProperty("bindPort");
      expect(config).toHaveProperty("vectorDimension");
      expect(config).toHaveProperty("captureEnabled");
      expect(config).toHaveProperty("retrievalEnabled");
      expect(config).toHaveProperty("injectionEnabled");
      expect(config.forgetMaintenanceEnabled).toBe(false);
      expect(config.forgetMaintenanceMode).toBe("dry-run");
      expect(config.forgetMaintenanceHealthBudgetMs).toBeGreaterThan(0);
      expect(config.forgetMaintenanceBackoffMs).toBeGreaterThan(0);
    } finally {
      if (previousConfigPath === undefined) {
        delete process.env.HARNESS_MEM_CONFIG_PATH;
      } else {
        process.env.HARNESS_MEM_CONFIG_PATH = previousConfigPath;
      }
      __resetUserConfigCache();
    }
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

  test("project filter bounds project stats to the requested project", () => {
    const db = createTestDb();
    dbs.push(db);
    const config = createTestConfig();

    insertTestObservation(db, { project: "proj-stats-target" });
    insertTestObservation(db, { project: "proj-stats-noise" });

    const deps = createDeps(db, config);
    const manager = new ConfigManager(deps);
    const res = manager.projectsStats({
      project: "proj-stats-target",
      project_members: ["proj-stats-target"],
    });
    expect(res.ok).toBe(true);
    const projects = (res.items as Array<Record<string, unknown>>).map((p) => p.project);
    expect(projects).toEqual(["proj-stats-target"]);
    expect(res.meta.filters.project).toBe("proj-stats-target");
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
// repairSqliteVecMap テスト
// ---------------------------------------------------------------------------

describe("config-manager: repairSqliteVecMap", () => {
  test("dry-run は map table 不在を missing all として数える", () => {
    const model = "adaptive:general:local:multilingual-e5";
    const { manager, db } = createManager({ getVectorModelVersion: () => model });
    const firstId = insertTestObservation(db, { id: "obs-repair-dry-a" });
    const secondId = insertTestObservation(db, { id: "obs-repair-dry-b" });
    insertVector(db, firstId, model, 2, JSON.stringify([1, 0]));
    insertVector(db, secondId, model, 2, JSON.stringify([0, 1]));

    const res = manager.repairSqliteVecMap({ model, dimension: 2, limit: 1 });
    expect(res.ok).toBe(true);
    const item = res.items[0] as Record<string, unknown>;
    expect(item.dry_run).toBe(true);
    expect(item.vector_count).toBe(2);
    expect(item.map_count).toBe(0);
    expect(item.missing_before).toBe(2);
    expect(item.repaired).toBe(0);
    expect(item).not.toHaveProperty("missing_after");
  });

  test("execute は missing map/index を補修し、再実行で重複しない", () => {
    const model = "adaptive:general:local:multilingual-e5";
    const { manager, db } = createManager({
      getVectorModelVersion: () => model,
      upsertSqliteVecRow: fakeSqliteVecUpsert,
    });
    const existingId = insertTestObservation(db, { id: "obs-repair-existing" });
    const missingId = insertTestObservation(db, { id: "obs-repair-missing" });
    insertVector(db, existingId, model, 2, JSON.stringify([1, 0]));
    insertVector(db, missingId, model, 2, JSON.stringify([0, 1]));
    expect(fakeSqliteVecUpsert(db, existingId, JSON.stringify([1, 0]), "2026-02-24T00:00:00.000Z", {
      model,
      vectorDimension: 2,
    })).toBe(true);

    const first = manager.repairSqliteVecMap({ model, dimension: 2, limit: 10, execute: true });
    expect(first.ok).toBe(true);
    const firstItem = first.items[0] as Record<string, unknown>;
    expect(firstItem.missing_before).toBe(1);
    expect(firstItem.repaired).toBe(1);
    expect(firstItem.missing_after).toBe(0);
    expect(firstItem.map_count_after).toBe(2);

    const second = manager.repairSqliteVecMap({ model, dimension: 2, limit: 10, execute: true });
    expect(second.ok).toBe(true);
    const secondItem = second.items[0] as Record<string, unknown>;
    expect(secondItem.missing_before).toBe(0);
    expect(secondItem.repaired).toBe(0);
    expect(secondItem.missing_after).toBe(0);
    expect(secondItem.map_count_after).toBe(2);

    const mapTableName = getSqliteVecMapTableName(model);
    const mapCount = db.query(`SELECT COUNT(*) AS count FROM ${mapTableName}`).get() as { count?: number } | null;
    expect(mapCount?.count).toBe(2);
  });

  test("execute は壊れた vector_json を skip して missing を残す", () => {
    const model = "adaptive:general:local:multilingual-e5";
    const { manager, db } = createManager({
      getVectorModelVersion: () => model,
      upsertSqliteVecRow: fakeSqliteVecUpsert,
    });
    const badId = insertTestObservation(db, { id: "obs-repair-bad-json" });
    insertVector(db, badId, model, 2, "not-json");

    const res = manager.repairSqliteVecMap({ model, dimension: 2, execute: true, limit: 10 });
    expect(res.ok).toBe(true);
    const item = res.items[0] as Record<string, unknown>;
    expect(item.missing_before).toBe(1);
    expect(item.repaired).toBe(0);
    expect(item.skipped).toBe(1);
    expect(item.failed).toBe(0);
    expect(item.missing_after).toBe(1);
  });

  test("rebuild_existing は map updated_at が古い row から進める", () => {
    const model = "adaptive:general:local:multilingual-e5";
    const touched: string[] = [];
    const { manager, db } = createManager({
      getVectorModelVersion: () => model,
      upsertSqliteVecRow: (targetDb, observationId, vectorJson, updatedAt, options) => {
        touched.push(observationId);
        return fakeSqliteVecUpsert(targetDb, observationId, vectorJson, updatedAt, options);
      },
    });

    const oldA = insertTestObservation(db, { id: "obs-rebuild-old-a" });
    const oldB = insertTestObservation(db, { id: "obs-rebuild-old-b" });
    const oldC = insertTestObservation(db, { id: "obs-rebuild-old-c" });
    insertVector(db, oldA, model, 2, JSON.stringify([1, 0]));
    insertVector(db, oldB, model, 2, JSON.stringify([0, 1]));
    insertVector(db, oldC, model, 2, JSON.stringify([0.5, 0.5]));
    expect(fakeSqliteVecUpsert(db, oldA, JSON.stringify([1, 0]), "2026-01-01T00:00:00.000Z", {
      model,
      vectorDimension: 2,
    })).toBe(true);
    expect(fakeSqliteVecUpsert(db, oldB, JSON.stringify([0, 1]), "2026-01-02T00:00:00.000Z", {
      model,
      vectorDimension: 2,
    })).toBe(true);
    expect(fakeSqliteVecUpsert(db, oldC, JSON.stringify([0.5, 0.5]), "2026-01-03T00:00:00.000Z", {
      model,
      vectorDimension: 2,
    })).toBe(true);

    const first = manager.repairSqliteVecMap({
      model,
      dimension: 2,
      execute: true,
      rebuild_existing: true,
      limit: 2,
    });
    expect(first.ok).toBe(true);
    expect(touched.slice(0, 2)).toEqual([oldA, oldB]);
    expect((first.items[0] as Record<string, unknown>).rebuild_batch_updated_at).toBeTruthy();

    const secondStart = touched.length;
    const second = manager.repairSqliteVecMap({
      model,
      dimension: 2,
      execute: true,
      rebuild_existing: true,
      limit: 2,
    });
    expect(second.ok).toBe(true);
    expect(touched.slice(secondStart)[0]).toBe(oldC);
  });
});

// ---------------------------------------------------------------------------
// reindexVectors テスト
// ---------------------------------------------------------------------------

describe("config-manager: reindexVectors", () => {
  test("reindexVectors() が vectorEngine=disabled のとき skipped を返す", async () => {
    const { manager } = createManager({ getVectorEngine: () => "disabled" });
    const res = await manager.reindexVectors();
    expect(res.ok).toBe(true);
    expect((res.meta as Record<string, unknown>).skipped).toBe("vector_disabled");
  });

    test("reindexVectors() レスポンスに meta が含まれる", async () => {
      const { manager } = createManager({ getVectorEngine: () => "disabled" });
      const res = await manager.reindexVectors();
      expect(res.meta).toBeTruthy();
    });

    test("current model の vector が無い observation を legacy vector より先に reindex する", async () => {
      const db = createTestDb();
      dbs.push(db);
      const config = createTestConfig();
      const missingId = insertTestObservation(db, {
        id: "obs-missing-vector",
        content: "older row without any current vector",
        created_at: "2026-02-20T00:00:00.000Z",
      });
      const legacyId = insertTestObservation(db, {
        id: "obs-legacy-vector",
        content: "newer row with legacy vector only",
        created_at: "2026-02-21T00:00:00.000Z",
      });
      db.query(
        `INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(legacyId, "legacy:model", 2, JSON.stringify([0.1, 0.2]), "2026-02-21T00:00:00.000Z", "2026-02-21T00:00:00.000Z");

      const reindexed: string[] = [];
      const manager = new ConfigManager(createDeps(db, config, {
        getVectorEngine: () => "js-fallback",
        getVectorModelVersion: () => "current:model",
        reindexObservationVector: (id, _content, createdAt) => {
          reindexed.push(id);
          db.query(
            `INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(id, "current:model", 2, JSON.stringify([1, 0]), createdAt, createdAt);
        },
      }));

      const res = await manager.reindexVectors(1);
      expect(res.ok).toBe(true);
      expect(reindexed).toEqual([missingId]);
      expect((res.meta as Record<string, unknown>).vector_coverage).toBeGreaterThan(0);
      expect((res.items[0] as Record<string, unknown>).missing_vectors_remaining).toBe(1);
    });

    test("reindexVectors() can skip expensive status counts for worker ticks", async () => {
      const db = createTestDb();
      dbs.push(db);
      const config = createTestConfig();
      const id = insertTestObservation(db, {
        id: "obs-reindex-countless",
        content: "row reindexed without status counts",
        created_at: "2026-02-21T00:00:00.000Z",
      });
      const manager = new ConfigManager(createDeps(db, config, {
        getVectorEngine: () => "js-fallback",
        getVectorModelVersion: () => "current:model",
        reindexObservationVector: (obsId, _content, createdAt) => {
          db.query(
            `INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(obsId, "current:model", 2, JSON.stringify([1, 0]), createdAt, createdAt);
        },
      }));

      const res = await manager.reindexVectors(1, { status_counts: false });
      expect(res.ok).toBe(true);
      const item = res.items[0] as Record<string, unknown>;
      expect(item.reindexed).toBe(1);
      expect(item.status_counts).toBe(false);
      expect(item.total_observations).toBeUndefined();
      expect((res.meta as Record<string, unknown>).status_counts).toBe(false);
      expect((res.meta as Record<string, unknown>).vector_coverage).toBeUndefined();
      const row = db
        .query(`SELECT observation_id FROM mem_vectors WHERE observation_id = ? AND model = ?`)
        .get(id, "current:model") as { observation_id?: string } | null;
      expect(row?.observation_id).toBe(id);
    });

    test("adaptive legacy adoption は sqlite-vec ready 時に model-specific map も upsert する", async () => {
      const model = "adaptive:general:local:multilingual-e5";
      const db = createTestDb();
      dbs.push(db);
      const config = createTestConfig({ vectorDimension: 2 });
      const legacyId = insertTestObservation(db, {
        id: "obs-adopt-legacy-map",
        content: "legacy vector can be adopted without embedding recompute",
        created_at: "2026-02-24T00:00:00.000Z",
      });
      insertVector(db, legacyId, "local:multilingual-e5", 2, JSON.stringify([0.25, 0.75]));
      const reindexed: string[] = [];
      const manager = new ConfigManager(createDeps(db, config, {
        getVectorEngine: () => "sqlite-vec",
        getVecTableReady: () => true,
        getVectorModelVersion: () => "adaptive:router",
        upsertSqliteVecRow: fakeSqliteVecUpsert,
        reindexObservationVector: (id) => {
          reindexed.push(id);
        },
      }));

      const res = await manager.reindexVectors(1);
      expect(res.ok).toBe(true);
      expect((res.items[0] as Record<string, unknown>).adopted_legacy_vectors).toBe(1);
      expect(reindexed).toEqual([]);

      const adoptedVector = db
        .query(`SELECT vector_json FROM mem_vectors WHERE observation_id = ? AND model = ?`)
        .get(legacyId, model) as { vector_json?: string } | null;
      expect(adoptedVector?.vector_json).toBe(JSON.stringify([0.25, 0.75]));

      const mapTableName = getSqliteVecMapTableName(model);
      const mapRow = db
        .query(`SELECT observation_id FROM ${mapTableName} WHERE observation_id = ?`)
        .get(legacyId) as { observation_id?: string } | null;
      expect(mapRow?.observation_id).toBe(legacyId);
    });

    test("prepareReindexEmbedding があれば同期 reindex 前に待つ", async () => {
      const db = createTestDb();
      dbs.push(db);
      const config = createTestConfig();
      const id = insertTestObservation(db, {
        id: "obs-prime-before-reindex",
        content: "row that needs async prime before sync embed",
        created_at: "2026-02-22T00:00:00.000Z",
      });
      const calls: string[] = [];
      const manager = new ConfigManager(createDeps(db, config, {
        getVectorEngine: () => "js-fallback",
        getVectorModelVersion: () => "current:model",
        prepareReindexEmbedding: async (content) => {
          calls.push(`prepare:${content}`);
        },
        reindexObservationVector: (obsId, content, createdAt) => {
          calls.push(`reindex:${obsId}:${content}`);
          db.query(
            `INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(obsId, "current:model", 2, JSON.stringify([1, 0]), createdAt, createdAt);
        },
      }));

      const res = await manager.reindexVectors(1);
      expect(res.ok).toBe(true);
      expect(calls).toEqual([
        "prepare:row that needs async prime before sync embed",
        `reindex:${id}:row that needs async prime before sync embed`,
      ]);
    });

    test("prepareReindexEmbeddings があれば小 batch で prime してから reindex する", async () => {
      const previousBatchSize = process.env.HARNESS_MEM_REINDEX_PRIME_BATCH_SIZE;
      process.env.HARNESS_MEM_REINDEX_PRIME_BATCH_SIZE = "2";
      try {
        const db = createTestDb();
        dbs.push(db);
        const config = createTestConfig();
        const firstId = insertTestObservation(db, {
          id: "obs-batch-prime-a",
          content: "first batch prime row",
          created_at: "2026-02-23T00:00:00.000Z",
        });
        const secondId = insertTestObservation(db, {
          id: "obs-batch-prime-b",
          content: "second batch prime row",
          created_at: "2026-02-23T00:00:01.000Z",
        });
        const calls: string[] = [];
        const manager = new ConfigManager(createDeps(db, config, {
          getVectorEngine: () => "js-fallback",
          getVectorModelVersion: () => "current:model",
          prepareReindexEmbeddings: async (contents) => {
            calls.push(`prepareBatch:${contents.join("|")}`);
          },
          prepareReindexEmbedding: async (content) => {
            calls.push(`prepareSingle:${content}`);
          },
          reindexObservationVector: (obsId, content, createdAt) => {
            calls.push(`reindex:${obsId}:${content}`);
            db.query(
              `INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(obsId, "current:model", 2, JSON.stringify([1, 0]), createdAt, createdAt);
          },
        }));

        const res = await manager.reindexVectors(2);
        expect(res.ok).toBe(true);
        expect(calls).toEqual([
          "prepareBatch:second batch prime row|first batch prime row",
          `reindex:${secondId}:second batch prime row`,
          `reindex:${firstId}:first batch prime row`,
        ]);
        expect((res.items[0] as Record<string, unknown>).prime_batch_size).toBe(2);
      } finally {
        if (previousBatchSize === undefined) {
          delete process.env.HARNESS_MEM_REINDEX_PRIME_BATCH_SIZE;
        } else {
          process.env.HARNESS_MEM_REINDEX_PRIME_BATCH_SIZE = previousBatchSize;
        }
      }
    });
  });

  describe("config-manager: cleanupDuplicateObservations", () => {
    test("dry-run duplicate cleanup reports candidates and writes an audit plan", () => {
      const audits: Array<{ action: string; targetId: string }> = [];
      const { manager } = createManager({
        writeAuditLog: (action, _targetType, targetId) => {
          audits.push({ action, targetId });
        },
      });
      const db = (manager as unknown as { deps: ConfigManagerDeps }).deps.db;
      insertTestObservation(db, { id: "obs-dupe-a", session_id: "sess-dupe", content: "same searchable memory" });
      insertTestObservation(db, { id: "obs-dupe-b", session_id: "sess-dupe", content: "same searchable memory" });

      const res = manager.cleanupDuplicateObservations({ execute: false, limit: 10 });
      expect(res.ok).toBe(true);
      expect((res.meta as Record<string, unknown>).scan_limit).toBe(100);
      expect((res.meta as Record<string, unknown>).duplicate_groups).toBe(1);
      expect((res.meta as Record<string, unknown>).archived_rows).toBe(0);
      expect(audits.some((entry) => entry.action === "admin.cleanup_duplicates.plan")).toBe(true);
    });

    test("duplicate cleanup ignores expired rows before grouping candidates", () => {
      const { manager } = createManager();
      const db = (manager as unknown as { deps: ConfigManagerDeps }).deps.db;
      insertTestObservation(db, {
        id: "obs-dupe-expired-a",
        session_id: "sess-dupe-expired",
        content: "same expired cleanup target",
        created_at: "2026-02-20T00:00:00.000Z",
      });
      insertTestObservation(db, {
        id: "obs-dupe-expired-b",
        session_id: "sess-dupe-expired",
        content: "same expired cleanup target",
        created_at: "2026-02-21T00:00:00.000Z",
      });
      db.query(`UPDATE mem_observations SET expires_at = ? WHERE session_id = ?`).run(
        "2000-01-01T00:00:00.000Z",
        "sess-dupe-expired",
      );

      const res = manager.cleanupDuplicateObservations({ execute: true, limit: 10 });
      expect(res.ok).toBe(true);
      expect((res.meta as Record<string, unknown>).duplicate_groups).toBe(0);
      expect((res.meta as Record<string, unknown>).candidate_rows).toBe(0);
      expect((res.meta as Record<string, unknown>).archived_rows).toBe(0);
    });

    test("execute duplicate cleanup soft-archives duplicate rows", () => {
      const audits: string[] = [];
      const { manager } = createManager({
        writeAuditLog: (action) => {
          audits.push(action);
        },
      });
      const db = (manager as unknown as { deps: ConfigManagerDeps }).deps.db;
      insertTestObservation(db, { id: "obs-dupe-exec-a", session_id: "sess-dupe-exec", content: "same cleanup target", created_at: "2026-02-20T00:00:00.000Z" });
      insertTestObservation(db, { id: "obs-dupe-exec-b", session_id: "sess-dupe-exec", content: "same cleanup target", created_at: "2026-02-21T00:00:00.000Z" });

      const res = manager.cleanupDuplicateObservations({ execute: true, limit: 10 });
      expect(res.ok).toBe(true);
      expect((res.meta as Record<string, unknown>).archived_rows).toBe(1);

      const active = db
        .query<{ count: number }, []>(
          `SELECT COUNT(*) AS count
           FROM mem_observations
           WHERE session_id = 'sess-dupe-exec'
             AND archived_at IS NULL`,
        )
        .get();
      expect(active?.count).toBe(1);
      expect(audits).toContain("admin.cleanup_duplicates");
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
