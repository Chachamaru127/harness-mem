import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { PeriodicIngestWorkerClient } from "../../src/core/periodic-ingest-worker-client";
import { HarnessMemCore } from "../../src/core/harness-mem-core";
import { createTestConfig } from "./test-helpers";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";

const clients: PeriodicIngestWorkerClient[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createClient(options: {
  blockMs: number;
  busyLogMs?: number;
  errors?: string[];
  codexProjectRoot?: string;
  forceUnconfirmedStop?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-ingest-worker-"));
  dirs.push(dir);
  const dbPath = join(dir, "worker.db");
  const client = new PeriodicIngestWorkerClient({
    scriptPath: fileURLToPath(new URL("../../src/tools/periodic-ingest-worker.ts", import.meta.url)),
    cwd: join(import.meta.dir, "../.."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HARNESS_MEM_DB_PATH: dbPath,
      HARNESS_MEM_ENABLE_CODEX_INGEST: options.codexProjectRoot ? "1" : "0",
      HARNESS_MEM_CODEX_PROJECT_ROOT: options.codexProjectRoot,
      HARNESS_MEM_CODEX_SESSIONS_ROOT: join(dir, "empty-codex-sessions"),
      HARNESS_MEM_ENABLE_OPENCODE_INGEST: "0",
      HARNESS_MEM_ENABLE_CURSOR_INGEST: "0",
      HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST: "0",
      HARNESS_MEM_ENABLE_GEMINI_INGEST: "0",
      HARNESS_MEM_ENABLE_CLAUDE_CODE_INGEST: "0",
      HARNESS_MEM_TEST_INGEST_WORKER_BLOCK_MS: String(options.blockMs),
    },
    busyLogMs: options.busyLogMs ?? 1_000,
    onError: (_source, reason) => options.errors?.push(reason),
    stopOwnedProcess: options.forceUnconfirmedStop
      ? async () => ({ status: "still_running" as const, forced: true, reason: "test" })
      : undefined,
  });
  clients.push(client);
  return { client, dbPath };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await Bun.sleep(10);
  }
}

describe("periodic ingest persistent worker", () => {
  test("forwards only schema-checked privacy-safe SQLite telemetry", () => {
    const { client } = createClient({ blockMs: 0 });
    const internals = client as unknown as { forwardSafeTelemetryLine: (line: string) => void };
    const originalWarn = console.warn;
    const lines: string[] = [];
    console.warn = (line?: unknown) => { lines.push(String(line)); };
    try {
      internals.forwardSafeTelemetryLine('[sqlite-perf] {"kind":"slow_ingest_tick","source":"codex"}');
      internals.forwardSafeTelemetryLine('[sqlite-perf] {"kind":"slow_ingest_tick","source":"codex","tick_id":"forbidden","tick_correlation":"forbidden","nonce":"forbidden","sequence":9}');
      internals.forwardSafeTelemetryLine('[event] /private/path secret content');
      internals.forwardSafeTelemetryLine('[sqlite-perf] {"kind":"slow_ingest_tick","path":"/private/path"}');
    } finally {
      console.warn = originalWarn;
    }
    expect(lines).toEqual(['[sqlite-perf] {"kind":"slow_ingest_tick","source":"codex"}']);
    expect(lines.join("\n")).not.toMatch(/tick_id|correlation|nonce|sequence/);
  });

  test("a synchronous SQLite-lane stall does not block the daemon event loop", async () => {
    const { client, dbPath } = createClient({ blockMs: 2_000 });
    const core = new HarnessMemCore(createTestConfig({ dbPath, backgroundWorkersEnabled: false }));
    expect(client.schedule("codex")).toBe(true);
    await waitFor(() => client.activeSource() === "codex");

    const startedAt = performance.now();
    expect(core.readiness().ok).toBe(true);
    expect(core.search({ query: "missing", project: "worker-isolation", safe_mode: true }).ok).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(client.activeSource()).toBe("codex");
    await core.shutdown("test");
  });

  test("serializes sources, coalesces duplicates, and preserves FIFO fairness", async () => {
    const { client } = createClient({ blockMs: 100 });
    expect(client.schedule("codex")).toBe(true);
    expect(client.schedule("cursor")).toBe(true);
    expect(client.schedule("gemini")).toBe(true);
    expect(client.schedule("cursor")).toBe(false);
    expect(client.pendingSources()).toEqual(["cursor", "gemini"]);

    await waitFor(() => client.activeSource() === null && client.pendingSources().length === 0);
  });

  test("a stall beyond the former timeout finishes in the same worker and drains FIFO", async () => {
    const errors: string[] = [];
    const sourceRoot = mkdtempSync(join(tmpdir(), "harness-mem-ingest-source-"));
    dirs.push(sourceRoot);
    const codexDir = join(sourceRoot, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const historyPath = join(codexDir, "history.jsonl");
    writeFileSync(historyPath, `${JSON.stringify({
      role: "user",
      session_id: "synthetic-session",
      ts: "2026-08-19T00:00:00.000Z",
      content: "synthetic progress proof",
    })}\n`);
    const { client, dbPath } = createClient({ blockMs: 1_200, errors, codexProjectRoot: sourceRoot });
    const scaleDb = new Database(dbPath);
    configureDatabase(scaleDb);
    initSchema(scaleDb);
    migrateSchema(scaleDb);
    const now = "2026-08-19T00:00:00.000Z";
    scaleDb.query(`
      INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
      VALUES ('scale-session', 'test', 'scale-project', ?, ?, ?)
    `).run(now, now, now);
    const insertScaleRow = scaleDb.query(`
      INSERT INTO mem_observations(
        id, platform, project, session_id, content, content_redacted,
        content_dedupe_hash, tags_json, privacy_tags_json, created_at, updated_at
      ) VALUES (?, 'test', 'scale-project', 'scale-session', ?, ?, ?, '[]', '[]', ?, ?)
    `);
    const seedLargeDb = scaleDb.transaction(() => {
      for (let index = 0; index < 20_000; index += 1) {
        const content = `scale-${index}-${"x".repeat(768)}`;
        insertScaleRow.run(`scale-observation-${index}`, content, content, `scale-hash-${index}`, now, now);
      }
    });
    seedLargeDb();
    const plan = scaleDb.query<{ detail: string }, [string]>(`
      EXPLAIN QUERY PLAN SELECT id FROM mem_observations
      WHERE content_dedupe_hash = ? AND archived_at IS NULL LIMIT 1
    `).all("scale-hash-19999");
    expect(plan.some((row) => row.detail.includes("idx_mem_obs_content_dedupe_hash"))).toBe(true);
    scaleDb.close();
    expect(statSync(dbPath).size).toBeGreaterThan(10 * 1024 * 1024);

    const parentCore = new HarnessMemCore(createTestConfig({ dbPath, backgroundWorkersEnabled: false }));
    client.schedule("codex");
    await waitFor(() => client.workerPid() !== null);
    const workerPid = client.workerPid()!;
    client.schedule("cursor");
    const responseStartedAt = performance.now();
    expect(parentCore.readiness().ok).toBe(true);
    expect(parentCore.search({ query: "missing", project: "scale-project", safe_mode: true }).ok).toBe(true);
    expect(performance.now() - responseStartedAt).toBeLessThan(250);
    await waitFor(() => client.activeSource() === "cursor", 10_000);
    expect(client.workerPid()).toBe(workerPid);
    await waitFor(() => client.activeSource() === null, 10_000);
    expect(errors).toEqual([]);
    const verifyDb = new Database(dbPath, { readonly: true });
    const offset = verifyDb.query<{ offset: number }, [string]>(
      "SELECT offset FROM mem_ingest_offsets WHERE source_key = ?",
    ).get(`codex_history:${sourceRoot}`);
    expect(offset?.offset).toBe(statSync(historyPath).size);
    verifyDb.close();
    await parentCore.shutdown("scale-test");
  });

  test("shutdown leaves no periodic ingest worker process behind", async () => {
    const { client } = createClient({ blockMs: 2_000 });
    client.schedule("codex");
    await waitFor(() => client.workerPid() !== null);
    const pid = client.workerPid()!;
    await Bun.sleep(100);
    expect(client.activeSource()).toBe("codex");
    await client.stop();
    await waitFor(() => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    }, 2_000);
  });

  test("coalesced ticks emit bounded busy age and queue depth telemetry", async () => {
    const { client } = createClient({ blockMs: 500, busyLogMs: 10 });
    client.schedule("codex");
    await waitFor(() => client.activeSource() === "codex");
    await Bun.sleep(20);
    const originalWarn = console.warn;
    const lines: string[] = [];
    console.warn = (line?: unknown) => { lines.push(String(line)); };
    try {
      expect(client.schedule("codex")).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"kind":"busy"');
    expect(lines[0]).toContain('"queue_depth":0');
  });

  test("unconfirmed lifecycle stop retains the handle until the child exits", async () => {
    const { client } = createClient({ blockMs: 2_000, forceUnconfirmedStop: true });
    client.schedule("codex");
    await waitFor(() => client.workerPid() !== null);
    const pid = client.workerPid()!;
    await Bun.sleep(100);
    const startedAt = performance.now();
    await client.stop();
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(200);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(client.activeSource()).toBe(null);
  });
});
