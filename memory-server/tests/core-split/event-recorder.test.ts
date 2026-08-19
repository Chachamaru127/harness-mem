/**
 * IMP-004a: イベント記録モジュール境界テスト
 *
 * EventRecorder を直接インスタンス化してテストする真のユニットテスト。
 * recordEvent / recordEventQueued / getStreamEventsSince を対象とする。
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EventRecorder,
  setEventRecorderSegmentSink,
  type EventRecorderDeps,
} from "../../src/core/event-recorder";
import type {
  Config,
  EventEnvelope,
} from "../../src/core/types";
import { createTestDb, createTestConfig, makeEvent } from "./test-helpers";
import {
  beginIngestTickTelemetry,
  endIngestTickTelemetry,
} from "../../src/core/sqlite-performance-telemetry";
import {
  configureDatabase,
  initFtsIndex,
  initSchema,
  migrateSchema,
  rebuildContentDedupeClaimsProjection,
} from "../../src/db/schema";

// ---------------------------------------------------------------------------
// ヘルパー: EventRecorder インスタンスの生成
// ---------------------------------------------------------------------------

function makeRecorder(
  configOverrides: Partial<Config> = {},
  depOverrides: Partial<EventRecorderDeps> = {},
): EventRecorder {
  const db = createTestDb();
  const config = createTestConfig(configOverrides);
  const deps: EventRecorderDeps = {
    db,
    config,
    normalizeProject: (project: string) => project.trim().toLowerCase(),
    isAbsoluteProjectPath: (project: string) => project.startsWith("/"),
    extendProjectNormalizationRoots: (_candidates: string[]) => {},
    getManagedRequired: () => false,
    isManagedConnected: () => false,
    replicateManagedEvent: (_event) => {},
    getVectorEngine: () => "disabled",
    getVecTableReady: () => false,
    setVecTableReady: (_value: boolean) => {},
    embedContent: (_content: string) => [],
    getEmbeddingProviderName: () => "none",
    getEmbeddingHealthStatus: () => "healthy",
    getVectorModelVersion: () => "local-hash-v3",
    refreshEmbeddingHealth: () => {},
    archiveExpiredObservation: (observationId) => {
      db.query(`UPDATE mem_observations SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`)
        .run(new Date().toISOString(), new Date().toISOString(), observationId);
    },
    ...depOverrides,
  };
  return new EventRecorder(deps);
}

// ---------------------------------------------------------------------------
// recordEvent テスト
// ---------------------------------------------------------------------------

describe("event-recorder: recordEvent", () => {
  test("new content uses the atomic unique-index write without a pre-read dedupe lookup", () => {
    const recorder = makeRecorder();
    const labels: string[] = [];
    setEventRecorderSegmentSink((label) => labels.push(label));
    try {
      const result = recorder.recordEvent(makeEvent({
        event_id: "atomic-content-first",
        dedupe_hash: "atomic-event-first",
        event_type: "session_end",
        payload: { content: "atomic content dedupe contract" },
      }));
      expect(result.ok).toBe(true);
      expect(labels).not.toContain("dedupe_lookup");
    } finally {
      setEventRecorderSegmentSink(null);
    }
  });

  test("expired content does not block an atomic replacement observation", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const payload = { content: "replace expired semantic dedupe row" };
    const first = recorder.recordEvent(makeEvent({
      event_id: "expired-content-first",
      dedupe_hash: "expired-event-first",
      event_type: "session_end",
      expires_at: "2020-01-01T00:00:00.000Z",
      payload,
    }));
    const second = recorder.recordEvent(makeEvent({
      event_id: "expired-content-second",
      dedupe_hash: "expired-event-second",
      event_type: "session_end",
      ts: "2026-02-21T00:00:00.000Z",
      payload,
    }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((second.meta as Record<string, unknown>).deduped).toBeFalsy();
    const rows = db.query<{ archived_at: string | null }, []>(
      `SELECT archived_at FROM mem_observations WHERE event_id LIKE 'expired-content-%' ORDER BY event_id`,
    ).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.archived_at).not.toBeNull();
    expect(rows[1]?.archived_at).toBeNull();
  });

  test("claim expiry is evaluated after waiting for the immediate transaction lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-claim-expiry-lock-"));
    const dbPath = join(dir, "memory.db");
    const db = new Database(dbPath);
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    initFtsIndex(db);
    const recorder = makeRecorder({}, { db });
    let expiresAtMs = 0;
    const initialExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const unprotectedPayload = { content: "expire while waiting unprotected claim" };
    const protectedPayload = { content: "expire while waiting protected claim" };
    expect(recorder.recordEvent(makeEvent({
      event_id: "expiry-lock-old-open",
      dedupe_hash: "expiry-lock-event-old-open",
      event_type: "session_end",
      expires_at: initialExpiresAt,
      payload: unprotectedPayload,
    })).ok).toBe(true);
    expect(recorder.recordEvent(makeEvent({
      event_id: "expiry-lock-old-protected",
      dedupe_hash: "expiry-lock-event-old-protected",
      event_type: "session_end",
      expires_at: initialExpiresAt,
      privacy_tags: ["secret"],
      payload: protectedPayload,
    })).ok).toBe(true);

    const coreUrl = new URL("../../src/core/harness-mem-core.ts", import.meta.url).href;
    const helpersUrl = new URL("./test-helpers.ts", import.meta.url).href;
    const spawnContender = (name: string, event: EventEnvelope) => {
      const readyPath = join(dir, `${name}.ready`);
      const goPath = join(dir, `${name}.go`);
      const enteredPath = join(dir, `${name}.entered`);
      const child = Bun.spawn([
        process.execPath,
        "-e",
        `import { writeFileSync, existsSync } from "node:fs";
         import { HarnessMemCore } from ${JSON.stringify(coreUrl)};
         import { createTestConfig } from ${JSON.stringify(helpersUrl)};
         const core = new HarnessMemCore(createTestConfig({
           dbPath: process.argv[1], backgroundWorkersEnabled: false
         }));
         writeFileSync(process.argv[2], "ready");
         while (!existsSync(process.argv[3])) await Bun.sleep(5);
         writeFileSync(process.argv[4], "entered");
         const result = core.recordEvent(JSON.parse(process.argv[5]), { allowQueue: false });
         console.log(JSON.stringify(result));
         await core.shutdown("test");`,
        dbPath,
        readyPath,
        goPath,
        enteredPath,
        JSON.stringify(event),
      ], {
        env: { ...process.env, HARNESS_MEM_EVENT_CHILD_PROCESS: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      return { child, readyPath, goPath, enteredPath };
    };
    const open = spawnContender("open", makeEvent({
      event_id: "expiry-lock-new-open",
      dedupe_hash: "expiry-lock-event-new-open",
      event_type: "session_end",
      payload: unprotectedPayload,
    }));
    const protectedClaim = spawnContender("protected", makeEvent({
      event_id: "expiry-lock-new-protected",
      dedupe_hash: "expiry-lock-event-new-protected",
      event_type: "session_end",
      payload: protectedPayload,
    }));
    const waitForFile = async (path: string): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (!existsSync(path)) {
        if (Date.now() >= deadline) throw new Error("child marker timeout");
        await Bun.sleep(5);
      }
    };
    let transactionOpen = false;
    try {
      await Promise.all([waitForFile(open.readyPath), waitForFile(protectedClaim.readyPath)]);
      expiresAtMs = Date.now() + 500;
      db.query(`
        UPDATE mem_observations SET expires_at = ?
        WHERE event_id IN ('expiry-lock-old-open', 'expiry-lock-old-protected')
      `).run(new Date(expiresAtMs).toISOString());
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      writeFileSync(open.goPath, "go");
      writeFileSync(protectedClaim.goPath, "go");
      await Promise.all([waitForFile(open.enteredPath), waitForFile(protectedClaim.enteredPath)]);
      await Bun.sleep(Math.max(0, expiresAtMs - Date.now() + 100));
      db.exec("COMMIT");
      transactionOpen = false;

      const readResult = async (child: ReturnType<typeof Bun.spawn>) => {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        return JSON.parse(stdout) as { ok: boolean; error_code?: string; meta?: Record<string, unknown> };
      };
      const [openResult, protectedResult] = await Promise.all([
        readResult(open.child),
        readResult(protectedClaim.child),
      ]);
      expect(openResult.ok).toBe(true);
      expect(openResult.meta?.deduped).toBeFalsy();
      expect(protectedResult).toMatchObject({
        ok: false,
        error_code: "dedupe_protected_policy_required",
      });
      expect(db.query<{ count: number }, []>(`
        SELECT COUNT(*) AS count FROM mem_observations
        WHERE content = 'expire while waiting unprotected claim' AND archived_at IS NULL
      `).get()?.count).toBe(1);
      expect(db.query<{ count: number }, []>(`
        SELECT COUNT(*) AS count FROM mem_observations
        WHERE content = 'expire while waiting protected claim' AND archived_at IS NULL
      `).get()?.count).toBe(1);
    } finally {
      if (transactionOpen) db.exec("ROLLBACK");
      for (const child of [open.child, protectedClaim.child]) {
        if (child.exitCode === null) child.kill();
        await child.exited;
      }
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  test("replacement archive fault rolls claim, event, and canonical observation back together", () => {
    let failArchive = false;
    let db!: Database;
    const recorder = makeRecorder({}, {
      archiveExpiredObservation: (observationId) => {
        if (failArchive) throw new Error("synthetic archive fault");
        db.query("UPDATE mem_observations SET archived_at = ? WHERE id = ?")
          .run("2026-08-19T00:00:00.000Z", observationId);
      },
    });
    db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const payload = { content: "rollback replacement claim and archive" };
    const first = recorder.recordEvent(makeEvent({
      event_id: "replacement-fault-old", dedupe_hash: "replacement-fault-event-old",
      event_type: "session_end", expires_at: "2020-01-01T00:00:00.000Z", payload,
    }));
    const oldId = String(first.items[0]?.id);
    failArchive = true;
    const failed = recorder.recordEvent(makeEvent({
      event_id: "replacement-fault-new", dedupe_hash: "replacement-fault-event-new",
      event_type: "session_end", ts: "2026-08-19T00:00:00.000Z", payload,
    }), { allowQueue: false });
    expect(failed.ok).toBe(false);
    expect(db.query<{ canonical_observation_id: string }, []>(
      "SELECT canonical_observation_id FROM mem_content_dedupe_claims",
    ).get()?.canonical_observation_id).toBe(oldId);
    expect(db.query<{ archived_at: string | null }, [string]>(
      "SELECT archived_at FROM mem_observations WHERE id = ?",
    ).get(oldId)?.archived_at).toBeNull();
    expect(db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM mem_events WHERE event_id = 'replacement-fault-new'",
    ).get()?.count).toBe(0);
  });

  test("same session is ensured once while later metadata is durable inside its event transaction", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const labels: string[] = [];
    let updatedAtDuringTick: string | undefined;
    setEventRecorderSegmentSink((label) => labels.push(label));
    const tick = beginIngestTickTelemetry("test");
    try {
      recorder.recordEvent(makeEvent({
        event_id: "tick-session-1", dedupe_hash: "tick-hash-1",
        ts: "2026-02-20T01:00:00.000Z", payload: { prompt: "one" },
      }));
      recorder.recordEvent(makeEvent({
        event_id: "tick-session-2", dedupe_hash: "tick-hash-2",
        ts: "2026-02-20T02:00:00.000Z", payload: { prompt: "two" },
      }));
      recorder.recordEvent(makeEvent({
        event_id: "tick-session-3", dedupe_hash: "tick-hash-3",
        ts: "2026-02-20T00:00:00.000Z", correlation_id: "late-correlation",
        payload: { prompt: "three" },
      }));
      const duringTick = db.query<{ started_at: string; correlation_id: string | null; updated_at: string }, [string]>(
        "SELECT started_at, correlation_id, updated_at FROM mem_sessions WHERE session_id = ?",
      ).get("test-session-001");
      expect(duringTick?.started_at).toBe("2026-02-20T00:00:00.000Z");
      expect(duringTick?.correlation_id).toBe("late-correlation");
      updatedAtDuringTick = duringTick?.updated_at;
    } finally {
      endIngestTickTelemetry(tick, db, 0, Infinity);
      setEventRecorderSegmentSink(null);
    }
    expect(labels.filter((label) => label === "ensure_session")).toHaveLength(1);
    expect(labels.filter((label) => label === "session_metadata_update")).toHaveLength(1);
    const session = db.query<{ started_at: string; correlation_id: string | null; updated_at: string }, [string]>(
      "SELECT started_at, correlation_id, updated_at FROM mem_sessions WHERE session_id = ?",
    ).get("test-session-001");
    expect(session?.started_at).toBe("2026-02-20T00:00:00.000Z");
    expect(session?.correlation_id).toBe("late-correlation");
    expect(session?.updated_at).toBe(updatedAtDuringTick);
  });

  test("a later tick can refresh session metadata after the prior durable update", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    for (const [source, event] of [
      ["tick-one", makeEvent({
        event_id: "tick-boundary-1", dedupe_hash: "tick-boundary-hash-1",
        ts: "2026-02-20T02:00:00.000Z", payload: { prompt: "first tick" },
      })],
      ["tick-two", makeEvent({
        event_id: "tick-boundary-2", dedupe_hash: "tick-boundary-hash-2",
        ts: "2026-02-19T02:00:00.000Z", correlation_id: "second-tick-correlation",
        payload: { prompt: "second tick" },
      })],
    ] as const) {
      const tick = beginIngestTickTelemetry(source);
      recorder.recordEvent(event);
      endIngestTickTelemetry(tick, db, 0, Infinity);
    }
    expect(db.query<{ started_at: string; correlation_id: string | null }, [string]>(
      "SELECT started_at, correlation_id FROM mem_sessions WHERE session_id = ?",
    ).get("test-session-001")).toEqual({
      started_at: "2026-02-19T02:00:00.000Z",
      correlation_id: "second-tick-correlation",
    });
  });

  test("rolled-back recordEvent does not poison the per-tick session ensure cache", () => {
    let failEmbedding = true;
    const recorder = makeRecorder({}, {
      getVectorEngine: () => "js-fallback",
      embedContent: () => {
        if (failEmbedding) throw new Error("synthetic embedding failure");
        return new Array(64).fill(0);
      },
    });
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const labels: string[] = [];
    setEventRecorderSegmentSink((label) => labels.push(label));
    const tick = beginIngestTickTelemetry("test");
    try {
      const failed = recorder.recordEvent(makeEvent({
        event_id: "rollback-session-1", dedupe_hash: "rollback-hash-1",
        payload: { prompt: "first fails" },
      }), { allowQueue: false });
      expect(failed.ok).toBe(false);
      failEmbedding = false;
      const retried = recorder.recordEvent(makeEvent({
        event_id: "rollback-session-2", dedupe_hash: "rollback-hash-2",
        payload: { prompt: "second succeeds" },
      }), { allowQueue: false });
      expect(retried.ok).toBe(true);
    } finally {
      endIngestTickTelemetry(tick, db, 0, Infinity);
      setEventRecorderSegmentSink(null);
    }
    expect(labels.filter((label) => label === "ensure_session")).toHaveLength(2);
  });

  test("session updated_at ignores replay but advances for genuinely persisted activity", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    recorder.recordEvent(makeEvent({
      event_id: "session-update-1", dedupe_hash: "session-update-hash-1",
      ts: "2026-02-20T00:00:00.000Z", payload: { prompt: "first" },
    }));
    db.query("UPDATE mem_sessions SET updated_at = '2000-01-01T00:00:00.000Z' WHERE session_id = ?")
      .run("test-session-001");

    recorder.recordEvent(makeEvent({
      event_id: "session-update-1", dedupe_hash: "session-update-hash-1",
      ts: "2026-02-20T00:00:00.000Z", payload: { prompt: "first" },
    }));
    const unchanged = db.query<{ updated_at: string }, [string]>(
      "SELECT updated_at FROM mem_sessions WHERE session_id = ?",
    ).get("test-session-001");
    expect(unchanged?.updated_at).toBe("2000-01-01T00:00:00.000Z");

    recorder.recordEvent(makeEvent({
      event_id: "session-update-3", dedupe_hash: "session-update-hash-3",
      ts: "2026-02-19T00:00:00.000Z", correlation_id: "new-correlation",
      payload: { prompt: "earlier metadata" },
    }));
    const changed = db.query<{ updated_at: string; started_at: string; correlation_id: string }, [string]>(
      "SELECT updated_at, started_at, correlation_id FROM mem_sessions WHERE session_id = ?",
    ).get("test-session-001");
    expect(changed?.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
    expect(changed?.started_at).toBe("2026-02-19T00:00:00.000Z");
    expect(changed?.correlation_id).toBe("new-correlation");
  });

  test("a newly persisted content-duplicate event advances session activity", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const payload = { content: "same summary but a genuinely new event" };
    const canonical = recorder.recordEvent(makeEvent({
      event_id: "content-activity-1", dedupe_hash: "content-activity-hash-1",
      event_type: "session_end", ts: "2026-02-20T00:00:00.000Z", payload,
    }));
    db.query("UPDATE mem_sessions SET updated_at = '2000-01-01T00:00:00.000Z' WHERE session_id = ?")
      .run("test-session-001");
    const duplicate = recorder.recordEvent(makeEvent({
      event_id: "content-activity-2", dedupe_hash: "content-activity-hash-2",
      event_type: "session_end", ts: "2026-02-21T00:00:00.000Z", payload,
    }));
    expect(duplicate.ok).toBe(true);
    expect((duplicate.meta as Record<string, unknown>).dedupe_basis).toBe("content");
    expect(duplicate.items[0]?.id).toBe(canonical.items[0]?.id);
    expect(duplicate.items[0]?.observation_id).toBe(canonical.items[0]?.id);
    const row = db.query<{ updated_at: string }, [string]>(
      "SELECT updated_at FROM mem_sessions WHERE session_id = ?",
    ).get("test-session-001");
    expect(row?.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
  });

  test("expired private/secret/sensitive/legal_hold collisions fail closed without auto-archive", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    for (const tag of ["private", "secret", "sensitive", "legal_hold"]) {
      const payload = { content: `protected expired semantic row ${tag}` };
      expect(recorder.recordEvent(makeEvent({
        event_id: `protected-${tag}-first`, dedupe_hash: `protected-${tag}-hash-1`, event_type: "session_end",
        expires_at: "2020-01-01T00:00:00.000Z", privacy_tags: [tag], payload,
      })).ok).toBe(true);
      const second = recorder.recordEvent(makeEvent({
        event_id: `protected-${tag}-second`, dedupe_hash: `protected-${tag}-hash-2`, event_type: "session_end", payload,
      }));
      expect(second.ok).toBe(false);
      expect(second.error_code).toBe("dedupe_protected_policy_required");
      expect(second.retryable).toBe(false);
      const row = db.query<{ archived_at: string | null }, [string]>(
        "SELECT archived_at FROM mem_observations WHERE event_id = ?",
      ).get(`protected-${tag}-first`);
      expect(row?.archived_at).toBeNull();
    }

    const taggedPayload = { content: "protected expired semantic row tags json legal hold" };
    expect(recorder.recordEvent(makeEvent({
      event_id: "protected-tag-first", dedupe_hash: "protected-tag-hash-1", event_type: "session_end",
      expires_at: "2020-01-01T00:00:00.000Z", tags: ["legal_hold"], payload: taggedPayload,
    })).ok).toBe(true);
    expect(recorder.recordEvent(makeEvent({
      event_id: "protected-tag-second", dedupe_hash: "protected-tag-hash-2", event_type: "session_end",
      payload: taggedPayload,
    }), { allowQueue: false }).ok).toBe(false);
    expect(db.query<{ archived_at: string | null }, []>(
      "SELECT archived_at FROM mem_observations WHERE event_id = 'protected-tag-first'",
    ).get()?.archived_at).toBeNull();
    expect(db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM mem_retry_queue",
    ).get()?.count).toBe(0);
  });

  test("two SQLite connections converge content duplicates on one canonical observation", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-atomic-dedupe-"));
    const dbPath = join(dir, "memory.db");
    const db1 = new Database(dbPath);
    configureDatabase(db1);
    initSchema(db1);
    migrateSchema(db1);
    initFtsIndex(db1);
    const db2 = new Database(dbPath);
    configureDatabase(db2);
    const recorder1 = makeRecorder({}, { db: db1 });
    const recorder2 = makeRecorder({}, { db: db2 });
    const payload = { content: "cross connection atomic semantic dedupe" };
    try {
      const first = recorder1.recordEvent(makeEvent({
        event_id: "connection-event-1", dedupe_hash: "connection-hash-1",
        event_type: "session_end", payload,
      }));
      const second = recorder2.recordEvent(makeEvent({
        event_id: "connection-event-2", dedupe_hash: "connection-hash-2",
        event_type: "session_end", ts: "2026-02-21T00:00:00.000Z", payload,
      }));
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect((second.meta as Record<string, unknown>).dedupe_basis).toBe("content");
      const observations = db1.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL",
      ).get();
      const pointers = db1.query<{ observation_id: string | null }, []>(
        "SELECT observation_id FROM mem_events WHERE event_id LIKE 'connection-event-%' ORDER BY event_id",
      ).all();
      expect(observations?.count).toBe(1);
      expect(pointers).toHaveLength(2);
      expect(pointers[0]?.observation_id).toBeTruthy();
      expect(pointers[1]?.observation_id).toBe(pointers[0]?.observation_id);
    } finally {
      db2.close();
      db1.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("claim routing fails closed without leaking a canonical ID across projects", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const payload = { content: "project strict canonical routing" };
    const first = recorder.recordEvent(makeEvent({
      event_id: "project-strict-first", dedupe_hash: "project-strict-event-1",
      project: "project-a", event_type: "session_end", payload,
    }));
    expect(first.ok).toBe(true);
    const second = recorder.recordEvent(makeEvent({
      event_id: "project-strict-second", dedupe_hash: "project-strict-event-2",
      project: "project-b", event_type: "session_end",
      ts: "2026-02-21T00:00:00.000Z", payload,
    }));
    expect(second.ok).toBe(false);
    expect(second.error_code).toBe("dedupe_project_mismatch");
    expect(second.retryable).toBe(false);
    expect(second.items).toEqual([]);
    expect(JSON.stringify(second)).not.toContain(String(first.items[0]?.id));
    expect(db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM mem_events WHERE event_id = 'project-strict-second'",
    ).get()?.count).toBe(0);
    expect(db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM mem_retry_queue",
    ).get()?.count).toBe(0);
  });

  test("a ready recorder revalidates each transaction and resumes only after an authoritative repair", () => {
    const db = createTestDb();
    const recorder = makeRecorder({}, { db });
    try {
      db.exec("DELETE FROM mem_content_dedupe_claims");
      db.exec("UPDATE mem_meta SET value = 'not_ready' WHERE key = 'dedupe_claims.readiness'");
      const result = recorder.recordEvent(makeEvent({
        event_id: "claims-not-ready", dedupe_hash: "claims-not-ready-event",
      }));
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe("dedupe_claims_rebuild_required");
      expect(result.retryable).toBe(true);
      expect(JSON.stringify(result)).toContain("require rebuild");
      expect(db.query<{ value: string }, []>("SELECT value FROM mem_meta WHERE key = 'dedupe_claims.readiness'").get()?.value)
        .toBe("not_ready");
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mem_sessions").get()?.count).toBe(0);
      rebuildContentDedupeClaimsProjection(db);
      const repaired = recorder.recordEvent(makeEvent({
        event_id: "claims-repaired", dedupe_hash: "claims-repaired-event",
      }));
      expect(repaired.ok).toBe(true);
    } finally {
      db.close();
    }
  });

  test("embedding prime-required and SQLite busy failures expose retryable fixed codes", () => {
    for (const code of ["prime_required", "warming"] as const) {
      const embeddingRecorder = makeRecorder(
        { vectorDimension: 4 },
        {
          getVectorEngine: () => "js-fallback",
          buildPassageEmbeddings: () => {
            const error = new Error("embedding provider temporary readiness") as Error & {
              code?: string;
              readiness?: { retryable: boolean };
            };
            error.code = code;
            error.readiness = { retryable: true };
            throw error;
          },
        },
      );
      const embedding = embeddingRecorder.recordEvent(makeEvent({
        event_id: `embedding-${code}-retry`,
        dedupe_hash: `embedding-${code}-retry-hash`,
      }));
      expect(embedding.ok).toBe(false);
      expect(embedding.error_code).toBe("embedding_temporarily_unavailable");
      expect(embedding.retryable).toBe(true);
      const embeddingDb = (embeddingRecorder as unknown as { deps: EventRecorderDeps }).deps.db;
      const queued = embeddingDb.query<{ event_json: string }, []>(
        "SELECT event_json FROM mem_retry_queue",
      ).get();
      expect(queued?.event_json).toContain(`embedding-${code}-retry`);
    }

    for (const [code, errno] of [["SQLITE_BUSY", 5], ["SQLITE_LOCKED", 6]] as const) {
      const busyRecorder = makeRecorder(
        { vectorDimension: 4 },
        {
          getVectorEngine: () => "js-fallback",
          buildPassageEmbeddings: () => {
            const error = new Error("database write contention") as Error & { code?: string; errno?: number };
            error.code = code;
            error.errno = errno;
            throw error;
          },
        },
      );
      const busy = busyRecorder.recordEvent(makeEvent({
        event_id: `sqlite-contention-retry-${errno}`,
        dedupe_hash: `sqlite-contention-retry-hash-${errno}`,
      }), { allowQueue: false });
      expect(busy.ok).toBe(false);
      expect(busy.error_code).toBe("sqlite_busy");
      expect(busy.retryable).toBe(true);
    }

    const queueFaultRecorder = makeRecorder(
      { vectorDimension: 4 },
      {
        getVectorEngine: () => "js-fallback",
        buildPassageEmbeddings: () => {
          const error = new Error("provider warming") as Error & { code?: string };
          error.code = "warming";
          throw error;
        },
      },
    );
    (queueFaultRecorder as unknown as { enqueueRetry: () => void }).enqueueRetry = () => {
      const error = new Error("retry queue busy") as Error & { code?: string; errno?: number };
      error.code = "SQLITE_BUSY";
      error.errno = 5;
      throw error;
    };
    const queueFault = queueFaultRecorder.recordEvent(makeEvent({
      event_id: "embedding-queue-fault",
      dedupe_hash: "embedding-queue-fault-hash",
    }));
    expect(queueFault.error_code).toBe("embedding_temporarily_unavailable");
    expect(queueFault.retryable).toBe(true);
  });

  test("large-DB duplicate collisions return the canonical ID without a follow-up SELECT", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-collision-runtime-"));
    const dbPath = join(dir, "memory.db");
    const db = new Database(dbPath);
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    initFtsIndex(db);
    const recorder = makeRecorder({}, { db });
    const now = "2026-08-19T00:00:00.000Z";
    db.query(`
      INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
      VALUES ('collision-scale-session', 'test', 'collision-scale', ?, ?, ?)
    `).run(now, now, now);
    const seed = db.query(`
      INSERT INTO mem_observations(
        id, platform, project, session_id, content, content_redacted,
        content_dedupe_hash, tags_json, privacy_tags_json, created_at, updated_at
      ) VALUES (?, 'test', 'collision-scale', 'collision-scale-session', ?, ?, ?, '[]', '[]', ?, ?)
    `);
    const seedMany = db.transaction(() => {
      for (let index = 0; index < 20_000; index += 1) {
        const content = `collision-scale-${index}-${"x".repeat(640)}`;
        seed.run(`collision-scale-${index}`, content, content, `collision-scale-hash-${index}`, now, now);
      }
    });
    seedMany();
    expect(statSync(dbPath).size).toBeGreaterThan(10 * 1024 * 1024);
    const labels: string[] = [];
    setEventRecorderSegmentSink((label) => labels.push(label));
    try {
      const payload = { content: "measured duplicate collision path" };
      const canonical = recorder.recordEvent(makeEvent({
        event_id: "collision-runtime-canonical", dedupe_hash: "collision-runtime-event-0",
        event_type: "session_end", payload,
      }));
      expect(canonical.ok).toBe(true);
      db.exec(`
        CREATE TABLE observation_update_probe(count INTEGER NOT NULL);
        INSERT INTO observation_update_probe(count) VALUES (0);
        CREATE TRIGGER observation_update_probe_trigger AFTER UPDATE ON mem_observations BEGIN
          UPDATE observation_update_probe SET count = count + 1;
        END;
      `);
      const changesBefore = db.query<{ total: number }, []>("SELECT total_changes() AS total").get()?.total ?? 0;
      const startedAt = performance.now();
      for (let index = 1; index <= 100; index += 1) {
        const duplicate = recorder.recordEvent(makeEvent({
          event_id: `collision-runtime-${index}`,
          dedupe_hash: `collision-runtime-event-${index}`,
          event_type: "session_end",
          ts: new Date(Date.parse(now) + index * 1_000).toISOString(),
          payload,
        }));
        expect(duplicate.items[0]?.id).toBe(canonical.items[0]?.id);
      }
      expect(performance.now() - startedAt).toBeLessThan(2_000);
      expect(labels.filter((label) => label === "dedupe_claim_arbitration")).toHaveLength(101);
      expect(labels).not.toContain("dedupe_conflict_lookup");
      expect(labels).not.toContain("dedupe_conflict_probe");
      expect(labels).not.toContain("dedupe_race_lookup");
      expect(db.query<{ count: number }, []>("SELECT count FROM observation_update_probe").get()?.count).toBe(0);
      const changesAfter = db.query<{ total: number }, []>("SELECT total_changes() AS total").get()?.total ?? 0;
      // Event insert + pointer update + narrow claim update are expected. The
      // rejected observation no-op UPSERT also rewrote FTS and exceeded this
      // measured bound by several changes per collision.
      expect(changesAfter - changesBefore).toBeLessThan(600);
    } finally {
      setEventRecorderSegmentSink(null);
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("正常なイベントが ok=true で記録される", () => {
    const recorder = makeRecorder();

    const res = recorder.recordEvent(makeEvent());
    expect(res.ok).toBe(true);
  });

  test("同一イベントの重複は dedupe される", () => {
    const recorder = makeRecorder();
    const event = makeEvent({ dedupe_hash: "custom-hash-dedup-001" });

    const first = recorder.recordEvent(event);
    const second = recorder.recordEvent(event);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((second.meta as Record<string, unknown>).deduped).toBe(true);
  });

  test("異なる ts のイベントは別エントリとして保存される", () => {
    const recorder = makeRecorder();

    const first = recorder.recordEvent(makeEvent({ ts: "2026-02-20T00:00:00.000Z", payload: { prompt: "event-a" } }));
    const second = recorder.recordEvent(makeEvent({ ts: "2026-02-20T01:00:00.000Z", payload: { prompt: "event-b" } }));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((second.meta as Record<string, unknown>).deduped).toBeFalsy();
  });

  test("privacy_tag=block のイベントはスキップされる", () => {
    const recorder = makeRecorder();

    const res = recorder.recordEvent(
      makeEvent({ privacy_tags: ["block"], payload: { content: "blocked content" } })
    );
    expect(res.ok).toBe(true);
    expect((res.meta as Record<string, unknown>).skipped).toBe(true);
  });

  test("captureEnabled=false のとき capture_enabled=false を返す", () => {
    const recorder = makeRecorder({ captureEnabled: false });

    const res = recorder.recordEvent(makeEvent());
    expect(res.ok).toBe(true);
    expect((res.meta as Record<string, unknown>).capture_enabled).toBe(false);
  });

  test("複数プラットフォームのイベントが正常に記録される", () => {
    const recorder = makeRecorder();

    for (const platform of ["claude", "codex", "opencode", "cursor"] as const) {
      const res = recorder.recordEvent(
        makeEvent({
          platform,
          session_id: `sess-${platform}`,
          ts: `2026-02-20T0${platform.length}:00:00.000Z`,
        })
      );
      expect(res.ok).toBe(true);
    }
  });

	  test("custom dedupe_hash が利用される", () => {
	    const recorder = makeRecorder();

    const first = recorder.recordEvent(makeEvent({ dedupe_hash: "custom-hash-abc", ts: "2026-02-20T00:00:00.000Z" }));
    const second = recorder.recordEvent(
      makeEvent({ dedupe_hash: "custom-hash-abc", ts: "2026-02-20T99:00:00.000Z" })
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
	    expect((second.meta as Record<string, unknown>).deduped).toBe(true);
	  });

	  test("同一 session_end summary は timestamp が違っても 1 observation に dedupe される", () => {
	    const recorder = makeRecorder();
	    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;

	    for (let i = 0; i < 10; i++) {
	      const res = recorder.recordEvent(makeEvent({
	        event_id: `summary-dedupe-${i}`,
	        event_type: "session_end",
	        ts: `2026-02-20T00:00:0${i}.000Z`,
	        payload: { content: "Finished §105 and keep Codex parity checks green." },
	      }));
	      expect(res.ok).toBe(true);
	    }

	    const count = db
	      .query<{ count: number }, []>(
	        `SELECT COUNT(*) AS count
	         FROM mem_observations
	         WHERE session_id = 'test-session-001'
	           AND observation_type = 'summary'
	           AND archived_at IS NULL`,
	      )
	      .get();
	    expect(count?.count).toBe(1);
	  });

	  test("checkpoint URL は本文が違っても同一URLなら 1 observation に dedupe される", () => {
	    const recorder = makeRecorder();
	    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
	    const first = recorder.recordEvent(makeEvent({
	      event_id: "checkpoint-url-1",
	      event_type: "checkpoint",
	      ts: "2026-02-20T00:00:00.000Z",
	      payload: { content: "Opened release PR https://github.com/example/repo/pull/105", url: "https://github.com/example/repo/pull/105" },
	    }));
	    const second = recorder.recordEvent(makeEvent({
	      event_id: "checkpoint-url-2",
	      event_type: "checkpoint",
	      ts: "2026-02-20T00:05:00.000Z",
	      payload: { content: "Reviewed same PR and left a note", url: "https://github.com/example/repo/pull/105" },
	    }));

	    expect(first.ok).toBe(true);
	    expect(second.ok).toBe(true);
	    expect((second.meta as Record<string, unknown>).deduped).toBe(true);
	    expect((second.meta as Record<string, unknown>).dedupe_basis).toBe("content");

	    const count = db
	      .query<{ count: number }, []>(
	        `SELECT COUNT(*) AS count
	         FROM mem_observations
	         WHERE session_id = 'test-session-001'
	           AND event_id LIKE 'checkpoint-url-%'
	           AND archived_at IS NULL`,
	      )
	      .get();
	    expect(count?.count).toBe(1);
	  });

	  test("必須フィールド欠落時はエラーを返す", () => {
    const recorder = makeRecorder();

    const res = recorder.recordEvent({
      platform: "claude",
      project: "",
      session_id: "sess-001",
      event_type: "user_prompt",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  test("adaptive の ensemble 保存では 1 observation に 2 ベクトル保存される", () => {
    const recorder = makeRecorder(
      { vectorDimension: 4 },
      {
        getVectorEngine: () => "js-fallback",
        buildPassageEmbeddings: () => ({
          primary: { model: "local:ruri-v3-30m", vector: [1, 0, 0, 0] },
          secondary: { model: "local:gte-small", vector: [0, 1, 0, 0] },
        }),
      },
    );

    const res = recorder.recordEvent(
      makeEvent({
        event_id: "ensemble-write-001",
        payload: { content: "本番 deploy と rollback のメモ" },
      }),
    );

    expect(res.ok).toBe(true);
    const rows = (recorder as unknown as { deps: EventRecorderDeps }).deps.db
      .query<{ model: string }, [string]>(
        `SELECT model
         FROM mem_vectors
         WHERE observation_id = ?
         ORDER BY model ASC`,
      )
      .all("obs_ensemble-write-001");
    expect(rows.map((row) => row.model)).toEqual(["local:gte-small", "local:ruri-v3-30m"]);
  });

  test("checkpoint は write embedding の async prime 待ちでも observation を保存する", () => {
    const recorder = makeRecorder(
      { vectorDimension: 4 },
      {
        getVectorEngine: () => "js-fallback",
        getEmbeddingProviderName: () => "local",
        getEmbeddingHealthStatus: () => "healthy",
        buildPassageEmbeddings: () => {
          const error = new Error(
            "write embedding is unavailable: local ONNX model multilingual-e5 requires async prime before sync embed",
          ) as Error & { readiness?: { retryable: boolean } };
          error.name = "EmbeddingReadinessError";
          error.readiness = { retryable: true };
          throw error;
        },
      },
    );

    const res = recorder.recordEvent(
      makeEvent({
        event_id: "checkpoint-prime-001",
        event_type: "checkpoint",
        payload: {
          title: "Loop completed",
          content: "Claude Harness loop finished and needs a durable checkpoint.",
        },
      }),
    );

    expect(res.ok).toBe(true);
    expect((res.meta as Record<string, unknown>).embedding_write_status).toBe("degraded");
    expect(String((res.meta as Record<string, unknown>).embedding_warning)).toContain("requires async prime");

    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const observation = db
      .query<{ title: string; content: string }, [string]>(
        `SELECT title, content FROM mem_observations WHERE id = ?`,
      )
      .get("obs_checkpoint-prime-001");
    expect(observation?.title).toBe("Loop completed");
    expect(observation?.content).toContain("durable checkpoint");

    const vectorCount = db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count FROM mem_vectors WHERE observation_id = ?`,
      )
      .get("obs_checkpoint-prime-001");
    expect(vectorCount?.count).toBe(0);
  });

  test("deferEmbedding=true の checkpoint は inline vector/nugget 生成をスキップする", async () => {
    let embeddingCalls = 0;
    const recorder = makeRecorder(
      { vectorDimension: 4 },
      {
        getVectorEngine: () => "js-fallback",
        buildPassageEmbeddings: () => {
          embeddingCalls += 1;
          return {
            primary: { model: "local:ruri-v3-30m", vector: [1, 0, 0, 0] },
            secondary: null,
          };
        },
        embedContent: () => {
          embeddingCalls += 1;
          return [0, 1, 0, 0];
        },
      },
    );

    const res = await recorder.recordEventQueued(
      makeEvent({
        event_id: "checkpoint-deferred-001",
        event_type: "checkpoint",
        payload: {
          title: "Queued checkpoint",
          content: "Checkpoint should be durable before vector backfill catches up.",
        },
      }),
      { allowQueue: true, deferEmbedding: true },
    );

    expect(res).not.toBe("queue_full");
    expect((res as Record<string, unknown>).ok).toBe(true);
    expect(((res as Record<string, unknown>).meta as Record<string, unknown>).embedding_write_status).toBe("deferred");
    expect(embeddingCalls).toBe(0);

    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const observation = db
      .query<{ title: string; content: string }, [string]>(
        `SELECT title, content FROM mem_observations WHERE id = ?`,
      )
      .get("obs_checkpoint-deferred-001");
    expect(observation?.title).toBe("Queued checkpoint");

    const vectorCount = db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count FROM mem_vectors WHERE observation_id = ?`,
      )
      .get("obs_checkpoint-deferred-001");
    const nuggetCount = db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count FROM mem_nuggets WHERE observation_id = ?`,
      )
      .get("obs_checkpoint-deferred-001");
    expect(vectorCount?.count).toBe(0);
    expect(nuggetCount?.count).toBe(0);
  });

  test("deferred checkpoint は後段 materializer で vector/entity/nugget を生成できる", async () => {
    let passageEmbeddings = 0;
    let nuggetEmbeddings = 0;
    const recorder = makeRecorder(
      { vectorDimension: 4 },
      {
        getVectorEngine: () => "js-fallback",
        buildPassageEmbeddings: () => {
          passageEmbeddings += 1;
          return {
            primary: { model: "local:ruri-v3-30m", vector: [1, 0, 0, 0] },
            secondary: null,
          };
        },
        embedContent: () => {
          nuggetEmbeddings += 1;
          return [0, 1, 0, 0];
        },
      },
    );

    const res = await recorder.recordEventQueued(
      makeEvent({
        event_id: "checkpoint-materialize-001",
        event_type: "checkpoint",
        payload: {
          title: "Deferred checkpoint materialization",
          content:
            "Materialize memory-server/src/core/harness-mem-core.ts and package @chachamaru127/harness-mem so semantic checkpoint recall catches up after durable write.",
        },
      }),
      { allowQueue: true, deferEmbedding: true },
    );

    expect(res).not.toBe("queue_full");
    expect((res as Record<string, unknown>).ok).toBe(true);
    expect(passageEmbeddings).toBe(0);
    expect(nuggetEmbeddings).toBe(0);

    const materialized = recorder.materializeObservationDerivedData("obs_checkpoint-materialize-001");

    expect(materialized.materialized).toBe(true);
    expect(materialized.vector_rows).toBe(1);
    expect(Number(materialized.entity_links)).toBeGreaterThan(0);
    expect(Number(materialized.nugget_rows)).toBeGreaterThan(0);
    expect(Number(materialized.nugget_vector_rows)).toBeGreaterThan(0);
    expect(passageEmbeddings).toBe(1);
    expect(nuggetEmbeddings).toBeGreaterThan(0);
  });

  test("checkpoint 以外の write embedding failure は従来通りエラーにする", () => {
    const recorder = makeRecorder(
      { vectorDimension: 4 },
      {
        getVectorEngine: () => "js-fallback",
        buildPassageEmbeddings: () => {
          throw new Error(
            "write embedding is unavailable: local ONNX model multilingual-e5 requires async prime before sync embed",
          );
        },
      },
    );

    const res = recorder.recordEvent(
      makeEvent({
        event_id: "prompt-prime-001",
        event_type: "user_prompt",
        payload: { prompt: "Keep normal writes strict." },
      }),
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain("requires async prime");
  });

  test("H156-004: allowlisted source のみ metadata_json に永続化する", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;

    const res = recorder.recordEvent(
      makeEvent({
        event_id: "evt-h156-source-001",
        metadata: {
          source: "hermes_memory_provider",
          api_key: "sk-secret-should-drop",
          token: "tok-secret-should-drop",
          secret: "secret-should-drop",
          prompt: "prompt-should-drop",
          response: "response-should-drop",
          nested: { leak: "must-not-persist" },
        },
      }),
    );
    expect(res.ok).toBe(true);

    const row = db
      .query<{ metadata_json: string }, [string]>(
        `SELECT metadata_json FROM mem_events WHERE event_id = ?`,
      )
      .get("evt-h156-source-001");
    expect(row?.metadata_json).toBe(JSON.stringify({ source: "hermes_memory_provider" }));
  });

  test("H156-004: source が無い metadata は metadata_json='{}' として永続化する", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;

    const res = recorder.recordEvent(
      makeEvent({
        event_id: "evt-h156-no-source-001",
        metadata: { api_key: "sk-drop", prompt: "drop-me" },
      }),
    );
    expect(res.ok).toBe(true);

    const row = db
      .query<{ metadata_json: string }, [string]>(
        `SELECT metadata_json FROM mem_events WHERE event_id = ?`,
      )
      .get("evt-h156-no-source-001");
    expect(row?.metadata_json).toBe("{}");
  });

  test("H156-004: 空文字 source は metadata_json='{}' として永続化する", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;

    const res = recorder.recordEvent(
      makeEvent({
        event_id: "evt-h156-empty-source-001",
        metadata: { source: "   " },
      }),
    );
    expect(res.ok).toBe(true);

    const row = db
      .query<{ metadata_json: string }, [string]>(
        `SELECT metadata_json FROM mem_events WHERE event_id = ?`,
      )
      .get("evt-h156-empty-source-001");
    expect(row?.metadata_json).toBe("{}");
  });

  test("checkpoint でも permanent な write embedding failure はエラーにする", () => {
    const recorder = makeRecorder(
      { vectorDimension: 4 },
      {
        getVectorEngine: () => "js-fallback",
        buildPassageEmbeddings: () => {
          const error = new Error(
            "write embedding is unavailable: local ONNX model multilingual-e5 failed to initialize",
          ) as Error & { code?: string; readiness?: { retryable: boolean } };
          error.name = "EmbeddingReadinessError";
          error.code = "init_failed";
          error.readiness = { retryable: true };
          throw error;
        },
      },
    );

    const res = recorder.recordEvent(
      makeEvent({
        event_id: "checkpoint-init-failed-001",
        event_type: "checkpoint",
        payload: {
          title: "Loop completed",
          content: "This should not hide a permanent embedding failure.",
        },
      }),
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain("failed to initialize");
  });
});

// ---------------------------------------------------------------------------
// getStreamEventsSince テスト
// ---------------------------------------------------------------------------

describe("event-recorder: getStreamEventsSince", () => {
  test("初期状態では空の配列を返す", () => {
    const recorder = makeRecorder();

    const events = recorder.getStreamEventsSince(0);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(0);
  });

  test("appendStreamEvent 後にストリームイベントが取得できる", () => {
    const recorder = makeRecorder();

    recorder.appendStreamEvent("observation.created", { obs_id: "obs_1" });
    const events = recorder.getStreamEventsSince(0);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);

    const event = events[0];
    expect(event).toHaveProperty("id");
    expect(event).toHaveProperty("type");
    expect(event).toHaveProperty("ts");
    expect(event).toHaveProperty("data");
  });

  test("lastEventId より新しいイベントのみ返す", () => {
    const recorder = makeRecorder();

    recorder.appendStreamEvent("observation.created", { obs_id: "obs_1" });
    const allEvents = recorder.getStreamEventsSince(0);
    const lastId = allEvents.length > 0 ? allEvents[allEvents.length - 1].id : 0;

    recorder.appendStreamEvent("observation.created", { obs_id: "obs_2" });
    const newEvents = recorder.getStreamEventsSince(lastId);

    for (const event of newEvents) {
      expect(event.id).toBeGreaterThan(lastId);
    }
  });

  test("limit パラメータで取得数が制限される", () => {
    const recorder = makeRecorder();

    for (let i = 0; i < 5; i++) {
      recorder.appendStreamEvent("observation.created", { obs_id: `obs_${i}` });
    }
    const events = recorder.getStreamEventsSince(0, 2);
    expect(events.length).toBeLessThanOrEqual(2);
  });

  test("getLatestStreamEventId() は直近イベント ID を返す", () => {
    const recorder = makeRecorder();

    expect(recorder.getLatestStreamEventId()).toBe(0);

    recorder.appendStreamEvent("observation.created", { obs_id: "obs_1" });
    recorder.appendStreamEvent("session.finalized", { session_id: "sess_1" });

    const events = recorder.getStreamEventsSince(0);
    const lastId = events[events.length - 1]?.id ?? 0;
    expect(recorder.getLatestStreamEventId()).toBe(lastId);
  });
});

// ---------------------------------------------------------------------------
// recordEventQueued テスト
// ---------------------------------------------------------------------------

describe("event-recorder: recordEventQueued", () => {
  test("recordEventQueued は非同期で ok=true を返す", async () => {
    const recorder = makeRecorder();

    const result = await recorder.recordEventQueued(makeEvent({
      ts: "2026-02-20T10:00:00.000Z",
      payload: { prompt: "queued event test" },
    }));
    expect(result).not.toBe("queue_full");
    if (result !== "queue_full") {
      expect(result.ok).toBe(true);
    }
  });
});
