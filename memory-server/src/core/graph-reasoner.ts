/**
 * graph-reasoner.ts  (§78-C03, §78-C04)
 *
 * Multi-hop observation expansion via mem_relations (entity co-occurrence graph).
 * Uses an iterative BFS approach rather than a recursive CTE, which maps more
 * cleanly to the entity-based graph schema from §78-C02.
 *
 * Schema: mem_relations(id, src, dst, kind, strength, observation_id, created_at)
 *   - src/dst are entity labels (lowercased), referencing mem_entities.name
 *   - observation_id is the observation that produced this relation
 *
 * Algorithm:
 *   1. Find all entities mentioned in seed observations (via mem_relations)
 *   2. Find other observations that share those entities (1-hop neighbors)
 *   3. Repeat up to `depth` hops, accumulating reachable observation IDs
 *
 * Performance notes (per §78-C01 benchmark):
 *   - 3-hop BFS on SQLite with idx_mem_relations_src/obs: ~0.15ms typical
 *   - Hard cap: MAX_EXTRA_OBS = 20 to prevent result explosion
 *
 * §78-C04: computeQueryEntityProximity
 *   - Computes graph_proximity score for each candidate observation.
 *   - graph_proximity(obs_X) = 1 / (1 + hop_distance(obs_X, any_query_entity))
 *   - hop_distance is the shortest path via mem_relations entity graph.
 *   - Capped at MAX_PROXIMITY_HOPS = 3; beyond that, proximity = 0.
 *
 * @module graph-reasoner
 */

import type { Database } from "bun:sqlite";
import { extractEntitiesAndRelations } from "./entity-extractor.js";

/** Maximum extra observations added per expansion (prevents result explosion). */
const MAX_EXTRA_OBS = 20;

/** Maximum hops regardless of requested depth (safety bound). */
const MAX_DEPTH_BOUND = 5;

/**
 * Given seed observation IDs and a depth, return observation IDs reachable via
 * `mem_relations` within that depth. Uses iterative BFS over the entity graph.
 *
 * @param db          - SQLite database instance
 * @param seedObsIds  - observation IDs to start from
 * @param depth       - max hops (1..3 recommended; capped at MAX_DEPTH_BOUND)
 * @returns Set of observation IDs including seeds + all reachable within depth
 */
export function expandObservationsViaGraph(
  db: Database,
  seedObsIds: string[],
  depth: number
): Set<string> {
  const result = new Set<string>(seedObsIds);

  if (seedObsIds.length === 0 || depth <= 0) {
    return result;
  }

  const clampedDepth = Math.min(depth, MAX_DEPTH_BOUND);
  let frontier = new Set<string>(seedObsIds);
  const visitedObs = new Set<string>(seedObsIds);
  const visitedEntities = new Set<string>();
  let extraAdded = 0;

  for (let hop = 0; hop < clampedDepth; hop++) {
    if (frontier.size === 0 || extraAdded >= MAX_EXTRA_OBS) break;

    // Step 1: Collect entities from the current frontier observations
    const frontierArr = [...frontier];
    const newEntities = new Set<string>();

    for (const obsId of frontierArr) {
      const placeholders = "?";
      const rows = db
        .query(
          `SELECT DISTINCT src, dst FROM mem_relations WHERE observation_id = ${placeholders}`
        )
        .all(obsId) as Array<{ src: string; dst: string }>;

      for (const row of rows) {
        if (!visitedEntities.has(row.src)) newEntities.add(row.src);
        if (!visitedEntities.has(row.dst)) newEntities.add(row.dst);
      }
    }

    if (newEntities.size === 0) break;

    for (const e of newEntities) visitedEntities.add(e);

    // Step 2: Find observations that contain any of these entities
    const nextFrontier = new Set<string>();
    const entityArr = [...newEntities];

    // Query in batches to avoid huge IN clauses
    const BATCH = 50;
    for (let i = 0; i < entityArr.length; i += BATCH) {
      if (extraAdded >= MAX_EXTRA_OBS) break;
      const batch = entityArr.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(", ");

      const rows = db
        .query(
          `SELECT DISTINCT observation_id FROM mem_relations
           WHERE (src IN (${placeholders}) OR dst IN (${placeholders}))
           LIMIT ?`
        )
        .all(...batch, ...batch, MAX_EXTRA_OBS - extraAdded + frontierArr.length) as Array<{
          observation_id: string;
        }>;

      for (const row of rows) {
        const id = row.observation_id;
        if (!visitedObs.has(id)) {
          visitedObs.add(id);
          nextFrontier.add(id);
          result.add(id);
          extraAdded++;
          if (extraAdded >= MAX_EXTRA_OBS) break;
        }
      }
    }

    frontier = nextFrontier;
  }

  return result;
}

// ---------------------------------------------------------------------------
// §78-C04: Graph proximity signal for hybrid scorer

/** Maximum hops for proximity scoring. Beyond this, proximity = 0. */
const MAX_PROXIMITY_HOPS = 3;

/**
 * Compute graph_proximity scores for a set of candidate observations relative
 * to the entities mentioned in the query text.
 *
 * graph_proximity(obs_X) = 1 / (1 + hop_distance(obs_X, any_query_entity))
 *
 * Returns a Map<obsId, proximityScore> for candidates that have any proximity
 * (score > 0). Observations with no entity path within MAX_PROXIMITY_HOPS are
 * omitted (caller treats missing entries as 0).
 *
 * If no query entities are found, returns an empty map (no-op — preserves
 * current behavior).
 *
 * @param db           - SQLite database instance
 * @param queryText    - the search query string
 * @param candidateIds - observation IDs to score
 */
export function computeQueryEntityProximity(
  db: Database,
  queryText: string,
  candidateIds: string[],
): Map<string, number> {
  const result = new Map<string, number>();
  if (candidateIds.length === 0) return result;

  // Extract entities from the query text using the same extractor as §78-C02
  const { entities: queryEntities } = extractEntitiesAndRelations(queryText);
  if (queryEntities.length === 0) return result;

  const queryEntityIds = queryEntities.map((e) => e.id); // lowercased labels

  // BFS over entity graph starting from query entities.
  // For each hop, find observations whose mem_relations mention those entities.
  // Stop when we've assigned a proximity to all reachable candidates within
  // MAX_PROXIMITY_HOPS, or when no new entities are discovered.

  // Track assigned hop distances per candidate observation
  const hopDistances = new Map<string, number>();

  // Current frontier: entity labels at the current hop distance
  let entityFrontier = new Set<string>(queryEntityIds);
  const visitedEntities = new Set<string>(queryEntityIds);

  for (let hop = 1; hop <= MAX_PROXIMITY_HOPS; hop++) {
    if (entityFrontier.size === 0) break;

    const entityArr = [...entityFrontier];
    const BATCH = 50;
    const newEntities = new Set<string>();

    for (let i = 0; i < entityArr.length; i += BATCH) {
      const batch = entityArr.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(", ");

      let rows: Array<{ observation_id: string; src: string; dst: string }>;
      try {
        rows = db
          .query(
            `SELECT observation_id, src, dst FROM mem_relations
             WHERE src IN (${placeholders}) OR dst IN (${placeholders})`
          )
          .all(...batch, ...batch) as typeof rows;
      } catch {
        continue;
      }

      for (const row of rows) {
        const obsId = row.observation_id;
        // Assign hop distance only if not already set (shortest path wins)
        if (candidateIds.includes(obsId) && !hopDistances.has(obsId)) {
          hopDistances.set(obsId, hop);
        }
        // Discover new entities for the next frontier
        if (!visitedEntities.has(row.src)) {
          newEntities.add(row.src);
          visitedEntities.add(row.src);
        }
        if (!visitedEntities.has(row.dst)) {
          newEntities.add(row.dst);
          visitedEntities.add(row.dst);
        }
      }
    }

    entityFrontier = newEntities;
  }

  // Convert hop distances to proximity scores
  for (const [obsId, hopDist] of hopDistances) {
    result.set(obsId, 1 / (1 + hopDist));
  }

  return result;
}
