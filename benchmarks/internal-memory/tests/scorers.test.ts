import { describe, expect, test } from "bun:test";
import { scoreCase } from "../lib/score-case";
import type { BenchmarkCase } from "../lib/types";
import {
  allowsContentRecallFallback,
  inferCompetency,
  usesLlmJudge,
  usesSubstringGrounding,
} from "../scorers/competency";
import { mrr, ndcgAtK, recallAtK } from "../scorers/retrieval";
import { japaneseMixedScore } from "../scorers/multilingual";
import type { ScoredCaseResult } from "../lib/types";

describe("internal-memory scorers", () => {
  test("recall@k and mrr behave deterministically", () => {
    const relevant = ["a", "b"];
    const retrieved = ["x", "a", "b"];
    expect(recallAtK(relevant, retrieved, 5)).toBe(1);
    expect(mrr(relevant, retrieved)).toBe(0.5);
    expect(ndcgAtK(relevant, retrieved, 5)).toBeGreaterThan(0.65);
  });

  test("japaneseMixedScore averages ja and mixed only", () => {
    const rows: ScoredCaseResult[] = [
      {
        case_id: "1",
        layer: "ja_coding",
        category: "ja_requirements",
        language_profile: "ja",
        competitor_id: "harness-mem",
        status: "ok",
        recall_at_5: 1,
        recall_at_10: 1,
        mrr: 1,
        ndcg_at_10: 1,
        latency_ms: 1,
        retrieved_ids: [],
      },
      {
        case_id: "2",
        layer: "mixed_coding",
        category: "mixed_symbol",
        language_profile: "mixed",
        competitor_id: "harness-mem",
        status: "ok",
        recall_at_5: 0.5,
        recall_at_10: 0.5,
        mrr: 0.5,
        ndcg_at_10: 0.5,
        latency_ms: 1,
        retrieved_ids: [],
      },
      {
        case_id: "3",
        layer: "public_compatible",
        category: "english_fact",
        language_profile: "en",
        competitor_id: "harness-mem",
        status: "ok",
        recall_at_5: 0,
        recall_at_10: 0,
        mrr: 0,
        ndcg_at_10: 0,
        latency_ms: 1,
        retrieved_ids: [],
      },
    ];
    expect(japaneseMixedScore(rows)).toBeCloseTo(0.75, 5);
  });

  test("competency mapping and scoring tiers", () => {
    const arCase: BenchmarkCase = {
      case_id: "ar",
      layer: "ja_coding",
      category: "ja_requirements",
      language_profile: "ja",
      project: "p",
      memories: [{ id: "m1", content: "hello" }],
      query: "q",
      relevant_ids: ["m1"],
      expected_keywords: ["hello"],
    };
    const crCase: BenchmarkCase = {
      ...arCase,
      case_id: "cr",
      category: "conflict_resolution",
      competency: "CR",
    };
    const ttlCase: BenchmarkCase = {
      ...arCase,
      case_id: "ttl",
      category: "test_time_learning",
      competency: "TTL",
    };

    expect(inferCompetency(arCase)).toBe("AR");
    expect(inferCompetency(crCase)).toBe("CR");
    expect(inferCompetency(ttlCase)).toBe("TTL");
    expect(usesSubstringGrounding("AR")).toBe(true);
    expect(usesSubstringGrounding("CR")).toBe(true);
    expect(usesSubstringGrounding("TTL")).toBe(false);
    expect(usesLlmJudge("TTL")).toBe(true);
    expect(usesLlmJudge("LRU")).toBe(true);
    expect(allowsContentRecallFallback("AR")).toBe(true);
    expect(allowsContentRecallFallback("CR")).toBe(false);
  });

  test("two-tier scoring separates substring and llm grounding fields", () => {
    const caseRow: BenchmarkCase = {
      case_id: "cr-tier",
      layer: "ja_coding",
      category: "conflict_resolution",
      competency: "CR",
      language_profile: "ja",
      project: "p",
      memories: [
        { id: "old", content: "session cookie auth" },
        { id: "new", content: "JWT refresh rotation auth" },
      ],
      query: "auth?",
      relevant_ids: ["new"],
      expected_keywords: ["JWT"],
    };
    const scored = scoreCase(caseRow, "harness-mem", {
      status: "ok",
      hits: [{ id: "wrong", rank: 1, content: "session cookie auth legacy" }],
      latency_ms: 1,
    });
    expect(scored.competency).toBe("CR");
    expect(scored.recall_at_10).toBe(0);
    expect(scored.substring_grounding_score).toBe(0);
    expect(scored.llm_grounding_score).toBeUndefined();

    const arScored = scoreCase(
      { ...caseRow, category: "ja_requirements", competency: "AR" },
      "harness-mem",
      {
        status: "ok",
        hits: [{ id: "x", rank: 1, content: "JWT refresh rotation auth" }],
        latency_ms: 1,
      },
    );
    expect(arScored.substring_grounding_score).toBe(1);
    expect(arScored.grounding_score).toBe(1);
    expect(arScored.llm_grounding_score).toBeUndefined();
  });
});
