/**
 * LOCO-002: F1 ベース軽量ゲートスクリプト
 *
 * 前回ベースラインと現在の F1 スコアを比較し、
 * -5% 超の低下で exit code 1 を返す。LLM Judge 不要。
 *
 * 使用方法:
 *   bun run memory-server/src/benchmark/locomo-gate-check.ts \
 *     --current <current-result.json> \
 *     --baseline <baseline-result.json> \
 *     [--threshold 0.05]
 *
 * JSON フォーマット（BenchmarkResult 互換）:
 *   { "metrics": { "f1": 0.65, ... }, ... }
 *
 * または LocomoMetricSnapshot 互換:
 *   { "overall": { "f1": 0.65, "em": 0.50, "count": 10 } }
 */

import { existsSync, readFileSync } from "node:fs";

interface BenchmarkMetrics {
  // BenchmarkResult 形式: { metrics: { "f1": 0.65, ... } }
  metrics?: Record<string, unknown> | { overall?: { f1?: number }; by_category?: Record<string, { f1?: number }> };
  // LocomoMetricSnapshot 形式: { overall: { f1: 0.65, ... } }
  overall?: { f1: number; em: number; count: number };
}

function extractF1(data: BenchmarkMetrics): number | null {
  // LocomoBenchmarkResult 形式: { metrics: { overall: { f1: 0.65 } } }
  if (data.metrics && typeof data.metrics === "object") {
    const m = data.metrics as Record<string, unknown>;
    if (m["overall"] && typeof (m["overall"] as Record<string, unknown>)["f1"] === "number") {
      return (m["overall"] as Record<string, number>)["f1"];
    }
    // フラット形式: { metrics: { "f1": 0.65 } }
    if (typeof m["f1"] === "number") {
      return m["f1"] as number;
    }
  }
  // LocomoMetricSnapshot 形式: { overall: { f1: 0.65 } }
  if (data.overall && typeof data.overall.f1 === "number") {
    return data.overall.f1;
  }
  return null;
}

export function extractCategoryF1(data: BenchmarkMetrics, category: string): number | null {
  if (!data.metrics || typeof data.metrics !== "object") return null;
  const metrics = data.metrics as Record<string, unknown>;
  const byCategory = metrics["by_category"];
  if (!byCategory || typeof byCategory !== "object") return null;
  const categoryRow = (byCategory as Record<string, unknown>)[category];
  if (!categoryRow || typeof categoryRow !== "object") return null;
  const f1 = (categoryRow as Record<string, unknown>)["f1"];
  return typeof f1 === "number" ? f1 : null;
}

function loadJson(filePath: string): BenchmarkMetrics {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as BenchmarkMetrics;
}

/**
 * 閾値の解決優先順位:
 *   1. --threshold CLI 引数
 *   2. LOCOMO_F1_THRESHOLD 環境変数
 *   3. デフォルト値 0.05 (5%)
 */
export const DEFAULT_F1_THRESHOLD = 0.05;
export const DEFAULT_CAT2_F1_FLOOR = 0.20;
export const DEFAULT_CAT3_F1_FLOOR = 0.24;

export function resolveThreshold(cliValue?: number): number {
  if (cliValue !== undefined) return cliValue;
  const env = process.env["LOCOMO_F1_THRESHOLD"];
  if (env !== undefined && env !== "") {
    const parsed = parseFloat(env);
    if (!isNaN(parsed)) return parsed;
  }
  return DEFAULT_F1_THRESHOLD;
}

function resolveFloor(
  cliValue: number | undefined,
  envName: string,
  fallback: number
): number {
  if (cliValue !== undefined) return cliValue;
  const env = process.env[envName];
  if (env !== undefined && env !== "") {
    const parsed = parseFloat(env);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function parseArgs(argv: string[]): {
  current: string;
  baseline: string;
  threshold: number;
  cat2Floor: number;
  cat3Floor: number;
} {
  let current = "";
  let baseline = "";
  let cliThreshold: number | undefined;
  let cliCat2Floor: number | undefined;
  let cliCat3Floor: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--current" && argv[i + 1]) {
      current = argv[++i];
    } else if (argv[i] === "--baseline" && argv[i + 1]) {
      baseline = argv[++i];
    } else if (argv[i] === "--threshold" && argv[i + 1]) {
      cliThreshold = parseFloat(argv[++i]);
    } else if (argv[i] === "--cat2-floor" && argv[i + 1]) {
      cliCat2Floor = parseFloat(argv[++i]);
    } else if (argv[i] === "--cat3-floor" && argv[i + 1]) {
      cliCat3Floor = parseFloat(argv[++i]);
    }
  }

  if (!current || !baseline) {
    console.error("Usage: locomo-gate-check.ts --current <file> --baseline <file> [--threshold 0.05]");
    console.error("  Threshold can also be set via LOCOMO_F1_THRESHOLD environment variable.");
    process.exit(2);
  }

  return {
    current,
    baseline,
    threshold: resolveThreshold(cliThreshold),
    cat2Floor: resolveFloor(cliCat2Floor, "LOCOMO_CAT2_F1_FLOOR", DEFAULT_CAT2_F1_FLOOR),
    cat3Floor: resolveFloor(cliCat3Floor, "LOCOMO_CAT3_F1_FLOOR", DEFAULT_CAT3_F1_FLOOR),
  };
}

export interface GateCheckResult {
  passed: boolean;
  baselineF1: number;
  currentF1: number;
  delta: number;
  relativeDrop: number;
  threshold: number;
  message: string;
}

export function checkF1Gate(
  currentF1: number,
  baselineF1: number,
  threshold: number,
): GateCheckResult {
  const delta = currentF1 - baselineF1;
  const relativeDrop = baselineF1 === 0 ? 0 : -delta / baselineF1;
  const passed = relativeDrop <= threshold;

  const sign = delta >= 0 ? "+" : "";
  const message = passed
    ? `F1 gate PASSED: ${currentF1.toFixed(4)} (baseline: ${baselineF1.toFixed(4)}, delta: ${sign}${delta.toFixed(4)}, drop: ${(relativeDrop * 100).toFixed(2)}%)`
    : `F1 gate FAILED: F1 dropped by ${(relativeDrop * 100).toFixed(2)}% (threshold: ${(threshold * 100).toFixed(0)}%). current=${currentF1.toFixed(4)}, baseline=${baselineF1.toFixed(4)}`;

  return {
    passed,
    baselineF1,
    currentF1,
    delta,
    relativeDrop,
    threshold,
    message,
  };
}

export function checkCategoryFloor(category: string, value: number, floor: number): GateCheckResult {
  const passed = value >= floor;
  const delta = value - floor;
  return {
    passed,
    baselineF1: floor,
    currentF1: value,
    delta,
    relativeDrop: floor === 0 ? 0 : -delta / floor,
    threshold: floor,
    message: passed
      ? `${category} floor PASSED: ${value.toFixed(4)} >= ${floor.toFixed(4)}`
      : `${category} floor FAILED: ${value.toFixed(4)} < ${floor.toFixed(4)}`,
  };
}

// CLI エントリポイント（直接実行時のみ）
if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));

  let currentData: BenchmarkMetrics;
  let baselineData: BenchmarkMetrics;

  try {
    currentData = loadJson(args.current);
  } catch (e) {
    console.error(`[gate] Failed to load current file: ${String(e)}`);
    process.exit(2);
  }

  try {
    baselineData = loadJson(args.baseline);
  } catch (e) {
    console.error(`[gate] Failed to load baseline file: ${String(e)}`);
    process.exit(2);
  }

  const currentF1 = extractF1(currentData);
  const baselineF1 = extractF1(baselineData);

  if (currentF1 === null) {
    console.error(`[gate] Could not extract F1 from current file: ${args.current}`);
    process.exit(2);
  }
  if (baselineF1 === null) {
    console.error(`[gate] Could not extract F1 from baseline file: ${args.baseline}`);
    process.exit(2);
  }

  const result = checkF1Gate(currentF1, baselineF1, args.threshold);

  console.log(`[gate] ${result.message}`);

  const cat2F1 = extractCategoryF1(currentData, "cat-2");
  const cat3F1 = extractCategoryF1(currentData, "cat-3");
  if (cat2F1 === null || cat3F1 === null) {
    console.error("[gate] Could not extract cat-2/cat-3 f1 from current file (metrics.by_category)");
    process.exit(2);
  }
  const cat2Gate = checkCategoryFloor("cat-2", cat2F1, args.cat2Floor);
  const cat3Gate = checkCategoryFloor("cat-3", cat3F1, args.cat3Floor);
  console.log(`[gate] ${cat2Gate.message}`);
  console.log(`[gate] ${cat3Gate.message}`);

  if (!result.passed || !cat2Gate.passed || !cat3Gate.passed) {
    process.exit(1);
  }
}
