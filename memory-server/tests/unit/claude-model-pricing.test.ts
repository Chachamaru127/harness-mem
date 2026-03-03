import { describe, expect, test } from "bun:test";
import { calculateCost, getModelPricing, listKnownModels } from "../../src/utils/claude-model-pricing";

describe("claude-model-pricing", () => {
  test("returns correct pricing for known models", () => {
    const opusPricing = getModelPricing("claude-opus-4-6");
    expect(opusPricing.inputPer1M).toBe(15);
    expect(opusPricing.outputPer1M).toBe(75);

    const sonnetPricing = getModelPricing("claude-sonnet-4-6");
    expect(sonnetPricing.inputPer1M).toBe(3);
    expect(sonnetPricing.outputPer1M).toBe(15);

    const haikuPricing = getModelPricing("claude-haiku-4-5-20251001");
    expect(haikuPricing.inputPer1M).toBe(0.80);
    expect(haikuPricing.outputPer1M).toBe(4);
  });

  test("falls back to pattern-based pricing for unknown models", () => {
    const opusFallback = getModelPricing("claude-opus-99");
    expect(opusFallback.inputPer1M).toBe(15);

    const haikuFallback = getModelPricing("claude-haiku-99");
    expect(haikuFallback.inputPer1M).toBe(0.80);

    // Unknown model defaults to Sonnet pricing
    const unknownFallback = getModelPricing("unknown-model-v1");
    expect(unknownFallback.inputPer1M).toBe(3);
    expect(unknownFallback.outputPer1M).toBe(15);
  });

  test("calculateCost computes correct values", () => {
    const cost = calculateCost({
      model: "claude-opus-4-6",
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cache_creation_input_tokens: 100_000,
      cache_read_input_tokens: 50_000,
    });

    expect(cost.input_cost).toBeCloseTo(15, 2);  // 1M * $15/1M
    expect(cost.output_cost).toBeCloseTo(37.5, 2);  // 500K * $75/1M
    expect(cost.cache_write_cost).toBeCloseTo(1.875, 3);  // 100K * $18.75/1M
    expect(cost.cache_read_cost).toBeCloseTo(0.075, 3);  // 50K * $1.5/1M
    expect(cost.total_cost).toBeCloseTo(54.45, 2);
    expect(cost.model).toBe("claude-opus-4-6");
    expect(cost.currency).toBe("USD");
  });

  test("calculateCost handles zero cache tokens", () => {
    const cost = calculateCost({
      model: "claude-sonnet-4-6",
      input_tokens: 100,
      output_tokens: 50,
    });

    expect(cost.input_cost).toBeCloseTo(0.0003, 4);
    expect(cost.output_cost).toBeCloseTo(0.00075, 5);
    expect(cost.cache_write_cost).toBe(0);
    expect(cost.cache_read_cost).toBe(0);
    expect(cost.total_cost).toBeCloseTo(0.00105, 5);
  });

  test("listKnownModels returns non-empty list", () => {
    const models = listKnownModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("claude-opus-4-6");
    expect(models).toContain("claude-sonnet-4-6");
    expect(models).toContain("claude-haiku-4-5-20251001");
  });
});
