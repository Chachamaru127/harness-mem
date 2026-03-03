/**
 * V5-007: Recall@10 回帰ゲート
 *
 * 前回ベンチマーク結果と現在の結果を比較し、
 * 許容低下率を超えた場合に失敗とする。
 */

import { existsSync, readFileSync } from "node:fs";
import type { BenchmarkResult } from "./runner";

export interface RegressionConfig {
  /** 前回の結果 JSON ファイルパス */
  baseline_file: string;
  /** 許容低下率 (デフォルト 0.05 = 5%) */
  threshold: number;
  /** チェック対象メトリック (例: "recall@10") */
  metric: string;
}

export interface RegressionCheckResult {
  passed: boolean;
  baseline: number;
  current: number;
  delta: number;
  message: string;
}

export function checkRegression(
  current: BenchmarkResult,
  config: RegressionConfig,
): RegressionCheckResult {
  const currentValue = current.metrics[config.metric] ?? 0;

  // ベースラインファイルが存在しない場合はパス（初回実行）
  if (!existsSync(config.baseline_file)) {
    return {
      passed: true,
      baseline: currentValue,
      current: currentValue,
      delta: 0,
      message: `baseline file not found (${config.baseline_file}); skipping regression check`,
    };
  }

  let baseline: BenchmarkResult;
  try {
    const raw = readFileSync(config.baseline_file, "utf-8");
    baseline = JSON.parse(raw) as BenchmarkResult;
  } catch (e) {
    return {
      passed: true,
      baseline: currentValue,
      current: currentValue,
      delta: 0,
      message: `failed to parse baseline file: ${String(e)}; skipping regression check`,
    };
  }

  const baselineValue = baseline.metrics[config.metric] ?? 0;
  const delta = currentValue - baselineValue;
  const relativeDrop = baselineValue === 0 ? 0 : -delta / baselineValue;

  const passed = relativeDrop <= config.threshold;
  const sign = delta >= 0 ? "+" : "";
  const message = passed
    ? `${config.metric}: ${currentValue.toFixed(4)} (baseline: ${baselineValue.toFixed(4)}, delta: ${sign}${delta.toFixed(4)})`
    : `REGRESSION DETECTED: ${config.metric} dropped by ${(relativeDrop * 100).toFixed(2)}% (threshold: ${(config.threshold * 100).toFixed(0)}%). current=${currentValue.toFixed(4)}, baseline=${baselineValue.toFixed(4)}`;

  return {
    passed,
    baseline: baselineValue,
    current: currentValue,
    delta,
    message,
  };
}
