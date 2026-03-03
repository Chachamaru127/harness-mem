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
  metrics?: Record<string, number> | { overall?: { f1?: number } };
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

function loadJson(filePath: string): BenchmarkMetrics {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as BenchmarkMetrics;
}

function parseArgs(argv: string[]): {
  current: string;
  baseline: string;
  threshold: number;
} {
  let current = "";
  let baseline = "";
  let threshold = 0.05;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--current" && argv[i + 1]) {
      current = argv[++i];
    } else if (argv[i] === "--baseline" && argv[i + 1]) {
      baseline = argv[++i];
    } else if (argv[i] === "--threshold" && argv[i + 1]) {
      threshold = parseFloat(argv[++i]);
    }
  }

  if (!current || !baseline) {
    console.error("Usage: locomo-gate-check.ts --current <file> --baseline <file> [--threshold 0.05]");
    process.exit(2);
  }

  return { current, baseline, threshold };
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

  if (!result.passed) {
    process.exit(1);
  }
}
