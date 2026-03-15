/**
 * §54 S54-003: QA品質検証スクリプトのテスト
 *
 * qa-quality-check.ts の各チェック関数と runQualityCheck の動作を検証する。
 */

import { describe, expect, test } from "bun:test";
import {
  checkCrossLingual,
  checkDuplicates,
  checkExpectedOrders,
  checkQueryLength,
  checkSliceDistribution,
  runQualityCheck,
} from "../../src/benchmark/qa-quality-check";
import type { SelfEvalCase } from "../../src/benchmark/self-eval-generator";

// ---------------------------------------------------------------------------
// テスト用ファクトリ
// ---------------------------------------------------------------------------

function makeEntry(id: string, sessionId = "sess-1") {
  return { id, content: `content for ${id}`, created_at: "2026-01-01T00:00:00Z", session_id: sessionId };
}

function makeCase(
  overrides: Partial<SelfEvalCase> & { id: string }
): SelfEvalCase {
  const entries = overrides.entries ?? [
    makeEntry("e1", overrides.session_id ?? "sess-1"),
    makeEntry("e2", overrides.session_id ?? "sess-1"),
    makeEntry("e3", overrides.session_id ?? "sess-1"),
  ];
  return {
    session_id: "sess-1",
    query: "What was the first task?",
    query_template: "first-task",
    slice: "temporal-order",
    entries,
    expected_order: entries.map((e) => e.id),
    generated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkDuplicates
// ---------------------------------------------------------------------------

describe("checkDuplicates", () => {
  test("重複なしの場合はすべて0", () => {
    const cases = [
      makeCase({ id: "c1", session_id: "sess-1", query_template: "first-task", query: "What was the very first thing I worked on?" }),
      makeCase({ id: "c2", session_id: "sess-2", query_template: "latest-task", query: "このセッションで最後に完了したタスクは何ですか？" }),
      makeCase({ id: "c3", session_id: "sess-3", query_template: "sequence", query: "Describe the complete sequence of activities in chronological order." }),
    ];
    const result = checkDuplicates(cases);
    expect(result.exact_query_dupes).toBe(0);
    expect(result.session_slice_dupes).toBe(0);
    expect(result.similar_query_pairs).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  test("同一クエリ文字列の重複を検出する", () => {
    const cases = [
      makeCase({ id: "c1", query: "Duplicate query" }),
      makeCase({ id: "c2", query: "Duplicate query" }),
      makeCase({ id: "c3", query: "Different query" }),
    ];
    const result = checkDuplicates(cases);
    expect(result.exact_query_dupes).toBe(1);
    expect(result.details.some((d) => d.reason === "exact_query_duplicate")).toBe(true);
  });

  test("同一 session_id + slice の重複を検出する", () => {
    const cases = [
      makeCase({ id: "c1", session_id: "sess-A", query_template: "first-task", query: "Query 1" }),
      makeCase({ id: "c2", session_id: "sess-A", query_template: "first-task", query: "Query 2" }),
      makeCase({ id: "c3", session_id: "sess-B", query_template: "first-task", query: "Query 3" }),
    ];
    const result = checkDuplicates(cases);
    expect(result.session_slice_dupes).toBe(1);
    expect(result.details.some((d) => d.reason === "session_slice_duplicate")).toBe(true);
  });

  test("Levenshtein距離が近いクエリペアを検出する", () => {
    const cases = [
      makeCase({ id: "c1", query: "What was the first task?" }),
      makeCase({ id: "c2", query: "What was the first work?" }),  // 距離4
    ];
    const result = checkDuplicates(cases);
    expect(result.similar_query_pairs).toBeGreaterThan(0);
    expect(result.details.some((d) => d.reason.startsWith("similar_query_levenshtein_"))).toBe(true);
  });

  test("prefix が一致するクエリペアを検出する", () => {
    const prefix = "What happened in this session regarding the specific";
    const cases = [
      makeCase({ id: "c1", query: `${prefix} topic A and more details here` }),
      makeCase({ id: "c2", query: `${prefix} topic B and other details here` }),
    ];
    const result = checkDuplicates(cases);
    expect(result.similar_query_pairs).toBeGreaterThan(0);
    expect(result.details.some((d) => d.reason === "similar_query_prefix")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkSliceDistribution
// ---------------------------------------------------------------------------

describe("checkSliceDistribution", () => {
  test("均等分布の場合は警告なし・比率1.0", () => {
    const cases = [
      makeCase({ id: "c1", slice: "slice-a", query: "Q1 first task info" }),
      makeCase({ id: "c2", slice: "slice-b", query: "Q2 latest activity" }),
      makeCase({ id: "c3", slice: "slice-c", query: "Q3 after anchor event" }),
      makeCase({ id: "c4", slice: "slice-d", query: "Q4 sequence order" }),
    ];
    const result = checkSliceDistribution(cases);
    expect(result.max_min_ratio).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  test("スライス偏り（比率 > 5）が検出される", () => {
    const cases = [
      ...Array.from({ length: 10 }, (_, i) => makeCase({ id: `c${i}`, slice: "heavy-slice", query: `Q${i} unique content here` })),
      makeCase({ id: "c10", slice: "light-slice", query: "Only one unique query" }),
    ];
    const result = checkSliceDistribution(cases);
    expect(result.max_min_ratio).toBeGreaterThan(5);
    expect(result.warnings.some((w) => w.includes("skewed"))).toBe(true);
  });

  test("by_slice のカウントが正確", () => {
    const cases = [
      makeCase({ id: "c1", slice: "first-task", query: "Q1 unique content" }),
      makeCase({ id: "c2", slice: "first-task", query: "Q2 unique content" }),
      makeCase({ id: "c3", slice: "latest-task", query: "Q3 unique content" }),
    ];
    const result = checkSliceDistribution(cases);
    expect(result.by_slice["first-task"]).toBe(2);
    expect(result.by_slice["latest-task"]).toBe(1);
  });

  test("ケースが0件の場合はエラーにならない", () => {
    const result = checkSliceDistribution([]);
    expect(result.max_min_ratio).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkExpectedOrders
// ---------------------------------------------------------------------------

describe("checkExpectedOrders", () => {
  test("正常ケースではすべて0", () => {
    const entries1 = [makeEntry("e1"), makeEntry("e2"), makeEntry("e3")];
    const entries2 = [makeEntry("e4"), makeEntry("e5"), makeEntry("e6")];
    const cases = [
      makeCase({ id: "c1", entries: entries1, expected_order: ["e1", "e2", "e3"] }),
      makeCase({ id: "c2", entries: entries2, expected_order: ["e6", "e5", "e4"], query: "Different query" }),
    ];
    const result = checkExpectedOrders(cases);
    expect(result.empty_order_count).toBe(0);
    expect(result.invalid_id_count).toBe(0);
    // 2件で異なる expected_order の場合は uniform=0
    expect(result.uniform_order_count).toBe(0);
  });

  test("空の expected_order が検出される", () => {
    const cases = [
      makeCase({ id: "c1", expected_order: [] }),
      makeCase({ id: "c2" }),
    ];
    const result = checkExpectedOrders(cases);
    expect(result.empty_order_count).toBe(1);
    expect(result.details.some((d) => d.issue === "empty_expected_order")).toBe(true);
  });

  test("entries に存在しない ID が検出される", () => {
    const entries = [makeEntry("e1"), makeEntry("e2")];
    const cases = [
      makeCase({ id: "c1", entries, expected_order: ["e1", "e2", "e999"] }),
    ];
    const result = checkExpectedOrders(cases);
    expect(result.invalid_id_count).toBe(1);
    expect(result.details.some((d) => d.issue.includes("e999"))).toBe(true);
  });

  test("全ケースで同一 expected_order の場合に警告される", () => {
    const entries = [makeEntry("e1"), makeEntry("e2"), makeEntry("e3")];
    const sameOrder = ["e1", "e2", "e3"];
    const cases = [
      makeCase({ id: "c1", entries, expected_order: [...sameOrder], query: "Query 1" }),
      makeCase({ id: "c2", entries, expected_order: [...sameOrder], query: "Query 2" }),
      makeCase({ id: "c3", entries, expected_order: [...sameOrder], query: "Query 3" }),
    ];
    const result = checkExpectedOrders(cases);
    expect(result.uniform_order_count).toBe(3);
    expect(result.details.some((d) => d.issue === "all_cases_have_identical_expected_order")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkCrossLingual
// ---------------------------------------------------------------------------

describe("checkCrossLingual", () => {
  test("日英バランスが取れている場合は balanced=true", () => {
    const cases = [
      makeCase({ id: "c1", query: "What was the first task?" }),
      makeCase({ id: "c2", query: "What was the latest activity?" }),
      makeCase({ id: "c3", query: "このセッションで最初のタスクは？" }),
      makeCase({ id: "c4", query: "最後に何をしましたか？" }),
    ];
    const result = checkCrossLingual(cases);
    expect(result.ja_count).toBe(2);
    expect(result.en_count).toBe(2);
    expect(result.ja_ratio).toBe(0.5);
    expect(result.balanced).toBe(true);
  });

  test("日本語のみの場合は balanced=false", () => {
    const cases = [
      makeCase({ id: "c1", query: "このセッションで最初のタスクは？" }),
      makeCase({ id: "c2", query: "最後に何をしましたか？" }),
      makeCase({ id: "c3", query: "作業順序を教えてください。" }),
    ];
    const result = checkCrossLingual(cases);
    expect(result.ja_count).toBe(3);
    expect(result.en_count).toBe(0);
    expect(result.balanced).toBe(false);
  });

  test("英語のみの場合は balanced=false", () => {
    const cases = [
      makeCase({ id: "c1", query: "What was the first task?" }),
      makeCase({ id: "c2", query: "List tasks in order." }),
      makeCase({ id: "c3", query: "What happened after the setup?" }),
    ];
    const result = checkCrossLingual(cases);
    expect(result.ja_ratio).toBe(0);
    expect(result.balanced).toBe(false);
  });

  test("ケースが0件の場合は balanced=true（空はバランスとみなす）", () => {
    const result = checkCrossLingual([]);
    expect(result.balanced).toBe(true);
    expect(result.ja_ratio).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkQueryLength
// ---------------------------------------------------------------------------

describe("checkQueryLength", () => {
  test("正常な長さのクエリでは too_short と too_long が 0", () => {
    const cases = [
      makeCase({ id: "c1", query: "What was the first task in this session?" }),
      makeCase({ id: "c2", query: "このセッションで最初のタスクは何でしたか？" }),
    ];
    const result = checkQueryLength(cases);
    expect(result.too_short).toBe(0);
    expect(result.too_long).toBe(0);
  });

  test("10文字未満のクエリを検出する", () => {
    const cases = [
      makeCase({ id: "c1", query: "Short?" }),    // 6文字
      makeCase({ id: "c2", query: "What was the first task?" }),
    ];
    const result = checkQueryLength(cases);
    expect(result.too_short).toBe(1);
    expect(result.details.some((d) => d.issue === "query_too_short")).toBe(true);
  });

  test("500文字超のクエリを検出する", () => {
    const longQuery = "A".repeat(501);
    const cases = [
      makeCase({ id: "c1", query: longQuery }),
      makeCase({ id: "c2", query: "Normal length query." }),
    ];
    const result = checkQueryLength(cases);
    expect(result.too_long).toBe(1);
    expect(result.details.some((d) => d.issue === "query_too_long")).toBe(true);
  });

  test("avg_length が正確に計算される", () => {
    const cases = [
      makeCase({ id: "c1", query: "A".repeat(20) }),
      makeCase({ id: "c2", query: "B".repeat(40) }),
    ];
    const result = checkQueryLength(cases);
    expect(result.avg_length).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// runQualityCheck（統合テスト）
// ---------------------------------------------------------------------------

describe("runQualityCheck", () => {
  test("正常ケース（重複なし・バランスされたスライス）で passed=true", () => {
    const entries1 = [makeEntry("e1", "sess-1"), makeEntry("e2", "sess-1"), makeEntry("e3", "sess-1")];
    const entries2 = [makeEntry("e4", "sess-2"), makeEntry("e5", "sess-2"), makeEntry("e6", "sess-2")];

    const cases: SelfEvalCase[] = [
      {
        id: "c1",
        session_id: "sess-1",
        query: "What was the first task?",
        query_template: "first-task",
        slice: "temporal-order",
        entries: entries1,
        expected_order: ["e1", "e2", "e3"],
        generated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "c2",
        session_id: "sess-1",
        query: "What tools were used in this session?",
        query_template: "tool-recall-en",
        slice: "tool-recall",
        entries: entries1,
        expected_order: ["e3", "e2", "e1"],
        generated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "c3",
        session_id: "sess-2",
        query: "このセッションで何を達成しましたか？",
        query_template: "session-summary-ja",
        slice: "session-summary",
        entries: entries2,
        expected_order: ["e4", "e5", "e6"],
        generated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "c4",
        session_id: "sess-2",
        query: "「設定変更」に関する判断の理由は何ですか？",
        query_template: "decision-why-ja",
        slice: "decision-why",
        entries: entries2,
        expected_order: ["e6", "e5", "e4"],
        generated_at: "2026-01-01T00:00:00Z",
      },
    ];

    const report = runQualityCheck(cases);
    expect(report.passed).toBe(true);
    expect(report.failure_reasons).toHaveLength(0);
    expect(report.schema_version).toBe("qa-quality-check-v1");
    expect(report.total_cases).toBe(4);
  });

  test("重複ケースが検出されると passed=false", () => {
    const cases: SelfEvalCase[] = [
      makeCase({ id: "c1", session_id: "sess-1", query: "Duplicate query here" }),
      makeCase({ id: "c2", session_id: "sess-2", query: "Duplicate query here" }),
    ];
    const report = runQualityCheck(cases);
    expect(report.passed).toBe(false);
    expect(report.failure_reasons.some((r) => r.includes("exact query duplicate"))).toBe(true);
  });

  test("スライス偏りが検出されると passed=false", () => {
    const cases = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeCase({ id: `c${i}`, session_id: `sess-${i}`, slice: "temporal-order", query: `Query number ${i} unique text` })
      ),
      makeCase({ id: "c10", session_id: "sess-10", slice: "tool-recall", query: "Only one tool recall query" }),
    ];
    const report = runQualityCheck(cases);
    expect(report.passed).toBe(false);
    expect(report.failure_reasons.some((r) => r.includes("Slice distribution skew"))).toBe(true);
  });

  test("空 expected_order が検出されると passed=false", () => {
    const cases = [
      makeCase({ id: "c1", expected_order: [] }),
    ];
    const report = runQualityCheck(cases);
    expect(report.passed).toBe(false);
    expect(report.failure_reasons.some((r) => r.includes("empty expected_order"))).toBe(true);
  });

  test("日英バランス不均衡が検出されると passed=false", () => {
    const cases = Array.from({ length: 5 }, (_, i) =>
      makeCase({ id: `c${i}`, query: `What was task ${i} in this session?` })
    );
    const report = runQualityCheck(cases);
    expect(report.passed).toBe(false);
    expect(report.failure_reasons.some((r) => r.includes("Cross-lingual balance"))).toBe(true);
  });

  test("レポートに generated_at と schema_version が含まれる", () => {
    const report = runQualityCheck([]);
    expect(report.schema_version).toBe("qa-quality-check-v1");
    expect(typeof report.generated_at).toBe("string");
    expect(report.total_cases).toBe(0);
  });
});
