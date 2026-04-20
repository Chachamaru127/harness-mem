/**
 * §91-002 (XR-004): partial-finalize-scheduler integration tests
 *
 * Tests verify the scheduler's tick() logic using a real in-memory SQLite DB.
 * Timer behaviour (setInterval) is not exercised directly; instead we call
 * tick() manually to simulate a 5-minute interval firing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema, initFtsIndex } from "../../src/db/schema";
import { SessionManager, type SessionManagerDeps } from "../../src/core/session-manager";
import { EventRecorder, type EventRecorderDeps } from "../../src/core/event-recorder";
import {
  PartialFinalizeScheduler,
  type PartialFinalizeSchedulerDeps,
} from "../../src/core/partial-finalize-scheduler";
import type { ApiResponse, Config, EventEnvelope, StreamEvent } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Test DB helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  initFtsIndex(db);
  return db;
}

const TEST_CONFIG: Config = {
  dbPath: ":memory:",
  bindHost: "127.0.0.1",
  bindPort: 37890,
  vectorDimension: 64,
  captureEnabled: true,
  retrievalEnabled: true,
  injectionEnabled: true,
  codexHistoryEnabled: false,
  codexProjectRoot: process.cwd(),
  codexSessionsRoot: process.cwd(),
  codexIngestIntervalMs: 3600000,
  codexBackfillHours: 24,
  opencodeIngestEnabled: false,
  cursorIngestEnabled: false,
  antigravityIngestEnabled: false,
};

// ---------------------------------------------------------------------------
// Mock helpers — minimal stubs for EventRecorder and SessionManager deps
// ---------------------------------------------------------------------------

function createRecordEventMock(db: Database) {
  return (event: EventEnvelope): ApiResponse => {
    const now = new Date().toISOString();
    const obsId = `obs_${Math.random().toString(36).slice(2, 10)}`;
    const eventId = event.event_id || `evt_${Math.random().toString(36).slice(2, 10)}`;
    const dedupeHash = `hash_${eventId}`;
    const sessionId = event.session_id || "";
    const platform = event.platform || "claude";
    const project = event.project || "test-project";

    // Ensure session exists
    db.query(
      `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sessionId, platform, project, event.ts || now, now, now);

    // Insert event
    db.query(
      `INSERT OR IGNORE INTO mem_events (event_id, platform, project, session_id, event_type, ts, payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      platform,
      project,
      sessionId,
      event.event_type,
      event.ts || now,
      JSON.stringify(event.payload ?? {}),
      JSON.stringify(event.tags ?? []),
      JSON.stringify(event.privacy_tags ?? []),
      dedupeHash,
      obsId,
      now
    );

    // Insert observation
    const metaJson = event.metadata ? JSON.stringify(event.metadata) : null;
    db.query(
      `INSERT OR IGNORE INTO mem_observations
         (id, event_id, platform, project, session_id, title, content, content_redacted,
          tags_json, privacy_tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      obsId,
      eventId,
      platform,
      project,
      sessionId,
      (event.payload?.title as string | null) ?? null,
      (event.payload?.summary as string) || (event.payload?.content as string) || "test content",
      (event.payload?.summary as string) || (event.payload?.content as string) || "test content",
      JSON.stringify(event.tags ?? []),
      JSON.stringify(event.privacy_tags ?? []),
      now,
      now
    );

    // If metadata has is_partial, store it (for session_end events that are partial summaries)
    if (metaJson) {
      db.query(
        `UPDATE mem_observations SET updated_at = ? WHERE id = ?`
      ).run(now, obsId);
    }

    return {
      ok: true,
      source: "core",
      items: [{ id: obsId }],
      meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "test" },
    };
  };
}

function createStreamEventMock() {
  return (_type: StreamEvent["type"], _data: Record<string, unknown>): StreamEvent => ({
    id: 0,
    type: _type,
    ts: new Date().toISOString(),
    data: _data,
  });
}

function createSessionManagerDeps(db: Database): SessionManagerDeps {
  return {
    db,
    config: TEST_CONFIG,
    normalizeProject: (p: string) => p,
    canonicalizeProject: (p: string) => p,
    expandProjectSelection: (project: string) => [project],
    platformVisibilityFilterSql: (_alias: string) => "",
    recordEvent: createRecordEventMock(db),
    appendStreamEvent: createStreamEventMock(),
    enqueueConsolidation: () => {},
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface TestRuntime {
  db: Database;
  sm: SessionManager;
  scheduler: PartialFinalizeScheduler;
}

function createRuntime(opts: { enabled?: boolean } = {}): TestRuntime {
  const db = createTestDb();
  const deps = createSessionManagerDeps(db);
  const sm = new SessionManager(deps);

  const schedulerDeps: PartialFinalizeSchedulerDeps = {
    db,
    finalizeSession: (req) => sm.finalizeSession(req),
  };

  const scheduler = new PartialFinalizeScheduler(schedulerDeps, {
    enabled: opts.enabled ?? true,
    intervalMs: 300_000,
    maxSessionsPerTick: 5,
    sessionTimeoutMs: 30_000,
  });

  return { db, sm, scheduler };
}

/**
 * Insert a bare observation for a session (simulates event ingest).
 * The event_type is intentionally NOT 'session_end' so it acts as a "new event"
 * that has not yet been summarized.
 */
function insertUserEvent(
  db: Database,
  sessionId: string,
  project = "proj-scheduler",
  platform = "claude"
): void {
  const now = new Date().toISOString();
  const eventId = `evt_${Math.random().toString(36).slice(2, 10)}`;
  const obsId = `obs_${Math.random().toString(36).slice(2, 10)}`;
  const dedupeHash = `hash_${eventId}`;

  db.query(
    `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, platform, project, now, now, now);

  db.query(
    `INSERT INTO mem_events (event_id, platform, project, session_id, event_type, ts, payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    platform,
    project,
    sessionId,
    "user_prompt",
    now,
    JSON.stringify({ content: "hello" }),
    "[]",
    "[]",
    dedupeHash,
    obsId,
    now
  );

  db.query(
    `INSERT INTO mem_observations (id, event_id, platform, project, session_id, title, content, content_redacted, tags_json, privacy_tags_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    obsId,
    eventId,
    platform,
    project,
    sessionId,
    "user_prompt",
    "hello world content",
    "hello world content",
    "[]",
    "[]",
    now,
    now
  );
}

/**
 * Count session_summary observations for a given session.
 * session_summary cards are stored as observations whose linked event has event_type='session_end'.
 */
function countSessionSummaries(db: Database, sessionId: string): number {
  const row = db.query(`
    SELECT COUNT(*) AS cnt
    FROM mem_observations o
    JOIN mem_events e ON e.event_id = o.event_id
    WHERE o.session_id = ?
      AND e.event_type = 'session_end'
  `).get(sessionId) as { cnt: number } | null;
  return Number(row?.cnt ?? 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("partial-finalize-scheduler: enabled=true", () => {
  let runtime: TestRuntime;

  beforeEach(() => {
    runtime = createRuntime({ enabled: true });
  });

  afterEach(() => {
    runtime.scheduler.stop();
    try { runtime.db.close(); } catch { /* ignore */ }
  });

  test("(a) active session に event 投入 → tick() → partial summary が 1 件増える", async () => {
    const { db, sm: _sm, scheduler } = runtime;
    const sessionId = "sess-sched-001";

    insertUserEvent(db, sessionId);

    const beforeCount = countSessionSummaries(db, sessionId);
    expect(beforeCount).toBe(0);

    await scheduler.tick();

    const afterCount = countSessionSummaries(db, sessionId);
    expect(afterCount).toBe(1);
  });

  test("(b) event 無し session には partial を投げない", async () => {
    const { db, scheduler } = runtime;
    // Session exists in mem_sessions but has NO observations → no candidate
    const now = new Date().toISOString();
    db.query(
      `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("sess-no-events", "claude", "proj-scheduler", now, now, now);

    await scheduler.tick();

    const count = countSessionSummaries(db, "sess-no-events");
    expect(count).toBe(0);
  });

  test("(c) 2 session に event 投入 → tick() → 両方に partial summary 生成される", async () => {
    const { db, scheduler } = runtime;
    const sessA = "sess-sched-multi-a";
    const sessB = "sess-sched-multi-b";

    insertUserEvent(db, sessA);
    insertUserEvent(db, sessB);

    await scheduler.tick();

    expect(countSessionSummaries(db, sessA)).toBe(1);
    expect(countSessionSummaries(db, sessB)).toBe(1);
  });

  test("(d) event 有り session と event 無し session が混在 → event 有りのみ partial", async () => {
    const { db, scheduler } = runtime;
    const sessWithEvents = "sess-sched-has-events";
    const sessEmpty = "sess-sched-no-events-mix";

    insertUserEvent(db, sessWithEvents);

    // sessEmpty: insert session row only (no observations)
    const now = new Date().toISOString();
    db.query(
      `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sessEmpty, "claude", "proj-scheduler", now, now, now);

    await scheduler.tick();

    expect(countSessionSummaries(db, sessWithEvents)).toBe(1);
    expect(countSessionSummaries(db, sessEmpty)).toBe(0);
  });

  test("already-summarized session は tick() をスキップする (event_at <= latest_summary_at)", async () => {
    const { db, sm, scheduler } = runtime;
    const sessionId = "sess-sched-already-done";
    const project = "proj-scheduler";

    insertUserEvent(db, sessionId, project);

    // Manually call partial finalize to create a summary
    sm.finalizeSession({ session_id: sessionId, project, partial: true });

    const afterFirst = countSessionSummaries(db, sessionId);
    expect(afterFirst).toBe(1);

    // No new events → tick() should NOT add another summary
    await scheduler.tick();

    const afterTick = countSessionSummaries(db, sessionId);
    expect(afterTick).toBe(1);
  });

  test("tick() は新 event が追加されるたびに次の tick で再度 partial を生成する", async () => {
    const { db, scheduler } = runtime;
    const sessionId = "sess-sched-repeat";
    const project = "proj-scheduler";

    insertUserEvent(db, sessionId, project);
    await scheduler.tick();
    expect(countSessionSummaries(db, sessionId)).toBe(1);

    // Artificially push the new event's created_at into the future so that
    // latest_event_at > latest_summary_at holds (same-millisecond writes would tie).
    const futureTs = new Date(Date.now() + 1000).toISOString();
    const eventId2 = `evt_${Math.random().toString(36).slice(2, 10)}`;
    const obsId2 = `obs_${Math.random().toString(36).slice(2, 10)}`;
    db.query(
      `INSERT INTO mem_events (event_id, platform, project, session_id, event_type, ts, payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId2, "claude", project, sessionId, "user_prompt", futureTs,
      "{}", "[]", "[]", `hash_${eventId2}`, obsId2, futureTs
    );
    db.query(
      `INSERT INTO mem_observations (id, event_id, platform, project, session_id, title, content, content_redacted, tags_json, privacy_tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      obsId2, eventId2, "claude", project, sessionId, "user_prompt",
      "second event content", "second event content", "[]", "[]", futureTs, futureTs
    );

    await scheduler.tick();
    expect(countSessionSummaries(db, sessionId)).toBe(2);
  });

  test("isRunning() は start() 前は false", () => {
    const { scheduler } = runtime;
    expect(scheduler.isRunning()).toBe(false);
  });

  test("isRunning() は start() 後は true", () => {
    const { scheduler } = runtime;
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });

  test("isRunning() は stop() 後は false に戻る", () => {
    const { scheduler } = runtime;
    scheduler.start();
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });
});

describe("partial-finalize-scheduler: enabled=false (opt-out)", () => {
  let db: Database;
  let scheduler: PartialFinalizeScheduler;

  beforeEach(() => {
    db = createTestDb();
    const schedulerDeps: PartialFinalizeSchedulerDeps = {
      db,
      finalizeSession: () => { throw new Error("should not be called when disabled"); },
    };
    scheduler = new PartialFinalizeScheduler(schedulerDeps, {
      enabled: false,
      intervalMs: 300_000,
    });
  });

  afterEach(() => {
    scheduler.stop();
    try { db.close(); } catch { /* ignore */ }
  });

  test("(b) enabled=false では start() を呼んでも loop が起動しない", () => {
    scheduler.start();
    expect(scheduler.isRunning()).toBe(false);
  });

  test("enabled=false でも tick() は手動実行可能 (no-op ではない)", async () => {
    // Even when disabled, direct tick() call should work without error.
    // The enabled flag only controls setInterval scheduling, not tick() itself.
    // This tests the scheduler logic is callable in isolation.
    const sessionId = "sess-disabled-tick";
    insertUserEvent(db, sessionId);

    // tick() should still process without throwing
    await expect(scheduler.tick()).resolves.toBeUndefined();
    // But since finalizeSession throws if called, and there IS a candidate,
    // the error will be logged and swallowed (loop continues).
    // We just verify no uncaught exception propagates.
  });
});

// ---------------------------------------------------------------------------
// (e) harness_mem_health.features.partial_finalize_enabled exposure
// ---------------------------------------------------------------------------
describe("partial-finalize-scheduler: health features exposure", () => {
  test("(e) HarnessMemCore health() returns partial_finalize_enabled in features", async () => {
    const { HarnessMemCore } = await import("../../src/core/harness-mem-core");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { mkdtempSync, rmSync } = await import("node:fs");

    const dir = mkdtempSync(join(tmpdir(), "harness-mem-sched-health-"));
    const core = new HarnessMemCore({
      dbPath: join(dir, "test.db"),
      bindHost: "127.0.0.1",
      bindPort: 0,
      vectorDimension: 64,
      captureEnabled: true,
      retrievalEnabled: true,
      injectionEnabled: true,
      codexHistoryEnabled: false,
      codexProjectRoot: dir,
      codexSessionsRoot: dir,
      codexIngestIntervalMs: 3600000,
      codexBackfillHours: 24,
      backgroundWorkersEnabled: false,
      partialFinalizeEnabled: true,
      partialFinalizeIntervalMs: 60000,
    });

    try {
      const health = core.health();
      const features = (health.items[0] as Record<string, unknown>)?.features as
        | Record<string, unknown>
        | undefined;
      expect(features).toBeDefined();
      expect(features?.partial_finalize_enabled).toBe(true);
      expect(features?.partial_finalize_interval_ms).toBe(60000);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(e) health() returns partial_finalize_enabled=false by default", async () => {
    const { HarnessMemCore } = await import("../../src/core/harness-mem-core");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { mkdtempSync, rmSync } = await import("node:fs");

    const dir = mkdtempSync(join(tmpdir(), "harness-mem-sched-health-default-"));
    const core = new HarnessMemCore({
      dbPath: join(dir, "test.db"),
      bindHost: "127.0.0.1",
      bindPort: 0,
      vectorDimension: 64,
      captureEnabled: true,
      retrievalEnabled: true,
      injectionEnabled: true,
      codexHistoryEnabled: false,
      codexProjectRoot: dir,
      codexSessionsRoot: dir,
      codexIngestIntervalMs: 3600000,
      codexBackfillHours: 24,
      backgroundWorkersEnabled: false,
      // partialFinalizeEnabled is intentionally omitted → defaults to false
    });

    try {
      const health = core.health();
      const features = (health.items[0] as Record<string, unknown>)?.features as
        | Record<string, unknown>
        | undefined;
      expect(features?.partial_finalize_enabled).toBe(false);
      expect(features?.partial_finalize_interval_ms).toBe(300_000);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
