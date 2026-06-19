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
  /**
   * S154-501: paired-bootstrap CI95 width of the composite delta. When
   * ciLowerBoundEnabled is true the effective switch threshold becomes
   * max(switchDeltaThreshold, ci95Width) — tightening only, never loosening.
   */
  ci95Width?: number;
  ciLowerBoundEnabled?: boolean;
}

export function effectiveSwitchThreshold(input: EmbeddingSwitchInput): number {
  if (!input.ciLowerBoundEnabled) {
    return input.switchDeltaThreshold;
  }
  if (!Number.isFinite(input.ci95Width)) {
    // Fail-closed: the CI gate was requested but the measurement carried no CI.
    throw new Error(
      `[s154-501] ci_lower_bound_enabled but CI95 width is not finite for ${input.candidateModel}: ${input.ci95Width}`,
    );
  }
  return Math.max(input.switchDeltaThreshold, input.ci95Width as number);
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
  const threshold = effectiveSwitchThreshold(input);

  const candidateActive = input.activeModel === input.candidateModel;
  if (candidateActive) {
    return input.compositeDelta < 0 ? "rollback" : "keep";
  }
  return input.compositeDelta >= threshold ? "switch" : "keep";
}

interface ShadowAbArtifactCandidate {
  model_id: string;
  /** v2: measurement configuration ("native" or e.g. "mrl-384"). */
  config?: string;
  status: "measured" | "skipped";
  skip_reason: string | null;
  comparisons: Array<{ metric: string; baseline: number; candidate: number; delta: number }>;
  composite_delta_ci95?: { width: number } | null;
}

interface ShadowAbArtifact {
  schema_version: string;
  baseline_model: string;
  candidates: ShadowAbArtifactCandidate[];
}

export interface ShadowAbDecision {
  candidate_model: string;
  config: string;
  decision: EmbeddingSwitchDecision | "skip";
  skip_reason: string | null;
  composite_delta: number | null;
  switch_delta_threshold: number;
  effective_threshold: number | null;
  ci95_width: number | null;
}

export function decideFromShadowAbArtifact(
  artifact: ShadowAbArtifact,
  activeModel: string,
  switchDeltaThreshold: number = loadCompositeScoreWeights().switchDeltaThreshold,
  ciLowerBoundEnabled: boolean = loadCompositeScoreWeights().ciLowerBoundEnabled,
): ShadowAbDecision[] {
  // S154-500: v1 artifacts are ceiling-saturated (baseline composite 0.96 ⇒
  // max delta +0.04 < threshold 0.05) and must not feed a switch decision.
  if (artifact.schema_version === "s154-402-embedding-shadow-ab.v1") {
    throw new Error(
      "[s154-403] v1 artifact rejected: the v1 fixtures are ceiling-saturated (switch is unreachable). Re-run scripts/s154-embedding-shadow-ab.ts to produce a v2 artifact.",
    );
  }
  if (artifact.schema_version !== "s154-402-embedding-shadow-ab.v2") {
    throw new Error(`[s154-403] unsupported artifact schema: ${artifact.schema_version}`);
  }

  return artifact.candidates.map((candidate) => {
    const config = candidate.config ?? "native";
    if (candidate.status !== "measured") {
      return {
        candidate_model: candidate.model_id,
        config,
        decision: "skip" as const,
        skip_reason: candidate.skip_reason ?? "not_measured",
        composite_delta: null,
        switch_delta_threshold: switchDeltaThreshold,
        effective_threshold: null,
        ci95_width: null,
      };
    }
    const composite = candidate.comparisons.find((row) => row.metric === "composite");
    if (!composite) {
      throw new Error(`[s154-403] measured candidate ${candidate.model_id} has no composite row`);
    }
    const ci95Width = candidate.composite_delta_ci95?.width;
    const input: EmbeddingSwitchInput = {
      baselineModel: artifact.baseline_model,
      activeModel,
      candidateModel: candidate.model_id,
      compositeDelta: composite.delta,
      switchDeltaThreshold,
      ci95Width,
      ciLowerBoundEnabled,
    };
    return {
      candidate_model: candidate.model_id,
      config,
      decision: decideEmbeddingSwitch(input),
      skip_reason: null,
      composite_delta: composite.delta,
      switch_delta_threshold: switchDeltaThreshold,
      effective_threshold: effectiveSwitchThreshold(input),
      ci95_width: Number.isFinite(ci95Width) ? (ci95Width as number) : null,
    };
  });
}
