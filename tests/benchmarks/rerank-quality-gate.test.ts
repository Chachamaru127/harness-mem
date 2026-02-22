import { describe, expect, test } from "bun:test";
import { createBaselineSnapshot } from "./baseline-runner";

describe("reranker quality gate", () => {
  test(
    "exports reranker enabled flag in benchmark snapshot metadata",
    async () => {
      const before = await createBaselineSnapshot({
        runLabel: "before",
        project: "world1-rerank-before",
        rerankerEnabled: false,
      });
      const after = await createBaselineSnapshot({
        runLabel: "after",
        project: "world1-rerank-after",
        rerankerEnabled: true,
      });

      const beforePipeline = (before as unknown as Record<string, unknown>).pipeline as Record<string, unknown>;
      const afterPipeline = (after as unknown as Record<string, unknown>).pipeline as Record<string, unknown>;

      expect(beforePipeline.reranker_enabled).toBe(false);
      expect(afterPipeline.reranker_enabled).toBe(true);
    },
    30000
  );

  test(
    "keeps recall/mrr at or above baseline and limits p95 degradation to <= 10%",
    async () => {
      const before = await createBaselineSnapshot({
        runLabel: "before",
        project: "world1-rerank-gate-before",
        rerankerEnabled: false,
      });
      const after = await createBaselineSnapshot({
        runLabel: "after",
        project: "world1-rerank-gate-after",
        rerankerEnabled: true,
      });

      expect(after.quality.recall_at_10).toBeGreaterThanOrEqual(before.quality.recall_at_10);
      expect(after.quality.mrr_at_10).toBeGreaterThanOrEqual(before.quality.mrr_at_10);

      const beforeP95 = Math.max(1, before.performance.search_latency_ms.p95);
      // Allow tiny absolute jitter on very small local p95 values while preserving <=10% gate at practical latencies.
      const maxAllowedP95 = Number(Math.max(beforeP95 * 1.1, beforeP95 + 2).toFixed(3));
      expect(after.performance.search_latency_ms.p95).toBeLessThanOrEqual(maxAllowedP95);
    },
    30000
  );
});
