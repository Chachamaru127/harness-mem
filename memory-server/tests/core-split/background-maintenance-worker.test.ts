import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import {
  BackgroundMaintenanceWorkerClient,
  shouldRetryWalCheckpoint,
} from "../../src/core/background-maintenance-worker-client";
import { getConfig, HarnessMemCore, PersistentSearchWorkerClient } from "../../src/core/harness-mem-core";
import { createTestConfig } from "./test-helpers";
import { startHarnessMemServer } from "../../src/server";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { enqueueConsolidationJob, runConsolidationOnce } from "../../src/consolidation/worker";
import { SearchSideEffectSpool } from "../../src/core/search-side-effect-spool";

const clients: BackgroundMaintenanceWorkerClient[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeClient(options: {
  blockMs?: number;
  timeoutMs?: number;
  ignoreTerm?: boolean;
  walMaxBytes?: number;
  busyTimeoutMs?: number;
  restartBackoffMs?: number;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-maintenance-worker-"));
  dirs.push(dir);
  const dbPath = join(dir, "worker.db");
  const db = new Database(dbPath);
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  db.close();
  const events: Array<Record<string, unknown>> = [];
  const client = new BackgroundMaintenanceWorkerClient({
    scriptPath: fileURLToPath(new URL("../../src/tools/background-maintenance-worker.ts", import.meta.url)),
    cwd: join(import.meta.dir, "../.."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HARNESS_MEM_DB_PATH: dbPath,
      HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS: String(options.blockMs ?? 0),
      HARNESS_MEM_TEST_MAINTENANCE_IGNORE_TERM: options.ignoreTerm ? "1" : "0",
      HARNESS_MEM_WAL_MAX_BYTES: String(options.walMaxBytes ?? 536_870_912),
      HARNESS_MEM_SQLITE_BUSY_TIMEOUT: String(options.busyTimeoutMs ?? 30_000),
    },
    dbPath,
    busyLogMs: 10,
    consolidationTimeoutMs: options.timeoutMs ?? 5_000,
    restartBackoffMs: options.restartBackoffMs,
    onProgress: (event) => events.push(event),
  });
  clients.push(client);
  return { client, dbPath, events };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await Bun.sleep(10);
  }
}

describe("background maintenance persistent workers", () => {
  test("search audit flush is coalesced and applied by the maintenance process", async () => {
    const { client, dbPath, events } = makeClient();
    const spool = new SearchSideEffectSpool(dbPath);
    spool.append({
      audits: [{
        action: "read.search",
        target_type: "project",
        target_id: "private-project",
        details: { query: "private-query", limit: 1, include_private: false, count: 0, privacy_excluded_count: 0, boundary_excluded_count: 0 },
      }],
      access_count_ids: [],
      created_at: "2026-08-20T00:00:00.000Z",
    });
    spool.close();

    expect(client.schedule("search_audit_flush")).toBe(true);
    expect(client.schedule("search_audit_flush")).toBe(false);
    await waitFor(() => events.some((event) =>
      event.kind === "completed" && event.task === "search_audit_flush"));

    const completed = events.find((event) =>
      event.kind === "completed" && event.task === "search_audit_flush");
    expect(completed?.intents_applied).toBe(1);
    expect(completed?.intents_remaining).toBe(0);
    expect(JSON.stringify(completed)).not.toContain("private-query");
    expect(JSON.stringify(completed)).not.toContain("private-project");
    const db = new Database(dbPath);
    expect((db.query("SELECT COUNT(*) AS count FROM mem_audit_log WHERE action = 'read.search'").get() as { count: number }).count).toBe(1);
    db.close();
  });

  test("failed search audit flush retries with bounded backoff and applies after lock release", async () => {
    const { client, dbPath, events } = makeClient({ busyTimeoutMs: 50, restartBackoffMs: 20 });
    expect(client.schedule("search_audit_flush")).toBe(true);
    await waitFor(() => events.some((event) =>
      event.kind === "completed" && event.task === "search_audit_flush"));
    events.length = 0;
    const spool = new SearchSideEffectSpool(dbPath);
    spool.append({
      audits: [{ action: "read.search", target_type: "project", target_id: "retry-project", details: { query: "fixture-query", limit: 1, include_private: false, count: 0, privacy_excluded_count: 0, boundary_excluded_count: 0 } }],
      access_count_ids: [],
      created_at: "2026-08-20T00:00:00.000Z",
    });
    spool.close();
    const lockDb = new Database(dbPath);
    configureDatabase(lockDb, { HARNESS_MEM_SQLITE_BUSY_TIMEOUT: "50" });
    try {
      lockDb.exec("BEGIN IMMEDIATE");
      expect(client.schedule("search_audit_flush")).toBe(true);
      await waitFor(() => events.some((event) =>
        event.kind === "failed" && event.task === "search_audit_flush"));
      lockDb.exec("COMMIT");
      await waitFor(() => events.some((event) =>
        event.kind === "completed" && event.task === "search_audit_flush" && event.intents_applied === 1));

      const audit = lockDb.query("SELECT COUNT(*) AS count FROM mem_audit_log WHERE action = 'read.search'").get() as { count: number };
      expect(audit.count).toBe(1);
      const attempts = events.filter((event) => event.task === "search_audit_flush");
      expect(attempts.some((event) => event.kind === "failed")).toBe(true);
      expect(attempts.some((event) => event.kind === "completed")).toBe(true);
    } finally {
      if (lockDb.inTransaction) lockDb.exec("ROLLBACK");
      lockDb.close();
    }
  });

  test("a captured audit flush run retains its finish time across more than 32 successors", async () => {
    const { client, events } = makeClient({ blockMs: 10 });
    expect(client.schedule("search_audit_flush")).toBe(true);
    await waitFor(() => client.activeSearchAuditFlushRun() !== null);
    const captured = client.activeSearchAuditFlushRun()!;
    await waitFor(() => captured.finished_at_ms !== null);
    const finishedAt = captured.finished_at_ms;

    for (let index = 0; index < 33; index += 1) {
      const completedBefore = events.filter((event) =>
        event.kind === "completed" && event.task === "search_audit_flush").length;
      expect(client.schedule("search_audit_flush")).toBe(true);
      await waitFor(() => events.filter((event) =>
        event.kind === "completed" && event.task === "search_audit_flush").length > completedBefore);
    }

    expect(captured.finished_at_ms).toBe(finishedAt);
    expect(JSON.stringify(events)).not.toContain(captured.run_id);
  });

  test("literal tilde DB path is shared by search append and maintenance recovery", async () => {
    const home = mkdtempSync(join(tmpdir(), "harness-mem-search-tilde-home-"));
    dirs.push(home);
    const dbPath = join(home, "memory.db");
    const db = new Database(dbPath);
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    db.close();
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      NODE_ENV: "test",
      HARNESS_MEM_DB_PATH: "~/memory.db",
    };
    const search = new PersistentSearchWorkerClient({
      scriptPath: fileURLToPath(new URL("../../src/tools/search-worker.ts", import.meta.url)),
      cwd: join(import.meta.dir, "../.."),
      env,
      maxPending: 1,
      dbPath,
    });
    try {
      const result = await search.request({
        query: "tilde-path-audit",
        project: home,
        limit: 1,
        vector_search: false,
        strict_project: true,
      }, 3_000);
      expect(result.response.ok).toBe(true);
      expect(result.side_effect_intents_pending).toBe(1);
    } finally {
      await search.stop("tilde-fixture");
    }

    const events: Array<Record<string, unknown>> = [];
    const maintenance = new BackgroundMaintenanceWorkerClient({
      scriptPath: fileURLToPath(new URL("../../src/tools/background-maintenance-worker.ts", import.meta.url)),
      cwd: join(import.meta.dir, "../.."),
      env,
      dbPath,
      busyLogMs: 10,
      consolidationTimeoutMs: 5_000,
      onProgress: (event) => events.push(event),
    });
    clients.push(maintenance);
    expect(maintenance.schedule("search_audit_flush")).toBe(true);
    await waitFor(() => events.some((event) =>
      event.kind === "completed" && event.task === "search_audit_flush" && event.intents_applied === 1));
    const verify = new Database(dbPath, { readonly: true });
    expect((verify.query("SELECT COUNT(*) AS count FROM mem_audit_log WHERE action = 'read.search'").get() as { count: number }).count).toBe(1);
    verify.close();
  });

  test("commit-time autocheckpoint remains the primary 1000-page WAL bound", () => {
    const db = new Database(":memory:");
    configureDatabase(db, {});
    expect(db.query<{ wal_autocheckpoint: number }, []>("PRAGMA wal_autocheckpoint").get()?.wal_autocheckpoint).toBe(1000);
    db.close();
  });

  test("physical WAL allocation alone never creates a checkpoint retry loop", () => {
    expect(shouldRetryWalCheckpoint({
      kind: "completed",
      task: "wal_checkpoint",
      queue_depth: 0,
      busy: 0,
      log: 0,
      checkpointed: 0,
      wal_bytes_after: 64 * 1024 * 1024,
      wal_limit_bytes: 1,
      wal_above_limit: true,
    })).toBe(false);
    expect(shouldRetryWalCheckpoint({
      kind: "completed",
      task: "wal_checkpoint",
      queue_depth: 0,
      busy: 1,
      log: 4,
      checkpointed: 2,
    })).toBe(true);
  });

  test("scheduler is pending-only and duplicate pending session work coalesces", async () => {
    const db = new Database(":memory:");
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    const now = new Date().toISOString();
    db.query(`INSERT INTO mem_sessions(session_id, project, platform, started_at, created_at, updated_at)
      VALUES ('scheduler-session', 'scheduler-project', 'claude', ?, ?, ?)`).run(now, now, now);
    enqueueConsolidationJob(db, "scheduler-project", "scheduler-session", "checkpoint");
    enqueueConsolidationJob(db, "scheduler-project", "scheduler-session", "checkpoint");
    expect(db.query<{ count: number }, []>(
      `SELECT COUNT(*) AS count FROM mem_consolidation_queue WHERE status = 'pending'`,
    ).get()?.count).toBe(1);

    db.exec(`UPDATE mem_consolidation_queue SET status = 'running' WHERE status = 'pending'`);
    enqueueConsolidationJob(db, "scheduler-project", "scheduler-session", "checkpoint");
    enqueueConsolidationJob(db, "scheduler-project", "scheduler-session", "checkpoint");
    enqueueConsolidationJob(db, "scheduler-project", "scheduler-session", "distinct-reason");
    expect(db.query<{ reason: string; count: number }, []>(
      `SELECT reason, COUNT(*) AS count FROM mem_consolidation_queue
       WHERE status = 'pending' GROUP BY reason ORDER BY reason`,
    ).all()).toEqual([
      { reason: "checkpoint", count: 1 },
      { reason: "distinct-reason", count: 1 },
    ]);
    db.exec(`DELETE FROM mem_consolidation_queue WHERE status = 'pending' AND reason = 'distinct-reason'`);
    db.exec(`UPDATE mem_consolidation_queue SET status = 'failed' WHERE status = 'running'`);

    expect((await runConsolidationOnce(db, { reason: "scheduler", limit: 1 })).jobs_processed).toBe(1);
    expect((await runConsolidationOnce(db, { reason: "scheduler", limit: 1 })).jobs_processed).toBe(0);
    db.close();
  });

  test("pending coalesce migration is deterministic and enforced across two connections", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-consolidation-unique-"));
    dirs.push(dir);
    const dbPath = join(dir, "unique.db");
    const first = new Database(dbPath);
    configureDatabase(first);
    first.exec(`
      CREATE TABLE mem_consolidation_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        session_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT
      );
      INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at)
      VALUES
        ('race-project', 'race-session', 'checkpoint', 'pending', '2026-01-01T00:00:00Z'),
        ('race-project', 'race-session', 'checkpoint', 'pending', '2026-01-02T00:00:00Z'),
        ('race-project', 'race-session', 'checkpoint', 'completed', '2026-01-03T00:00:00Z');
    `);
    initSchema(first);
    migrateSchema(first);
    const migrated = first.query<{ id: number; status: string }, []>(
      `SELECT id, status FROM mem_consolidation_queue ORDER BY id`,
    ).all();
    expect(migrated).toEqual([{ id: 1, status: "pending" }, { id: 3, status: "completed" }]);
    const indexSql = first.query<{ sql: string }, []>(
      `SELECT sql FROM sqlite_master WHERE name = 'idx_mem_consolidation_queue_pending_unique'`,
    ).get()?.sql ?? "";
    expect(indexSql).toContain("UNIQUE INDEX");
    expect(indexSql).toContain("WHERE status = 'pending'");

    const second = new Database(dbPath);
    configureDatabase(second);
    enqueueConsolidationJob(first, "two-connection", "same-session", "checkpoint");
    enqueueConsolidationJob(second, "two-connection", "same-session", "checkpoint");
    expect(first.query<{ count: number }, []>(
      `SELECT COUNT(*) AS count FROM mem_consolidation_queue
       WHERE project = 'two-connection' AND session_id = 'same-session' AND reason = 'checkpoint' AND status = 'pending'`,
    ).get()?.count).toBe(1);
    first.exec(`UPDATE mem_consolidation_queue SET status = 'running'
      WHERE project = 'two-connection' AND session_id = 'same-session' AND reason = 'checkpoint'`);
    enqueueConsolidationJob(second, "two-connection", "same-session", "checkpoint");
    enqueueConsolidationJob(first, "two-connection", "same-session", "checkpoint");
    expect(first.query<{ status: string; count: number }, []>(
      `SELECT status, COUNT(*) AS count FROM mem_consolidation_queue
       WHERE project = 'two-connection' AND session_id = 'same-session' AND reason = 'checkpoint'
       GROUP BY status ORDER BY status`,
    ).all()).toEqual([{ status: "pending", count: 1 }, { status: "running", count: 1 }]);
    second.close();
    first.close();
  });

  test("scheduler scans only observations without facts and skips unchanged relation maintenance", async () => {
    const db = new Database(":memory:");
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    const now = new Date().toISOString();
    db.query(`INSERT INTO mem_sessions(session_id, project, platform, started_at, created_at, updated_at)
      VALUES ('unchanged-session', 'unchanged-project', 'claude', ?, ?, ?)`).run(now, now, now);
    for (let index = 0; index < 2; index += 1) {
      const observationId = `unchanged-observation-${index}`;
      const eventId = `unchanged-event-${index}`;
      db.query(`INSERT INTO mem_events(event_id, platform, project, session_id, event_type, ts, payload_json, metadata_json, tags_json, privacy_tags_json, dedupe_hash, created_at)
        VALUES (?, 'claude', 'unchanged-project', 'unchanged-session', 'checkpoint', ?, '{}', '{}', '[]', '[]', ?, ?)`)
        .run(eventId, now, eventId, now);
      db.query(`INSERT INTO mem_observations(id, event_id, platform, project, session_id, title, content, content_redacted, observation_type, tags_json, privacy_tags_json, created_at, updated_at)
        VALUES (?, ?, 'claude', 'unchanged-project', 'unchanged-session', '', 'already materialized', 'already materialized', 'decision', '[]', '[]', ?, ?)`)
        .run(observationId, eventId, now, now);
      db.query(`INSERT INTO mem_facts(fact_id, observation_id, project, session_id, fact_type, fact_key, fact_value, created_at, updated_at)
        VALUES (?, ?, 'unchanged-project', 'unchanged-session', 'decision', ?, ?, ?, ?)`)
        .run(`unchanged-fact-${index}`, observationId, index === 0 ? "alpha shared" : "beta shared", index === 0 ? "one" : "two", now, now);
    }
    enqueueConsolidationJob(db, "unchanged-project", "unchanged-session", "checkpoint");

    const scheduler = await runConsolidationOnce(db, { reason: "scheduler", limit: 1 });
    expect(scheduler).toMatchObject({ jobs_processed: 1, facts_extracted: 0, observations_scanned: 0 });
    expect(db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM mem_links WHERE relation = 'derives'`).get()?.count).toBe(0);

    const manual = await runConsolidationOnce(db, {
      reason: "manual",
      project: "unchanged-project",
      session_id: "unchanged-session",
    });
    expect(manual.observations_scanned).toBe(2);
    expect(db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM mem_links WHERE relation = 'derives'`).get()?.count).toBe(2);
    db.close();
  });

  test("indexed unchanged scheduler scan stays bounded at task scale", async () => {
    const db = new Database(":memory:");
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    const now = new Date().toISOString();
    db.query(`INSERT INTO mem_sessions(session_id, project, platform, started_at, created_at, updated_at)
      VALUES ('scale-session', 'scale-project', 'claude', ?, ?, ?)`).run(now, now, now);
    db.exec(`
      WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 5000)
      INSERT INTO mem_observations(
        id, event_id, platform, project, session_id, title, content, content_redacted,
        observation_type, tags_json, privacy_tags_json, created_at, updated_at
      )
      SELECT 'scale-observation-' || value, NULL, 'claude', 'scale-project', 'scale-session', '',
             'already materialized', 'already materialized', 'decision', '[]', '[]', '${now}', '${now}'
      FROM n;
      INSERT INTO mem_facts(
        fact_id, observation_id, project, session_id, fact_type, fact_key, fact_value, created_at, updated_at
      )
      SELECT 'scale-fact-' || substr(id, length('scale-observation-') + 1), id,
             'scale-project', 'scale-session', 'decision', 'key', 'value', '${now}', '${now}'
      FROM mem_observations WHERE project = 'scale-project';
    `);
    enqueueConsolidationJob(db, "scale-project", "scale-session", "checkpoint");
    const previousMode = process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE;
    process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE = "llm";
    const startedAt = performance.now();
    let result: Awaited<ReturnType<typeof runConsolidationOnce>>;
    try {
      result = await runConsolidationOnce(db, { reason: "scheduler", limit: 1 });
    } finally {
      if (previousMode === undefined) delete process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE;
      else process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE = previousMode;
    }
    const elapsedMs = performance.now() - startedAt;
    expect(result).toMatchObject({
      jobs_processed: 1,
      observations_scanned: 0,
      existing_facts_scanned: 0,
      facts_extracted: 0,
    });
    expect(elapsedMs).toBeLessThan(250);
    const plan = db.query<{ detail: string }, []>(`
      EXPLAIN QUERY PLAN
      SELECT 1 FROM mem_observations o
      WHERE o.project = 'scale-project' AND o.session_id = 'scale-session'
        AND NOT EXISTS (SELECT 1 FROM mem_facts existing WHERE existing.observation_id = o.id)
    `).all().map((row) => row.detail).join(" ");
    expect(plan).toContain("idx_mem_facts_observation_active");
    db.close();
  });

  test("timer scheduler delegates both synchronous maintenance lanes out of the daemon", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/core/ingest-coordinator.ts", import.meta.url)),
      "utf8",
    );
    const startTimers = source.slice(source.indexOf("startTimers(): void"), source.indexOf("stopTimers(): void"));
    expect(startTimers).toContain('scheduleMaintenance?.("consolidation")');
    expect(startTimers).toContain('scheduleMaintenance?.("wal_checkpoint")');
    expect(startTimers).not.toContain("PRAGMA wal_checkpoint");
    expect(startTimers).not.toContain("runConsolidation(");
    const daemonEntry = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
    expect(daemonEntry).toContain('new URL("./tools/background-maintenance-worker.ts"');
    expect(daemonEntry.match(/recoverOrphanedSearchWorkers/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("each lane is single-flight, coalesces timer ticks, and reports bounded progress", async () => {
    const { client, events } = makeClient({ blockMs: 200 });
    expect(client.schedule("wal_checkpoint")).toBe(true);
    await waitFor(() => client.activeTask() === "wal_checkpoint");
    expect(client.schedule("wal_checkpoint")).toBe(false);
    await waitFor(() => client.activeTask() === null && events.some((event) => event.kind === "completed"));
    expect(events.some((event) => event.task === "wal_checkpoint")).toBe(true);
    expect(events.map(Object.keys).flat()).not.toContain("db_path");
  });

  test("scheduler consolidation advances one queued job per tick to bound same-DB contention", async () => {
    const { client, dbPath, events } = makeClient();
    const db = new Database(dbPath);
    const requestedAt = new Date().toISOString();
    for (let index = 0; index < 3; index += 1) {
      db.query(`INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at)
        VALUES (?, ?, 'scheduler', 'pending', ?)`)
        .run(`bounded-project-${index}`, `bounded-session-${index}`, requestedAt);
    }
    db.close();

    expect(client.schedule("consolidation")).toBe(true);
    await waitFor(() => events.some((event) => event.kind === "completed" && event.task === "consolidation"));

    const verify = new Database(dbPath, { readonly: true });
    const counts = verify.query<{ status: string; count: number }, []>(
      `SELECT status, COUNT(*) AS count FROM mem_consolidation_queue GROUP BY status`,
    ).all();
    verify.close();
    expect(Object.fromEntries(counts.map((row) => [row.status, row.count]))).toEqual({ completed: 1, pending: 2 });
    expect(events.find((event) => event.kind === "completed" && event.task === "consolidation"))
      .toMatchObject({ jobs_processed: 1, pending_jobs: 2 });
  });

  test("consolidation worker restart marks an abandoned running queue job failed", async () => {
    const { client, dbPath } = makeClient();
    const db = new Database(dbPath);
    db.query(`INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at, started_at)
      VALUES ('owned-project', 'owned-session', 'scheduler', 'running', ?, ?)`)
      .run(new Date().toISOString(), new Date().toISOString());
    db.close();

    expect(client.schedule("consolidation")).toBe(true);
    await waitFor(() => client.activeTask() === null);
    const verify = new Database(dbPath, { readonly: true });
    const row = verify.query<{ status: string; error: string }, []>(
      `SELECT status, error FROM mem_consolidation_queue WHERE project = 'owned-project'`,
    ).get();
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("maintenance worker restarted");
    verify.close();
  });

  test("checkpoint progress exposes PASSIVE result and a privacy-safe WAL size ceiling", async () => {
    const { client, dbPath, events } = makeClient({ walMaxBytes: 1 });
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode=WAL");
    db.query("INSERT INTO mem_meta(key, value, updated_at) VALUES ('wal-test', 'x', ?)")
      .run(new Date().toISOString());
    db.close();
    client.schedule("wal_checkpoint");
    await waitFor(() => events.some((event) => event.kind === "completed"));
    const event = events.find((candidate) => candidate.kind === "completed")!;
    expect(event.task).toBe("wal_checkpoint");
    expect(event.wal_limit_bytes).toBe(1);
    expect(typeof event.busy).toBe("number");
    expect(typeof event.checkpointed).toBe("number");
    expect(JSON.stringify(event)).not.toMatch(/db_path|project|session|content|secret/i);
  });

  test("manual requests remain FIFO and a queued checkpoint runs before the next manual request", async () => {
    const { client, events } = makeClient({ blockMs: 100 });
    const first = client.runConsolidation({ reason: "manual", project: "p1", session_id: "s1" });
    await waitFor(() => client.activeTask() === "consolidation");
    const second = client.runConsolidation({ reason: "manual", project: "p2", session_id: "s2" });
    expect(client.schedule("wal_checkpoint")).toBe(true);
    await Promise.all([first, second]);
    await waitFor(() => client.activeTask() === null && client.pendingTasks().length === 0);
    const completed = events.filter((event) => event.kind === "completed").map((event) => event.task);
    expect(completed).toEqual(["consolidation", "wal_checkpoint", "consolidation"]);
  });

  test("a real worker SQLite stall does not block daemon HTTP readiness or search", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-maintenance-http-"));
    dirs.push(dir);
    const previousBlock = process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS;
    process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS = "1000";
    const config = {
      ...getConfig(),
      dbPath: join(dir, "http.db"),
      bindPort: 0,
      backgroundWorkersEnabled: true,
      codexIngestEnabled: false,
      opencodeIngestEnabled: false,
      cursorIngestEnabled: false,
      antigravityIngestEnabled: false,
      geminiIngestEnabled: false,
      claudeCodeIngestEnabled: false,
    };
    const parent = new HarnessMemCore(config);
    const server = startHarnessMemServer(parent, config);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const run = fetch(`${baseUrl}/v1/admin/consolidation/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "worker-isolation", project: "p", session_id: "s" }),
      });
      const internals = parent as unknown as {
        backgroundMaintenanceWorker: BackgroundMaintenanceWorkerClient | null;
      };
      await waitFor(() => internals.backgroundMaintenanceWorker?.activeTask() === "consolidation");
      const startedAt = performance.now();
      const [ready, search] = await Promise.all([
        fetch(`${baseUrl}/health/ready`),
        fetch(`${baseUrl}/v1/search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "missing", project: "worker-isolation", safe_mode: true }),
        }),
      ]);
      expect(ready.status).toBe(200);
      expect(search.status).toBe(200);
      expect(performance.now() - startedAt).toBeLessThan(250);
      expect((await run).status).toBe(200);
    } finally {
      server.stop(true);
      await parent.shutdown("test");
      if (previousBlock === undefined) delete process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS;
      else process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS = previousBlock;
    }
  });

  test("audit spool backpressure returns privacy-safe HTTP 503", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-search-audit-http-"));
    dirs.push(dir);
    const dbPath = join(dir, "http.db");
    const bootstrap = new HarnessMemCore(createTestConfig({ dbPath, backgroundWorkersEnabled: false }));
    await bootstrap.shutdown("bootstrap");
    const spool = new SearchSideEffectSpool(dbPath, 100);
    for (let index = 0; index < 100; index += 1) {
      spool.append({
        audits: [{ action: "read.search", target_type: "project", target_id: "fixture", details: { query: "fixture-query", limit: 1, include_private: false, count: 0, privacy_excluded_count: 0, boundary_excluded_count: 0 } }],
        access_count_ids: [],
        created_at: "2026-08-20T00:00:00.000Z",
      });
    }
    spool.close();

    const previousWorkerMarker = process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS;
    const previousMax = process.env.HARNESS_MEM_SEARCH_AUDIT_SPOOL_MAX;
    process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS = "1";
    process.env.HARNESS_MEM_SEARCH_AUDIT_SPOOL_MAX = "100";
    const config = createTestConfig({ dbPath, bindPort: 0, backgroundWorkersEnabled: false });
    const core = new HarnessMemCore(config);
    const server = startHarnessMemServer(core, config);
    const privateQuery = "private-http-backpressure-query";
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: privateQuery, project: dir, limit: 1, vector_search: false }),
      });
      expect(response.status).toBe(503);
      const body = await response.json() as { error?: string; meta?: Record<string, unknown> };
      expect(body.error).toBe("search audit temporarily unavailable");
      expect(body.meta?.error_code).toBe("audit_backpressure");
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(privateQuery);
      expect(serialized).not.toContain(dir);
      expect(serialized).not.toContain(dbPath);
    } finally {
      server.stop(true);
      await core.shutdown("test");
      if (previousWorkerMarker === undefined) delete process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS;
      else process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS = previousWorkerMarker;
      if (previousMax === undefined) delete process.env.HARNESS_MEM_SEARCH_AUDIT_SPOOL_MAX;
      else process.env.HARNESS_MEM_SEARCH_AUDIT_SPOOL_MAX = previousMax;
    }
  });

  test("actual HTTP cache miss attributes a synchronous spool stall to fixed privacy-safe phases", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-search-phase-http-"));
    dirs.push(dir);
    const dbPath = join(dir, "phase.db");
    const bootstrap = new HarnessMemCore(createTestConfig({ dbPath, backgroundWorkersEnabled: false }));
    bootstrap.recordEvent({
      event_id: "phase-event",
      platform: "codex",
      project: dir,
      session_id: "phase-session",
      event_type: "user_prompt",
      ts: "2026-08-20T00:00:00.000Z",
      payload: { content: "private phase timing target" },
      tags: [],
      privacy_tags: [],
    });
    await bootstrap.shutdown("bootstrap");

    const previousOffload = process.env.HARNESS_MEM_SEARCH_OFFLOAD;
    const previousWorker = process.env.HARNESS_MEM_SEARCH_WORKER;
    const previousDelay = process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS;
    process.env.HARNESS_MEM_SEARCH_OFFLOAD = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER = "1";
    process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS = "300";
    const config = createTestConfig({ dbPath, bindPort: 0, backgroundWorkersEnabled: false });
    const core = new HarnessMemCore(config);
    const server = startHarnessMemServer(core, config);
    const privateQuery = "private phase timing target";
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: privateQuery, project: dir, limit: 1, vector_search: false, strict_project: true }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json() as { meta: { search_phase_timing?: Record<string, unknown> } };
      const timing = payload.meta.search_phase_timing!;
      expect(Object.keys(timing).sort()).toEqual([
        "audit_flush_active_at_search_start",
        "audit_flush_overlap_elapsed_ms",
        "audit_intent_build_ms",
        "fact_load_ms",
        "facts_tags_ms",
        "latest_interaction_materialize_ms",
        "latest_interaction_ms",
        "latest_interaction_sql_ms",
        "lexical_candidate_ms",
        "lexical_fallback_executed",
        "lexical_rows_examined",
        "lexical_score_ms",
        "lexical_sql_fallback_ms",
        "lexical_sql_primary_ms",
        "lexical_strategy",
        "lexical_tokenize_ms",
        "load_hydrate_ms",
        "privacy_boundary_ms",
        "ranking_rerank_ms",
        "retrieval_total_ms",
        "retrieval_unattributed_ms",
        "route_ms",
        "scope_resolution_ms",
        "search_tokenize_ms",
        "spool_append_commit_complete",
        "spool_append_commit_ms",
        "tag_fact_scoring_ms",
        "total_ms",
        "vector_executed",
        "vector_ms",
        "watermark_cache_lookup_ms",
        "worker_total_ms",
      ]);
      expect(timing.spool_append_commit_ms).toBeGreaterThanOrEqual(250);
      expect(timing.spool_append_commit_complete).toBe(true);
      expect(timing.retrieval_total_ms).toBeLessThan(200);
      expect(timing.worker_total_ms).toBeGreaterThanOrEqual(timing.spool_append_commit_ms as number);
      expect(timing.total_ms).toBeGreaterThanOrEqual(timing.worker_total_ms as number);
      expect(timing.audit_flush_active_at_search_start).toBe(false);
      expect(timing.audit_flush_overlap_elapsed_ms).toBe(0);
      expect(JSON.stringify(timing)).not.toContain(privateQuery);
      expect(JSON.stringify(timing)).not.toContain(dir);
      expect(JSON.stringify(timing)).not.toContain("phase-session");
    } finally {
      server.stop(true);
      await core.shutdown("test");
      if (previousOffload === undefined) delete process.env.HARNESS_MEM_SEARCH_OFFLOAD;
      else process.env.HARNESS_MEM_SEARCH_OFFLOAD = previousOffload;
      if (previousWorker === undefined) delete process.env.HARNESS_MEM_SEARCH_WORKER;
      else process.env.HARNESS_MEM_SEARCH_WORKER = previousWorker;
      if (previousDelay === undefined) delete process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS;
      else process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS = previousDelay;
    }
  });

  test("actual worker timeout preserves privacy-safe in-progress spool attribution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-search-phase-timeout-"));
    dirs.push(dir);
    const dbPath = join(dir, "phase-timeout.db");
    const bootstrap = new HarnessMemCore(createTestConfig({ dbPath, backgroundWorkersEnabled: false }));
    await bootstrap.shutdown("bootstrap");

    const previousOffload = process.env.HARNESS_MEM_SEARCH_OFFLOAD;
    const previousWorker = process.env.HARNESS_MEM_SEARCH_WORKER;
    const previousTimeout = process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS;
    const previousDelay = process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS;
    const previousDelayAfter = process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_DELAY_AFTER_COUNT;
    process.env.HARNESS_MEM_SEARCH_OFFLOAD = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS = "250";
    process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS = "600";
    process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_DELAY_AFTER_COUNT = "1";
    const config = createTestConfig({ dbPath, bindPort: 0, backgroundWorkersEnabled: false });
    const core = new HarnessMemCore(config);
    const server = startHarnessMemServer(core, config);
    const privateQuery = "private timeout phase target";
    try {
      const warm = await fetch(`http://127.0.0.1:${server.port}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "phase warmup miss", project: dir, limit: 1, vector_search: false, strict_project: true }),
      });
      expect(warm.status).toBe(200);
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: privateQuery, project: dir, limit: 1, vector_search: false, strict_project: true }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json() as { meta: { search_phase_timing?: Record<string, unknown> } };
      const timing = payload.meta.search_phase_timing!;
      expect(typeof timing.retrieval_total_ms).toBe("number");
      const retrievalBreakdownKeys = [
        "scope_resolution_ms",
        "latest_interaction_ms",
        "lexical_candidate_ms",
        "vector_ms",
        "load_hydrate_ms",
        "facts_tags_ms",
        "route_ms",
        "ranking_rerank_ms",
        "privacy_boundary_ms",
        "audit_intent_build_ms",
      ] as const;
      for (const key of retrievalBreakdownKeys) {
        expect(timing[key]).toEqual(expect.any(Number));
      }
      expect(timing.lexical_strategy).toBe("bounded_recent");
      expect(timing.lexical_rows_examined).toEqual(expect.any(Number));
      expect(timing.lexical_fallback_executed).toBe(false);
      expect(timing.vector_executed).toBe(false);
      const attributedMs = retrievalBreakdownKeys.reduce((sum, key) => sum + Number(timing[key]), 0);
      expect(attributedMs + Number(timing.retrieval_unattributed_ms))
        .toBeGreaterThanOrEqual(Number(timing.retrieval_total_ms) - 0.1);
      expect(attributedMs).toBeLessThanOrEqual(Number(timing.retrieval_total_ms) + 0.1);
      expect(typeof timing.spool_append_commit_ms).toBe("number");
      expect(timing.spool_append_commit_complete).toBe(false);
      expect(timing.worker_total_ms).toBeNull();
      expect(typeof timing.total_ms).toBe("number");
      const spoolElapsedMs = Number(timing.spool_append_commit_ms);
      const totalElapsedMs = Number(timing.total_ms);
      expect(Number.isFinite(spoolElapsedMs)).toBe(true);
      expect(spoolElapsedMs).toBeGreaterThanOrEqual(150);
      expect(totalElapsedMs).toBeGreaterThanOrEqual(spoolElapsedMs);
      expect(JSON.stringify(timing)).not.toContain(privateQuery);
      expect(JSON.stringify(timing)).not.toContain(dir);
      expect(Object.keys(timing).some((key) =>
        /(query|project|path|session|hash|correlation)/i.test(key)
      )).toBe(false);
    } finally {
      server.stop(true);
      await core.shutdown("test");
      if (previousOffload === undefined) delete process.env.HARNESS_MEM_SEARCH_OFFLOAD;
      else process.env.HARNESS_MEM_SEARCH_OFFLOAD = previousOffload;
      if (previousWorker === undefined) delete process.env.HARNESS_MEM_SEARCH_WORKER;
      else process.env.HARNESS_MEM_SEARCH_WORKER = previousWorker;
      if (previousTimeout === undefined) delete process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS;
      else process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS = previousTimeout;
      if (previousDelay === undefined) delete process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS;
      else process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS = previousDelay;
      if (previousDelayAfter === undefined) delete process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_DELAY_AFTER_COUNT;
      else process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_DELAY_AFTER_COUNT = previousDelayAfter;
    }
  });

  test("audit flush overlap is bounded to the run active when search started", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-search-flush-overlap-"));
    dirs.push(dir);
    const dbPath = join(dir, "overlap.db");
    const bootstrap = new HarnessMemCore(createTestConfig({ dbPath, backgroundWorkersEnabled: false }));
    await bootstrap.shutdown("bootstrap");

    const previousOffload = process.env.HARNESS_MEM_SEARCH_OFFLOAD;
    const previousWorker = process.env.HARNESS_MEM_SEARCH_WORKER;
    const previousSearchDelay = process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS;
    const previousMaintenanceBlock = process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS;
    process.env.HARNESS_MEM_SEARCH_OFFLOAD = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER = "1";
    process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS = "600";
    process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS = "100";
    const config = createTestConfig({ dbPath, bindPort: 0, backgroundWorkersEnabled: false });
    const core = new HarnessMemCore(config);
    const server = startHarnessMemServer(core, config);
    try {
      const request = (query: string) => fetch(`http://127.0.0.1:${server.port}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, project: dir, limit: 1, vector_search: false, strict_project: true }),
      });
      expect((await request("overlap warmup miss")).status).toBe(200);
      const response = await request("overlap measured miss");
      expect(response.status).toBe(200);
      const payload = await response.json() as { meta: { search_phase_timing?: Record<string, unknown> } };
      const timing = payload.meta.search_phase_timing!;
      const overlapMs = Number(timing.audit_flush_overlap_elapsed_ms);
      const totalMs = Number(timing.total_ms);
      expect(timing.audit_flush_active_at_search_start).toBe(true);
      expect(overlapMs).toBeGreaterThanOrEqual(50);
      expect(overlapMs).toBeLessThan(500);
      expect(totalMs).toBeGreaterThanOrEqual(550);
      expect(overlapMs).toBeLessThan(totalMs - 100);
    } finally {
      server.stop(true);
      await core.shutdown("test");
      if (previousOffload === undefined) delete process.env.HARNESS_MEM_SEARCH_OFFLOAD;
      else process.env.HARNESS_MEM_SEARCH_OFFLOAD = previousOffload;
      if (previousWorker === undefined) delete process.env.HARNESS_MEM_SEARCH_WORKER;
      else process.env.HARNESS_MEM_SEARCH_WORKER = previousWorker;
      if (previousSearchDelay === undefined) delete process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS;
      else process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS = previousSearchDelay;
      if (previousMaintenanceBlock === undefined) delete process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS;
      else process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS = previousMaintenanceBlock;
    }
  });

  test("explicit runConsolidation still waits for and returns the complete API response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-maintenance-api-"));
    dirs.push(dir);
    const dbPath = join(dir, "api.db");
    const parent = new HarnessMemCore({
      ...getConfig(),
      dbPath,
      backgroundWorkersEnabled: true,
      codexIngestEnabled: false,
      opencodeIngestEnabled: false,
      cursorIngestEnabled: false,
      antigravityIngestEnabled: false,
      geminiIngestEnabled: false,
      claudeCodeIngestEnabled: false,
    });
    const response = await parent.runConsolidation({
      reason: "manual",
      project: "explicit-project",
      session_id: "explicit-session",
    });
    expect(response.ok).toBe(true);
    expect(response.items).toHaveLength(1);
    expect((response.items[0] as { reason?: string }).reason).toBe("manual");
    const internals = parent as unknown as {
      backgroundMaintenanceWorker: BackgroundMaintenanceWorkerClient | null;
    };
    expect(internals.backgroundMaintenanceWorker?.workerPid()).toBeNumber();
    await parent.shutdown("test");
  });

  test("maintenance child preserves the parent effective consolidation config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-maintenance-config-"));
    dirs.push(dir);
    const dbPath = join(dir, "config.db");
    const parent = new HarnessMemCore(createTestConfig({
      dbPath,
      backgroundWorkersEnabled: true,
      consolidationEnabled: false,
      vectorDimension: 128,
      backendMode: "local",
      codexIngestEnabled: false,
      opencodeIngestEnabled: false,
      cursorIngestEnabled: false,
      antigravityIngestEnabled: false,
      geminiIngestEnabled: false,
      claudeCodeIngestEnabled: false,
    }));
    try {
      const response = await parent.runConsolidation({ reason: "manual" });
      expect(response.ok).toBe(true);
      expect(response.items).toEqual([]);
      expect(response.meta.skipped).toBe("consolidation_disabled");
      const internals = parent as unknown as {
        backgroundMaintenanceWorker: BackgroundMaintenanceWorkerClient | null;
      };
      expect(internals.backgroundMaintenanceWorker).toBeNull();
    } finally {
      await parent.shutdown("test");
    }
  });

  test("explicit-config local scheduler consolidation remains single-flight and coalesces ticks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-maintenance-local-coalesce-"));
    dirs.push(dir);
    const parent = new HarnessMemCore(createTestConfig({
      dbPath: join(dir, "local.db"),
      backgroundWorkersEnabled: true,
      vectorDimension: 128,
      codexIngestEnabled: false,
      opencodeIngestEnabled: false,
      cursorIngestEnabled: false,
      antigravityIngestEnabled: false,
      geminiIngestEnabled: false,
      claudeCodeIngestEnabled: false,
    }));
    let calls = 0;
    let request: Record<string, unknown> | undefined;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const internals = parent as unknown as {
      scheduleMaintenance(task: "consolidation"): void;
      runConsolidationLocal(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      localSchedulerConsolidationRunning: boolean;
    };
    internals.runConsolidationLocal = async (input) => {
      calls += 1;
      request = input;
      await blocked;
      return {};
    };
    try {
      internals.scheduleMaintenance("consolidation");
      internals.scheduleMaintenance("consolidation");
      expect(calls).toBe(1);
      expect(request).toEqual({ reason: "scheduler", limit: 1 });
      release();
      await waitFor(() => !internals.localSchedulerConsolidationRunning);
      internals.scheduleMaintenance("consolidation");
      expect(calls).toBe(2);
    } finally {
      release();
      await parent.shutdown("test");
    }
  });

  test("local PASSIVE checkpoint uses the shared finite retry budget for persistent busy results", async () => {
    const previousBase = process.env.HARNESS_MEM_WAL_CHECKPOINT_RETRY_BASE_MS;
    const previousMax = process.env.HARNESS_MEM_WAL_CHECKPOINT_RETRY_MAX_ATTEMPTS;
    process.env.HARNESS_MEM_WAL_CHECKPOINT_RETRY_BASE_MS = "5";
    process.env.HARNESS_MEM_WAL_CHECKPOINT_RETRY_MAX_ATTEMPTS = "2";
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-maintenance-local-wal-"));
    dirs.push(dir);
    const parent = new HarnessMemCore(createTestConfig({
      dbPath: join(dir, "local-wal.db"),
      backgroundWorkersEnabled: true,
      vectorDimension: 128,
      consolidationEnabled: false,
      codexIngestEnabled: false,
      opencodeIngestEnabled: false,
      cursorIngestEnabled: false,
      antigravityIngestEnabled: false,
      geminiIngestEnabled: false,
      claudeCodeIngestEnabled: false,
    }));
    let calls = 0;
    const internals = parent as unknown as {
      scheduleMaintenance(task: "wal_checkpoint"): void;
      runMaintenanceWalCheckpoint(): Record<string, number | boolean | null>;
    };
    internals.runMaintenanceWalCheckpoint = () => {
      calls += 1;
      return { busy: 1, log: 4, checkpointed: 2 };
    };
    try {
      internals.scheduleMaintenance("wal_checkpoint");
      await waitFor(() => calls === 3);
      await Bun.sleep(50);
      expect(calls).toBe(3);
    } finally {
      await parent.shutdown("test");
      if (previousBase === undefined) delete process.env.HARNESS_MEM_WAL_CHECKPOINT_RETRY_BASE_MS;
      else process.env.HARNESS_MEM_WAL_CHECKPOINT_RETRY_BASE_MS = previousBase;
      if (previousMax === undefined) delete process.env.HARNESS_MEM_WAL_CHECKPOINT_RETRY_MAX_ATTEMPTS;
      else process.env.HARNESS_MEM_WAL_CHECKPOINT_RETRY_MAX_ATTEMPTS = previousMax;
    }
  });

  test("repeated synchronous spawn failures back off, disable, and do not starve timers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-maintenance-spawn-failure-"));
    dirs.push(dir);
    const dbPath = join(dir, "spawn.db");
    let attempts = 0;
    let heartbeats = 0;
    const timer = setInterval(() => { heartbeats += 1; }, 5);
    const events: Array<Record<string, unknown>> = [];
    const client = new BackgroundMaintenanceWorkerClient({
      scriptPath: "unused",
      cwd: dir,
      env: { ...process.env },
      dbPath,
      busyLogMs: 10,
      consolidationTimeoutMs: 5_000,
      restartBackoffMs: 20,
      maxConsecutiveStartFailures: 3,
      spawnWorker: () => {
        attempts += 1;
        throw new Error("synthetic spawn failure");
      },
      onProgress: (event) => events.push(event),
    });
    clients.push(client);
    try {
      expect(client.schedule("consolidation")).toBe(true);
      await waitFor(() => events.some((event) => event.error_code === "worker_disabled"));
      expect(attempts).toBe(3);
      expect(heartbeats).toBeGreaterThan(3);
      expect(client.schedule("consolidation")).toBe(false);
    } finally {
      clearInterval(timer);
    }
  });

  test("shutdown waits for TERM then KILL disappearance of a stalled child", async () => {
    const { client } = makeClient({ blockMs: 2_000, ignoreTerm: true });
    client.schedule("consolidation");
    await waitFor(() => client.workerPid() !== null);
    const pid = client.workerPid()!;
    await Bun.sleep(100);
    const startedAt = performance.now();
    await client.stop();
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("timed-out consolidation is killed and a queued checkpoint progresses after respawn", async () => {
    const { client, events } = makeClient({ blockMs: 2_000, timeoutMs: 100 });
    client.schedule("consolidation");
    await waitFor(() => client.activeTask() === "consolidation");
    const firstPid = client.workerPid();
    client.schedule("wal_checkpoint");
    await waitFor(
      () => events.some((event) => event.kind === "failed" && event.error_code === "timeout") &&
        events.some((event) => event.kind === "completed" && event.task === "wal_checkpoint"),
      8_000,
    );
    expect(client.workerPid()).not.toBe(firstPid);
  }, 10_000);
});
