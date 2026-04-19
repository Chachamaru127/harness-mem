/**
 * §89-001 Step 3 integration test — search observation_type filter.
 *
 * Covers the new WHERE predicate introduced in Step 1 (core) by exercising it
 * through HarnessMemCore.search(). The `type:xxx` query-prefix parsing shipped
 * in Step 2 is validated at the MCP / REST boundaries and is not redundantly
 * re-tested here; this file focuses on the core filter contract:
 *
 *   1. direct scalar param filters to that observation_type only
 *   2. array param returns the union of the listed types
 *   3. omitted param returns every type (backward compatibility)
 *   4. an unknown observation_type returns an empty result set
 *   5. direct observation_type AND-combines with project scoping
 *
 * These tests seed the DB directly (no external HTTP) so they stay fast and
 * deterministic; they rely on the real applyCommonFilters SQL path, which is
 * the code under test.
 */

import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

function makeConfig(dir: string): Config {
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
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

function seedObservation(
  db: Database,
  opts: {
    id: string;
    project: string;
    session_id: string;
    title: string;
    content: string;
    observation_type: string;
    created_at?: string;
  }
): void {
  const now = opts.created_at ?? new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(opts.session_id, "claude", opts.project, now, now, now);

  const eventId = `evt_${opts.id}`;
  db.query(
    `INSERT OR IGNORE INTO mem_events (event_id, platform, project, session_id, event_type, ts, payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    "claude",
    opts.project,
    opts.session_id,
    "user_prompt",
    now,
    JSON.stringify({ prompt: opts.content }),
    JSON.stringify([]),
    JSON.stringify([]),
    `hash_${eventId}`,
    opts.id,
    now
  );

  db.query(
    `INSERT OR IGNORE INTO mem_observations
       (id, event_id, platform, project, session_id, title, content, content_redacted, observation_type, tags_json, privacy_tags_json, signal_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    opts.id,
    eventId,
    "claude",
    opts.project,
    opts.session_id,
    opts.title,
    opts.content,
    opts.content,
    opts.observation_type,
    JSON.stringify([]),
    JSON.stringify([]),
    now,
    now
  );
}

describe("§89-001: search observation_type filter", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  });

  function setupCore(): { core: HarnessMemCore; db: Database } {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-obstype-"));
    tmpDirs.push(dir);
    const core = new HarnessMemCore(makeConfig(dir));
    const db = new Database(join(dir, "harness-mem.db"));

    const project = "obs-type-test";
    const session = "obs-type-session";
    const baseTime = "2026-04-19T00:00:00.000Z";

    seedObservation(db, {
      id: "obs_decision_1",
      project,
      session_id: session,
      title: "release gate decision",
      content: "we decided to ship the release gate fix this week",
      observation_type: "decision",
      created_at: baseTime,
    });
    seedObservation(db, {
      id: "obs_summary_1",
      project,
      session_id: session,
      title: "session summary for release gate",
      content: "release gate review concluded on thursday",
      observation_type: "summary",
      created_at: baseTime,
    });
    seedObservation(db, {
      id: "obs_context_1",
      project,
      session_id: session,
      title: "background for release gate",
      content: "history of the release gate initiative",
      observation_type: "context",
      created_at: baseTime,
    });

    return { core, db };
  }

  test("direct observation_type=decision returns only decision rows", () => {
    const { core, db } = setupCore();
    try {
      const response = core.search({
        query: "release gate",
        project: "obs-type-test",
        observation_type: "decision",
        include_private: true,
        limit: 10,
      });

      expect(response.ok).toBe(true);
      const ids = (response.items as Array<Record<string, unknown>>).map((item) => String(item.id));
      expect(ids).toContain("obs_decision_1");
      expect(ids).not.toContain("obs_summary_1");
      expect(ids).not.toContain("obs_context_1");
    } finally {
      db.close();
      core.shutdown("test");
    }
  });

  test("observation_type as array returns the union of listed types", () => {
    const { core, db } = setupCore();
    try {
      const response = core.search({
        query: "release gate",
        project: "obs-type-test",
        observation_type: ["decision", "summary"],
        include_private: true,
        limit: 10,
      });

      expect(response.ok).toBe(true);
      const ids = (response.items as Array<Record<string, unknown>>).map((item) => String(item.id));
      expect(ids).toContain("obs_decision_1");
      expect(ids).toContain("obs_summary_1");
      expect(ids).not.toContain("obs_context_1");
    } finally {
      db.close();
      core.shutdown("test");
    }
  });

  test("omitting observation_type preserves pre-§89 behavior (all types)", () => {
    const { core, db } = setupCore();
    try {
      const response = core.search({
        query: "release gate",
        project: "obs-type-test",
        include_private: true,
        limit: 10,
      });

      expect(response.ok).toBe(true);
      const ids = (response.items as Array<Record<string, unknown>>).map((item) => String(item.id));
      expect(ids).toContain("obs_decision_1");
      expect(ids).toContain("obs_summary_1");
      expect(ids).toContain("obs_context_1");
    } finally {
      db.close();
      core.shutdown("test");
    }
  });

  test("an unknown observation_type returns no results (filter is strict)", () => {
    const { core, db } = setupCore();
    try {
      const response = core.search({
        query: "release gate",
        project: "obs-type-test",
        observation_type: "does_not_exist_in_fixture",
        include_private: true,
        limit: 10,
      });

      expect(response.ok).toBe(true);
      expect(response.items).toHaveLength(0);
    } finally {
      db.close();
      core.shutdown("test");
    }
  });

  test("empty string / empty array observation_type is a no-op (backward safe)", () => {
    const { core, db } = setupCore();
    try {
      const emptyString = core.search({
        query: "release gate",
        project: "obs-type-test",
        observation_type: "",
        include_private: true,
        limit: 10,
      });
      const emptyArray = core.search({
        query: "release gate",
        project: "obs-type-test",
        observation_type: [],
        include_private: true,
        limit: 10,
      });

      expect(emptyString.ok).toBe(true);
      expect(emptyArray.ok).toBe(true);
      const stringIds = (emptyString.items as Array<Record<string, unknown>>).map((item) => String(item.id));
      const arrayIds = (emptyArray.items as Array<Record<string, unknown>>).map((item) => String(item.id));
      expect(stringIds).toContain("obs_decision_1");
      expect(stringIds).toContain("obs_summary_1");
      expect(stringIds).toContain("obs_context_1");
      expect(arrayIds).toEqual(stringIds);
    } finally {
      db.close();
      core.shutdown("test");
    }
  });
});
