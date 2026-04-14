/**
 * S81-B02: Low-value eviction unit tests.
 *
 * DoD: evict 件数と対象 ID を audit log に記録、dry_run と wet で結果一致.
 *
 * Strategy: seed a small synthetic observation set with a deterministic age
 * cursor (`now` is injected), run the policy in both modes, and assert:
 *   - candidate IDs match across dry/wet.
 *   - wet mode flips `archived_at` and dry mode does not.
 *   - audit-log callback receives the full candidate id list.
 *   - HARNESS_MEM_AUTO_FORGET is required for wet mode (absent → dry).
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema, migrateSchema } from "../../src/db/schema";
import {
  collectForgetCandidates,
  runForgetPolicy,
  isAutoForgetEnabled,
} from "../../src/consolidation/forget-policy";

function makeDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  migrateSchema(db);
  return db;
}

function insertSession(db: Database, sessionId: string, project = "p") {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, 'test', ?, ?, ?, ?)`
  ).run(sessionId, project, now, now, now);
}

interface SeedRow {
  id: string;
  project?: string;
  session_id: string;
  created_at: string;
  access_count?: number;
  signal_score?: number;
  privacy_tags?: string[];
  archived_at?: string | null;
  expires_at?: string | null;
}

function seed(db: Database, row: SeedRow) {
  const tags = JSON.stringify(row.privacy_tags ?? []);
  const now = row.created_at;
  db.query(
    `INSERT INTO mem_observations(id, event_id, platform, project, session_id, title, content,
       content_redacted, observation_type, memory_type, tags_json, privacy_tags_json,
       user_id, team_id, created_at, updated_at, access_count, signal_score, archived_at, expires_at)
     VALUES (?, NULL, 'test', ?, ?, 't', 'c', 'c', 'context', 'semantic', '[]', ?, 'default', NULL, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.project ?? "p",
    row.session_id,
    tags,
    row.created_at,
    now,
    row.access_count ?? 0,
    row.signal_score ?? 0,
    row.archived_at ?? null,
    row.expires_at ?? null
  );
}

/** 2026-04-14 at midnight UTC — our simulated "now". */
const NOW = new Date("2026-04-14T00:00:00.000Z");
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86400 * 1000).toISOString();
}

describe("forget-policy S81-B02", () => {
  let db: Database;
  const originalEnv = process.env.HARNESS_MEM_AUTO_FORGET;

  beforeEach(() => {
    db = makeDb();
    insertSession(db, "s1");
    delete process.env.HARNESS_MEM_AUTO_FORGET;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.HARNESS_MEM_AUTO_FORGET = originalEnv;
    } else {
      delete process.env.HARNESS_MEM_AUTO_FORGET;
    }
  });

  test("isAutoForgetEnabled reads HARNESS_MEM_AUTO_FORGET=1", () => {
    delete process.env.HARNESS_MEM_AUTO_FORGET;
    expect(isAutoForgetEnabled()).toBe(false);
    process.env.HARNESS_MEM_AUTO_FORGET = "1";
    expect(isAutoForgetEnabled()).toBe(true);
    process.env.HARNESS_MEM_AUTO_FORGET = "0";
    expect(isAutoForgetEnabled()).toBe(false);
  });

  test("selects old + unused + low-signal rows; spares fresh, accessed, and mid-signal rows", () => {
    seed(db, { id: "old-cold", session_id: "s1", created_at: daysAgo(200), access_count: 0, signal_score: 0.1 });
    seed(db, { id: "old-accessed", session_id: "s1", created_at: daysAgo(200), access_count: 5, signal_score: 0.1 });
    seed(db, { id: "fresh-cold", session_id: "s1", created_at: daysAgo(5), access_count: 0, signal_score: 0.1 });
    // An 80-day old row with mid signal should stay below the 0.7 threshold:
    // access 1 * 0.4 + signal (1-0.6)=0.4 * 0.3 + age (80-30)/150≈0.33 * 0.3 ≈ 0.62.
    seed(db, { id: "mid-signal", session_id: "s1", created_at: daysAgo(80), access_count: 0, signal_score: 0.6 });

    const { candidates } = collectForgetCandidates(db, { now: () => NOW });
    const ids = candidates.map((c) => c.observation_id);
    expect(ids).toContain("old-cold");
    expect(ids).not.toContain("old-accessed"); // protect_accessed defaults true
    expect(ids).not.toContain("fresh-cold");
    expect(ids).not.toContain("mid-signal");
  });

  test("dry_run and wet mode return the same candidate id set", () => {
    seed(db, { id: "a", session_id: "s1", created_at: daysAgo(200), access_count: 0, signal_score: 0 });
    seed(db, { id: "b", session_id: "s1", created_at: daysAgo(365), access_count: 0, signal_score: 0 });
    seed(db, { id: "keep", session_id: "s1", created_at: daysAgo(10), access_count: 0, signal_score: 0.9 });

    process.env.HARNESS_MEM_AUTO_FORGET = "1";

    const dry = runForgetPolicy(db, { dry_run: true, now: () => NOW });
    const wet = runForgetPolicy(db, { dry_run: false, now: () => NOW });

    expect(dry.candidates.map((c) => c.observation_id).sort()).toEqual(
      wet.candidates.map((c) => c.observation_id).sort()
    );
    expect(dry.evicted).toBe(0);
    expect(wet.evicted).toBe(2);

    const archived = (
      db.query(`SELECT id FROM mem_observations WHERE archived_at IS NOT NULL`).all() as Array<{ id: string }>
    ).map((r) => r.id);
    expect(archived.sort()).toEqual(["a", "b"]);
  });

  test("wet mode downgrades to dry when HARNESS_MEM_AUTO_FORGET is absent", () => {
    seed(db, { id: "x", session_id: "s1", created_at: daysAgo(300), access_count: 0, signal_score: 0 });
    // env deliberately unset
    const r = runForgetPolicy(db, { dry_run: false, now: () => NOW });
    expect(r.dry_run).toBe(true);
    expect(r.evicted).toBe(0);
    expect(r.candidates[0]?.observation_id).toBe("x");
    expect(r.skipped_reason).toMatch(/HARNESS_MEM_AUTO_FORGET/);
  });

  test("audit callback receives candidate ids, score, weights, evicted count", () => {
    seed(db, { id: "a", session_id: "s1", created_at: daysAgo(300), access_count: 0, signal_score: 0 });
    seed(db, { id: "b", session_id: "s1", created_at: daysAgo(500), access_count: 0, signal_score: 0 });
    process.env.HARNESS_MEM_AUTO_FORGET = "1";

    const events: Array<{ action: string; details: Record<string, unknown> }> = [];
    runForgetPolicy(db, { dry_run: false, now: () => NOW }, (action, details) =>
      events.push({ action, details })
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("admin.forget_policy.run");
    const d = events[0]!.details;
    expect(d.evicted).toBe(2);
    expect((d.candidate_ids as string[]).sort()).toEqual(["a", "b"]);
    expect(d.score_threshold).toBe(0.7);
    expect(d.weights).toBeDefined();
  });

  test("privacy-tagged rows are never candidates", () => {
    seed(db, {
      id: "private-old",
      session_id: "s1",
      created_at: daysAgo(500),
      access_count: 0,
      signal_score: 0,
      privacy_tags: ["private"],
    });
    seed(db, {
      id: "legal-old",
      session_id: "s1",
      created_at: daysAgo(500),
      access_count: 0,
      signal_score: 0,
      privacy_tags: ["legal_hold"],
    });
    seed(db, { id: "normal-old", session_id: "s1", created_at: daysAgo(500), access_count: 0, signal_score: 0 });

    const { candidates } = collectForgetCandidates(db, { now: () => NOW });
    const ids = candidates.map((c) => c.observation_id);
    expect(ids).toContain("normal-old");
    expect(ids).not.toContain("private-old");
    expect(ids).not.toContain("legal-old");
  });

  test("respects score_threshold — higher threshold selects fewer rows", () => {
    seed(db, { id: "borderline", session_id: "s1", created_at: daysAgo(100), access_count: 0, signal_score: 0.4 });
    seed(db, { id: "strong-evict", session_id: "s1", created_at: daysAgo(500), access_count: 0, signal_score: 0 });

    const low = collectForgetCandidates(db, { score_threshold: 0.5, now: () => NOW });
    const high = collectForgetCandidates(db, { score_threshold: 0.95, now: () => NOW });
    const lowIds = low.candidates.map((c) => c.observation_id);
    const highIds = high.candidates.map((c) => c.observation_id);
    expect(lowIds).toContain("strong-evict");
    expect(highIds.length).toBeLessThanOrEqual(lowIds.length);
  });

  test("archived rows are excluded from the scan", () => {
    seed(db, {
      id: "already-archived",
      session_id: "s1",
      created_at: daysAgo(500),
      access_count: 0,
      signal_score: 0,
      archived_at: "2025-01-01T00:00:00.000Z",
    });
    const { candidates, scanned } = collectForgetCandidates(db, { now: () => NOW });
    expect(scanned).toBe(0);
    expect(candidates).toHaveLength(0);
  });

  test("project filter scopes the scan", () => {
    seed(db, { id: "p1-old", session_id: "s1", project: "p1", created_at: daysAgo(500), access_count: 0, signal_score: 0 });
    // second project needs its session row to satisfy FK
    insertSession(db, "s-p2", "p2");
    seed(db, { id: "p2-old", session_id: "s-p2", project: "p2", created_at: daysAgo(500), access_count: 0, signal_score: 0 });

    const r = collectForgetCandidates(db, { project: "p1", now: () => NOW });
    const ids = r.candidates.map((c) => c.observation_id);
    expect(ids).toContain("p1-old");
    expect(ids).not.toContain("p2-old");
  });

  // -------------------------------------------------------------------------
  // §78-D01 temporal-forgetting specialisation
  // -------------------------------------------------------------------------

  test("expires_at in the past evicts regardless of score / age / access", () => {
    // A fresh (5d old), high-signal (0.9), accessed (3 hits) row is normally
    // safe from the score-based path. If its TTL has passed, it must still
    // be evicted.
    seed(db, {
      id: "ttl-expired",
      session_id: "s1",
      created_at: daysAgo(5),
      access_count: 3,
      signal_score: 0.9,
      expires_at: daysAgo(1), // expired 1 day ago
    });
    seed(db, {
      id: "ttl-future",
      session_id: "s1",
      created_at: daysAgo(5),
      access_count: 0,
      signal_score: 0,
      expires_at: new Date(NOW.getTime() + 86400 * 1000).toISOString(), // expires 1 day from now
    });
    seed(db, {
      id: "no-ttl",
      session_id: "s1",
      created_at: daysAgo(5),
      access_count: 0,
      signal_score: 0,
    });

    const { candidates } = collectForgetCandidates(db, { now: () => NOW });
    const ids = candidates.map((c) => c.observation_id);
    expect(ids).toContain("ttl-expired");
    expect(ids).not.toContain("ttl-future");
    expect(ids).not.toContain("no-ttl");

    const expiredCandidate = candidates.find((c) => c.observation_id === "ttl-expired");
    expect(expiredCandidate?.expired_at).toBeDefined();
    // TTL candidates reserve score = 1.0 so they sort above score hits.
    expect(expiredCandidate?.score).toBe(1);
  });

  test("TTL path ignores protect_accessed — expired rows are always evictable", () => {
    seed(db, {
      id: "accessed-but-expired",
      session_id: "s1",
      created_at: daysAgo(5),
      access_count: 42,
      signal_score: 1,
      expires_at: daysAgo(1),
    });
    const { candidates } = collectForgetCandidates(db, {
      now: () => NOW,
      protect_accessed: true,
    });
    expect(candidates.map((c) => c.observation_id)).toContain("accessed-but-expired");
  });

  test("legal_hold still trumps an expired TTL", () => {
    seed(db, {
      id: "legal-and-expired",
      session_id: "s1",
      created_at: daysAgo(5),
      access_count: 0,
      signal_score: 0,
      expires_at: daysAgo(1),
      privacy_tags: ["legal_hold"],
    });
    const { candidates } = collectForgetCandidates(db, { now: () => NOW });
    expect(candidates.map((c) => c.observation_id)).not.toContain("legal-and-expired");
  });

  test("wet mode actually flips archived_at for TTL candidates", () => {
    seed(db, {
      id: "ttl-hit",
      session_id: "s1",
      created_at: daysAgo(5),
      access_count: 0,
      signal_score: 1,
      expires_at: daysAgo(1),
    });
    process.env.HARNESS_MEM_AUTO_FORGET = "1";
    const r = runForgetPolicy(db, { dry_run: false, now: () => NOW });
    expect(r.evicted).toBe(1);
    const archived = (
      db.query(`SELECT id FROM mem_observations WHERE archived_at IS NOT NULL`).all() as Array<{
        id: string;
      }>
    ).map((r) => r.id);
    expect(archived).toContain("ttl-hit");
  });

  test("audit payload exposes expired_candidate_ids for TTL hits only", () => {
    seed(db, {
      id: "ttl-hit",
      session_id: "s1",
      created_at: daysAgo(5),
      access_count: 0,
      signal_score: 1,
      expires_at: daysAgo(1),
    });
    seed(db, {
      id: "score-hit",
      session_id: "s1",
      created_at: daysAgo(500),
      access_count: 0,
      signal_score: 0,
    });
    process.env.HARNESS_MEM_AUTO_FORGET = "1";
    const events: Array<{ action: string; details: Record<string, unknown> }> = [];
    runForgetPolicy(db, { dry_run: false, now: () => NOW }, (action, details) =>
      events.push({ action, details })
    );
    const d = events[0]!.details;
    expect((d.expired_candidate_ids as string[]).sort()).toEqual(["ttl-hit"]);
    expect((d.candidate_ids as string[]).sort()).toEqual(["score-hit", "ttl-hit"]);
  });
});
