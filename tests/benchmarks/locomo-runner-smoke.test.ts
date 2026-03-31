import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLocomoBenchmark } from "./run-locomo-benchmark";

describe("LOCOMO runner smoke", () => {
  test("runs harness-mem benchmark and writes JSON output", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "locomo-runner-"));
    const fixturePath = join(process.cwd(), "tests", "benchmarks", "fixtures", "locomo10.sample.json");
    const outputPath = join(tempDir, "locomo-result.json");
    try {
      const result = await runLocomoBenchmark({
        system: "harness-mem",
        datasetPath: fixturePath,
        outputPath,
        onnxGate: false,
      });

      expect(result.schema_version).toBe("locomo-benchmark-v2");
      expect(result.system).toBe("harness-mem");
      expect(result.metrics.overall.count).toBeGreaterThan(0);
      expect(result.performance.search_latency_ms.p95).toBeGreaterThanOrEqual(0);
      expect(result.cost.search_token_estimate.total_avg).toBeGreaterThan(0);
      expect(result.records[0]?.answer_trace?.extraction?.selected_candidates?.length || 0).toBeGreaterThan(0);
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fails fast when dataset contains empty gold answers", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "locomo-runner-"));
    const datasetPath = join(tempDir, "broken-locomo.json");
    try {
      writeFileSync(
        datasetPath,
        JSON.stringify([
          {
            sample_id: "sample-1",
            conversation: [{ speaker: "user", text: "hello" }],
            qa: [{ question_id: "q1", question: "q", answer: "", category: "cat-1" }],
          },
        ])
      );

      await expect(
        runLocomoBenchmark({
          system: "harness-mem",
          datasetPath,
        })
      ).rejects.toThrow("empty answer");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("isolates samples from each other during benchmark replay", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "locomo-runner-isolation-"));
    const datasetPath = join(tempDir, "isolation-locomo.json");
    try {
      writeFileSync(
        datasetPath,
        JSON.stringify([
          {
            sample_id: "sample-a",
            conversation: [
              { speaker: "user", text: "定期メンテナンスは以前 01:00 JST 開始でした。" },
              { speaker: "assistant", text: "今は 03:30 JST 開始です。" },
            ],
            qa: [{ question_id: "q1", question: "以前の開始時刻は何時でしたか？", answer: "01:00 JST", category: "cat-2" }],
          },
          {
            sample_id: "sample-b",
            conversation: [
              { speaker: "user", text: "Starter プランは以前 29 dollars a month でした。" },
              { speaker: "assistant", text: "今は 39 dollars a month です。" },
            ],
            qa: [{ question_id: "q1", question: "以前の料金はいくらでしたか？", answer: "29 dollars a month", category: "cat-2" }],
          },
        ])
      );

      const result = await runLocomoBenchmark({
        system: "harness-mem",
        datasetPath,
        onnxGate: false,
      });

      const startTime = result.records.find((record) => record.sample_id === "sample-a");
      const previousPrice = result.records.find((record) => record.sample_id === "sample-b");
      expect(startTime?.prediction).toBe("01:00 JST");
      expect(previousPrice?.prediction).toContain("29 dollars a month");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
