import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createConfig(dir: string): Config {
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
  };
}

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-admin-${name}-`));
  const config = createConfig(dir);
  return { core: new HarnessMemCore(config), dir };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createBackupArtifact(core: HarnessMemCore, name: string): { path: string; sha256: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-admin-backup-${name}-`));
  const path = join(dir, "backup.db");
  core.getRawDb().exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return { path, sha256: sha256File(path), dir };
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("failed to allocate test port"));
        }
      });
    });
  });
}

async function createRuntime(name: string): Promise<{ baseUrl: string; core: HarnessMemCore; stop: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-admin-api-${name}-`));
  const config = createConfig(dir);
  config.bindPort = await findAvailablePort();
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    core,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function archivePayloadRowsForObservation(core: HarnessMemCore, observationId: string, sessionId: string): Record<string, Array<Record<string, unknown>>> {
  const db = core.getRawDb();
  const observationRows = db.query(`SELECT * FROM mem_observations WHERE id = ?`).all(observationId) as Array<Record<string, unknown>>;
  const observation = observationRows[0] ?? {};
  const eventId = typeof observation.event_id === "string" ? observation.event_id : null;
  const observationEntities = db
    .query(`SELECT * FROM mem_observation_entities WHERE observation_id = ? ORDER BY entity_id ASC`)
    .all(observationId) as Array<Record<string, unknown>>;
  const entityIds = observationEntities.map((entry) => Number(entry.entity_id)).filter((entityId) => Number.isFinite(entityId));
  return {
    mem_sessions: db.query(`SELECT * FROM mem_sessions WHERE session_id = ?`).all(sessionId) as Array<Record<string, unknown>>,
    mem_events: eventId
      ? db.query(`SELECT * FROM mem_events WHERE observation_id = ? OR event_id = ? ORDER BY ts ASC, event_id ASC`).all(observationId, eventId) as Array<Record<string, unknown>>
      : db.query(`SELECT * FROM mem_events WHERE observation_id = ? ORDER BY ts ASC, event_id ASC`).all(observationId) as Array<Record<string, unknown>>,
    mem_observations: observationRows,
    mem_vectors: db.query(`SELECT * FROM mem_vectors WHERE observation_id = ? ORDER BY model ASC`).all(observationId) as Array<Record<string, unknown>>,
    mem_links: db.query(`SELECT * FROM mem_links WHERE from_observation_id = ? OR to_observation_id = ? ORDER BY id ASC`).all(observationId, observationId) as Array<Record<string, unknown>>,
    mem_relations: db.query(`SELECT * FROM mem_relations WHERE observation_id = ? ORDER BY id ASC`).all(observationId) as Array<Record<string, unknown>>,
    mem_facts: db.query(`SELECT * FROM mem_facts WHERE observation_id = ? ORDER BY fact_id ASC`).all(observationId) as Array<Record<string, unknown>>,
    mem_tags: db.query(`SELECT * FROM mem_tags WHERE observation_id = ? ORDER BY tag_type ASC, tag ASC`).all(observationId) as Array<Record<string, unknown>>,
    mem_entities: entityIds.length > 0
      ? db.query(`SELECT * FROM mem_entities WHERE id IN (${entityIds.map(() => "?").join(", ")}) ORDER BY id ASC`).all(...(entityIds as never[])) as Array<Record<string, unknown>>
      : [],
    mem_observation_entities: observationEntities,
    mem_nuggets: db.query(`SELECT * FROM mem_nuggets WHERE observation_id = ? ORDER BY seq ASC, nugget_id ASC`).all(observationId) as Array<Record<string, unknown>>,
    mem_nugget_vectors: db.query(`SELECT * FROM mem_nugget_vectors WHERE observation_id = ? ORDER BY nugget_id ASC, model ASC`).all(observationId) as Array<Record<string, unknown>>,
  };
}

function seedArchiveForObservation(core: HarnessMemCore, observationId: string): void {
  const db = core.getRawDb();
  db.exec(`
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
      purged_at TEXT DEFAULT NULL
    );
  `);
  const row = db
    .query(`SELECT * FROM mem_observations WHERE id = ?`)
    .get(observationId) as Record<string, unknown> & { project: string; session_id: string; user_id: string; team_id: string | null; content: string };
  const archiveId = `archive-${observationId}`;
  const fullRef = `sqlite:${archiveId}`;
  const now = "2026-05-20T00:00:00.000Z";
  const manifestSha256 = "1".repeat(64);
  const contentSha256 = createHash("sha256").update(row.content).digest("hex");
  const payloadJson = JSON.stringify({
    schema_version: "s129-archive-payload-v1",
    archive_id: archiveId,
    observation_id: observationId,
    created_at: now,
    actor: "system",
    reason: "test archive",
    content_sha256: contentSha256,
    manifest_sha256: manifestSha256,
    cross_store_impact: { observations: 1 },
    rows: archivePayloadRowsForObservation(core, observationId, row.session_id),
  });
  const payloadSha256 = createHash("sha256").update(payloadJson).digest("hex");
  db.query(`
    INSERT OR REPLACE INTO mem_archive_stubs(
      archive_id, observation_id, project, session_id, user_id, team_id,
      archive_stub, archive_full_ref, archive_state, reason, legal_hold_snapshot,
      content_sha256, manifest_sha256, created_at, metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'archived', 'test archive', 0, ?, ?, ?, '{}')
  `).run(
    archiveId,
    observationId,
    row.project,
    row.session_id,
    row.user_id,
    row.team_id,
    `stub for ${observationId}`,
    fullRef,
    contentSha256,
    manifestSha256,
    now,
  );
  db.query(`
    INSERT OR REPLACE INTO mem_archive_full(archive_full_ref, archive_id, payload_json, payload_sha256, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(fullRef, archiveId, payloadJson, payloadSha256, now);
}

describe("memory admin integration", () => {
  test("reindexVectors and metrics endpoints data shape", async () => {
    const { core, dir } = createCore("reindex");
    try {
      core.recordEvent({
        platform: "claude",
        project: "admin-project",
        session_id: "session-admin",
        event_type: "user_prompt",
        ts: "2026-02-14T00:00:00.000Z",
        payload: { content: "vector test content" },
        tags: ["admin"],
        privacy_tags: [],
      });

      const reindex = await core.reindexVectors(100);
      expect(reindex.ok).toBe(true);
      const payload = reindex.items[0] as { reindexed: number };
      expect(payload.reindexed).toBeGreaterThan(0);

      const metrics = core.metrics();
      expect(metrics.ok).toBe(true);
      const metricsItem = metrics.items[0] as {
        coverage: { observations: number; mem_vectors: number; mem_vectors_vec_map: number };
      };
      expect(metricsItem.coverage.observations).toBeGreaterThan(0);
      expect(metricsItem.coverage.mem_vectors).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sqlite-vec repair-map admin path defaults to dry-run", () => {
    const { core, dir } = createCore("repair-map-api");
    try {
      core.recordEvent({
        platform: "claude",
        project: "admin-project",
        session_id: "session-admin-repair",
        event_type: "user_prompt",
        ts: "2026-02-25T00:00:00.000Z",
        payload: { content: "repair map endpoint vector content" },
        tags: ["admin"],
        privacy_tags: [],
      });

      const repair = core.repairSqliteVecMap({ limit: 10 });
      expect(repair.ok).toBe(true);
      const item = repair.items[0] as Record<string, unknown>;
      expect(item.dry_run).toBe(true);
      expect(item.vector_count).toBeGreaterThan(0);
      expect(item.repaired).toBe(0);
      expect(item).not.toHaveProperty("missing_after");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("forget plan endpoint is dry-run and reports impact", async () => {
    const runtime = await createRuntime("forget-plan");
    try {
      const inserted = runtime.core.recordEvent({
        platform: "claude",
        project: "admin-project",
        session_id: "session-admin-forget",
        event_type: "user_prompt",
        ts: "2026-02-25T00:00:00.000Z",
        payload: { content: "old admin forget endpoint content" },
        tags: ["admin"],
        privacy_tags: [],
      });
      const observationId = (inserted.items[0] as { id: string }).id;
      runtime.core.getRawDb()
        .query(`UPDATE mem_observations SET created_at = ?, updated_at = ?, signal_score = 0, access_count = 0 WHERE id = ?`)
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", observationId);

      const response = await fetch(`${runtime.baseUrl}/v1/admin/forget/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: "admin-project", limit: 10 }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        items: Array<{
          dry_run: boolean;
          evicted: number;
          candidates: Array<{ observation_id: string }>;
          cross_store_impact: { observations: number };
        }>;
      };
      expect(payload.ok).toBe(true);
      expect(payload.items[0].dry_run).toBe(true);
      expect(payload.items[0].evicted).toBe(0);
      expect(payload.items[0].candidates.map((candidate) => candidate.observation_id)).toContain(observationId);
      expect(payload.items[0].cross_store_impact.observations).toBeGreaterThanOrEqual(1);
    } finally {
      runtime.stop();
    }
  });

  test("archive and restore endpoints mutate only through archive-first flow", async () => {
    const runtime = await createRuntime("archive-restore");
    try {
      const inserted = runtime.core.recordEvent({
        platform: "claude",
        project: "admin-project",
        session_id: "session-admin-archive",
        event_type: "user_prompt",
        ts: "2026-02-25T00:00:00.000Z",
        payload: { content: "endpoint archive restore content" },
        tags: ["admin"],
        privacy_tags: [],
      });
      const observationId = (inserted.items[0] as { id: string }).id;
      runtime.core.getRawDb()
        .query(`UPDATE mem_observations SET created_at = ?, updated_at = ?, signal_score = 0, access_count = 0 WHERE id = ?`)
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", observationId);

      const planResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidate_ids: [observationId] }),
      });
      expect(planResponse.status).toBe(200);
      const plan = (await planResponse.json()) as {
        ok: boolean;
        items: Array<{ manifest_sha256: string; candidate_ids: string[] }>;
      };
      expect(plan.ok).toBe(true);
      expect(plan.items[0].candidate_ids).toEqual([observationId]);

      const archiveResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidate_ids: [observationId],
          manifest_sha256: plan.items[0].manifest_sha256,
          reason: "endpoint archive",
          execute: true,
        }),
      });
      expect(archiveResponse.status).toBe(200);
      const archive = (await archiveResponse.json()) as {
        ok: boolean;
        items: Array<{ archive_ids: string[]; archived_count: number }>;
      };
      expect(archive.ok).toBe(true);
      expect(archive.items[0].archived_count).toBe(1);
      const archiveId = archive.items[0].archive_ids[0];
      const archivedRow = runtime.core.getRawDb()
        .query(`SELECT archived_at FROM mem_observations WHERE id = ?`)
        .get(observationId) as { archived_at: string | null };
      expect(archivedRow.archived_at).toBeTruthy();

      const archiveSearchResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/archive/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive_id: archiveId, limit: 1 }),
      });
      expect(archiveSearchResponse.status).toBe(200);
      const archiveSearch = (await archiveSearchResponse.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
        meta: Record<string, unknown>;
      };
      expect(archiveSearch.ok).toBe(true);
      expect(archiveSearch.items).toHaveLength(1);
      expect(archiveSearch.items[0].archive_id).toBe(archiveId);
      expect(archiveSearch.items[0]).toHaveProperty("archive_stub");
      expect(archiveSearch.items[0]).not.toHaveProperty("payload_json");
      expect(JSON.stringify(archiveSearch.items[0])).not.toContain("endpoint archive restore content");
      expect(archiveSearch.meta.payload_json_returned).toBe(false);
      expect(archiveSearch.meta.raw_content_returned).toBe(false);

      const restoreResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive_id: archiveId, reason: "endpoint restore", execute: true }),
      });
      expect(restoreResponse.status).toBe(200);
      const restore = (await restoreResponse.json()) as { ok: boolean; items: Array<{ observation_id: string }> };
      expect(restore.ok).toBe(true);
      expect(restore.items[0].observation_id).toBe(observationId);
      const restoredRow = runtime.core.getRawDb()
        .query(`SELECT archived_at FROM mem_observations WHERE id = ?`)
        .get(observationId) as { archived_at: string | null };
      expect(restoredRow.archived_at).toBeNull();
    } finally {
      runtime.stop();
    }
  });

  test("hard purge admin endpoint requires manifest gates and deletes only archived temp DB rows", async () => {
    const runtime = await createRuntime("hard-purge");
    try {
      const inserted = runtime.core.recordEvent({
        platform: "claude",
        project: "admin-hard-purge",
        session_id: "session-admin-hard-purge",
        event_type: "user_prompt",
        ts: "2026-05-20T00:00:00.000Z",
        payload: { content: "hard purge endpoint archived content" },
        tags: ["admin"],
        privacy_tags: [],
      });
      const observationId = (inserted.items[0] as { id: string }).id;
      runtime.core.bulkDeleteObservations({ ids: [observationId] });
      seedArchiveForObservation(runtime.core, observationId);

      const readinessResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/hard-purge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_ids: [observationId],
          temp_test_backup_token: "TEMP_TEST_BACKUP_S127_004",
          readiness_only: true,
        }),
      });
      expect(readinessResponse.status).toBe(200);
      const readinessPayload = (await readinessResponse.json()) as {
        ok: boolean;
        items: Array<{ mode: string; confirmation_phrase?: string }>;
      };
      expect(readinessPayload.ok).toBe(true);
      expect(readinessPayload.items[0].mode).toBe("hard_purge_readiness");
      expect(readinessPayload.items[0].confirmation_phrase).toBeUndefined();
      expect("confirmation_phrase" in readinessPayload.items[0]).toBe(false);

      const planResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/hard-purge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_ids: [observationId],
          temp_test_backup_token: "TEMP_TEST_BACKUP_S127_004",
        }),
      });
      expect(planResponse.status).toBe(200);
      const planPayload = (await planResponse.json()) as {
        ok: boolean;
        items: Array<{
          manifest_hash: string;
          expires_at: string;
          candidate_count: number;
          confirmation_phrase: string;
        }>;
      };
      expect(planPayload.ok).toBe(true);

      const plan = planPayload.items[0];
      const executeResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/hard-purge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_ids: [observationId],
          execute: true,
          manifest_hash: plan.manifest_hash,
          manifest_expires_at: plan.expires_at,
          candidate_count: plan.candidate_count,
          temp_test_backup_token: "TEMP_TEST_BACKUP_S127_004",
          retention_ack: true,
          archive_ack: true,
          confirmation: plan.confirmation_phrase,
        }),
      });
      expect(executeResponse.status).toBe(200);
      const executePayload = (await executeResponse.json()) as {
        ok: boolean;
        meta: { deleted_count?: number };
      };
      expect(executePayload.ok).toBe(true);
      expect(executePayload.meta.deleted_count).toBe(1);
      const row = runtime.core.getRawDb()
        .query(`SELECT id FROM mem_observations WHERE id = ?`)
        .get(observationId);
      expect(row).toBeNull();
    } finally {
      runtime.stop();
    }
  });

  test("hard purge admin endpoint accepts preverified backup evidence and readiness-only stays non-executable", async () => {
    const runtime = await createRuntime("hard-purge-preverified");
    let backupDir: string | null = null;
    try {
      const inserted = runtime.core.recordEvent({
        platform: "claude",
        project: "admin-hard-purge-preverified",
        session_id: "session-admin-hard-purge-preverified",
        event_type: "user_prompt",
        ts: "2026-05-20T00:00:00.000Z",
        payload: { content: "hard purge preverified endpoint content" },
        tags: ["admin"],
        privacy_tags: [],
      });
      const observationId = (inserted.items[0] as { id: string }).id;
      runtime.core.bulkDeleteObservations({ ids: [observationId] });
      seedArchiveForObservation(runtime.core, observationId);

      const backup = createBackupArtifact(runtime.core, "preverified");
      backupDir = backup.dir;
      const evidenceResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/backup-evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backup_path: backup.path,
          backup_sha256: backup.sha256,
          ttl_seconds: 60,
        }),
      });
      expect(evidenceResponse.status).toBe(200);
      const evidencePayload = (await evidenceResponse.json()) as {
        ok: boolean;
        items: Array<{
          preverified_backup_evidence_token: string;
          backup_path: string;
          backup_sha256: string;
          integrity_check: { checked: boolean; ok: boolean };
        }>;
      };
      expect(evidencePayload.ok).toBe(true);
      const evidence = evidencePayload.items[0];
      expect(evidence.preverified_backup_evidence_token).toMatch(/^preverified_backup_/);
      expect(evidence.backup_path).toBe(backup.path);
      expect(evidence.backup_sha256).toBe(backup.sha256);
      expect(evidence.integrity_check).toMatchObject({ checked: true, ok: true });

      const readinessResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/hard-purge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_ids: [observationId],
          preverified_backup_evidence_token: evidence.preverified_backup_evidence_token,
          readiness_only: true,
        }),
      });
      expect(readinessResponse.status).toBe(200);
      const readinessPayload = (await readinessResponse.json()) as {
        ok: boolean;
        items: Array<{
          mode: string;
          manifest_hash: string;
          expires_at: string;
          candidate_count: number;
          confirmation_phrase?: string;
          backup: { kind: string; integrity_check: { checked: boolean; ok: boolean } };
        }>;
      };
      expect(readinessPayload.ok).toBe(true);
      expect(readinessPayload.items[0].mode).toBe("hard_purge_readiness");
      expect(readinessPayload.items[0].confirmation_phrase).toBeUndefined();
      expect("confirmation_phrase" in readinessPayload.items[0]).toBe(false);
      expect(readinessPayload.items[0].backup).toMatchObject({
        kind: "preverified_backup",
        integrity_check: { checked: false, ok: true },
      });

      const readinessExecuteResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/hard-purge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_ids: [observationId],
          execute: true,
          manifest_hash: readinessPayload.items[0].manifest_hash,
          manifest_expires_at: readinessPayload.items[0].expires_at,
          candidate_count: readinessPayload.items[0].candidate_count,
          preverified_backup_evidence_token: evidence.preverified_backup_evidence_token,
          retention_ack: true,
          archive_ack: true,
          confirmation: `HARD_PURGE 1 OBSERVATIONS ${readinessPayload.items[0].manifest_hash.slice(0, 12)}`,
        }),
      });
      const readinessExecutePayload = (await readinessExecuteResponse.json()) as { ok: boolean; error?: string };
      expect(readinessExecutePayload.ok).toBe(false);
      expect(readinessExecutePayload.error).toContain("no active hard purge plan");

      const planResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/hard-purge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_ids: [observationId],
          preverified_backup_evidence_token: evidence.preverified_backup_evidence_token,
        }),
      });
      expect(planResponse.status).toBe(200);
      const planPayload = (await planResponse.json()) as {
        ok: boolean;
        items: Array<{
          manifest_hash: string;
          expires_at: string;
          candidate_count: number;
          confirmation_phrase: string;
          backup: { kind: string };
        }>;
      };
      expect(planPayload.ok).toBe(true);
      expect(planPayload.items[0].backup.kind).toBe("preverified_backup");
      const plan = planPayload.items[0];

      const executeResponse = await fetch(`${runtime.baseUrl}/v1/admin/forget/hard-purge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_ids: [observationId],
          execute: true,
          manifest_hash: plan.manifest_hash,
          manifest_expires_at: plan.expires_at,
          candidate_count: plan.candidate_count,
          preverified_backup_evidence_token: evidence.preverified_backup_evidence_token,
          retention_ack: true,
          archive_ack: true,
          confirmation: plan.confirmation_phrase,
        }),
      });
      expect(executeResponse.status).toBe(200);
      const executePayload = (await executeResponse.json()) as {
        ok: boolean;
        meta: { deleted_count?: number };
      };
      expect(executePayload.ok).toBe(true);
      expect(executePayload.meta.deleted_count).toBe(1);
    } finally {
      if (backupDir) rmSync(backupDir, { recursive: true, force: true });
      runtime.stop();
    }
  });

  test("vector backfill admin endpoints start, stop, and report status", async () => {
    const runtime = await createRuntime("vector-backfill");
    try {
      const startResponse = await fetch(`${runtime.baseUrl}/v1/admin/vector-backfill/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test:model",
          dimension: "32",
          compact_batch_size: "7",
          reindex_batch_size: "8",
          interval_ms: "60000",
          target_coverage: "0.99",
          reset: true,
        }),
      });
      expect(startResponse.status).toBe(200);
      const startPayload = (await startResponse.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
      };
      expect(startPayload.ok).toBe(true);
      expect(startPayload.items[0].model).toBe("test:model");
      expect(startPayload.items[0].dimension).toBe(32);
      expect(startPayload.items[0].compact_batch_size).toBe(7);
      expect(startPayload.items[0].reindex_batch_size).toBe(8);
      expect(startPayload.items[0].interval_ms).toBe(60000);
      expect(startPayload.items[0].target_coverage).toBe(0.99);

      const statusResponse = await fetch(`${runtime.baseUrl}/v1/admin/vector-backfill/status`);
      expect(statusResponse.status).toBe(200);
      const statusPayload = (await statusResponse.json()) as { ok: boolean; items: unknown[] };
      expect(statusPayload.ok).toBe(true);
      expect(statusPayload.items.length).toBe(1);

      const stopResponse = await fetch(`${runtime.baseUrl}/v1/admin/vector-backfill/stop`, { method: "POST" });
      expect(stopResponse.status).toBe(200);
      const stopPayload = (await stopResponse.json()) as { ok: boolean; items: unknown[] };
      expect(stopPayload.ok).toBe(true);
      expect(stopPayload.items.length).toBe(1);
    } finally {
      runtime.stop();
    }
  });
});
