import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type TemporalFocus =
  | "current"
  | "previous"
  | "after"
  | "before"
  | "first"
  | "latest"
  | "still"
  | "no_longer"
  | "直後"
  | "今も"
  | "以前";

interface TemporalCase {
  id: string;
  temporal_focus: TemporalFocus;
  slice: string;
  query_language: "en" | "ja";
  query: string;
  expected_answer: string;
  expected_answer_entry_id: string;
  expected_order: string[];
  entries: Array<{ id: string; content: string; timestamp: string }>;
}

interface MetricSummary {
  count: number;
  f1_avg: number;
  zero_f1_count: number;
  anchor_hit_rate: number;
}

interface Summary {
  schema_version: "s108-temporal-expansion-v1";
  task_id: "S108-006";
  fixture: { case_count: number; path: string };
  required_focus_counts: Record<TemporalFocus, number>;
  rollup_slice_counts: Record<string, number>;
  initial_probe: {
    by_rollup_slice: Record<string, MetricSummary>;
  };
  follow_up_gaps_for_s108_007: string[];
}

const FIXTURE_PATH = join(process.cwd(), "tests", "benchmarks", "fixtures", "temporal-s108-expanded.json");
const SUMMARY_PATH = join(
  process.cwd(),
  "docs",
  "benchmarks",
  "artifacts",
  "s108-temporal-expansion-2026-05-07",
  "summary.json"
);

const REQUIRED_FOCI: TemporalFocus[] = [
  "current",
  "previous",
  "after",
  "before",
  "first",
  "latest",
  "still",
  "no_longer",
  "直後",
  "今も",
  "以前",
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("S108-006 temporal fixture expansion", () => {
  test("fixture expands temporal QA beyond 50 cases and separates required focus terms", () => {
    expect(existsSync(FIXTURE_PATH)).toBe(true);
    const cases = readJson<TemporalCase[]>(FIXTURE_PATH);

    expect(cases.length).toBeGreaterThanOrEqual(50);
    const counts = new Map<TemporalFocus, number>();
    for (const testCase of cases) {
      counts.set(testCase.temporal_focus, (counts.get(testCase.temporal_focus) || 0) + 1);
    }

    for (const focus of REQUIRED_FOCI) {
      expect(counts.get(focus) || 0).toBeGreaterThanOrEqual(1);
    }
  });

  test("each temporal case keeps answer and order anchors resolvable from entries", () => {
    const cases = readJson<TemporalCase[]>(FIXTURE_PATH);

    for (const testCase of cases) {
      const entryIds = new Set(testCase.entries.map((entry) => entry.id));
      expect(entryIds.has(testCase.expected_answer_entry_id)).toBe(true);
      expect(testCase.expected_answer.trim().length).toBeGreaterThan(0);
      expect(testCase.expected_order.length).toBeGreaterThanOrEqual(3);
      for (const orderedId of testCase.expected_order) {
        expect(entryIds.has(orderedId)).toBe(true);
      }
    }
  });

  test("Japanese relative/current/previous queries are explicit", () => {
    const cases = readJson<TemporalCase[]>(FIXTURE_PATH);
    const japaneseCases = cases.filter((testCase) => testCase.query_language === "ja");

    expect(japaneseCases.length).toBeGreaterThanOrEqual(18);
    expect(japaneseCases.some((testCase) => testCase.query.includes("直後"))).toBe(true);
    expect(japaneseCases.some((testCase) => testCase.query.includes("今も"))).toBe(true);
    expect(japaneseCases.some((testCase) => testCase.query.includes("以前"))).toBe(true);
  });

  test("artifact records rollup counts, initial F1/zero-F1, and S108-007 gaps", () => {
    expect(existsSync(SUMMARY_PATH)).toBe(true);
    const summary = readJson<Summary>(SUMMARY_PATH);

    expect(summary.schema_version).toBe("s108-temporal-expansion-v1");
    expect(summary.task_id).toBe("S108-006");
    expect(summary.fixture.case_count).toBeGreaterThanOrEqual(50);

    for (const rollup of ["current", "previous", "relative", "yes_no"]) {
      expect(summary.rollup_slice_counts[rollup]).toBeGreaterThan(0);
      expect(summary.initial_probe.by_rollup_slice[rollup].count).toBe(summary.rollup_slice_counts[rollup]);
      expect(summary.initial_probe.by_rollup_slice[rollup].f1_avg).toBeGreaterThanOrEqual(0);
      expect(summary.initial_probe.by_rollup_slice[rollup].zero_f1_count).toBeGreaterThanOrEqual(0);
    }

    expect(summary.follow_up_gaps_for_s108_007.length).toBeGreaterThanOrEqual(3);
    expect(summary.follow_up_gaps_for_s108_007.join("\n")).toContain("valid_from");
  });
});
