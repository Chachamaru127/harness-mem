/**
 * branch-merge.test.ts — §F-2 (S78-E02b) admin branch merge workflow
 *
 * Verifies branchMerge() admin operation:
 * - dry_run default: never mutates DB, returns plan
 * - apply mode: actually retargets branch label + writes audit log
 * - conflict detection: same content_redacted in target branch
 * - 3 conflict modes: overwrite / append / skip
 * - explicit apply flag required (dry_run default true)
 * - audit log row per conflict resolution
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { SqliteObservationRepository } from "../../src/db/repositories/SqliteObservationRepository";
import type { InsertObservationInput } from "../../src/db/repositories/IObservationRepository";
import { branchMerge, type BranchMergeRequest } from "../../src/admin/branch-merge";

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
    content: "default content",
    content_redacted: "default content",
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

function countAuditRows(db: Database, action: string): number {
  return Number(
    db.query<{ cnt: number }, [string]>(
      "SELECT COUNT(*) AS cnt FROM mem_audit_log WHERE action = ?"
    ).get(action)?.cnt ?? 0
  );
}

function getBranch(db: Database, id: string): string | null {
  return (
    db.query<{ branch: string | null }, [string]>(
      "SELECT branch FROM mem_observations WHERE id = ?"
    ).get(id)?.branch ?? null
  );
}

function exists(db: Database, id: string): boolean {
  return (
    db.query<{ cnt: number }, [string]>(
      "SELECT COUNT(*) AS cnt FROM mem_observations WHERE id = ?"
    ).get(id)?.cnt ?? 0
  ) > 0;
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

describe("branchMerge (§F-2 S78-E02b)", () => {
  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  test("rejects missing source_branch", async () => {
    const db = createDb();
    openDbs.push(db);
    const res = await branchMerge(db, { target_branch: "main", mode: "skip" } as unknown as BranchMergeRequest);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/source_branch/);
  });

  test("rejects missing target_branch", async () => {
    const db = createDb();
    openDbs.push(db);
    const res = await branchMerge(db, { source_branch: "feat", mode: "skip" } as unknown as BranchMergeRequest);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/target_branch/);
  });

  test("rejects source_branch == target_branch", async () => {
    const db = createDb();
    openDbs.push(db);
    const res = await branchMerge(db, { source_branch: "main", target_branch: "main", mode: "skip" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/same/);
  });

  test("rejects unknown mode", async () => {
    const db = createDb();
    openDbs.push(db);
    const res = await branchMerge(db, { source_branch: "feat", target_branch: "main", mode: "bogus" as unknown as "skip" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mode/);
  });

  // -------------------------------------------------------------------------
  // dry-run is default; never mutates
  // -------------------------------------------------------------------------
  test("default dry_run=true does not mutate DB", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs-feat-1", branch: "feat-a", content: "A", content_redacted: "A" }));
    await repo.insert(makeInput({ id: "obs-feat-2", branch: "feat-a", content: "B", content_redacted: "B" }));

    const auditBefore = countAuditRows(db, "branch_merge");
    const res = await branchMerge(db, { source_branch: "feat-a", target_branch: "main", mode: "append" });

    expect(res.ok).toBe(true);
    expect(res.dry_run).toBe(true);
    expect(res.candidate_count).toBe(2);
    // DB observation rows unchanged
    expect(getBranch(db, "obs-feat-1")).toBe("feat-a");
    expect(getBranch(db, "obs-feat-2")).toBe("feat-a");
    // Summary audit row is always written (observability of dry-run invocations).
    // No per-conflict rows here because there are no conflicts.
    expect(countAuditRows(db, "branch_merge")).toBe(auditBefore + 1);
  });

  test("explicit apply=true required to mutate (dry_run wins if both set)", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs-x", branch: "feat-a", content: "X", content_redacted: "X" }));

    // dry_run=true wins even if apply=true also set
    const res = await branchMerge(db, {
      source_branch: "feat-a", target_branch: "main", mode: "append",
      dry_run: true, apply: true,
    });
    expect(res.dry_run).toBe(true);
    expect(getBranch(db, "obs-x")).toBe("feat-a");
  });

  // -------------------------------------------------------------------------
  // append mode
  // -------------------------------------------------------------------------
  test("append mode: promotes all source obs, allows duplicates, no skips", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    // Same content in both branches (would collide under skip/overwrite)
    await repo.insert(makeInput({ id: "obs-main", branch: "main", content: "DUP", content_redacted: "DUP" }));
    await repo.insert(makeInput({ id: "obs-feat", branch: "feat-a", content: "DUP", content_redacted: "DUP" }));
    await repo.insert(makeInput({ id: "obs-unique", branch: "feat-a", content: "UNIQ", content_redacted: "UNIQ" }));

    const res = await branchMerge(db, {
      source_branch: "feat-a", target_branch: "main", mode: "append",
      apply: true, dry_run: false,
    });

    expect(res.ok).toBe(true);
    expect(res.dry_run).toBe(false);
    expect(res.promoted).toBe(2);
    expect(res.conflicts).toBe(1);
    expect(res.skipped).toBe(0);
    // Both feat-a rows now on main; obs-main untouched
    expect(getBranch(db, "obs-feat")).toBe("main");
    expect(getBranch(db, "obs-unique")).toBe("main");
    expect(getBranch(db, "obs-main")).toBe("main");
    expect(exists(db, "obs-main")).toBe(true);
    // Audit log: 1 row for the conflict + 1 summary row
    expect(countAuditRows(db, "branch_merge")).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // skip mode
  // -------------------------------------------------------------------------
  test("skip mode: leaves conflicting source as-is, promotes only non-conflict", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs-main", branch: "main", content: "DUP", content_redacted: "DUP" }));
    await repo.insert(makeInput({ id: "obs-feat-dup", branch: "feat-a", content: "DUP", content_redacted: "DUP" }));
    await repo.insert(makeInput({ id: "obs-feat-uniq", branch: "feat-a", content: "UNIQ", content_redacted: "UNIQ" }));

    const res = await branchMerge(db, {
      source_branch: "feat-a", target_branch: "main", mode: "skip",
      apply: true, dry_run: false,
    });

    expect(res.ok).toBe(true);
    expect(res.promoted).toBe(1);
    expect(res.conflicts).toBe(1);
    expect(res.skipped).toBe(1);
    // Skipped: still on feat-a
    expect(getBranch(db, "obs-feat-dup")).toBe("feat-a");
    // Promoted
    expect(getBranch(db, "obs-feat-uniq")).toBe("main");
    // Target untouched
    expect(getBranch(db, "obs-main")).toBe("main");
    expect(exists(db, "obs-main")).toBe(true);
    expect(countAuditRows(db, "branch_merge")).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // overwrite mode
  // -------------------------------------------------------------------------
  test("overwrite mode: deletes conflicting target obs, promotes source", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs-main", branch: "main", content: "DUP", content_redacted: "DUP" }));
    await repo.insert(makeInput({ id: "obs-feat-dup", branch: "feat-a", content: "DUP", content_redacted: "DUP" }));
    await repo.insert(makeInput({ id: "obs-feat-uniq", branch: "feat-a", content: "UNIQ", content_redacted: "UNIQ" }));

    const res = await branchMerge(db, {
      source_branch: "feat-a", target_branch: "main", mode: "overwrite",
      apply: true, dry_run: false,
    });

    expect(res.ok).toBe(true);
    expect(res.promoted).toBe(2);
    expect(res.conflicts).toBe(1);
    expect(res.skipped).toBe(0);
    expect(res.removed_target).toBe(1);
    // Target's colliding row deleted
    expect(exists(db, "obs-main")).toBe(false);
    // Source promoted (including the previously-conflicting one)
    expect(getBranch(db, "obs-feat-dup")).toBe("main");
    expect(getBranch(db, "obs-feat-uniq")).toBe("main");
    expect(countAuditRows(db, "branch_merge")).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // audit log contents
  // -------------------------------------------------------------------------
  test("audit log records mode and resolution per conflict", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs-main", branch: "main", content: "DUP", content_redacted: "DUP" }));
    await repo.insert(makeInput({ id: "obs-feat", branch: "feat-a", content: "DUP", content_redacted: "DUP" }));

    await branchMerge(db, {
      source_branch: "feat-a", target_branch: "main", mode: "skip",
      apply: true, dry_run: false,
    });

    const rows = db.query<{ details_json: string }, []>(
      "SELECT details_json FROM mem_audit_log WHERE action = 'branch_merge' ORDER BY id ASC"
    ).all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const lastDetails = JSON.parse(rows[rows.length - 1].details_json);
    expect(lastDetails.source_branch).toBe("feat-a");
    expect(lastDetails.target_branch).toBe("main");
    expect(lastDetails.mode).toBe("skip");
    expect(lastDetails.dry_run).toBe(false);
  });

  test("dry_run records audit log entry tagged dry_run=true", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const repo = new SqliteObservationRepository(db);
    await repo.insert(makeInput({ id: "obs-feat", branch: "feat-a" }));

    // Without apply, dry_run is default
    await branchMerge(db, { source_branch: "feat-a", target_branch: "main", mode: "append" });

    const row = db.query<{ details_json: string }, []>(
      "SELECT details_json FROM mem_audit_log WHERE action = 'branch_merge' ORDER BY id DESC LIMIT 1"
    ).get();
    expect(row).not.toBeNull();
    const details = JSON.parse(row!.details_json);
    expect(details.dry_run).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  test("empty source branch returns 0 candidates", async () => {
    const db = createDb();
    openDbs.push(db);
    ensureSession(db, "session-001");
    const res = await branchMerge(db, { source_branch: "feat-empty", target_branch: "main", mode: "append" });
    expect(res.ok).toBe(true);
    expect(res.candidate_count).toBe(0);
    expect(res.conflicts).toBe(0);
  });
});
