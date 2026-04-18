/**
 * branch-scoped-memory.test.ts — §78-E02 core unit test
 *
 * Verifies the branch filter semantics:
 * - Store 3 observations: branch="main", branch="feat-a", branch=null
 * - Search with no branch → all 3
 * - Search with branch="main" → main + null = 2
 * - Search with branch="feat-a" → feat-a + null = 2
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { SqliteObservationRepository } from "../../src/db/repositories/SqliteObservationRepository";
import type { InsertObservationInput } from "../../src/db/repositories/IObservationRepository";

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

function ensureSession(db: Database, sessionId: string, project = "test-project"): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_sessions
     (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, "claude", project, now, now, now);
}

function makeInput(overrides: Partial<InsertObservationInput> = {}): InsertObservationInput {
  const now = new Date().toISOString();
  return {
    id: `obs_${Math.random().toString(36).slice(2, 10)}`,
    event_id: null,
    platform: "claude",
    project: "test-project",
    session_id: "session-001",
    title: "Test observation",
    content: "Test content body",
    content_redacted: "Test content body",
    observation_type: "context",
    memory_type: "semantic",
    tags_json: "[]",
    privacy_tags_json: "[]",
    signal_score: 0,
    user_id: "default",
    team_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const openDbs: Database[] = [];
afterEach(() => {
  for (const db of openDbs) {
    try { db.close(); } catch { /* ignore */ }
  }
  openDbs.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("branch-scoped memory (§78-E02 core)", () => {
  test("search with no branch returns all 3 observations", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");

    const repo = new SqliteObservationRepository(db);

    await repo.insert(makeInput({ id: "obs-main", branch: "main" }));
    await repo.insert(makeInput({ id: "obs-feat", branch: "feat-a" }));
    await repo.insert(makeInput({ id: "obs-null", branch: null }));

    const rows = await repo.findMany({ project: "test-project", limit: 100 });
    expect(rows.length).toBe(3);
  });

  test("search with branch='main' returns main + null (2 rows)", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");

    const repo = new SqliteObservationRepository(db);

    await repo.insert(makeInput({ id: "obs-main", branch: "main" }));
    await repo.insert(makeInput({ id: "obs-feat", branch: "feat-a" }));
    await repo.insert(makeInput({ id: "obs-null", branch: null }));

    const rows = await repo.findMany({ project: "test-project", limit: 100, branch: "main" });
    expect(rows.length).toBe(2);
    const ids = rows.map(r => r.id).sort();
    expect(ids).toEqual(["obs-main", "obs-null"].sort());
  });

  test("search with branch='feat-a' returns feat-a + null (2 rows)", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");

    const repo = new SqliteObservationRepository(db);

    await repo.insert(makeInput({ id: "obs-main", branch: "main" }));
    await repo.insert(makeInput({ id: "obs-feat", branch: "feat-a" }));
    await repo.insert(makeInput({ id: "obs-null", branch: null }));

    const rows = await repo.findMany({ project: "test-project", limit: 100, branch: "feat-a" });
    expect(rows.length).toBe(2);
    const ids = rows.map(r => r.id).sort();
    expect(ids).toEqual(["obs-feat", "obs-null"].sort());
  });

  test("inserted observation preserves branch value in row", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");

    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs-check", branch: "release/v2" }));

    const row = await repo.findById("obs-check");
    expect(row).not.toBeNull();
    expect(row!.branch).toBe("release/v2");
  });
});
