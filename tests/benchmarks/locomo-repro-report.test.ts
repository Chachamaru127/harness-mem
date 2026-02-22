import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLocomoReproReportFromPaths } from "./locomo-repro-report";

describe("LOCOMO repro report", () => {
  test("aggregates mean and stddev across multiple score reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "locomo-repro-"));
    try {
      const reportA = join(dir, "a.json");
      const reportB = join(dir, "b.json");
      writeFileSync(
        reportA,
        JSON.stringify({
          dataset: { path: ".tmp/locomo/locomo10.json" },
          strict: {
            all_categories: { em: 0.1, f1: 0.2 },
            cat_1_to_4: { em: 0.05, f1: 0.15 },
            cat_5: { em: 0.2, f1: 0.3 },
          },
          llm_judge: {
            source_judge_path: ".tmp/locomo/locomo10.judge.cat1-4.json",
            overall_accuracy: 0.4,
            by_category: {
              "cat-1": { accuracy: 0.4, count: 10 },
              "cat-2": { accuracy: 0.3, count: 10 },
              "cat-3": { accuracy: 0.2, count: 10 },
              "cat-4": { accuracy: 0.1, count: 10 },
            },
          },
          performance: { search_latency_ms: { p95: 12 } },
          cost: { search_token_estimate: { total_avg: 100 } },
        })
      );
      writeFileSync(
        reportB,
        JSON.stringify({
          dataset: { path: ".tmp/locomo/locomo10.json" },
          strict: {
            all_categories: { em: 0.3, f1: 0.4 },
            cat_1_to_4: { em: 0.15, f1: 0.35 },
            cat_5: { em: 0.1, f1: 0.2 },
          },
          llm_judge: {
            source_judge_path: ".tmp/locomo/locomo10.judge.cat1-4.json",
            overall_accuracy: 0.2,
            by_category: {
              "cat-1": { accuracy: 0.3, count: 10 },
              "cat-2": { accuracy: 0.2, count: 10 },
              "cat-3": { accuracy: 0.1, count: 10 },
              "cat-4": { accuracy: 0.1, count: 10 },
            },
          },
          performance: { search_latency_ms: { p95: 8 } },
          cost: { search_token_estimate: { total_avg: 80 } },
        })
      );

      const aggregated = buildLocomoReproReportFromPaths([reportA, reportB]);
      expect(aggregated.runs).toBe(2);
      expect(aggregated.strict.all_categories_f1.mean).toBeCloseTo(0.3, 5);
      expect(aggregated.strict.all_categories_f1.stddev).toBeCloseTo(0.1, 5);
      expect(aggregated.llm_judge?.overall_accuracy.mean).toBeCloseTo(0.3, 5);
      expect(aggregated.performance?.search_latency_p95_ms.mean).toBeCloseTo(10, 5);
      expect(aggregated.cost?.search_token_total_avg.mean).toBeCloseTo(90, 5);
      expect(aggregated.comparison_lock.same_dataset).toBe(true);
      expect(aggregated.comparison_lock.same_judge).toBe(true);
      expect(aggregated.comparison_lock.same_category_scope).toBe(true);
      expect(aggregated.review_evidence_spec.required_artifacts).toContain("locomo10.repro-report.json");
      expect(aggregated.rejection_flags).toContain("repro.runs_below_3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
