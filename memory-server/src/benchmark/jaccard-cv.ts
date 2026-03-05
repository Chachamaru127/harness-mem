/**
 * §34 FD-002: Freshness Jaccard 閾値の 5-fold 交差検証
 *
 * knowledge-update-50 を5-fold分割し、各foldで最適なJaccard閾値を求める。
 * 結果を results/jaccard-cv-report.json に保存する。
 *
 * 使用方法: bun run memory-server/src/benchmark/jaccard-cv.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { HarnessMemCore, type Config } from "../core/harness-mem-core";
import { BenchmarkRunner } from "./runner";

const RESULTS_DIR = join(import.meta.dir, "results");
const FIXTURE_PATH = resolve(
  import.meta.dir,
  "../../../tests/benchmarks/fixtures/knowledge-update-50.json",
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

function createTempCore(): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-jaccard-cv-"));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 384,
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

async function evaluateFold(
  foldCases: KnowledgeUpdateCase[],
  jaccardThreshold: number,
): Promise<number> {
  // 環境変数で Jaccard 閾値を設定
  process.env.HARNESS_JACCARD_SUPERSEDE_THRESHOLD = String(jaccardThreshold);

  const { core, dir } = createTempCore();
  const runner = new BenchmarkRunner(core as unknown as ConstructorParameters<typeof BenchmarkRunner>[0]);
  const project = `cv-fold-th${jaccardThreshold.toFixed(2).replace(".", "")}`;

  try {
    const scores: number[] = [];

    for (const kCase of foldCases) {
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

      const result = core.search({
        query: kCase.query,
        project,
        include_private: true,
        limit: 10,
        exclude_updated: true,
      });
      const retrievedIds = result.items.map(
        (item) => String((item as Record<string, unknown>).id ?? ""),
      );
      const newId = `obs_${kCase.expected_latest_id}`;
      const oldIds = kCase.old_entries.map((e) => `obs_${e.id}`);

      const score = runner.calculateFreshnessAtK(retrievedIds, newId, oldIds, 10);
      scores.push(score);
    }

    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  } finally {
    core.shutdown(`cv-${jaccardThreshold.toFixed(2)}`);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("[CV] §34 FD-002: Jaccard 閾値 5-fold 交差検証");

  process.env.HARNESS_MEM_DECAY_DISABLED = "1";
  process.env.HARNESS_MEM_RERANKER_ENABLED = "1";

  mkdirSync(RESULTS_DIR, { recursive: true });

  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  const allCases = JSON.parse(raw) as KnowledgeUpdateCase[];
  console.log(`[CV] Loaded ${allCases.length} cases from knowledge-update-50.json`);

  const N = allCases.length;
  const K_FOLDS = 5;
  const foldSize = Math.ceil(N / K_FOLDS);

  // 探索する閾値候補
  const THRESHOLD_CANDIDATES = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60];

  const foldResults: Array<{
    fold: number;
    best_threshold: number;
    best_score: number;
    scores_by_threshold: Record<string, number>;
  }> = [];

  for (let fold = 0; fold < K_FOLDS; fold++) {
    const valStart = fold * foldSize;
    const valEnd = Math.min(valStart + foldSize, N);
    const valCases = allCases.slice(valStart, valEnd);

    console.log(
      `\n[CV] Fold ${fold + 1}/${K_FOLDS}: val=${valCases.length} cases (indices ${valStart}-${valEnd - 1})`,
    );

    let bestThreshold = 0.10;
    let bestScore = -1;
    const scoresByThreshold: Record<string, number> = {};

    for (const threshold of THRESHOLD_CANDIDATES) {
      const score = await evaluateFold(valCases, threshold);
      scoresByThreshold[threshold.toFixed(2)] = score;
      console.log(`  threshold=${threshold.toFixed(2)}: Freshness@K=${score.toFixed(4)}`);

      if (score > bestScore) {
        bestScore = score;
        bestThreshold = threshold;
      }
    }

    foldResults.push({
      fold: fold + 1,
      best_threshold: bestThreshold,
      best_score: bestScore,
      scores_by_threshold: scoresByThreshold,
    });

    console.log(
      `  [Fold ${fold + 1}] Best: threshold=${bestThreshold.toFixed(2)}, score=${bestScore.toFixed(4)}`,
    );
  }

  // 全閾値候補の全fold平均スコアを計算
  const avgScoresByThreshold: Record<string, number> = {};
  for (const threshold of THRESHOLD_CANDIDATES) {
    const key = threshold.toFixed(2);
    const avg =
      foldResults.reduce((sum, r) => sum + (r.scores_by_threshold[key] ?? 0), 0) / K_FOLDS;
    avgScoresByThreshold[key] = Number(avg.toFixed(4));
  }

  // 全fold平均で最も良い閾値を選ぶ
  let globalBestThreshold = THRESHOLD_CANDIDATES[0];
  let globalBestAvgScore = -1;
  for (const threshold of THRESHOLD_CANDIDATES) {
    const avgScore = avgScoresByThreshold[threshold.toFixed(2)];
    if (avgScore > globalBestAvgScore) {
      globalBestAvgScore = avgScore;
      globalBestThreshold = threshold;
    }
  }

  const avgOptimalThreshold =
    foldResults.reduce((sum, r) => sum + r.best_threshold, 0) / K_FOLDS;
  const avgBestScore = foldResults.reduce((sum, r) => sum + r.best_score, 0) / K_FOLDS;

  const report = {
    timestamp: new Date().toISOString(),
    fixture: "knowledge-update-50",
    k_folds: K_FOLDS,
    threshold_candidates: THRESHOLD_CANDIDATES,
    fold_results: foldResults,
    summary: {
      avg_optimal_threshold_by_fold: Number(avgOptimalThreshold.toFixed(4)),
      avg_best_score_by_fold: Number(avgBestScore.toFixed(4)),
      global_best_threshold: globalBestThreshold,
      global_best_avg_score: Number(globalBestAvgScore.toFixed(4)),
      avg_scores_by_threshold: avgScoresByThreshold,
      recommended_threshold: globalBestThreshold,
      previous_threshold: 0.30,
      note: "5-fold CV による最適化。HARNESS_JACCARD_SUPERSEDE_THRESHOLD 環境変数で上書き可能。",
    },
  };

  const reportPath = join(RESULTS_DIR, "jaccard-cv-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n[CV] ===== 5-fold 交差検証 結果 =====");
  console.log(`[CV] 全fold平均スコア（閾値別）:`);
  for (const threshold of THRESHOLD_CANDIDATES) {
    const avg = avgScoresByThreshold[threshold.toFixed(2)];
    const mark = threshold === globalBestThreshold ? " ← BEST" : "";
    console.log(`  ${threshold.toFixed(2)}: ${avg.toFixed(4)}${mark}`);
  }
  console.log(`[CV] 推奨 Jaccard 閾値: ${globalBestThreshold} (旧: 0.3)`);
  console.log(`[CV] 平均 Freshness@K: ${globalBestAvgScore.toFixed(4)}`);
  console.log(`[CV] レポート保存先: ${reportPath}`);
}

main().catch((err) => {
  console.error("[CV] Fatal error:", err);
  process.exit(1);
});
