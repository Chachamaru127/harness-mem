/**
 * §34 FD-011: BenchmarkRunner の統計メソッドテスト
 *
 * bootstrapCI / holmBonferroni の動作を検証する。
 */

import { describe, expect, test } from "bun:test";
import { BenchmarkRunner } from "../../src/benchmark/runner";

// テスト用スタブ core（recordEvent / search の最小実装）
const stubCore = {
  recordEvent: () => {},
  search: () => ({ items: [] }),
};

const runner = new BenchmarkRunner(stubCore as Parameters<typeof BenchmarkRunner>[0]);

// ---------------------------------------------------------------------------
// bootstrapCI
// ---------------------------------------------------------------------------

describe("bootstrapCI", () => {
  test("returns correct structure", () => {
    const result = runner.bootstrapCI([0.8, 0.9, 0.7, 0.85, 0.75]);
    expect(result).toHaveProperty("lower");
    expect(result).toHaveProperty("upper");
    expect(result).toHaveProperty("mean");
    expect(result).toHaveProperty("se");
    expect(result).toHaveProperty("method");
  });

  test("mean is correct", () => {
    const scores = [0.6, 0.7, 0.8, 0.9, 1.0];
    const result = runner.bootstrapCI(scores, 5000);
    expect(result.mean).toBeCloseTo(0.8, 2);
  });

  test("lower <= mean <= upper", () => {
    const scores = [0.5, 0.6, 0.7, 0.8, 0.9, 0.6, 0.7];
    const result = runner.bootstrapCI(scores, 5000);
    expect(result.lower).toBeLessThanOrEqual(result.mean);
    expect(result.mean).toBeLessThanOrEqual(result.upper);
  });

  test("CI width shrinks with more samples", () => {
    const scores = Array.from({ length: 5 }, (_, i) => 0.5 + i * 0.1);
    const smallN = runner.bootstrapCI(scores, 1000);
    const largeN = runner.bootstrapCI(scores.concat(scores.concat(scores.concat(scores))), 1000);
    // サンプル数が多いほど SE は小さくなる傾向
    expect(largeN.se).toBeLessThanOrEqual(smallN.se + 0.1);
  });

  test("empty array returns zeros", () => {
    const result = runner.bootstrapCI([]);
    expect(result.mean).toBe(0);
    expect(result.lower).toBe(0);
    expect(result.upper).toBe(0);
    expect(result.method).toBe("empty");
  });

  test("recall=1.0 falls back to wilson CI", () => {
    const result = runner.bootstrapCI([1.0, 1.0, 1.0, 1.0, 1.0]);
    expect(result.method).toBe("wilson");
    expect(result.mean).toBe(1.0);
    expect(result.lower).toBeGreaterThanOrEqual(0);
    expect(result.upper).toBeLessThanOrEqual(1);
  });

  test("recall=0.0 falls back to wilson CI", () => {
    const result = runner.bootstrapCI([0.0, 0.0, 0.0, 0.0]);
    expect(result.method).toBe("wilson");
    expect(result.mean).toBe(0.0);
  });

  test("bootstrap method for normal scores", () => {
    const result = runner.bootstrapCI([0.7, 0.8, 0.75, 0.85, 0.9], 5000);
    expect(result.method).toBe("bootstrap");
  });

  test("single score returns valid CI", () => {
    const result = runner.bootstrapCI([0.75], 1000);
    expect(result.mean).toBe(0.75);
    expect(typeof result.lower).toBe("number");
    expect(typeof result.upper).toBe("number");
  });

  test("bounds are in [0, 1] range", () => {
    const result = runner.bootstrapCI([0.1, 0.9, 0.5, 0.3, 0.7], 5000);
    expect(result.lower).toBeGreaterThanOrEqual(0);
    expect(result.upper).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// holmBonferroni
// ---------------------------------------------------------------------------

describe("holmBonferroni", () => {
  test("rejects clearly significant hypotheses", () => {
    const pValues = [0.001, 0.01, 0.5];
    const result = runner.holmBonferroni(pValues, 0.05);
    expect(result[0]).toBe(true);  // p=0.001 → 棄却
    expect(result[1]).toBe(true);  // p=0.01 → 棄却（Holm補正後も有意）
    expect(result[2]).toBe(false); // p=0.5 → 棄却しない
  });

  test("does not reject when all p-values are large", () => {
    const pValues = [0.1, 0.2, 0.3, 0.4];
    const result = runner.holmBonferroni(pValues, 0.05);
    expect(result.every((r) => r === false)).toBe(true);
  });

  test("rejects all when all p-values are tiny", () => {
    const pValues = [0.0001, 0.0002, 0.0003];
    const result = runner.holmBonferroni(pValues, 0.05);
    expect(result.every((r) => r === true)).toBe(true);
  });

  test("preserves original order", () => {
    // p値が大→小の順で入力、結果は元順序を保持するべき
    const pValues = [0.5, 0.001, 0.3];
    const result = runner.holmBonferroni(pValues, 0.05);
    expect(result[0]).toBe(false); // p=0.5 → 棄却しない
    expect(result[1]).toBe(true);  // p=0.001 → 棄却
    expect(result[2]).toBe(false); // p=0.3 → 棄却しない
  });

  test("empty array returns empty array", () => {
    expect(runner.holmBonferroni([])).toEqual([]);
  });

  test("single hypothesis: p < alpha → reject", () => {
    expect(runner.holmBonferroni([0.04], 0.05)).toEqual([true]);
  });

  test("single hypothesis: p > alpha → not reject", () => {
    expect(runner.holmBonferroni([0.06], 0.05)).toEqual([false]);
  });

  test("monotonicity: once non-rejected, all subsequent are non-rejected", () => {
    const pValues = [0.001, 0.04, 0.06, 0.1, 0.5];
    const result = runner.holmBonferroni(pValues, 0.05);
    // 最初に false が出たら以降は false
    let foundFalse = false;
    for (const r of result) {
      if (!r) foundFalse = true;
      if (foundFalse) expect(r).toBe(false);
    }
  });

  test("returns boolean array of same length", () => {
    const pValues = [0.01, 0.02, 0.03, 0.5, 0.9];
    const result = runner.holmBonferroni(pValues, 0.05);
    expect(result.length).toBe(pValues.length);
    for (const r of result) {
      expect(typeof r).toBe("boolean");
    }
  });
});
