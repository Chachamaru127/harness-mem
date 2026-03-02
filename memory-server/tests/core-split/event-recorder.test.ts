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
  configOverrides: Partial<Config> = {}
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
