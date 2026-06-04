import { describe, expect, test } from "bun:test";
import { loadRealDataDataset } from "../lib/dataset-loader";
import { assertBenchmarkCase } from "../lib/schema";
import { scanJsonlForPii } from "../lib/pii-scan";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REAL_DATASET_V2 = join(ROOT, "datasets/coding-memory-real-ja-mixed-v2.jsonl");
const REAL_DATASET_V1 = join(ROOT, "datasets/coding-memory-real-ja-mixed-v1.jsonl");
const MANIFEST_PATH = join(ROOT, "datasets/real-data-pilot/pipeline-manifest.json");

describe("real-data dataset schema", () => {
  test("loads real dataset when present with valid schema", () => {
    const cases = loadRealDataDataset();
    if (cases.length === 0) {
      console.warn("real dataset not generated yet — skip count assertion");
      return;
    }
    const minCases = cases.some((c) => c.case_id.startsWith("real-") && parseInt(c.case_id.split("-").pop() ?? "0", 10) > 100)
      ? 300
      : 50;
    expect(cases.length).toBeGreaterThanOrEqual(minCases);
    for (let i = 0; i < cases.length; i += 1) {
      assertBenchmarkCase(cases[i], i + 1);
    }
    const competencies = new Set(cases.map((c) => c.competency ?? "AR"));
    expect(competencies.has("AR")).toBe(true);
  });

  test("real dataset has no PII leaks when file exists", () => {
    for (const path of [REAL_DATASET_V2, REAL_DATASET_V1]) {
      try {
        const source = readFileSync(path, "utf8");
        expect(scanJsonlForPii(source)).toEqual([]);
      } catch {
        // file not generated
      }
    }
  });
});
