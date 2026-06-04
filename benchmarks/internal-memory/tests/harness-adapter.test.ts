import { describe, expect, test } from "bun:test";
import { scoreCase } from "../lib/score-case";
import type { BenchmarkCase } from "../lib/types";

const embeddingEnabled = process.env.HARNESS_MEM_INTERNAL_BENCH_EMBEDDING === "1";

const sampleCase: BenchmarkCase = {
  case_id: "smoke-001",
  layer: "ja_coding",
  category: "ja_requirements",
  language_profile: "ja",
  project: "bench-smoke",
  memories: [
    {
      id: "smoke-001-m1",
      content: "内部ベンチでは Plans.md を正本にし、cc:WIP と cc:完了 を使う。",
    },
  ],
  query: "Plans.md のマーカー運用は？",
  relevant_ids: ["smoke-001-m1"],
  expected_keywords: ["cc:WIP", "cc:完了"],
};

describe("harness-mem internal-memory adapter", () => {
  test("scores harness observation ids", () => {
    const scored = scoreCase(sampleCase, "harness-mem", {
      status: "ok",
      hits: [
        {
          id: "obs_smoke-001-m1",
          rank: 1,
          content: sampleCase.memories[0].content,
        },
      ],
      latency_ms: 12,
    });
    expect(scored.recall_at_10).toBe(1);
    expect(scored.grounding_score).toBeGreaterThan(0);
  });

  (embeddingEnabled ? test : test.skip)(
    "smoke: ingests and retrieves Japanese coding memory",
    async () => {
      const { HarnessMemAdapter } = await import("../adapters/harness-mem");
      const adapter = new HarnessMemAdapter();
      const context = {
        run_id: "test-run",
        competitor_id: "harness-mem",
        project_prefix: "bench-test",
      };

      try {
        await adapter.prepareCase(sampleCase, context);
        const queryResult = await adapter.query(sampleCase, context);
        expect(queryResult.status).toBe("ok");
        expect(queryResult.hits.length).toBeGreaterThan(0);

        const scored = scoreCase(sampleCase, "harness-mem", queryResult);
        expect(scored.recall_at_10).toBeGreaterThan(0);
      } finally {
        await adapter.dispose();
      }
    },
    120_000,
  );
});
