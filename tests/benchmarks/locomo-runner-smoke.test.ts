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
});
