import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASELINE_COMPOSITE_BAND,
  SHADOW_AB_METRICS,
  SHADOW_AB_ORDER_SLICES,
  buildComparisons,
  pairedBootstrapCompositeDeltaCi95,
  type ShadowAbReport,
} from "../../scripts/s154-embedding-shadow-ab";
import {
  computeCompositeEmbeddingScore,
  loadCompositeScoreWeights,
} from "../../memory-server/src/embedding/adaptive-config";

const ROOT = process.cwd();
const ARTIFACT_PATH = join(ROOT, "docs/benchmarks/artifacts/s154-embedding-shadow-ab/summary.json");
const BILINGUAL_V2_PATH = join(ROOT, "tests/benchmarks/fixtures/bilingual-v2.json");
const DEV_WORKFLOW_V2_PATH = join(ROOT, "tests/benchmarks/fixtures/dev-workflow-v2.json");
const BILINGUAL_V1_PATH = join(ROOT, "tests/benchmarks/fixtures/bilingual-50.json");
const DEV_WORKFLOW_V1_PATH = join(ROOT, "tests/benchmarks/fixtures/dev-workflow-20.json");
const CJK_FIXTURE_PATH = join(ROOT, "tests/benchmarks/fixtures/cjk-discrimination.json");

function readArtifact(): ShadowAbReport {
  return JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as ShadowAbReport;
}

describe("S154-500 fixture v2 (ceiling removal)", () => {
  const bilingual = JSON.parse(readFileSync(BILINGUAL_V2_PATH, "utf8")) as {
    schema_version: string;
    samples: Array<{ id: string; pattern: string; content: string; query: string; relevant_ids: string[] }>;
    distractors: Array<{ id: string; content: string }>;
  };
  const dev = JSON.parse(readFileSync(DEV_WORKFLOW_V2_PATH, "utf8")) as {
    schema_version: string;
    cases: Array<{ id: string; query: string; entries: Array<{ id: string; content: string }>; relevant_ids: string[] }>;
  };

  test("bilingual-v2: pool >= 150 with hard-negative distractors, per-slice queries >= 50", () => {
    expect(bilingual.schema_version).toBe("s154-500-bilingual.v2");
    expect(bilingual.samples.length + bilingual.distractors.length).toBeGreaterThanOrEqual(150);
    expect(bilingual.distractors.length).toBeGreaterThanOrEqual(40);
    const jaSlice = bilingual.samples.filter((s) =>
      ["ja-content_en-query", "en-content_ja-query"].includes(s.pattern),
    );
    const mixedSlice = bilingual.samples.filter((s) => s.pattern === "mixed-content_mixed-query");
    expect(jaSlice.length).toBeGreaterThanOrEqual(50);
    expect(mixedSlice.length).toBeGreaterThanOrEqual(50);
  });

  test("bilingual-v2: ids and contents are unique; relevant ids resolve to pool entries", () => {
    const ids = [...bilingual.samples.map((s) => s.id), ...bilingual.distractors.map((d) => d.id)];
    expect(new Set(ids).size).toBe(ids.length);
    const idSet = new Set(ids);
    for (const sample of bilingual.samples) {
      expect(sample.relevant_ids.length).toBeGreaterThan(0);
      for (const rid of sample.relevant_ids) {
        expect(idSet.has(rid)).toBe(true);
      }
    }
  });

  test("dev-workflow-v2: >= 50 queries with JA/mixed cases >= 30%", () => {
    expect(dev.schema_version).toBe("s154-500-dev-workflow.v2");
    expect(dev.cases.length).toBeGreaterThanOrEqual(50);
    const hasJa = (text: string) => /[぀-ヿ一-鿿]/.test(text);
    const jaLike = dev.cases.filter(
      (c) => hasJa(c.query) || c.entries.some((entry) => hasJa(entry.content)),
    );
    expect(jaLike.length / dev.cases.length).toBeGreaterThanOrEqual(0.3);
  });

  test("held-out: v2 queries do not duplicate the 154-151 CJK discrimination fixture queries", () => {
    const cjk = JSON.parse(readFileSync(CJK_FIXTURE_PATH, "utf8")) as {
      cases?: Array<{ query?: string }>;
    };
    const cjkQueries = new Set(
      (Array.isArray(cjk.cases) ? cjk.cases : []).map((c) => c.query).filter(Boolean) as string[],
    );
    for (const sample of bilingual.samples) {
      expect(cjkQueries.has(sample.query)).toBe(false);
    }
  });
});

describe("S154-402/501 embedding shadow A/B output contract (v2)", () => {
  test("buildComparisons emits the fixed {metric, baseline, candidate, delta} schema", () => {
    const baseline = { mixed: 1, ja: 0.8, bilingual: 0.9, devWorkflow: 0.7 };
    const candidate = { mixed: 0.5, ja: 0.9, bilingual: 0.85, devWorkflow: 0.7 };
    const comparisons = buildComparisons(baseline, candidate);

    expect(comparisons.map((c) => c.metric)).toEqual([...SHADOW_AB_METRICS]);
    for (const row of comparisons) {
      expect(Object.keys(row).sort()).toEqual(["baseline", "candidate", "delta", "metric"]);
      expect(typeof row.baseline).toBe("number");
      expect(typeof row.candidate).toBe("number");
      expect(row.delta).toBeCloseTo(row.candidate - row.baseline, 4);
    }
    const mixedRow = comparisons.find((c) => c.metric === "mixed");
    expect(mixedRow?.delta).toBe(-0.5);
  });

  test("composite row equals the s154-400 weighted average of the four metrics", () => {
    const baseline = { mixed: 0.4, ja: 0.6, bilingual: 0.8, devWorkflow: 1 };
    const candidate = { mixed: 0.5, ja: 0.5, bilingual: 0.9, devWorkflow: 0.9 };
    const weights = loadCompositeScoreWeights();
    const compositeRow = buildComparisons(baseline, candidate).find((c) => c.metric === "composite");
    expect(compositeRow?.baseline).toBeCloseTo(computeCompositeEmbeddingScore(baseline, weights), 4);
    expect(compositeRow?.candidate).toBeCloseTo(computeCompositeEmbeddingScore(candidate, weights), 4);
  });

  test("paired bootstrap CI95 is deterministic and zero-width for identical sides", () => {
    const slice = (values: number[]) => ({ recall: values, top1: values, rr: values });
    const sides = {
      mixed: slice([1, 0, 1, 0, 1]),
      ja: slice([0.5, 1, 0, 1, 0.5]),
      bilingual: slice([1, 1, 0, 0, 1]),
      dev_workflow: slice([1, 0.5, 0.5, 1, 0]),
    };
    const ci = pairedBootstrapCompositeDeltaCi95(sides, sides);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(0);
    expect(ci.width).toBe(0);

    const ciAgain = pairedBootstrapCompositeDeltaCi95(sides, sides);
    expect(ciAgain).toEqual(ci);
  });

  test("paired bootstrap rejects mismatched query sets (pairing is mandatory)", () => {
    const slice = (values: number[]) => ({ recall: values, top1: values, rr: values });
    const a = {
      mixed: slice([1, 0]),
      ja: slice([1]),
      bilingual: slice([1, 0]),
      dev_workflow: slice([1]),
    };
    const b = {
      mixed: slice([1, 0, 1]),
      ja: slice([1]),
      bilingual: slice([1, 0]),
      dev_workflow: slice([1]),
    };
    expect(() => pairedBootstrapCompositeDeltaCi95(a, b)).toThrow(/identical query sets/);
  });

  test("committed artifact follows the v2 schema with order metrics, CI and baseline band", () => {
    const report = readArtifact();
    expect(report.schema_version).toBe("s154-402-embedding-shadow-ab.v2");
    expect(report.aggregate_only).toBe(true);
    expect(report.baseline_model).toBe("multilingual-e5");
    expect(report.switch_delta_threshold).toBeGreaterThan(0);
    expect(report.candidates.length).toBeGreaterThanOrEqual(1);

    // S154-500: ceiling removal is part of the contract.
    expect(report.baseline_band.within).toBe(true);
    expect(report.baseline_band.composite).toBeLessThanOrEqual(BASELINE_COMPOSITE_BAND.max);
    expect(report.baseline_band.composite).toBeGreaterThanOrEqual(BASELINE_COMPOSITE_BAND.min);

    for (const candidate of report.candidates) {
      if (candidate.status === "measured") {
        expect(candidate.skip_reason).toBeNull();
        expect(candidate.comparisons.map((c) => c.metric)).toEqual([...SHADOW_AB_METRICS]);
        for (const row of candidate.comparisons) {
          // baseline/candidate/delta are each rounded to 4 decimals
          // independently, so delta can differ from (candidate - baseline)
          // by up to 1e-4.
          expect(row.delta).toBeCloseTo(row.candidate - row.baseline, 3);
        }
        // S154-501: order-sensitive metrics per slice (top1 / mrr).
        const sliceMetricPairs = candidate.order_metrics.map((m) => `${m.slice}:${m.metric}`);
        for (const slice of SHADOW_AB_ORDER_SLICES) {
          expect(sliceMetricPairs).toContain(`${slice}:top1`);
          expect(sliceMetricPairs).toContain(`${slice}:mrr`);
        }
        expect(candidate.composite_delta_ci95).not.toBeNull();
        expect(candidate.composite_delta_ci95!.width).toBeGreaterThanOrEqual(0);
        expect(candidate.latency).not.toBeNull();
      } else {
        expect(candidate.status).toBe("skipped");
        expect(typeof candidate.skip_reason).toBe("string");
        expect(candidate.comparisons).toEqual([]);
      }
    }

    // v1 negative control rides along but is clearly separated.
    expect(report.negative_control_v1.baseline_composite).toBeGreaterThan(0);
  });

  test("artifact carries aggregates only — no fixture content, queries, or match bodies", () => {
    const serialized = readFileSync(ARTIFACT_PATH, "utf8");
    const bilingualV2 = JSON.parse(readFileSync(BILINGUAL_V2_PATH, "utf8")) as {
      samples: Array<{ content: string; query: string }>;
      distractors: Array<{ content: string }>;
    };
    const devV2 = JSON.parse(readFileSync(DEV_WORKFLOW_V2_PATH, "utf8")) as {
      cases: Array<{ query: string; entries: Array<{ content: string }> }>;
    };
    const bilingualV1 = JSON.parse(readFileSync(BILINGUAL_V1_PATH, "utf8")) as {
      samples: Array<{ content: string; query: string }>;
    };
    const devV1 = JSON.parse(readFileSync(DEV_WORKFLOW_V1_PATH, "utf8")) as Array<{
      query: string;
      entries: Array<{ content: string }>;
    }>;

    const rawTexts = [
      ...bilingualV2.samples.flatMap((sample) => [sample.content, sample.query]),
      ...bilingualV2.distractors.map((d) => d.content),
      ...devV2.cases.flatMap((devCase) => [devCase.query, ...devCase.entries.map((e) => e.content)]),
      ...bilingualV1.samples.flatMap((sample) => [sample.content, sample.query]),
      ...devV1.flatMap((devCase) => [devCase.query, ...devCase.entries.map((e) => e.content)]),
    ];
    for (const text of rawTexts) {
      expect(serialized).not.toContain(text);
    }
  });
});
