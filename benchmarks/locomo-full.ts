/**
 * NEXT-011: LoCoMo フルデータセット評価
 *
 * 既存のサブセット評価（locomo-120.json など）を
 * フルデータセット対応のランナーに拡張する。
 *
 * フルデータセットが存在する場合はそちらを使用し、
 * 存在しない場合は利用可能な最大のフィクスチャを使用する。
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLocomoBenchmark, type LocomoBenchmarkResult } from "../tests/benchmarks/run-locomo-benchmark";
import { loadLocomoDataset } from "../tests/benchmarks/locomo-loader";

export interface LocomoFullBenchmarkOptions {
  /** データセットパス（省略時はデフォルトフィクスチャを使用） */
  datasetPath?: string;
  /** 評価する最大サンプル数（省略時は全件） */
  maxSamples?: number;
  /** 結果出力先パス */
  outputPath?: string;
}

export interface LocomoFullBenchmarkResult extends LocomoBenchmarkResult {
  dataset_info: {
    total_samples: number;
    evaluated_samples: number;
    dataset_path: string;
    is_full_dataset: boolean;
  };
}

const DATASET_SEARCH_PATHS = [
  // フルデータセット（外部から提供される場合）
  join(process.cwd(), "benchmarks", "fixtures", "locomo-full.json"),
  join(process.cwd(), "benchmarks", "fixtures", "locomo.json"),
  // 既存の最大サブセット
  join(process.cwd(), "tests", "benchmarks", "fixtures", "locomo-120.json"),
  // 最小フィクスチャ（テスト用）
  join(process.cwd(), "tests", "benchmarks", "fixtures", "locomo10.sample.json"),
];

/**
 * 利用可能な最大のデータセットパスを解決する。
 */
export function resolveDatasetPath(preferredPath?: string): { path: string; isFullDataset: boolean } {
  if (preferredPath && existsSync(preferredPath)) {
    const isFullDataset = preferredPath.includes("full") || preferredPath.includes("locomo.json");
    return { path: preferredPath, isFullDataset };
  }

  for (const candidate of DATASET_SEARCH_PATHS) {
    if (existsSync(candidate)) {
      const isFullDataset = candidate.includes("full") || candidate.endsWith("locomo.json");
      return { path: candidate, isFullDataset };
    }
  }

  throw new Error(
    "No LoCoMo dataset found. " +
    "Place locomo-full.json in benchmarks/fixtures/ for full evaluation, " +
    "or ensure tests/benchmarks/fixtures/locomo10.sample.json exists."
  );
}

/**
 * LoCoMo フルデータセット評価を実行する。
 *
 * - フルデータセットが存在する場合は全件評価
 * - 存在しない場合は最大のフィクスチャで評価
 * - maxSamples でサンプル数を制限可能（CI 定期実行向け）
 */
export async function runLocomoFullBenchmark(
  options: LocomoFullBenchmarkOptions = {}
): Promise<LocomoFullBenchmarkResult> {
  const { datasetPath, maxSamples, outputPath } = options;

  const resolved = resolveDatasetPath(datasetPath);

  // 全件数を事前に取得（maxSamples による制限前）
  const allSamples = loadLocomoDataset(resolved.path);
  const totalSamples = allSamples.length;

  const tempDir = mkdtempSync(join(tmpdir(), "locomo-full-"));
  try {
    const result = await runLocomoBenchmark({
      system: "harness-mem",
      datasetPath: resolved.path,
      outputPath: outputPath ?? join(tempDir, "locomo-full-result.json"),
      maxSamples,
    });

    // result.dataset.sample_count は maxSamples 適用後のサンプル数
    const evaluatedSamples = result.dataset.sample_count;

    return {
      ...result,
      dataset_info: {
        total_samples: totalSamples,
        evaluated_samples: evaluatedSamples,
        dataset_path: resolved.path,
        is_full_dataset: resolved.isFullDataset,
      },
    };
  } finally {
    if (!outputPath) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
