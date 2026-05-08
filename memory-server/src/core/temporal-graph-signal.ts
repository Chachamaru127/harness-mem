/**
 * temporal-graph-signal.ts  (S108-014, env-gated PoC)
 *
 * Local temporal-graph signal — adds a small additive bonus to search scoring
 * based on the relations attached to each candidate observation.
 *
 * Reads `mem_relations.kind`, `strength`, `valid_from`, `valid_to`,
 * `invalidated_at`, and `supersedes` (already shipped via S108-007). Does NOT
 * require any schema changes — purely a read-side scoring blender.
 *
 * Design (per docs/benchmarks/temporal-graph-selective-import-2026-05-07.md):
 *   - Adopt items #1, #3, #4, #5, #9, #10 from the design table.
 *   - Defer items #6, #11. Reject #7, #8, #12.
 *
 * Disabled by default. Enable with `HARNESS_MEM_TEMPORAL_GRAPH=1` for A/B.
 *
 * Caller integrates the returned per-candidate score into the linear blend at
 * the same layer as `proximityAdj` in observation-store.ts. The bonus is
 * intentionally small so a misconfigured PoC cannot wash out the existing
 * default ranking.
 */

import type { Database } from "bun:sqlite";

/** Default weight applied to the temporal-graph bonus in the score blender. */
export const DEFAULT_TEMPORAL_GRAPH_WEIGHT = 0.05;

/** Hard cap on the per-candidate signal in the [-MAX, +MAX] range. */
const MAX_BONUS = 1.0;
const MAX_PENALTY = -0.5;

/**
 * Relation-kind base weights. Reflects the design table semantics:
 *   - "updates" / "supersedes": newer wins (positive)
 *   - "contradicts": indicates the candidate is being contradicted (penalty)
 *   - "causes" / "enables": positive but weaker
 *   - "is_a" / "depends_on": neutral-ish positive
 *   - others: small default positive
 *
 * Centralized so the gate logic in S108-015 can A/B-tune from one place.
 */
const RELATION_KIND_WEIGHTS: Record<string, number> = {
  updates: 1.0,
  supersedes: 1.0,
  superseded: -0.8,
  contradicts: -0.5,
  contradicted: -0.5,
  causes: 0.3,
  enables: 0.3,
  is_a: 0.2,
  depends_on: 0.2,
};

const DEFAULT_KIND_WEIGHT = 0.1;

interface RelationRow {
  kind: string;
  strength: number | null;
  valid_from: string | null;
  valid_to: string | null;
  invalidated_at: string | null;
  supersedes: string | null;
}

/**
 * `freshness_factor` ∈ [0, 1]:
 *   - 1.0  : live (no invalidated_at, valid_to either null or in future)
 *   - 0.5  : valid_to expired but invalidated_at still null
 *   - 0.0  : explicitly invalidated
 *
 * The midpoint (0.5) for "expired but not invalidated" is conservative: we
 * still want some signal for a relation that the projector has not yet
 * archived, but we do not want it to count as much as a live one.
 */
function freshnessFactor(row: RelationRow, nowIso: string): number {
  if (row.invalidated_at) return 0;
  if (row.valid_to && row.valid_to <= nowIso) return 0.5;
  return 1.0;
}

/**
 * Read environment to decide whether the PoC signal is enabled. Centralised
 * so tests can stub a single env var.
 */
export function temporalGraphEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.HARNESS_MEM_TEMPORAL_GRAPH || "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Compute per-candidate temporal-graph bonus.
 *
 * Returns a Map<observation_id, bonus>. Candidates with no relations are
 * absent (caller treats missing as 0). The bonus is **not** weighted by the
 * blender weight; the caller multiplies by `DEFAULT_TEMPORAL_GRAPH_WEIGHT`
 * (or a request-time override) before adding to the final score.
 */
export function computeTemporalGraphSignal(
  db: Database,
  candidateIds: string[],
  nowIso: string = new Date().toISOString(),
): Map<string, number> {
  const result = new Map<string, number>();
  if (candidateIds.length === 0) return result;

  const BATCH = 200;
  for (let i = 0; i < candidateIds.length; i += BATCH) {
    const batch = candidateIds.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(", ");

    let rows: Array<{
      observation_id: string;
      kind: string;
      strength: number | null;
      valid_from: string | null;
      valid_to: string | null;
      invalidated_at: string | null;
      supersedes: string | null;
    }>;
    try {
      rows = db
        .query(
          `SELECT observation_id, kind, strength, valid_from, valid_to, invalidated_at, supersedes
           FROM mem_relations
           WHERE observation_id IN (${placeholders})`,
        )
        .all(...batch) as typeof rows;
    } catch {
      // Best-effort signal: if the table is missing or the query fails for
      // any reason, return a no-op map — never break the search path.
      continue;
    }

    for (const row of rows) {
      const kind = (row.kind || "").toLowerCase();
      const kindWeight = RELATION_KIND_WEIGHTS[kind] ?? DEFAULT_KIND_WEIGHT;
      const confidence = typeof row.strength === "number" && Number.isFinite(row.strength)
        ? Math.max(0, Math.min(1, row.strength))
        : 0.5;
      const freshness = freshnessFactor(row, nowIso);
      const contribution = kindWeight * confidence * freshness;

      const prev = result.get(row.observation_id) ?? 0;
      result.set(row.observation_id, prev + contribution);
    }
  }

  // Clamp into [-MAX_PENALTY, MAX_BONUS] so a single observation with many
  // relations cannot drown out the rest of the ranking.
  for (const [id, raw] of result) {
    const clamped = Math.max(MAX_PENALTY, Math.min(MAX_BONUS, raw));
    result.set(id, clamped);
  }

  return result;
}
