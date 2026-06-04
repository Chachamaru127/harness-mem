import { describe, expect, test } from "bun:test";
import { HarnessMemAdapter } from "../adapters/harness-mem";
import type { AdapterRunContext, BenchmarkCase } from "../lib/types";

function realTtlCase(relevantIds: string[]): BenchmarkCase {
  return {
    case_id: "real-ttl-gold-leakage",
    layer: "ja_coding",
    category: "real_ttl",
    competency: "TTL",
    language_profile: "ja",
    project: "gold-leakage",
    memories: [
      {
        id: "gold-leakage-target",
        content: "large db search timeout sentinel should be found by retrieval",
        timestamp: "2026-06-02T00:00:00.000Z",
      },
      {
        id: "gold-leakage-distractor",
        content: "unrelated benchmark fixture content",
        timestamp: "2026-06-02T00:01:00.000Z",
      },
    ],
    query: "large db search timeout sentinel",
    relevant_ids: relevantIds,
  };
}

describe("HarnessMemAdapter", () => {
  test("real TTL retrieval does not use relevant_ids to order hits", async () => {
    const context: AdapterRunContext = {
      run_id: "gold-leakage-test",
      competitor_id: "harness-mem",
      project_prefix: "adapter-test",
    };

    const first = new HarnessMemAdapter();
    const second = new HarnessMemAdapter();
    try {
      const baseline = realTtlCase(["gold-leakage-target"]);
      const swappedGold = realTtlCase(["gold-leakage-distractor"]);
      await first.prepareCase(baseline, context);
      await second.prepareCase(swappedGold, context);

      const baselineHits = (await first.query(baseline, context)).hits.map((hit) => hit.id);
      const swappedHits = (await second.query(swappedGold, context)).hits.map((hit) => hit.id);

      expect(baselineHits[0]).toBe("obs_gold-leakage-target");
      expect(swappedHits[0]).toBe("obs_gold-leakage-target");
      expect(swappedHits).toEqual(baselineHits);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});
