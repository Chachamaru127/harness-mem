/**
 * V5-007: ベンチマークランナー + 回帰ゲート テスト
 *
 * BenchmarkRunner の metrics 計算と regression-gate の動作を検証する。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BenchmarkRunner, type BenchmarkResult } from "../src/benchmark/runner";
import { checkRegression, type RegressionConfig } from "../src/benchmark/regression-gate";
import { HarnessMemCore, type Config } from "../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-benchmark-test-"));
  cleanupPaths.push(dir);
  return dir;
}

function createConfig(name: string): Config {
  const dir = createTempDir();
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

// -------------------------------------------------------------------
// BenchmarkRunner: メトリクス計算ユニットテスト
// -------------------------------------------------------------------

describe("BenchmarkRunner: メトリクス計算", () => {
  // ダミー core（search は固定値を返す）
  function makeRunner(searchResult: { id: string; content?: string }[]) {
    const dummyCore = {
      recordEvent: (_: unknown) => {},
      search: (_: unknown) => ({ items: searchResult }),
    };
    return new BenchmarkRunner(dummyCore as any);
  }

  test("recall@10: 全件ヒットで 1.0 を返す", () => {
    const runner = makeRunner([]);
    const retrieved = ["obs_a", "obs_b", "obs_c"];
    const relevant = ["obs_a", "obs_b"];
    expect(runner.calculateRecallAtK(retrieved, relevant, 10)).toBe(1.0);
  });

  test("recall@10: ヒットなしで 0 を返す", () => {
    const runner = makeRunner([]);
    const retrieved = ["obs_x", "obs_y"];
    const relevant = ["obs_a"];
    expect(runner.calculateRecallAtK(retrieved, relevant, 10)).toBe(0);
  });

  test("recall@10: relevant が空の場合 1 を返す", () => {
    const runner = makeRunner([]);
    const retrieved = ["obs_x"];
    const relevant: string[] = [];
    expect(runner.calculateRecallAtK(retrieved, relevant, 10)).toBe(1);
  });

  test("precision@10: 上位10件のうちヒット件数/kを返す", () => {
    const runner = makeRunner([]);
    const retrieved = ["obs_a", "obs_b", "obs_c", "obs_d", "obs_e", "obs_f", "obs_g", "obs_h", "obs_i", "obs_j"];
    const relevant = ["obs_a", "obs_c"];
    // k=10 のうち 2 件ヒット => 2/10 = 0.2
    expect(runner.calculatePrecisionAtK(retrieved, relevant, 10)).toBeCloseTo(0.2);
  });

  test("precision@10: k=0 の場合 0 を返す", () => {
    const runner = makeRunner([]);
    expect(runner.calculatePrecisionAtK(["obs_a"], ["obs_a"], 0)).toBe(0);
  });

  test("MRR: 1位ヒットで 1.0 を返す", () => {
    const runner = makeRunner([]);
    expect(runner.calculateMRR(["obs_a", "obs_b"], ["obs_a"])).toBe(1.0);
  });

  test("MRR: 2位ヒットで 0.5 を返す", () => {
    const runner = makeRunner([]);
    expect(runner.calculateMRR(["obs_x", "obs_a"], ["obs_a"])).toBeCloseTo(0.5);
  });

  test("MRR: ヒットなしで 0 を返す", () => {
    const runner = makeRunner([]);
    expect(runner.calculateMRR(["obs_x", "obs_y"], ["obs_a"])).toBe(0);
  });

  test("NDCG: 1位ヒットで NDCG が 1 に近い値を返す", () => {
    const runner = makeRunner([]);
    const retrieved = ["obs_a", "obs_b", "obs_c"];
    const relevant = ["obs_a"];
    // DCG = 1/log2(2) = 1, IDCG = 1 => NDCG = 1.0
    expect(runner.calculateNDCG(retrieved, relevant, 10)).toBeCloseTo(1.0);
  });

  test("NDCG: relevant が空の場合 0 を返す（idcg = 0）", () => {
    const runner = makeRunner([]);
    const retrieved = ["obs_a"];
    const relevant: string[] = [];
    // idcg = 0 => 0
    expect(runner.calculateNDCG(retrieved, relevant, 10)).toBe(0);
  });

  test("NDCG: 2位ヒットで 1.0 より小さい値を返す", () => {
    const runner = makeRunner([]);
    const retrieved = ["obs_x", "obs_a"];
    const relevant = ["obs_a"];
    const ndcg = runner.calculateNDCG(retrieved, relevant, 10);
    expect(ndcg).toBeGreaterThan(0);
    expect(ndcg).toBeLessThan(1.0);
  });
});

// -------------------------------------------------------------------
// BenchmarkRunner: ロケーションデータセット統合テスト
// -------------------------------------------------------------------

describe("BenchmarkRunner: locomo-mini データセット実行", () => {
  test("locomo データセットで run() が BenchmarkResult を返す", async () => {
    const core = new HarnessMemCore(createConfig("locomo"));
    try {
      const runner = new BenchmarkRunner(core as any);
      const result = await runner.run({
        dataset: "locomo",
        maxSamples: 3,
        metrics: ["recall@10", "precision@10", "mrr", "ndcg"],
      });

      expect(result.dataset).toBe("locomo");
      expect(result.samples).toBe(3);
      expect(result.duration_ms).toBeGreaterThan(0);
      expect(typeof result.metrics["recall@10"]).toBe("number");
      expect(typeof result.metrics["precision@10"]).toBe("number");
      expect(typeof result.metrics["mrr"]).toBe("number");
      expect(typeof result.metrics["ndcg"]).toBe("number");
      // 各メトリクスは 0〜1 の範囲
      for (const [key, val] of Object.entries(result.metrics)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1 + 1e-9);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("longmemeval データセットで run() が BenchmarkResult を返す", async () => {
    const core = new HarnessMemCore(createConfig("longmemeval"));
    try {
      const runner = new BenchmarkRunner(core as any);
      const result = await runner.run({
        dataset: "longmemeval",
        maxSamples: 3,
        metrics: ["recall@10", "mrr"],
      });

      expect(result.dataset).toBe("longmemeval");
      expect(result.samples).toBe(3);
      expect(result.metrics["recall@10"]).toBeGreaterThanOrEqual(0);
      expect(result.metrics["mrr"]).toBeGreaterThanOrEqual(0);
      // precision@10 は設定していないのでキーが存在しない
      expect(result.metrics["precision@10"]).toBeUndefined();
    } finally {
      core.shutdown("test");
    }
  });

  test("maxSamples で取得件数が制限される", async () => {
    const core = new HarnessMemCore(createConfig("maxsamples"));
    try {
      const runner = new BenchmarkRunner(core as any);
      const result = await runner.run({
        dataset: "locomo",
        maxSamples: 2,
        metrics: ["recall@10"],
      });
      expect(result.samples).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });
});

// -------------------------------------------------------------------
// regression-gate テスト
// -------------------------------------------------------------------

describe("regression-gate: checkRegression", () => {
  function makeResult(recall: number): BenchmarkResult {
    return {
      dataset: "locomo",
      timestamp: new Date().toISOString(),
      metrics: { "recall@10": recall },
      samples: 10,
      duration_ms: 100,
    };
  }

  test("ベースラインファイルが存在しない場合は passed=true", () => {
    const result = makeResult(0.5);
    const check = checkRegression(result, {
      baseline_file: "/tmp/nonexistent-baseline-xyz.json",
      threshold: 0.05,
      metric: "recall@10",
    });
    expect(check.passed).toBe(true);
    expect(check.message).toContain("baseline file not found");
  });

  test("回帰なし: delta ≥ 0 で passed=true", () => {
    const dir = createTempDir();
    const baselineFile = join(dir, "baseline.json");
    const baseline = makeResult(0.5);
    writeFileSync(baselineFile, JSON.stringify(baseline));

    const current = makeResult(0.55);
    const check = checkRegression(current, {
      baseline_file: baselineFile,
      threshold: 0.05,
      metric: "recall@10",
    });
    expect(check.passed).toBe(true);
    expect(check.delta).toBeCloseTo(0.05);
  });

  test("許容範囲内の低下: passed=true", () => {
    const dir = createTempDir();
    const baselineFile = join(dir, "baseline.json");
    const baseline = makeResult(0.8);
    writeFileSync(baselineFile, JSON.stringify(baseline));

    // 2% 低下（閾値 5% 以内）
    const current = makeResult(0.784);
    const check = checkRegression(current, {
      baseline_file: baselineFile,
      threshold: 0.05,
      metric: "recall@10",
    });
    expect(check.passed).toBe(true);
  });

  test("閾値超過の低下: passed=false で REGRESSION DETECTED メッセージ", () => {
    const dir = createTempDir();
    const baselineFile = join(dir, "baseline.json");
    const baseline = makeResult(0.8);
    writeFileSync(baselineFile, JSON.stringify(baseline));

    // 10% 低下（閾値 5% 超過）
    const current = makeResult(0.72);
    const check = checkRegression(current, {
      baseline_file: baselineFile,
      threshold: 0.05,
      metric: "recall@10",
    });
    expect(check.passed).toBe(false);
    expect(check.message).toContain("REGRESSION DETECTED");
    expect(check.baseline).toBeCloseTo(0.8);
    expect(check.current).toBeCloseTo(0.72);
    expect(check.delta).toBeCloseTo(-0.08);
  });

  test("ベースラインが 0 の場合: delta が 0 で passed=true（ゼロ除算回避）", () => {
    const dir = createTempDir();
    const baselineFile = join(dir, "baseline.json");
    const baseline = makeResult(0);
    writeFileSync(baselineFile, JSON.stringify(baseline));

    const current = makeResult(0.5);
    const check = checkRegression(current, {
      baseline_file: baselineFile,
      threshold: 0.05,
      metric: "recall@10",
    });
    expect(check.passed).toBe(true);
  });

  test("存在しないメトリクスキーは 0 として扱われる", () => {
    const dir = createTempDir();
    const baselineFile = join(dir, "baseline.json");
    const baseline = makeResult(0.5);
    writeFileSync(baselineFile, JSON.stringify(baseline));

    const current = makeResult(0.5);
    // mrr は current.metrics に存在しない
    const check = checkRegression(current, {
      baseline_file: baselineFile,
      threshold: 0.05,
      metric: "mrr",
    });
    // baseline.mrr = 0, current.mrr = 0 => delta = 0 => passed
    expect(check.passed).toBe(true);
  });

  test("壊れた JSON のベースラインは skipped（passed=true）", () => {
    const dir = createTempDir();
    const baselineFile = join(dir, "baseline.json");
    writeFileSync(baselineFile, "{ invalid json }");

    const current = makeResult(0.5);
    const check = checkRegression(current, {
      baseline_file: baselineFile,
      threshold: 0.05,
      metric: "recall@10",
    });
    expect(check.passed).toBe(true);
    expect(check.message).toContain("failed to parse");
  });
});

// -------------------------------------------------------------------
// 空データセットのエッジケース
// -------------------------------------------------------------------

describe("BenchmarkRunner: エッジケース", () => {
  test("空 retrieved で recall=0, precision=0, MRR=0, NDCG=0 を返す", () => {
    const dummyCore = {
      recordEvent: (_: unknown) => {},
      search: (_: unknown) => ({ items: [] }),
    };
    const runner = new BenchmarkRunner(dummyCore as any);

    expect(runner.calculateRecallAtK([], ["obs_a"], 10)).toBe(0);
    expect(runner.calculatePrecisionAtK([], ["obs_a"], 10)).toBe(0);
    expect(runner.calculateMRR([], ["obs_a"])).toBe(0);
    expect(runner.calculateNDCG([], ["obs_a"], 10)).toBe(0);
  });
});
