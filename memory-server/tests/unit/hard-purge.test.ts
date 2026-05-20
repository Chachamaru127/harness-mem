import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HarnessMemCore,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

const cleanupPaths: string[] = [];
const TEMP_BACKUP_TOKEN = "TEMP_TEST_BACKUP_S127_004";
const VECTOR_64_JSON = JSON.stringify(Array.from({ length: 64 }, (_, index) => index / 64));

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    removeDirWithRetry(dir);
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-hard-purge-${name}-`));
  cleanupPaths.push(dir);
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

function eventFor(id: string, content: string, project = "hard-purge-project"): EventEnvelope {
  return {
    event_id: `event-${id}`,
    platform: "claude",
    project,
    session_id: `session-${project}`,
    event_type: "user_prompt",
    ts: "2026-05-20T00:00:00.000Z",
    payload: { content },
    tags: [],
    privacy_tags: [],
  };
}

function insertObservation(core: HarnessMemCore, id: string, content: string, project?: string): string {
  const response = core.recordEvent(eventFor(id, content, project));
  expect(response.ok).toBe(true);
  return (response.items[0] as { id: string }).id;
}

function archiveObservation(core: HarnessMemCore, id: string): void {
  const response = core.bulkDeleteObservations({ ids: [id] });
  expect(response.ok).toBe(true);
  expect((response.meta as { deleted_count?: number }).deleted_count).toBe(1);
}

function countRows(core: HarnessMemCore, table: string, where = "1 = 1", values: unknown[] = []): number {
  const row = core.getRawDb()
    .query(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
    .get(...(values as never[])) as { count: number } | null;
  return Number(row?.count ?? 0);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createBackupArtifact(core: HarnessMemCore, name: string): { path: string; sha256: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-hard-purge-backup-${name}-`));
  cleanupPaths.push(dir);
  const path = join(dir, "backup.db");
  core.getRawDb().exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return { path, sha256: sha256File(path) };
}

function ensureArchiveTables(core: HarnessMemCore): void {
  core.getRawDb().exec(`
    CREATE TABLE IF NOT EXISTS mem_archive_stubs (
      archive_id TEXT PRIMARY KEY,
      observation_id TEXT NOT NULL,
      project TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_id TEXT DEFAULT NULL,
      archive_stub TEXT NOT NULL,
      archive_full_ref TEXT DEFAULT NULL,
      archive_state TEXT NOT NULL,
      reason TEXT NOT NULL,
      legal_hold_snapshot INTEGER NOT NULL DEFAULT 0,
      content_sha256 TEXT NOT NULL,
      manifest_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      restored_at TEXT DEFAULT NULL,
      purged_at TEXT DEFAULT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS mem_archive_full (
      archive_full_ref TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      purged_at TEXT DEFAULT NULL,
      FOREIGN KEY(archive_id) REFERENCES mem_archive_stubs(archive_id)
    );
  `);
}

function seedArchiveForObservation(
  core: HarnessMemCore,
  observationId: string,
  options: {
    includeFull?: boolean;
    state?: string;
    legalHoldSnapshot?: number;
    fullPayloadJson?: string;
    fullPurgedAt?: string | null;
    payloadSha256?: string;
    archiveSuffix?: string;
  } = {},
): void {
  ensureArchiveTables(core);
  const row = core.getRawDb()
    .query(`SELECT project, session_id, user_id, team_id FROM mem_observations WHERE id = ?`)
    .get(observationId) as { project: string; session_id: string; user_id: string; team_id: string | null };
  const archiveId = `archive-${observationId}${options.archiveSuffix ? `-${options.archiveSuffix}` : ""}`;
  const fullRef = `sqlite:${archiveId}`;
  const now = "2026-05-20T00:00:00.000Z";
  core.getRawDb().query(`
    INSERT OR REPLACE INTO mem_archive_stubs(
      archive_id, observation_id, project, session_id, user_id, team_id,
      archive_stub, archive_full_ref, archive_state, reason, legal_hold_snapshot,
      content_sha256, manifest_sha256, created_at, metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test archive', ?, ?, ?, ?, '{}')
  `).run(
    archiveId,
    observationId,
    row.project,
    row.session_id,
    row.user_id,
    row.team_id,
    `stub for ${observationId}`,
    fullRef,
    options.state ?? "archived",
    options.legalHoldSnapshot ?? 0,
    "0".repeat(64),
    "1".repeat(64),
    now,
  );
  if (options.includeFull !== false) {
    core.getRawDb().query(`
      INSERT OR REPLACE INTO mem_archive_full(
        archive_full_ref, archive_id, payload_json, payload_sha256, created_at, purged_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      fullRef,
      archiveId,
      options.fullPayloadJson ?? JSON.stringify({ restore: true, observation_id: observationId }),
      options.payloadSha256 ?? "2".repeat(64),
      now,
      options.fullPurgedAt ?? null,
    );
  }
}

function hardPurgePlan(core: HarnessMemCore, ids: string[]) {
  const response = core.adminForgetHardPurge({
    target_ids: ids,
    temp_test_backup_token: TEMP_BACKUP_TOKEN,
  });
  expect(response.ok).toBe(true);
  return response.items[0] as {
    candidate_ids: string[];
    candidate_count: number;
    manifest_hash: string;
    expires_at: string;
    confirmation_phrase: string;
    backup: { kind: string; provided: boolean; integrity_check: { ok: boolean; checked: boolean } };
    retention: { satisfied: boolean };
    archive: {
      archived_count: number;
      archive_stub_count: number;
      archive_full_count: number;
      restore_capable_count: number;
      restore_capable_full_count: number;
      restore_capable_full_observation_count: number;
      missing_restore_capable_archive_ids: string[];
    };
    legal_hold: { allowed: boolean };
    impact: Record<string, number>;
  };
}

function executeHardPurge(core: HarnessMemCore, plan: ReturnType<typeof hardPurgePlan>, ids: string[]) {
  return core.adminForgetHardPurge({
    target_ids: ids,
    execute: true,
    manifest_hash: plan.manifest_hash,
    manifest_expires_at: plan.expires_at,
    candidate_count: plan.candidate_count,
    temp_test_backup_token: TEMP_BACKUP_TOKEN,
    retention_ack: true,
    archive_ack: true,
    confirmation: plan.confirmation_phrase,
  });
}

function insertLifecycleRows(core: HarnessMemCore, targetId: string, keepId: string): void {
  const db = core.getRawDb();
  const now = "2026-05-20T00:00:00.000Z";
  db.query(`
    INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES (?, 'test:model', 64, ?, ?, ?)
  `).run(targetId, JSON.stringify([0.1, 0.2]), now, now);
  db.query(`
    INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES (?, 'test:model', 64, ?, ?, ?)
  `).run(keepId, JSON.stringify([0.3, 0.4]), now, now);
  db.query(`
    INSERT OR REPLACE INTO mem_nuggets(nugget_id, observation_id, seq, content, content_hash, created_at)
    VALUES ('nugget-target', ?, 1, 'target nugget', 'hash-target', ?)
  `).run(targetId, now);
  db.query(`
    INSERT OR REPLACE INTO mem_nugget_vectors(nugget_id, observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES ('nugget-target', ?, 'test:model', 64, ?, ?, ?)
  `).run(targetId, JSON.stringify([0.5, 0.6]), now, now);
  db.query(`
    INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
    VALUES (?, ?, 'relates_to', 1, ?)
  `).run(targetId, keepId, now);
  db.query(`
    INSERT INTO mem_relations(src, dst, kind, strength, observation_id, created_at)
    VALUES ('target', 'keep', 'mentions', 1, ?, ?)
  `).run(targetId, now);
  db.query(`
    INSERT OR REPLACE INTO mem_tags(observation_id, tag, tag_type, created_at)
    VALUES (?, 'target-tag', 'manual', ?)
  `).run(targetId, now);
  db.query(`
    INSERT OR IGNORE INTO mem_entities(name, entity_type, created_at)
    VALUES ('Hard Purge Entity', 'concept', ?)
  `).run(now);
  const entity = db.query(`SELECT id FROM mem_entities WHERE name = 'Hard Purge Entity' AND entity_type = 'concept'`)
    .get() as { id: number };
  db.query(`
    INSERT OR REPLACE INTO mem_observation_entities(observation_id, entity_id, created_at)
    VALUES (?, ?, ?)
  `).run(targetId, entity.id, now);
  db.query(`
    INSERT OR REPLACE INTO mem_facts(fact_id, observation_id, project, session_id, fact_type, fact_key, fact_value, created_at, updated_at)
    VALUES ('fact-target', ?, 'hard-purge-project', 'session-hard-purge-project', 'preference', 'target', 'remove', ?, ?)
  `).run(targetId, now, now);
}

describe("S127-004 hard purge risk gates", () => {
  test("plan is read-only and returns a sorted archived-only manifest", () => {
    const core = new HarnessMemCore(createConfig("plan-readonly"));
    try {
      const second = insertObservation(core, "plan-b", "second archived plan row");
      const first = insertObservation(core, "plan-a", "first archived plan row");
      archiveObservation(core, first);
      archiveObservation(core, second);
      const before = {
        observations: countRows(core, "mem_observations"),
        audit: countRows(core, "mem_audit_log"),
      };

      const plan = hardPurgePlan(core, [second, first]);

      expect(plan.candidate_ids).toEqual([first, second].sort());
      expect(plan.candidate_count).toBe(2);
      expect(plan.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(plan.backup).toMatchObject({ kind: "temp_test_token", provided: true });
      expect(plan.retention.satisfied).toBe(true);
      expect(plan.archive.archived_count).toBe(2);
      expect(plan.legal_hold.allowed).toBe(true);
      expect(plan.impact.observations).toBe(2);
      expect(countRows(core, "mem_observations")).toBe(before.observations);
      expect(countRows(core, "mem_audit_log")).toBe(before.audit);
    } finally {
      core.shutdown("test");
    }
  });

  test("execute rejects missing confirmation, missing backup evidence, legal_hold, unarchived, and stale manifests", () => {
    const core = new HarnessMemCore(createConfig("rejects"));
    try {
      const archived = insertObservation(core, "reject-archived", "archived reject row");
      archiveObservation(core, archived);
      seedArchiveForObservation(core, archived);
      const plan = hardPurgePlan(core, [archived]);

      const missingConfirmation = core.adminForgetHardPurge({
        target_ids: [archived],
        execute: true,
        manifest_hash: plan.manifest_hash,
        manifest_expires_at: plan.expires_at,
        candidate_count: plan.candidate_count,
        temp_test_backup_token: TEMP_BACKUP_TOKEN,
        retention_ack: true,
        archive_ack: true,
      });
      expect(missingConfirmation.ok).toBe(false);
      expect(missingConfirmation.error).toContain("confirmation");

      const noBackupPlan = core.adminForgetHardPurge({ target_ids: [archived] });
      expect(noBackupPlan.ok).toBe(true);
      const noBackupItem = noBackupPlan.items[0] as typeof plan;
      const missingBackup = core.adminForgetHardPurge({
        target_ids: [archived],
        execute: true,
        manifest_hash: noBackupItem.manifest_hash,
        manifest_expires_at: noBackupItem.expires_at,
        candidate_count: noBackupItem.candidate_count,
        retention_ack: true,
        archive_ack: true,
        confirmation: noBackupItem.confirmation_phrase,
      });
      expect(missingBackup.ok).toBe(false);
      expect(missingBackup.error).toContain("backup_path");

      const unarchived = insertObservation(core, "reject-unarchived", "unarchived reject row");
      const unarchivedPlan = core.adminForgetHardPurge({
        target_ids: [unarchived],
        temp_test_backup_token: TEMP_BACKUP_TOKEN,
      });
      expect(unarchivedPlan.ok).toBe(false);
      expect(unarchivedPlan.error).toContain("unarchived");

      const legalHold = insertObservation(core, "reject-legal-hold", "legal hold reject row");
      archiveObservation(core, legalHold);
      core.getRawDb()
        .query(`UPDATE mem_observations SET privacy_tags_json = ? WHERE id = ?`)
        .run(JSON.stringify(["deleted", "legal_hold"]), legalHold);
      const legalHoldPlan = core.adminForgetHardPurge({
        target_ids: [legalHold],
        temp_test_backup_token: TEMP_BACKUP_TOKEN,
      });
      expect(legalHoldPlan.ok).toBe(false);
      expect(legalHoldPlan.error).toContain("legal_hold");

      const staleOriginal = insertObservation(core, "reject-stale-original", "original stale row", "stale-project");
      archiveObservation(core, staleOriginal);
      seedArchiveForObservation(core, staleOriginal);
      const stalePlanResponse = core.adminForgetHardPurge({
        project: "stale-project",
        limit: 10,
        temp_test_backup_token: TEMP_BACKUP_TOKEN,
      });
      expect(stalePlanResponse.ok).toBe(true);
      const stalePlan = stalePlanResponse.items[0] as typeof plan;
      const newArchived = insertObservation(core, "reject-stale-new", "new archived row after plan", "stale-project");
      archiveObservation(core, newArchived);
      seedArchiveForObservation(core, newArchived);
      const staleExecute = core.adminForgetHardPurge({
        project: "stale-project",
        limit: 10,
        execute: true,
        manifest_hash: stalePlan.manifest_hash,
        manifest_expires_at: stalePlan.expires_at,
        candidate_count: stalePlan.candidate_count,
        temp_test_backup_token: TEMP_BACKUP_TOKEN,
        retention_ack: true,
        archive_ack: true,
        confirmation: stalePlan.confirmation_phrase,
      });
      expect(staleExecute.ok).toBe(false);
      expect(staleExecute.error).toContain("manifest_hash");
    } finally {
      core.shutdown("test");
    }
  });

  test("valid execute cascades target-derived rows and preserves sessions, audit, and non-target rows", () => {
    const core = new HarnessMemCore(createConfig("cascade"));
    try {
      const target = insertObservation(core, "cascade-target", "target cascade row");
      const keep = insertObservation(core, "cascade-keep", "keep cascade row");
      insertLifecycleRows(core, target, keep);
      core.getRawDb()
        .query(`INSERT OR IGNORE INTO mem_entities(name, entity_type, created_at) VALUES ('Unrelated Orphan', 'concept', ?)`)
        .run("2026-05-20T00:00:00.000Z");
      archiveObservation(core, target);
      seedArchiveForObservation(core, target);
      const auditBefore = countRows(core, "mem_audit_log");

      const plan = hardPurgePlan(core, [target]);
      const executed = executeHardPurge(core, plan, [target]);
      expect(executed.ok).toBe(true);
      const item = executed.items[0] as { deleted_counts: Record<string, number> };
      expect(item.deleted_counts.mem_observations).toBe(1);
      expect(item.deleted_counts.mem_vectors).toBeGreaterThanOrEqual(1);
      expect(item.deleted_counts.mem_nuggets).toBe(1);
      expect(item.deleted_counts.mem_nugget_vectors).toBe(1);

      expect(countRows(core, "mem_observations", "id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_observations", "id = ?", [keep])).toBe(1);
      expect(countRows(core, "mem_vectors", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_vectors", "observation_id = ?", [keep])).toBeGreaterThanOrEqual(1);
      expect(countRows(core, "mem_nuggets", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_nugget_vectors", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_links", "from_observation_id = ? OR to_observation_id = ?", [target, target])).toBe(0);
      expect(countRows(core, "mem_relations", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_tags", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_observation_entities", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_facts", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_events", "event_id = ?", [`event-cascade-target`])).toBe(0);
      expect(countRows(core, "mem_events", "event_id = ?", [`event-cascade-keep`])).toBe(1);
      expect(countRows(core, "mem_sessions", "session_id = ?", ["session-hard-purge-project"])).toBe(1);
      expect(countRows(core, "mem_entities", "name = ?", ["Unrelated Orphan"])).toBe(1);
      expect(countRows(core, "mem_audit_log")).toBeGreaterThan(auditBefore);
      expect(countRows(core, "mem_audit_log", "action = ?", ["admin.purge.execute"])).toBe(1);
      expect(countRows(core, "mem_archive_stubs", "observation_id = ? AND archive_state = 'purged'", [target])).toBe(1);
      const archiveFull = core.getRawDb()
        .query(`SELECT payload_json, purged_at FROM mem_archive_full WHERE archive_id = ?`)
        .get(`archive-${target}`) as { payload_json: string; purged_at: string | null };
      expect(archiveFull.payload_json).toBe("{}");
      expect(archiveFull.purged_at).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });

  test("execute removes sqlite-vec mapped rows when vec/map tables already exist", () => {
    const core = new HarnessMemCore(createConfig("sqlite-vec"));
    try {
      const target = insertObservation(core, "vec-target", "target vec row");
      const keep = insertObservation(core, "vec-keep", "keep vec row");
      archiveObservation(core, target);
      seedArchiveForObservation(core, target);
      const db = core.getRawDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS mem_vectors_vec(rowid INTEGER PRIMARY KEY, embedding TEXT);
        CREATE TABLE IF NOT EXISTS mem_vectors_vec_test_model(rowid INTEGER PRIMARY KEY, embedding TEXT);
        CREATE TABLE IF NOT EXISTS mem_vectors_vec_map_test_model(
          rowid INTEGER PRIMARY KEY,
          observation_id TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
      `);
      db.query(`INSERT OR REPLACE INTO mem_vectors_vec(rowid, embedding) VALUES (101, ?), (102, ?)`)
        .run(VECTOR_64_JSON, VECTOR_64_JSON);
      db.query(`INSERT OR REPLACE INTO mem_vectors_vec_map(rowid, observation_id, updated_at) VALUES (101, ?, '2026-05-20'), (102, ?, '2026-05-20')`)
        .run(target, keep);
      db.query(`INSERT OR REPLACE INTO mem_vectors_vec_test_model(rowid, embedding) VALUES (201, ?), (202, ?)`)
        .run(VECTOR_64_JSON, VECTOR_64_JSON);
      db.query(`INSERT OR REPLACE INTO mem_vectors_vec_map_test_model(rowid, observation_id, updated_at) VALUES (201, ?, '2026-05-20'), (202, ?, '2026-05-20')`)
        .run(target, keep);

      const plan = hardPurgePlan(core, [target]);
      const executed = executeHardPurge(core, plan, [target]);
      expect(executed.ok).toBe(true);

      expect(countRows(core, "mem_vectors_vec_map", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_vectors_vec", "rowid = 101")).toBe(0);
      expect(countRows(core, "mem_vectors_vec_map", "observation_id = ?", [keep])).toBe(1);
      expect(countRows(core, "mem_vectors_vec", "rowid = 102")).toBe(1);
      expect(countRows(core, "mem_vectors_vec_map_test_model", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_vectors_vec_test_model", "rowid = 201")).toBe(0);
      expect(countRows(core, "mem_vectors_vec_map_test_model", "observation_id = ?", [keep])).toBe(1);
      expect(countRows(core, "mem_vectors_vec_test_model", "rowid = 202")).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("execute rejects expired manifest_expires_at and accepts a fresh plan expiry", () => {
    const core = new HarnessMemCore(createConfig("manifest-expiry"));
    try {
      const target = insertObservation(core, "expiry-target", "target expiry row");
      archiveObservation(core, target);
      seedArchiveForObservation(core, target);
      const plan = hardPurgePlan(core, [target]);
      const expiredAt = "2000-01-01T00:00:00.000Z";
      (core as unknown as { hardPurgePlanExpirations: Map<string, string> })
        .hardPurgePlanExpirations
        .set(plan.manifest_hash, expiredAt);

      const expired = core.adminForgetHardPurge({
        target_ids: [target],
        execute: true,
        manifest_hash: plan.manifest_hash,
        manifest_expires_at: expiredAt,
        candidate_count: plan.candidate_count,
        temp_test_backup_token: TEMP_BACKUP_TOKEN,
        retention_ack: true,
        archive_ack: true,
        confirmation: plan.confirmation_phrase,
      });
      expect(expired.ok).toBe(false);
      expect(expired.error).toContain("expired");

      const freshPlan = hardPurgePlan(core, [target]);
      const fresh = executeHardPurge(core, freshPlan, [target]);
      expect(fresh.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("execute requires restore-capable archive stub and full archive rows", () => {
    const core = new HarnessMemCore(createConfig("archive-required"));
    try {
      const noArchive = insertObservation(core, "archive-missing", "missing archive row");
      archiveObservation(core, noArchive);
      const noArchivePlan = hardPurgePlan(core, [noArchive]);
      const noArchiveExecute = executeHardPurge(core, noArchivePlan, [noArchive]);
      expect(noArchiveExecute.ok).toBe(false);
      expect(noArchiveExecute.error).toContain("restore-capable archive");

      const stubOnly = insertObservation(core, "archive-stub-only", "stub only archive row");
      archiveObservation(core, stubOnly);
      seedArchiveForObservation(core, stubOnly, { includeFull: false });
      const stubOnlyPlan = hardPurgePlan(core, [stubOnly]);
      const stubOnlyExecute = executeHardPurge(core, stubOnlyPlan, [stubOnly]);
      expect(stubOnlyExecute.ok).toBe(false);
      expect(stubOnlyExecute.error).toContain("restore-capable archive");

      const valid = insertObservation(core, "archive-valid", "valid archive row");
      archiveObservation(core, valid);
      seedArchiveForObservation(core, valid);
      const validPlan = hardPurgePlan(core, [valid]);
      expect(validPlan.archive.archive_stub_count).toBe(1);
      expect(validPlan.archive.archive_full_count).toBe(1);
      expect(validPlan.archive.restore_capable_count).toBe(1);
      expect(validPlan.archive.restore_capable_full_count).toBe(1);
      expect(validPlan.archive.restore_capable_full_observation_count).toBe(1);
      expect(validPlan.archive.missing_restore_capable_archive_ids).toEqual([]);
      const validExecute = executeHardPurge(core, validPlan, [valid]);
      expect(validExecute.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("execute rejects archived stubs backed only by cleared or purged full archive payloads", () => {
    const core = new HarnessMemCore(createConfig("purged-full-archive"));
    try {
      const cleared = insertObservation(core, "archive-cleared-full", "cleared full archive row");
      archiveObservation(core, cleared);
      seedArchiveForObservation(core, cleared, {
        fullPayloadJson: "{}",
        fullPurgedAt: "2026-05-20T01:00:00.000Z",
      });
      const clearedPlan = hardPurgePlan(core, [cleared]);
      expect(clearedPlan.archive.archive_full_count).toBe(1);
      expect(clearedPlan.archive.restore_capable_count).toBe(1);
      expect(clearedPlan.archive.restore_capable_full_count).toBe(0);
      expect(clearedPlan.archive.missing_restore_capable_archive_ids).toEqual([cleared]);
      const clearedExecute = executeHardPurge(core, clearedPlan, [cleared]);
      expect(clearedExecute.ok).toBe(false);
      expect(clearedExecute.error).toContain("restore-capable archive");

      const purged = insertObservation(core, "archive-purged-full", "purged full archive row");
      archiveObservation(core, purged);
      seedArchiveForObservation(core, purged, {
        fullPayloadJson: JSON.stringify({ restore: true, observation_id: purged }),
        fullPurgedAt: "2026-05-20T01:00:00.000Z",
      });
      const purgedPlan = hardPurgePlan(core, [purged]);
      expect(purgedPlan.archive.archive_full_count).toBe(1);
      expect(purgedPlan.archive.restore_capable_count).toBe(1);
      expect(purgedPlan.archive.restore_capable_full_count).toBe(0);
      expect(purgedPlan.archive.missing_restore_capable_archive_ids).toEqual([purged]);
      const purgedExecute = executeHardPurge(core, purgedPlan, [purged]);
      expect(purgedExecute.ok).toBe(false);
      expect(purgedExecute.error).toContain("restore-capable archive");
    } finally {
      core.shutdown("test");
    }
  });

  test("execute rejects aggregate archive counts that hide a missing target archive", () => {
    const core = new HarnessMemCore(createConfig("aggregate-archive-gap"));
    try {
      const hasDuplicates = insertObservation(core, "archive-duplicate-a", "duplicate archive row A");
      const missingArchive = insertObservation(core, "archive-missing-b", "missing archive row B");
      archiveObservation(core, hasDuplicates);
      archiveObservation(core, missingArchive);
      seedArchiveForObservation(core, hasDuplicates, { archiveSuffix: "one" });
      seedArchiveForObservation(core, hasDuplicates, { archiveSuffix: "two" });

      const plan = hardPurgePlan(core, [hasDuplicates, missingArchive]);
      expect(plan.archive.archive_stub_count).toBe(2);
      expect(plan.archive.archive_full_count).toBe(2);
      expect(plan.archive.restore_capable_count).toBe(2);
      expect(plan.archive.restore_capable_full_count).toBe(1);
      expect(plan.archive.restore_capable_full_observation_count).toBe(1);
      expect(plan.archive.missing_restore_capable_archive_ids).toEqual([missingArchive]);

      const executed = executeHardPurge(core, plan, [hasDuplicates, missingArchive]);
      expect(executed.ok).toBe(false);
      expect(executed.error).toContain("restore-capable archive");
      expect(countRows(core, "mem_observations", "id IN (?, ?)", [hasDuplicates, missingArchive])).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("backup artifact gate rejects sha-only and wrong sha, then accepts matching sqlite backup with integrity ok", () => {
    const core = new HarnessMemCore(createConfig("backup-evidence"));
    try {
      const shaOnly = insertObservation(core, "backup-sha-only", "sha only reject row");
      archiveObservation(core, shaOnly);
      seedArchiveForObservation(core, shaOnly);
      const shaOnlyHash = "a".repeat(64);
      const shaOnlyPlan = core.adminForgetHardPurge({
        target_ids: [shaOnly],
        backup_sha256: shaOnlyHash,
      });
      expect(shaOnlyPlan.ok).toBe(true);
      const shaOnlyItem = shaOnlyPlan.items[0] as ReturnType<typeof hardPurgePlan>;
      expect(shaOnlyItem.backup).toMatchObject({ kind: "sha256_metadata", provided: false });
      const shaOnlyExecute = core.adminForgetHardPurge({
        target_ids: [shaOnly],
        execute: true,
        manifest_hash: shaOnlyItem.manifest_hash,
        manifest_expires_at: shaOnlyItem.expires_at,
        candidate_count: shaOnlyItem.candidate_count,
        backup_sha256: shaOnlyHash,
        retention_ack: true,
        archive_ack: true,
        confirmation: shaOnlyItem.confirmation_phrase,
      });
      expect(shaOnlyExecute.ok).toBe(false);
      expect(shaOnlyExecute.error).toContain("backup_path");

      const wrongShaBackup = createBackupArtifact(core, "wrong-sha");
      const wrongShaPlan = core.adminForgetHardPurge({
        target_ids: [shaOnly],
        backup_path: wrongShaBackup.path,
        backup_sha256: "b".repeat(64),
      });
      expect(wrongShaPlan.ok).toBe(false);
      expect(wrongShaPlan.error).toContain("sha256");

      const valid = insertObservation(core, "backup-valid", "valid backup row");
      archiveObservation(core, valid);
      seedArchiveForObservation(core, valid);
      const backup = createBackupArtifact(core, "valid");
      const validPlanResponse = core.adminForgetHardPurge({
        target_ids: [valid],
        backup_path: backup.path,
        backup_sha256: backup.sha256,
      });
      expect(validPlanResponse.ok).toBe(true);
      const validPlan = validPlanResponse.items[0] as ReturnType<typeof hardPurgePlan>;
      expect(validPlan.backup).toMatchObject({
        kind: "backup_file",
        provided: true,
        integrity_check: { checked: true, ok: true },
      });
      const validExecute = core.adminForgetHardPurge({
        target_ids: [valid],
        execute: true,
        manifest_hash: validPlan.manifest_hash,
        manifest_expires_at: validPlan.expires_at,
        candidate_count: validPlan.candidate_count,
        backup_path: backup.path,
        backup_sha256: backup.sha256,
        retention_ack: true,
        archive_ack: true,
        confirmation: validPlan.confirmation_phrase,
      });
      expect(validExecute.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("Plans.md marks S127-004 complete", () => {
    const plans = readFileSync(join(import.meta.dir, "../../../Plans.md"), "utf8");
    expect(plans).toContain("S127-004");
    expect(plans).toMatch(/S127-004[\s\S]*?cc:完了/);
  });
});
