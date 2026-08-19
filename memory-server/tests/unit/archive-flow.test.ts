import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HarnessMemCore,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    removeDirWithRetry(dir);
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-archive-flow-${name}-`));
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
    backgroundWorkersEnabled: false,
  };
}

function eventFor(id: string, content: string, project = "archive-project"): EventEnvelope {
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
  const observationId = (response.items[0] as { id: string }).id;
  core.getRawDb()
    .query(`UPDATE mem_observations SET created_at = ?, updated_at = ?, signal_score = 0, access_count = 0 WHERE id = ?`)
    .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", observationId);
  return observationId;
}

function countRows(core: HarnessMemCore, table: string, where = "1 = 1", values: unknown[] = []): number {
  const row = core.getRawDb()
    .query(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
    .get(...(values as never[])) as { count: number } | null;
  return Number(row?.count ?? 0);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function archivePlan(core: HarnessMemCore, project = "archive-project") {
  const response = core.adminForgetPlan({ project, limit: 10 });
  expect(response.ok).toBe(true);
  return response.items[0] as {
    candidate_ids: string[];
    manifest_sha256: string;
    cross_store_impact: Record<string, number>;
  };
}

function insertLifecycleRows(core: HarnessMemCore, targetId: string, keepId: string, project = "archive-project"): void {
  const db = core.getRawDb();
  const now = "2026-05-20T00:00:00.000Z";
  const sessionId = `session-${project}`;
  db.query(`
    INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES (?, 'test:model', 64, ?, ?, ?)
  `).run(targetId, JSON.stringify([0.1, 0.2]), now, now);
  db.query(`
    INSERT OR REPLACE INTO mem_nuggets(nugget_id, observation_id, seq, content, content_hash, created_at)
    VALUES ('nugget-archive-target', ?, 1, 'target nugget content', 'hash-target', ?)
  `).run(targetId, now);
  db.query(`
    INSERT OR REPLACE INTO mem_nugget_vectors(nugget_id, observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES ('nugget-archive-target', ?, 'test:model', 64, ?, ?, ?)
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
    VALUES ('Archive Flow Entity', 'concept', ?)
  `).run(now);
  const entity = db.query(`SELECT id FROM mem_entities WHERE name = 'Archive Flow Entity' AND entity_type = 'concept'`)
    .get() as { id: number };
  db.query(`
    INSERT OR REPLACE INTO mem_observation_entities(observation_id, entity_id, created_at)
    VALUES (?, ?, ?)
  `).run(targetId, entity.id, now);
  db.query(`
    INSERT OR REPLACE INTO mem_facts(fact_id, observation_id, project, session_id, fact_type, fact_key, fact_value, created_at, updated_at)
    VALUES ('fact-archive-target', ?, ?, ?, 'preference', 'target', 'restore', ?, ?)
  `).run(targetId, project, sessionId, now, now);
}

function removeCanonicalTargetRows(core: HarnessMemCore, targetId: string): void {
  const db = core.getRawDb();
  db.query(`DELETE FROM mem_events WHERE observation_id = ?`).run(targetId);
  db.query(`DELETE FROM mem_observations WHERE id = ?`).run(targetId);
}

describe("S129-002 archive-first restore-capable flow", () => {
  test("expired dedupe replacement archives both generations and standard restore swaps the active canonical row", () => {
    const core = new HarnessMemCore(createConfig("expired-dedupe-restore"));
    try {
      const content = "expired dedupe restore capable content";
      const firstEvent = {
        ...eventFor("expired-first", content),
        event_type: "session_end",
        expires_at: "2020-01-01T00:00:00.000Z",
      };
      const first = core.recordEvent(firstEvent);
      const oldId = (first.items[0] as { id: string }).id;
      const replacement = core.recordEvent({
        ...eventFor("expired-replacement", content),
        event_type: "session_end",
        ts: "2026-05-21T00:00:00.000Z",
      });
      expect(replacement.ok).toBe(true);
      expect((replacement.meta as Record<string, unknown>).deduped).toBeFalsy();
      const replacementId = (replacement.items[0] as { id: string }).id;
      expect(replacementId).not.toBe(oldId);

      const oldArchive = core.getRawDb().query<{
        archive_id: string;
        archive_state: string;
        payload_json: string;
      }, [string]>(`
        SELECT s.archive_id, s.archive_state, f.payload_json
        FROM mem_archive_stubs s
        JOIN mem_archive_full f ON f.archive_id = s.archive_id
        WHERE s.observation_id = ? AND s.archive_state = 'archived'
      `).get(oldId);
      expect(oldArchive?.archive_state).toBe("archived");
      expect(oldArchive?.payload_json).toContain(oldId);

      const restoreOld = core.adminForgetRestore({
        archive_id: oldArchive?.archive_id,
        reason: "restore expired canonical",
        execute: true,
      });
      expect(restoreOld.ok).toBe(true);
      expect(restoreOld.items[0]?.observation_id).toBe(oldId);
      const active = core.getRawDb().query<{ id: string }, [string]>(`
        SELECT id FROM mem_observations
        WHERE content_dedupe_hash = (
          SELECT content_dedupe_hash FROM mem_observations WHERE id = ?
        ) AND archived_at IS NULL
      `).all(oldId);
      expect(active).toEqual([{ id: oldId }]);

      const replacementArchive = core.getRawDb().query<{ archive_id: string; payload_json: string }, [string]>(`
        SELECT s.archive_id, f.payload_json
        FROM mem_archive_stubs s
        JOIN mem_archive_full f ON f.archive_id = s.archive_id
        WHERE s.observation_id = ? AND s.archive_state = 'archived'
      `).get(replacementId);
      expect(replacementArchive?.payload_json).toContain(replacementId);

      const restoreReplacement = core.adminForgetRestore({
        archive_id: replacementArchive?.archive_id,
        reason: "restore successor canonical",
        execute: true,
      });
      expect(restoreReplacement.ok).toBe(true);
      expect(restoreReplacement.items[0]?.observation_id).toBe(replacementId);
      const activeAfterReverse = core.getRawDb().query<{ id: string }, [string]>(`
        SELECT id FROM mem_observations
        WHERE content_dedupe_hash = (
          SELECT content_dedupe_hash FROM mem_observations WHERE id = ?
        ) AND archived_at IS NULL
      `).all(replacementId);
      expect(activeAfterReverse).toEqual([{ id: replacementId }]);
      expect(countRows(core, "mem_archive_stubs", "observation_id = ? AND archive_state = 'archived'", [oldId]))
        .toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("restore refuses to auto-archive a protected active successor and rolls back the swap", () => {
    const core = new HarnessMemCore(createConfig("protected-successor-restore"));
    try {
      const content = "protected successor restore rollback content";
      const first = core.recordEvent({
        ...eventFor("protected-successor-old", content),
        event_type: "session_end",
        expires_at: "2020-01-01T00:00:00.000Z",
      });
      const oldId = (first.items[0] as { id: string }).id;
      const second = core.recordEvent({
        ...eventFor("protected-successor-new", content),
        event_type: "session_end",
        ts: "2026-05-21T00:00:00.000Z",
      });
      const successorId = (second.items[0] as { id: string }).id;
      core.getRawDb().query(`UPDATE mem_observations SET tags_json = ? WHERE id = ?`)
        .run(JSON.stringify(["legal_hold"]), successorId);
      const oldArchive = core.getRawDb().query<{ archive_id: string }, [string]>(`
        SELECT archive_id FROM mem_archive_stubs
        WHERE observation_id = ? AND archive_state = 'archived'
      `).get(oldId);
      const archiveCountBefore = countRows(core, "mem_archive_stubs");

      const restore = core.adminForgetRestore({
        archive_id: oldArchive?.archive_id,
        reason: "protected successor must remain active",
        execute: true,
      });
      expect(restore.ok).toBe(false);
      expect(restore.error).toContain("privacy-protected");
      expect(countRows(core, "mem_archive_stubs")).toBe(archiveCountBefore);
      const states = core.getRawDb().query<{ id: string; archived_at: string | null }, [string, string]>(`
        SELECT id, archived_at FROM mem_observations WHERE id IN (?, ?) ORDER BY id
      `).all(oldId, successorId);
      expect(states.find((row) => row.id === oldId)?.archived_at).not.toBeNull();
      expect(states.find((row) => row.id === successorId)?.archived_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("archive writes stub/full atomically, hides normal search, and restore rehydrates lifecycle rows", () => {
    const core = new HarnessMemCore(createConfig("archive-restore"));
    try {
      const target = insertObservation(core, "target", "restore capable raw secret phrase");
      const keep = insertObservation(core, "keep", "keep row for link");
      insertLifecycleRows(core, target, keep);

      const plan = archivePlan(core);
      expect(plan.candidate_ids).toContain(target);
      const targetPlan = core.adminForgetArchive({ candidate_ids: [target] }).items[0] as { manifest_sha256: string };
      const archiveResponse = core.adminForgetArchive({
        candidate_ids: [target],
        manifest_sha256: targetPlan.manifest_sha256,
        reason: "score archive test",
        execute: true,
      });
      expect(archiveResponse.ok).toBe(true);
      const archive = archiveResponse.items[0] as { archive_ids: string[]; archived_count: number };
      expect(archive.archived_count).toBe(1);
      const archiveId = archive.archive_ids[0];

      const archivedRow = core.getRawDb()
        .query(`SELECT archived_at FROM mem_observations WHERE id = ?`)
        .get(target) as { archived_at: string | null };
      expect(archivedRow.archived_at).toBeTruthy();
      const hiddenSearch = core.search({ query: "restore capable raw secret phrase", include_private: true });
      expect((hiddenSearch.items as Array<{ id: string }>).some((item) => item.id === target)).toBe(false);

      const stub = core.getRawDb()
        .query(`SELECT archive_stub, metadata_json FROM mem_archive_stubs WHERE archive_id = ?`)
        .get(archiveId) as { archive_stub: string; metadata_json: string };
      expect(stub.archive_stub).not.toContain("restore capable raw secret phrase");
      expect(stub.metadata_json).not.toContain("restore capable raw secret phrase");
      const full = core.getRawDb()
        .query(`SELECT payload_json, payload_sha256 FROM mem_archive_full WHERE archive_id = ?`)
        .get(archiveId) as { payload_json: string; payload_sha256: string };
      expect(full.payload_json).toContain("restore capable raw secret phrase");

      removeCanonicalTargetRows(core, target);
      expect(countRows(core, "mem_observations", "id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_vectors", "observation_id = ?", [target])).toBe(0);
      expect(countRows(core, "mem_nuggets", "observation_id = ?", [target])).toBe(0);

      const restoreResponse = core.adminForgetRestore({
        archive_id: archiveId,
        reason: "restore temp-db archive",
        execute: true,
      });
      expect(restoreResponse.ok).toBe(true);
      const restoreItem = restoreResponse.items[0] as {
        observation_id: string;
        sqlite_vec_repair: { attempted: boolean; ok: boolean; failed: number; response_ok: boolean };
      };
      expect(restoreItem.observation_id).toBe(target);
      expect(restoreItem.sqlite_vec_repair.attempted).toBe(true);
      expect(restoreItem.sqlite_vec_repair.response_ok).toBe(true);
      if (restoreItem.sqlite_vec_repair.ok) {
        expect(restoreItem.sqlite_vec_repair.failed).toBe(0);
      } else {
        expect(restoreItem.sqlite_vec_repair.failed).toBeGreaterThan(0);
      }
      const restoredRow = core.getRawDb()
        .query(`SELECT archived_at FROM mem_observations WHERE id = ?`)
        .get(target) as { archived_at: string | null };
      expect(restoredRow.archived_at).toBeNull();
      expect(countRows(core, "mem_vectors", "observation_id = ?", [target])).toBeGreaterThanOrEqual(1);
      expect(countRows(core, "mem_links", "from_observation_id = ? OR to_observation_id = ?", [target, target])).toBeGreaterThanOrEqual(1);
      expect(countRows(core, "mem_relations", "observation_id = ?", [target])).toBeGreaterThanOrEqual(1);
      expect(countRows(core, "mem_facts", "observation_id = ?", [target])).toBeGreaterThanOrEqual(1);
      expect(countRows(core, "mem_events", "observation_id = ?", [target])).toBeGreaterThanOrEqual(1);
      expect(countRows(core, "mem_tags", "observation_id = ? AND tag = 'target-tag'", [target])).toBe(1);
      expect(countRows(core, "mem_observation_entities", "observation_id = ?", [target])).toBe(1);
      expect(countRows(core, "mem_nuggets", "observation_id = ?", [target])).toBeGreaterThanOrEqual(1);
      expect(countRows(core, "mem_nugget_vectors", "observation_id = ?", [target])).toBeGreaterThanOrEqual(1);
      expect(countRows(core, "mem_archive_stubs", "archive_id = ? AND archive_state = 'restored'", [archiveId])).toBe(1);
      expect(countRows(core, "mem_audit_log", "action = ?", ["admin.archive.create"])).toBe(1);
      expect(countRows(core, "mem_audit_log", "action = ?", ["admin.archive.restore"])).toBe(1);
      const visibleSearch = core.search({ query: "restore capable raw secret phrase", include_private: true });
      expect((visibleSearch.items as Array<{ id: string }>).some((item) => item.id === target)).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("execute rejects manifest mismatch and skips current legal_hold candidates", () => {
    const core = new HarnessMemCore(createConfig("mismatch-legal-hold"));
    try {
      const first = insertObservation(core, "first", "first archive candidate", "legal-project");
      const second = insertObservation(core, "second", "second archive candidate", "legal-project");
      const firstManifest = core.adminForgetArchive({ candidate_ids: [first] }).items[0] as { manifest_sha256: string };
      const mismatch = core.adminForgetArchive({
        candidate_ids: [second],
        manifest_sha256: firstManifest.manifest_sha256,
        reason: "wrong candidate",
        execute: true,
      });
      expect(mismatch.ok).toBe(false);
      expect(mismatch.error).toContain("manifest_sha256");

      const plan = core.adminForgetArchive({ candidate_ids: [first, second] }).items[0] as { manifest_sha256: string };
      core.getRawDb()
        .query(`UPDATE mem_observations SET privacy_tags_json = ? WHERE id = ?`)
        .run(JSON.stringify(["legal_hold"]), second);
      const archived = core.adminForgetArchive({
        candidate_ids: [first, second],
        manifest_sha256: plan.manifest_sha256,
        reason: "legal hold skip",
        execute: true,
      });
      expect(archived.ok).toBe(true);
      const item = archived.items[0] as { archived_ids: string[]; skipped_legal_hold: string[] };
      expect(item.archived_ids).toEqual([first]);
      expect(item.skipped_legal_hold).toEqual([second]);
      expect(countRows(core, "mem_archive_stubs", "observation_id = ?", [first])).toBe(1);
      expect(countRows(core, "mem_archive_stubs", "observation_id = ?", [second])).toBe(0);
      const legalHoldRow = core.getRawDb()
        .query(`SELECT archived_at FROM mem_observations WHERE id = ?`)
        .get(second) as { archived_at: string | null };
      expect(legalHoldRow.archived_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("restore rejects tampered full payload sha256", () => {
    const core = new HarnessMemCore(createConfig("payload-hash"));
    try {
      const target = insertObservation(core, "tamper", "payload hash protected phrase");
      const plan = core.adminForgetArchive({ candidate_ids: [target] }).items[0] as { manifest_sha256: string };
      const archiveResponse = core.adminForgetArchive({
        candidate_ids: [target],
        manifest_sha256: plan.manifest_sha256,
        reason: "hash verify",
        execute: true,
      });
      expect(archiveResponse.ok).toBe(true);
      const archiveId = (archiveResponse.items[0] as { archive_ids: string[] }).archive_ids[0];
      core.getRawDb()
        .query(`UPDATE mem_archive_full SET payload_json = ? WHERE archive_id = ?`)
        .run(JSON.stringify({ tampered: true }), archiveId);

      const restore = core.adminForgetRestore({
        archive_id: archiveId,
        reason: "should fail",
        execute: true,
      });
      expect(restore.ok).toBe(false);
      expect(restore.error).toContain("payload_sha256");
    } finally {
      core.shutdown("test");
    }
  });

  test("restore rejects structurally incomplete but self-hashed payload", () => {
    const core = new HarnessMemCore(createConfig("incomplete-payload"));
    try {
      const target = insertObservation(core, "incomplete", "incomplete payload protected phrase");
      const plan = core.adminForgetArchive({ candidate_ids: [target] }).items[0] as { manifest_sha256: string };
      const archiveResponse = core.adminForgetArchive({
        candidate_ids: [target],
        manifest_sha256: plan.manifest_sha256,
        reason: "incomplete payload",
        execute: true,
      });
      expect(archiveResponse.ok).toBe(true);
      const archiveId = (archiveResponse.items[0] as { archive_ids: string[] }).archive_ids[0];
      const stub = core.getRawDb()
        .query(`SELECT manifest_sha256, content_sha256 FROM mem_archive_stubs WHERE archive_id = ?`)
        .get(archiveId) as { manifest_sha256: string; content_sha256: string };
      const incompletePayload = JSON.stringify({
        schema_version: "s129-archive-payload-v1",
        archive_id: archiveId,
        observation_id: target,
        created_at: "2026-05-20T00:00:00.000Z",
        actor: "system",
        reason: "incomplete payload",
        content_sha256: stub.content_sha256,
        manifest_sha256: stub.manifest_sha256,
        cross_store_impact: { observations: 1 },
        rows: {
          mem_observations: [],
        },
      });
      core.getRawDb()
        .query(`UPDATE mem_archive_full SET payload_json = ?, payload_sha256 = ? WHERE archive_id = ?`)
        .run(incompletePayload, sha256Text(incompletePayload), archiveId);

      const restore = core.adminForgetRestore({
        archive_id: archiveId,
        reason: "should fail",
        execute: true,
      });
      expect(restore.ok).toBe(false);
      expect(restore.error).toContain("target observation");
    } finally {
      core.shutdown("test");
    }
  });

  test("restore reports sqlite-vec repair failure status without claiming repair ok", () => {
    const core = new HarnessMemCore(createConfig("repair-failure-status"));
    try {
      const target = insertObservation(core, "repair-fails", "repair failure status phrase");
      const plan = core.adminForgetArchive({ candidate_ids: [target] }).items[0] as { manifest_sha256: string };
      const archiveResponse = core.adminForgetArchive({
        candidate_ids: [target],
        manifest_sha256: plan.manifest_sha256,
        reason: "repair failure status",
        execute: true,
      });
      expect(archiveResponse.ok).toBe(true);
      const archiveId = (archiveResponse.items[0] as { archive_ids: string[] }).archive_ids[0];
      removeCanonicalTargetRows(core, target);
      core.getRawDb().exec(`
        DROP TABLE IF EXISTS mem_vectors_vec_fallback_local_hash_v3;
        DROP TABLE IF EXISTS mem_vectors_vec_map_fallback_local_hash_v3;
        CREATE TABLE mem_vectors_vec_fallback_local_hash_v3(rowid INTEGER PRIMARY KEY, wrong_column TEXT);
        CREATE TABLE mem_vectors_vec_map_fallback_local_hash_v3(
          rowid INTEGER PRIMARY KEY,
          observation_id TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
      `);

      const restore = core.adminForgetRestore({
        archive_id: archiveId,
        reason: "restore with broken sqlite-vec table",
        execute: true,
      });
      expect(restore.ok).toBe(true);
      const item = restore.items[0] as {
        sqlite_vec_repair: { attempted: boolean; ok: boolean; failed: number; response_ok: boolean };
      };
      expect(item.sqlite_vec_repair.attempted).toBe(true);
      expect(item.sqlite_vec_repair.response_ok).toBe(true);
      expect(item.sqlite_vec_repair.failed).toBeGreaterThan(0);
      expect(item.sqlite_vec_repair.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });
});
