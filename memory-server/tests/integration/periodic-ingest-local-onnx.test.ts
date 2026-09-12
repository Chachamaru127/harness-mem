import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PeriodicIngestWorkerClient } from "../../src/core/periodic-ingest-worker-client";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";

const modelsDir = process.env.HARNESS_MEM_LOCAL_MODELS_DIR || join(homedir(), ".harness-mem/models");
const localModelInstalled = existsSync(join(modelsDir, "multilingual-e5", "config.json"));

for (const provider of ["local", "adaptive"] as const) {
test.skipIf(!localModelInstalled || (provider === "adaptive" && !existsSync(join(modelsDir, "ruri-v3-30m", "config.json"))))(`${provider} ONNX ingest primes new text, advances offsets after commit, and does not duplicate`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-local-ingest-"));
  const dbPath = join(dir, "test.db");
  const initialized = new Database(dbPath);
  configureDatabase(initialized);
  initSchema(initialized);
  migrateSchema(initialized);
  initialized.close();
  const sessionsRoot = join(dir, "sessions");
  mkdirSync(sessionsRoot);
  const rolloutPath = join(sessionsRoot, "rollout-2026-09-11T00-00-00-22222222-2222-2222-2222-222222222222.jsonl");
  writeFileSync(rolloutPath, ["本文ごとの計算を待って保存する<private>除外するテスト文字列</private>", "二件目の内容も重複せず記録する"].map(text => JSON.stringify({
    timestamp: "2026-09-11T00:00:00.000Z",
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  })).join("\n") + "\n");
  const errors: unknown[] = [];
  const client = new PeriodicIngestWorkerClient({
    scriptPath: fileURLToPath(new URL("../../src/tools/periodic-ingest-worker.ts", import.meta.url)),
    cwd: join(import.meta.dir, "../.."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HARNESS_MEM_HOME: dir,
      HARNESS_MEM_DB_PATH: dbPath,
      HARNESS_MEM_EMBEDDING_PROVIDER: provider,
      HARNESS_MEM_EMBEDDING_MODEL: "multilingual-e5",
      HARNESS_MEM_LOCAL_MODELS_DIR: modelsDir,
      HARNESS_MEM_VECTOR_DIM: "384",
      HARNESS_MEM_ADAPTIVE_JA_THRESHOLD: "0.85",
      HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD: "0.5",
      HARNESS_MEM_CODEX_PROJECT_ROOT: dir,
      HARNESS_MEM_CODEX_SESSIONS_ROOT: sessionsRoot,
      HARNESS_MEM_ENABLE_CODEX_INGEST: "1",
      HARNESS_MEM_ENABLE_OPENCODE_INGEST: "0",
      HARNESS_MEM_ENABLE_CURSOR_INGEST: "0",
      HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST: "0",
      HARNESS_MEM_ENABLE_GEMINI_INGEST: "0",
      HARNESS_MEM_ENABLE_CLAUDE_CODE_INGEST: "0",
    },
    busyLogMs: 10_000,
    onError: (_source, reason, failure) => errors.push({ reason, failure }),
  });
  const runTick = async () => {
    expect(client.schedule("codex")).toBe(true);
    const deadline = Date.now() + 20_000;
    while (client.activeSource() !== null) {
      if (Date.now() > deadline) throw new Error("local ingest did not finish");
      await Bun.sleep(20);
    }
  };
  try {
    await runTick();
    expect(errors).toEqual([]);
    const pid = client.workerPid();
    const readCounts = () => {
      const db = new Database(dbPath, { readonly: true });
      try {
        return {
          count: db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL").get()?.count,
          offset: db.query<{ offset: number }, [string]>("SELECT offset FROM mem_ingest_offsets WHERE source_key = ?").get(`codex_rollout:${rolloutPath}`)?.offset,
          privateLeaks: db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mem_observations WHERE content LIKE '%除外するテスト文字列%' OR raw_text LIKE '%除外するテスト文字列%'").get()?.count,
          models: db.query<{ model: string }, []>("SELECT DISTINCT model FROM mem_vectors ORDER BY model").all().map(row => row.model),
        };
      } finally { db.close(); }
    };
    const expected = { count: 2, offset: statSync(rolloutPath).size, privateLeaks: 0,
      models: [provider === "local" ? "local:multilingual-e5" : "adaptive:ruri:local:ruri-v3-30m"] };
    expect(readCounts()).toEqual(expected);
    await runTick();
    expect(errors).toEqual([]);
    expect(client.workerPid()).toBe(pid);
    expect(readCounts()).toEqual(expected);
  } finally {
    await client.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, 45_000);
}
