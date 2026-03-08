import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildJapaneseReleaseReport } from "./japanese-release-report";

describe("japanese release report", () => {
  test("summarizes slices and cross-lingual metadata from dataset + result", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ja-release-report-"));
    const datasetPath = join(tempDir, "dataset.json");
    const resultPath = join(tempDir, "result.json");

    try {
      writeFileSync(
        datasetPath,
        JSON.stringify([
          {
            sample_id: "sample-1",
            conversation: [{ speaker: "user", text: "hello" }],
            qa: [
              {
                question_id: "current-001",
                question: "今は何ですか？",
                answer: "GitHub Actions",
                category: "cat-1",
                slice: "current",
                cross_lingual: true,
              },
              {
                question_id: "why-001",
                question: "なぜですか？",
                answer: "cost",
                category: "cat-3",
                slice: "why",
                cross_lingual: false,
              },
            ],
          },
        ])
      );

      writeFileSync(
        resultPath,
        JSON.stringify({
          records: [
            { sample_id: "sample-1", question_id: "current-001", category: "cat-1", em: 1, f1: 1 },
            { sample_id: "sample-1", question_id: "why-001", category: "cat-3", em: 0, f1: 0 },
          ],
        })
      );

      const report = buildJapaneseReleaseReport(datasetPath, resultPath);
      expect(report.summary.overall.count).toBe(2);
      expect(report.summary.overall.zero_f1_count).toBe(1);
      expect(report.summary.by_slice.current?.count).toBe(1);
      expect(report.summary.by_slice.why?.zero_f1_count).toBe(1);
      expect(report.summary.cross_lingual.count).toBe(1);
      expect(report.summary.cross_lingual.f1_avg).toBe(1);
      expect(report.summary.non_cross_lingual.count).toBe(1);
      expect(report.summary.missing_metadata).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
