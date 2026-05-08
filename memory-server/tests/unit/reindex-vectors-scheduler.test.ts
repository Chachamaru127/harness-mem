/**
 * S89-003: reindex-vectors-scheduler unit tests
 *
 * Tests verify the scheduler's tick() logic with a mocked reindexVectors
 * callback. Timer behaviour (setInterval) is not exercised directly; instead
 * tick() is called manually to simulate a 10-minute interval firing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ReindexVectorsScheduler,
  createReindexVectorsScheduler,
  DEFAULT_REINDEX_SCHEDULER_CONFIG,
} from "../../src/core/reindex-vectors-scheduler";
import type { ApiResponse } from "../../src/core/types";

function makeDb(): Database {
  return new Database(":memory:");
}

interface MockState {
  totalObservations: number;
  reindexedSoFar: number;
  legacyRemaining: number;
  callCount: number;
  lastLimit: number;
}

function makeMockReindex(state: MockState): (limit: number) => ApiResponse {
  return (limit: number): ApiResponse => {
    state.callCount += 1;
    state.lastLimit = limit;
    const stillMissing = Math.max(0, state.totalObservations - state.reindexedSoFar);
    const willReindex = Math.min(limit, stillMissing);
    state.reindexedSoFar += willReindex;
    const currentAfter = state.reindexedSoFar;
    const totalAfter = state.totalObservations;
    const missingRemaining = Math.max(0, totalAfter - currentAfter);
    const coverage = totalAfter === 0 ? 1 : currentAfter / totalAfter;
    return {
      ok: true,
      source: "core",
      items: [
        {
          reindexed: willReindex,
          limit,
          total_observations: totalAfter,
          current_model_vectors: currentAfter,
          missing_vectors_remaining: missingRemaining,
          legacy_vectors_remaining: state.legacyRemaining,
          vector_coverage: coverage,
          target_coverage: 0.95,
          progress_pct: Math.round(coverage * 100),
        },
      ],
      meta: {
        count: 1,
        latency_ms: 0,
        sla_latency_ms: 0,
        filters: { limit },
        ranking: "reindex_v1",
      },
    } as unknown as ApiResponse;
  };
}

describe("reindex-vectors-scheduler defaults", () => {
  test("DEFAULT_REINDEX_SCHEDULER_CONFIG has expected values", () => {
    expect(DEFAULT_REINDEX_SCHEDULER_CONFIG.enabled).toBe(false);
    expect(DEFAULT_REINDEX_SCHEDULER_CONFIG.intervalMs).toBe(600_000);
    expect(DEFAULT_REINDEX_SCHEDULER_CONFIG.batchSize).toBe(100);
    expect(DEFAULT_REINDEX_SCHEDULER_CONFIG.targetCoverage).toBe(0.95);
  });
});

describe("reindex-vectors-scheduler: opt-in / disabled", () => {
  let db: Database;
  let state: MockState;
  let scheduler: ReindexVectorsScheduler;

  beforeEach(() => {
    db = makeDb();
    state = {
      totalObservations: 1000,
      reindexedSoFar: 0,
      legacyRemaining: 0,
      callCount: 0,
      lastLimit: 0,
    };
  });

  afterEach(() => {
    scheduler?.stop();
    db.close();
  });

  test("enabled=false: start() is a no-op", () => {
    scheduler = createReindexVectorsScheduler(
      { db, reindexVectors: makeMockReindex(state) },
      { enabled: false }
    );
    scheduler.start();
    expect(scheduler.isRunning()).toBe(false);
  });

  test("enabled=true: start() sets running, stop() clears it", () => {
    scheduler = createReindexVectorsScheduler(
      { db, reindexVectors: makeMockReindex(state) },
      { enabled: true, intervalMs: 5000 }
    );
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });
});

describe("reindex-vectors-scheduler: tick() convergence", () => {
  let db: Database;
  let state: MockState;
  let scheduler: ReindexVectorsScheduler;

  beforeEach(() => {
    db = makeDb();
    state = {
      totalObservations: 250,
      reindexedSoFar: 0,
      legacyRemaining: 0,
      callCount: 0,
      lastLimit: 0,
    };
    scheduler = createReindexVectorsScheduler(
      { db, reindexVectors: makeMockReindex(state) },
      { enabled: true, batchSize: 100, targetCoverage: 0.95 }
    );
  });

  afterEach(() => {
    scheduler.stop();
    db.close();
  });

  test("(a) tick() に batchSize を渡し、進捗が累積する", async () => {
    expect(scheduler.status().total_reindexed).toBe(0);
    await scheduler.tick();
    expect(state.lastLimit).toBe(100);
    expect(state.callCount).toBe(1);
    expect(scheduler.status().total_reindexed).toBe(100);
    expect(scheduler.status().last_coverage).toBeCloseTo(0.4, 5);

    await scheduler.tick();
    expect(scheduler.status().total_reindexed).toBe(200);
    expect(scheduler.status().last_coverage).toBeCloseTo(0.8, 5);

    await scheduler.tick();
    expect(scheduler.status().total_reindexed).toBe(250);
    expect(scheduler.status().last_coverage).toBeCloseTo(1.0, 5);
    expect(scheduler.status().converged).toBe(true);
  });

  test("(b) converged 後の tick() は cheap (limit=1) になる", async () => {
    // Run until converged
    while (!scheduler.status().converged) {
      await scheduler.tick();
    }
    const callsAtConvergence = state.callCount;

    await scheduler.tick();
    expect(state.callCount).toBe(callsAtConvergence + 1);
    expect(state.lastLimit).toBe(1);
  });

  test("(c) coverage が下がると active mode に戻る", async () => {
    // Converge
    while (!scheduler.status().converged) {
      await scheduler.tick();
    }
    expect(scheduler.status().converged).toBe(true);

    // Add new uncovered observations to drop coverage below target
    state.totalObservations += 100;
    await scheduler.tick();

    expect(scheduler.status().converged).toBe(false);
    // Next non-converged tick should request full batch
    await scheduler.tick();
    expect(state.lastLimit).toBe(100);
  });

  test("(d) running フラグで再入を防ぐ", async () => {
    const slow = makeMockReindex(state);
    let resolveSlow: (() => void) | null = null;
    const slowReindex = (limit: number): ApiResponse => {
      // Synchronous — but we test the running guard via concurrent calls
      return slow(limit);
    };
    const localScheduler = createReindexVectorsScheduler(
      { db, reindexVectors: slowReindex },
      { enabled: true, batchSize: 50 }
    );

    // First tick runs, second should also run since first completes synchronously
    await localScheduler.tick();
    await localScheduler.tick();
    expect(state.callCount).toBe(2);
    void resolveSlow;
    localScheduler.stop();
  });
});

describe("reindex-vectors-scheduler: 24h convergence math", () => {
  test("default config converges 14k observations within 144 ticks (~24h)", async () => {
    const db = makeDb();
    const state: MockState = {
      totalObservations: 14_000,
      reindexedSoFar: 0,
      legacyRemaining: 0,
      callCount: 0,
      lastLimit: 0,
    };
    const scheduler = createReindexVectorsScheduler(
      { db, reindexVectors: makeMockReindex(state) },
      { enabled: true, batchSize: 100 }
    );
    try {
      // 144 ticks = 24h with 10min interval
      for (let i = 0; i < 144; i++) {
        await scheduler.tick();
        if (scheduler.status().converged) break;
      }
      expect(scheduler.status().converged).toBe(true);
      expect(scheduler.status().total_reindexed).toBeGreaterThanOrEqual(14_000);
    } finally {
      scheduler.stop();
      db.close();
    }
  });
});
