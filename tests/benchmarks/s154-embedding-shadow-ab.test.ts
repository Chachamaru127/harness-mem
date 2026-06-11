import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SHADOW_AB_METRICS,
  buildComparisons,
  type ShadowAbReport,
} from "../../scripts/s154-embedding-shadow-ab";
import {
  computeCompositeEmbeddingScore,
  loadCompositeScoreWeights,
} from "../../memory-server/src/embedding/adaptive-config";

const ROOT = process.cwd();
const ARTIFACT_PATH = join(ROOT, "docs/benchmarks/artifacts/s154-embedding-shadow-ab/summary.json");
const BILINGUAL_PATH = join(ROOT, "tests/benchmarks/fixtures/bilingual-50.json");
const DEV_WORKFLOW_PATH = join(ROOT, "tests/benchmarks/fixtures/dev-workflow-20.json");

function readArtifact(): ShadowAbReport {
  return JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as ShadowAbReport;
}

describe("S154-402 embedding shadow A/B output contract", () => {
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

  test("committed artifact follows the schema with measured/skipped candidates", () => {
    const report = readArtifact();
    expect(report.schema_version).toBe("s154-402-embedding-shadow-ab.v1");
    expect(report.aggregate_only).toBe(true);
    expect(report.baseline_model).toBe("multilingual-e5");
    expect(report.switch_delta_threshold).toBeGreaterThan(0);
    expect(report.candidates.length).toBeGreaterThanOrEqual(1);

    for (const candidate of report.candidates) {
      if (candidate.status === "measured") {
        expect(candidate.skip_reason).toBeNull();
        expect(candidate.comparisons.map((c) => c.metric)).toEqual([...SHADOW_AB_METRICS]);
        for (const row of candidate.comparisons) {
          expect(row.delta).toBeCloseTo(row.candidate - row.baseline, 4);
        }
      } else {
        expect(candidate.status).toBe("skipped");
        expect(typeof candidate.skip_reason).toBe("string");
        expect(candidate.comparisons).toEqual([]);
      }
    }
  });

  test("artifact carries aggregates only — no fixture content, queries, or match bodies", () => {
    const serialized = readFileSync(ARTIFACT_PATH, "utf8");
    const bilingual = JSON.parse(readFileSync(BILINGUAL_PATH, "utf8")) as {
      samples: Array<{ content: string; query: string }>;
    };
    const devCases = JSON.parse(readFileSync(DEV_WORKFLOW_PATH, "utf8")) as Array<{
      query: string;
      entries: Array<{ content: string }>;
    }>;

    const rawTexts = [
      ...bilingual.samples.flatMap((sample) => [sample.content, sample.query]),
      ...devCases.flatMap((devCase) => [devCase.query, ...devCase.entries.map((e) => e.content)]),
    ];
    for (const text of rawTexts) {
      expect(serialized).not.toContain(text);
    }
  });
});
