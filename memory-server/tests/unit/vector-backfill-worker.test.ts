import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createVectorBackfillWorker,
  type VectorBackfillWorker,
  type VectorBackfillWorkerDeps,
} from "../../src/core/vector-backfill-worker";
import type { ApiResponse } from "../../src/core/types";
import { getSqliteVecMapTableName } from "../../src/vector/providers";

const MODEL = "test:model";
const DIMENSION = 3;

interface Harness {
  db: Database;
  worker: VectorBackfillWorker;
  repairCalls: { count: number };
  reindexState: ReindexState;
  close(): void;
}

interface ReindexState {
  total: number;
  current: number;
  calls: number;
  lastLimit: number;
  pending?: {
    promise: Promise<ApiResponse>;
    resolve: () => void;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function item(response: ApiResponse): Record<string, unknown> {
  return (response.items?.[0] ?? {}) as Record<string, unknown>;
}

function makeOk(items: Record<string, unknown>[], extra: Record<string, unknown> = {}): ApiResponse {
  return {
    ok: true,
    source: "core",
    items,
    meta: {
      count: items.length,
      latency_ms: 0,
      sla_latency_ms: 0,
      filters: {},
      ranking: "test",
      ...extra,
    },
  } as ApiResponse;
}

function createDb(vectorCount: number, mappedCount = 0): Database {
  const db = new Database(":memory:");
  const mapTable = getSqliteVecMapTableName(MODEL);
  db.exec(`
    CREATE TABLE mem_vectors (
      observation_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(observation_id, model)
    );
    CREATE TABLE ${mapTable} (
      observation_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL
    );
  `);
  const insertVector = db.query(`
    INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMap = db.query(`INSERT INTO ${mapTable}(observation_id, updated_at) VALUES (?, ?)`);
  for (let i = 0; i < vectorCount; i += 1) {
    const id = `obs-${i + 1}`;
    insertVector.run(id, MODEL, DIMENSION, "[0,1,0]", "2026-05-15T00:00:00.000Z", "2026-05-15T00:00:00.000Z");
    if (i < mappedCount) {
      insertMap.run(id, "2099-01-01T00:00:00.000Z");
    }
  }
  return db;
}

function makeRepair(db: Database, calls: { count: number }): VectorBackfillWorkerDeps["repairSqliteVecMap"] {
  return (options) => {
    calls.count += 1;
    const limit = Number(options.limit ?? 1);
    const mapTable = getSqliteVecMapTableName(String(options.model ?? MODEL));
    const rows = db
      .query(`
        SELECT v.observation_id
        FROM mem_vectors v
        LEFT JOIN ${mapTable} m ON m.observation_id = v.observation_id
        WHERE v.model = ?
          AND v.dimension = ?
          AND (
            m.observation_id IS NULL
            OR COALESCE(m.updated_at, '') < ?
          )
        ORDER BY v.observation_id ASC
        LIMIT ?
      `)
      .all(options.model ?? MODEL, options.dimension ?? DIMENSION, new Date().toISOString(), limit) as Array<{
      observation_id: string;
    }>;
    const upsert = db.query(`
      INSERT INTO ${mapTable}(observation_id, updated_at)
      VALUES (?, ?)
      ON CONFLICT(observation_id) DO UPDATE SET updated_at = excluded.updated_at
    `);
    for (const row of rows) {
      upsert.run(row.observation_id, "2099-01-01T00:00:00.000Z");
    }
    return makeOk([{ repaired: rows.length, missing_after: 0 }]);
  };
}

function makeReindex(state: ReindexState): VectorBackfillWorkerDeps["reindexVectors"] {
  return async (limit = 1) => {
    state.calls += 1;
    state.lastLimit = limit;
    if (state.pending) {
      await state.pending.promise;
    }
    const reindexed = Math.min(limit, Math.max(0, state.total - state.current));
    state.current += reindexed;
    const coverage = state.total === 0 ? 1 : state.current / state.total;
    return makeOk([
      {
        reindexed,
        adopted_legacy_vectors: 0,
        total_observations: state.total,
        current_model_vectors: state.current,
        missing_vectors_remaining: Math.max(0, state.total - state.current),
        legacy_vectors_remaining: 0,
        vector_coverage: coverage,
      },
    ]);
  };
}

function makeHarness(options: {
  vectorCount: number;
  mappedCount?: number;
  totalObservations: number;
  currentVectors?: number;
  autoSchedule?: boolean;
  intervalMs?: number;
  pendingReindex?: boolean;
  runExternalOperation?: VectorBackfillWorkerDeps["runExternalOperation"];
}): Harness {
  const db = createDb(options.vectorCount, options.mappedCount ?? 0);
  const repairCalls = { count: 0 };
  const reindexState: ReindexState = {
    total: options.totalObservations,
    current: options.currentVectors ?? 0,
    calls: 0,
    lastLimit: 0,
  };
  if (options.pendingReindex) {
    let resolve!: () => void;
    reindexState.pending = {
      promise: new Promise<void>((done) => {
        resolve = done;
      }).then(() => makeOk([])),
      resolve,
    };
  }
  const worker = createVectorBackfillWorker(
    {
      db,
      getVectorModelVersion: () => MODEL,
      getVectorDimension: () => DIMENSION,
      repairSqliteVecMap: makeRepair(db, repairCalls),
      reindexVectors: makeReindex(reindexState),
      runExternalOperation: options.runExternalOperation,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
    {
      autoSchedule: options.autoSchedule ?? false,
      intervalMs: options.intervalMs ?? 10,
      compactBatchSize: 1,
      reindexBatchSize: 1,
      targetCoverage: 1,
    },
  );
  return {
    db,
    worker,
    repairCalls,
    reindexState,
    close() {
      worker.stop();
      db.close();
    },
  };
}

describe("vector-backfill-worker", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.close();
    }
  });

  test("start returns immediately and schedules work outside start()", async () => {
    const harness = makeHarness({
      vectorCount: 1,
      totalObservations: 1,
      autoSchedule: true,
      intervalMs: 5,
    });
    harnesses.push(harness);

    const response = harness.worker.start({ reset: true });
    expect(item(response).status).toBe("running");
    expect(harness.repairCalls.count).toBe(0);
    expect(harness.reindexState.calls).toBe(0);

    await sleep(30);
    const status = item(harness.worker.status());
    expect(Number(status.ticks)).toBeGreaterThan(0);
    expect(harness.repairCalls.count + harness.reindexState.calls).toBeGreaterThan(0);
  });

  test("manual ticks finish compact rebuild before reindex", async () => {
    const harness = makeHarness({
      vectorCount: 2,
      totalObservations: 2,
    });
    harnesses.push(harness);

    harness.worker.start({ reset: true });
    await harness.worker.tick();
    let status = item(harness.worker.status());
    expect(harness.repairCalls.count).toBe(1);
    expect(harness.reindexState.calls).toBe(0);
    expect(status.compact_total_repaired).toBe(1);
    expect(status.next_phase).toBe("compact");

    await harness.worker.tick();
    status = item(harness.worker.status());
    expect(harness.repairCalls.count).toBe(2);
    expect(harness.reindexState.calls).toBe(0);
    expect(status.compact_total_repaired).toBe(2);
    expect(status.compact_remaining).toBe(0);
    expect(status.next_phase).toBe("reindex");

    await harness.worker.tick();
    status = item(harness.worker.status());
    expect(harness.reindexState.calls).toBe(1);
    expect(status.reindex_processed).toBe(1);
    expect(status.reindex_total).toBe(2);
    expect(status.reindex_coverage).toBe(0.5);
    expect(status.next_phase).toBe("reindex");
  });

  test("reset start forces compact phase", async () => {
    const harness = makeHarness({
      vectorCount: 2,
      totalObservations: 2,
    });
    harnesses.push(harness);

    harness.worker.start({ reset: true });
    await harness.worker.tick();
    expect(item(harness.worker.status()).next_phase).toBe("compact");

    harness.worker.stop();
    const resetResponse = harness.worker.start({ reset: true });
    expect(item(resetResponse).next_phase).toBe("compact");
  });

  test("resume start reuses compact_remaining and tick does not recount", async () => {
    const harness = makeHarness({
      vectorCount: 3,
      totalObservations: 3,
      runExternalOperation: async (operation) => {
        if (operation.type === "compact") {
          return makeOk([{ repaired: 1 }]);
        }
        return makeOk([
          {
            reindexed: 1,
            adopted_legacy_vectors: 0,
            total_observations: 3,
            current_model_vectors: 1,
            missing_vectors_remaining: 2,
            legacy_vectors_remaining: 0,
            vector_coverage: 1 / 3,
          },
        ]);
      },
    });
    harnesses.push(harness);

    const startResponse = harness.worker.start({ reset: true });
    expect(item(startResponse).compact_remaining).toBe(3);
    await harness.worker.tick();
    let status = item(harness.worker.status());
    expect(status.compact_remaining).toBe(2);
    expect(status.next_phase).toBe("compact");

    harness.worker.stop();
    harness.db.exec("DROP TABLE mem_vectors");

    const resumeResponse = harness.worker.start();
    expect(item(resumeResponse).compact_remaining).toBe(2);
    expect(item(resumeResponse).next_phase).toBe("compact");
    await harness.worker.tick();

    status = item(harness.worker.status());
    expect(status.status).toBe("running");
    expect(status.compact_remaining).toBe(1);
    expect(status.reindex_processed).toBe(0);
  });

  test("zero-repair compact tick refreshes remaining count before staying in compact", async () => {
    const harness = makeHarness({
      vectorCount: 1,
      totalObservations: 1,
      runExternalOperation: async () => makeOk([{ repaired: 0, skipped: 0, failed: 0 }]),
    });
    harnesses.push(harness);

    const startResponse = harness.worker.start({ reset: true });
    expect(item(startResponse).compact_remaining).toBe(1);

    const mapTable = getSqliteVecMapTableName(MODEL);
    harness.db
      .query(`INSERT INTO ${mapTable}(observation_id, updated_at) VALUES (?, ?)`)
      .run("obs-1", "2099-01-01T00:00:00.000Z");

    await harness.worker.tick();

    const status = item(harness.worker.status());
    expect(status.compact_remaining).toBe(0);
    expect(status.next_phase).toBe("reindex");
    expect(harness.reindexState.calls).toBe(0);
  });

  test("stop prevents an in-flight tick from scheduling another tick", async () => {
    const harness = makeHarness({
      vectorCount: 1,
      mappedCount: 1,
      totalObservations: 1,
      autoSchedule: true,
      intervalMs: 5,
      pendingReindex: true,
    });
    harnesses.push(harness);

    harness.worker.start({ reset: true });
    while (harness.reindexState.calls === 0) {
      await sleep(1);
    }

    harness.worker.stop();
    harness.reindexState.pending?.resolve();
    await sleep(25);

    const status = item(harness.worker.status());
    expect(status.status).toBe("stopped");
    expect(status.running).toBe(false);
    expect(status.stop_requested).toBe(true);
    expect(status.ticks).toBe(1);
    expect(harness.reindexState.calls).toBe(1);
  });

  test("persisted status resumes across worker instances", async () => {
    const harness = makeHarness({
      vectorCount: 2,
      totalObservations: 2,
    });
    harnesses.push(harness);

    harness.worker.start({ reset: true });
    await harness.worker.tick();
    const beforeStop = item(harness.worker.status());
    const jobId = String(beforeStop.job_id);
    harness.worker.stop();

    const resumedWorker = createVectorBackfillWorker(
      {
        db: harness.db,
        getVectorModelVersion: () => MODEL,
        getVectorDimension: () => DIMENSION,
        repairSqliteVecMap: makeRepair(harness.db, harness.repairCalls),
        reindexVectors: makeReindex(harness.reindexState),
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      { autoSchedule: false, compactBatchSize: 1, reindexBatchSize: 1, targetCoverage: 1 },
    );

    expect(item(resumedWorker.status()).job_id).toBe(jobId);
    expect(item(resumedWorker.status()).compact_total_repaired).toBe(1);

    resumedWorker.start();
    await resumedWorker.tick();
    const afterResume = item(resumedWorker.status());
    expect(afterResume.job_id).toBe(jobId);
    expect(afterResume.compact_total_repaired).toBe(2);
    expect(afterResume.reindex_processed).toBe(0);
    expect(afterResume.next_phase).toBe("reindex");
  });

  test("status reschedules a persisted running job after process restart", async () => {
    const harness = makeHarness({
      vectorCount: 1,
      totalObservations: 1,
      autoSchedule: false,
    });
    harnesses.push(harness);

    harness.worker.start({ reset: true });
    const resumedWorker = createVectorBackfillWorker(
      {
        db: harness.db,
        getVectorModelVersion: () => MODEL,
        getVectorDimension: () => DIMENSION,
        repairSqliteVecMap: makeRepair(harness.db, harness.repairCalls),
        reindexVectors: makeReindex(harness.reindexState),
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      { autoSchedule: true, intervalMs: 5, compactBatchSize: 1, reindexBatchSize: 1, targetCoverage: 1 },
    );

    resumedWorker.status();
    await sleep(30);
    expect(harness.repairCalls.count + harness.reindexState.calls).toBeGreaterThan(0);
    resumedWorker.stop();
  });

  test("completes when compact remaining is zero and coverage reaches target", async () => {
    const harness = makeHarness({
      vectorCount: 1,
      mappedCount: 1,
      totalObservations: 1,
    });
    harnesses.push(harness);

    harness.worker.start({ reset: true });
    await harness.worker.tick();

    const status = item(harness.worker.status());
    expect(status.status).toBe("completed");
    expect(status.running).toBe(false);
    expect(status.compact_remaining).toBe(0);
    expect(status.reindex_coverage).toBe(1);
    expect(status.reindex_total).toBe(1);
  });
});
