# Graph Store PoC — Kuzu vs SQLite Recursive CTE

**Task:** S78-C01  
**Date:** 2026-04-18  
**Purpose:** Select the graph store for §78-C02/C03 multi-hop entity reasoning.

## Setup

| Parameter | Value |
|-----------|-------|
| Entities | 100 |
| Relations | 500 |
| Random seed | 42 (mulberry32 PRNG) |
| Hop depth | 3 (variable-length 1..3) |
| Start node | `entity_0` |
| Query repeats | 10 (for `3hop_x10_ms`) |
| Schema | `Entity(id, label)` + `Relation(src→dst, kind)` |

Scripts are in `scripts/graph-store-poc-sqlite-cte.ts` and `scripts/graph-store-poc-kuzu.ts`.
Run with `npm run poc:graph-sqlite` / `npm run poc:graph-kuzu`.

## Results (median of 3 runs, macOS arm64, Bun 1.3.10 / Node 22)

| store | inserts_ms | 3hop_ms | 3hop_x10_ms | db_size_kb | notes |
|-------|-----------|---------|-------------|------------|-------|
| **sqlite-cte** | 1.1 | 0.15 | 0.78 | 68 | bun:sqlite, WAL+index, disk-backed |
| kuzu | 175 | 6.6 | 11.0 | 0 | in-memory only (see below) |

Raw JSON outputs for reproducibility:

```
sqlite-cte: {"store":"sqlite-cte","inserts_ms":1.11,"3hop_ms":0.15,"3hop_x10_ms":0.77,"db_size_bytes":69632}
kuzu:       {"store":"kuzu","inserts_ms":177.51,"3hop_ms":5.98,"3hop_x10_ms":11.14,"db_size_bytes":0}
```

## Kuzu install notes

Kuzu 0.11.3 (latest on npm as of 2026-04-18) was installed in a scoped dir:

```bash
npm install --prefix /tmp/kuzu-poc kuzu
```

Package size: ~84 deps, ~200 MB on disk (`node_modules/kuzu/kuzu_native.node` is a
large native binary). Kuzu 0.11.3 has a known crash (segfault) when calling
`db.close()` on a disk-backed database in both Bun and Node environments. The
benchmark therefore uses `:memory:` mode, which avoids the crash. Disk-backed
benchmarks were attempted but always crashed at cleanup; the `db_size_bytes: 0`
in the Kuzu column is a direct consequence. The in-memory constraint also means
Kuzu cannot currently be used as a persistent store without a fix.

## DoD evaluation

DoD: "3-hop query < 10 ms"

| store | 3hop_ms | meets DoD? |
|-------|---------|-----------|
| sqlite-cte | 0.15 | Yes (67x faster than threshold) |
| kuzu | 6.6 | Yes (marginally, in-memory only) |

## Verdict: SQLite recursive CTE

**Adopt SQLite recursive CTE for §78-C02/C03.**

Rationale:

1. **Speed** — SQLite (bun:sqlite) is ~44x faster on insert and ~44x faster on
   3-hop query at 100/500 scale. Both meet the < 10 ms DoD, but SQLite has
   headroom even at larger scales.

2. **Already in repo** — `bun:sqlite` is the existing storage layer
   (`memory-server/src/db/sqlite-adapter.ts`). Adding graph tables requires no
   new dependency, no native binary, and no install step.

3. **Kuzu install problems** — Kuzu 0.11.3 is 200 MB of native binaries and
   crashes on `db.close()` in disk mode. Until a stable release is available,
   Kuzu cannot be used as a persistent store.

4. **Zero new heavy deps** — a core principle of harness-mem. SQLite preserves
   this; Kuzu would violate it.

## Upsides / downsides

### SQLite recursive CTE

Upside: already present, no install, WAL-mode for concurrency, proven durability,
full SQL tooling.  
Downside: recursive CTE gets verbose for complex graph patterns; no native graph
API. Performance at 10k+ entities with dense relations should be re-measured
before C03 (though the 3-hop CTE is O(E) per hop depth, not O(V²)).

### Kuzu

Upside: native graph semantics (Cypher), cleaner multi-hop syntax, purpose-built
for GNN-style workloads.  
Downside: 200 MB native binary dep, crash bug on close(), slower inserts due to
per-row async round-trip (batch COPY FROM would be faster but adds FS coupling),
in-memory only until bug is fixed.

## Recommendation for §78-C02

Use `bun:sqlite` with two new tables added to the existing schema:

```sql
CREATE TABLE IF NOT EXISTS hm_entity (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind  TEXT NOT NULL DEFAULT 'entity'
);

CREATE TABLE IF NOT EXISTS hm_relation (
  src  TEXT NOT NULL REFERENCES hm_entity(id),
  dst  TEXT NOT NULL REFERENCES hm_entity(id),
  kind TEXT NOT NULL,
  PRIMARY KEY (src, dst, kind)
);

CREATE INDEX IF NOT EXISTS hm_relation_src ON hm_relation(src);
CREATE INDEX IF NOT EXISTS hm_relation_dst ON hm_relation(dst);
```

3-hop query pattern:

```sql
WITH RECURSIVE reach(id, depth) AS (
  SELECT ?, 0
  UNION
  SELECT r.dst, reach.depth + 1
  FROM reach JOIN hm_relation r ON r.src = reach.id
  WHERE reach.depth < 3
)
SELECT DISTINCT e.id, e.label FROM reach
JOIN hm_entity e ON e.id = reach.id;
```

Revisit Kuzu when a stable release with working `close()` is available and the
binary footprint is acceptable.
