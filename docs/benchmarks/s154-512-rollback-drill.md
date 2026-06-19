# S154-512 Rollback Drill (D29 Reversibility)

Validates that flipping `embedding_default_model` to Granite and back to
`multilingual-e5` leaves search results identical to the pre-flip e5 baseline.
Both vector indexes remain in `mem_vectors`; only the active model filter
changes (`memory-server/tests/integration/embedding-switch-flag.test.ts`).

**Prep status:** procedure + scripts only. No live flip/rollback executed.

## D29 property under test

| Step | mem_meta flag | Active vector model | Expected search behavior |
|------|---------------|---------------------|--------------------------|
| Baseline | `multilingual-e5` (or unset) | `local:multilingual-e5` | Reference result set |
| Flip | `granite-embedding-311m-r2@384` | `local:granite-embedding-311m-r2` | Granite-ranked results (different OK) |
| Rollback | `multilingual-e5` | `local:multilingual-e5` | **Must match baseline exactly** |

Rollback drill focuses on the **baseline → rollback** row: ordered observation id
lists per probe query must match the capture taken before the initial flip.

## Prerequisites

- Phase 0.4 baseline capture completed (`s154-512-granite-flip-runbook.md`)
- Probe fixture projects filled in:
  `docs/benchmarks/fixtures/s154-512-rollback-probes.json`
- Preflight passed (`scripts/s154-granite-flip-preflight.ts` exit 0)

## Drill sequence (operator execution)

### Step 1 — Confirm baseline artifact

```bash
jq '.schema_version, .captured_at, (.probes | length)' /tmp/s154-512-baseline-e5.json
```

Note the current flag (read-only):

```bash
~/.bun/bin/bun run scripts/s154-granite-flag-set.ts --dry-run --to multilingual-e5 | jq .previous
```

### Step 2 — (Optional) Flip to Granite

Skip if production is already on Granite from Phase 1 of the main runbook.

```bash
~/.bun/bin/bun run scripts/s154-granite-flag-set.ts \
  --execute --to granite-embedding-311m-r2@384
scripts/harness-memd restart
```

Optional sanity: capture granite-era results to a separate file (not compared in
D29 drill):

```bash
~/.bun/bin/bun run scripts/s154-embedding-rollback-drill.ts capture \
  --db ~/.harness-mem/harness-mem.db \
  --probes docs/benchmarks/fixtures/s154-512-rollback-probes.json \
  --out /tmp/s154-512-capture-granite.json
```

### Step 3 — Rollback flag to e5

```bash
~/.bun/bin/bun run scripts/s154-granite-flag-set.ts \
  --execute --to multilingual-e5
scripts/harness-memd restart
```

Audited write path: `setEmbeddingDefaultModel(db, "multilingual-e5")` returns
previous value `granite-embedding-311m-r2@384` when rolling back from granite.

Verify vector row counts unchanged (read-only SQL — operator may run manually):

```sql
-- expect e5 row count unchanged vs pre-flip notes; granite rows still present
SELECT model, dimension, COUNT(*) FROM mem_vectors GROUP BY model, dimension;
```

### Step 4 — Compare to baseline (read-only search)

```bash
~/.bun/bin/bun run scripts/s154-embedding-rollback-drill.ts compare \
  --db ~/.harness-mem/harness-mem.db \
  --probes docs/benchmarks/fixtures/s154-512-rollback-probes.json \
  --baseline /tmp/s154-512-baseline-e5.json
```

| Outcome | Action |
|---------|--------|
| exit 0, `"passed": true` | D29 drill PASS — document in checklist |
| exit 1, mismatches listed | STOP — do not leave production on granite; investigate registry warnings, env pins, or vector mutation |

### Step 5 — Restore production intent

If the org decision is to stay on Granite after a successful drill:

```bash
~/.bun/bin/bun run scripts/s154-granite-flag-set.ts \
  --execute --to granite-embedding-311m-r2@384
scripts/harness-memd restart
```

Re-run non-regression gates from the main runbook if the drill cycle took
significant wall time (ingest may have continued).

## Script modes (reference)

| Mode | Writes DB | Purpose |
|------|-----------|---------|
| `capture` | No (readonly search) | Save ordered id lists |
| `compare` | No (readonly search) | Diff against baseline |
| `s154-granite-flag-set.ts --execute` | Yes (mem_meta only) | Flip / rollback flag |

The compare script uses the same in-process `HarnessMemCore.search()` path as
integration tests — not HTTP — so it reflects provider + store state directly.

## Failure triage

| Symptom | Likely cause |
|---------|----------------|
| Registry warns then e5 fallback | Granite not installed or `@384` / store dimension mismatch |
| Mismatch after rollback | e5 vectors altered (reindex/delete) or env pin forced wrong model |
| Empty probe results | Wrong `project` in probe fixture |
| `SQLITE_BUSY` on flag set | Concurrent writer; retry with busy window or pause ingest job |

## Evidence to retain

- Baseline capture JSON path + SHA256
- Compare result JSON (`passed`, `mismatches`)
- Flag dry-run/execute JSON (`previous`, `next`, timestamp)
- `scripts/harness-memd restart` completion note

Full checklist: [s154-512-flip-evidence-checklist.md](./s154-512-flip-evidence-checklist.md)
