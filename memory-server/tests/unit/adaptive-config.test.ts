import { describe, expect, test } from "bun:test";
import {
  computeJapaneseEnsembleWeight,
  loadAdaptiveThresholdDefaults,
  loadEnsembleWeightConfig,
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
