import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKnowledgeUpdateFixtureLinks,
  buildPairedF1Vectors,
  checkJapaneseCompanionGate,
  collectTemporalAnchorReferenceTexts,
  layer3WilcoxonImprovement,
} from "../../src/benchmark/run-ci";
import type { LocomoBenchmarkResult } from "../../../tests/benchmarks/run-locomo-benchmark";

function makeLocomoResult(
  records: Array<{ sample_id: string; question_id: string; category: string; f1: number }>
): LocomoBenchmarkResult {
  return {
    schema_version: "locomo-benchmark-v2",
    generated_at: "2026-03-06T00:00:00.000Z",
    system: "harness-mem",
    pipeline: {
      embedding: {
        mode: "onnx",
        provider: "local",
        model: "multilingual-e5-small",
        vector_dimension: 384,
        runtime_provider: "local",
        runtime_model: "multilingual-e5-small",
        runtime_health_status: "healthy",
        runtime_health_details: "ok",
        gate: { enabled: true, passed: true, failures: [] },
      },
      prime_embedding_enabled: true,
    },
    dataset: {
      path: "fixtures/locomo-120.json",
      sample_count: 1,
      qa_count: records.length,
    },
    metrics: {
      overall: { em: 0, f1: 0, count: records.length },
      by_category: {},
    } as any,
    comparison: {
      cat_1_to_4: { em: 0, f1: 0, count: records.length },
      cat_5: { em: 0, f1: 0, count: 0 },
    } as any,
    performance: {
      search_latency_ms: { count: records.length, min: 0, max: 0, avg: 0, p50: 0, p95: 0 },
      cache_stats: { available: false, before: null, after: null, delta: null },
    },
    cost: {
      search_token_estimate: {
        count: records.length,
        input_total: 0,
        output_total: 0,
        total_total: 0,
        input_avg: 0,
        output_avg: 0,
        total_avg: 0,
      },
    },
    records: records.map((record, index) => ({
      sample_id: record.sample_id,
      question_id: record.question_id,
      question: `q-${index}`,
      answer: "gold",
      prediction: "pred",
      category: record.category,
      evidence_ids: [],
      answer_strategy: "test",
      selected_evidence_ids: [],
      answer_trace: {
        query_variants: [],
        search_policy: { limit: 0, variant_cap: 0, candidate_limit: 0, quality_floor: 0 },
        extraction: { selected_candidates: [], strategy: "test" },
        normalization: { before: "", after: "", notes: [], reference_time: null },
      },
      search_latency_ms: 0,
      token_estimate_input_tokens: 0,
      token_estimate_output_tokens: 0,
      token_estimate_total_tokens: 0,
      em: 0,
      f1: record.f1,
    })),
  };
}

afterEach(() => {
  delete process.env.HARNESS_BENCH_ASSERT_IMPROVEMENT;
});

describe("buildPairedF1Vectors", () => {
  test("question id と sample id が一致する record だけを paired 化する", () => {
    const before = makeLocomoResult([
      { sample_id: "s1", question_id: "q1", category: "cat-2", f1: 0.0 },
      { sample_id: "s1", question_id: "q2", category: "cat-3", f1: 0.2 },
    ]);
    const after = makeLocomoResult([
      { sample_id: "s1", question_id: "q1", category: "cat-2", f1: 0.5 },
      { sample_id: "s1", question_id: "q2", category: "cat-3", f1: 0.6 },
      { sample_id: "s2", question_id: "q9", category: "cat-1", f1: 1.0 },
    ]);

    const paired = buildPairedF1Vectors(before, after, "focus", ["cat-2", "cat-3"]);
    expect(paired.label).toBe("focus");
    expect(paired.matched).toBe(2);
    expect(paired.before).toEqual([0.0, 0.2]);
    expect(paired.after).toEqual([0.5, 0.6]);
    expect(paired.meanDelta).toBeCloseTo(0.45, 6);
  });
});

describe("benchmark fixture helpers", () => {
  test("knowledge-update fixture から new->old updates link を展開する", () => {
    const links = buildKnowledgeUpdateFixtureLinks({
      old_entries: [
        { id: "old-1", content: "old", timestamp: "2024-01-01T00:00:00.000Z" },
        { id: "old-2", content: "old", timestamp: "2024-01-02T00:00:00.000Z" },
      ],
      new_entries: [
        { id: "new-1", content: "new", timestamp: "2024-02-01T00:00:00.000Z" },
      ],
    });
    expect(links).toEqual([
      { fromObservationId: "obs_new-1", toObservationId: "obs_old-1" },
      { fromObservationId: "obs_new-1", toObservationId: "obs_old-2" },
    ]);
  });

  test("temporal query から anchor referenceText を重複なく抽出する", () => {
    const refs = collectTemporalAnchorReferenceTexts(
      "What happened after the migration and before the release?"
    );
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("layer3WilcoxonImprovement", () => {
  test("env 未設定時は skip する", () => {
    const result = layer3WilcoxonImprovement([0, 0.1], [0.2, 0.3], "focus");
    expect(result.skipped).toBe(true);
  });

  test("平均改善が負なら fail する", () => {
    process.env.HARNESS_BENCH_ASSERT_IMPROVEMENT = "1";
    const result = layer3WilcoxonImprovement([0.5, 0.6, 0.7], [0.4, 0.5, 0.6], "focus");
    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("mean delta");
  });

  test("十分な paired 改善があれば pass する", () => {
    process.env.HARNESS_BENCH_ASSERT_IMPROVEMENT = "1";
    const before = Array.from({ length: 12 }, () => 0);
    const after = Array.from({ length: 12 }, () => 1);
    const result = layer3WilcoxonImprovement(before, after, "focus");
    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.message).toContain("Wilcoxon p=");
  });
});

// S43-010: checkJapaneseCompanionGate
describe("S43-010: checkJapaneseCompanionGate", () => {
  test("artifact が存在しない場合は skipped=true, passed=true を返す", () => {
    const result = checkJapaneseCompanionGate("/nonexistent/path/companion-gate.json");
    expect(result.skipped).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.message).toContain("artifact not found");
  });

  test("HARNESS_BENCH_JA_COMPANION=0 の場合は skipped=true を返す", () => {
    process.env.HARNESS_BENCH_JA_COMPANION = "0";
    try {
      const result = checkJapaneseCompanionGate("/any/path/companion-gate.json");
      expect(result.skipped).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.message).toContain("disabled");
    } finally {
      delete process.env.HARNESS_BENCH_JA_COMPANION;
    }
  });

  test("verdict=pass の artifact では passed=true を返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-jagate-"));
    try {
      const artifactPath = join(dir, "companion-gate.json");
      writeFileSync(
        artifactPath,
        JSON.stringify({
          schema_version: "japanese-companion-gate-v1",
          verdict: "pass",
          failures: [],
          checks: {},
        })
      );
      const result = checkJapaneseCompanionGate(artifactPath);
      expect(result.skipped).toBe(false);
      expect(result.passed).toBe(true);
      expect(result.verdict).toBe("pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("verdict=fail の artifact では passed=false を返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-jagate-fail-"));
    try {
      const artifactPath = join(dir, "companion-gate.json");
      const failures = ["slice:temporal<0.75", "zero_f1_count>1"];
      writeFileSync(
        artifactPath,
        JSON.stringify({
          schema_version: "japanese-companion-gate-v1",
          verdict: "fail",
          failures,
          checks: {},
        })
      );
      const result = checkJapaneseCompanionGate(artifactPath);
      expect(result.skipped).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.verdict).toBe("fail");
      expect(result.failures).toContain("slice:temporal<0.75");
      expect(result.message).toContain("slice:temporal<0.75");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("破損した JSON では passed=false を返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-jagate-corrupt-"));
    try {
      const artifactPath = join(dir, "companion-gate.json");
      writeFileSync(artifactPath, "{ invalid json }");
      const result = checkJapaneseCompanionGate(artifactPath);
      expect(result.skipped).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.message).toContain("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
