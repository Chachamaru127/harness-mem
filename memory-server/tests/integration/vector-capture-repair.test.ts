import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, getConfig } from "../../src/core/harness-mem-core";
import { createAdaptiveEmbeddingProvider } from "../../src/embedding/adaptive-provider";
import { createVectorBackfillWorker } from "../../src/core/vector-backfill-worker";
import type { EmbeddingProvider } from "../../src/embedding/types";

// Real event child + production repair and rerank code. Numeric embeddings are
// deterministic fixtures; the local-ONNX suite independently tests real models.
test.each(["0", "1"])("offloaded capture repairs all required variants and converges (secondary=%s)", async (secondaryEnabled) => {
  const dir = mkdtempSync(join(tmpdir(), "mem-vector-capture-"));
  const overrides = {
    HOME: dir, HARNESS_MEM_HOME: dir, HARNESS_MEM_EMBEDDING_PROVIDER: "fallback",
    HARNESS_MEM_EMBEDDING_MODEL: "multilingual-e5", HARNESS_MEM_VECTOR_DIM: "384", HARNESS_MEM_EVENT_OFFLOAD: "1", HARNESS_MEM_TELEMETRY_ENABLED: "false",
    HARNESS_MEM_ADAPTIVE_RURI_GENERAL_FALLBACK: secondaryEnabled,
    HARNESS_MEM_CHECKPOINT_OFFLOAD: "1", HARNESS_MEM_CHECKPOINT_MATERIALIZE: "0",
  };
  const old = Object.fromEntries(Object.keys(overrides).map(k => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  let core: HarnessMemCore | undefined;
  try {
    core = new HarnessMemCore({ ...getConfig(), dbPath: join(dir, "test.db"), backgroundWorkersEnabled: false });
    const internal = core as any;
    const stub = (model: string): EmbeddingProvider => ({
      name: "local", model, dimension: 384,
      embed: () => [1, ...Array(383).fill(0)],
      health: () => ({ status: "healthy", details: "fixture" }),
    });
    const provider = createAdaptiveEmbeddingProvider({
      japaneseProvider: stub("ruri-v3-30m"), generalProvider: stub("multilingual-e5"), dimension: 384,
    });
    internal.embeddingProvider = provider;
    internal.vectorModelVersion = "adaptive:ruri-v3-30m+multilingual-e5";
    const worker = createVectorBackfillWorker({
      db: internal.db, getVectorModelVersion: () => internal.vectorModelVersion, getVectorDimension: () => 384,
      repairSqliteVecMap: options => core!.repairSqliteVecMap(options),
      reindexVectors: (limit, options) => core!.reindexVectors(limit, { ...options, reindex_all: false }),
      resetVectorRepairScan: () => internal.cfgMgr.resetVectorRepairScan(),
    }, { autoSchedule: false });
    worker.start({ target_coverage: 1 }); await worker.tick();
    expect(worker.status().items[0]).toMatchObject({ status: "completed" });
    const response = await core.recordEventQueued({
      platform: "codex", project: dir, session_id: "capture-repair", event_type: "user_prompt",
      ts: new Date().toISOString(), tags: [], privacy_tags: [],
      payload: { prompt: "memcapturecheck Mac稼働環境をv0.31.0に更新。既存設定を保持し、同じプロジェクトから保存した会話を検索できることを確認する。" },
    });
    expect(response.ok).toBe(true);
    const row = internal.db.query("SELECT id FROM mem_observations WHERE session_id = 'capture-repair'").get();
    expect(internal.db.query("SELECT model FROM mem_vectors WHERE observation_id = ?").all(row.id))
      .toEqual([{ model: "fallback:local-hash-v3" }]);
    const probe = (query: string) => internal.obsStore.vectorSearch({ query, project: dir, strict_project: true }, 20, [row.id]);
    expect(probe("memcapturecheck").scores.size).toBe(0);
    expect((core.metrics(core.getVectorCoverage()).items[0] as any).coverage).toMatchObject({ observations: 1, current_model_observations: 0 });
    await worker.maintain();
    if (secondaryEnabled === "1") {
      expect(internal.db.query("SELECT model FROM mem_vectors WHERE observation_id = ? AND model LIKE 'adaptive:%' ORDER BY model").all(row.id))
        .toEqual([{ model: "adaptive:general:local:multilingual-e5" }, { model: "adaptive:ruri:local:ruri-v3-30m" }]);
    }
    const repairedBefore = (worker.status().items[0] as any).maintenance_repaired;
    await worker.maintain();
    expect((worker.status().items[0] as any).maintenance_repaired).toBe(repairedBefore);
    for (const query of ["memcapturecheck", "会話の記録を検索して再開する"]) {
      const result = probe(query);
      expect(result.scores.size).toBe(1);
      expect((result.degradedReasons || []).some((r: string) => r.includes("no vector rows"))).toBe(false);
    }
    expect((core.metrics(core.getVectorCoverage()).items[0] as any).coverage).toMatchObject({ observations: 1, current_model_observations: 1, vector_coverage: 1 });
    // HTTP metrics must not execute the corpus routing scan on the parent loop.
    // This child uses the fixture environment (fallback); that stored row is also valid.
    internal.maintenanceWorkerConfigCompatible = true;
    const originalCoverage = internal.cfgMgr.vectorCoverage;
    internal.cfgMgr.vectorCoverage = () => { throw new Error("parent scan must not run"); };
    try {
      const first = core.metricsQueued();
      expect(core.metricsQueued()).toBe(first);
      const metrics = await first;
      expect((metrics.items[0] as any).coverage).toMatchObject({ observations: 1, current_model_observations: 1 });
    } finally { internal.cfgMgr.vectorCoverage = originalCoverage; }
    const checkpoint = await core.recordCheckpointQueued({
      platform: "codex", project: dir, session_id: "checkpoint-repair",
      title: "保存した記録", content: "会話の記録を検索して次の作業を再開する。",
    });
    expect(checkpoint.ok).toBe(true);
    const checkpointRow = internal.db.query("SELECT id FROM mem_observations WHERE session_id = 'checkpoint-repair'").get();
    await internal.runObservationMaterializeOutOfProcess(checkpointRow.id);
    expect(internal.db.query("SELECT model FROM mem_vectors WHERE observation_id = ?").all(checkpointRow.id))
      .toEqual([{ model: "fallback:local-hash-v3" }]);
    await worker.maintain();
    const checkpointSearch = internal.obsStore.vectorSearch({ query: "会話の記録を検索して再開する", project: dir, strict_project: true }, 20, [checkpointRow.id]);
    expect(checkpointSearch.scores.size).toBe(1);
    expect(core.getVectorCoverage()).toMatchObject({ total_observations: 2, current_count: 2 });
    const childResponse = await internal.runVectorBackfillOperationOutOfProcess({
      type: "reindex", limit: 5, missing_only: true, status_counts: false,
    });
    expect(childResponse.ok).toBe(true);
    expect(childResponse.items[0]).toMatchObject({ missing_only: true, status_counts: false, reindexed: 0 });
    expect(childResponse.items[0].total_observations).toBeUndefined();
    expect(childResponse.items[0].scanned).toBeLessThanOrEqual(500);
    await worker.shutdown();
  } finally {
    await core?.shutdown("test");
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);


test("metrics reports unknown on failure, retries, and reuses the 30-second snapshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-metrics-cache-"));
  const oldHome = process.env.HOME;
  process.env.HOME = dir;
  const core = new HarnessMemCore({ ...getConfig(), dbPath: join(dir, "test.db"), embeddingProvider: "fallback", backgroundWorkersEnabled: false });
  const internal = core as any;
  internal.maintenanceWorkerConfigCompatible = false;
  let calls = 0;
  let fail = true;
  internal.cfgMgr.vectorCoverage = () => { throw new Error("synchronous scan forbidden"); };
  internal.cfgMgr.vectorCoverageAsync = async () => {
    calls++;
    if (fail) throw new Error("synthetic failure");
    return { total_observations: 0, current_count: 0, legacy_count: 0, current_rows: 0 };
  };
  try {
    expect((core.metrics().items[0] as any).coverage).toBeNull();
    const failed = await core.metricsQueued();
    expect(failed.ok).toBe(true);
    expect(failed.items[0]).toMatchObject({ coverage: null, coverage_error: "vector_coverage_unavailable" });
    fail = false;
    expect((await core.metricsQueued()).items[0]).toMatchObject({ coverage: { vector_coverage: 1 } });
    await core.metricsQueued();
    expect(calls).toBe(2);
    internal.vectorCoverageCache.expiresAt = 0;
    await core.metricsQueued();
    expect(calls).toBe(3);
  } finally {
    await core.shutdown("test");
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    rmSync(dir, { recursive: true, force: true });
  }
});


test("local adaptive default shares a vector space across passage/query languages", async () => {
  const old = process.env.HARNESS_MEM_ADAPTIVE_RURI_GENERAL_FALLBACK;
  delete process.env.HARNESS_MEM_ADAPTIVE_RURI_GENERAL_FALLBACK;
  const dir = mkdtempSync(join(tmpdir(), "mem-cross-language-"));
  let core: HarnessMemCore | undefined;
  try {
    core = new HarnessMemCore({ ...getConfig(), dbPath: join(dir, "test.db"), embeddingProvider: "fallback", backgroundWorkersEnabled: false });
    const internal = core as any;
    const stub = (model: string): EmbeddingProvider => ({ name: "local", model, dimension: 384,
      embed: () => [1, ...Array(383).fill(0)], health: () => ({ status: "healthy", details: "fixture" }) });
    const provider = createAdaptiveEmbeddingProvider({ japaneseProvider: stub("ruri-v3-30m"), generalProvider: stub("multilingual-e5"), dimension: 384 });
    internal.embeddingProvider = provider; internal.vectorModelVersion = "adaptive:ruri-v3-30m+multilingual-e5";
    for (const [session, content, query] of [
      ["ja", "目印abc。" + "保存した会話を検索して次の作業を再開する。".repeat(8), "abc"],
      ["en", "We saved the conversation and resume the work using searchable project memory.", "会話を検索して作業を再開する"],
    ]) {
      await core.recordEventQueued({ platform: "codex", project: dir, session_id: session, event_type: "user_prompt", payload: { prompt: content } });
      await core.reindexVectors(10, { missing_only: true, status_counts: false });
      const row = internal.db.query("SELECT id FROM mem_observations WHERE session_id = ?").get(session);
      const result = internal.obsStore.vectorSearch({ query, project: dir, strict_project: true }, 20, [row.id]);
      expect(result.scores.size).toBe(1);
      expect((result.degradedReasons || []).some((r: string) => r.includes("no vector rows"))).toBe(false);
    }
    expect(core.getVectorCoverage()).toMatchObject({ total_observations: 2, current_count: 2 });
  } finally {
    await core?.shutdown("test");
    if (old === undefined) delete process.env.HARNESS_MEM_ADAPTIVE_RURI_GENERAL_FALLBACK; else process.env.HARNESS_MEM_ADAPTIVE_RURI_GENERAL_FALLBACK = old;
    rmSync(dir, { recursive: true, force: true });
  }
});
