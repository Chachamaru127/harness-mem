import { describe, expect, test } from "bun:test";
import { hasLeakage, filterCandidates } from "../lib/real-data/filters";
import type { CandidateCase } from "../lib/real-data/types";

function sampleCase(overrides: Partial<CandidateCase> = {}): CandidateCase {
  return {
    case_id: "test-001",
    layer: "ja_coding",
    category: "real_ar",
    competency: "AR",
    language_profile: "ja",
    project: "bench-real-test",
    memories: [{ id: "m1", content: "認証方式は JWT を使う。" }],
    query: "認証方式は？",
    relevant_ids: ["m1"],
    expected_keywords: ["JWT"],
    source_round_ids: ["r1"],
    ...overrides,
  };
}

describe("leakage filter", () => {
  test("rejects when query contains expected keyword (shortcut/leakage)", () => {
    const c = sampleCase({
      query: "JWT 認証方式は？",
      expected_keywords: ["JWT"],
    });
    expect(hasLeakage(c)).toBe(true);
  });

  test("passes when query does not leak answer", () => {
    const c = sampleCase({
      query: "認証方式は？",
      expected_keywords: ["JWT"],
    });
    expect(hasLeakage(c)).toBe(false);
  });

  test("filterCandidates rejects leakage cases", () => {
    const good = sampleCase({ case_id: "good-001" });
    const bad = sampleCase({
      case_id: "bad-001",
      query: "JWT について",
      expected_keywords: ["JWT"],
    });
    const { passed, stats } = filterCandidates([good, bad]);
    expect(passed.length).toBe(1);
    expect(stats.rejected_leakage + stats.rejected_shortcut).toBeGreaterThanOrEqual(1);
  });
});
