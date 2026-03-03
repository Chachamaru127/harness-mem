/**
 * SqliteVectorRepository ユニットテスト
 *
 * インメモリ SQLite + JS fallback モード（vecTableReady=false）で
 * IVectorRepository の全メソッドを検証する。
 * sqlite-vec 拡張なしで動作するため CI で常に実行可能。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { SqliteVectorRepository } from "../../src/db/repositories/sqlite-vector-repository";
import type { UpsertVectorInput } from "../../src/db/repositories/IVectorRepository";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function createDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

/** JS fallback モード（vecTableReady=false）のリポジトリを生成 */
function createRepo(db: Database): SqliteVectorRepository {
  return new SqliteVectorRepository(db, 64, false);
}

function ensureObservation(db: Database, id: string): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_sessions
     (session_id, platform, project, started_at, created_at, updated_at)
     VALUES ('session-001', 'claude', 'test-project', ?, ?, ?)`
  ).run(now, now, now);
  db.query(
    `INSERT OR IGNORE INTO mem_observations
     (id, platform, project, session_id, content, content_redacted,
      observation_type, memory_type, tags_json, privacy_tags_json,
      created_at, updated_at)
     VALUES (?, 'claude', 'test-project', 'session-001', 'test', 'test',
             'context', 'semantic', '[]', '[]', ?, ?)`
  ).run(id, now, now);
}

function makeInput(observationId: string, overrides: Partial<UpsertVectorInput> = {}): UpsertVectorInput {
  const now = new Date().toISOString();
  const vector = new Array(64).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : -0.1));
  return {
    observation_id: observationId,
    model: "test-model-v1",
    dimension: 64,
    vector_json: JSON.stringify(vector),
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
// upsert / findByObservationId
// ---------------------------------------------------------------------------

describe("SqliteVectorRepository: upsert と findByObservationId", () => {
  test("upsert で保存したベクトルを findByObservationId で取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_001");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_001"));
    const row = await repo.findByObservationId("obs_001");

    expect(row).not.toBeNull();
    expect(row?.observation_id).toBe("obs_001");
    expect(row?.model).toBe("test-model-v1");
    expect(row?.dimension).toBe(64);
  });

  test("存在しない observation_id に対して findByObservationId は null を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = createRepo(db);

    const row = await repo.findByObservationId("nonexistent");
    expect(row).toBeNull();
  });

  test("同じ observation_id への upsert でモデルが更新される（ON CONFLICT UPDATE）", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_002");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_002", { model: "model-v1" }));
    await repo.upsert(makeInput("obs_002", { model: "model-v2" }));

    const row = await repo.findByObservationId("obs_002");
    expect(row?.model).toBe("model-v2");
  });
});

// ---------------------------------------------------------------------------
// findByObservationIds
// ---------------------------------------------------------------------------

describe("SqliteVectorRepository: findByObservationIds", () => {
  test("複数 observation_id を一括取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_a");
    ensureObservation(db, "obs_b");
    ensureObservation(db, "obs_c");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_a"));
    await repo.upsert(makeInput("obs_b"));
    await repo.upsert(makeInput("obs_c"));

    const rows = await repo.findByObservationIds(["obs_a", "obs_c"]);
    const ids = rows.map((r) => r.observation_id).sort();
    expect(ids).toEqual(["obs_a", "obs_c"]);
  });

  test("空配列を渡すと空配列が返る", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = createRepo(db);

    const rows = await repo.findByObservationIds([]);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findLegacyObservationIds
// ---------------------------------------------------------------------------

describe("SqliteVectorRepository: findLegacyObservationIds", () => {
  test("現在モデルと異なるモデルの observation_id だけを返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_old");
    ensureObservation(db, "obs_new");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_old", { model: "model-v1" }));
    await repo.upsert(makeInput("obs_new", { model: "model-v2" }));

    const legacy = await repo.findLegacyObservationIds("model-v2", 10);
    expect(legacy).toContain("obs_old");
    expect(legacy).not.toContain("obs_new");
  });

  test("limit パラメータで取得件数が制限される", async () => {
    const db = createDb();
    openDbs.push(db);
    for (let i = 0; i < 5; i++) {
      ensureObservation(db, `obs_leg_${i}`);
    }
    const repo = createRepo(db);
    for (let i = 0; i < 5; i++) {
      await repo.upsert(makeInput(`obs_leg_${i}`, { model: "model-v1" }));
    }

    const legacy = await repo.findLegacyObservationIds("model-v2", 3);
    expect(legacy.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------

describe("SqliteVectorRepository: coverage", () => {
  test("total と current_model_count が正確に返る", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_x");
    ensureObservation(db, "obs_y");
    ensureObservation(db, "obs_z");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_x", { model: "current" }));
    await repo.upsert(makeInput("obs_y", { model: "current" }));
    await repo.upsert(makeInput("obs_z", { model: "old" }));

    const result = await repo.coverage("current");
    expect(result.total).toBe(3);
    expect(result.current_model_count).toBe(2);
  });

  test("ベクトルが存在しない場合は total=0、current_model_count=0", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = createRepo(db);

    const result = await repo.coverage("any-model");
    expect(result.total).toBe(0);
    expect(result.current_model_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("SqliteVectorRepository: delete", () => {
  test("delete 後に findByObservationId は null を返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_del");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_del"));
    await repo.delete("obs_del");

    const row = await repo.findByObservationId("obs_del");
    expect(row).toBeNull();
  });

  test("存在しない observation_id を delete しても例外が発生しない", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = createRepo(db);

    await expect(repo.delete("nonexistent")).resolves.toBeUndefined();
  });
});
