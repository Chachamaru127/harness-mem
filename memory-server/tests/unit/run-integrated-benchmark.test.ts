/**
 * §54 S54-009: 統合ベンチマーク runner ユニットテスト
 */

import { describe, test, expect } from "bun:test";
import {
  validateFixture,
  sliceStatsSummary,
  type UnifiedQA,
} from "../../src/benchmark/run-integrated-benchmark";

describe("validateFixture", () => {
  test("存在しないファイルでは gate.passed=false", () => {
    const report = validateFixture("/nonexistent/path.json");
    expect(report.gate.passed).toBe(false);
    expect(report.total_items).toBe(0);
    expect(report.gate.message).toContain("not found");
  });

  test("schema_version が正しい", () => {
    const report = validateFixture("/nonexistent/path.json");
    expect(report.schema_version).toBe("integrated-benchmark-v1");
  });
});

describe("sliceStatsSummary", () => {
  test("スライス別統計を正しく集計する", () => {
    const items: UnifiedQA[] = [
      {
        question_id: "q1",
        question: "What tools?",
        answer: "TypeScript",
        category: "cat-1",
        slice: "tool-recall",
        cross_lingual: false,
        source: "self-eval",
      },
      {
        question_id: "q2",
        question: "ツールは？",
        answer: "TypeScript",
        category: "cat-1",
        slice: "tool-recall",
        cross_lingual: true,
        source: "self-eval",
      },
      {
        question_id: "q3",
        question: "Why?",
        answer: "Performance",
        category: "cat-3",
        slice: "decision-why",
        cross_lingual: false,
        source: "self-eval",
      },
    ];
    const stats = sliceStatsSummary(items);
    expect(stats["tool-recall"].count).toBe(2);
    expect(stats["tool-recall"].ja_count).toBe(1);
    expect(stats["tool-recall"].en_count).toBe(1);
    expect(stats["tool-recall"].cross_lingual_count).toBe(1);
    expect(stats["decision-why"].count).toBe(1);
  });

  test("空配列でも動作する", () => {
    const stats = sliceStatsSummary([]);
    expect(Object.keys(stats)).toHaveLength(0);
  });
});
