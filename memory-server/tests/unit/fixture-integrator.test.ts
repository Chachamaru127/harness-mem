import { describe, test, expect } from "bun:test";
import { convertLocomoQA, convertSelfEvalQA, integrateFixtures } from "../../src/benchmark/fixture-integrator";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

describe("convertLocomoQA", () => {
  test("LoCoMo sample を UnifiedQA に変換する", () => {
    const sample = {
      sample_id: "ja-rel-001",
      conversation: [{ speaker: "user", text: "test" }],
      qa: [{
        question_id: "current-001",
        question: "今のCIは？",
        answer: "GitHub Actions",
        category: "cat-1",
        slice: "current",
        cross_lingual: true,
      }],
    };
    const result = convertLocomoQA(sample);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("release-pack-96");
    expect(result[0].cross_lingual).toBe(true);
  });

  test("cross_lingual が未指定の場合は false になる", () => {
    const sample = {
      sample_id: "ja-rel-002",
      conversation: [],
      qa: [{
        question_id: "q-001",
        question: "テスト",
        answer: "回答",
        category: "cat-2",
        slice: "recent",
      }],
    };
    const result = convertLocomoQA(sample);
    expect(result[0].cross_lingual).toBe(false);
  });

  test("複数の qa エントリを変換する", () => {
    const sample = {
      sample_id: "ja-rel-003",
      conversation: [],
      qa: [
        { question_id: "q1", question: "Q1", answer: "A1", category: "cat-1", slice: "current" },
        { question_id: "q2", question: "Q2", answer: "A2", category: "cat-2", slice: "recent" },
      ],
    };
    const result = convertLocomoQA(sample);
    expect(result).toHaveLength(2);
    expect(result[0].question_id).toBe("q1");
    expect(result[1].question_id).toBe("q2");
  });
});

describe("convertSelfEvalQA", () => {
  test("SelfEvalCase を UnifiedQA に変換する", () => {
    const c = {
      id: "self-eval-001",
      session_id: "sess-1",
      query: "What tools were used?",
      query_template: "tool-recall-en",
      slice: "tool-recall",
      entries: [
        { id: "e1", content: "Used TypeScript compiler", created_at: "2026-01-01", session_id: "sess-1" },
      ],
      expected_order: ["e1"],
      generated_at: "2026-01-01",
    };
    const result = convertSelfEvalQA(c);
    expect(result.source).toBe("self-eval-300");
    expect(result.category).toBe("cat-1");
    expect(result.slice).toBe("tool-recall");
    expect(result.session_id).toBe("sess-1");
  });

  test("slice → category マッピングが正しい", () => {
    const base = {
      id: "x", session_id: "s", query: "Q", query_template: "t",
      entries: [{ id: "e1", content: "c", created_at: "d", session_id: "s" }],
      expected_order: ["e1"], generated_at: "d",
    };
    expect(convertSelfEvalQA({ ...base, slice: "temporal-order" }).category).toBe("cat-4");
    expect(convertSelfEvalQA({ ...base, slice: "decision-why" }).category).toBe("cat-3");
    expect(convertSelfEvalQA({ ...base, slice: "session-summary" }).category).toBe("cat-2");
    expect(convertSelfEvalQA({ ...base, slice: "tool-recall" }).category).toBe("cat-1");
  });

  test("未知の slice は cat-1 にフォールバックする", () => {
    const c = {
      id: "x", session_id: "s", query: "Q", query_template: "t",
      slice: "unknown-slice",
      entries: [{ id: "e1", content: "c", created_at: "d", session_id: "s" }],
      expected_order: ["e1"], generated_at: "d",
    };
    expect(convertSelfEvalQA(c).category).toBe("cat-1");
  });

  test("cross-lingual slice は cross_lingual = true になる", () => {
    const c = {
      id: "x", session_id: "s", query: "Q", query_template: "t",
      slice: "cross-lingual",
      entries: [{ id: "e1", content: "c", created_at: "d", session_id: "s" }],
      expected_order: ["e1"], generated_at: "d",
    };
    expect(convertSelfEvalQA(c).cross_lingual).toBe(true);
  });

  test("answer は entries 先頭3件 content を結合して最大200文字", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`, content: "x".repeat(100), created_at: "d", session_id: "s",
    }));
    const c = {
      id: "x", session_id: "s", query: "Q", query_template: "t",
      slice: "tool-recall", entries, expected_order: [], generated_at: "d",
    };
    const result = convertSelfEvalQA(c);
    expect(result.answer.length).toBeLessThanOrEqual(200);
  });
});

const FIXTURES_DIR = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures");
const hasFixtures = existsSync(join(FIXTURES_DIR, "japanese-release-pack-96.json"))
  && existsSync(join(FIXTURES_DIR, "japanese-coding-session-self-eval-300.json"));

describe("integrateFixtures (real data)", () => {
  test.skipIf(!hasFixtures)("統合で396問以上になること", () => {
    const result = integrateFixtures(
      join(FIXTURES_DIR, "japanese-release-pack-96.json"),
      join(FIXTURES_DIR, "japanese-coding-session-self-eval-300.json"),
    );
    expect(result.total_count).toBeGreaterThanOrEqual(375); // 96 + 279 (deduped)
    expect(result.schema_version).toBe("integrated-fixture-v1");
    expect(Object.keys(result.by_source).length).toBeGreaterThanOrEqual(2);
  });

  test.skipIf(!hasFixtures)("by_source に release-pack-96 と self-eval-300 が含まれる", () => {
    const result = integrateFixtures(
      join(FIXTURES_DIR, "japanese-release-pack-96.json"),
      join(FIXTURES_DIR, "japanese-coding-session-self-eval-300.json"),
    );
    expect(result.by_source["release-pack-96"]).toBe(96);
    expect(result.by_source["self-eval-300"]).toBeGreaterThanOrEqual(270);
  });

  test.skipIf(!hasFixtures)("by_slice と by_category が集計されている", () => {
    const result = integrateFixtures(
      join(FIXTURES_DIR, "japanese-release-pack-96.json"),
      join(FIXTURES_DIR, "japanese-coding-session-self-eval-300.json"),
    );
    expect(Object.keys(result.by_slice).length).toBeGreaterThan(0);
    expect(Object.keys(result.by_category).length).toBeGreaterThan(0);
  });

  test.skipIf(!hasFixtures)("sources 配列に各ソースの情報が含まれる", () => {
    const result = integrateFixtures(
      join(FIXTURES_DIR, "japanese-release-pack-96.json"),
      join(FIXTURES_DIR, "japanese-coding-session-self-eval-300.json"),
    );
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].name).toBe("release-pack-96");
    expect(result.sources[1].name).toBe("self-eval-300");
  });
});

describe("integrateFixtures (存在しないファイル)", () => {
  test("ファイルが存在しない場合は空の結果を返す", () => {
    const result = integrateFixtures("/nonexistent/a.json", "/nonexistent/b.json");
    expect(result.total_count).toBe(0);
    expect(result.items).toHaveLength(0);
    expect(result.sources).toHaveLength(0);
  });
});
