import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDefaultDatasets, loadJsonlDataset } from "../lib/dataset-loader";
import { assertBenchmarkCase } from "../lib/schema";

const ROOT = join(import.meta.dir, "..");

describe("internal-memory dataset schema", () => {
  test("loads default datasets without validation errors", () => {
    const cases = loadDefaultDatasets();
    expect(cases.length).toBeGreaterThanOrEqual(19);
    expect(cases.some((row) => row.layer === "ja_coding")).toBe(true);
    expect(cases.some((row) => row.layer === "mixed_coding")).toBe(true);
  });

  test("rejects invalid layer", () => {
    expect(() => assertBenchmarkCase({ case_id: "x", layer: "bad" }, 1)).toThrow();
  });

  test("competitors manifest reproduces harness-mem only; others are published", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "competitors.manifest.json"), "utf8"),
    ) as { competitors: Array<{ id: string; measurement: string }> };
    const reproduced = manifest.competitors
      .filter((row) => row.measurement === "reproduced")
      .map((row) => row.id);
    const published = manifest.competitors
      .filter((row) => row.measurement === "published")
      .map((row) => row.id);
    expect(reproduced).toEqual(["harness-mem"]);
    expect(published).toContain("agentmemory");
    expect(published).toContain("supermemory");
    expect(published).toContain("claude-mem");
    const agentmemory = manifest.competitors.find((row) => row.id === "agentmemory") as {
      live_opt_in_env?: string[];
    };
    expect(agentmemory?.live_opt_in_env).toEqual(["AGENTMEMORY_URL", "AGENTMEMORY_SECRET"]);
  });

  test("ja-mixed dataset includes required categories", () => {
    const cases = loadJsonlDataset("datasets/coding-memory-ja-mixed-v1.jsonl");
    const categories = new Set(cases.map((row) => row.category));
    expect(categories.has("ja_requirements")).toBe(true);
    expect(categories.has("mixed_symbol")).toBe(true);
    expect(categories.has("project_boundary")).toBe(true);
    expect(categories.has("handoff_resume")).toBe(true);
    expect(categories.has("conflict_resolution")).toBe(true);
    expect(categories.has("test_time_learning")).toBe(true);
  });

  test("rejects invalid competency", () => {
    expect(() =>
      assertBenchmarkCase(
        {
          case_id: "x",
          layer: "ja_coding",
          category: "test",
          competency: "bad",
          language_profile: "ja",
          project: "p",
          memories: [{ id: "m1", content: "c" }],
          query: "q",
          relevant_ids: ["m1"],
        },
        1,
      ),
    ).toThrow(/invalid competency/);
  });
});
