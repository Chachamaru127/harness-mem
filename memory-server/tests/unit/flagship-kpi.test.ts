import { describe, expect, test } from "bun:test";
import {
  FLAGSHIP_FRESHNESS_GREEN_THRESHOLD,
  FLAGSHIP_KPI_NAME,
  buildFlagshipKpi,
  buildDeepFreshnessSubBlock,
} from "../../src/benchmark/flagship-kpi";

// S154-FU02: deep freshness gate judgment tests (TDD Red phase)
describe("S154-FU02 deep freshness gate judgment", () => {
  const measuredTenseRewrite = {
    status: "measured" as const,
    n: 32,
    accuracy: 0.969,
    false_positive_rate: 0.0,
  };
  const measuredSupersession = {
    status: "measured" as const,
    n: 21,
    precision: 1.0,
    recall: 0.6,
    f1: 0.75,
  };
  const measuredLag = {
    status: "measured" as const,
    n: 5,
    p50_ms: 1500,
    p95_ms: 15000,
  };

  test("green when shallow freshness >= 0.95 AND both enforce metrics pass", () => {
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: measuredTenseRewrite,
      supersession: measuredSupersession,
      freshness_lag: measuredLag,
      shallow_freshness: 0.97,
    });
    expect(block.gate_verdict).toBe("green");
    expect(block.gate_detail.shallow_ok).toBe(true);
    expect(block.gate_detail.tense_rewrite_ok).toBe(true);
    expect(block.gate_detail.supersession_ok).toBe(true);
  });

  test("red when shallow freshness < 0.95", () => {
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: measuredTenseRewrite,
      supersession: measuredSupersession,
      freshness_lag: measuredLag,
      shallow_freshness: 0.90,
    });
    expect(block.gate_verdict).toBe("red");
    expect(block.gate_detail.shallow_ok).toBe(false);
  });

  test("red when tense_rewrite accuracy below threshold", () => {
    const failingTenseRewrite = { ...measuredTenseRewrite, accuracy: 0.80 };
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: failingTenseRewrite,
      supersession: measuredSupersession,
      freshness_lag: measuredLag,
      shallow_freshness: 0.99,
    });
    expect(block.gate_verdict).toBe("red");
    expect(block.gate_detail.tense_rewrite_ok).toBe(false);
  });

  test("red when supersession precision below threshold", () => {
    const failingSupersession = { ...measuredSupersession, precision: 0.80 };
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: measuredTenseRewrite,
      supersession: failingSupersession,
      freshness_lag: measuredLag,
      shallow_freshness: 0.99,
    });
    expect(block.gate_verdict).toBe("red");
    expect(block.gate_detail.supersession_ok).toBe(false);
  });

  test("freshness_lag violation is warn-only and does not affect gate verdict", () => {
    const highLag = { ...measuredLag, p50_ms: 99999, p95_ms: 999999 };
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: measuredTenseRewrite,
      supersession: measuredSupersession,
      freshness_lag: highLag,
      shallow_freshness: 0.99,
    });
    expect(block.gate_verdict).toBe("green");
    expect(block.lag_warn).toBe(true);
  });

  test("lag warn is false when lag is within ceiling", () => {
    const goodLag = { status: "measured" as const, n: 5, p50_ms: 1000, p95_ms: 5000 };
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: measuredTenseRewrite,
      supersession: measuredSupersession,
      freshness_lag: goodLag,
      shallow_freshness: 0.99,
    });
    expect(block.lag_warn).toBe(false);
  });

  test("skipped enforce metrics yield yellow verdict", () => {
    const skippedTenseRewrite = { status: "skipped" as const, skip_reason: "ollama unreachable" };
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: skippedTenseRewrite,
      supersession: measuredSupersession,
      freshness_lag: measuredLag,
      shallow_freshness: 0.99,
    });
    expect(block.gate_verdict).toBe("yellow");
  });

  test("thresholds_source references the config file path", () => {
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: measuredTenseRewrite,
      supersession: measuredSupersession,
      freshness_lag: measuredLag,
      shallow_freshness: 0.99,
    });
    expect(block.thresholds_source).toContain("deep-freshness-thresholds.json");
  });

  test("yellow when shallow_freshness is omitted (standalone bench without CI manifest)", () => {
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: measuredTenseRewrite,
      supersession: measuredSupersession,
      freshness_lag: measuredLag,
    });
    expect(block.gate_verdict).toBe("yellow");
    expect(block.gate_detail.shallow_ok).toBeNull();
    expect(block.gate_detail.tense_rewrite_ok).toBe(true);
    expect(block.gate_detail.supersession_ok).toBe(true);
  });

  test("red overrides yellow when shallow_freshness omitted but an enforce metric fails", () => {
    const block = buildDeepFreshnessSubBlock({
      tense_rewrite: {
        status: "measured" as const,
        n: 32,
        accuracy: 0.80,
        false_positive_rate: 0.0,
      },
      supersession: measuredSupersession,
      freshness_lag: measuredLag,
    });
    expect(block.gate_verdict).toBe("red");
    expect(block.gate_detail.shallow_ok).toBeNull();
    expect(block.gate_detail.tense_rewrite_ok).toBe(false);
  });
});

describe("S154-304 flagship KPI display promotion", () => {
  test("green threshold is the fixed release-gate constant", () => {
    expect(FLAGSHIP_FRESHNESS_GREEN_THRESHOLD).toBe(0.95);
  });

  test("buildFlagshipKpi marks green at or above the threshold", () => {
    const atThreshold = buildFlagshipKpi(FLAGSHIP_FRESHNESS_GREEN_THRESHOLD);
    expect(atThreshold.name).toBe(FLAGSHIP_KPI_NAME);
    expect(atThreshold.green).toBe(true);

    const current = buildFlagshipKpi(0.99);
    expect(current.value).toBe(0.99);
    expect(current.green).toBe(true);
  });

  test("buildFlagshipKpi marks red below the threshold without throwing", () => {
    const below = buildFlagshipKpi(FLAGSHIP_FRESHNESS_GREEN_THRESHOLD - 0.01);
    expect(below.green).toBe(false);
    expect(below.green_threshold).toBe(FLAGSHIP_FRESHNESS_GREEN_THRESHOLD);
  });

  test("scope note keeps the self-seeded non-superiority framing", () => {
    const kpi = buildFlagshipKpi(1);
    expect(kpi.scope_note).toContain("self-seeded");
    expect(kpi.scope_note).toContain("not a superiority claim");
  });
});
