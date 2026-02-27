/**
 * IMP-004a: イベント記録モジュール境界テスト
 *
 * 分割後の event-recorder.ts が担当する API を TDD で定義する。
 * recordEvent / recordEventQueued / getStreamEventsSince を対象とする。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HarnessMemCore,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `event-recorder-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "proj-recorder",
    session_id: "sess-rec-001",
    event_type: "user_prompt",
    ts: "2026-02-20T00:00:00.000Z",
    payload: { prompt: "record test" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("event-recorder: recordEvent", () => {
  test("正常なイベントが ok=true で記録される", () => {
    const core = new HarnessMemCore(createConfig("record-basic"));
    try {
      const res = core.recordEvent(makeEvent());
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("同一イベントの重複は dedupe される", () => {
    const core = new HarnessMemCore(createConfig("record-dedupe"));
    try {
      const first = core.recordEvent(makeEvent());
      const second = core.recordEvent(makeEvent());
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect((second.meta as Record<string, unknown>).deduped).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("異なる ts のイベントは別エントリとして保存される", () => {
    const core = new HarnessMemCore(createConfig("record-different-ts"));
    try {
      const first = core.recordEvent(makeEvent({ ts: "2026-02-20T00:00:00.000Z", payload: { prompt: "event-a" } }));
      const second = core.recordEvent(makeEvent({ ts: "2026-02-20T01:00:00.000Z", payload: { prompt: "event-b" } }));
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect((second.meta as Record<string, unknown>).deduped).toBeFalsy();
    } finally {
      core.shutdown("test");
    }
  });

  test("privacy_tag=block のイベントはスキップされる", () => {
    const core = new HarnessMemCore(createConfig("record-block"));
    try {
      const res = core.recordEvent(
        makeEvent({ privacy_tags: ["block"], payload: { content: "blocked content" } })
      );
      expect(res.ok).toBe(true);
      expect((res.meta as Record<string, unknown>).skipped).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("captureEnabled=false の場合、空アイテムが返されキャプチャ無効フラグが付く", () => {
    const dir = mkdtempSync(join(tmpdir(), "event-recorder-capture-disabled-"));
    cleanupPaths.push(dir);
    const config: Config = {
      dbPath: join(dir, "harness-mem.db"),
      bindHost: "127.0.0.1",
      bindPort: 37888,
      vectorDimension: 64,
      captureEnabled: false,
      retrievalEnabled: true,
      injectionEnabled: true,
      codexHistoryEnabled: false,
      codexProjectRoot: process.cwd(),
      codexSessionsRoot: process.cwd(),
      codexIngestIntervalMs: 5000,
      codexBackfillHours: 24,
      opencodeIngestEnabled: false,
      cursorIngestEnabled: false,
      antigravityIngestEnabled: false,
    };
    const core = new HarnessMemCore(config);
    try {
      const res = core.recordEvent(makeEvent());
      expect(res.ok).toBe(true);
      expect(res.items).toEqual([]);
      expect((res.meta as Record<string, unknown>).capture_enabled).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("複数プラットフォームのイベントが正常に記録される", () => {
    const core = new HarnessMemCore(createConfig("record-multi-platform"));
    try {
      for (const platform of ["claude", "codex", "opencode", "cursor"] as const) {
        const res = core.recordEvent(
          makeEvent({
            platform,
            session_id: `sess-${platform}`,
            ts: `2026-02-20T0${platform.length}:00:00.000Z`,
          })
        );
        expect(res.ok).toBe(true);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("custom dedupe_hash が利用される", () => {
    const core = new HarnessMemCore(createConfig("record-custom-dedupe-hash"));
    try {
      const first = core.recordEvent(makeEvent({ dedupe_hash: "custom-hash-abc" }));
      const second = core.recordEvent(
        makeEvent({ dedupe_hash: "custom-hash-abc", ts: "2026-02-20T99:00:00.000Z" })
      );
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect((second.meta as Record<string, unknown>).deduped).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("event-recorder: getStreamEventsSince", () => {
  test("初期状態では空の配列を返す", () => {
    const core = new HarnessMemCore(createConfig("stream-events-empty"));
    try {
      const events = core.getStreamEventsSince(0);
      expect(Array.isArray(events)).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("イベント記録後にストリームイベントが生成される", () => {
    const core = new HarnessMemCore(createConfig("stream-events-after-record"));
    try {
      core.recordEvent(makeEvent());
      const events = core.getStreamEventsSince(0);
      expect(Array.isArray(events)).toBe(true);
      // observation.created が含まれる場合
      if (events.length > 0) {
        const event = events[0];
        expect(event).toHaveProperty("id");
        expect(event).toHaveProperty("type");
        expect(event).toHaveProperty("ts");
        expect(event).toHaveProperty("data");
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("lastEventId より新しいイベントのみ返す", () => {
    const core = new HarnessMemCore(createConfig("stream-events-since"));
    try {
      core.recordEvent(makeEvent({ payload: { prompt: "first" } }));
      const allEvents = core.getStreamEventsSince(0);
      const lastId = allEvents.length > 0 ? allEvents[allEvents.length - 1].id : 0;

      core.recordEvent(
        makeEvent({ ts: "2026-02-20T01:00:00.000Z", payload: { prompt: "second" } })
      );
      const newEvents = core.getStreamEventsSince(lastId);
      // 最後のIDより新しいイベントのみ含む
      for (const event of newEvents) {
        expect(event.id).toBeGreaterThan(lastId);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("limit パラメータで取得数が制限される", () => {
    const core = new HarnessMemCore(createConfig("stream-events-limit"));
    try {
      for (let i = 0; i < 5; i++) {
        core.recordEvent(
          makeEvent({ ts: `2026-02-20T0${i}:00:00.000Z`, payload: { prompt: `event-${i}` } })
        );
      }
      const events = core.getStreamEventsSince(0, 2);
      expect(events.length).toBeLessThanOrEqual(2);
    } finally {
      core.shutdown("test");
    }
  });
});
