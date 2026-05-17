import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  buildHermesStateBackfillEvents,
  ingestHermesStateDb,
  readHermesStateBackfillPlan,
  type HermesStateMessageRow,
  type HermesStateSessionRow,
} from "../../src/ingest/hermes-state";

function withHermesDb<T>(fn: (dbPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "harness-hermes-state-"));
  const dbPath = join(dir, "state.db");
  const db = new Database(dbPath, { create: true });
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        user_id TEXT,
        model TEXT,
        title TEXT,
        started_at REAL NOT NULL,
        ended_at REAL,
        end_reason TEXT,
        message_count INTEGER DEFAULT 0,
        tool_call_count INTEGER DEFAULT 0
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role TEXT NOT NULL,
        content TEXT,
        tool_call_id TEXT,
        tool_calls TEXT,
        tool_name TEXT,
        timestamp REAL NOT NULL,
        token_count INTEGER,
        finish_reason TEXT
      );
    `);
    db.query(`
      INSERT INTO sessions(
        id, source, user_id, model, title, started_at, ended_at,
        end_reason, message_count, tool_call_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("hermes-s1", "cli", "alice", "glm-5.1", "Hermes CJ Backfill", 1771210000, 1771210600, "completed", 3, 1);
    db.query(`
      INSERT INTO messages(
        session_id, role, content, tool_call_id, tool_calls, tool_name,
        timestamp, token_count, finish_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("hermes-s1", "user", "HermesのBackfillできる？", null, null, null, 1771210010, 10, null);
    db.query(`
      INSERT INTO messages(
        session_id, role, content, tool_call_id, tool_calls, tool_name,
        timestamp, token_count, finish_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("hermes-s1", "assistant", "できます。state.dbから取り込みます。", null, null, null, 1771210020, 20, "stop");
    db.query(`
      INSERT INTO messages(
        session_id, role, content, tool_call_id, tool_calls, tool_name,
        timestamp, token_count, finish_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("hermes-s1", "tool", "SECRET=abc123\nvery long terminal output", "call-1", null, "shell", 1771210030, 30, null);
    return fn(dbPath);
  } finally {
    db.close(false);
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertSession(dbPath: string, params: { id: string; startedAt: number; endedAt?: number | null }): void {
  const db = new Database(dbPath, { create: false, readonly: false, strict: false });
  try {
    db.query(`
      INSERT INTO sessions(
        id, source, user_id, model, title, started_at, ended_at,
        end_reason, message_count, tool_call_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(params.id, "cli", "alice", "glm-5.1", params.id, params.startedAt, params.endedAt ?? null, null, 0, 0);
  } finally {
    db.close(false);
  }
}

function insertMessage(
  dbPath: string,
  params: { sessionId: string; role: string; content: string | null; toolCalls?: string | null; toolName?: string | null; timestamp: number },
): void {
  const db = new Database(dbPath, { create: false, readonly: false, strict: false });
  try {
    db.query(`
      INSERT INTO messages(
        session_id, role, content, tool_call_id, tool_calls, tool_name,
        timestamp, token_count, finish_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(params.sessionId, params.role, params.content, null, params.toolCalls ?? null, params.toolName ?? null, params.timestamp, null, null);
  } finally {
    db.close(false);
  }
}

describe("Hermes state.db ingest", () => {
  test("plans session and message events without writing by default", () => {
    withHermesDb((dbPath) => {
      const plan = readHermesStateBackfillPlan({
        source_db_path: dbPath,
        project: "default",
      });

      expect(plan.stats.dry_run).toBe(true);
      expect(plan.stats.sessions_seen).toBe(1);
      expect(plan.stats.messages_seen).toBe(3);
      expect(plan.stats.messages_total).toBe(3);
      expect(plan.stats.events_planned).toBe(5);

      const events = plan.events?.map((entry) => entry.event) ?? [];
      expect(events.map((event) => event.event_type)).toEqual([
        "session_start",
        "user_prompt",
        "checkpoint",
        "tool_use",
        "session_end",
      ]);
      expect(events[1]?.payload?.prompt).toBe("HermesのBackfillできる？");
      expect(String(events[3]?.payload?.content)).toContain("tool result body omitted by default");
      expect(String(events[3]?.payload?.content)).not.toContain("SECRET=abc123");
    });
  });

  test("first batch includes all session lifecycle events, including empty sessions", () => {
    withHermesDb((dbPath) => {
      insertSession(dbPath, { id: "hermes-empty", startedAt: 1771210100 });

      const plan = readHermesStateBackfillPlan({
        source_db_path: dbPath,
        project: "default",
        after_message_id: 0,
        limit: 1,
      });

      expect(plan.stats.sessions_seen).toBe(2);
      expect(plan.stats.messages_seen).toBe(1);
      expect(plan.events?.filter((entry) => entry.event.event_type === "session_start")).toHaveLength(2);
    });
  });

  test("numeric since filters messages the same way as an ISO/unix string", () => {
    withHermesDb((dbPath) => {
      const plan = readHermesStateBackfillPlan({
        source_db_path: dbPath,
        project: "default",
        since: 1771210020,
      });

      expect(plan.stats.messages_seen).toBe(2);
      expect(plan.stats.messages_total).toBe(2);
      expect(plan.events?.map((entry) => entry.event.event_type)).toEqual([
        "session_start",
        "checkpoint",
        "tool_use",
        "session_end",
      ]);
    });
  });

  test("assistant tool call arguments are omitted by default", () => {
    withHermesDb((dbPath) => {
      insertMessage(dbPath, {
        sessionId: "hermes-s1",
        role: "assistant",
        content: null,
        toolCalls: JSON.stringify([{ function: { name: "shell", arguments: "SECRET=abc123" } }]),
        timestamp: 1771210040,
      });

      const plan = readHermesStateBackfillPlan({
        source_db_path: dbPath,
        project: "default",
      });
      const events = plan.events?.map((entry) => entry.event) ?? [];
      const assistantToolCall = events.find((event) =>
        event.event_type === "checkpoint" &&
        String(event.payload?.content).includes("tool_calls_present=true")
      );

      expect(assistantToolCall).toBeTruthy();
      expect(String(assistantToolCall?.payload?.content)).toContain("tool call arguments omitted by default");
      expect(String(assistantToolCall?.payload?.content)).not.toContain("SECRET=abc123");
      expect(assistantToolCall?.payload?.tool_name).toBe("shell");
    });
  });

  test("executes through recordEvent and reports dedupe from the recorder", () => {
    withHermesDb((dbPath) => {
      const seen = new Set<string>();
      const recordEvent = (event: { event_id?: string }) => {
        if (event.event_id && seen.has(event.event_id)) {
          return { ok: true, meta: { deduped: true } };
        }
        if (event.event_id) {
          seen.add(event.event_id);
        }
        return { ok: true, meta: {} };
      };

      const first = ingestHermesStateDb({
        request: { source_db_path: dbPath, project: "default", dry_run: false },
        recordEvent,
      });
      const second = ingestHermesStateDb({
        request: { source_db_path: dbPath, project: "default", dry_run: false },
        recordEvent,
      });

      expect(first.events_recorded).toBe(5);
      expect(first.events_deduped).toBe(0);
      expect(first.events_failed).toBe(0);
      expect(second.events_recorded).toBe(0);
      expect(second.events_deduped).toBe(5);
      expect(second.events_failed).toBe(0);
    });
  });

  test("stable event ids are scoped by project", () => {
    const session: HermesStateSessionRow = {
      id: "hermes-scope",
      source: "cli",
      user_id: null,
      model: "glm",
      title: "scope",
      started_at: 1771210000,
      ended_at: null,
      end_reason: null,
      message_count: 1,
      tool_call_count: 0,
    };
    const message: HermesStateMessageRow = {
      id: 10,
      session_id: "hermes-scope",
      role: "user",
      content: "same text",
      tool_call_id: null,
      tool_calls: null,
      tool_name: null,
      timestamp: 1771210001,
      token_count: null,
      finish_reason: null,
      session_source: "cli",
      session_title: "scope",
      session_model: "glm",
      session_user_id: null,
    };

    const projectA = buildHermesStateBackfillEvents({ sessions: [session], messages: [message], project: "a" });
    const projectB = buildHermesStateBackfillEvents({ sessions: [session], messages: [message], project: "b" });
    expect(projectA[1]?.event.event_id).not.toBe(projectB[1]?.event.event_id);
    expect(projectA[1]?.event.dedupe_hash).not.toBe(projectB[1]?.event.dedupe_hash);
  });

  test("stable event ids are scoped by source database path", () => {
    const message: HermesStateMessageRow = {
      id: 10,
      session_id: "same-session",
      role: "user",
      content: "same text",
      tool_call_id: null,
      tool_calls: null,
      tool_name: null,
      timestamp: 1771210001,
      token_count: null,
      finish_reason: null,
      session_source: "cli",
      session_title: "scope",
      session_model: "glm",
      session_user_id: null,
    };

    const sourceA = buildHermesStateBackfillEvents({
      sessions: [],
      messages: [message],
      project: "same-project",
      sourceDbPath: "/tmp/hermes-a/state.db",
    });
    const sourceB = buildHermesStateBackfillEvents({
      sessions: [],
      messages: [message],
      project: "same-project",
      sourceDbPath: "/tmp/hermes-b/state.db",
    });

    expect(sourceA[0]?.event.event_id).not.toBe(sourceB[0]?.event.event_id);
    expect(sourceA[0]?.event.dedupe_hash).not.toBe(sourceB[0]?.event.dedupe_hash);
    expect(sourceA[0]?.event.metadata?.hermes_source_db_key).not.toBe(sourceB[0]?.event.metadata?.hermes_source_db_key);
  });
});
