/**
 * §54 S54-009: 統合ベンチマーク実行スクリプト
 *
 * fixture-integrator.ts で生成された統合 fixture を読み込み、
 * 各 QA をハーネスの検索エンジンに対して実行して F1 / EM を計測する。
 *
 * 注意: このスクリプトは fixture の存在確認と統計レポートを行う薄いラッパーである。
 * 実際の search 品質評価は run-ci.ts の既存パイプラインに委ねる。
 *
 * 使用方法: bun run run-integrated-benchmark.ts [fixture-path]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

export interface IntegratedBenchmarkReport {
  schema_version: "integrated-benchmark-v1";
  generated_at: string;
  fixture_path: string;
  total_items: number;
  by_source: Record<string, number>;
  by_slice: Record<string, number>;
  by_category: Record<string, number>;
  gate: {
    min_items: number;
    current_items: number;
    passed: boolean;
    message: string;
  };
}

const MIN_ITEMS_FOR_GATE = 300; // 最低300問で gate pass
const RESULTS_DIR = join(import.meta.dir, "results");
const REPORT_PATH = join(RESULTS_DIR, "integrated-benchmark-latest.json");

export interface UnifiedQA {
  question_id: string;
  question: string;
  answer: string;
  category: string;
  slice: string;
  cross_lingual: boolean;
  source: string;
  session_id?: string;
}

interface IntegratedFixture {
  schema_version: string;
  total_count: number;
  by_slice: Record<string, number>;
  by_source: Record<string, number>;
  by_category: Record<string, number>;
  items: UnifiedQA[];
}

export function validateFixture(fixturePath: string): IntegratedBenchmarkReport {
  if (!existsSync(fixturePath)) {
    return {
      schema_version: "integrated-benchmark-v1",
      generated_at: new Date().toISOString(),
      fixture_path: fixturePath,
      total_items: 0,
      by_source: {},
      by_slice: {},
      by_category: {},
      gate: {
        min_items: MIN_ITEMS_FOR_GATE,
        current_items: 0,
        passed: false,
        message: `Fixture not found: ${fixturePath}`,
      },
    };
  }

  const data: IntegratedFixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const passed = data.total_count >= MIN_ITEMS_FOR_GATE;

  return {
    schema_version: "integrated-benchmark-v1",
    generated_at: new Date().toISOString(),
    fixture_path: fixturePath,
    total_items: data.total_count,
    by_source: data.by_source,
    by_slice: data.by_slice,
    by_category: data.by_category,
    gate: {
      min_items: MIN_ITEMS_FOR_GATE,
      current_items: data.total_count,
      passed,
      message: passed
        ? `PASS: ${data.total_count} items >= ${MIN_ITEMS_FOR_GATE} minimum`
        : `FAIL: ${data.total_count} items < ${MIN_ITEMS_FOR_GATE} minimum`,
    },
  };
}

/** スライス別の統計サマリーを生成 */
export function sliceStatsSummary(
  items: UnifiedQA[]
): Record<string, { count: number; ja_count: number; en_count: number; cross_lingual_count: number }> {
  const stats: Record<
    string,
    { count: number; ja_count: number; en_count: number; cross_lingual_count: number }
  > = {};
  const jaRegex = /[\u3041-\u3096\u30A1-\u30FA\u30FC\u4E00-\u9FFF]/;

  for (const item of items) {
    if (!stats[item.slice])
      stats[item.slice] = { count: 0, ja_count: 0, en_count: 0, cross_lingual_count: 0 };
    stats[item.slice].count++;
    if (jaRegex.test(item.question)) stats[item.slice].ja_count++;
    else stats[item.slice].en_count++;
    if (item.cross_lingual) stats[item.slice].cross_lingual_count++;
  }

  return stats;
}

// CLI
if (import.meta.main) {
  const FIXTURES_DIR = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures");
  const defaultFixture = join(FIXTURES_DIR, "japanese-integrated-benchmark.json");
  const fixturePath = process.argv[2] ? resolve(process.argv[2]) : defaultFixture;

  console.log(`[integrated-benchmark] Fixture: ${fixturePath}`);

  const report = validateFixture(fixturePath);

  console.log(`[integrated-benchmark] Total: ${report.total_items} items`);
  console.log(`[integrated-benchmark] Gate: ${report.gate.message}`);

  if (report.total_items > 0) {
    console.log(`[integrated-benchmark] By source:`);
    for (const [src, cnt] of Object.entries(report.by_source)) {
      console.log(`  ${src}: ${cnt}`);
    }
    console.log(`[integrated-benchmark] By slice:`);
    for (const [slice, cnt] of Object.entries(report.by_slice).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${slice}: ${cnt}`);
    }
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`[integrated-benchmark] Report written to ${REPORT_PATH}`);

  process.exit(report.gate.passed ? 0 : 1);
}
