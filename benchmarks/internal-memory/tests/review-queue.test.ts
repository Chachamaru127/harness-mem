import { describe, expect, test } from "bun:test";
import { buildReviewQueue } from "../lib/real-data/review-queue";
import type { CandidateCase } from "../lib/real-data/types";

function caseRow(comp: CandidateCase["competency"], id: string): CandidateCase {
  return {
    case_id: id,
    layer: "ja_coding",
    category: "real_ar",
    competency: comp,
    language_profile: "ja",
    project: "bench",
    memories: [{ id: "m1", content: "test content here" }],
    query: `query for ${id}`,
    relevant_ids: ["m1"],
    source_round_ids: ["r1"],
    filter_passed: true,
  };
}

describe("review queue", () => {
  test("includes all CR and TTL cases", () => {
    const candidates = [
      caseRow("CR", "cr-001"),
      caseRow("CR", "cr-002"),
      caseRow("TTL", "ttl-001"),
      caseRow("AR", "ar-001"),
      caseRow("LRU", "lru-001"),
    ];
    const { entries, stats } = buildReviewQueue(candidates, 0.25);
    const ids = entries.map((e) => e.case_id);
    expect(ids).toContain("cr-001");
    expect(ids).toContain("cr-002");
    expect(ids).toContain("ttl-001");
    expect(stats.cr_ttl_full).toBe(3);
  });

  test("spot-checks subset of AR/LRU", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => caseRow("AR", `ar-${i}`));
    const { entries, stats } = buildReviewQueue(candidates, 0.3);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(candidates.length);
    expect(stats.ar_lru_spot).toBe(entries.length);
  });
});
