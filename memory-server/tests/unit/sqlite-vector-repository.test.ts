/**
 * SqliteVectorRepository ユニットテスト
 *
 * インメモリ SQLite + JS fallback モード（vecTableReady=false）で
 * 複数モデル対応後の IVectorRepository 振る舞いを検証する。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { SqliteVectorRepository } from "../../src/db/repositories/sqlite-vector-repository";
import type { UpsertVectorInput } from "../../src/db/repositories/IVectorRepository";

function createDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

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

describe("SqliteVectorRepository: upsert / find", () => {
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

  test("同じ observation に別モデルを保存すると両方取得できる", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_multi");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_multi", { model: "model-ja" }));
    await repo.upsert(makeInput("obs_multi", { model: "model-en" }));

    const rows = await repo.findAllByObservationId("obs_multi");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.model).sort()).toEqual(["model-en", "model-ja"]);
  });

  test("同じ observation_id + model への upsert は上書き更新になる", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_update");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_update", { model: "model-v1" }));
    await repo.upsert(makeInput("obs_update", { model: "model-v1", vector_json: "[0.9,0.1]" }));

    const rows = await repo.findAllByObservationId("obs_update");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vector_json).toBe("[0.9,0.1]");
  });

  test("findByObservationIdAndModel は対象モデルだけ返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_target");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_target", { model: "model-ja" }));
    await repo.upsert(makeInput("obs_target", { model: "model-en" }));

    const row = await repo.findByObservationIdAndModel("obs_target", "model-en");
    expect(row?.model).toBe("model-en");
  });

  test("findByObservationIds は同一 observation の複数モデル行も返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_a");
    ensureObservation(db, "obs_b");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_a", { model: "model-ja" }));
    await repo.upsert(makeInput("obs_a", { model: "model-en" }));
    await repo.upsert(makeInput("obs_b", { model: "model-en" }));

    const rows = await repo.findByObservationIds(["obs_a", "obs_b"]);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.observation_id === "obs_a")).toHaveLength(2);
  });
});

describe("SqliteVectorRepository: legacy / coverage", () => {
  test("findLegacyObservationIds は current model を持たない observation だけ返す", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_old");
    ensureObservation(db, "obs_migrated");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_old", { model: "model-v1" }));
    await repo.upsert(makeInput("obs_migrated", { model: "model-v1" }));
    await repo.upsert(makeInput("obs_migrated", { model: "model-v2" }));

    const legacy = await repo.findLegacyObservationIds("model-v2", 10);
    expect(legacy).toEqual(["obs_old"]);
  });

  test("coverage は observation 単位で数える", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_x");
    ensureObservation(db, "obs_y");
    ensureObservation(db, "obs_z");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_x", { model: "current" }));
    await repo.upsert(makeInput("obs_x", { model: "legacy" }));
    await repo.upsert(makeInput("obs_y", { model: "current" }));
    await repo.upsert(makeInput("obs_z", { model: "legacy" }));

    const result = await repo.coverage("current");
    expect(result.total).toBe(3);
    expect(result.current_model_count).toBe(2);
  });
});

describe("SqliteVectorRepository: delete", () => {
  test("delete 後に observation の全ベクトルが消える", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureObservation(db, "obs_del");
    const repo = createRepo(db);

    await repo.upsert(makeInput("obs_del", { model: "model-ja" }));
    await repo.upsert(makeInput("obs_del", { model: "model-en" }));
    await repo.delete("obs_del");

    const rows = await repo.findAllByObservationId("obs_del");
    expect(rows).toEqual([]);
  });

  test("存在しない observation_id を delete しても例外にならない", async () => {
    const db = createDb();
    openDbs.push(db);
    const repo = createRepo(db);

    await expect(repo.delete("nonexistent")).resolves.toBeUndefined();
  });
});
