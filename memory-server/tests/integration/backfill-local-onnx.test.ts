import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { insertTestObservation } from "../core-split/test-helpers";

const modelsDir = process.env.HARNESS_MEM_LOCAL_MODELS_DIR || join(homedir(), ".harness-mem/models");
const modelsInstalled = ["multilingual-e5", "ruri-v3-30m"].every(model =>
  existsSync(join(modelsDir, model, "config.json")));

for (const [language, content, model] of [
  ["English", "const retry = true; Save the deployment decision for the next conversation.", "adaptive:general:local:multilingual-e5"],
  ["Japanese", "会話の記録を検索して次の作業を再開する。", "adaptive:ruri:local:ruri-v3-30m"],
] as const) {
  test.skipIf(!modelsInstalled)(`cold adaptive backfill stores a batch containing only ${language}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-backfill-onnx-"));
    const dbPath = join(dir, "test.db");
    const db = new Database(dbPath);
    try {
      configureDatabase(db);
      initSchema(db);
      migrateSchema(db);
      insertTestObservation(db, { id: "cold-batch", content, project: dir });
    } finally { db.close(); }
    const proc = Bun.spawn([process.execPath,
      new URL("../../src/tools/vector-backfill-tick.ts", import.meta.url).pathname,
      JSON.stringify({ type: "reindex", limit: 25, status_counts: true, missing_only: true })], {
      env: {
        ...process.env, HOME: dir, NODE_ENV: "test", HARNESS_MEM_HOME: dir,
        HARNESS_MEM_DB_PATH: dbPath, HARNESS_MEM_VECTOR_BACKFILL_CHILD: "1",
        HARNESS_MEM_EMBEDDING_PROVIDER: "adaptive", HARNESS_MEM_EMBEDDING_MODEL: "multilingual-e5",
        HARNESS_MEM_LOCAL_MODELS_DIR: modelsDir, HARNESS_MEM_VECTOR_DIM: "384",
        HARNESS_MEM_ADAPTIVE_JA_THRESHOLD: "0.85", HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD: "0.5",
        HARNESS_MEM_ADAPTIVE_RURI_GENERAL_FALLBACK: "false",
        HARNESS_MEM_ENABLE_CODEX_INGEST: "0", HARNESS_MEM_ENABLE_CLAUDE_CODE_INGEST: "0",
        HARNESS_MEM_ENABLE_CURSOR_INGEST: "0", HARNESS_MEM_ENABLE_OPENCODE_INGEST: "0",
        HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST: "0", HARNESS_MEM_ENABLE_GEMINI_INGEST: "0",
      }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), 45_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([
        proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
      ]);
      expect(exit, stderr).toBe(0);
      const response = JSON.parse(stdout.trim().split("\n").filter(line => line.startsWith("{")).at(-1)!);
      expect(response.items[0], JSON.stringify(response.meta)).toMatchObject({
        reindexed: 1, skipped_retryable: 0, missing_vectors_remaining: 0, vector_coverage: 1, scanned: 1,
      });
      const readback = new Database(dbPath);
      try {
        const row = readback.query("SELECT model, dimension, vector_json FROM mem_vectors WHERE observation_id = 'cold-batch'").get() as { model: string; dimension: number; vector_json: string };
        expect(row.model).toBe(model);
        expect(row.dimension).toBe(384);
        expect(JSON.parse(row.vector_json).some((value: number) => value !== 0)).toBe(true);
      } finally { readback.close(); }
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) { proc.kill(); await proc.exited; }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
}
