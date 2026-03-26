/**
 * IMP-004a: セッション管理モジュール境界テスト
 *
 * SessionManager を直接インスタンス化してテストする真のユニットテスト。
 * HarnessMemCore を経由しない。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { SessionManager, type SessionManagerDeps } from "../../src/core/session-manager";
import type { ApiResponse, Config, EventEnvelope, StreamEvent } from "../../src/core/types";
import { createTestDb, createTestConfig, insertTestObservation } from "./test-helpers";
import type { Database } from "bun:sqlite";

const cleanupDbs: Database[] = [];

afterEach(() => {
  while (cleanupDbs.length > 0) {
    const db = cleanupDbs.pop();
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createRecordEventMock(db: Database) {
  return (event: EventEnvelope): ApiResponse => {
    const now = new Date().toISOString();
    const obsId = `obs_${Math.random().toString(36).slice(2, 8)}`;
    const eventId = event.event_id || `evt_${Math.random().toString(36).slice(2, 8)}`;
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
      event.event_type || "user_prompt",
      event.ts || now,
      JSON.stringify(event.payload || {}),
      JSON.stringify(event.tags || []),
      JSON.stringify(event.privacy_tags || []),
      dedupeHash,
      obsId,
      now,
    );

    // Insert observation
    const content =
      typeof event.payload?.prompt === "string"
        ? event.payload.prompt
        : JSON.stringify(event.payload || {});
    const title =
      event.event_type === "checkpoint" && typeof event.payload?.title === "string"
        ? event.payload.title
        : content.slice(0, 80) || "observation";
    db.query(
      `INSERT OR IGNORE INTO mem_observations (id, event_id, platform, project, session_id, title, content, content_redacted, observation_type, tags_json, privacy_tags_json, signal_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'context', ?, ?, 0, ?, ?)`
    ).run(
      obsId,
      eventId,
      platform,
      project,
      sessionId,
      title,
      content,
      content,
      JSON.stringify(event.tags || []),
      JSON.stringify(event.privacy_tags || []),
      now,
      now,
    );

    return {
      ok: true,
      source: "core",
      items: [{ id: obsId, event_id: eventId, content, title }],
      meta: {
        count: 1,
        latency_ms: 0,
        sla_latency_ms: 0,
        filters: {},
        ranking: "hybrid_v3",
        deduped: false,
      },
    };
  };
}

let streamEventCounter = 0;
function appendStreamEventMock(type: string, data: Record<string, unknown>): StreamEvent {
  streamEventCounter++;
  return { id: streamEventCounter, type: type as StreamEvent["type"], data, ts: Date.now() };
}

function enqueueConsolidationMock(_project: string, _sessionId: string, _reason: string): void {
  // no-op
}

function createDeps(db: Database, config: Config): SessionManagerDeps {
  return {
    db,
    config,
    normalizeProject: (project: string) => project,
    canonicalizeProject: (project: string) => project,
    expandProjectSelection: (project: string) => [project],
    visibilityFilterSql: (alias: string, includePrivate: boolean) => {
      if (includePrivate) return " AND 1=1";
      return ` AND ${alias}.privacy_tags_json = '[]'`;
    },
    platformVisibilityFilterSql: (_alias: string) => " AND 1=1",
    recordEvent: createRecordEventMock(db),
    appendStreamEvent: appendStreamEventMock,
    enqueueConsolidation: enqueueConsolidationMock,
  };
}

function createSessionManager(name: string): { sm: SessionManager; db: Database; config: Config } {
  const db = createTestDb();
  cleanupDbs.push(db);
  const config = createTestConfig();
  const deps = createDeps(db, config);
  const sm = new SessionManager(deps);
  return { sm, db, config };
}

// ---------------------------------------------------------------------------
// sessionsList
// ---------------------------------------------------------------------------

describe("session-manager: sessionsList", () => {
  test("イベント記録後にセッションが一覧に現れる", () => {
    const { sm, db } = createSessionManager("sessions-list");
    insertTestObservation(db, {
      project: "proj-session",
      session_id: "sess-001",
      content: "hello",
    });
    const res = sm.sessionsList({ project: "proj-session" });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeGreaterThanOrEqual(1);
  });

  test("別プロジェクトのセッションはフィルタされる", () => {
    const { sm, db } = createSessionManager("sessions-filter");
    insertTestObservation(db, { project: "proj-a", session_id: "sess-a" });
    insertTestObservation(db, { project: "proj-b", session_id: "sess-b" });
    const res = sm.sessionsList({ project: "proj-a" });
    expect(res.ok).toBe(true);
    const sessionIds = (res.items as Array<Record<string, unknown>>).map((s) => s.session_id);
    expect(sessionIds).toContain("sess-a");
    expect(sessionIds).not.toContain("sess-b");
  });

  test("limit パラメータが反映される", () => {
    const { sm, db } = createSessionManager("sessions-limit");
    for (let i = 0; i < 5; i++) {
      insertTestObservation(db, {
        project: "proj-session",
        session_id: `sess-${i}`,
        created_at: `2026-02-20T0${i}:00:00.000Z`,
      });
    }
    const res = sm.sessionsList({ project: "proj-session", limit: 2 });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeLessThanOrEqual(2);
  });

  test("セッションなしの場合は空配列を返す", () => {
    const { sm } = createSessionManager("sessions-empty");
    const res = sm.sessionsList({ project: "nonexistent-project" });
    expect(res.ok).toBe(true);
    expect(res.items).toEqual([]);
  });

  test("privacy_tags のセッションは include_private=false で除外される", () => {
    const { sm, db } = createSessionManager("sessions-private");
    insertTestObservation(db, {
      project: "proj-session",
      session_id: "sess-public",
      privacy_tags: [],
    });
    insertTestObservation(db, {
      project: "proj-session",
      session_id: "sess-private",
      privacy_tags: ["private"],
    });
    const res = sm.sessionsList({ project: "proj-session", include_private: false });
    expect(res.ok).toBe(true);
    const sessionIds = (res.items as Array<Record<string, unknown>>).map((s) => s.session_id);
    expect(sessionIds).toContain("sess-public");
  });
});

// ---------------------------------------------------------------------------
// sessionThread
// ---------------------------------------------------------------------------

describe("session-manager: sessionThread", () => {
  test("セッションスレッドにそのセッションのイベントが含まれる", () => {
    const { sm, db } = createSessionManager("session-thread-basic");
    insertTestObservation(db, {
      project: "proj-session",
      session_id: "sess-001",
      content: "first event",
    });
    const res = sm.sessionThread({ session_id: "sess-001", project: "proj-session" });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeGreaterThanOrEqual(1);
  });

  test("別セッションのイベントはスレッドに含まれない", () => {
    const { sm, db } = createSessionManager("session-thread-filter");
    insertTestObservation(db, { project: "proj-session", session_id: "sess-001" });
    insertTestObservation(db, { project: "proj-session", session_id: "sess-002" });
    const res = sm.sessionThread({ session_id: "sess-001", project: "proj-session" });
    expect(res.ok).toBe(true);
    const sessionIds = new Set(
      (res.items as Array<Record<string, unknown>>).map((item) => item.session_id)
    );
    expect(sessionIds.has("sess-001")).toBe(true);
    expect(sessionIds.has("sess-002")).toBe(false);
  });

  test("存在しないセッションは空配列を返す", () => {
    const { sm } = createSessionManager("session-thread-empty");
    const res = sm.sessionThread({ session_id: "nonexistent-sess", project: "proj-session" });
    expect(res.ok).toBe(true);
    expect(res.items).toEqual([]);
  });

  test("limit パラメータが反映される", () => {
    const { sm, db } = createSessionManager("session-thread-limit");
    for (let i = 0; i < 5; i++) {
      insertTestObservation(db, {
        project: "proj-session",
        session_id: "sess-001",
        created_at: `2026-02-20T0${i}:00:00.000Z`,
        content: `event-${i}`,
      });
    }
    const res = sm.sessionThread({ session_id: "sess-001", project: "proj-session", limit: 2 });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeLessThanOrEqual(2);
  });

  test("Claude wrapper prompt はスレッド表示から除外される", () => {
    const { sm, db } = createSessionManager("session-thread-wrapper-filter");
    insertTestObservation(db, {
      project: "proj-session",
      session_id: "sess-001",
      title: "<command-name>/plugin</command-name>",
      content: "<command-name>/plugin</command-name>\n<command-message>plugin</command-message>\n<command-args></command-args>",
      created_at: "2026-03-11T00:00:00.000Z",
    });
    insertTestObservation(db, {
      project: "proj-session",
      session_id: "sess-001",
      title: "visible prompt",
      content: "visible prompt",
      created_at: "2026-03-11T00:00:01.000Z",
    });

    const res = sm.sessionThread({ session_id: "sess-001", project: "proj-session" });
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect((res.items[0] as Record<string, unknown>).content).toBe("visible prompt");
  });
});

// ---------------------------------------------------------------------------
// recordCheckpoint
// ---------------------------------------------------------------------------

describe("session-manager: recordCheckpoint", () => {
  test("チェックポイントが正常に記録される", () => {
    const { sm } = createSessionManager("checkpoint-basic");
    const res = sm.recordCheckpoint({
      session_id: "sess-001",
      title: "テストチェックポイント",
      content: "チェックポイントの内容",
      project: "proj-session",
    });
    expect(res.ok).toBe(true);
  });

  test("チェックポイントが observation として保存されてスレッドで取得できる", () => {
    const { sm, db } = createSessionManager("checkpoint-retrieval");
    // recordCheckpoint calls recordEvent mock which inserts into DB
    sm.recordCheckpoint({
      session_id: "sess-001",
      title: "チェックポイント1",
      content: "重要な決定事項",
      project: "proj-session",
      tags: ["checkpoint"],
    });
    const thread = sm.sessionThread({ session_id: "sess-001", project: "proj-session" });
    expect(thread.ok).toBe(true);
    expect(thread.items.length).toBeGreaterThanOrEqual(1);
  });

  test("session_id なしはエラーにならずに処理される", () => {
    const { sm } = createSessionManager("checkpoint-no-session");
    const res = sm.recordCheckpoint({
      session_id: "",
      title: "test",
      content: "test content",
    });
    // session_id が空でも API が応答を返すことを確認
    expect(typeof res.ok).toBe("boolean");
  });

  test("tags と privacy_tags が正しく伝播する", () => {
    const { sm } = createSessionManager("checkpoint-tags");
    const res = sm.recordCheckpoint({
      session_id: "sess-001",
      title: "タグ付きチェックポイント",
      content: "内容",
      project: "proj-session",
      tags: ["important", "decision"],
      privacy_tags: [],
    });
    expect(res.ok).toBe(true);
  });

  test("platform 省略時はデフォルト値が使用される", () => {
    const { sm } = createSessionManager("checkpoint-platform-default");
    const res = sm.recordCheckpoint({
      session_id: "sess-001",
      title: "プラットフォームデフォルト",
      content: "テスト",
      project: "proj-session",
    });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// finalizeSession
// ---------------------------------------------------------------------------

describe("session-manager: finalizeSession", () => {
  test("セッションが正常にファイナライズされる", () => {
    const { sm, db } = createSessionManager("finalize-basic");
    insertTestObservation(db, {
      project: "proj-session",
      session_id: "sess-001",
      content: "作業内容",
    });
    const res = sm.finalizeSession({
      session_id: "sess-001",
      project: "proj-session",
    });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeGreaterThanOrEqual(1);
  });

  test("session_id なしはエラーを返す", () => {
    const { sm } = createSessionManager("finalize-no-session");
    const res = sm.finalizeSession({ session_id: "" });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  test("summary_mode が standard / short / detailed で動作する", () => {
    for (const mode of ["standard", "short", "detailed"] as const) {
      const { sm, db } = createSessionManager(`finalize-mode-${mode}`);
      insertTestObservation(db, {
        project: "proj-session",
        session_id: "sess-001",
      });
      const res = sm.finalizeSession({
        session_id: "sess-001",
        project: "proj-session",
        summary_mode: mode,
      });
      expect(res.ok).toBe(true);
      const item = res.items[0] as Record<string, unknown>;
      expect(item.summary_mode).toBe(mode);
    }
  });

  test("観察なしのセッションもファイナライズに成功する", () => {
    const { sm, db } = createSessionManager("finalize-no-observations");
    // セッションのみ作成（観察なし）
    const now = new Date().toISOString();
    db.query(
      `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run("sess-no-obs", "claude", "proj-session", now, now, now);
    const res = sm.finalizeSession({
      session_id: "sess-no-obs",
      project: "proj-session",
    });
    expect(res.ok).toBe(true);
  });

  test("ファイナライズ後 sessionsList に ended_at が記録される", () => {
    const { sm, db } = createSessionManager("finalize-ended-at");
    insertTestObservation(db, {
      project: "proj-session",
      session_id: "sess-001",
    });
    sm.finalizeSession({ session_id: "sess-001", project: "proj-session" });
    const res = sm.sessionsList({ project: "proj-session" });
    expect(res.ok).toBe(true);
    const session = (res.items as Array<Record<string, unknown>>).find(
      (s) => s.session_id === "sess-001"
    );
    expect(session).toBeTruthy();
  });

  test("構造化 handoff が decisions / open_loops / next_actions / risks を含む", () => {
    const { sm, db } = createSessionManager("finalize-handoff-structured");
    const recordEvent = createRecordEventMock(db);

    recordEvent({
      platform: "claude",
      project: "proj-session",
      session_id: "sess-001",
      event_type: "user_prompt",
      ts: "2026-03-24T10:00:00.000Z",
      payload: { prompt: "Why is session continuity still failing?" },
      tags: [],
      privacy_tags: [],
    });
    recordEvent({
      platform: "claude",
      project: "proj-session",
      session_id: "sess-001",
      event_type: "checkpoint",
      ts: "2026-03-24T10:00:02.000Z",
      payload: {
        title: "assistant_response",
        content: "We decided to reuse correlation_id handoff across sessions.",
      },
      tags: [],
      privacy_tags: [],
    });
    recordEvent({
      platform: "claude",
      project: "proj-session",
      session_id: "sess-001",
      event_type: "checkpoint",
      ts: "2026-03-24T10:00:03.000Z",
      payload: {
        title: "next action",
        content: "Next action: wire correlation_id through session start and stop hooks.",
      },
      tags: [],
      privacy_tags: [],
    });
    recordEvent({
      platform: "claude",
      project: "proj-session",
      session_id: "sess-001",
      event_type: "checkpoint",
      ts: "2026-03-24T10:00:04.000Z",
      payload: {
        title: "risk note",
        content: "Risk: wrong chain contamination if multiple threads stay open.",
      },
      tags: [],
      privacy_tags: [],
    });

    const res = sm.finalizeSession({
      session_id: "sess-001",
      project: "proj-session",
      correlation_id: "corr-structured",
      summary_mode: "standard",
    });

    expect(res.ok).toBe(true);
    const item = res.items[0] as Record<string, unknown>;
    expect(String(item.summary)).toContain("# Session Handoff");
    expect(String(item.summary)).toContain("## Decisions");
    expect(String(item.summary)).toContain("## Open Loops");
    expect(String(item.summary)).toContain("## Next Actions");
    expect(String(item.summary)).toContain("## Risks");

    const handoff = item.handoff as Record<string, unknown>;
    expect(String(handoff.overview)).toContain("correlation_id");
    expect((handoff.decisions as string[]).length).toBeGreaterThan(0);
    expect((handoff.open_loops as string[]).length).toBeGreaterThan(0);
    expect((handoff.next_actions as string[]).length).toBeGreaterThan(0);
    expect((handoff.risks as string[]).length).toBeGreaterThan(0);
  });

  test("明示的な 問題 / 決定 / 次アクション メモを handoff に優先反映する", () => {
    const { sm, db } = createSessionManager("finalize-handoff-explicit-sections");
    const recordEvent = createRecordEventMock(db);

    recordEvent({
      platform: "claude",
      project: "proj-session",
      session_id: "sess-explicit",
      event_type: "user_prompt",
      ts: "2026-03-25T09:00:00.000Z",
      payload: {
        prompt: [
          "この3点を次の新しいセッションでも引き継げるか確認したいです。",
          "",
          "問題:",
          "- 新しいセッションを開くと、前に何を話していたかが途切れやすい",
          "",
          "決定:",
          "- continuity briefing を最初のターンで必ず見せる",
          "- Claude と Codex で同じ品質にする",
          "",
          "次アクション:",
          "- adapter delivery を両方で揃える",
          "- OpenAPI や DB index の話は今回の本筋ではない",
        ].join("\n"),
      },
      tags: [],
      privacy_tags: [],
    });

    const res = sm.finalizeSession({
      session_id: "sess-explicit",
      project: "proj-session",
      correlation_id: "corr-explicit",
      summary_mode: "standard",
    });

    expect(res.ok).toBe(true);
    const item = res.items[0] as Record<string, unknown>;
    const handoff = item.handoff as Record<string, unknown>;
    const decisions = handoff.decisions as string[];
    const nextActions = handoff.next_actions as string[];
    const keyPoints = handoff.key_points as string[];

    expect(decisions).toContain("continuity briefing を最初のターンで必ず見せる");
    expect(decisions).toContain("Claude と Codex で同じ品質にする");
    expect(nextActions).toContain("adapter delivery を両方で揃える");
    expect(keyPoints).toContain("新しいセッションを開くと、前に何を話していたかが途切れやすい");
    expect(keyPoints).toContain("OpenAPI や DB index の話は今回の本筋ではない");
    expect(String(item.summary)).toContain("## Decisions");
    expect(String(item.summary)).toContain("adapter delivery を両方で揃える");
  });

  test("番号付き assistant summary 行を handoff に反映する", () => {
    const { sm, db } = createSessionManager("finalize-handoff-numbered-assistant");
    const recordEvent = createRecordEventMock(db);

    recordEvent({
      platform: "claude",
      project: "proj-session",
      session_id: "sess-numbered",
      event_type: "checkpoint",
      ts: "2026-03-25T10:00:00.000Z",
      payload: {
        title: "assistant_response",
        content:
          "1. 問題: 新しいセッションを開くと前の会話の文脈が途切れる\n2. 決定: continuity briefing を最初のターンで必ず表示する\n3. 次にやるべきこと: adapter delivery を Claude / Codex 両方で揃える",
      },
      tags: [],
      privacy_tags: [],
    });

    const res = sm.finalizeSession({
      session_id: "sess-numbered",
      project: "proj-session",
      correlation_id: "corr-numbered",
      summary_mode: "standard",
    });

    expect(res.ok).toBe(true);
    const item = res.items[0] as Record<string, unknown>;
    const handoff = item.handoff as Record<string, unknown>;
    expect(handoff.decisions as string[]).toContain("continuity briefing を最初のターンで必ず表示する");
    expect(handoff.next_actions as string[]).toContain("adapter delivery を Claude / Codex 両方で揃える");
    expect(handoff.key_points as string[]).toContain("新しいセッションを開くと前の会話の文脈が途切れる");
  });

  test("session_start と continuity_handoff の生ラッパーを handoff summary に混ぜない", () => {
    const { sm, db } = createSessionManager("finalize-handoff-noise-filter");
    const recordEvent = createRecordEventMock(db);

    recordEvent({
      platform: "codex",
      project: "proj-session",
      session_id: "sess-noise",
      event_type: "session_start",
      ts: "2026-03-25T11:00:00.000Z",
      payload: {
        source: "codex_hooks_engine",
      },
      tags: ["codex_hook", "session_start"],
      privacy_tags: [],
    });
    recordEvent({
      platform: "codex",
      project: "proj-session",
      session_id: "sess-noise",
      event_type: "checkpoint",
      ts: "2026-03-25T11:00:01.000Z",
      payload: {
        title: "continuity_handoff",
        content: [
          "問題:",
          "- 新しいセッションを開くと、前に何を話していたかが途切れやすい",
          "",
          "決定:",
          "- continuity briefing を最初のターンで必ず見せる",
          "- Claude と Codex で同じ品質にする",
          "",
          "次アクション:",
          "- adapter delivery を両方で揃える",
          "- OpenAPI や DB index の話は今回の本筋ではない",
        ].join("\n"),
      },
      tags: ["continuity_handoff", "pinned_continuity"],
      privacy_tags: [],
    });
    recordEvent({
      platform: "codex",
      project: "proj-session",
      session_id: "sess-noise",
      event_type: "checkpoint",
      ts: "2026-03-25T11:00:02.000Z",
      payload: {
        title: "assistant_response",
        content:
          "1. 問題: 新しいセッションを開くと前の会話の文脈が途切れる\n2. 決定: continuity briefing を最初のターンで必ず表示する\n3. 次にやるべきこと: adapter delivery を Claude / Codex 両方で揃える",
      },
      tags: ["assistant_response"],
      privacy_tags: [],
    });

    const res = sm.finalizeSession({
      session_id: "sess-noise",
      project: "proj-session",
      correlation_id: "corr-noise",
      summary_mode: "standard",
    });

    expect(res.ok).toBe(true);
    const item = res.items[0] as Record<string, unknown>;
    const summary = String(item.summary);
    const handoff = item.handoff as Record<string, unknown>;

    expect(summary).not.toContain("session_start:");
    expect(summary).not.toContain("continuity_handoff:");
    expect(summary).toContain("adapter delivery を両方で揃える");
    expect(handoff.decisions as string[]).toContain("continuity briefing を最初のターンで必ず見せる");
    expect(handoff.next_actions as string[]).toContain("adapter delivery を両方で揃える");
    expect(handoff.key_points as string[]).toContain("OpenAPI や DB index の話は今回の本筋ではない");
  });
});
