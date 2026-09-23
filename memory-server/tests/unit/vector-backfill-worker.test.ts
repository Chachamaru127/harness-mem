import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createVectorBackfillWorker,
  vectorRepairErrorCode,
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
  getVectorModelVersion?: () => string;
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
      getVectorModelVersion: options.getVectorModelVersion ?? (() => MODEL),
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

  test("stops with a visible error when every reindex row is skipped for retryable embedding errors", async () => {
    let calls = 0;
    const harness = makeHarness({ vectorCount: 0, totalObservations: 25,
      runExternalOperation: async () => {
        calls += 1;
        return makeOk([{ reindexed: 0, adopted_legacy_vectors: 0, skipped_retryable: 25 }]);
      },
    });
    harnesses.push(harness);
    harness.worker.start({ reset: true });
    await harness.worker.tick();
    const status = item(harness.worker.status());
    expect(status).toMatchObject({ status: "failed", running: false, reindex_processed: 0 });
    expect(status.last_error).toContain("25");
    expect(status.last_error).toContain("retryable embedding");
    await harness.worker.tick();
    expect(calls).toBe(1);
  });

  test("explicit resume after retryable failure preserves the job and completed work", async () => {
    let fail = false;
    const harness = makeHarness({ vectorCount: 0, totalObservations: 3,
      runExternalOperation: async () => makeOk([fail
        ? { reindexed: 0, skipped_retryable: 2 }
        : { reindexed: 1, skipped_retryable: 0, total_observations: 3, vector_coverage: 0.5 }]),
    });
    harnesses.push(harness);
    const jobId = item(harness.worker.start({ reset: true })).job_id;
    await harness.worker.tick();
    fail = true;
    await harness.worker.tick();
    expect(item(harness.worker.status())).toMatchObject({ status: "failed", reindex_processed: 1, job_id: jobId });
    fail = false;
    expect(item(harness.worker.start({ reset: false }))).toMatchObject({
      status: "running", reindex_processed: 1, job_id: jobId, last_error: null,
    });
    await harness.worker.tick();
    expect(item(harness.worker.status())).toMatchObject({ running: true, reindex_processed: 2, job_id: jobId, last_error: null });
  });

  test("start rejects a model other than the active vector model", () => {
    const harness = makeHarness({ vectorCount: 0, totalObservations: 2 });
    harnesses.push(harness);
    const rejected = harness.worker.start({ model: "granite-embedding-311m-r2", reset: true });
    expect(rejected.ok).toBe(false);
    expect(String(rejected.error)).toContain(MODEL);
    expect(item(harness.worker.status())).toMatchObject({ running: false, job_id: null });
    expect(item(harness.worker.start({ model: MODEL, reset: true }))).toMatchObject({ running: true, model: MODEL });
    const whileRunning = harness.worker.start({ model: "granite-embedding-311m-r2" });
    expect(whileRunning.ok).toBe(false);
  });

  test("start does not reuse progress from a job for another model", () => {
    let active = MODEL;
    const harness = makeHarness({ vectorCount: 0, totalObservations: 2, getVectorModelVersion: () => active });
    harnesses.push(harness);
    harness.worker.start({ reset: true });
    harness.worker.stop();
    active = "other:model";
    const resumed = item(harness.worker.start());
    expect(resumed).toMatchObject({ running: true, model: "other:model", reindex_coverage: null, ticks: 0, next_phase: "compact" });
  });

  test("partial retryable skips do not stop successful progress", async () => {
    const harness = makeHarness({ vectorCount: 0, totalObservations: 2,
      runExternalOperation: async () => makeOk([{ reindexed: 1, skipped_retryable: 1,
        total_observations: 2, current_model_vectors: 1, vector_coverage: 0.5 }]),
    });
    harnesses.push(harness);
    harness.worker.start({ reset: true });
    await harness.worker.tick();
    expect(item(harness.worker.status())).toMatchObject({ running: true, reindex_processed: 1, last_error: null });
  });

  test("an empty reindex batch completes without a stall error", async () => {
    const harness = makeHarness({ vectorCount: 0, totalObservations: 0,
      runExternalOperation: async () => makeOk([{ reindexed: 0, skipped_retryable: 0,
        total_observations: 0, current_model_vectors: 0, missing_vectors_remaining: 0, vector_coverage: 1 }]),
    });
    harnesses.push(harness);
    harness.worker.start({ reset: true });
    await harness.worker.tick();
    expect(item(harness.worker.status())).toMatchObject({ status: "completed", running: false, last_error: null });
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


describe("continuous vector maintenance", () => {
  test("repairs records arriving after completion and respects explicit stop across monitor restart", async () => {
    const h = makeHarness({ vectorCount: 0, totalObservations: 1 });
    try {
      h.worker.start({ target_coverage: 1 });
      await h.worker.tick();
      expect(item(h.worker.status()).status).toBe("completed");
      h.reindexState.total = 2;
      await h.worker.maintain();
      expect(h.reindexState.current).toBe(2);
      h.worker.stop(); h.worker.monitor();
      h.reindexState.total = 3;
      await h.worker.maintain();
      expect(h.reindexState.current).toBe(2);
      expect(item(h.worker.status()).stop_reason).toBe("operator");
    } finally { h.close(); }
  });

  test("shutdown drains pending work without overwriting the stop state", async () => {
    const h = makeHarness({ vectorCount: 0, totalObservations: 1, pendingReindex: true });
    try {
      const tick = h.worker.maintain();
      expect(h.worker.isTicking()).toBe(true);
      let drained = false;
      const shutdown = h.worker.shutdown().then(() => { drained = true; });
      await Promise.resolve(); expect(drained).toBe(false);
      h.reindexState.pending!.resolve();
      await Promise.all([tick, shutdown]);
      expect(item(h.worker.status())).toMatchObject({ stop_requested: true, stop_reason: "shutdown" });
    } finally { h.close(); }
  });
});


test("maintenance cannot overwrite a manual start while its child is pending", async () => {
  const h = makeHarness({ vectorCount: 0, totalObservations: 1, pendingReindex: true });
  try {
    const pending = h.worker.maintain();
    const started = item(h.worker.start({ reset: true, target_coverage: 1 }));
    h.reindexState.pending!.resolve(); await pending;
    expect(item(h.worker.status())).toMatchObject({ running: true, job_id: started.job_id, ticks: 0 });
  } finally { h.close(); }
});

test("parent restart resumes shutdown pauses but retains explicit stops", async () => {
  const h = makeHarness({ vectorCount: 0, totalObservations: 1 });
  const deps: VectorBackfillWorkerDeps = {
    db: h.db, getVectorModelVersion: () => MODEL, getVectorDimension: () => DIMENSION,
    repairSqliteVecMap: makeRepair(h.db, h.repairCalls), reindexVectors: makeReindex(h.reindexState),
  };
  try {
    await h.worker.shutdown();
    const restarted = createVectorBackfillWorker(deps, { autoSchedule: false });
    restarted.monitor(); await restarted.maintain();
    expect(h.reindexState.current).toBe(1);
    restarted.stop();
    const stopped = createVectorBackfillWorker(deps, { autoSchedule: false });
    stopped.monitor(); h.reindexState.total++;
    await stopped.maintain();
    expect(h.reindexState.current).toBe(1);
  } finally { h.close(); }
});


test("continuous discovery retains the failed manual job and its diagnosis", async () => {
  let fail = true;
  const h = makeHarness({ vectorCount: 0, totalObservations: 1, runExternalOperation: async () => {
    if (fail) throw new Error("SQLITE_BUSY");
    return makeOk([{ scanned: 0, reindexed: 0 }]);
  } });
  try {
    h.worker.monitor(); h.worker.start({ target_coverage: 1 });
    await h.worker.tick();
    const failure = item(h.worker.status());
    expect(failure.status).toBe("failed");
    fail = false; await h.worker.maintain();
    expect(item(h.worker.status())).toMatchObject({ status: "failed", last_error: failure.last_error, maintenance_last_error: null });
  } finally { h.close(); }
});


test("repair failure diagnostics preserve categories and exit codes without raw stderr", () => {
  expect(vectorRepairErrorCode(new Error("SQLITE_BUSY: private captured text; vector backfill child exited 1"))).toBe("SQLITE_BUSY; exit=1");
  expect(vectorRepairErrorCode(new Error("embedding failed with secret-token"))).toBe("embedding_unavailable");
  expect(vectorRepairErrorCode(new Error("unclassified secret-token"))).toBe("vector_repair_failed");
});

test("a manual start during idle discovery is scheduled immediately after the child drains", async () => {
  let release!: () => void;
  let calls = 0;
  const h = makeHarness({ vectorCount: 0, totalObservations: 0, autoSchedule: true,
    runExternalOperation: async () => {
      calls++;
      if (calls === 1) await new Promise<void>(resolve => { release = resolve; });
      return makeOk([{ scanned: 0, scan_exhausted: true, reindexed: 0, vector_coverage: 1 }]);
    },
  });
  try {
    h.worker.monitor();
    const pending = h.worker.maintain();
    h.worker.start({ reset: true, target_coverage: 1 });
    release(); await pending;
    const deadline = Date.now() + 1000;
    while (calls < 2 && Date.now() < deadline) await sleep(10);
    expect(calls).toBeGreaterThanOrEqual(2);
  } finally { h.close(); }
});


for (const reason of ["operator", "shutdown"] as const) test(`cancelled child remains stopped on ${reason}`, async () => {
  let reject!: (error: Error) => void;
  const h = makeHarness({ vectorCount: 0, totalObservations: 1,
    runExternalOperation: () => new Promise((_, fail) => { reject = fail; }),
  });
  try {
    h.worker.start(); const tick = h.worker.tick();
    let shutdown: Promise<void> | undefined;
    if (reason === "shutdown") shutdown = h.worker.shutdown(); else h.worker.stop();
    reject(new Error("vector backfill child exited 137"));
    await tick; await shutdown;
    expect(item(h.worker.status())).toMatchObject({ status: "stopped", running: false, stop_requested: true, stop_reason: reason, last_error: null });
  } finally { h.close(); }
});

test("background maintenance does not block other schedulers; manual jobs retain their gate", async () => {
  const h = makeHarness({ vectorCount: 0, totalObservations: 1, pendingReindex: true });
  try {
    const maintenance = h.worker.maintain();
    expect(h.worker.isTicking()).toBe(true);
    expect(h.worker.isRunning()).toBe(false);
    h.reindexState.pending!.resolve(); await maintenance;
    h.worker.start(); const manual = h.worker.tick();
    expect(h.worker.isRunning()).toBe(true);
    await manual;
  } finally { h.close(); }
});

test("exhausted manual discovery yields instead of refreshing covered rows until retry time", async () => {
  const h = makeHarness({ vectorCount: 0, totalObservations: 1, runExternalOperation: async operation => {
    expect(operation).toMatchObject({ type: "reindex", missing_only: true });
    return makeOk([{ reindexed: 0, skipped_retryable: 0, scan_exhausted: true, vector_coverage: 0.8 }]);
  } });
  try {
    h.worker.start({ target_coverage: 1 }); await h.worker.tick();
    expect(item(h.worker.status())).toMatchObject({ status: "completed", running: false, reindex_coverage: 0.8 });
  } finally { h.close(); }
});
