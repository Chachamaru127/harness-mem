/**
 * IMP-004a: イベント記録モジュール境界テスト
 *
 * EventRecorder を直接インスタンス化してテストする真のユニットテスト。
 * recordEvent / recordEventQueued / getStreamEventsSince を対象とする。
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
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
import { configureDatabase, initFtsIndex, initSchema, migrateSchema } from "../../src/db/schema";

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

  test("same session is ensured once per tick, but an earlier start refreshes it", () => {
    const recorder = makeRecorder();
    const db = (recorder as unknown as { deps: EventRecorderDeps }).deps.db;
    const labels: string[] = [];
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
        ts: "2026-02-20T00:00:00.000Z", payload: { prompt: "three" },
      }));
    } finally {
      endIngestTickTelemetry(tick, db, 0, Infinity);
      setEventRecorderSegmentSink(null);
    }
    expect(labels.filter((label) => label === "ensure_session")).toHaveLength(2);
    const session = db.query<{ started_at: string }, [string]>(
      "SELECT started_at FROM mem_sessions WHERE session_id = ?",
    ).get("test-session-001");
    expect(session?.started_at).toBe("2026-02-20T00:00:00.000Z");
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
      }), { allowQueue: false });
      expect(second.ok).toBe(false);
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
