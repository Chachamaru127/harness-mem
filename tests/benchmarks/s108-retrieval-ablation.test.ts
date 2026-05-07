import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runRetrievalAblation,
  type AblationResult,
  type QueryFamily,
  type VariantSummary,
} from "../../scripts/s108-retrieval-ablation";

const requiredFamilies: QueryFamily[] = [
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
];

function variantById(result: AblationResult, id: string): VariantSummary {
  const variant = result.variants.find((entry) => entry.id === id);
  expect(variant).toBeDefined();
  return variant!;
}

describe("S108 retrieval ablation harness", () => {
  test("smoke subset reports required metrics and explicit unavailable signals", () => {
    const { result } = runRetrievalAblation({
      smoke: true,
      writeArtifacts: false,
      now: new Date("2026-05-07T00:00:00.000Z"),
    });

    expect(result.schema_version).toBe("s108-retrieval-ablation.v1");
    expect(result.task_id).toBe("S108-003");
    expect(result.dataset.name).toBe("dev-workflow-60");
    expect(result.dataset.smoke_subset).toBe(true);
    expect(result.dataset.evaluated_cases).toBe(requiredFamilies.length);
    expect(result.dataset.families).toEqual([...requiredFamilies].sort());

    const lexical = variantById(result, "lexical");
    expect(lexical.status).toBe("available");
    expect(lexical.metrics?.overall.cases).toBe(requiredFamilies.length);
    expect(typeof lexical.metrics?.overall.recall_at_10).toBe("number");
    expect(typeof lexical.metrics?.overall.mrr).toBe("number");
    expect(typeof lexical.metrics?.overall.p95_ms).toBe("number");

    const full = variantById(result, "vector_full_baseline");
    expect(full.status).toBe("available");
    expect(full.toggles.vector).toBe(true);
    expect(full.toggles.graph).toBe(true);
    for (const family of requiredFamilies) {
      expect(full.metrics?.by_family[family]?.cases).toBe(1);
      expect(typeof full.metrics?.by_family[family]?.top_miss_reason === "string" ||
        full.metrics?.by_family[family]?.top_miss_reason === null).toBe(true);
    }

    const factChain = variantById(result, "fact_chain");
    expect(factChain.status).toBe("not_available");
    expect(factChain.metrics).toBeNull();
    expect(factChain.unavailable_reason).toContain("temporal persistence schema/core files");
  });

  test("full fixture evaluates all dev-workflow-60 cases without writing artifacts", () => {
    const { result } = runRetrievalAblation({ writeArtifacts: false });

    expect(result.dataset.total_cases).toBeGreaterThanOrEqual(60);
    expect(result.dataset.evaluated_cases).toBe(result.dataset.total_cases);
    for (const family of requiredFamilies) {
      expect(result.dataset.families).toContain(family);
    }

    const graph = variantById(result, "graph");
    expect(graph.metrics?.overall.cases).toBe(result.dataset.total_cases);
    expect(graph.metrics?.overall.recall_at_10).toBeGreaterThanOrEqual(0);
    expect(graph.metrics?.overall.recall_at_10).toBeLessThanOrEqual(1);
    expect(graph.metrics?.overall.mrr).toBeGreaterThanOrEqual(0);
    expect(graph.metrics?.overall.mrr).toBeLessThanOrEqual(1);
  });

  test("shell entry emits JSON and writes artifact files", () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "s108-retrieval-ablation-"));
    try {
      const proc = spawnSync("bash", [
        "scripts/s108-retrieval-ablation.sh",
        "--smoke",
        "--artifact-dir",
        artifactDir,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      expect(proc.status).toBe(0);
      const parsed = JSON.parse(proc.stdout) as AblationResult;
      expect(parsed.schema_version).toBe("s108-retrieval-ablation.v1");
      expect(parsed.dataset.smoke_subset).toBe(true);
      expect(parsed.artifacts.summary_json).toContain("summary.json");
      expect(existsSync(join(artifactDir, "summary.json"))).toBe(true);
      expect(existsSync(join(artifactDir, "case-results.json"))).toBe(true);
      expect(existsSync(join(artifactDir, "summary.md"))).toBe(true);

      const summary = JSON.parse(readFileSync(join(artifactDir, "summary.json"), "utf8")) as AblationResult;
      expect(summary.summary.best_available_variant).toBeTruthy();
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});
