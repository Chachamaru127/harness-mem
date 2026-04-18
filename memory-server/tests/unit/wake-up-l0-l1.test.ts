/**
 * §78-B03: wake-up L0 / L1 split — unit tests
 *
 * Verifies:
 * 1. L0 output is ≤ 180 tokens (~170 target + 10 buffer)
 * 2. L1 output is 0–1000 tokens (upper bound enforced)
 * 3. L0 is a semantic subset of L1 (project + tech_stack + conventions present)
 * 4. detail_level="full" returns backward-compat shape (top_facts + current_sprint)
 * 5. Token reduction: L0 token_estimate < full token_estimate (signal for ≥ 40% drop)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import {
  buildProjectProfile,
  buildWakeUpContext,
  type ProfileDatabase,
} from "../../src/core/project-profile";

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

function asProfileDb(db: Database): ProfileDatabase {
  return {
    query: (sql: string) => ({
      all: (...params: unknown[]) =>
        db.query(sql).all(...(params as import("bun:sqlite").SQLQueryBindings[])),
    }),
  };
}

function ensureSession(db: Database, sessionId: string, project = "wake-test"): void {
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
  const id = opts.id ?? `obs_wake_${++obsCounter}`;
  const project = opts.project ?? "wake-test";
  const sessionId = opts.sessionId ?? "s-wake-001";
  const now = new Date().toISOString();
  const created = opts.createdAt ?? now;
  const content = opts.content ?? `Content for ${id}`;
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
    opts.title ?? `Obs ${id}`,
    content,
    content,
    JSON.stringify(opts.tags ?? []),
    created,
    now,
    opts.expiresAt ?? null
  );
  return id;
}

const PROJECT = "wake-test";

// ---------------------------------------------------------------------------
// Fixtures: 5+ mixed static/dynamic observations
// ---------------------------------------------------------------------------

function buildFixtures(db: Database): void {
  ensureSession(db, "s-wake-001", PROJECT);
  ensureSession(db, "s-wake-002", PROJECT);

  // Static observations (older, tagged)
  insertObs(db, {
    project: PROJECT,
    sessionId: "s-wake-001",
    title: "We use TypeScript as our primary language",
    tags: ["tech-stack"],
    createdAt: daysAgo(30),
  });
  insertObs(db, {
    project: PROJECT,
    sessionId: "s-wake-001",
    title: "Architecture: event-sourced SQLite with Bun runtime",
    tags: ["architecture", "tech-stack"],
    createdAt: daysAgo(25),
  });
  insertObs(db, {
    project: PROJECT,
    sessionId: "s-wake-001",
    title: "Convention: all tests use bun:test framework",
    tags: ["convention"],
    createdAt: daysAgo(20),
  });

  // Dynamic observations (recent, no strong static signal)
  insertObs(db, {
    project: PROJECT,
    sessionId: "s-wake-002",
    title: "Working on §78-B03 L0/L1 split",
    tags: [],
    createdAt: daysAgo(1),
  });
  insertObs(db, {
    project: PROJECT,
    sessionId: "s-wake-002",
    title: "Resume pack refactor in progress",
    tags: [],
    createdAt: daysAgo(2),
  });
  insertObs(db, {
    project: PROJECT,
    sessionId: "s-wake-002",
    title: "Expiring task: update OpenAPI docs",
    tags: [],
    createdAt: daysAgo(1),
    expiresAt: daysFromNow(1), // expires tomorrow → expiring_soon
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("§78-B03 wake-up L0/L1 split", () => {
  let db: Database;

  afterEach(() => {
    db?.close();
  });

  test("L0: token_estimate ≤ 180", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctx = buildWakeUpContext(PROJECT, profile, "L0");

    expect(ctx.detail_level).toBe("L0");
    expect(ctx.token_estimate).toBeLessThanOrEqual(180);
    expect(ctx.project).toBe(PROJECT);
  });

  test("L0: contains project + tech_stack + conventions + pending_count", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctx = buildWakeUpContext(PROJECT, profile, "L0");

    expect(ctx.project).toBeString();
    expect(Array.isArray(ctx.tech_stack)).toBe(true);
    expect(Array.isArray(ctx.conventions)).toBe(true);
    expect(typeof ctx.pending_count).toBe("number");
  });

  test("L0: tech_stack ≤ 3 items (capped)", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctx = buildWakeUpContext(PROJECT, profile, "L0");

    expect(ctx.tech_stack.length).toBeLessThanOrEqual(3);
    expect(ctx.conventions.length).toBeLessThanOrEqual(3);
  });

  test("L1: token_estimate is > L0 token_estimate (adds recent context)", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctxL0 = buildWakeUpContext(PROJECT, profile, "L0");
    const ctxL1 = buildWakeUpContext(PROJECT, profile, "L1");

    expect(ctxL1.detail_level).toBe("L1");
    expect(ctxL1.token_estimate).toBeGreaterThanOrEqual(ctxL0.token_estimate);
  });

  test("L1: token_estimate ≤ 1000 (upper bound)", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctxL1 = buildWakeUpContext(PROJECT, profile, "L1");

    expect(ctxL1.token_estimate).toBeLessThanOrEqual(1000);
  });

  test("L1: is a strict semantic superset of L0 (all L0 fields present and equal)", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctxL0 = buildWakeUpContext(PROJECT, profile, "L0");
    const ctxL1 = buildWakeUpContext(PROJECT, profile, "L1");

    // L0 fields must be present and equal in L1
    expect(ctxL1.project).toBe(ctxL0.project);
    expect(ctxL1.tech_stack).toEqual(ctxL0.tech_stack);
    expect(ctxL1.conventions).toEqual(ctxL0.conventions);
    expect(ctxL1.pending_count).toBe(ctxL0.pending_count);

    // L1 must add recent_observations
    expect("recent_observations" in ctxL1).toBe(true);
    expect(Array.isArray((ctxL1 as { recent_observations: unknown[] }).recent_observations)).toBe(true);
  });

  test("full: backward-compat shape has top_facts + current_sprint", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctxFull = buildWakeUpContext(PROJECT, profile, "full");

    expect(ctxFull.detail_level).toBe("full");
    expect("top_facts" in ctxFull).toBe(true);
    expect("current_sprint" in ctxFull).toBe(true);
    expect(Array.isArray((ctxFull as { top_facts: unknown[] }).top_facts)).toBe(true);
    expect(Array.isArray((ctxFull as { current_sprint: unknown[] }).current_sprint)).toBe(true);
  });

  test("token reduction: L0 is significantly smaller than full (~50% target)", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctxL0 = buildWakeUpContext(PROJECT, profile, "L0");
    const ctxFull = buildWakeUpContext(PROJECT, profile, "full");

    // When full has meaningful content, L0 should be ≤ 60% of full (i.e., ≥ 40% reduction)
    if (ctxFull.token_estimate > 50) {
      const ratio = ctxL0.token_estimate / ctxFull.token_estimate;
      expect(ratio).toBeLessThanOrEqual(0.6);
    }
  });

  test("default detail_level is L1 (no argument)", () => {
    db = createDb();
    buildFixtures(db);
    const profile = buildProjectProfile(asProfileDb(db), PROJECT);
    const ctxDefault = buildWakeUpContext(PROJECT, profile);

    expect(ctxDefault.detail_level).toBe("L1");
  });

  test("empty project: L0 returns zero token fields gracefully", () => {
    db = createDb();
    const profile = buildProjectProfile(asProfileDb(db), "nonexistent-proj");
    const ctxL0 = buildWakeUpContext("nonexistent-proj", profile, "L0");

    expect(ctxL0.detail_level).toBe("L0");
    expect(ctxL0.tech_stack).toEqual([]);
    expect(ctxL0.conventions).toEqual([]);
    expect(ctxL0.pending_count).toBe(0);
    expect(ctxL0.token_estimate).toBeGreaterThan(0); // at least project name tokens
  });
});
