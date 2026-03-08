import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function countQa(dataset: Array<{ qa?: Array<unknown> }>): number {
  return dataset.reduce((sum, sample) => sum + (sample.qa?.length || 0), 0);
}

describe("japanese release v2 fixtures", () => {
  test("v2 release pack expands to 96 QA with the expected slices", () => {
    const dataset = JSON.parse(
      readFileSync(join(process.cwd(), "tests", "benchmarks", "fixtures", "japanese-release-pack-96.json"), "utf8")
    ) as Array<{ qa?: Array<{ slice?: string }> }>;

    expect(countQa(dataset)).toBe(96);
    const slices = new Set(dataset.flatMap((sample) => (sample.qa || []).map((qa) => qa.slice || "unlabeled")));
    for (const slice of [
      "current",
      "current_vs_previous",
      "exact",
      "why",
      "list",
      "temporal",
      "relative_temporal",
      "yes_no",
      "noisy",
      "long_turn",
      "entity",
      "location",
    ]) {
      expect(slices.has(slice)).toBe(true);
    }
  });

  test("shadow JA pack keeps 24 QA as anonymized reality-check fixture", () => {
    const dataset = JSON.parse(
      readFileSync(join(process.cwd(), "tests", "benchmarks", "fixtures", "shadow-ja-pack-24.json"), "utf8")
    ) as Array<{ qa?: Array<unknown> }>;

    expect(dataset.length).toBe(12);
    expect(countQa(dataset)).toBe(24);
  });

  test("freeze script accepts dataset, artifact-dir, and label options", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "bench-freeze-ja-release.sh"), "utf8");
    expect(script).toContain("--dataset");
    expect(script).toContain("--artifact-dir");
    expect(script).toContain("--label");
  });
});
