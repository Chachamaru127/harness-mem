/**
 * S154-403: deterministic embedding switch decision.
 *
 * Inputs are the S154-402 shadow A/B artifact (fixed {metric, baseline,
 * candidate, delta} schema) and the S154-400 composite-score config constants.
 * The decision is a pure 3-branch function — no heuristics, no human gate:
 *
 *   switch   — incumbent is active and the candidate's composite delta clears
 *              switchDeltaThreshold (a clear win justifying the ~14GB re-index)
 *   rollback — the candidate is already active but its measured composite has
 *              regressed below the incumbent (delta < 0)
 *   keep     — everything else (no churn inside the hysteresis band)
 *
 * Non-finite deltas throw (fail-closed): a missing measurement must surface,
 * never silently resolve to a branch (decisions.md D29/D40).
 */

import { loadCompositeScoreWeights } from "./adaptive-config";

export type EmbeddingSwitchDecision = "switch" | "keep" | "rollback";

export interface EmbeddingSwitchInput {
  baselineModel: string;
  activeModel: string;
  candidateModel: string;
  compositeDelta: number;
  switchDeltaThreshold: number;
}

export function decideEmbeddingSwitch(input: EmbeddingSwitchInput): EmbeddingSwitchDecision {
  if (!Number.isFinite(input.compositeDelta)) {
    throw new Error(
      `[s154-403] composite delta is not finite for ${input.candidateModel}: ${input.compositeDelta}`,
    );
  }
  if (!Number.isFinite(input.switchDeltaThreshold) || input.switchDeltaThreshold < 0) {
    throw new Error(`[s154-403] invalid switch delta threshold: ${input.switchDeltaThreshold}`);
  }

  const candidateActive = input.activeModel === input.candidateModel;
  if (candidateActive) {
    return input.compositeDelta < 0 ? "rollback" : "keep";
  }
  return input.compositeDelta >= input.switchDeltaThreshold ? "switch" : "keep";
}

interface ShadowAbArtifactCandidate {
  model_id: string;
  status: "measured" | "skipped";
  skip_reason: string | null;
  comparisons: Array<{ metric: string; baseline: number; candidate: number; delta: number }>;
}

interface ShadowAbArtifact {
  schema_version: string;
  baseline_model: string;
  candidates: ShadowAbArtifactCandidate[];
}

export interface ShadowAbDecision {
  candidate_model: string;
  decision: EmbeddingSwitchDecision | "skip";
  skip_reason: string | null;
  composite_delta: number | null;
  switch_delta_threshold: number;
}

export function decideFromShadowAbArtifact(
  artifact: ShadowAbArtifact,
  activeModel: string,
  switchDeltaThreshold: number = loadCompositeScoreWeights().switchDeltaThreshold,
): ShadowAbDecision[] {
  if (artifact.schema_version !== "s154-402-embedding-shadow-ab.v1") {
    throw new Error(`[s154-403] unsupported artifact schema: ${artifact.schema_version}`);
  }

  return artifact.candidates.map((candidate) => {
    if (candidate.status !== "measured") {
      return {
        candidate_model: candidate.model_id,
        decision: "skip" as const,
        skip_reason: candidate.skip_reason ?? "not_measured",
        composite_delta: null,
        switch_delta_threshold: switchDeltaThreshold,
      };
    }
    const composite = candidate.comparisons.find((row) => row.metric === "composite");
    if (!composite) {
      throw new Error(`[s154-403] measured candidate ${candidate.model_id} has no composite row`);
    }
    return {
      candidate_model: candidate.model_id,
      decision: decideEmbeddingSwitch({
        baselineModel: artifact.baseline_model,
        activeModel,
        candidateModel: candidate.model_id,
        compositeDelta: composite.delta,
        switchDeltaThreshold,
      }),
      skip_reason: null,
      composite_delta: composite.delta,
      switch_delta_threshold: switchDeltaThreshold,
    };
  });
}
