import { describe, expect, test } from "bun:test";
import {
  computeCompositeEmbeddingScore,
  computeJapaneseEnsembleWeight,
  loadAdaptiveThresholdDefaults,
  loadCompositeScoreWeights,
  loadEnsembleWeightConfig,
  resetAdaptiveConfigCacheForTests,
  type CompositeScoreWeights,
} from "../../src/embedding/adaptive-config";

describe("adaptive config", () => {
  test("adaptive threshold defaults are loaded from data file", () => {
    const defaults = loadAdaptiveThresholdDefaults();
    expect(defaults.jaThreshold).toBe(0.85);
    expect(defaults.codeThreshold).toBe(0.5);
    expect(defaults.source).toContain("section-70");
  });

  test("ensemble weights are loaded from data file", () => {
    const weights = loadEnsembleWeightConfig();
    expect(weights.minJapaneseWeight).toBe(0.3);
    expect(weights.maxJapaneseWeight).toBe(0.9);
    expect(weights.defaultJapaneseWeight).toBe(0.5);
  });

  test("computeJapaneseEnsembleWeight clamps by configured min/max", () => {
    const weights = loadEnsembleWeightConfig();
    expect(computeJapaneseEnsembleWeight(0.1, weights)).toBe(0.3);
    expect(computeJapaneseEnsembleWeight(0.95, weights)).toBe(0.9);
    expect(computeJapaneseEnsembleWeight(undefined, weights)).toBe(0.5);
  });
});

describe("S154-400 composite embedding-switch weights", () => {
  test("composite weights load from data file with the documented defaults", () => {
    resetAdaptiveConfigCacheForTests();
    const w = loadCompositeScoreWeights();
    expect(w.mixedWeight).toBe(0.25);
    expect(w.jaWeight).toBe(0.25);
    expect(w.bilingualWeight).toBe(0.25);
    expect(w.devWorkflowWeight).toBe(0.25);
    expect(w.switchDeltaThreshold).toBe(0.05);
    expect(w.source).toBe("s154-400-initial");
  });

  test("computeCompositeEmbeddingScore is the normalized weighted average", () => {
    const w: CompositeScoreWeights = {
      mixedWeight: 0.25,
      jaWeight: 0.25,
      bilingualWeight: 0.25,
      devWorkflowWeight: 0.25,
      switchDeltaThreshold: 0.05,
    };
    const score = computeCompositeEmbeddingScore(
      { mixed: 0.6, ja: 0.7, bilingual: 0.8, devWorkflow: 0.9 },
      w,
    );
    expect(score).toBeCloseTo(0.75, 10); // (0.6+0.7+0.8+0.9)/4
  });

  test("metric inputs are clamped to [0,1]", () => {
    const w: CompositeScoreWeights = {
      mixedWeight: 1,
      jaWeight: 0,
      bilingualWeight: 0,
      devWorkflowWeight: 0,
      switchDeltaThreshold: 0.05,
    };
    expect(computeCompositeEmbeddingScore({ mixed: 1.5, ja: 0, bilingual: 0, devWorkflow: 0 }, w)).toBe(1);
    expect(computeCompositeEmbeddingScore({ mixed: -0.5, ja: 0, bilingual: 0, devWorkflow: 0 }, w)).toBe(0);
  });

  test("a non-finite metric surfaces as NaN instead of a silent substitution", () => {
    const w: CompositeScoreWeights = {
      mixedWeight: 0.25,
      jaWeight: 0.25,
      bilingualWeight: 0.25,
      devWorkflowWeight: 0.25,
      switchDeltaThreshold: 0.05,
    };
    const score = computeCompositeEmbeddingScore(
      { mixed: 0.6, ja: Number.NaN, bilingual: 0.8, devWorkflow: 0.9 },
      w,
    );
    expect(Number.isNaN(score)).toBe(true);
  });

  test("zero total weight returns the neutral midpoint", () => {
    const w: CompositeScoreWeights = {
      mixedWeight: 0,
      jaWeight: 0,
      bilingualWeight: 0,
      devWorkflowWeight: 0,
      switchDeltaThreshold: 0.05,
    };
    expect(computeCompositeEmbeddingScore({ mixed: 0.6, ja: 0.7, bilingual: 0.8, devWorkflow: 0.9 }, w)).toBe(0.5);
  });

  test("switchDeltaThreshold expresses the minimum composite gain to flip", () => {
    const w = loadCompositeScoreWeights();
    const baseline = computeCompositeEmbeddingScore(
      { mixed: 0.5, ja: 0.5, bilingual: 0.5, devWorkflow: 0.5 },
      w,
    );
    const candidate = computeCompositeEmbeddingScore(
      { mixed: 0.56, ja: 0.56, bilingual: 0.56, devWorkflow: 0.56 },
      w,
    );
    expect(candidate - baseline).toBeGreaterThanOrEqual(w.switchDeltaThreshold);
  });
});
