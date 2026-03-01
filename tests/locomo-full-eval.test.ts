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
