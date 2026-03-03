import { describe, expect, test } from "bun:test";
import { checkF1Gate } from "../../src/benchmark/locomo-gate-check";

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
