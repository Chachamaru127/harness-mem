# S79-002: Vector migration strategy for 256→1024 dim (ruri-v3-30m → ruri-v3-310m)

Status: investigation only. Read-only except this file. No code changes proposed in this ticket.

## 1. Schema confirmation

The claim in `docs/adaptive-retrieval.md:44` that `mem_vectors` uses composite key `(observation_id, model)` is **true**.

`memory-server/src/db/schema.ts:128-140` defines:

```sql
CREATE TABLE IF NOT EXISTS mem_vectors (
  observation_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(observation_id, model),
  FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
);
CREATE INDEX idx_mem_vectors_model_dim_obs
  ON mem_vectors(model, dimension, observation_id);
```

There is also an explicit legacy-table migration at `memory-server/src/db/schema.ts:831-879` (`migrateMemVectorsPrimaryKey`) that rebuilds any pre-S70 DB with the composite key, so every existing install already conforms. `dimension` is stored per-row, so 256-dim and 1024-dim rows can coexist without any schema change.

`mem_nugget_vectors` is parallel (`schema.ts:264-278`, PK `(nugget_id, model)`) — same story for nuggets.

## 2. Write path — does a new 310m row collide?

No. `memory-server/src/db/repositories/sqlite-vector-repository.ts:27-45` uses:

```sql
INSERT INTO mem_vectors(...) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(observation_id, model) DO UPDATE SET ...
```

Conflict resolution keys on `(observation_id, model)`. Writing `ruri-v3-310m` for an observation that already has a `ruri-v3-30m` row **inserts a new row**; the 30m row is untouched. The `sqlite-vec` virtual tables are also per-model (`memory-server/src/vector/providers.ts:137-143`: `mem_vectors_vec_${model}` and `mem_vectors_vec_map_${model}`), so each model gets its own `vec0` index with its own fixed `float[dim]` declaration. No dim clash is possible.

## 3. Search path — how models are filtered

Search always filters by exact model + dimension:

- Brute force fallback: `memory-server/src/core/observation-store.ts:1460-1468` — `WHERE v.model = ? AND v.dimension = ?`
- `sqlite-vec` path: `observation-store.ts:1561-1580` — queries the per-model vec table, then joins `mem_vectors mv ON mv.model = ? AND mv.dimension = ?`

`runVariantSearch` (`observation-store.ts:1512-1531`) always passes the model from the query-embedding plan (`plan.primary.model` falling back to `this.deps.getVectorModelVersion()`). For Route C ensemble it also searches a secondary model and score-fuses.

Importantly, `observation-store.ts:1731-1743` (`resolveFallbackVectorModel`) and the migration warning plumbing (`getMigrationProgress`, `observation-store.ts:1745-1766`) already exist: when the active model has fewer rows than total observations, search emits `vector_migration: N/M vectors reindexed (P%)` as a warning. The infrastructure to tolerate heterogeneous (partially-migrated) stores is **already shipped** — this is how S70's 30m rollout was handled, per `config-manager.ts:189-220`'s `reindexVectors` admin API that prioritises stale-model observations and runs in batches.

## 4. Three strategies compared

| | **A. Lazy (new writes only)** | **B. Background re-indexing** | **C. One-shot forced re-index on Pro activation** |
|---|---|---|---|
| Pro activation time | 0 s | 0 s | minutes to hours (depends on DB size) |
| Existing 30m vectors | stay forever | gradually replaced (or left as legacy) | deleted after 310m write |
| Search quality during transition | mixed: new obs use 310m, old obs searched via 30m fallback (`resolveFallbackVectorModel`) | improves monotonically, reported via `migration_warning` | N/A — Pro is blocked until done |
| CPU / GPU cost at activation | 0 | amortised: small batches per tick / per admin call | 100 % upfront |
| User-visible failure modes | legacy-only observations permanently retrieved via the weaker model; no way to benefit from 310m on old memories | none; worst case is "still migrating" warning | activation stalls, potentially hours; SQLite write lock during reindex; bad for CI/quick starts |
| Code changes needed | minimal: only route new writes to 310m | near-zero: `reindexVectors` admin API already batches stale-model rows (`config-manager.ts:201-212`) | new blocking flow + progress UI + cancellation |
| Reversibility | fully reversible (disable Pro → 30m rows still there) | fully reversible (both model rows coexist) | irreversible once 30m rows dropped; rollback requires re-embedding with 30m |

## 5. Recommendation: **Hybrid A + B (ship both, never C)**

1. **Always do A.** The moment Pro is active, all *new* writes go to `ruri-v3-310m`. This requires no migration at all — the composite PK lets the 310m row sit next to any 30m row.
2. **Layer B on top** for old observations, reusing the already-shipped `reindexVectors` admin API (`memory-server/src/core/config-manager.ts:189-220`). Pro activation should:
   - On startup, stamp `vectorModelVersion = ruri-v3-310m` and enable writes.
   - Kick off a low-priority background worker (or surface a `harness_mem_admin_reindex_vectors` loop) that calls `reindexVectors({ limit: 500 })` repeatedly until `getMigrationProgress` reports complete.
   - Search continues to work throughout: `resolveFallbackVectorModel` and `migrationWarning` (`observation-store.ts:1731-1766`) already handle heterogeneous state and inform users.
3. **Do not keep old 30m rows forever.** Once every observation has a 310m row, a cleanup pass can drop 30m rows — but only after migration reaches 100 %, and ideally gated by an explicit admin command so rollback remains possible for one release cycle.
4. **Reject C.** On a multi-thousand-observation DB on a laptop CPU, a one-shot forced re-embed can run for tens of minutes and hold a write lock. For a consumer desktop tool this is an unacceptable activation experience and breaks the "Pro should feel instant" promise. The only argument for C — "no partial state" — is already moot because the codebase has explicit partial-state support.

## 6. Open questions for S79 follow-ups

- Should the background worker live in-process (cron-like tick inside `memory-server`) or be triggered by the harness on idle? Current `reindexVectors` is pull-only.
- `ensemble-weights.json` (Route C) assumes two *current* models. If the secondary model is upgraded to 1024-dim while the primary stays 256-dim mid-migration, fusion weights may need rebalancing — worth validating separately under S79-003.
- Nugget vectors (`mem_nugget_vectors`) need their own reindex path; `reindexVectors` currently only rewrites `mem_vectors` (`config-manager.ts:189-220`). A Pro migration plan must cover both.
