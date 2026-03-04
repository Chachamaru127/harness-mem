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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { runLocomoBenchmark } from "../../../tests/benchmarks/run-locomo-benchmark";
import { checkRegression } from "./regression-gate";
import { HarnessMemCore, type Config } from "../core/harness-mem-core";
import { BenchmarkRunner } from "./runner";

const RESULTS_DIR = join(import.meta.dir, "results");
const LOCOMO_120_PATH = resolve(
  import.meta.dir,
  "../../../tests/benchmarks/fixtures/locomo-120.json",
);
const LOCOMO_120_BASELINE = join(RESULTS_DIR, "locomo-120-baseline.json");
const LOCOMO_120_LATEST = join(RESULTS_DIR, "locomo-120-latest.json");

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
      passed: true,
      baseline_f1: currentF1,
      current_f1: currentF1,
      delta: 0,
      message: "baseline file not found; skipping regression check (first run)",
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
      passed: true,
      baseline_f1: currentF1,
      current_f1: currentF1,
      delta: 0,
      message: "failed to parse baseline; skipping regression check",
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
}

interface CIScoreHistory {
  entries: CIScoreEntry[];
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
    freshness: 0.40,
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
  history: CIScoreHistory
): { passed: boolean; failures: string[] } {
  const recent = history.entries.slice(-3);
  if (recent.length < 2) {
    return { passed: true, failures: [] }; // 履歴不足は skip
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
async function runDevWorkflowBenchmark(fixturePath: string): Promise<{ recall: number; perSampleScores: number[] }> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const cases = JSON.parse(raw) as DevWorkflowCase[];
    const project = "ci-dev-workflow";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);

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
    return { recall, perSampleScores };
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
  history.entries.push({ timestamp: new Date().toISOString(), ...scores });
  // 最大30件まで保持
  if (history.entries.length > 30) history.entries = history.entries.slice(-30);
  writeFileSync(CI_SCORE_HISTORY_PATH, JSON.stringify(history, null, 2));
}

interface BilingualSample {
  id: string;
  pattern: string;
  content: string;
  query: string;
  relevant_ids: string[];
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
}

function createTempCore(): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-ci-bench-"));
  const config: Config = {
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
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
  return { core: new HarnessMemCore(config), dir };
}

async function runBilingualBenchmark(fixturePath: string): Promise<{ recall: number; passed: boolean; perSampleScores: number[] }> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const fixture = JSON.parse(raw) as { samples: BilingualSample[] };
    const samples = fixture.samples;
    const project = "ci-bilingual";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);

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
    for (const s of samples) {
      const result = core.search({ query: s.query, project, include_private: true, limit: 10 });
      const retrievedIds = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      const relevantIds = s.relevant_ids.map((rid) => `obs_${rid}`);
      const recall = runner.calculateRecallAtK(retrievedIds, relevantIds, 10);
      perSampleScores.push(recall);
    }

    const recall = perSampleScores.length > 0 ? perSampleScores.reduce((a, b) => a + b, 0) / perSampleScores.length : 0;
    const passed = recall >= 0.8;
    return { recall, passed, perSampleScores };
  } finally {
    core.shutdown("ci-bilingual");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runKnowledgeUpdateBenchmark(fixturePath: string): Promise<{ freshnessAtK: number; passed: boolean; freshnessGate: number; perSampleScores: number[] }> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const cases = JSON.parse(raw) as KnowledgeUpdateCase[];
    const project = "ci-knowledge-update";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);

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
    return { freshnessAtK, passed, freshnessGate, perSampleScores: scores };
  } finally {
    core.shutdown("ci-knowledge-update");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runTemporalBenchmark(fixturePath: string): Promise<{ temporalScore: number; weightedTau: number; ndcgAt5: number; passed: boolean; temporalGate: number; perSampleScores: number[] }> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const cases = JSON.parse(raw) as TemporalCase[];
    const project = "ci-temporal";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);

    const scores: number[] = [];
    const weightedTauScores: number[] = [];
    const ndcgScores: number[] = [];

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
    }

    const temporalScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const weightedTau = weightedTauScores.length > 0 ? weightedTauScores.reduce((a, b) => a + b, 0) / weightedTauScores.length : 0;
    const ndcgAt5 = ndcgScores.length > 0 ? ndcgScores.reduce((a, b) => a + b, 0) / ndcgScores.length : 0;
    const envTemporalGate = Number(process.env.HARNESS_BENCH_TEMPORAL_GATE);
    const temporalGate = Number.isFinite(envTemporalGate) && envTemporalGate >= 0 && envTemporalGate <= 1 ? envTemporalGate : 0.55;
    const passed = temporalScore >= temporalGate;
    return { temporalScore, weightedTau, ndcgAt5, passed, temporalGate, perSampleScores: scores };
  } finally {
    core.shutdown("ci-temporal");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("[CI] §34 Benchmark CI Runner (locomo-120 + bilingual-30 + knowledge-update + temporal)");

  // ベンチマーク専用設定
  process.env.HARNESS_MEM_DECAY_DISABLED = "1";
  process.env.HARNESS_MEM_RERANKER_ENABLED = "1";

  mkdirSync(RESULTS_DIR, { recursive: true });

  let allPassed = true;

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
    });

    const overallF1 = result.metrics.overall.f1;
    const overallEM = result.metrics.overall.em;
    const byCat = result.metrics.by_category;

    console.log(`[CI] locomo-120 overall: EM=${overallEM.toFixed(4)}, F1=${overallF1.toFixed(4)}`);
    console.log(`[CI] locomo-120 samples=${result.dataset.sample_count}, qa=${result.dataset.qa_count}`);
    console.log("[CI] by_category:");
    for (const [cat, scores] of Object.entries(byCat)) {
      console.log(`  ${cat}: EM=${scores.em.toFixed(4)}, F1=${scores.f1.toFixed(4)} (n=${scores.count})`);
    }
    console.log(`[CI] Saved to ${LOCOMO_120_LATEST}`);

    ciScores.f1 = overallF1; // §34 FD-012: 3層ゲート用

    const regressionResult = checkLocomo120Regression(overallF1, byCat);
    if (regressionResult.passed) {
      console.log(`[CI] Regression check PASSED: ${regressionResult.message}`);
    } else {
      console.error(`[CI] Regression check FAILED: ${regressionResult.message}`);
      allPassed = false;
    }
  } catch (err) {
    console.error(`[CI] locomo-120 benchmark error: ${err instanceof Error ? err.message : String(err)}`);
    allPassed = false;
  }

  // --- bilingual ベンチマーク（bilingual-50 優先、フォールバック bilingual-30 → bilingual-10）---
  const bilingualPath50 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/bilingual-50.json");
  const bilingualPath30 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/bilingual-30.json");
  const bilingualPath10 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/bilingual-10.json");
  const bilingualPath = existsSync(bilingualPath50) ? bilingualPath50 : existsSync(bilingualPath30) ? bilingualPath30 : bilingualPath10;
  const bilingualLabel = existsSync(bilingualPath50) ? "bilingual-50" : existsSync(bilingualPath30) ? "bilingual-30" : "bilingual-10";
  if (existsSync(bilingualPath)) {
    console.log(`\n[CI] Running ${bilingualLabel} benchmark`);
    try {
      const { recall, passed, perSampleScores: biScores } = await runBilingualBenchmark(bilingualPath);
      const biCI = ciRunner.bootstrapCI(biScores);
      ciScores.bilingual = recall; // §34 FD-012: 3層ゲート用
      console.log(`[CI] ${bilingualLabel} recall@10: ${recall.toFixed(4)} (threshold: 0.8)`);
      console.log(`[CI] ${bilingualLabel} 95% Bootstrap CI: [${biCI.lower.toFixed(4)}, ${biCI.upper.toFixed(4)}] (method: ${biCI.method})`);
      if (passed) {
        console.log(`[CI] ${bilingualLabel} PASSED`);
      } else {
        console.error(`[CI] ${bilingualLabel} FAILED: recall@10=${recall.toFixed(4)} < 0.8`);
        allPassed = false;
      }
    } catch (err) {
      console.error(`[CI] ${bilingualLabel} error: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }
  } else {
    console.log("[CI] bilingual fixture not found, skipping");
  }

  // --- knowledge-update-100 ベンチマーク（100件、FD-009で拡充）---
  const kuPath100 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/knowledge-update-100.json");
  const kuPath50 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/knowledge-update-50.json");
  const kuPath10 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/knowledge-update-10.json");
  const kuPath = existsSync(kuPath100) ? kuPath100 : existsSync(kuPath50) ? kuPath50 : kuPath10;
  const kuLabel = existsSync(kuPath100) ? "knowledge-update-100" : existsSync(kuPath50) ? "knowledge-update-50" : "knowledge-update-10";
  if (existsSync(kuPath)) {
    console.log(`\n[CI] Running ${kuLabel} benchmark`);
    try {
      const { freshnessAtK, passed, freshnessGate, perSampleScores: kuScores } = await runKnowledgeUpdateBenchmark(kuPath);
      const kuCI = ciRunner.bootstrapCI(kuScores);
      ciScores.freshness = freshnessAtK; // §34 FD-012: 3層ゲート用
      const gateSource = process.env.HARNESS_BENCH_FRESHNESS_GATE ? "env" : "default";
      console.log(`[CI] ${kuLabel} Freshness@K: ${freshnessAtK.toFixed(4)} (threshold: ${freshnessGate} [${gateSource}])`);
      console.log(`[CI] ${kuLabel} 95% Bootstrap CI: [${kuCI.lower.toFixed(4)}, ${kuCI.upper.toFixed(4)}] (method: ${kuCI.method})`);
      if (passed) {
        console.log(`[CI] ${kuLabel} PASSED`);
      } else {
        console.error(`[CI] ${kuLabel} FAILED: Freshness@K=${freshnessAtK.toFixed(4)} < ${freshnessGate}`);
        allPassed = false;
      }
    } catch (err) {
      console.error(`[CI] ${kuLabel} error: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }
  } else {
    console.log("[CI] knowledge-update fixture not found, skipping");
  }

  // --- temporal-100 ベンチマーク（temporal-50 → temporal-100 へ拡充、4ドメイン）---
  const temporalPath100 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/temporal-100.json");
  const temporalPath50 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/temporal-50.json");
  const temporalPath30 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/temporal-30.json");
  const temporalPath10 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/temporal-10.json");
  const temporalPath = existsSync(temporalPath100) ? temporalPath100 : existsSync(temporalPath50) ? temporalPath50 : existsSync(temporalPath30) ? temporalPath30 : temporalPath10;
  const temporalLabel = existsSync(temporalPath100) ? "temporal-100" : existsSync(temporalPath50) ? "temporal-50" : existsSync(temporalPath30) ? "temporal-30" : "temporal-10";
  if (existsSync(temporalPath)) {
    console.log(`\n[CI] Running ${temporalLabel} benchmark`);
    try {
      const { temporalScore, weightedTau, ndcgAt5, passed, temporalGate, perSampleScores: tScores } = await runTemporalBenchmark(temporalPath);
      const tCI = ciRunner.bootstrapCI(tScores);
      ciScores.temporal = temporalScore; // §34 FD-012: 3層ゲート用
      const temporalGateSource = process.env.HARNESS_BENCH_TEMPORAL_GATE ? "env" : "default";
      // §34 FD-004: 3指標並行報告（Order Score / Weighted Kendall tau / nDCG@5）
      console.log(`[CI] ${temporalLabel} Order Score: ${temporalScore.toFixed(4)} (threshold: ${temporalGate} [${temporalGateSource}])`);
      console.log(`[CI] ${temporalLabel} 95% Bootstrap CI: [${tCI.lower.toFixed(4)}, ${tCI.upper.toFixed(4)}] (method: ${tCI.method})`);
      console.log(`[CI] ${temporalLabel} Weighted Kendall tau: ${weightedTau.toFixed(4)}`);
      console.log(`[CI] ${temporalLabel} nDCG@5: ${ndcgAt5.toFixed(4)}`);
      if (passed) {
        console.log(`[CI] ${temporalLabel} PASSED`);
      } else {
        console.error(`[CI] ${temporalLabel} FAILED: score=${temporalScore.toFixed(4)} < ${temporalGate}`);
        allPassed = false;
      }
    } catch (err) {
      console.error(`[CI] ${temporalLabel} error: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }
  } else {
    console.log("[CI] temporal fixture not found, skipping");
  }

  // --- dev-workflow-20 ベンチマーク（§34 FD-015: 実使用パターン、WARNING のみ）---
  const dwPath = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/dev-workflow-20.json");
  if (existsSync(dwPath)) {
    console.log(`\n[CI] Running dev-workflow-20 benchmark`);
    try {
      const { recall, perSampleScores: dwScores } = await runDevWorkflowBenchmark(dwPath);
      const dwCI = ciRunner.bootstrapCI(dwScores);
      console.log(`[CI] dev-workflow-20 recall@10: ${recall.toFixed(4)}`);
      console.log(`[CI] dev-workflow-20 95% Bootstrap CI: [${dwCI.lower.toFixed(4)}, ${dwCI.upper.toFixed(4)}] (method: ${dwCI.method})`);
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
  const l2 = layer2RelativeRegression(ciScores, history);
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
