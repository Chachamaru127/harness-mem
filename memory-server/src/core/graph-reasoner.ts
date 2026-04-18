/**
 * graph-reasoner.ts  (§78-C03)
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
 * @module graph-reasoner
 */

import type { Database } from "bun:sqlite";

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
