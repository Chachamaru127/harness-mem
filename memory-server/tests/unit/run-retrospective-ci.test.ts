import { describe, test, expect } from "bun:test";
import { checkRegression, REGRESSION_THRESHOLD } from "../../src/benchmark/run-retrospective-ci";
import type { RetroReport } from "../../src/benchmark/retrospective-eval";

function makeReport(overrides: Partial<RetroReport> = {}): RetroReport {
  return {
    schema_version: "fd-017-retrospective-v1",
    generated_at: "2026-01-01T00:00:00Z",
    db_path: "/tmp/test.db",
    embedding_profile: {
      mode: "onnx",
      provider: "local",
      model: "multilingual-e5",
      vector_dimension: 384,
      onnx_gate: true,
      prime_enabled: true,
    },
    algo_v33: { recall_at_5: 0.5, recall_at_10: 0.6, n_queries: 50 },
    algo_v34: { recall_at_5: 0.6, recall_at_10: 0.7, n_queries: 50 },
    delta: { recall_at_5: 0.1, recall_at_10: 0.1 },
    queries_sampled: 50,
    per_query_results: [],
    ...overrides,
  };
}

describe("checkRegression", () => {
  test("前回結果なしの場合は PASS", () => {
    const result = checkRegression(makeReport(), null);
    expect(result.passed).toBe(true);
  });

  test("改善の場合は PASS", () => {
    const prev = makeReport({ algo_v34: { recall_at_5: 0.5, recall_at_10: 0.6, n_queries: 50 } });
    const curr = makeReport({ algo_v34: { recall_at_5: 0.6, recall_at_10: 0.7, n_queries: 50 } });
    const result = checkRegression(curr, prev);
    expect(result.passed).toBe(true);
  });

  test("5%以上の劣化は FAIL", () => {
    const prev = makeReport({ algo_v34: { recall_at_5: 0.7, recall_at_10: 0.8, n_queries: 50 } });
    const curr = makeReport({ algo_v34: { recall_at_5: 0.5, recall_at_10: 0.7, n_queries: 50 } });
    const result = checkRegression(curr, prev);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Regression");
  });

  test("5%未満の劣化は PASS", () => {
    const prev = makeReport({ algo_v34: { recall_at_5: 0.7, recall_at_10: 0.75, n_queries: 50 } });
    const curr = makeReport({ algo_v34: { recall_at_5: 0.65, recall_at_10: 0.72, n_queries: 50 } });
    const result = checkRegression(curr, prev);
    expect(result.passed).toBe(true);
  });

  test("前回 n_queries が 0 の場合は PASS（ベースラインなし扱い）", () => {
    const prev = makeReport({ algo_v34: { recall_at_5: 0.0, recall_at_10: 0.0, n_queries: 0 } });
    const curr = makeReport();
    const result = checkRegression(curr, prev);
    expect(result.passed).toBe(true);
  });

  test("劣化がちょうど REGRESSION_THRESHOLD の場合は FAIL（浮動小数点誤差込みで < が成立）", () => {
    // 0.75 - 0.80 は浮動小数点で -0.050000...044 となり -0.05 より小さいため FAIL
    const prev = makeReport({ algo_v34: { recall_at_5: 0.7, recall_at_10: 0.80, n_queries: 50 } });
    const curr = makeReport({ algo_v34: { recall_at_5: 0.65, recall_at_10: 0.75, n_queries: 50 } });
    const result = checkRegression(curr, prev);
    expect(result.passed).toBe(false);
  });

  test("劣化が REGRESSION_THRESHOLD を 1bp 超えた場合は FAIL", () => {
    const prev = makeReport({ algo_v34: { recall_at_5: 0.7, recall_at_10: 0.8, n_queries: 50 } });
    const curr = makeReport({
      algo_v34: { recall_at_5: 0.65, recall_at_10: 0.8 - REGRESSION_THRESHOLD - 0.001, n_queries: 50 },
    });
    const result = checkRegression(curr, prev);
    expect(result.passed).toBe(false);
  });

  test("PASS 時のメッセージに delta 情報が含まれる", () => {
    const prev = makeReport({ algo_v34: { recall_at_5: 0.5, recall_at_10: 0.6, n_queries: 50 } });
    const curr = makeReport({ algo_v34: { recall_at_5: 0.6, recall_at_10: 0.7, n_queries: 50 } });
    const result = checkRegression(curr, prev);
    expect(result.message).toContain("OK");
    expect(result.message).toContain("+");
  });
});
