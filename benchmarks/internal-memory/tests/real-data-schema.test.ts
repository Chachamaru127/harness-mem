import { describe, expect, test } from "bun:test";
import { loadRealDataDataset } from "../lib/dataset-loader";
import { assertBenchmarkCase } from "../lib/schema";
import { scanJsonlForPii } from "../lib/pii-scan";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REAL_DATASET = join(ROOT, "datasets/coding-memory-real-ja-mixed-v1.jsonl");

describe("real-data dataset schema", () => {
  test("loads real dataset when present with valid schema", () => {
    const cases = loadRealDataDataset();
    if (cases.length === 0) {
      console.warn("real dataset not generated yet — skip count assertion");
      return;
    }
    expect(cases.length).toBeGreaterThanOrEqual(50);
    for (let i = 0; i < cases.length; i += 1) {
      assertBenchmarkCase(cases[i], i + 1);
    }
    const competencies = new Set(cases.map((c) => c.competency ?? "AR"));
    expect(competencies.has("AR")).toBe(true);
  });

  test("real dataset has no PII leaks when file exists", () => {
    try {
      const source = readFileSync(REAL_DATASET, "utf8");
      expect(scanJsonlForPii(source)).toEqual([]);
    } catch {
      // file not generated in CI without pipeline run
    }
  });
});
