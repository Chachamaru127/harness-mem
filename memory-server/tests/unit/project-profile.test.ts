/**
 * §78-D03: project-profile ユニットテスト
 *
 * buildProjectProfile() の分類ロジックを検証する。
 *
 * テストシナリオ:
 * - 古い static 観察 (14+ days ago, tagged "decision") → static bucket
 * - 新しい dynamic 観察 (2 days ago, タグなし) → dynamic bucket
 * - superseded 観察 (mem_links に (A, obs, 'supersedes') 行あり) → dynamic bucket
 * - time-bound 観察 (expires_at あり) → dynamic bucket
 * - token_estimate > 0 かつ ≤ 300 の検証
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { buildProjectProfile, type ProfileDatabase } from "../../src/core/project-profile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

/** Wrap bun:sqlite Database as ProfileDatabase */
function asProfileDb(db: Database): ProfileDatabase {
  return {
    query: (sql: string) => ({
      all: (...params: unknown[]) => db.query(sql).all(...(params as import("bun:sqlite").SQLQueryBindings[])),
    }),
  };
}

function ensureSession(db: Database, sessionId: string, project = "test-project"): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_sessions
     (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, "claude", project, now, now, now);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

let obsCounter = 0;
function insertObs(
  db: Database,
  opts: {
    id?: string;
    project?: string;
    sessionId?: string;
    title?: string;
    content?: string;
    tags?: string[];
    createdAt?: string;
    expiresAt?: string | null;
  }
): string {
  const id = opts.id ?? `obs_${++obsCounter}`;
  const project = opts.project ?? "test-project";
  const sessionId = opts.sessionId ?? "session-001";
  const now = new Date().toISOString();
  const created = opts.createdAt ?? now;

  ensureSession(db, sessionId, project);

  db.query(
    `INSERT INTO mem_observations
     (id, event_id, platform, project, session_id, title, content, content_redacted,
      observation_type, memory_type, tags_json, privacy_tags_json, signal_score,
      user_id, team_id, created_at, updated_at, expires_at)
     VALUES (?, NULL, 'claude', ?, ?, ?, ?, ?, 'context', 'semantic', ?, '[]', 0,
             'default', NULL, ?, ?, ?)`
  ).run(
    id,
    project,
    sessionId,
    opts.title ?? "Test observation",
    opts.content ?? "some content",
    opts.content ?? "some content",
    JSON.stringify(opts.tags ?? []),
    created,
    created,
    opts.expiresAt ?? null
  );

  return id;
}

function insertSupersedes(db: Database, fromId: string, toId: string): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_links
     (from_observation_id, to_observation_id, relation, weight, created_at)
     VALUES (?, ?, 'supersedes', 1.0, ?)`
  ).run(fromId, toId, now);
}

const openDbs: Database[] = [];
afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    if (db) db.close();
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildProjectProfile — static/dynamic classification", () => {
  test("old decision observation is classified as static", () => {
    const db = createDb();
    openDbs.push(db);

    insertObs(db, {
      id: "obs-old-decision",
      title: "We use TypeScript for all services",
      tags: ["decision", "convention"],
      createdAt: daysAgo(30),
    });

    const profile = buildProjectProfile(asProfileDb(db), "test-project");

    // Should appear in conventions (tagged "decision")
    expect(profile.static.conventions.length).toBeGreaterThan(0);
    expect(profile.static.conventions[0]).toContain("TypeScript");
    // Should NOT appear in dynamic bucket
    const allDynamic = [
      ...profile.dynamic.current_sprint,
      ...profile.dynamic.recent_decisions,
      ...profile.dynamic.expiring_soon,
    ];
    expect(allDynamic.some((t) => t.includes("TypeScript"))).toBe(false);
  });

  test("recent observation with no tags is classified as dynamic", () => {
    const db = createDb();
    openDbs.push(db);

    insertObs(db, {
      id: "obs-recent-dynamic",
      title: "Investigating memory leak in session store",
      tags: [],
      createdAt: daysAgo(2),
    });

    const profile = buildProjectProfile(asProfileDb(db), "test-project");

    const allDynamic = [
      ...profile.dynamic.current_sprint,
      ...profile.dynamic.recent_decisions,
    ];
    expect(allDynamic.some((t) => t.includes("memory leak"))).toBe(true);

    // Should NOT appear in static bucket
    const allStatic = [
      ...profile.static.tech_stack,
      ...profile.static.conventions,
      ...profile.static.top_facts,
    ];
    expect(allStatic.some((t) => t.includes("memory leak"))).toBe(false);
  });

  test("superseded observation is classified as dynamic", () => {
    const db = createDb();
    openDbs.push(db);

    const oldId = insertObs(db, {
      id: "obs-superseded",
      title: "We use REST for all APIs",
      tags: [],
      createdAt: daysAgo(20), // old, but superseded → dynamic
    });

    const newId = insertObs(db, {
      id: "obs-superseder",
      title: "We migrated to GraphQL",
      tags: [],
      createdAt: daysAgo(1),
    });

    // newId supersedes oldId: (newId, oldId, 'supersedes')
    insertSupersedes(db, newId, oldId);

    const profile = buildProjectProfile(asProfileDb(db), "test-project");

    // Superseded obs should land in dynamic (not static), even though it's old
    const allDynamic = [
      ...profile.dynamic.current_sprint,
      ...profile.dynamic.recent_decisions,
      ...profile.dynamic.expiring_soon,
    ];
    const allStatic = [
      ...profile.static.tech_stack,
      ...profile.static.conventions,
      ...profile.static.top_facts,
    ];

    expect(allDynamic.some((t) => t.includes("REST"))).toBe(true);
    expect(allStatic.some((t) => t.includes("REST"))).toBe(false);
  });

  test("time-bound observation (expires_at set) is classified as dynamic", () => {
    const db = createDb();
    openDbs.push(db);

    insertObs(db, {
      id: "obs-time-bound",
      title: "Sprint 42 focus: auth refactor",
      tags: [],
      createdAt: daysAgo(5),
      expiresAt: daysFromNow(7),
    });

    const profile = buildProjectProfile(asProfileDb(db), "test-project");

    const allDynamic = [
      ...profile.dynamic.current_sprint,
      ...profile.dynamic.recent_decisions,
      ...profile.dynamic.expiring_soon,
    ];
    expect(allDynamic.some((t) => t.includes("Sprint 42"))).toBe(true);

    const allStatic = [
      ...profile.static.tech_stack,
      ...profile.static.conventions,
      ...profile.static.top_facts,
    ];
    expect(allStatic.some((t) => t.includes("Sprint 42"))).toBe(false);
  });

  test("expiring_soon contains observations expiring within 24h", () => {
    const db = createDb();
    openDbs.push(db);

    insertObs(db, {
      id: "obs-expiring-soon",
      title: "Temporary auth bypass for staging",
      tags: [],
      createdAt: daysAgo(1),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // expires in 1 hour
    });

    const profile = buildProjectProfile(asProfileDb(db), "test-project");

    expect(profile.dynamic.expiring_soon.some((t) => t.includes("Temporary auth"))).toBe(true);
  });

  test("token_estimate is > 0 and <= 300 with multiple observations", () => {
    const db = createDb();
    openDbs.push(db);

    // Add a mix of static and dynamic observations
    for (let i = 0; i < 5; i++) {
      insertObs(db, {
        id: `obs-static-${i}`,
        title: `Architecture decision ${i}: use microservices`,
        tags: ["decision"],
        createdAt: daysAgo(30 + i),
      });
    }
    for (let i = 0; i < 5; i++) {
      insertObs(db, {
        id: `obs-dynamic-${i}`,
        title: `Current task ${i}: fixing bug in session handler`,
        tags: [],
        createdAt: daysAgo(i + 1),
      });
    }

    const profile = buildProjectProfile(asProfileDb(db), "test-project");

    expect(profile.token_estimate).toBeGreaterThan(0);
    expect(profile.token_estimate).toBeLessThanOrEqual(300);
  });

  test("empty project returns empty buckets with zero token_estimate", () => {
    const db = createDb();
    openDbs.push(db);

    const profile = buildProjectProfile(asProfileDb(db), "nonexistent-project");

    expect(profile.static.tech_stack).toHaveLength(0);
    expect(profile.static.conventions).toHaveLength(0);
    expect(profile.static.top_facts).toHaveLength(0);
    expect(profile.dynamic.current_sprint).toHaveLength(0);
    expect(profile.dynamic.recent_decisions).toHaveLength(0);
    expect(profile.dynamic.expiring_soon).toHaveLength(0);
    expect(profile.token_estimate).toBe(0);
  });

  test("tech-stack tagged observation appears in static.tech_stack", () => {
    const db = createDb();
    openDbs.push(db);

    insertObs(db, {
      id: "obs-tech",
      title: "Stack: Node.js + Bun + SQLite",
      tags: ["tech-stack", "setup"],
      createdAt: daysAgo(60),
    });

    const profile = buildProjectProfile(asProfileDb(db), "test-project");

    expect(profile.static.tech_stack.some((t) => t.includes("Bun"))).toBe(true);
  });
});
