import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

const childFlags = [
  "HARNESS_MEM_SEARCH_CHILD_PROCESS", "HARNESS_MEM_SEARCH_WORKER_PROCESS",
  "HARNESS_MEM_INGEST_WORKER_PROCESS", "HARNESS_MEM_BACKGROUND_MAINTENANCE_WORKER_PROCESS",
  "HARNESS_MEM_CHECKPOINT_CHILD_PROCESS", "HARNESS_MEM_EVENT_CHILD_PROCESS",
  "HARNESS_MEM_RETRY_CHILD_PROCESS", "HARNESS_MEM_PROJECTS_STATS_CHILD_PROCESS",
  "HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD", "HARNESS_MEM_VECTOR_BACKFILL_CHILD",
  "HARNESS_MEM_OBSERVATION_MATERIALIZE_CHILD",
];

test("every lightweight child leaves the parent's backfill running; explicit stop and parent shutdown persist stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-backfill-owner-"));
  const config: Config = {
    dbPath: join(root, "memory.db"), bindHost: "127.0.0.1", bindPort: 0,
    vectorDimension: 64, embeddingProvider: "fallback", captureEnabled: true,
    retrievalEnabled: true, injectionEnabled: true, codexHistoryEnabled: false,
    codexProjectRoot: root, codexSessionsRoot: root, codexIngestIntervalMs: 5000,
    codexBackfillHours: 24, opencodeIngestEnabled: false, cursorIngestEnabled: false,
    antigravityIngestEnabled: false, geminiIngestEnabled: false,
    claudeCodeIngestEnabled: false, backgroundWorkersEnabled: false, consolidationEnabled: false,
  };
  const parent = new HarnessMemCore(config);
  try {
    const start = parent.startVectorBackfillWorker({ reset: true });
    const initial = start.items[0] as Record<string, unknown>;
    expect(initial.running).toBe(true);
    const modulePath = new URL("../../src/core/harness-mem-core.ts", import.meta.url).pathname;
    for (const flag of childFlags) {
      const proc = Bun.spawn([process.execPath, "--eval", `
        import { HarnessMemCore, isLightweightChildProcess } from ${JSON.stringify(modulePath)};
        if (!isLightweightChildProcess()) throw new Error("not a child");
        const core = new HarnessMemCore(${JSON.stringify(config)});
        await core.shutdown("test-child");
      `], {
        env: { ...process.env, ...Object.fromEntries(childFlags.map(name => [name, "0"])), NODE_ENV: "test", [flag]: "1" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      expect(code, `${flag}: ${stderr}`).toBe(0);
      expect(parent.getVectorBackfillWorkerStatus().items[0], flag).toEqual(initial);
    }
    expect(parent.stopVectorBackfillWorker().items[0]).toMatchObject({ running: false, stop_requested: true, status: "stopped" });
    parent.startVectorBackfillWorker({ reset: true });
    await parent.shutdown("test-parent");
    const db = new Database(config.dbPath, { readonly: true });
    try {
      const row = db.query("SELECT state_json FROM mem_vector_backfill_worker_state WHERE key = 'default'").get() as { state_json: string };
      expect(JSON.parse(row.state_json)).toMatchObject({ running: false, stop_requested: true, status: "stopped" });
    } finally { db.close(); }
  } finally {
    await parent.shutdown("test-cleanup");
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
