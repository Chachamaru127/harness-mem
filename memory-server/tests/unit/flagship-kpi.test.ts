import { describe, expect, test } from "bun:test";
import {
  FLAGSHIP_FRESHNESS_GREEN_THRESHOLD,
  FLAGSHIP_KPI_NAME,
  buildFlagshipKpi,
} from "../../src/benchmark/flagship-kpi";

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
