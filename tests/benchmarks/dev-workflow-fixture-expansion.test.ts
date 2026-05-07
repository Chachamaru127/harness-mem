import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type DevWorkflowCase = {
  id: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  entries: Array<{ id: string; content: string; timestamp: string }>;
  query: string;
  expected_answer: string;
  relevant_ids: string[];
  query_family?: string;
  category?: string;
};

const root = process.cwd();
const basePath = join(root, "tests/benchmarks/fixtures/dev-workflow-20.json");
const expandedPath = join(root, "tests/benchmarks/fixtures/dev-workflow-60.json");
const artifactDir = join(root, "docs/benchmarks/artifacts/s108-dev-workflow-2026-05-07");

const requiredFamilies = [
  "file",
  "branch",
  "pr",
  "issue",
  "migration",
  "deploy",
  "failing_test",
  "release",
  "setup",
  "doctor",
  "companion",
] as const;

const baseFamilies: Record<string, (typeof requiredFamilies)[number]> = {
  "dw-001": "file",
  "dw-002": "failing_test",
  "dw-003": "failing_test",
  "dw-004": "migration",
  "dw-005": "setup",
  "dw-006": "failing_test",
  "dw-007": "setup",
  "dw-008": "issue",
  "dw-009": "release",
  "dw-010": "failing_test",
  "dw-011": "file",
  "dw-012": "setup",
  "dw-013": "issue",
  "dw-014": "pr",
  "dw-015": "setup",
  "dw-016": "migration",
  "dw-017": "release",
  "dw-018": "pr",
  "dw-019": "failing_test",
  "dw-020": "issue",
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function familyForCase(dwCase: DevWorkflowCase): string {
  return dwCase.query_family ?? baseFamilies[dwCase.id];
}

describe("S108 dev-workflow fixture expansion", () => {
  const baseCases = readJson<DevWorkflowCase[]>(basePath);
  const expandedCases = readJson<DevWorkflowCase[]>(expandedPath);

  test("contains 60+ QA cases and all required query families", () => {
    expect(expandedCases.length).toBeGreaterThanOrEqual(60);
    const families = new Set(expandedCases.map(familyForCase));
    for (const family of requiredFamilies) {
      expect(families.has(family)).toBe(true);
    }
  });

  test("preserves the existing dev-workflow-20 subset exactly as the prefix", () => {
    expect(baseCases.length).toBe(20);
    expect(expandedCases.slice(0, baseCases.length)).toEqual(baseCases);
  });

  test("has valid unique case and relevant entry ids", () => {
    const caseIds = new Set<string>();
    const entryIds = new Set<string>();
    for (const dwCase of expandedCases) {
      expect(caseIds.has(dwCase.id)).toBe(false);
      caseIds.add(dwCase.id);
      expect(dwCase.entries.length).toBeGreaterThanOrEqual(2);
      const localEntryIds = new Set(dwCase.entries.map((entry) => entry.id));
      for (const entry of dwCase.entries) {
        expect(entryIds.has(entry.id)).toBe(false);
        entryIds.add(entry.id);
        expect(entry.content.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
      }
      for (const relevantId of dwCase.relevant_ids) {
        expect(localEntryIds.has(relevantId)).toBe(true);
      }
    }
  });

  test("emits category distribution and backward comparison artifacts", () => {
    const distributionPath = join(artifactDir, "category-distribution.json");
    const backwardPath = join(artifactDir, "backward-comparison.json");
    const summaryPath = join(artifactDir, "summary.md");
    expect(existsSync(distributionPath)).toBe(true);
    expect(existsSync(backwardPath)).toBe(true);
    expect(existsSync(summaryPath)).toBe(true);

    const distribution = readJson<{
      total_cases: number;
      base_cases: number;
      new_cases: number;
      distribution: Record<string, number>;
      additions_by_family: Record<string, number>;
    }>(distributionPath);
    expect(distribution.total_cases).toBe(expandedCases.length);
    expect(distribution.base_cases).toBe(baseCases.length);
    expect(distribution.new_cases).toBe(expandedCases.length - baseCases.length);
    expect(
      Object.values(distribution.distribution).reduce((sum, value) => sum + value, 0)
    ).toBe(expandedCases.length);
    for (const family of requiredFamilies) {
      expect(distribution.distribution[family]).toBeGreaterThan(0);
      expect(distribution.additions_by_family[family]).toBeGreaterThan(0);
    }

    const backward = readJson<{
      exact_prefix_match: boolean;
      matched_cases: number;
      compared_cases: number;
    }>(backwardPath);
    expect(backward.exact_prefix_match).toBe(true);
    expect(backward.matched_cases).toBe(baseCases.length);
    expect(backward.compared_cases).toBe(baseCases.length);
  });
});
