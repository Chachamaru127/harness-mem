/**
 * V5-007: CI ベンチマークランナースクリプト
 *
 * locomo-mini と longmemeval-mini を実行し、
 * regression-gate でチェックする。失敗時は exit code 1 で終了。
 *
 * 使用方法: bun run memory-server/src/benchmark/run-ci.ts
 */

import { mkdtempSync } from "node:fs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../core/harness-mem-core";
import { BenchmarkRunner, type BenchmarkConfig } from "./runner";
import { checkRegression } from "./regression-gate";

const RESULTS_DIR = join(import.meta.dir, "results");

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-ci-${name}-`));
  return {
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
    backgroundWorkersEnabled: false,
  };
}

async function main(): Promise<void> {
  console.log("[CI] V5-007 Benchmark CI Runner");

  // ベンチマーク専用設定: decay 無効化 + reranker 有効化
  process.env.HARNESS_MEM_DECAY_DISABLED = "1";
  process.env.HARNESS_MEM_RERANKER_ENABLED = "1";

  mkdirSync(RESULTS_DIR, { recursive: true });

  const configs: BenchmarkConfig[] = [
    {
      dataset: "locomo",
      metrics: ["recall@10", "precision@10", "mrr", "ndcg"],
    },
    {
      dataset: "longmemeval",
      metrics: ["recall@10", "precision@10", "mrr", "ndcg"],
    },
  ];

  let allPassed = true;

  for (const config of configs) {
    const core = new HarnessMemCore(createConfig(config.dataset));
    try {
      console.log(`\n[CI] Running benchmark: ${config.dataset}`);
      const runner = new BenchmarkRunner(core as any);
      const result = await runner.run(config);

      console.log(`[CI] ${config.dataset} results:`, JSON.stringify(result.metrics, null, 2));
      console.log(`[CI] samples=${result.samples}, duration=${result.duration_ms}ms`);

      // 結果を保存
      const outFile = join(RESULTS_DIR, `${config.dataset}-latest.json`);
      writeFileSync(outFile, JSON.stringify(result, null, 2));
      console.log(`[CI] Saved to ${outFile}`);

      // ドキュメント向け公開結果も更新
      const docsOutFile = join(
        import.meta.dir,
        "../../../../docs/benchmarks/latest-results.json",
      );
      let latestResults: Record<string, unknown> = {};
      try {
        latestResults = JSON.parse(
          require("node:fs").readFileSync(docsOutFile, "utf-8"),
        );
      } catch {
        // 初回は空から始める
      }
      latestResults[config.dataset] = result;
      try {
        writeFileSync(docsOutFile, JSON.stringify(latestResults, null, 2));
      } catch {
        // docs ディレクトリが存在しない場合は無視
      }

      // 回帰チェック
      const baselineFile = join(RESULTS_DIR, `${config.dataset}-baseline.json`);
      const check = checkRegression(result, {
        baseline_file: baselineFile,
        threshold: 0.05,
        metric: "recall@10",
      });

      if (check.passed) {
        console.log(`[CI] Regression check PASSED: ${check.message}`);
      } else {
        console.error(`[CI] Regression check FAILED: ${check.message}`);
        allPassed = false;
      }
    } finally {
      core.shutdown("ci");
    }
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
