import { describe, test, expect } from "bun:test";
import {
  reviewSingleQA,
  reviewBatch,
  extractVerified,
  type GeneratedQA,
} from "../../src/benchmark/qa-review-tool";

function makeQA(overrides: Partial<GeneratedQA> = {}): GeneratedQA {
  return {
    question_id: "test-001",
    question: "What tools were used in this session?",
    answer: "TypeScript compiler and ESLint were used",
    slice: "tool-recall",
    cross_lingual: false,
    source_observation_ids: ["obs-1", "obs-2"],
    session_id: "sess-1",
    platform: "claude",
    project: "test-project",
    generated_at: "2026-01-01T00:00:00Z",
    verified: false,
    ...overrides,
  };
}

describe("reviewSingleQA", () => {
  test("正常な QA は passed=true", () => {
    const result = reviewSingleQA(makeQA());
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.qa.verified).toBe(true);
  });

  test("空の answer は rejected", () => {
    const result = reviewSingleQA(makeQA({ answer: "" }));
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("empty_answer");
  });

  test("短すぎる answer は rejected", () => {
    const result = reviewSingleQA(makeQA({ answer: "Yes" }));
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("answer_too_short");
  });

  test("長すぎる answer は rejected", () => {
    const result = reviewSingleQA(makeQA({ answer: "A".repeat(301) }));
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("answer_too_long");
  });

  test("短すぎる question は rejected", () => {
    const result = reviewSingleQA(makeQA({ question: "What?" }));
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("question_too_short");
  });

  test("無効な slice は rejected", () => {
    const result = reviewSingleQA(makeQA({ slice: "invalid-slice" }));
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("invalid_slice"))).toBe(true);
  });

  test("空の source_observation_ids は rejected", () => {
    const result = reviewSingleQA(makeQA({ source_observation_ids: [] }));
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("empty_source_observations");
  });
});

describe("reviewBatch", () => {
  test("重複 question を検出する", () => {
    const qas = [
      makeQA({ question_id: "q1", question: "What tools were used?" }),
      makeQA({ question_id: "q2", question: "What tools were used?" }),
    ];
    const report = reviewBatch(qas);
    expect(report.total_rejected).toBeGreaterThanOrEqual(1);
    expect(report.issues_summary["duplicate_question"]).toBe(1);
  });

  test("by_slice 集計が正確", () => {
    const qas = [
      makeQA({ question_id: "q1", slice: "tool-recall" }),
      makeQA({
        question_id: "q2",
        slice: "tool-recall",
        question: "Different question here",
      }),
      makeQA({
        question_id: "q3",
        slice: "decision-why",
        question: "Why was this decided?",
      }),
    ];
    const report = reviewBatch(qas);
    expect(report.by_slice["tool-recall"].passed).toBe(2);
    expect(report.by_slice["decision-why"].passed).toBe(1);
  });

  test("schema_version が正しい", () => {
    const report = reviewBatch([]);
    expect(report.schema_version).toBe("qa-review-v1");
  });
});

describe("extractVerified", () => {
  test("passed=true の QA のみ抽出する", () => {
    const qas = [
      makeQA({ question_id: "q1" }),
      makeQA({ question_id: "q2", answer: "" }), // rejected
      makeQA({
        question_id: "q3",
        question: "Another valid question?",
      }),
    ];
    const report = reviewBatch(qas);
    const verified = extractVerified(report);
    expect(verified.length).toBe(2);
    expect(verified.every((q) => q.verified)).toBe(true);
  });
});
