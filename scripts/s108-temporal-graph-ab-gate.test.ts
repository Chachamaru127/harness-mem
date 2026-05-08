/**
 * S108-015: A/B promotion gate decision logic tests
 *
 * Pure-function tests for `decide()` — verifies that the threshold-based gate
 * makes the correct call for each (baseline, candidate) input. Does not run
 * the actual benchmark (that is exercised by s108-temporal-graph-ab-gate.ts
 * against the live planner gate).
 */

import { describe, expect, test } from "bun:test";
import { decide, type GateMetrics } from "./s108-temporal-graph-ab-gate";

function metrics(overrides: Partial<GateMetrics> = {}): GateMetrics {
  return {
    answer_top1_rate: 0.6,
    hit_at_10_rate: 0.78,
    mean_order_score: 0.7,
    p95_latency_ms: 30,
    cases: 100,
    ...overrides,
  };
}

describe("S108-015 decide()", () => {
  test("hit@10 lift >= 2%pt and p95 stable → improved", () => {
    const baseline = metrics({ hit_at_10_rate: 0.78, p95_latency_ms: 30 });
    const candidate = metrics({ hit_at_10_rate: 0.81, p95_latency_ms: 32 });
    const { decision } = decide(baseline, candidate);
    expect(decision).toBe("improved");
  });

  test("hit@10 lift below threshold → neutral", () => {
    const baseline = metrics({ hit_at_10_rate: 0.78, p95_latency_ms: 30 });
    const candidate = metrics({ hit_at_10_rate: 0.79, p95_latency_ms: 31 });
    const { decision } = decide(baseline, candidate);
    expect(decision).toBe("neutral");
  });

  test("hit@10 drop >= 2%pt → regressed", () => {
    const baseline = metrics({ hit_at_10_rate: 0.78, p95_latency_ms: 30 });
    const candidate = metrics({ hit_at_10_rate: 0.74, p95_latency_ms: 31 });
    const { decision } = decide(baseline, candidate);
    expect(decision).toBe("regressed");
  });

  test("p95 regression > 5ms → regressed regardless of recall lift", () => {
    const baseline = metrics({ hit_at_10_rate: 0.78, p95_latency_ms: 30 });
    const candidate = metrics({ hit_at_10_rate: 0.95, p95_latency_ms: 36 });
    const { decision, reason } = decide(baseline, candidate);
    expect(decision).toBe("regressed");
    expect(reason).toMatch(/p95 regressed/);
  });

  test("equal candidate → neutral", () => {
    const baseline = metrics();
    const candidate = metrics();
    const { decision } = decide(baseline, candidate);
    expect(decision).toBe("neutral");
  });

  test("p95 inside tolerance with recall lift → improved", () => {
    const baseline = metrics({ hit_at_10_rate: 0.78, p95_latency_ms: 30 });
    const candidate = metrics({ hit_at_10_rate: 0.82, p95_latency_ms: 34 });
    const { decision } = decide(baseline, candidate);
    expect(decision).toBe("improved");
  });

  test("borderline 2.0%pt lift → improved (inclusive threshold)", () => {
    const baseline = metrics({ hit_at_10_rate: 0.78, p95_latency_ms: 30 });
    const candidate = metrics({ hit_at_10_rate: 0.80, p95_latency_ms: 30 });
    const { decision } = decide(baseline, candidate);
    expect(decision).toBe("improved");
  });
});
