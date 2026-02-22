import { describe, expect, test } from "bun:test";
import { evaluateLocomoQa } from "./locomo-evaluator";

describe("LOCOMO evaluator", () => {
  test("computes EM/F1 overall and by category", () => {
    const result = evaluateLocomoQa([
      { prediction: "Seattle", answer: "Seattle", category: "profile" },
      { prediction: "in 2024", answer: "2024", category: "timeline" },
      { prediction: "", answer: "Alice", category: "profile" },
    ]);

    expect(result.overall.count).toBe(3);
    expect(result.overall.em).toBeCloseTo(1 / 3, 5);
    expect(result.overall.f1).toBeCloseTo((1 + 2 / 3 + 0) / 3, 5);
    expect(result.by_category.profile?.count).toBe(2);
    expect(result.by_category.profile?.em).toBeCloseTo(0.5, 5);
    expect(result.by_category.timeline?.f1).toBeCloseTo(2 / 3, 5);
  });

  test("skips records with empty gold answers", () => {
    const result = evaluateLocomoQa([
      { prediction: "anything", answer: "", category: "cat-5" },
      { prediction: "Seattle", answer: "Seattle", category: "cat-1" },
    ]);

    expect(result.overall.count).toBe(1);
    expect(result.overall.em).toBe(1);
    expect(result.by_category["cat-5"]).toBeUndefined();
    expect(result.by_category["cat-1"]?.count).toBe(1);
  });
});
