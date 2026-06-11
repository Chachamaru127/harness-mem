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

  test("committed s154-402 artifact resolves to keep for ruri and skip for bge-m3", () => {
    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
    const decisions = decideFromShadowAbArtifact(artifact, "multilingual-e5");
    const ruri = decisions.find((d) => d.candidate_model === "ruri-v3-30m");
    expect(ruri?.decision).toBe("keep");
    const bge = decisions.find((d) => d.candidate_model === "bge-m3");
    expect(bge?.decision).toBe("skip");
    expect(bge?.skip_reason).toContain("not_installed");
  });
});
