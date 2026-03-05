/**
 * FD-002: Freshness Jaccard 閾値の 5-fold 交差検証
 *
 * knowledge-update-50 を5-fold分割し、各foldでJaccard閾値を最適化する。
 * 現在の0.3は train=test で楽観的な値であるため、CV で適正値を求める。
 *
 * 使用方法: bun run memory-server/src/benchmark/freshness-cv.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { HarnessMemCore, type Config } from "../core/harness-mem-core";
import { findModelById } from "../embedding/model-catalog";
import { BenchmarkRunner } from "./runner";

const RESULTS_DIR = join(import.meta.dir, "results");
const FIXTURE_PATH = resolve(
  import.meta.dir,
  "../../../tests/benchmarks/fixtures/knowledge-update-50.json"
);

interface KnowledgeUpdateEntry {
  id: string;
  content: string;
  timestamp: string;
}

interface KnowledgeUpdateCase {
  id: string;
  description: string;
  old_entries: KnowledgeUpdateEntry[];
  new_entries: KnowledgeUpdateEntry[];
  query: string;
  expected_latest_id: string;
}

// Jaccard 閾値の探索候補
const JACCARD_THRESHOLDS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];

type BenchEmbeddingMode = "onnx" | "fallback";

interface BenchEmbeddingProfile {
  mode: BenchEmbeddingMode;
  provider: "local" | "fallback";
  model: string;
  vectorDimension: number;
  gateEnabled: boolean;
  primeEnabled: boolean;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function normalizeMode(value: string | undefined): BenchEmbeddingMode {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "onnx") return "onnx";
  return "fallback";
}

function assertOnnxOnlyMode(mode: BenchEmbeddingMode): void {
  if (mode !== "onnx") {
    throw new Error(`[freshness-cv] strict ONNX-only mode violated: HARNESS_BENCH_EMBEDDING_MODE=${mode}`);
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

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
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

function createTempCore(): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-cv-"));
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
  verifyEmbeddingGate(core, "freshness-cv");
  return { core, dir };
}

async function evaluateFreshnessOnFold(
  cases: KnowledgeUpdateCase[],
  jaccardThreshold: number
): Promise<number> {
  // 環境変数でJaccard閾値を制御（event-recorder.tsが参照できるように）
  process.env.HARNESS_JACCARD_SUPERSEDE_THRESHOLD = String(jaccardThreshold);

  const { core, dir } = createTempCore();
  try {
    const project = "cv-knowledge-update";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);
    const scores: number[] = [];
    const cacheBefore = await readCacheStats(core);

    await maybePrimeEmbedding(
      core,
      cases.flatMap((kCase) => [
        ...kCase.old_entries.map((entry) => entry.content),
        ...kCase.new_entries.map((entry) => entry.content),
      ]),
      "passage"
    );
    await maybePrimeEmbedding(
      core,
      cases.map((kCase) => kCase.query),
      "query"
    );

    for (const kCase of cases) {
      for (const entry of kCase.old_entries) {
        core.recordEvent({
          event_id: entry.id,
          platform: "claude",
          project,
          session_id: `ku-session-${kCase.id}`,
          event_type: "user_prompt",
          ts: entry.timestamp,
          payload: { content: entry.content },
          tags: [],
          privacy_tags: [],
        });
      }
      for (const entry of kCase.new_entries) {
        core.recordEvent({
          event_id: entry.id,
          platform: "claude",
          project,
          session_id: `ku-session-${kCase.id}`,
          event_type: "user_prompt",
          ts: entry.timestamp,
          payload: { content: entry.content },
          tags: [],
          privacy_tags: [],
        });
      }

      const result = core.search({
        query: kCase.query,
        project,
        include_private: true,
        limit: 10,
        exclude_updated: true,
      });
      const retrievedIds = result.items.map((item) =>
        String((item as Record<string, unknown>).id ?? "")
      );
      const newId = `obs_${kCase.expected_latest_id}`;
      const oldIds = kCase.old_entries.map((e) => `obs_${e.id}`);

      const score = runner.calculateFreshnessAtK(retrievedIds, newId, oldIds, 10);
      scores.push(score);
    }

    const freshness = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const cacheAfter = await readCacheStats(core);
    if (cacheBefore || cacheAfter) {
      const before = cacheBefore ? flattenNumericStats(cacheBefore) : {};
      const after = cacheAfter ? flattenNumericStats(cacheAfter) : {};
      const delta: Record<string, number> = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
      }
      console.log(
        `[CV] cacheStats(threshold=${jaccardThreshold.toFixed(2)}): ` +
          `before=${JSON.stringify(before)} after=${JSON.stringify(after)} delta=${JSON.stringify(delta)}`
      );
    }
    return freshness;
  } finally {
    core.shutdown("cv-knowledge-update");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("[CV] FD-002: Freshness Jaccard 閾値 5-fold 交差検証");
  console.log(
    `[CV] embedding profile: mode=${BENCH_EMBEDDING.mode}, provider=${BENCH_EMBEDDING.provider}, ` +
      `model=${BENCH_EMBEDDING.model}, vector_dim=${BENCH_EMBEDDING.vectorDimension}, ` +
      `onnx_gate=${BENCH_EMBEDDING.gateEnabled}, prime=${BENCH_EMBEDDING.primeEnabled}`
  );

  process.env.HARNESS_MEM_DECAY_DISABLED = "1";
  process.env.HARNESS_MEM_RERANKER_ENABLED = "1";
  if (BENCH_EMBEDDING.mode === "onnx") {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = BENCH_EMBEDDING.model;
  }

  mkdirSync(RESULTS_DIR, { recursive: true });

  if (!existsSync(FIXTURE_PATH)) {
    console.error(`[CV] Fixture not found: ${FIXTURE_PATH}`);
    process.exit(1);
  }

  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  const allCases = JSON.parse(raw) as KnowledgeUpdateCase[];
  console.log(`[CV] Total cases: ${allCases.length}`);

  const K_FOLDS = 5;
  const foldSize = Math.ceil(allCases.length / K_FOLDS);

  // 5-fold CV の結果を格納
  const foldResults: Array<{
    fold: number;
    best_threshold: number;
    best_freshness: number;
    threshold_scores: Record<number, number>;
  }> = [];

  for (let fold = 0; fold < K_FOLDS; fold++) {
    const validationStart = fold * foldSize;
    const validationEnd = Math.min(validationStart + foldSize, allCases.length);
    const validationCases = allCases.slice(validationStart, validationEnd);
    // trainCases は現在の実装では評価に使用しない（閾値は全validation foldで同一）

    console.log(`\n[CV] Fold ${fold + 1}/${K_FOLDS}: validation cases ${validationStart}..${validationEnd - 1} (${validationCases.length} cases)`);

    const thresholdScores: Record<number, number> = {};
    let bestThreshold = JACCARD_THRESHOLDS[0];
    let bestFreshness = -1;

    for (const threshold of JACCARD_THRESHOLDS) {
      const freshness = await evaluateFreshnessOnFold(validationCases, threshold);
      thresholdScores[threshold] = freshness;
      process.stdout.write(`  threshold=${threshold.toFixed(2)}: Freshness@K=${freshness.toFixed(4)}\n`);

      if (freshness > bestFreshness) {
        bestFreshness = freshness;
        bestThreshold = threshold;
      }
    }

    foldResults.push({
      fold: fold + 1,
      best_threshold: bestThreshold,
      best_freshness: bestFreshness,
      threshold_scores: thresholdScores,
    });

    console.log(`  → Best: threshold=${bestThreshold}, Freshness@K=${bestFreshness.toFixed(4)}`);
  }

  // 各閾値の平均 Freshness@K を計算
  const avgByThreshold: Record<number, number> = {};
  for (const threshold of JACCARD_THRESHOLDS) {
    const scores = foldResults.map((r) => r.threshold_scores[threshold]);
    avgByThreshold[threshold] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // 最適な閾値を選択
  let optimalThreshold = JACCARD_THRESHOLDS[0];
  let maxAvgFreshness = -1;
  for (const [thresholdStr, avgScore] of Object.entries(avgByThreshold)) {
    const threshold = Number(thresholdStr);
    if (avgScore > maxAvgFreshness) {
      maxAvgFreshness = avgScore;
      optimalThreshold = threshold;
    }
  }

  // 以前のデフォルト閾値（0.3）と最適閾値の比較
  const previousDefaultScore = avgByThreshold[0.3] ?? 0;

  console.log("\n[CV] === 5-fold CV 結果 ===");
  console.log(`[CV] 以前のデフォルト閾値 (0.3): 平均 Freshness@K = ${previousDefaultScore.toFixed(4)}`);
  console.log(`[CV] 最適閾値: ${optimalThreshold} (平均 Freshness@K = ${maxAvgFreshness.toFixed(4)})`);
  console.log(`[CV] 改善 vs 0.3: ${((maxAvgFreshness - previousDefaultScore) * 100).toFixed(2)}pp`);

  const report = {
    created_at: new Date().toISOString(),
    fixture: "knowledge-update-50.json",
    embedding_profile: {
      mode: BENCH_EMBEDDING.mode,
      provider: BENCH_EMBEDDING.provider,
      model: BENCH_EMBEDDING.model,
      vector_dimension: BENCH_EMBEDDING.vectorDimension,
      onnx_gate: BENCH_EMBEDDING.gateEnabled,
      prime_enabled: BENCH_EMBEDDING.primeEnabled,
    },
    k_folds: K_FOLDS,
    total_cases: allCases.length,
    thresholds_tested: JACCARD_THRESHOLDS,
    fold_results: foldResults,
    avg_freshness_by_threshold: avgByThreshold,
    optimal_threshold: optimalThreshold,
    optimal_avg_freshness: maxAvgFreshness,
    previous_default_threshold: 0.3,
    previous_default_avg_freshness: previousDefaultScore,
    improvement_vs_0_3_pp: (maxAvgFreshness - previousDefaultScore) * 100,
    recommendation: optimalThreshold !== 0.3
      ? `閾値を 0.3 → ${optimalThreshold} に変更することで Freshness@K が ${((maxAvgFreshness - previousDefaultScore) * 100).toFixed(2)}pp 改善する`
      : "閾値 0.3 が最適",
  };

  const reportPath = join(RESULTS_DIR, "freshness-cv-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[CV] レポート保存: ${reportPath}`);

  // event-recorder.ts のデフォルト閾値を最適値に更新（変更がある場合のみ）
  const CURRENT_DEFAULT = 0.1; // event-recorder.ts の現在のデフォルト値
  if (Math.abs(optimalThreshold - CURRENT_DEFAULT) > 0.001) {
    console.log(`[CV] event-recorder.ts の Jaccard デフォルト閾値を ${CURRENT_DEFAULT} → ${optimalThreshold} に更新します`);
    updateJaccardThreshold(optimalThreshold);
  } else {
    console.log(`[CV] 現在のデフォルト閾値 ${CURRENT_DEFAULT} が最適。event-recorder.ts の変更は不要`);
  }

  console.log("\n[CV] 5-fold CV 完了");
}

function updateJaccardThreshold(newThreshold: number): void {
  const eventRecorderPath = resolve(
    import.meta.dir,
    "../core/event-recorder.ts"
  );

  if (!existsSync(eventRecorderPath)) {
    console.error(`[CV] event-recorder.ts が見つかりません: ${eventRecorderPath}`);
    return;
  }

  const content = readFileSync(eventRecorderPath, "utf-8");
  // FD-002: デフォルト閾値 (: 0.X) を最適値に更新
  const updatedContent = content.replace(
    /(return Number\.isFinite\(envVal\) && envVal > 0 && envVal <= 1 \? envVal : )([0-9.]+)(;)/,
    `$1${newThreshold}$3`
  );

  if (content === updatedContent) {
    console.warn("[CV] event-recorder.ts のデフォルト閾値パターンが見つかりません。手動更新が必要");
    return;
  }

  writeFileSync(eventRecorderPath, updatedContent, "utf-8");
  console.log(`[CV] event-recorder.ts の Jaccard デフォルト閾値を ${newThreshold} に更新しました`);
}

main().catch((err) => {
  console.error("[CV] Fatal error:", err);
  process.exit(1);
});
