/**
 * IMP-004a: イベント記録モジュール境界テスト
 *
 * EventRecorder を直接インスタンス化してテストする真のユニットテスト。
 * recordEvent / recordEventQueued / getStreamEventsSince を対象とする。
 */

import { describe, expect, test } from "bun:test";
import {
  EventRecorder,
  type EventRecorderDeps,
} from "../../src/core/event-recorder";
import type {
  Config,
  EventEnvelope,
} from "../../src/core/types";
import { createTestDb, createTestConfig, makeEvent } from "./test-helpers";

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
    ...depOverrides,
  };
  return new EventRecorder(deps);
}

// ---------------------------------------------------------------------------
// recordEvent テスト
// ---------------------------------------------------------------------------

describe("event-recorder: recordEvent", () => {
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
