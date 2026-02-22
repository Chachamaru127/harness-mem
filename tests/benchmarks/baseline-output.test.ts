import { describe, expect, test } from "bun:test";
import { createBaselineSnapshot } from "./baseline-runner";

function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return ["empty"];
    }
    const variants = [...new Set(value.map((entry) => JSON.stringify(shapeOf(entry))))].map((entry) =>
      JSON.parse(entry)
    );
    return variants.length === 1 ? [variants[0]] : variants;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, shapeOf(entryValue)] as const);
    return Object.fromEntries(entries);
  }
  return typeof value;
}

describe("world-1 baseline benchmark snapshot", () => {
  test("emits comparable JSON payload for quality/performance/token metrics", async () => {
    const snapshot = await createBaselineSnapshot({ runLabel: "before" });
    const schema = shapeOf(snapshot);

    expect(schema).toEqual({
      dataset: {
        observation_count: "number",
        project: "string",
        query_count: "number",
      },
      generated_at: "string",
      performance: {
        search_latency_ms: {
          max: "number",
          min: "number",
          p50: "number",
          p95: "number",
          samples: ["number"],
        },
      },
      quality: {
        mrr_at_10: "number",
        queries: [
          {
            expected_observation_id: "string",
            hit_rank: "number",
            query: "string",
            recall_at_10: "number",
            reciprocal_rank: "number",
            top_hit_id: "string",
          },
        ],
        recall_at_10: "number",
      },
      pipeline: {
        reranker_enabled: "boolean",
      },
      run_label: "string",
      schema_version: "string",
      token_efficiency: {
        progressive_estimated_tokens: "number",
        reduction_ratio: "number",
        single_shot_estimated_tokens: "number",
      },
    });

    expect(snapshot.dataset.observation_count).toBeGreaterThan(0);
    expect(snapshot.dataset.query_count).toBeGreaterThan(0);
    expect(snapshot.quality.queries.length).toBeGreaterThan(0);
    expect(snapshot.run_label).toBe("before");
    expect(snapshot.schema_version).toBe("world1-baseline-v1");
    expect(snapshot.pipeline.reranker_enabled).toBe(false);
    expect(snapshot.quality.recall_at_10).toBeGreaterThanOrEqual(0.8);
    expect(snapshot.quality.mrr_at_10).toBeGreaterThanOrEqual(0.65);
    expect(snapshot.performance.search_latency_ms.p95).toBeGreaterThanOrEqual(
      snapshot.performance.search_latency_ms.p50
    );
    expect(snapshot.performance.search_latency_ms.p95).toBeLessThan(300);
    expect(snapshot.token_efficiency.single_shot_estimated_tokens).toBeGreaterThanOrEqual(
      snapshot.token_efficiency.progressive_estimated_tokens
    );
    expect(snapshot.token_efficiency.reduction_ratio).toBeGreaterThan(0);
    expect(snapshot.token_efficiency.reduction_ratio).toBeLessThanOrEqual(1);
  });
});
