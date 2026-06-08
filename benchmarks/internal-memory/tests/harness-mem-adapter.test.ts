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

function sharedCorpusCase(caseId: string): BenchmarkCase {
  return {
    case_id: caseId,
    layer: "public_compatible",
    category: "memoryagentbench_accurate_retrieval",
    competency: "AR",
    language_profile: "en",
    project: "memoryagentbench-accurate_retrieval",
    memories: [
      { id: "mab-Accurate_Retrieval-1-m1", content: "shared corpus chunk one" },
      { id: "mab-Accurate_Retrieval-1-m2", content: "shared corpus chunk two" },
    ],
    source_split: "Accurate_Retrieval",
    query: caseId.endsWith("-1") ? "chunk one" : "chunk two",
    relevant_ids: caseId.endsWith("-1")
      ? ["mab-Accurate_Retrieval-1-m1"]
      : ["mab-Accurate_Retrieval-1-m2"],
  };
}

describe("HarnessMemAdapter", () => {
  test("shared MemoryAgentBench corpus uses one session and second case can retrieve", async () => {
    const context: AdapterRunContext = {
      run_id: "shared-corpus-dedupe",
      competitor_id: "harness-mem",
      project_prefix: "adapter-test",
    };
    const caseOne = sharedCorpusCase("mab-Accurate_Retrieval-1-1");
    const caseTwo = sharedCorpusCase("mab-Accurate_Retrieval-1-2");
    const adapter = new HarnessMemAdapter();
    try {
      expect(adapter.benchSessionIdForCase(caseOne)).toBe("bench-mab-Accurate_Retrieval-1");
      expect(adapter.benchSessionIdForCase(caseTwo)).toBe("bench-mab-Accurate_Retrieval-1");

      await adapter.prepareCase(caseOne, context);
      expect(adapter.seededMemoryKeyCount()).toBe(2);
      await adapter.prepareCase(caseTwo, context);
      expect(adapter.seededMemoryKeyCount()).toBe(2);
      await adapter.prepareCase(caseOne, context);
      expect(adapter.seededMemoryKeyCount()).toBe(2);

      const secondHits = (await adapter.query(caseTwo, context)).hits.map((hit) => hit.id);
      expect(secondHits.length).toBeGreaterThan(0);
      expect(secondHits).toContain("obs_mab-Accurate_Retrieval-1-m2");
    } finally {
      await adapter.dispose();
    }
  });

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
