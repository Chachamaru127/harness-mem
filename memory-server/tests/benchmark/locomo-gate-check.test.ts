import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  checkCategoryFloor,
  checkF1Gate,
  DEFAULT_F1_THRESHOLD,
  extractCategoryF1,
  resolveThreshold,
} from "../../src/benchmark/locomo-gate-check";

describe("locomo-gate-check: checkF1Gate", () => {
  test("F1 が閾値未満の低下ならば PASSED", () => {
    // baseline=0.60, current=0.58 → drop≈3.33% → 閾値5%未満 → PASS
    const result = checkF1Gate(0.58, 0.60, 0.05);
    expect(result.passed).toBe(true);
    expect(result.relativeDrop).toBeLessThan(0.05);
    expect(result.message).toContain("PASSED");
  });

  test("F1 が閾値を超える低下ならば FAILED", () => {
    // baseline=0.60, current=0.56 → drop≈6.67% → 閾値5%超 → FAIL
    const result = checkF1Gate(0.56, 0.60, 0.05);
    expect(result.passed).toBe(false);
    expect(result.relativeDrop).toBeGreaterThan(0.05);
    expect(result.message).toContain("FAILED");
    expect(result.message).toContain("6.67%");
  });
});

describe("locomo-gate-check: resolveThreshold (LOCO-003)", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["LOCOMO_F1_THRESHOLD"];
    delete process.env["LOCOMO_F1_THRESHOLD"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["LOCOMO_F1_THRESHOLD"] = originalEnv;
    } else {
      delete process.env["LOCOMO_F1_THRESHOLD"];
    }
  });

  test("環境変数未設定時はデフォルト値 0.05 を返す", () => {
    const threshold = resolveThreshold();
    expect(threshold).toBe(DEFAULT_F1_THRESHOLD);
    expect(threshold).toBe(0.05);
  });

  test("LOCOMO_F1_THRESHOLD 環境変数が設定されていれば その値を返す", () => {
    process.env["LOCOMO_F1_THRESHOLD"] = "0.03";
    const threshold = resolveThreshold();
    expect(threshold).toBeCloseTo(0.03, 5);
  });

  test("CLI 引数が環境変数より優先される", () => {
    process.env["LOCOMO_F1_THRESHOLD"] = "0.03";
    const threshold = resolveThreshold(0.10);
    expect(threshold).toBeCloseTo(0.10, 5);
  });
});

describe("locomo-gate-check: category gates", () => {
  test("extractCategoryF1 は metrics.by_category から値を取得できる", () => {
    const sample = {
      metrics: {
        by_category: {
          "cat-2": { f1: 0.21 },
          "cat-3": { f1: 0.27 },
        },
      },
    };
    expect(extractCategoryF1(sample, "cat-2")).toBeCloseTo(0.21, 5);
    expect(extractCategoryF1(sample, "cat-3")).toBeCloseTo(0.27, 5);
    expect(extractCategoryF1(sample, "cat-4")).toBeNull();
  });

  test("checkCategoryFloor は floor を下回ると FAILED", () => {
    const fail = checkCategoryFloor("cat-2", 0.19, 0.20);
    expect(fail.passed).toBe(false);
    expect(fail.message).toContain("FAILED");

    const pass = checkCategoryFloor("cat-3", 0.25, 0.24);
    expect(pass.passed).toBe(true);
    expect(pass.message).toContain("PASSED");
  });
});
