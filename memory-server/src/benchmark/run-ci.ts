/**
 * V5-007 / §32: CI ベンチマークランナースクリプト
 *
 * locomo-120（会話形式、40サンプル×180QA）をメインデータセットとして実行し、
 * cat-1〜cat-4 別スコアを出力する。regression-gate でチェック後、
 * 失敗時は exit code 1 で終了。
 *
 * §32 Phase 3 追加: bilingual-10 / knowledge-update-10 / temporal-10 も統合実行。
 *
 * 使用方法: bun run memory-server/src/benchmark/run-ci.ts
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { runLocomoBenchmark } from "../../../tests/benchmarks/run-locomo-benchmark";
import { HarnessMemCore, type Config } from "../core/harness-mem-core";
import { findModelById } from "../embedding/model-catalog";
import { BenchmarkRunner } from "./runner";

const RESULTS_DIR = join(import.meta.dir, "results");
const LOCOMO_120_PATH = resolve(
  import.meta.dir,
  "../../../tests/benchmarks/fixtures/locomo-120.json",
);
const LOCOMO_120_BASELINE = join(RESULTS_DIR, "locomo-120-baseline.json");
const LOCOMO_120_LATEST = join(RESULTS_DIR, "locomo-120-latest.json");
const CI_MANIFEST_LATEST = join(RESULTS_DIR, "ci-run-manifest-latest.json");
const CI_MANIFEST_HISTORY = join(RESULTS_DIR, "ci-run-manifest-history.jsonl");
const BILINGUAL_50_PATH = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/bilingual-50.json");
const KNOWLEDGE_100_PATH = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/knowledge-update-100.json");
const TEMPORAL_100_PATH = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/temporal-100.json");
const DEV_WORKFLOW_20_PATH = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/dev-workflow-20.json");

interface Locomo120CheckResult {
  passed: boolean;
  baseline_f1: number;
  current_f1: number;
  delta: number;
  message: string;
  by_category: Record<string, { em: number; f1: number }>;
}

function checkLocomo120Regression(currentF1: number, currentByCat: Record<string, { count: number; em: number; f1: number }>): Locomo120CheckResult {
  const THRESHOLD = 0.05; // -5 pp で失敗

  if (!existsSync(LOCOMO_120_BASELINE)) {
    return {
      passed: false,
      baseline_f1: 0,
      current_f1: currentF1,
      delta: 0,
      message: "baseline file not found; strict mode requires baseline",
      by_category: Object.fromEntries(
        Object.entries(currentByCat).map(([cat, v]) => [cat, { em: v.em, f1: v.f1 }])
      ),
    };
  }

  let baselineF1 = 0;
  try {
    const raw = readFileSync(LOCOMO_120_BASELINE, "utf-8");
    const baseline = JSON.parse(raw);
    baselineF1 = baseline.metrics?.overall?.f1 ?? 0;
  } catch {
    return {
      passed: false,
      baseline_f1: 0,
      current_f1: currentF1,
      delta: 0,
      message: "failed to parse baseline; strict mode forbids skip",
      by_category: Object.fromEntries(
        Object.entries(currentByCat).map(([cat, v]) => [cat, { em: v.em, f1: v.f1 }])
      ),
    };
  }
  if (!Number.isFinite(baselineF1) || baselineF1 <= 0) {
    return {
      passed: false,
      baseline_f1: baselineF1,
      current_f1: currentF1,
      delta: 0,
      message: `invalid baseline overall.f1=${baselineF1}; strict mode requires a valid baseline`,
      by_category: Object.fromEntries(
        Object.entries(currentByCat).map(([cat, v]) => [cat, { em: v.em, f1: v.f1 }])
      ),
    };
  }

  const delta = currentF1 - baselineF1;
  const passed = delta >= -THRESHOLD;
  const sign = delta >= 0 ? "+" : "";
  const message = passed
    ? `overall F1: ${currentF1.toFixed(4)} (baseline: ${baselineF1.toFixed(4)}, delta: ${sign}${delta.toFixed(4)})`
    : `REGRESSION DETECTED: overall F1 dropped by ${Math.abs(delta).toFixed(4)} (threshold: ${THRESHOLD}). current=${currentF1.toFixed(4)}, baseline=${baselineF1.toFixed(4)}`;

  return {
    passed,
    baseline_f1: baselineF1,
    current_f1: currentF1,
    delta,
    message,
    by_category: Object.fromEntries(
      Object.entries(currentByCat).map(([cat, v]) => [cat, { em: v.em, f1: v.f1 }])
    ),
  };
}

// ============================================================
// §34 FD-012: 3層 CI ゲート
// ============================================================

const CI_SCORE_HISTORY_PATH = join(RESULTS_DIR, "ci-score-history.json");

interface CIScoreEntry {
  timestamp: string;
  f1: number;
  freshness: number;
  temporal: number;
  bilingual: number;
  embedding?: {
    mode: BenchEmbeddingMode;
    provider: "local" | "fallback";
    model: string;
    vectorDimension: number;
  };
}

interface CIScoreHistory {
  entries: CIScoreEntry[];
}

interface BenchFixtureDescriptor {
  path: string;
  sha256: string;
}

interface BenchFixtureManifest {
  locomo120: BenchFixtureDescriptor;
  bilingual50: BenchFixtureDescriptor;
  knowledge100: BenchFixtureDescriptor;
  temporal100: BenchFixtureDescriptor;
  devWorkflow20: BenchFixtureDescriptor;
}

interface CIRunManifest {
  generated_at: string;
  git_sha: string;
  strict_mode: boolean;
  embedding: {
    mode: BenchEmbeddingMode;
    provider: "local" | "fallback";
    model: string;
    vector_dimension: number;
    onnx_gate: boolean;
    prime_enabled: boolean;
  };
  fixtures: BenchFixtureManifest;
  results: {
    all_passed: boolean;
    locomo_f1: number;
    bilingual_recall: number;
    freshness: number;
    temporal: number;
    cat2_f1: number;
    cat3_f1: number;
  };
}

/** Layer 1: 絶対下限チェック */
function layer1AbsoluteFloor(scores: {
  f1: number;
  freshness: number;
  temporal: number;
  bilingual: number;
}): { passed: boolean; failures: string[] } {
  const FLOORS = {
    f1: 0.20,
    freshness: 0.90,
    temporal: 0.50,
    bilingual: 0.80,
  };
  const failures: string[] = [];
  for (const [key, floor] of Object.entries(FLOORS)) {
    const val = scores[key as keyof typeof scores];
    if (val < floor) {
      failures.push(`${key}=${val.toFixed(4)} < floor=${floor}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

/** Layer 2: 相対回帰チェック（直近3回平均から 2SE 低下で fail） */
function layer2RelativeRegression(
  current: { f1: number; freshness: number; temporal: number; bilingual: number },
  history: CIScoreHistory,
  profile: BenchEmbeddingProfile
): { passed: boolean; failures: string[] } {
  const recent = selectComparableHistoryEntries(history.entries, profile).slice(-3);
  if (recent.length < 2) {
    // S38 bootstrap: 履歴不足時は相対回帰判定をスキップし、まず同一プロファイル履歴を蓄積する。
    return { passed: true, failures: [] };
  }

  const failures: string[] = [];
  const metrics: Array<keyof typeof current> = ["f1", "freshness", "temporal", "bilingual"];
  for (const metric of metrics) {
    const vals = recent.map((e) => e[metric]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const se = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)) / Math.sqrt(vals.length);
    const threshold = mean - 2 * se;
    const cur = current[metric];
    if (cur < threshold) {
      failures.push(`${metric}=${cur.toFixed(4)} < mean-2SE=${threshold.toFixed(4)} (mean=${mean.toFixed(4)}, se=${se.toFixed(4)})`);
    }
  }
  return { passed: failures.length === 0, failures };
}

function isSameEmbeddingProfile(
  entryProfile: CIScoreEntry["embedding"] | undefined,
  currentProfile: BenchEmbeddingProfile
): boolean {
  if (!entryProfile) return false;
  return (
    entryProfile.mode === currentProfile.mode &&
    entryProfile.provider === currentProfile.provider &&
    entryProfile.model === currentProfile.model &&
    entryProfile.vectorDimension === currentProfile.vectorDimension
  );
}

function selectComparableHistoryEntries(entries: CIScoreEntry[], profile: BenchEmbeddingProfile): CIScoreEntry[] {
  if (entries.length === 0) return [];
  return entries.filter((entry) => isSameEmbeddingProfile(entry.embedding, profile));
}

/** Wilcoxon signed-rank test (two-sided, p < alpha で有意) */
function wilcoxonSignedRank(before: number[], after: number[], alpha = 0.05): { p: number; significant: boolean } {
  const diffs = before.map((b, i) => after[i] - b).filter((d) => d !== 0);
  if (diffs.length === 0) return { p: 1, significant: false };

  const ranked = diffs
    .map((d, i) => ({ sign: d > 0 ? 1 : -1, rank: i, abs: Math.abs(d) }))
    .sort((a, b) => a.abs - b.abs)
    .map((item, i) => ({ ...item, rank: i + 1 }));

  let Wplus = 0;
  let Wminus = 0;
  for (const r of ranked) {
    if (r.sign > 0) Wplus += r.rank;
    else Wminus += r.rank;
  }
  const W = Math.min(Wplus, Wminus);
  const n = diffs.length;
  // 正規近似（n >= 10 程度で有効）
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  const z = sigma > 0 ? (W - mu) / sigma : 0;
  // 両側 p 値（正規分布近似）
  const absZ = Math.abs(z);
  // Abramowitz and Stegun 近似式 7.1.26
  const t = 1 / (1 + 0.2316419 * absZ);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const phi = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI);
  const pOneSide = phi * poly;
  const p = 2 * pOneSide;
  return { p: Math.min(p, 1), significant: p < alpha };
}

/** Layer 3: Wilcoxon 改善主張検証（HARNESS_BENCH_ASSERT_IMPROVEMENT=1 で有効） */
function layer3WilcoxonImprovement(
  beforeScores: number[],
  afterScores: number[],
  label: string
): { passed: boolean; skipped: boolean; message: string } {
  if (process.env.HARNESS_BENCH_ASSERT_IMPROVEMENT !== "1") {
    return { passed: true, skipped: true, message: `${label}: skipped (set HARNESS_BENCH_ASSERT_IMPROVEMENT=1 to enable)` };
  }
  if (beforeScores.length === 0 || afterScores.length === 0) {
    return { passed: true, skipped: true, message: `${label}: skipped (no before/after scores)` };
  }
  const { p, significant } = wilcoxonSignedRank(beforeScores, afterScores);
  const passed = significant;
  return {
    passed,
    skipped: false,
    message: passed
      ? `${label}: Wilcoxon p=${p.toFixed(4)} < 0.05 (significant improvement)`
      : `${label}: Wilcoxon p=${p.toFixed(4)} >= 0.05 (improvement NOT significant)`,
  };
}

interface DevWorkflowEntry {
  id: string;
  content: string;
  timestamp: string;
}

interface DevWorkflowCase {
  id: string;
  description: string;
  difficulty: string;
  entries: DevWorkflowEntry[];
  query: string;
  expected_answer: string;
  relevant_ids: string[];
}

/** §34 FD-015: dev-workflow-20 ベンチマーク（実使用パターン recall@10） */
async function runDevWorkflowBenchmark(
  fixturePath: string
): Promise<{ recall: number; perSampleScores: number[]; cacheStats: CacheStatsSummary }> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const cases = JSON.parse(raw) as DevWorkflowCase[];
    const project = "ci-dev-workflow";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);
    const cacheBefore = await readCacheStats(core);

    await maybePrimeEmbedding(
      core,
      cases.flatMap((dwCase) => dwCase.entries.map((entry) => entry.content)),
      "passage"
    );
    await maybePrimeEmbedding(
      core,
      cases.map((dwCase) => dwCase.query),
      "query"
    );

    for (const dwCase of cases) {
      for (const entry of dwCase.entries) {
        core.recordEvent({
          event_id: entry.id,
          platform: "claude",
          project,
          session_id: `dw-session-${dwCase.id}`,
          event_type: "user_prompt",
          ts: entry.timestamp,
          payload: { content: entry.content },
          tags: [],
          privacy_tags: [],
        });
      }
    }

    const perSampleScores: number[] = [];
    for (const dwCase of cases) {
      const result = core.search({ query: dwCase.query, project, include_private: true, limit: 10 });
      const retrievedIds = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      const relevantIds = dwCase.relevant_ids.map((rid) => `obs_${rid}`);
      const recall = runner.calculateRecallAtK(retrievedIds, relevantIds, 10);
      perSampleScores.push(recall);
    }

    const recall = perSampleScores.length > 0 ? perSampleScores.reduce((a, b) => a + b, 0) / perSampleScores.length : 0;
    const cacheAfter = await readCacheStats(core);
    return { recall, perSampleScores, cacheStats: summarizeCacheStats(cacheBefore, cacheAfter) };
  } finally {
    core.shutdown("ci-dev-workflow");
    rmSync(dir, { recursive: true, force: true });
  }
}

/** スコア履歴を読み込む */
function loadScoreHistory(): CIScoreHistory {
  if (!existsSync(CI_SCORE_HISTORY_PATH)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(CI_SCORE_HISTORY_PATH, "utf-8")) as CIScoreHistory;
  } catch {
    return { entries: [] };
  }
}

/** スコア履歴に追記する */
function appendScoreHistory(scores: { f1: number; freshness: number; temporal: number; bilingual: number }): void {
  const history = loadScoreHistory();
  history.entries.push({
    timestamp: new Date().toISOString(),
    ...scores,
    embedding: {
      mode: BENCH_EMBEDDING.mode,
      provider: BENCH_EMBEDDING.provider,
      model: BENCH_EMBEDDING.model,
      vectorDimension: BENCH_EMBEDDING.vectorDimension,
    },
  });
  // 最大30件まで保持
  if (history.entries.length > 30) history.entries = history.entries.slice(-30);
  writeFileSync(CI_SCORE_HISTORY_PATH, JSON.stringify(history, null, 2));
}

type BenchEmbeddingMode = "onnx" | "fallback";

interface BenchEmbeddingProfile {
  mode: BenchEmbeddingMode;
  provider: "local" | "fallback";
  model: string;
  vectorDimension: number;
  gateEnabled: boolean;
  primeEnabled: boolean;
}

interface EmbeddingRuntime {
  provider: string;
  model: string;
  healthStatus: string;
  healthDetails: string;
}

interface CacheStatsSummary {
  available: boolean;
  before: Record<string, number>;
  after: Record<string, number>;
  delta: Record<string, number>;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function readGitSha(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: resolve(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return "unknown";
    const sha = result.stdout.toString().trim();
    return sha.length > 0 ? sha : "unknown";
  } catch {
    return "unknown";
  }
}

function normalizeMode(value: string | undefined): BenchEmbeddingMode {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "onnx") return "onnx";
  return "fallback";
}

function assertOnnxOnlyMode(mode: BenchEmbeddingMode): void {
  if (mode !== "onnx") {
    throw new Error(`[CI] strict ONNX-only mode violated: HARNESS_BENCH_EMBEDDING_MODE=${mode}`);
  }
}

function resolveNumericGate(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  if (raw < 0 || raw > 1) return fallback;
  return raw;
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
const BENCH_STRICT_MODE = true;
const PANIC_MARKERS = ["panic(main thread)", "oh no: Bun has crashed"];

function assertNoPanicMarkerFromEnv(): void {
  if (process.env.HARNESS_BENCH_PANIC_DETECTED === "1") {
    throw new Error("[CI] panic marker detected by wrapper; benchmark run invalid");
  }
}

function writeRunManifest(manifest: CIRunManifest): void {
  writeFileSync(CI_MANIFEST_LATEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  appendFileSync(CI_MANIFEST_HISTORY, `${JSON.stringify(manifest)}\n`, "utf-8");
}

function sha256File(path: string): string {
  try {
    const raw = readFileSync(path);
    return createHash("sha256").update(raw).digest("hex");
  } catch {
    return "missing";
  }
}

function buildFixtureManifest(): BenchFixtureManifest {
  return {
    locomo120: { path: LOCOMO_120_PATH, sha256: sha256File(LOCOMO_120_PATH) },
    bilingual50: { path: BILINGUAL_50_PATH, sha256: sha256File(BILINGUAL_50_PATH) },
    knowledge100: { path: KNOWLEDGE_100_PATH, sha256: sha256File(KNOWLEDGE_100_PATH) },
    temporal100: { path: TEMPORAL_100_PATH, sha256: sha256File(TEMPORAL_100_PATH) },
    devWorkflow20: { path: DEV_WORKFLOW_20_PATH, sha256: sha256File(DEV_WORKFLOW_20_PATH) },
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function readEmbeddingRuntime(core: HarnessMemCore): EmbeddingRuntime {
  const health = core.health();
  const item = toRecord(health.items[0]);
  const features = toRecord(item.features);
  return {
    provider: String(features.embedding_provider || item.embedding_provider || ""),
    model: String(features.embedding_model || ""),
    healthStatus: String(item.embedding_provider_status || ""),
    healthDetails: String(item.embedding_provider_details || ""),
  };
}

function verifyEmbeddingGate(core: HarnessMemCore, label: string): void {
  if (!BENCH_EMBEDDING.gateEnabled || BENCH_EMBEDDING.mode !== "onnx") {
    return;
  }
  const runtime = readEmbeddingRuntime(core);
  const failures: string[] = [];
  if (runtime.provider !== BENCH_EMBEDDING.provider) {
    failures.push(`provider=${runtime.provider || "unknown"} (expected ${BENCH_EMBEDDING.provider})`);
  }
  if (runtime.model !== BENCH_EMBEDDING.model) {
    failures.push(`model=${runtime.model || "unknown"} (expected ${BENCH_EMBEDDING.model})`);
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
      const result = target.primeEmbedding.call(core, text, mode);
      if (isPromiseLike(result)) {
        await result;
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

interface BilingualSample {
  id: string;
  pattern: string;
  content: string;
  query: string;
  relevant_ids: string[];
}

interface BilingualFailureCase {
  id: string;
  query: string;
  recall: number;
  expected: string[];
  top10: string[];
}

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

interface TemporalEntry {
  id: string;
  content: string;
  timestamp: string;
}

interface TemporalCase {
  id: string;
  description: string;
  entries: TemporalEntry[];
  query: string;
  expected_order: string[];
  domain?: string;
}

function createTempCore(): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-ci-bench-"));
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
  verifyEmbeddingGate(core, "run-ci");
  return { core, dir };
}

async function runBilingualBenchmark(
  fixturePath: string
): Promise<{
  recall: number;
  passed: boolean;
  gate: number;
  perSampleScores: number[];
  cacheStats: CacheStatsSummary;
  failures: BilingualFailureCase[];
}> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const fixture = JSON.parse(raw) as { samples: BilingualSample[] };
    const samples = fixture.samples;
    const project = "ci-bilingual";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);
    const cacheBefore = await readCacheStats(core);

    await maybePrimeEmbedding(
      core,
      samples.map((sample) => sample.content),
      "passage"
    );
    await maybePrimeEmbedding(
      core,
      samples.map((sample) => sample.query),
      "query"
    );

    // コンテンツを投入
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      core.recordEvent({
        event_id: s.id,
        platform: "claude",
        project,
        session_id: "ci-bilingual-session",
        event_type: "user_prompt",
        ts: new Date(Date.now() - (samples.length - i) * 60_000).toISOString(),
        payload: { content: s.content },
        tags: [],
        privacy_tags: [],
      });
    }

    // recall@10 を計測（§34 FD-011: per-sample スコアも収集）
    const perSampleScores: number[] = [];
    const failures: BilingualFailureCase[] = [];
    for (const s of samples) {
      const result = core.search({ query: s.query, project, include_private: true, limit: 10 });
      const retrievedIds = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      const relevantIds = s.relevant_ids.map((rid) => `obs_${rid}`);
      const recall = runner.calculateRecallAtK(retrievedIds, relevantIds, 10);
      perSampleScores.push(recall);
      if (recall < 1) {
        failures.push({
          id: s.id,
          query: s.query,
          recall,
          expected: relevantIds,
          top10: retrievedIds.slice(0, 10),
        });
      }
    }

    const recall = perSampleScores.length > 0 ? perSampleScores.reduce((a, b) => a + b, 0) / perSampleScores.length : 0;
    const envGate = Number(process.env.HARNESS_BENCH_BILINGUAL_GATE);
    const gate = Number.isFinite(envGate) && envGate >= 0 && envGate <= 1 ? envGate : 0.80;
    const passed = recall >= gate;
    const cacheAfter = await readCacheStats(core);
    return {
      recall,
      passed,
      gate,
      perSampleScores,
      cacheStats: summarizeCacheStats(cacheBefore, cacheAfter),
      failures,
    };
  } finally {
    core.shutdown("ci-bilingual");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runKnowledgeUpdateBenchmark(
  fixturePath: string
): Promise<{
  freshnessAtK: number;
  passed: boolean;
  freshnessGate: number;
  perSampleScores: number[];
  cacheStats: CacheStatsSummary;
}> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const cases = JSON.parse(raw) as KnowledgeUpdateCase[];
    const project = "ci-knowledge-update";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);
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

    const scores: number[] = [];

    for (const kCase of cases) {
      // 古い記録を投入
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
      // 新しい記録を投入
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

      const result = core.search({ query: kCase.query, project, include_private: true, limit: 10, exclude_updated: true });
      const retrievedIds = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      const newId = `obs_${kCase.expected_latest_id}`;
      const oldIds = kCase.old_entries.map((e) => `obs_${e.id}`);

      const score = runner.calculateFreshnessAtK(retrievedIds, newId, oldIds, 10);
      scores.push(score);
    }

    const freshnessAtK = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const envGate = Number(process.env.HARNESS_BENCH_FRESHNESS_GATE);
    const freshnessGate = Number.isFinite(envGate) && envGate >= 0 && envGate <= 1 ? envGate : 0.50;
    const passed = freshnessAtK >= freshnessGate;
    const cacheAfter = await readCacheStats(core);
    return {
      freshnessAtK,
      passed,
      freshnessGate,
      perSampleScores: scores,
      cacheStats: summarizeCacheStats(cacheBefore, cacheAfter),
    };
  } finally {
    core.shutdown("ci-knowledge-update");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runTemporalBenchmark(fixturePath: string): Promise<{
  temporalScore: number;
  weightedTau: number;
  ndcgAt5: number;
  passed: boolean;
  temporalGate: number;
  perSampleScores: number[];
  domainBreakdown: Record<string, { tau: number; n: number }>;
  cacheStats: CacheStatsSummary;
}> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const cases = JSON.parse(raw) as TemporalCase[];
    const project = "ci-temporal";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);
    const cacheBefore = await readCacheStats(core);

    await maybePrimeEmbedding(
      core,
      cases.flatMap((tCase) => tCase.entries.map((entry) => entry.content)),
      "passage"
    );
    await maybePrimeEmbedding(
      core,
      cases.map((tCase) => tCase.query),
      "query"
    );

    const scores: number[] = [];
    const weightedTauScores: number[] = [];
    const ndcgScores: number[] = [];
    const domainTauScores: Record<string, number[]> = {};

    for (const tCase of cases) {
      for (const entry of tCase.entries) {
        core.recordEvent({
          event_id: entry.id,
          platform: "claude",
          project,
          session_id: `temporal-session-${tCase.id}`,
          event_type: "user_prompt",
          ts: entry.timestamp,
          payload: { content: entry.content },
          tags: [],
          privacy_tags: [],
        });
      }

      const result = core.search({ query: tCase.query, project, include_private: true, limit: 10 });
      const retrievedIds = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      const expectedOrderIds = tCase.expected_order.map((id) => `obs_${id}`);

      // §34 FD-004: 3指標並行計算
      const score = runner.calculateTemporalOrderScore(retrievedIds, expectedOrderIds, 10);
      const weightedTau = runner.calculateWeightedKendallTau(retrievedIds, expectedOrderIds, 10);
      const ndcg = runner.calculateNDCGAtK(retrievedIds, expectedOrderIds, 5);

      scores.push(score);
      weightedTauScores.push(weightedTau);
      ndcgScores.push(ndcg);

      // ドメイン別 tau スコアを蓄積
      if (tCase.domain) {
        if (!domainTauScores[tCase.domain]) {
          domainTauScores[tCase.domain] = [];
        }
        domainTauScores[tCase.domain].push(weightedTau);
      }
    }

    const temporalScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const weightedTau = weightedTauScores.length > 0 ? weightedTauScores.reduce((a, b) => a + b, 0) / weightedTauScores.length : 0;
    const ndcgAt5 = ndcgScores.length > 0 ? ndcgScores.reduce((a, b) => a + b, 0) / ndcgScores.length : 0;
    const envTemporalGate = Number(process.env.HARNESS_BENCH_TEMPORAL_GATE);
    const temporalGate = Number.isFinite(envTemporalGate) && envTemporalGate >= 0 && envTemporalGate <= 1 ? envTemporalGate : 0.55;
    const passed = temporalScore >= temporalGate;

    // ドメイン別の平均 tau をまとめる
    const domainBreakdown: Record<string, { tau: number; n: number }> = {};
    for (const [domain, tauList] of Object.entries(domainTauScores)) {
      const avg = tauList.reduce((a, b) => a + b, 0) / tauList.length;
      domainBreakdown[domain] = { tau: avg, n: tauList.length };
    }

    // --verbose 時にドメイン別 tau を出力
    if (process.argv.includes("--verbose") && Object.keys(domainBreakdown).length > 0) {
      console.log("[CI] temporal-100 by-domain:");
      for (const [domain, { tau, n }] of Object.entries(domainBreakdown)) {
        console.log(`  ${domain}: tau=${tau.toFixed(3)} (n=${n})`);
      }
    }

    const cacheAfter = await readCacheStats(core);
    return {
      temporalScore,
      weightedTau,
      ndcgAt5,
      passed,
      temporalGate,
      perSampleScores: weightedTauScores,
      domainBreakdown,
      cacheStats: summarizeCacheStats(cacheBefore, cacheAfter),
    };
  } finally {
    core.shutdown("ci-temporal");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  assertNoPanicMarkerFromEnv();
  console.log("[CI] §34 Benchmark CI Runner (locomo-120 + bilingual-30 + knowledge-update + temporal)");
  console.log(
    `[CI] embedding profile: mode=${BENCH_EMBEDDING.mode}, provider=${BENCH_EMBEDDING.provider}, ` +
      `model=${BENCH_EMBEDDING.model}, vector_dim=${BENCH_EMBEDDING.vectorDimension}, ` +
      `onnx_gate=${BENCH_EMBEDDING.gateEnabled}, prime=${BENCH_EMBEDDING.primeEnabled}`
  );
  console.log(`[CI] strict_mode=${BENCH_STRICT_MODE} panic_markers=${PANIC_MARKERS.join(" | ")}`);

  // ベンチマーク専用設定
  process.env.HARNESS_MEM_DECAY_DISABLED = "1";
  process.env.HARNESS_MEM_RERANKER_ENABLED = "1";
  process.env.HARNESS_BENCH_EMBEDDING_MODE = "onnx";
  process.env.HARNESS_MEM_EMBEDDING_MODEL = BENCH_EMBEDDING.model;

  mkdirSync(RESULTS_DIR, { recursive: true });

  let allPassed = true;
  let locomoF1 = 0;
  let cat2F1 = 0;
  let cat3F1 = 0;
  const cat2Gate = resolveNumericGate("HARNESS_BENCH_CAT2_F1_GATE", 0.20);
  const cat3Gate = resolveNumericGate("HARNESS_BENCH_CAT3_F1_GATE", 0.24);
  const fixtureManifest = buildFixtureManifest();

  // §34 FD-012: 3層 CI ゲート用スコア集約
  const ciScores = { f1: 0, freshness: 0, temporal: 0, bilingual: 0 };

  // §34 FD-011: Bootstrap CI 計算用 runner（stub core）
  const stubCore = {
    recordEvent: (_: unknown) => {},
    search: (_: unknown) => ({ items: [] as Array<{ id: string }> }),
  };
  const ciRunner = new BenchmarkRunner(stubCore as ConstructorParameters<typeof BenchmarkRunner>[0]);

  // --- locomo-120 ベンチマーク（メイン） ---
  console.log(`\n[CI] Running locomo-120 benchmark (${LOCOMO_120_PATH})`);
  try {
    const result = await runLocomoBenchmark({
      system: "harness-mem",
      datasetPath: LOCOMO_120_PATH,
      outputPath: LOCOMO_120_LATEST,
      embeddingMode: BENCH_EMBEDDING.mode,
      embeddingModel: BENCH_EMBEDDING.model,
      vectorDimension: BENCH_EMBEDDING.vectorDimension,
      onnxGate: BENCH_EMBEDDING.gateEnabled,
      primeEmbedding: BENCH_EMBEDDING.primeEnabled,
    });

    const overallF1 = result.metrics.overall.f1;
    const overallEM = result.metrics.overall.em;
    const byCat = result.metrics.by_category;
    locomoF1 = overallF1;
    cat2F1 = byCat["cat-2"]?.f1 ?? 0;
    cat3F1 = byCat["cat-3"]?.f1 ?? 0;

    console.log(`[CI] locomo-120 overall: EM=${overallEM.toFixed(4)}, F1=${overallF1.toFixed(4)}`);
    console.log(`[CI] locomo-120 samples=${result.dataset.sample_count}, qa=${result.dataset.qa_count}`);
    console.log("[CI] by_category:");
    for (const [cat, scores] of Object.entries(byCat)) {
      console.log(`  ${cat}: EM=${scores.em.toFixed(4)}, F1=${scores.f1.toFixed(4)} (n=${scores.count})`);
    }
    console.log(`[CI] Saved to ${LOCOMO_120_LATEST}`);
    console.log(
      `[CI] locomo-120 cacheStats: available=${result.performance.cache_stats.available} ` +
        `delta=${JSON.stringify(result.performance.cache_stats.delta)}`
    );

    if (result.pipeline.embedding.gate.enabled && !result.pipeline.embedding.gate.passed) {
      throw new Error(`[CI] locomo-120 ONNX gate failed: ${result.pipeline.embedding.gate.failures.join(", ")}`);
    }
    if (result.pipeline.embedding.mode !== "onnx") {
      throw new Error(`[CI] locomo-120 invalid embedding mode=${result.pipeline.embedding.mode}; strict mode requires onnx`);
    }

    ciScores.f1 = overallF1; // §34 FD-012: 3層ゲート用

    const regressionResult = checkLocomo120Regression(overallF1, byCat);
    if (regressionResult.passed) {
      console.log(`[CI] Regression check PASSED: ${regressionResult.message}`);
    } else {
      console.error(`[CI] Regression check FAILED: ${regressionResult.message}`);
      allPassed = false;
    }

    if (cat2F1 < cat2Gate) {
      console.error(`[CI] cat-2 gate FAILED: f1=${cat2F1.toFixed(4)} < ${cat2Gate.toFixed(4)}`);
      allPassed = false;
    } else {
      console.log(`[CI] cat-2 gate PASSED: f1=${cat2F1.toFixed(4)} >= ${cat2Gate.toFixed(4)}`);
    }
    if (cat3F1 < cat3Gate) {
      console.error(`[CI] cat-3 gate FAILED: f1=${cat3F1.toFixed(4)} < ${cat3Gate.toFixed(4)}`);
      allPassed = false;
    } else {
      console.log(`[CI] cat-3 gate PASSED: f1=${cat3F1.toFixed(4)} >= ${cat3Gate.toFixed(4)}`);
    }
  } catch (err) {
    console.error(`[CI] locomo-120 benchmark error: ${err instanceof Error ? err.message : String(err)}`);
    allPassed = false;
  }

  // --- bilingual ベンチマーク（strict: bilingual-50 固定）---
  if (existsSync(BILINGUAL_50_PATH)) {
    console.log("\n[CI] Running bilingual-50 benchmark");
    try {
      const { recall, passed, gate, perSampleScores: biScores, cacheStats, failures } = await runBilingualBenchmark(
        BILINGUAL_50_PATH
      );
      const biCI = ciRunner.bootstrapCI(biScores);
      ciScores.bilingual = recall; // §34 FD-012: 3層ゲート用
      console.log(`[CI] bilingual-50 recall@10: ${recall.toFixed(4)} (threshold: ${gate})`);
      console.log(`[CI] bilingual-50 95% Bootstrap CI: [${biCI.lower.toFixed(4)}, ${biCI.upper.toFixed(4)}] (method: ${biCI.method})`);
      console.log(`[CI] bilingual-50 cacheStats delta: ${JSON.stringify(cacheStats.delta)}`);
      if (passed) {
        console.log("[CI] bilingual-50 PASSED");
      } else {
        console.error(`[CI] bilingual-50 FAILED: recall@10=${recall.toFixed(4)} < ${gate}`);
        if (failures.length > 0) {
          const preview = failures.slice(0, 10).map((failure) => ({
            id: failure.id,
            recall: Number(failure.recall.toFixed(3)),
            query: failure.query,
            expected: failure.expected,
            top10: failure.top10.slice(0, 5),
          }));
          console.error(`[CI] bilingual-50 top failures (first 10): ${JSON.stringify(preview)}`);
        }
        allPassed = false;
      }
    } catch (err) {
      console.error(`[CI] bilingual-50 error: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }
  } else {
    console.error(`[CI] required fixture missing: ${BILINGUAL_50_PATH}`);
    allPassed = false;
  }

  // --- knowledge-update-100 ベンチマーク（strict: 100 固定）---
  if (existsSync(KNOWLEDGE_100_PATH)) {
    console.log("\n[CI] Running knowledge-update-100 benchmark");
    try {
      const { freshnessAtK, passed, freshnessGate, perSampleScores: kuScores, cacheStats } = await runKnowledgeUpdateBenchmark(KNOWLEDGE_100_PATH);
      const kuCI = ciRunner.bootstrapCI(kuScores);
      ciScores.freshness = freshnessAtK; // §34 FD-012: 3層ゲート用
      const gateSource = process.env.HARNESS_BENCH_FRESHNESS_GATE ? "env" : "default";
      console.log(`[CI] knowledge-update-100 Freshness@K: ${freshnessAtK.toFixed(4)} (threshold: ${freshnessGate} [${gateSource}])`);
      console.log(`[CI] knowledge-update-100 95% Bootstrap CI: [${kuCI.lower.toFixed(4)}, ${kuCI.upper.toFixed(4)}] (method: ${kuCI.method})`);
      console.log(`[CI] knowledge-update-100 cacheStats delta: ${JSON.stringify(cacheStats.delta)}`);
      if (passed) {
        console.log("[CI] knowledge-update-100 PASSED");
      } else {
        console.error(`[CI] knowledge-update-100 FAILED: Freshness@K=${freshnessAtK.toFixed(4)} < ${freshnessGate}`);
        allPassed = false;
      }
    } catch (err) {
      console.error(`[CI] knowledge-update-100 error: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }
  } else {
    console.error(`[CI] required fixture missing: ${KNOWLEDGE_100_PATH}`);
    allPassed = false;
  }

  // --- temporal-100 ベンチマーク（strict: 100 固定）---
  if (existsSync(TEMPORAL_100_PATH)) {
    console.log("\n[CI] Running temporal-100 benchmark");
    try {
      const { temporalScore, weightedTau, ndcgAt5, passed, temporalGate, perSampleScores: tScores, cacheStats } = await runTemporalBenchmark(TEMPORAL_100_PATH);
      const tCI = ciRunner.bootstrapCI(tScores);
      ciScores.temporal = temporalScore; // §34 FD-012: 3層ゲート用
      const temporalGateSource = process.env.HARNESS_BENCH_TEMPORAL_GATE ? "env" : "default";
      // §34 FD-004: 3指標並行報告（Order Score / Weighted Kendall tau / nDCG@5）
      console.log(`[CI] temporal-100 Order Score: ${temporalScore.toFixed(4)} (threshold: ${temporalGate} [${temporalGateSource}])`);
      console.log(`[CI] temporal-100 95% Bootstrap CI: [${tCI.lower.toFixed(4)}, ${tCI.upper.toFixed(4)}] (method: ${tCI.method})`);
      console.log(`[CI] temporal-100 Weighted Kendall tau: ${weightedTau.toFixed(4)}`);
      console.log(`[CI] temporal-100 nDCG@5: ${ndcgAt5.toFixed(4)}`);
      console.log(`[CI] temporal-100 cacheStats delta: ${JSON.stringify(cacheStats.delta)}`);
      if (passed) {
        console.log("[CI] temporal-100 PASSED");
      } else {
        console.error(`[CI] temporal-100 FAILED: score=${temporalScore.toFixed(4)} < ${temporalGate}`);
        allPassed = false;
      }
    } catch (err) {
      console.error(`[CI] temporal-100 error: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }
  } else {
    console.error(`[CI] required fixture missing: ${TEMPORAL_100_PATH}`);
    allPassed = false;
  }

  // --- dev-workflow-20 ベンチマーク（§34 FD-015: 実使用パターン、WARNING のみ）---
  if (existsSync(DEV_WORKFLOW_20_PATH)) {
    console.log(`\n[CI] Running dev-workflow-20 benchmark`);
    try {
      const { recall, perSampleScores: dwScores, cacheStats } = await runDevWorkflowBenchmark(DEV_WORKFLOW_20_PATH);
      const dwCI = ciRunner.bootstrapCI(dwScores);
      console.log(`[CI] dev-workflow-20 recall@10: ${recall.toFixed(4)}`);
      console.log(`[CI] dev-workflow-20 95% Bootstrap CI: [${dwCI.lower.toFixed(4)}, ${dwCI.upper.toFixed(4)}] (method: ${dwCI.method})`);
      console.log(`[CI] dev-workflow-20 cacheStats delta: ${JSON.stringify(cacheStats.delta)}`);
      if (recall >= 0.5) {
        console.log(`[CI] dev-workflow-20 OK`);
      } else {
        console.warn(`[CI] dev-workflow-20 WARNING: recall@10=${recall.toFixed(4)} < 0.5 (real-usage quality concern)`);
        // WARNING only — dev-workflow は参考指標のため CI を落とさない
      }
    } catch (err) {
      console.warn(`[CI] dev-workflow-20 WARNING: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log("[CI] dev-workflow-20 fixture not found, skipping");
  }

  // §34 FD-012: 3層 CI ゲート
  console.log("\n[CI] === 3-Layer CI Gate ===");
  const history = loadScoreHistory();

  // Layer 1: 絶対下限
  const l1 = layer1AbsoluteFloor(ciScores);
  if (l1.passed) {
    console.log("[CI] Layer 1 (Absolute Floor): PASSED");
  } else {
    console.error(`[CI] Layer 1 (Absolute Floor): FAILED — ${l1.failures.join(", ")}`);
    allPassed = false;
  }

  // Layer 2: 相対回帰（直近3回平均から2SE低下で fail）
  const l2 = layer2RelativeRegression(ciScores, history, BENCH_EMBEDDING);
  if (l2.passed) {
    console.log(`[CI] Layer 2 (Relative Regression): PASSED (history=${history.entries.length} entries)`);
  } else {
    console.error(`[CI] Layer 2 (Relative Regression): FAILED — ${l2.failures.join(", ")}`);
    allPassed = false;
  }

  // Layer 3: Wilcoxon改善主張検証（HARNESS_BENCH_ASSERT_IMPROVEMENT=1 で有効）
  const l3 = layer3WilcoxonImprovement([], [], "global");
  if (l3.skipped) {
    console.log(`[CI] Layer 3 (Wilcoxon): ${l3.message}`);
  } else if (l3.passed) {
    console.log(`[CI] Layer 3 (Wilcoxon): PASSED — ${l3.message}`);
  } else {
    console.error(`[CI] Layer 3 (Wilcoxon): FAILED — ${l3.message}`);
    allPassed = false;
  }

  // スコアを履歴に追記（全ゲート通過した場合のみ）
  if (allPassed) {
    appendScoreHistory(ciScores);
    console.log(`[CI] Score appended to history: f1=${ciScores.f1.toFixed(4)}, freshness=${ciScores.freshness.toFixed(4)}, temporal=${ciScores.temporal.toFixed(4)}, bilingual=${ciScores.bilingual.toFixed(4)}`);
  }

  const manifest: CIRunManifest = {
    generated_at: new Date().toISOString(),
    git_sha: readGitSha(),
    strict_mode: BENCH_STRICT_MODE,
    embedding: {
      mode: BENCH_EMBEDDING.mode,
      provider: BENCH_EMBEDDING.provider,
      model: BENCH_EMBEDDING.model,
      vector_dimension: BENCH_EMBEDDING.vectorDimension,
      onnx_gate: BENCH_EMBEDDING.gateEnabled,
      prime_enabled: BENCH_EMBEDDING.primeEnabled,
    },
    fixtures: fixtureManifest,
    results: {
      all_passed: allPassed,
      locomo_f1: locomoF1,
      bilingual_recall: ciScores.bilingual,
      freshness: ciScores.freshness,
      temporal: ciScores.temporal,
      cat2_f1: cat2F1,
      cat3_f1: cat3F1,
    },
  };
  writeRunManifest(manifest);
  console.log(`[CI] run manifest written: ${CI_MANIFEST_LATEST}`);

  if (!allPassed) {
    console.error("\n[CI] One or more benchmark regression checks FAILED");
    process.exit(1);
  }

  console.log("\n[CI] All benchmarks passed");
}

main().catch((err) => {
  console.error("[CI] Fatal error:", err);
  process.exit(1);
});
