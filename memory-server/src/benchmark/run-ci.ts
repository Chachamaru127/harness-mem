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

async function runBilingualBenchmark(fixturePath: string): Promise<{ recall: number; passed: boolean }> {
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

    // recall@10 を計測
    let hits = 0;
    for (const s of samples) {
      const result = core.search({ query: s.query, project, include_private: true, limit: 10 });
      const retrievedIds = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      const relevantIds = s.relevant_ids.map((rid) => `obs_${rid}`);
      const recall = runner.calculateRecallAtK(retrievedIds, relevantIds, 10);
      if (recall > 0) hits++;
    }

    const recall = samples.length > 0 ? hits / samples.length : 0;
    const passed = recall >= 0.8;
    return { recall, passed };
  } finally {
    core.shutdown("ci-bilingual");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runKnowledgeUpdateBenchmark(fixturePath: string): Promise<{ freshnessAtK: number; passed: boolean }> {
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
    return { freshnessAtK, passed, freshnessGate };
  } finally {
    core.shutdown("ci-knowledge-update");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runTemporalBenchmark(fixturePath: string): Promise<{ temporalScore: number; passed: boolean }> {
  const { core, dir } = createTempCore();
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const cases = JSON.parse(raw) as TemporalCase[];
    const project = "ci-temporal";
    const runner = new BenchmarkRunner(core as Parameters<typeof BenchmarkRunner>[0]);

    const scores: number[] = [];

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

      const score = runner.calculateTemporalOrderScore(retrievedIds, expectedOrderIds, 10);
      scores.push(score);
    }

    const temporalScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const envTemporalGate = Number(process.env.HARNESS_BENCH_TEMPORAL_GATE);
    const temporalGate = Number.isFinite(envTemporalGate) && envTemporalGate >= 0 && envTemporalGate <= 1 ? envTemporalGate : 0.55;
    const passed = temporalScore >= temporalGate;
    return { temporalScore, passed, temporalGate };
  } finally {
    core.shutdown("ci-temporal");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("[CI] §32 Benchmark CI Runner (locomo-120 + bilingual-10 + knowledge-update-10 + temporal-10)");

  // ベンチマーク専用設定
  process.env.HARNESS_MEM_DECAY_DISABLED = "1";
  process.env.HARNESS_MEM_RERANKER_ENABLED = "1";

  mkdirSync(RESULTS_DIR, { recursive: true });

  let allPassed = true;

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

  // --- bilingual-10 ベンチマーク ---
  const bilingualPath = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/bilingual-10.json");
  if (existsSync(bilingualPath)) {
    console.log("\n[CI] Running bilingual-10 benchmark");
    try {
      const { recall, passed } = await runBilingualBenchmark(bilingualPath);
      console.log(`[CI] bilingual-10 recall@10: ${recall.toFixed(4)} (threshold: 0.8)`);
      if (passed) {
        console.log("[CI] bilingual-10 PASSED");
      } else {
        console.error(`[CI] bilingual-10 FAILED: recall@10=${recall.toFixed(4)} < 0.8`);
        allPassed = false;
      }
    } catch (err) {
      console.error(`[CI] bilingual-10 error: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }
  } else {
    console.log("[CI] bilingual-10 fixture not found, skipping");
  }

  // --- knowledge-update-50 ベンチマーク（50件、FQ-011で拡充）---
  const kuPath50 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/knowledge-update-50.json");
  const kuPath10 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/knowledge-update-10.json");
  const kuPath = existsSync(kuPath50) ? kuPath50 : kuPath10;
  const kuLabel = existsSync(kuPath50) ? "knowledge-update-50" : "knowledge-update-10";
  if (existsSync(kuPath)) {
    console.log(`\n[CI] Running ${kuLabel} benchmark`);
    try {
      const { freshnessAtK, passed, freshnessGate } = await runKnowledgeUpdateBenchmark(kuPath);
      const gateSource = process.env.HARNESS_BENCH_FRESHNESS_GATE ? "env" : "default";
      console.log(`[CI] ${kuLabel} Freshness@K: ${freshnessAtK.toFixed(4)} (threshold: ${freshnessGate} [${gateSource}])`);
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

  // --- temporal-30 ベンチマーク（temporal-10 から拡充）---
  const temporalPath30 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/temporal-30.json");
  const temporalPath10 = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/temporal-10.json");
  const temporalPath = existsSync(temporalPath30) ? temporalPath30 : temporalPath10;
  const temporalLabel = existsSync(temporalPath30) ? "temporal-30" : "temporal-10";
  if (existsSync(temporalPath)) {
    console.log(`\n[CI] Running ${temporalLabel} benchmark`);
    try {
      const { temporalScore, passed, temporalGate } = await runTemporalBenchmark(temporalPath);
      const temporalGateSource = process.env.HARNESS_BENCH_TEMPORAL_GATE ? "env" : "default";
      console.log(`[CI] ${temporalLabel} Order Score: ${temporalScore.toFixed(4)} (threshold: ${temporalGate} [${temporalGateSource}])`);
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
