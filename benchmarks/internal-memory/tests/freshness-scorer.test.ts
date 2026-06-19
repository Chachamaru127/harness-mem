/**
 * S154-301: deep-freshness scorer unit tests.
 *
 * Verifies the three temporal-correctness metrics on known tense-rewrite /
 * supersession fixtures, the score-case ground-truth population, and that the
 * metrics surface as LayerSummary diagnostics.
 */

import { describe, expect, test } from "bun:test";
import {
  freshnessDelayMs,
  supersessionPrecision,
  tenseRewriteAccuracy,
} from "../scorers/freshness";
import { scoreCase } from "../lib/score-case";
import { buildSummary } from "../lib/summarize";
import type {
  BenchmarkCase,
  FreshnessGroundTruth,
  ScoredCaseResult,
} from "../lib/types";

function row(over: Partial<ScoredCaseResult> & { freshness_truth?: FreshnessGroundTruth }): ScoredCaseResult {
  return {
    case_id: "c",
    layer: "mixed_coding",
    category: "real_conflict_resolution",
    language_profile: "mixed",
    competitor_id: "harness-mem",
    status: "ok",
    recall_at_5: 1,
    recall_at_10: 1,
    mrr: 1,
    ndcg_at_10: 1,
    latency_ms: 5,
    retrieved_ids: [],
    ...over,
  };
}

describe("S154-301 supersessionPrecision", () => {
  test("fraction of cases where no superseded id leaks", () => {
    const rows = [
      // clean: superseded 'old' not retrieved
      row({ retrieved_ids: ["new"], freshness_truth: { superseded_ids: ["old"] } }),
      // leak: superseded 'old' present in results
      row({ retrieved_ids: ["new", "old"], freshness_truth: { superseded_ids: ["old"] } }),
      // not eligible (no superseded ground truth) — excluded from denominator
      row({ retrieved_ids: ["x"] }),
    ];
    expect(supersessionPrecision(rows)).toBeCloseTo(0.5, 10);
  });

  test("undefined when no eligible case", () => {
    expect(supersessionPrecision([row({ retrieved_ids: ["x"] })])).toBeUndefined();
    expect(supersessionPrecision([])).toBeUndefined();
  });
});

describe("S154-301 tenseRewriteAccuracy", () => {
  test("requires old-tense excluded AND fresh value retrieved (recall@10==1)", () => {
    const rows = [
      // correct: stale excluded, all relevant retrieved
      row({ recall_at_10: 1, retrieved_ids: ["done"], freshness_truth: { stale_tense_ids: ["planned"] } }),
      // wrong: stale leaks
      row({ recall_at_10: 1, retrieved_ids: ["done", "planned"], freshness_truth: { stale_tense_ids: ["planned"] } }),
      // wrong: fresh value not fully retrieved
      row({ recall_at_10: 0, retrieved_ids: [], freshness_truth: { stale_tense_ids: ["planned"] } }),
    ];
    expect(tenseRewriteAccuracy(rows)).toBeCloseTo(1 / 3, 10);
  });

  test("undefined with no tense ground truth", () => {
    expect(tenseRewriteAccuracy([row({})])).toBeUndefined();
  });
});

describe("S154-301 freshnessDelayMs", () => {
  test("mean lag from invalidation to clearance (longitudinal)", () => {
    const rows = [
      row({
        freshness_truth: {
          invalidated_at: { a: "2026-01-01T00:00:00.000Z" },
          stale_cleared_at: { a: "2026-01-01T00:00:02.000Z" }, // 2000ms
        },
      }),
      row({
        freshness_truth: {
          invalidated_at: { b: "2026-01-01T00:00:00.000Z" },
          stale_cleared_at: { b: "2026-01-01T00:00:04.000Z" }, // 4000ms
        },
      }),
    ];
    expect(freshnessDelayMs(rows)).toBeCloseTo(3000, 10);
  });

  test("undefined for a static snapshot (no stale_cleared_at)", () => {
    expect(
      freshnessDelayMs([row({ freshness_truth: { invalidated_at: { a: "2026-01-01T00:00:00.000Z" } } })]),
    ).toBeUndefined();
  });
});

describe("S154-301 score-case populates freshness_truth from metadata", () => {
  function caseWith(metadata: Record<string, string>): BenchmarkCase {
    return {
      case_id: "tc-1",
      layer: "mixed_coding",
      category: "real_conflict_resolution",
      language_profile: "mixed",
      project: "p",
      memories: [
        { id: "m-new", content: "status: done" },
        { id: "m-old", content: "status: planned", metadata },
      ],
      query: "current status?",
      relevant_ids: ["m-new"],
    };
  }

  test("harness-mem maps annotated ids into obs_ space", () => {
    const scored = scoreCase(caseWith({ superseded_by: "m-new" }), "harness-mem", {
      status: "ok",
      hits: [{ id: "obs_m-new", rank: 1, content: "status: done" }],
      latency_ms: 3,
    });
    expect(scored.freshness_truth?.superseded_ids).toEqual(["obs_m-old"]);
    // and the scorer reads it correctly: old excluded → precision 1
    expect(supersessionPrecision([scored])).toBe(1);
  });

  test("no annotation → freshness_truth omitted", () => {
    const scored = scoreCase(caseWith({}), "harness-mem", {
      status: "ok",
      hits: [{ id: "obs_m-new", rank: 1, content: "status: done" }],
      latency_ms: 3,
    });
    expect(scored.freshness_truth).toBeUndefined();
  });
});

describe("S154-301 summary surfaces freshness diagnostics", () => {
  test("LayerSummary carries the three fields (null when no ground truth)", () => {
    const summary = buildSummary({
      run_id: "t",
      dataset_ids: ["d"],
      results: [row({ retrieved_ids: ["x"] })],
    });
    const layer = summary.competitors[0].layers[0];
    expect("tense_rewrite_accuracy" in layer).toBe(true);
    expect("supersession_precision" in layer).toBe(true);
    expect("freshness_delay_ms" in layer).toBe(true);
    expect(layer.supersession_precision).toBeUndefined();
  });
});
