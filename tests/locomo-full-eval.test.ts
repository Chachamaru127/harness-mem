/**
 * NEXT-011: LoCoMo フルデータセット評価 テスト
 * フルデータセット対応のランナーが正常に動作することを検証する。
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  runLocomoFullBenchmark,
  type LocomoFullBenchmarkOptions,
} from "../benchmarks/locomo-full";

const FIXTURE_120 = join(process.cwd(), "tests", "benchmarks", "fixtures", "locomo-120.json");
const FIXTURE_10 = join(process.cwd(), "tests", "benchmarks", "fixtures", "locomo10.sample.json");
const FIXTURE_15x3 = join(process.cwd(), "tests", "benchmarks", "fixtures", "locomo-15x3.json");

describe("NEXT-011: LoCoMo フルデータセット評価", () => {
  test("runLocomoFullBenchmark がエクスポートされている", () => {
    expect(typeof runLocomoFullBenchmark).toBe("function");
  });

  test("LOCOMO-120 フィクスチャが存在する", () => {
    expect(existsSync(FIXTURE_120)).toBe(true);
  });

  test("runLocomoFullBenchmark が 10 件サンプルデータで LocomoBenchmarkResult を返す", async () => {
    const opts: LocomoFullBenchmarkOptions = {
      datasetPath: FIXTURE_10,
      maxSamples: 3,
    };
    const result = await runLocomoFullBenchmark(opts);
    expect(result.schema_version).toBe("locomo-benchmark-v2");
    expect(result.metrics.overall.count).toBeGreaterThan(0);
    expect(result.dataset_info.total_samples).toBeGreaterThan(0);
    expect(result.dataset_info.evaluated_samples).toBeGreaterThan(0);
  });
});

describe("HARDEN-006: maxSamples 伝播バグ回帰テスト", () => {
  // テスト1: maxSamples=3 → 評価件数 ≤ 3
  test("maxSamples=3 指定時に評価サンプル数が 3 件に制限される", async () => {
    const opts: LocomoFullBenchmarkOptions = {
      datasetPath: FIXTURE_15x3,
      maxSamples: 3,
    };
    const result = await runLocomoFullBenchmark(opts);
    // データセット総件数は15件（制限前の全件数を記録）
    expect(result.dataset_info.total_samples).toBe(15);
    // 評価されたサンプル数は maxSamples の制限値を超えないこと
    expect(result.dataset_info.evaluated_samples).toBeLessThanOrEqual(3);
    // QA 件数も3サンプル分（3×3=9件）以下
    expect(result.metrics.overall.count).toBeLessThanOrEqual(9);
  });

  // テスト2: maxSamples 未指定 → 全件評価
  test("maxSamples 未指定時はデータセット全件（15件）が評価される", async () => {
    const opts: LocomoFullBenchmarkOptions = {
      datasetPath: FIXTURE_15x3,
    };
    const result = await runLocomoFullBenchmark(opts);
    // 全件評価なので total_samples === evaluated_samples === 15
    expect(result.dataset_info.total_samples).toBe(15);
    expect(result.dataset_info.evaluated_samples).toBe(15);
    expect(result.metrics.overall.count).toBe(45);
  });
});
