import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideEmbeddingSwitch,
  decideFromShadowAbArtifact,
} from "../../src/embedding/switch-decision";

const THRESHOLD = 0.05;
const ARTIFACT_PATH = join(
  import.meta.dir,
  "../../../docs/benchmarks/artifacts/s154-embedding-shadow-ab/summary.json",
);

describe("S154-403 embedding switch decision (deterministic 3-branch)", () => {
  test("switch: incumbent active and composite delta clears the threshold", () => {
    expect(
      decideEmbeddingSwitch({
        baselineModel: "multilingual-e5",
        activeModel: "multilingual-e5",
        candidateModel: "ruri-v3-30m",
        compositeDelta: THRESHOLD,
        switchDeltaThreshold: THRESHOLD,
      }),
    ).toBe("switch");
  });

  test("keep: incumbent active and delta below the threshold", () => {
    expect(
      decideEmbeddingSwitch({
        baselineModel: "multilingual-e5",
        activeModel: "multilingual-e5",
        candidateModel: "ruri-v3-30m",
        compositeDelta: THRESHOLD - 0.001,
        switchDeltaThreshold: THRESHOLD,
      }),
    ).toBe("keep");
  });

  test("rollback: candidate already active but composite regressed below baseline", () => {
    expect(
      decideEmbeddingSwitch({
        baselineModel: "multilingual-e5",
        activeModel: "ruri-v3-30m",
        candidateModel: "ruri-v3-30m",
        compositeDelta: -0.01,
        switchDeltaThreshold: THRESHOLD,
      }),
    ).toBe("rollback");
  });

  test("keep: candidate active and non-negative delta does not churn", () => {
    expect(
      decideEmbeddingSwitch({
        baselineModel: "multilingual-e5",
        activeModel: "ruri-v3-30m",
        candidateModel: "ruri-v3-30m",
        compositeDelta: 0.02,
        switchDeltaThreshold: THRESHOLD,
      }),
    ).toBe("keep");
  });

  test("fail-closed: non-finite delta throws instead of silently deciding", () => {
    expect(() =>
      decideEmbeddingSwitch({
        baselineModel: "multilingual-e5",
        activeModel: "multilingual-e5",
        candidateModel: "ruri-v3-30m",
        compositeDelta: Number.NaN,
        switchDeltaThreshold: THRESHOLD,
      }),
    ).toThrow();
  });

  test("S154-500: v1 artifacts are rejected (ceiling-saturated fixtures cannot feed a switch)", () => {
    const v1Artifact = {
      schema_version: "s154-402-embedding-shadow-ab.v1",
      baseline_model: "multilingual-e5",
      candidates: [],
    };
    expect(() => decideFromShadowAbArtifact(v1Artifact, "multilingual-e5")).toThrow(/ceiling-saturated/);
  });

  test("committed s154-402 artifact decides without error (v2 schema)", () => {
    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
    if (artifact.schema_version === "s154-402-embedding-shadow-ab.v1") {
      // Pre-505 committed artifact: the v1 reject path is the contract.
      expect(() => decideFromShadowAbArtifact(artifact, "multilingual-e5")).toThrow(/ceiling-saturated/);
      return;
    }
    const decisions = decideFromShadowAbArtifact(artifact, "multilingual-e5");
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      expect(["switch", "keep", "rollback", "skip"]).toContain(decision.decision);
      expect(typeof decision.config).toBe("string");
      if (decision.decision === "skip") {
        expect(decision.skip_reason).toBeTruthy();
      } else {
        expect(Number.isFinite(decision.composite_delta)).toBe(true);
        expect(Number.isFinite(decision.effective_threshold)).toBe(true);
      }
    }
  });

  test("synthetic v2 artifact: measured keep + skipped candidate resolve with config labels", () => {
    const artifact = {
      schema_version: "s154-402-embedding-shadow-ab.v2",
      baseline_model: "multilingual-e5",
      candidates: [
        {
          model_id: "qwen3-embedding-0.6b",
          config: "mrl-384",
          status: "measured" as const,
          skip_reason: null,
          comparisons: [{ metric: "composite", baseline: 0.7, candidate: 0.72, delta: 0.02 }],
          composite_delta_ci95: { width: 0.03 },
        },
        {
          model_id: "granite-embedding-311m-r2",
          config: "native",
          status: "skipped" as const,
          skip_reason: "model_not_installed:granite-embedding-311m-r2",
          comparisons: [],
          composite_delta_ci95: null,
        },
      ],
    };
    const decisions = decideFromShadowAbArtifact(artifact, "multilingual-e5", THRESHOLD, false);
    expect(decisions[0].decision).toBe("keep");
    expect(decisions[0].config).toBe("mrl-384");
    expect(decisions[0].ci95_width).toBe(0.03);
    expect(decisions[1].decision).toBe("skip");
  });

  describe("S154-501: CI lower bound (tightening only, flag-gated)", () => {
    const base = {
      baselineModel: "multilingual-e5",
      activeModel: "multilingual-e5",
      candidateModel: "qwen3-embedding-0.6b",
      switchDeltaThreshold: THRESHOLD,
    };

    test("flag off: delta >= 0.05 switches even with a wide CI", () => {
      expect(
        decideEmbeddingSwitch({ ...base, compositeDelta: 0.06, ci95Width: 0.2, ciLowerBoundEnabled: false }),
      ).toBe("switch");
    });

    test("flag on: CI width above the delta blocks the switch (noise cannot trigger re-index)", () => {
      expect(
        decideEmbeddingSwitch({ ...base, compositeDelta: 0.06, ci95Width: 0.2, ciLowerBoundEnabled: true }),
      ).toBe("keep");
    });

    test("flag on: delta clearing max(threshold, CI width) still switches", () => {
      expect(
        decideEmbeddingSwitch({ ...base, compositeDelta: 0.09, ci95Width: 0.08, ciLowerBoundEnabled: true }),
      ).toBe("switch");
    });

    test("flag on: the 0.05 floor never loosens even when the CI is narrow", () => {
      expect(
        decideEmbeddingSwitch({ ...base, compositeDelta: 0.03, ci95Width: 0.01, ciLowerBoundEnabled: true }),
      ).toBe("keep");
    });

    test("fail-closed: flag on without a CI measurement throws", () => {
      expect(() =>
        decideEmbeddingSwitch({ ...base, compositeDelta: 0.06, ciLowerBoundEnabled: true }),
      ).toThrow(/CI95 width is not finite/);
    });
  });
});
