import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLocomoFailureBacklog } from "./locomo-failure-backlog";

describe("LOCOMO failure backlog", () => {
  test("extracts top failures and tags improvement areas", () => {
    const dir = mkdtempSync(join(tmpdir(), "locomo-failures-"));
    try {
      const resultPath = join(dir, "result.json");
      const judgePath = join(dir, "judge.json");
      writeFileSync(
        resultPath,
        JSON.stringify({
          records: [
            {
              sample_id: "conv-1",
              question_id: "q1",
              category: "cat-2",
              question: "When did she move?",
              answer: "May 2023",
              prediction: "I think she moved recently.",
              em: 0,
              f1: 0,
            },
            {
              sample_id: "conv-1",
              question_id: "q2",
              category: "cat-1",
              question: "Where did she move?",
              answer: "Seattle",
              prediction: "Seattle",
              em: 1,
              f1: 1,
            },
          ],
        })
      );
      writeFileSync(
        judgePath,
        JSON.stringify({
          items: [
            {
              sample_id: "conv-1",
              question_id: "q1",
              category: "cat-2",
              label: "WRONG",
            },
          ],
        })
      );

      const backlog = buildLocomoFailureBacklog({
        resultPath,
        judgePath,
        limit: 100,
      });

      expect(backlog.summary.selected_failures).toBe(1);
      expect(backlog.failures[0]?.question_id).toBe("q1");
      expect(backlog.failures[0]?.judge_label).toBe("WRONG");
      expect(backlog.failures[0]?.improvement_tags).toContain("temporal_normalization");
      expect(backlog.summary.by_tag.temporal_normalization).toBeGreaterThan(0);
      expect(backlog.review_evidence_spec.required_artifacts.length).toBeGreaterThan(0);
      expect(backlog.review_evidence_spec.comparison_requirements).toContain("same dataset path");
      expect(backlog.improvement_tickets.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
