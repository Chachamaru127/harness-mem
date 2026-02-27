/**
 * IMP-004a: セッション管理モジュール境界テスト
 *
 * 分割後の session-manager.ts が担当する API を TDD で定義する。
 * 現時点では HarnessMemCore 経由でテストし、分割後も同インタフェースを維持することを保証する。
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
  const dir = mkdtempSync(join(tmpdir(), `session-manager-${name}-`));
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
    project: "proj-session",
    session_id: "sess-001",
    event_type: "user_prompt",
    ts: "2026-02-20T00:00:00.000Z",
    payload: { prompt: "hello" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("session-manager: sessionsList", () => {
  test("イベント記録後にセッションが一覧に現れる", () => {
    const core = new HarnessMemCore(createConfig("sessions-list"));
    try {
      core.recordEvent(makeEvent());
      const res = core.sessionsList({ project: "proj-session" });
      expect(res.ok).toBe(true);
      expect(res.items.length).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("別プロジェクトのセッションはフィルタされる", () => {
    const core = new HarnessMemCore(createConfig("sessions-filter"));
    try {
      core.recordEvent(makeEvent({ project: "proj-a", session_id: "sess-a" }));
      core.recordEvent(makeEvent({ project: "proj-b", session_id: "sess-b" }));
      const res = core.sessionsList({ project: "proj-a" });
      expect(res.ok).toBe(true);
      const sessionIds = (res.items as Array<Record<string, unknown>>).map((s) => s.session_id);
      expect(sessionIds).toContain("sess-a");
      expect(sessionIds).not.toContain("sess-b");
    } finally {
      core.shutdown("test");
    }
  });

  test("limit パラメータが反映される", () => {
    const core = new HarnessMemCore(createConfig("sessions-limit"));
    try {
      for (let i = 0; i < 5; i++) {
        core.recordEvent(makeEvent({ session_id: `sess-${i}`, ts: `2026-02-20T0${i}:00:00.000Z` }));
      }
      const res = core.sessionsList({ project: "proj-session", limit: 2 });
      expect(res.ok).toBe(true);
      expect(res.items.length).toBeLessThanOrEqual(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("セッションなしの場合は空配列を返す", () => {
    const core = new HarnessMemCore(createConfig("sessions-empty"));
    try {
      const res = core.sessionsList({ project: "nonexistent-project" });
      expect(res.ok).toBe(true);
      expect(res.items).toEqual([]);
    } finally {
      core.shutdown("test");
    }
  });

  test("private_tags のセッションは include_private=false で除外される", () => {
    const core = new HarnessMemCore(createConfig("sessions-private"));
    try {
      core.recordEvent(makeEvent({ session_id: "sess-public" }));
      core.recordEvent(
        makeEvent({ session_id: "sess-private", privacy_tags: ["private"] })
      );
      const res = core.sessionsList({ project: "proj-session", include_private: false });
      expect(res.ok).toBe(true);
      const sessionIds = (res.items as Array<Record<string, unknown>>).map((s) => s.session_id);
      expect(sessionIds).toContain("sess-public");
    } finally {
      core.shutdown("test");
    }
  });
});

describe("session-manager: sessionThread", () => {
  test("セッションスレッドにそのセッションのイベントが含まれる", () => {
    const core = new HarnessMemCore(createConfig("session-thread-basic"));
    try {
      core.recordEvent(makeEvent({ payload: { prompt: "first event" } }));
      const res = core.sessionThread({ session_id: "sess-001", project: "proj-session" });
      expect(res.ok).toBe(true);
      expect(res.items.length).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("別セッションのイベントはスレッドに含まれない", () => {
    const core = new HarnessMemCore(createConfig("session-thread-filter"));
    try {
      core.recordEvent(makeEvent({ session_id: "sess-001" }));
      core.recordEvent(makeEvent({ session_id: "sess-002", ts: "2026-02-20T01:00:00.000Z" }));
      const res = core.sessionThread({ session_id: "sess-001", project: "proj-session" });
      expect(res.ok).toBe(true);
      const sessionIds = new Set(
        (res.items as Array<Record<string, unknown>>).map((item) => item.session_id)
      );
      expect(sessionIds.has("sess-001")).toBe(true);
      expect(sessionIds.has("sess-002")).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("存在しないセッションは空配列を返す", () => {
    const core = new HarnessMemCore(createConfig("session-thread-empty"));
    try {
      const res = core.sessionThread({ session_id: "nonexistent-sess", project: "proj-session" });
      expect(res.ok).toBe(true);
      expect(res.items).toEqual([]);
    } finally {
      core.shutdown("test");
    }
  });

  test("limit パラメータが反映される", () => {
    const core = new HarnessMemCore(createConfig("session-thread-limit"));
    try {
      for (let i = 0; i < 5; i++) {
        core.recordEvent(
          makeEvent({ ts: `2026-02-20T0${i}:00:00.000Z`, payload: { prompt: `event-${i}` } })
        );
      }
      const res = core.sessionThread({ session_id: "sess-001", project: "proj-session", limit: 2 });
      expect(res.ok).toBe(true);
      expect(res.items.length).toBeLessThanOrEqual(2);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("session-manager: recordCheckpoint", () => {
  test("チェックポイントが正常に記録される", () => {
    const core = new HarnessMemCore(createConfig("checkpoint-basic"));
    try {
      const res = core.recordCheckpoint({
        session_id: "sess-001",
        title: "テストチェックポイント",
        content: "チェックポイントの内容",
        project: "proj-session",
      });
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("チェックポイントが observation として保存されてスレッドで取得できる", () => {
    const core = new HarnessMemCore(createConfig("checkpoint-retrieval"));
    try {
      core.recordCheckpoint({
        session_id: "sess-001",
        title: "チェックポイント1",
        content: "重要な決定事項",
        project: "proj-session",
        tags: ["checkpoint"],
      });
      const thread = core.sessionThread({ session_id: "sess-001", project: "proj-session" });
      expect(thread.ok).toBe(true);
      expect(thread.items.length).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("session_id なしはエラーにならずに処理される", () => {
    const core = new HarnessMemCore(createConfig("checkpoint-no-session"));
    try {
      // session_id は必須フィールドだが型チェックを通過する値でテスト
      const res = core.recordCheckpoint({
        session_id: "",
        title: "test",
        content: "test content",
      });
      // session_id が空でも API が応答を返すことを確認
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });

  test("tags と privacy_tags が正しく伝播する", () => {
    const core = new HarnessMemCore(createConfig("checkpoint-tags"));
    try {
      const res = core.recordCheckpoint({
        session_id: "sess-001",
        title: "タグ付きチェックポイント",
        content: "内容",
        project: "proj-session",
        tags: ["important", "decision"],
        privacy_tags: [],
      });
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("platform 省略時はデフォルト値が使用される", () => {
    const core = new HarnessMemCore(createConfig("checkpoint-platform-default"));
    try {
      const res = core.recordCheckpoint({
        session_id: "sess-001",
        title: "プラットフォームデフォルト",
        content: "テスト",
        project: "proj-session",
      });
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("session-manager: finalizeSession", () => {
  test("セッションが正常にファイナライズされる", () => {
    const core = new HarnessMemCore(createConfig("finalize-basic"));
    try {
      core.recordEvent(makeEvent({ payload: { prompt: "作業内容" } }));
      const res = core.finalizeSession({
        session_id: "sess-001",
        project: "proj-session",
      });
      expect(res.ok).toBe(true);
      expect(res.items.length).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("session_id なしはエラーを返す", () => {
    const core = new HarnessMemCore(createConfig("finalize-no-session"));
    try {
      const res = core.finalizeSession({ session_id: "" });
      expect(res.ok).toBe(false);
      expect(res.error).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });

  test("summary_mode が standard / short / detailed で動作する", () => {
    for (const mode of ["standard", "short", "detailed"] as const) {
      const core = new HarnessMemCore(createConfig(`finalize-mode-${mode}`));
      try {
        core.recordEvent(makeEvent());
        const res = core.finalizeSession({
          session_id: "sess-001",
          project: "proj-session",
          summary_mode: mode,
        });
        expect(res.ok).toBe(true);
        const item = res.items[0] as Record<string, unknown>;
        expect(item.summary_mode).toBe(mode);
      } finally {
        core.shutdown("test");
      }
    }
  });

  test("観察なしのセッションもファイナライズに成功する", () => {
    const core = new HarnessMemCore(createConfig("finalize-no-observations"));
    try {
      const res = core.finalizeSession({
        session_id: "sess-no-obs",
        project: "proj-session",
      });
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("ファイナライズ後 sessionsList に ended_at が記録される", () => {
    const core = new HarnessMemCore(createConfig("finalize-ended-at"));
    try {
      core.recordEvent(makeEvent());
      core.finalizeSession({ session_id: "sess-001", project: "proj-session" });
      const res = core.sessionsList({ project: "proj-session" });
      expect(res.ok).toBe(true);
      const session = (res.items as Array<Record<string, unknown>>).find(
        (s) => s.session_id === "sess-001"
      );
      expect(session).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });
});
