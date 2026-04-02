import { describe, expect, test } from "bun:test";
import { buildThresholdGrid } from "../../src/benchmark/adaptive-tuning";

describe("adaptive tuning", () => {
  test("buildThresholdGrid creates a 0.05-step cartesian grid", () => {
    const grid = buildThresholdGrid({
      step: 0.05,
      jaMin: 0.8,
      jaMax: 0.9,
      codeMin: 0.45,
      codeMax: 0.5,
      save: false,
      outputPath: "/tmp/adaptive-thresholds.json",
    });

    expect(grid).toEqual([
      { jaThreshold: 0.8, codeThreshold: 0.45 },
      { jaThreshold: 0.8, codeThreshold: 0.5 },
      { jaThreshold: 0.85, codeThreshold: 0.45 },
      { jaThreshold: 0.85, codeThreshold: 0.5 },
      { jaThreshold: 0.9, codeThreshold: 0.45 },
      { jaThreshold: 0.9, codeThreshold: 0.5 },
    ]);
  });
});
