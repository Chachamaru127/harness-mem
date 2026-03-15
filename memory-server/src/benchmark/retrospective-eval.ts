/**
 * §34 FD-017: Retrospective A/B 評価フレーム
 *
 * mem_audit_log の search_hit を暗黙の肯定フィードバックとして活用し、
 * 旧アルゴリズム（§33）と新アルゴリズム（§34）をオフラインで比較評価する。
 *
 * ## 評価方針
 * - search_hit エントリ = 過去に実際に返された（暗黙的に有用とみなされた）結果
 * - 同一クエリを現行アルゴリズムで再実行し、過去の hit が上位に来るかを測定
 * - Recall@K: 過去の hit が top-K 内に含まれる割合
 *
 * ## HARNESS_MEM_ALGO_VERSION
 * - "v33": §33 設定（DECAY_DISABLED=0, RERANKER=0）
 * - "v34": §34 設定（DECAY_DISABLED=1, RERANKER=1）[デフォルト]
 *
 * 使用方法: bun run memory-server/src/benchmark/retrospective-eval.ts <db-path> [output-path]
 */

import { Database } from "bun:sqlite";
import { writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { HarnessMemCore, type Config } from "../core/harness-mem-core";
import { findModelById } from "../embedding/model-catalog";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

export type AlgoVersion = "v33" | "v34";

export interface RetroQuery {
  query: string;
  project: string;
  hit_ids: string[];         // 過去の search_hit (ground truth)
  hit_count: number;
  sampled_at: string;
}

export interface RetroResult {
  query: string;
  project: string;
  algo: AlgoVersion;
  retrieved_ids: string[];
  recall_at_5: number;
  recall_at_10: number;
  hit_found: boolean;
}

export interface RetroReport {
  schema_version: "fd-017-retrospective-v1";
  generated_at: string;
  db_path: string;
  embedding_profile: {
    mode: "onnx" | "fallback";
    provider: "local" | "fallback";
    model: string;
    vector_dimension: number;
    onnx_gate: boolean;
    prime_enabled: boolean;
  };
  algo_v33: {
    recall_at_5: number;
    recall_at_10: number;
    n_queries: number;
  };
  algo_v34: {
    recall_at_5: number;
    recall_at_10: number;
    n_queries: number;
  };
  delta: {
    recall_at_5: number;
    recall_at_10: number;
  };
  queries_sampled: number;
  per_query_results: Array<{
    query_prefix: string;
    project: string;
    v33_recall10: number;
    v34_recall10: number;
  }>;
}

interface BenchEmbeddingProfile {
  mode: "onnx" | "fallback";
  provider: "local" | "fallback";
  model: string;
  vectorDimension: number;
  gateEnabled: boolean;
  primeEnabled: boolean;
}

interface CacheStatsSummary {
  available: boolean;
  before: Record<string, number>;
  after: Record<string, number>;
  delta: Record<string, number>;
}

interface AlgoEvalResult {
  results: RetroResult[];
  cacheStats: CacheStatsSummary;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function normalizeMode(value: string | undefined): "onnx" | "fallback" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "onnx") return "onnx";
  return "fallback";
}

function assertOnnxOnlyMode(mode: "onnx" | "fallback"): void {
  if (mode !== "onnx") {
    throw new Error(
      `[retro-eval] strict ONNX-only mode violated: HARNESS_BENCH_EMBEDDING_MODE=${mode}`
    );
  }
}

function normalizeVectorDimension(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.trunc(num);
  if (rounded < 32 || rounded > 4096) return fallback;
  return rounded;
}

function resolveBenchEmbeddingProfile(): BenchEmbeddingProfile {
  const mode = normalizeMode(process.env.HARNESS_BENCH_EMBEDDING_MODE || "onnx");
  assertOnnxOnlyMode(mode);
  const provider: "local" | "fallback" = "local";
  const model = (process.env.HARNESS_BENCH_EMBEDDING_MODEL || "multilingual-e5").trim() || "multilingual-e5";
  const vectorDimension = normalizeVectorDimension(process.env.HARNESS_BENCH_VECTOR_DIM, 384);
  return {
    mode,
    provider,
    model,
    vectorDimension,
    gateEnabled: parseBooleanFlag(process.env.HARNESS_BENCH_ONNX_GATE, true),
    primeEnabled: parseBooleanFlag(process.env.HARNESS_BENCH_PRIME_EMBEDDING, true),
  };
}

const BENCH_EMBEDDING = resolveBenchEmbeddingProfile();

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function ensureEmbeddingReady(core: HarnessMemCore, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastDetails = "embedding readiness timeout";
  while (Date.now() < deadline) {
    const readiness = core.readiness();
    const item = toRecord(readiness.items[0]);
    if (item.ready === true) return;
    lastDetails = String(item.embedding_provider_details || item.embedding_readiness_state || item.status || lastDetails);
    if (item.embedding_readiness_state === "failed") {
      throw new Error(`[${label}] embedding readiness failed: ${lastDetails}`);
    }
    try {
      await core.primeEmbedding("__retro_eval_ready__", "passage");
      await core.primeEmbedding("__retro_eval_ready__", "query");
    } catch { }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`[${label}] embedding readiness timeout: ${lastDetails}`);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function flattenNumericStats(input: Record<string, unknown>, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const qualified = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number" && Number.isFinite(value)) {
      out[qualified] = value;
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(out, flattenNumericStats(value as Record<string, unknown>, qualified));
    }
  }
  return out;
}

function summarizeCacheStats(
  beforeRaw: Record<string, unknown> | null,
  afterRaw: Record<string, unknown> | null
): CacheStatsSummary {
  const before = beforeRaw ? flattenNumericStats(beforeRaw) : {};
  const after = afterRaw ? flattenNumericStats(afterRaw) : {};
  const delta: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return {
    available: beforeRaw !== null || afterRaw !== null,
    before,
    after,
    delta,
  };
}

function verifyEmbeddingGate(core: HarnessMemCore, label: string): void {
  if (!BENCH_EMBEDDING.gateEnabled || BENCH_EMBEDDING.mode !== "onnx") return;
  const health = core.health();
  const item = toRecord(health.items[0]);
  const features = toRecord(item.features);
  const provider = String(features.embedding_provider || item.embedding_provider || "");
  const model = String(features.embedding_model || "");
  const failures: string[] = [];
  if (provider !== BENCH_EMBEDDING.provider) {
    failures.push(`provider=${provider || "unknown"} (expected ${BENCH_EMBEDDING.provider})`);
  }
  if (model !== BENCH_EMBEDDING.model) {
    failures.push(`model=${model || "unknown"} (expected ${BENCH_EMBEDDING.model})`);
  }
  const catalog = findModelById(BENCH_EMBEDDING.model);
  if (!catalog) {
    failures.push(`unknown model "${BENCH_EMBEDDING.model}"`);
  } else if (BENCH_EMBEDDING.vectorDimension !== catalog.dimension) {
    failures.push(
      `vector_dim=${BENCH_EMBEDDING.vectorDimension} (expected ${catalog.dimension} for ${BENCH_EMBEDDING.model})`
    );
  }
  if (failures.length > 0) {
    throw new Error(`[${label}] ONNX gate failed: ${failures.join(", ")}`);
  }
}

async function maybePrimeEmbedding(
  core: HarnessMemCore,
  texts: string[],
  mode: "passage" | "query" = "passage"
): Promise<void> {
  if (!BENCH_EMBEDDING.primeEnabled) return;
  const normalized = [...new Set(texts.map((text) => text.trim()).filter((text) => text.length > 0))];
  if (normalized.length === 0) return;

  const target = core as unknown as {
    primeEmbedding?: (text: string, mode?: "passage" | "query") => unknown;
  };
  if (typeof target.primeEmbedding !== "function") return;

  for (const text of normalized) {
    try {
      const single = target.primeEmbedding.call(core, text, mode);
      if (isPromiseLike(single)) {
        await single;
      }
    } catch {
      // best effort
    }
  }
}

async function readCacheStats(core: HarnessMemCore): Promise<Record<string, unknown> | null> {
  const target = core as unknown as {
    getEmbeddingRuntimeInfo?: () => unknown;
  };
  if (typeof target.getEmbeddingRuntimeInfo !== "function") return null;
  try {
    const runtime = toRecord(target.getEmbeddingRuntimeInfo.call(core));
    const record = toRecord(runtime.cacheStats);
    return Object.keys(record).length > 0 ? record : null;
  } catch {
    return null;
  }
}

/** mem_audit_log から search_hit クエリをサンプリングする */
export function sampleSearchHits(
  db: Database,
  maxQueries = 100
): RetroQuery[] {
  // クエリ別に集計（同一クエリの複数 hit を束ねる）
  type HitRow = { query_prefix: string; project: string; hit_ids: string; hit_count: number; sampled_at: string };
  const rows = db
    .query<HitRow, [number]>(`
      SELECT
        json_extract(details_json, '$.query') AS query_prefix,
        json_extract(details_json, '$.project') AS project,
        GROUP_CONCAT(target_id) AS hit_ids,
        COUNT(*) AS hit_count,
        MAX(created_at) AS sampled_at
      FROM mem_audit_log
      WHERE action = 'search_hit'
        AND target_type = 'observation'
        AND json_extract(details_json, '$.query') IS NOT NULL
        AND json_extract(details_json, '$.query') != ''
      GROUP BY query_prefix, project
      HAVING hit_count >= 1
      ORDER BY hit_count DESC, sampled_at DESC
      LIMIT ?
    `)
    .all(maxQueries);

  return rows.map((row) => ({
    query: row.query_prefix ?? "",
    project: row.project ?? "",
    hit_ids: (row.hit_ids ?? "").split(",").filter(Boolean),
    hit_count: row.hit_count,
    sampled_at: row.sampled_at,
  }));
}

function algoVersionEnv(algo: AlgoVersion): Record<string, string> {
  if (algo === "v33") {
    return {
      HARNESS_MEM_DECAY_DISABLED: "0",
      HARNESS_MEM_RERANKER_ENABLED: "0",
    };
  }
  // v34 (current / default)
  return {
    HARNESS_MEM_DECAY_DISABLED: "1",
    HARNESS_MEM_RERANKER_ENABLED: "1",
  };
}

function calculateRecallAtK(retrievedIds: string[], hitIds: string[], k: number): number {
  const topK = retrievedIds.slice(0, k);
  const hitSet = new Set(hitIds);
  const found = topK.filter((id) => hitSet.has(id)).length;
  return hitIds.length > 0 ? found / Math.min(hitIds.length, k) : 0;
}

/** 単一アルゴリズムバージョンでクエリリストを評価する */
export async function evaluateAlgo(
  queries: RetroQuery[],
  algo: AlgoVersion,
  sourceDbPath: string
): Promise<AlgoEvalResult> {
  // アルゴリズムバージョン設定を環境変数に反映
  const envOverride = algoVersionEnv(algo);
  for (const [k, v] of Object.entries(envOverride)) {
    process.env[k] = v;
  }

  // 独立した一時 Core を作成（ソース DB の obs をコピー）
  const dir = mkdtempSync(join(tmpdir(), `retro-${algo}-`));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: BENCH_EMBEDDING.vectorDimension,
    embeddingProvider: BENCH_EMBEDDING.provider,
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
  const core = new HarnessMemCore(config);
  verifyEmbeddingGate(core, `retro-${algo}`);
  await ensureEmbeddingReady(core, `retro-${algo}`);

  try {
    const cacheBefore = await readCacheStats(core);
    // ソース DB のエントリを再投入
    const sourceDb = new Database(sourceDbPath, { readonly: true });
    type ObsRow = { id: string; platform: string; project: string; session_id: string; content: string; created_at: string };
    const obs = sourceDb
      .query<ObsRow, []>(`
        SELECT id, platform, project, session_id, content, created_at
        FROM mem_observations
        WHERE content IS NOT NULL AND content != ''
        ORDER BY created_at ASC
        LIMIT 2000
      `)
      .all();
    sourceDb.close();

    await maybePrimeEmbedding(
      core,
      obs.map((row) => row.content),
      "passage"
    );
    await maybePrimeEmbedding(
      core,
      queries.map((query) => query.query),
      "query"
    );

    for (const o of obs) {
      core.recordEvent({
        event_id: o.id,
        platform: o.platform ?? "claude",
        project: o.project ?? "default",
        session_id: o.session_id ?? "unknown",
        event_type: "user_prompt",
        ts: o.created_at,
        payload: { content: o.content },
        tags: [],
        privacy_tags: [],
      });
    }

    // 各クエリを再実行
    const results: RetroResult[] = [];
    for (const q of queries) {
      const searchResult = core.search({
        query: q.query,
        project: q.project,
        include_private: true,
        limit: 10,
      });
      const retrievedIds = searchResult.items.map((item) =>
        String((item as Record<string, unknown>).id ?? "")
      );

      results.push({
        query: q.query,
        project: q.project,
        algo,
        retrieved_ids: retrievedIds,
        recall_at_5: calculateRecallAtK(retrievedIds, q.hit_ids, 5),
        recall_at_10: calculateRecallAtK(retrievedIds, q.hit_ids, 10),
        hit_found: q.hit_ids.some((id) => retrievedIds.includes(id)),
      });
    }

    const cacheAfter = await readCacheStats(core);
    return {
      results,
      cacheStats: summarizeCacheStats(cacheBefore, cacheAfter),
    };
  } finally {
    core.shutdown(`retro-${algo}`);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** フル Retrospective A/B 評価を実行してレポートを生成する */
export async function runRetrospectiveEval(
  dbPath: string,
  maxQueries = 100,
  outputPath?: string
): Promise<RetroReport> {
  const resolvedDb = resolve(dbPath);
  if (BENCH_EMBEDDING.mode === "onnx") {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = BENCH_EMBEDDING.model;
  }
  console.log(
    `[retro-eval] embedding profile: mode=${BENCH_EMBEDDING.mode}, provider=${BENCH_EMBEDDING.provider}, ` +
      `model=${BENCH_EMBEDDING.model}, vector_dim=${BENCH_EMBEDDING.vectorDimension}, ` +
      `onnx_gate=${BENCH_EMBEDDING.gateEnabled}, prime=${BENCH_EMBEDDING.primeEnabled}`
  );
  const db = new Database(resolvedDb, { readonly: true });
  const queries = sampleSearchHits(db, maxQueries);
  db.close();

  if (queries.length === 0) {
    console.warn("[retro-eval] No search_hit queries found in audit log. Run some searches first.");
    const emptyReport: RetroReport = {
      schema_version: "fd-017-retrospective-v1",
      generated_at: new Date().toISOString(),
      db_path: resolvedDb,
      embedding_profile: {
        mode: BENCH_EMBEDDING.mode,
        provider: BENCH_EMBEDDING.provider,
        model: BENCH_EMBEDDING.model,
        vector_dimension: BENCH_EMBEDDING.vectorDimension,
        onnx_gate: BENCH_EMBEDDING.gateEnabled,
        prime_enabled: BENCH_EMBEDDING.primeEnabled,
      },
      algo_v33: { recall_at_5: 0, recall_at_10: 0, n_queries: 0 },
      algo_v34: { recall_at_5: 0, recall_at_10: 0, n_queries: 0 },
      delta: { recall_at_5: 0, recall_at_10: 0 },
      queries_sampled: 0,
      per_query_results: [],
    };
    if (outputPath) writeFileSync(outputPath, JSON.stringify(emptyReport, null, 2));
    return emptyReport;
  }

  console.log(`[retro-eval] Sampled ${queries.length} queries from audit log`);

  const [v33Eval, v34Eval] = await Promise.all([
    evaluateAlgo(queries, "v33", resolvedDb),
    evaluateAlgo(queries, "v34", resolvedDb),
  ]);
  const v33Results = v33Eval.results;
  const v34Results = v34Eval.results;

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const v33R5 = avg(v33Results.map((r) => r.recall_at_5));
  const v33R10 = avg(v33Results.map((r) => r.recall_at_10));
  const v34R5 = avg(v34Results.map((r) => r.recall_at_5));
  const v34R10 = avg(v34Results.map((r) => r.recall_at_10));

  const perQuery = queries.map((q, i) => ({
    query_prefix: q.query.slice(0, 40),
    project: q.project,
    v33_recall10: v33Results[i]?.recall_at_10 ?? 0,
    v34_recall10: v34Results[i]?.recall_at_10 ?? 0,
  }));

  const report: RetroReport = {
    schema_version: "fd-017-retrospective-v1",
    generated_at: new Date().toISOString(),
    db_path: resolvedDb,
    embedding_profile: {
      mode: BENCH_EMBEDDING.mode,
      provider: BENCH_EMBEDDING.provider,
      model: BENCH_EMBEDDING.model,
      vector_dimension: BENCH_EMBEDDING.vectorDimension,
      onnx_gate: BENCH_EMBEDDING.gateEnabled,
      prime_enabled: BENCH_EMBEDDING.primeEnabled,
    },
    algo_v33: { recall_at_5: v33R5, recall_at_10: v33R10, n_queries: v33Results.length },
    algo_v34: { recall_at_5: v34R5, recall_at_10: v34R10, n_queries: v34Results.length },
    delta: {
      recall_at_5: v34R5 - v33R5,
      recall_at_10: v34R10 - v33R10,
    },
    queries_sampled: queries.length,
    per_query_results: perQuery,
  };

  console.log(`[retro-eval] v33 recall@10=${v33R10.toFixed(4)}, v34 recall@10=${v34R10.toFixed(4)}, delta=${(v34R10 - v33R10).toFixed(4)}`);
  console.log(`[retro-eval] v33 cacheStats delta=${JSON.stringify(v33Eval.cacheStats.delta)}`);
  console.log(`[retro-eval] v34 cacheStats delta=${JSON.stringify(v34Eval.cacheStats.delta)}`);

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`[retro-eval] Written to ${outputPath}`);
  }

  return report;
}

// CLI として実行された場合
if (import.meta.main) {
  const [, , dbPath, outputPath] = process.argv;
  if (!dbPath) {
    console.error("Usage: bun retrospective-eval.ts <db-path> [output-path]");
    console.error("  HARNESS_MEM_ALGO_VERSION: v33 | v34 (default: v34)");
    process.exit(1);
  }

  const resolvedDb = resolve(dbPath);
  if (!existsSync(resolvedDb)) {
    console.error(`DB not found: ${resolvedDb}`);
    process.exit(1);
  }

  const out = outputPath ? resolve(outputPath) : join(
    import.meta.dir,
    "results/fd-017-retrospective-report.json"
  );

  await runRetrospectiveEval(resolvedDb, 100, out);
}
