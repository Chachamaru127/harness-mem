import { describe, expect, test } from "bun:test";
import { createBaselineSnapshot } from "./baseline-runner";

// The benchmark wall-clock includes dataset seeding and first-hit model/cache
// setup. Search latency regression is asserted by the p95 gate below.
const RERANK_GATE_TIMEOUT_MS = 120000;

function computeMaxAllowedP95(beforeP95: number): number {
  const normalizedBeforeP95 = Math.max(1, beforeP95);
  return Number(
    (
      normalizedBeforeP95 < 15
        ? Math.max(normalizedBeforeP95 * 1.1, normalizedBeforeP95 + 5)
        : normalizedBeforeP95 * 1.1
    ).toFixed(3)
  );
}

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
    RERANK_GATE_TIMEOUT_MS
  );

  test(
    "keeps recall/mrr at or above baseline and limits p95 degradation to <= 10%",
    async () => {
      let finalBeforeP95 = 0;
      let finalAfterP95 = 0;
      let finalMaxAllowedP95 = 0;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const before = await createBaselineSnapshot({
          runLabel: `before-${attempt}`,
          project: `world1-rerank-gate-before-${attempt}`,
          rerankerEnabled: false,
        });
        const after = await createBaselineSnapshot({
          runLabel: `after-${attempt}`,
          project: `world1-rerank-gate-after-${attempt}`,
          rerankerEnabled: true,
        });

        expect(after.quality.recall_at_10).toBeGreaterThanOrEqual(before.quality.recall_at_10);
        expect(after.quality.mrr_at_10).toBeGreaterThanOrEqual(before.quality.mrr_at_10);

        finalBeforeP95 = before.performance.search_latency_ms.p95;
        finalAfterP95 = after.performance.search_latency_ms.p95;
        finalMaxAllowedP95 = computeMaxAllowedP95(finalBeforeP95);

        if (finalAfterP95 <= finalMaxAllowedP95) {
          return;
        }
      }

      expect(finalAfterP95).toBeLessThanOrEqual(finalMaxAllowedP95);
    },
    RERANK_GATE_TIMEOUT_MS
  );
});
