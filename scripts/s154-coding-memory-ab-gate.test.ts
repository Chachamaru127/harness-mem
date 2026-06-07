/**
 * S154-100: CodingMemory A/B gate decision-logic tests.
 *
 * Pure-function tests for `decideAb()` and `recallsFromResults()` — verifies the
 * fixed { metric, baseline, candidate, delta } schema and the improved/neutral/
 * regressed thresholds without running the benchmark (the live run is exercised by
 * scripts/s154-coding-memory-ab-gate.ts against the CodingMemory dataset).
 */

import { describe, expect, test } from "bun:test";
import {
  decideAb,
  recallsFromResults,
  AB_METRIC_NAMES,
  type AbMetricName,
  type RecallByMetric,
} from "./s154-coding-memory-ab-gate";

const BOTH: AbMetricName[] = [...AB_METRIC_NAMES];

function recalls(mixed: number, ja: number): RecallByMetric {
  return { mixed_recall_at_10: mixed, ja_recall_at_10: ja };
}

describe("S154-100 decideAb()", () => {
  test("emits the fixed { metric, baseline, candidate, delta } schema per metric", () => {
    const { metrics } = decideAb(recalls(0.30, 0.0), recalls(0.34, 0.05), BOTH, 0.02, 0.02);
    expect(metrics).toHaveLength(2);
    for (const row of metrics) {
      expect(Object.keys(row).sort()).toEqual(["baseline", "candidate", "delta", "metric"]);
      expect(row.delta).toBeCloseTo(row.candidate - row.baseline, 10);
    }
  });

  test("all metrics rise >= min-delta → improved", () => {
    const { decision } = decideAb(recalls(0.30, 0.10), recalls(0.33, 0.13), BOTH, 0.02, 0.02);
    expect(decision).toBe("improved");
  });

  test("one metric flat, other up → neutral (not improved)", () => {
    const { decision } = decideAb(recalls(0.30, 0.10), recalls(0.34, 0.10), BOTH, 0.02, 0.02);
    expect(decision).toBe("neutral");
  });

  test("any metric drops >= regression band → regressed", () => {
    const { decision, reason } = decideAb(recalls(0.30, 0.10), recalls(0.34, 0.07), BOTH, 0.02, 0.02);
    expect(decision).toBe("regressed");
    expect(reason).toMatch(/ja_recall_at_10 regressed/);
  });

  test("single-metric gate ignores the untargeted metric", () => {
    // ja collapses but we only target mixed → still improved
    const { decision } = decideAb(
      recalls(0.30, 0.40),
      recalls(0.33, 0.00),
      ["mixed_recall_at_10"],
      0.02,
      0.02,
    );
    expect(decision).toBe("improved");
  });

  test("borderline exactly +min-delta → improved (inclusive)", () => {
    const { decision } = decideAb(recalls(0.30, 0.10), recalls(0.32, 0.12), BOTH, 0.02, 0.02);
    expect(decision).toBe("improved");
  });

  test("equal candidate → neutral", () => {
    const { decision } = decideAb(recalls(0.30, 0.10), recalls(0.30, 0.10), BOTH, 0.02, 0.02);
    expect(decision).toBe("neutral");
  });

  test("regression band can be wider than improvement margin", () => {
    // small dip (-1%pt) tolerated when regression-delta=0.05
    const { decision } = decideAb(recalls(0.30, 0.10), recalls(0.30, 0.09), BOTH, 0.02, 0.05);
    expect(decision).toBe("neutral");
  });
});

describe("S154-100 recallsFromResults()", () => {
  const ROW = (over: Record<string, unknown>) => ({
    case_id: "c",
    competitor_id: "harness-mem",
    layer: "coding",
    status: "ok",
    recall_at_10: 0,
    mrr: 0,
    ndcg_at_10: 0,
    latency_ms: 1,
    language_profile: "mixed",
    ...over,
  });

  test("averages recall@10 per language_profile for harness-mem only", () => {
    const results = [
      ROW({ language_profile: "mixed", recall_at_10: 0.4 }),
      ROW({ language_profile: "mixed", recall_at_10: 0.6 }),
      ROW({ language_profile: "ja", recall_at_10: 0.2 }),
      ROW({ competitor_id: "other", language_profile: "mixed", recall_at_10: 1.0 }),
    ] as never;
    const out = recallsFromResults(results);
    expect(out.mixed_recall_at_10).toBeCloseTo(0.5, 10);
    expect(out.ja_recall_at_10).toBeCloseTo(0.2, 10);
  });

  test("throws a clear error when a profile has no scored cases", () => {
    const results = [ROW({ language_profile: "mixed", recall_at_10: 0.4 })] as never;
    expect(() => recallsFromResults(results)).toThrow(/no 'ja' cases/);
  });
});
