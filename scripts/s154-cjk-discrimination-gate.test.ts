/**
 * S154-152: CJK discrimination gate unit + e2e tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decideAbGeneric } from "./s154-coding-memory-ab-gate";
import {
  aggregateSliceMetrics,
  assertFtsPath,
  evaluateOverallPassed,
  reciprocalRank,
  runCjkDiscriminationGate,
  type CaseResult,
  type VariantResult,
} from "./s154-cjk-discrimination-gate";

const FIXTURE = resolve(process.cwd(), "tests/benchmarks/fixtures/cjk-discrimination.json");

describe("S154-152 decideAbGeneric() for CJK metrics", () => {
  test("nfkc slice all metrics rise → improved", () => {
    const baseline = { recall: 0, top1: 0, mrr: 0 };
    const candidate = { recall: 1, top1: 1, mrr: 1 };
    const { decision } = decideAbGeneric(baseline, candidate, ["recall", "top1", "mrr"], 0.02, 0.02);
    expect(decision).toBe("improved");
  });

  test("flat orthographic slice → neutral", () => {
    const baseline = { recall: 0.25, top1: 0.25, mrr: 0.3 };
    const candidate = { recall: 0.25, top1: 0.25, mrr: 0.3 };
    const { decision } = decideAbGeneric(baseline, candidate, ["recall", "top1", "mrr"], 0.02, 0.02);
    expect(decision).toBe("neutral");
  });

  test("reciprocalRank uses id position only", () => {
    expect(reciprocalRank(["obs_a", "obs_b"], "obs_b")).toBe(0.5);
    expect(reciprocalRank(["obs_a"], "obs_missing")).toBe(0);
  });

  test("aggregateSliceMetrics averages recall/top1/mrr", () => {
    const cases: CaseResult[] = [
      {
        case_id: "a",
        slice: "nfkc_fixable",
        expected_observation_id: "obs_a",
        retrieved_ids: ["obs_a"],
        recall: true,
        top1: true,
        mrr: 1,
        latency_ms: 1,
      },
      {
        case_id: "b",
        slice: "nfkc_fixable",
        expected_observation_id: "obs_b",
        retrieved_ids: ["obs_x", "obs_b"],
        recall: true,
        top1: false,
        mrr: 0.5,
        latency_ms: 1,
      },
    ];
    expect(aggregateSliceMetrics(cases)).toEqual({ recall: 1, top1: 0.5, mrr: 0.75 });
  });

  test("assertFtsPath requires fts-enabled search contract", () => {
    expect(
      assertFtsPath(
        {
          limit: 26,
          vector_search: false,
          graph_weight: 0,
          expand_links: false,
          include_private: true,
          strict_project: true,
        },
        true,
      ),
    ).toBe(true);
    expect(
      assertFtsPath(
        {
          limit: 25,
          vector_search: false,
          graph_weight: 0,
          expand_links: false,
          include_private: true,
          strict_project: true,
        },
        true,
      ),
    ).toBe(false);
  });
});

describe("S154-152 runCjkDiscriminationGate() e2e", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      HARNESS_MEM_DISABLE_CJK_NORMALIZE: process.env.HARNESS_MEM_DISABLE_CJK_NORMALIZE,
      HARNESS_MEM_LEXICAL_BOOST: process.env.HARNESS_MEM_LEXICAL_BOOST,
      HARNESS_MEM_DUAL_QUERY: process.env.HARNESS_MEM_DUAL_QUERY,
    };
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("baseline OFF has nfkc 0; candidate ON improves nfkc; orthographic neutral; fts asserted", async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "s154-cjk-gate-"));
    try {
      const result = await runCjkDiscriminationGate({
        fixturePath: FIXTURE,
        artifactDir,
        writeArtifacts: false,
      });

      expect(result.variants.baseline.per_slice.nfkc_fixable).toEqual({
        recall: 0,
        top1: 0,
        mrr: 0,
      });
      expect(result.decision.nfkc_fixable).toBe("improved");
      expect(result.decision.non_nfkc_orthographic).toBe("neutral");
      expect(result.variants.baseline.search_request.vector_search).toBe(false);
      expect(result.variants.candidate.search_request.vector_search).toBe(false);
      expect(result.fts_path_asserted).toBe(true);
      expect(result.overall_passed).toBe(true);

      for (const entry of result.per_case) {
        expect(entry.expected_observation_id.startsWith("obs_")).toBe(true);
        expect(entry.retrieved_ids.every((id) => id.startsWith("obs_"))).toBe(true);
      }
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  }, 120_000);

  test("CLI emits complete parseable JSON when stdout is piped", () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "run", "scripts/s154-cjk-discrimination-gate.ts", "--no-write"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    expect(stderr).toBe("");

    const parsed = JSON.parse(stdout) as { overall_passed?: boolean; fts_path_asserted?: boolean };
    expect(parsed.overall_passed).toBe(true);
    expect(parsed.fts_path_asserted).toBe(true);
  }, 120_000);

  test("candidate-env lexical boost improves only the non-NFKC orthographic slice", async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "s154-cjk-gate-"));
    try {
      const result = await runCjkDiscriminationGate({
        fixturePath: FIXTURE,
        artifactDir,
        writeArtifacts: false,
        candidateEnv: { HARNESS_MEM_LEXICAL_BOOST: "1" },
        requireImproved: true,
      });

      expect(result.overall_passed).toBe(true);
      expect(result.decision.nfkc_fixable).toBe("neutral");
      expect(result.decision.non_nfkc_orthographic).toBe("improved");
      expect(result.variants.candidate.env).toEqual({
        HARNESS_MEM_DISABLE_CJK_NORMALIZE: "1",
        HARNESS_MEM_LEXICAL_BOOST: "1",
        HARNESS_MEM_DUAL_QUERY: null,
      });
      expect(result.variants.candidate.per_slice.non_nfkc_orthographic).toEqual({
        recall: 1,
        top1: 1,
        mrr: 1,
      });
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("S154-152 evaluateOverallPassed()", () => {
  function variant(overrides: Partial<VariantResult>): VariantResult {
    return {
      label: "baseline",
      env: {},
      per_case: [],
      per_slice: {
        nfkc_fixable: { recall: 0, top1: 0, mrr: 0 },
        non_nfkc_orthographic: { recall: 0.25, top1: 0.25, mrr: 0.25 },
      },
      fts_path_asserted: true,
      search_request: {
        limit: 26,
        vector_search: false,
        graph_weight: 0,
        expand_links: false,
        include_private: true,
        strict_project: true,
      },
      ...overrides,
    };
  }

  test("passes only when nfkc baseline is zero and slice decisions match", () => {
    const baseline = variant({});
    const candidate = variant({
      label: "candidate",
      per_slice: {
        nfkc_fixable: { recall: 1, top1: 1, mrr: 1 },
        non_nfkc_orthographic: { recall: 0.25, top1: 0.25, mrr: 0.25 },
      },
    });
    const sliceDecisions = {
      nfkc_fixable: {
        slice: "nfkc_fixable" as const,
        metrics: [],
        decision: "improved" as const,
        decision_reason: "ok",
      },
      non_nfkc_orthographic: {
        slice: "non_nfkc_orthographic" as const,
        metrics: [],
        decision: "neutral" as const,
        decision_reason: "ok",
      },
    };
    expect(evaluateOverallPassed(baseline, candidate, sliceDecisions)).toBe(true);
  });
});
