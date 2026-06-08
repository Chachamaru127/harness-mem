import type { ScoredCaseResult } from "../lib/types";
export type { FreshnessGroundTruth } from "../lib/types";

/**
 * S154-301: Deep freshness scorers — the "did the system stop returning the old
 * value after it was overturned?" axis. These are SEPARATE from the shallow
 * freshness gate (current_stale_answer_regressions). They measure temporal
 * correctness, not just "can the latest value be retrieved".
 *
 * Each metric needs per-case temporal ground truth on the result row
 * (`freshness_truth`, populated by score-case.ts from memory metadata). A run
 * whose cases carry no such ground truth returns `undefined` for every metric —
 * the diagnostic field is present but null, never fabricated.
 *
 * bi-temporal columns are the IMPLEMENTATION that produces this ground truth;
 * they are deliberately NOT a measurement axis here (D25/D26 neutral evidence).
 *
 * Gate note (D2): these are diagnostics. A gate (154-305) must measure a held-out
 * slice and must NOT use a self-seeded perfect score as the threshold.
 */

/**
 * Supersession precision = superseded relation respected.
 *   numerator   = eligible cases where NONE of the superseded ids leak into retrieved_ids
 *   denominator = cases declaring >= 1 superseded id
 * Returns undefined when no eligible case exists.
 */
export function supersessionPrecision(results: ScoredCaseResult[]): number | undefined {
  const eligible = results.filter(
    (r) => r.status === "ok" && (r.freshness_truth?.superseded_ids?.length ?? 0) > 0,
  );
  if (eligible.length === 0) return undefined;
  const clean = eligible.filter((r) => {
    const retrieved = new Set(r.retrieved_ids);
    return r.freshness_truth!.superseded_ids!.every((id) => !retrieved.has(id));
  });
  return clean.length / eligible.length;
}

/**
 * Tense-rewrite accuracy = old-tense value excluded AND the fresh value retrieved.
 *   numerator   = eligible cases where no stale_tense id is in retrieved_ids
 *                 AND recall_at_10 === 1 (all relevant/fresh ids are in top-10)
 *   denominator = cases declaring >= 1 stale_tense id
 * Returns undefined when no eligible case exists.
 */
export function tenseRewriteAccuracy(results: ScoredCaseResult[]): number | undefined {
  const eligible = results.filter(
    (r) => r.status === "ok" && (r.freshness_truth?.stale_tense_ids?.length ?? 0) > 0,
  );
  if (eligible.length === 0) return undefined;
  const correct = eligible.filter((r) => {
    const retrieved = new Set(r.retrieved_ids);
    const staleExcluded = r.freshness_truth!.stale_tense_ids!.every((id) => !retrieved.has(id));
    const freshRetrieved = r.recall_at_10 >= 1;
    return staleExcluded && freshRetrieved;
  });
  return correct.length / eligible.length;
}

/**
 * Freshness delay (ms) = mean lag from invalidation to the system clearing a stale value.
 *   delay(id) = stale_cleared_at[id] - invalidated_at[id]
 * Longitudinal by nature: a single static retrieval snapshot carries no
 * stale_cleared_at, so this is undefined until 154-303 longitudinal runs supply it.
 * Returns undefined when no id carries both timestamps.
 */
export function freshnessDelayMs(results: ScoredCaseResult[]): number | undefined {
  const deltas: number[] = [];
  for (const r of results) {
    const truth = r.freshness_truth;
    if (!truth?.invalidated_at || !truth.stale_cleared_at) continue;
    for (const id of Object.keys(truth.invalidated_at)) {
      const invalidated = Date.parse(truth.invalidated_at[id]);
      const clearedRaw = truth.stale_cleared_at[id];
      const cleared = clearedRaw ? Date.parse(clearedRaw) : Number.NaN;
      if (Number.isFinite(invalidated) && Number.isFinite(cleared)) {
        deltas.push(cleared - invalidated);
      }
    }
  }
  if (deltas.length === 0) return undefined;
  return deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
}
