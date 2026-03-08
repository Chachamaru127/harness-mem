import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildJapaneseCompanionGateReport, stripHallucinationFiller } from "./japanese-companion-gate";

describe("S43-011: stripHallucinationFiller (product-side rejection)", () => {
  test("removes Japanese filler prefix from answer", () => {
    expect(stripHallucinationFiller("ちなみに東京です。")).toBe("東京です。");
    expect(stripHallucinationFiller("なお現在は GitHub Actions です。")).toBe("現在は GitHub Actions です。");
    expect(stripHallucinationFiller("ただし注意が必要です。")).toBe("注意が必要です。");
    expect(stripHallucinationFiller("実際には CircleCI でした。")).toBe("CircleCI でした。");
    expect(stripHallucinationFiller("現時点では ap-northeast-1 です。")).toBe("ap-northeast-1 です。");
  });

  test("removes English filler prefix from answer", () => {
    expect(stripHallucinationFiller("That said, the answer is yes.")).toBe("the answer is yes.");
    expect(stripHallucinationFiller("Actually, it was Tokyo.")).toBe("it was Tokyo.");
    expect(stripHallucinationFiller("Currently, the region is ap-northeast-1.")).toBe("the region is ap-northeast-1.");
    expect(stripHallucinationFiller("Right now the CI is GitHub Actions.")).toBe("the CI is GitHub Actions.");
  });

  test("does not modify answers without filler prefix", () => {
    expect(stripHallucinationFiller("GitHub Actions")).toBe("GitHub Actions");
    expect(stripHallucinationFiller("No")).toBe("No");
    expect(stripHallucinationFiller("ap-northeast-1")).toBe("ap-northeast-1");
    expect(stripHallucinationFiller("")).toBe("");
  });

  test("strips filler even mid-sentence when evidence-unsupported phrase precedes the fact", () => {
    // "That said, X. Also, Y." → "X. Also, Y." when filler is prefix only
    const input = "That said, Tokyo is the answer. Also mentioned earlier.";
    const result = stripHallucinationFiller(input);
    expect(result).not.toMatch(/^That said/);
    expect(result).toContain("Tokyo");
  });
});

describe("S43-011: companion gate overlong/filler tracking", () => {
  test("tracks per_record_filler_ids in report", () => {
    const dir = mkdtempSync(join(tmpdir(), "japanese-companion-gate-filler-"));
    try {
      const datasetPath = join(dir, "dataset.json");
      const resultPath = join(dir, "result.json");
      const sliceReportPath = join(dir, "slice-report.json");

      writeFileSync(datasetPath, JSON.stringify([
        { sample_id: "s1", qa: [{ question_id: "q1", slice: "current" }, { question_id: "q2", slice: "exact" }] },
      ]));
      writeFileSync(resultPath, JSON.stringify({
        records: [
          { sample_id: "s1", question_id: "q1", prediction: "ちなみに GitHub Actions です。" },
          { sample_id: "s1", question_id: "q2", prediction: "Tokyo" },
        ],
      }));
      writeFileSync(sliceReportPath, JSON.stringify({
        summary: {
          overall: { count: 2, em_avg: 0.5, f1_avg: 0.8, zero_f1_count: 0 },
          by_slice: {
            current: { count: 1, em_avg: 1, f1_avg: 1, zero_f1_count: 0 },
            exact: { count: 1, em_avg: 1, f1_avg: 1, zero_f1_count: 0 },
          },
          cross_lingual: { count: 0, em_avg: 0, f1_avg: 0, zero_f1_count: 0 },
          missing_metadata: [],
        },
      }));

      const report = buildJapaneseCompanionGateReport(datasetPath, resultPath, sliceReportPath);
      expect(report.checks.filler_count).toBe(1);
      // per_record_filler_ids should list the offending record key
      expect(report.checks.per_record_filler_ids).toContain("s1::q1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("passes when all answers are short and clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "japanese-companion-gate-clean-"));
    try {
      const datasetPath = join(dir, "dataset.json");
      const resultPath = join(dir, "result.json");
      const sliceReportPath = join(dir, "slice-report.json");

      writeFileSync(datasetPath, JSON.stringify([
        { sample_id: "s1", qa: [{ question_id: "q1", slice: "current" }, { question_id: "q2", slice: "exact" }] },
      ]));
      writeFileSync(resultPath, JSON.stringify({
        records: [
          { sample_id: "s1", question_id: "q1", prediction: "GitHub Actions" },
          { sample_id: "s1", question_id: "q2", prediction: "No" },
        ],
      }));
      writeFileSync(sliceReportPath, JSON.stringify({
        summary: {
          overall: { count: 2, em_avg: 1, f1_avg: 1, zero_f1_count: 0 },
          by_slice: {
            current: { count: 1, em_avg: 1, f1_avg: 1, zero_f1_count: 0 },
            exact: { count: 1, em_avg: 1, f1_avg: 1, zero_f1_count: 0 },
          },
          cross_lingual: { count: 0, em_avg: 0, f1_avg: 0, zero_f1_count: 0 },
          missing_metadata: [],
        },
      }));

      const report = buildJapaneseCompanionGateReport(datasetPath, resultPath, sliceReportPath);
      // verdict is pass when all critical slices pass (exact/why/list/temporal not present → thresholds not checked)
      expect(report.checks.filler_count).toBe(0);
      expect(report.checks.overlong_answer_count).toBe(0);
      expect(report.failures).not.toContain("unsupported_filler_detected");
      expect(report.failures).not.toContain("overlong_answer_rate>0.10");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("japanese companion gate", () => {
  test("fails when critical slices, zero-F1, or overlong answers exceed the contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "japanese-companion-gate-"));
    try {
      const datasetPath = join(dir, "dataset.json");
      const resultPath = join(dir, "result.json");
      const sliceReportPath = join(dir, "slice-report.json");

      writeFileSync(
        datasetPath,
        JSON.stringify(
          [
            {
              sample_id: "sample-1",
              qa: [
                { question_id: "q-current", slice: "current" },
                { question_id: "q-yes", slice: "yes_no" },
              ],
            },
          ],
          null,
          2
        )
      );
      writeFileSync(
        resultPath,
        JSON.stringify(
          {
            records: [
              { sample_id: "sample-1", question_id: "q-current", prediction: "ちなみに現在の設定はかなり長く説明すると Tokyo です。以前は us-east-1 でした。" },
              { sample_id: "sample-1", question_id: "q-yes", prediction: "No" },
            ],
          },
          null,
          2
        )
      );
      writeFileSync(
        sliceReportPath,
        JSON.stringify(
          {
            summary: {
              overall: { count: 2, em_avg: 0, f1_avg: 0.4, zero_f1_count: 2 },
              by_slice: {
                current: { count: 1, em_avg: 0, f1_avg: 0.5, zero_f1_count: 1 },
                yes_no: { count: 1, em_avg: 1, f1_avg: 1, zero_f1_count: 0 },
              },
              cross_lingual: { count: 0, em_avg: 0, f1_avg: 0, zero_f1_count: 0 },
              missing_metadata: [],
            },
          },
          null,
          2
        )
      );

      const report = buildJapaneseCompanionGateReport(datasetPath, resultPath, sliceReportPath);
      expect(report.verdict).toBe("fail");
      expect(report.failures).toContain("slice:current<0.9");
      expect(report.failures).toContain("zero_f1_count>1");
      expect(report.failures).toContain("overlong_answer_rate>0.10");
      expect(report.failures).toContain("unsupported_filler_detected");
      expect(report.warnings).toContain("watch_slice_missing:current_vs_previous");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
