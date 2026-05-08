# Temporal Graph Promotion Gate — Decision Policy (S108-015)

- Date: 2026-05-09
- Owner: harness-mem core
- Scope: define the A/B harness, threshold table, default policy, rollback env, and docs impact for the S108-014 PoC (`HARNESS_MEM_TEMPORAL_GRAPH=1`).
- Inputs:
  - `docs/benchmarks/temporal-graph-selective-import-2026-05-07.md` (S108-013 design table)
  - `memory-server/src/core/temporal-graph-signal.ts` (S108-014 PoC)
  - `scripts/s108-temporal-graph-ab-gate.ts` (this gate's harness)
  - `scripts/s108-temporal-planner-gate.ts` (existing temporal planner fixture)

## Why this gate exists

S108-014 lands a default-off PoC. The gate's job is to force a single, evidence-based decision before we either flip the default or rip the code out. Without an explicit gate, opt-in scoring tweaks tend to drift either to permanent dead code or silent default-on without measurement. Both outcomes are corrosive to the "evidence-bound retrieval" claim in `README.md`.

## A/B harness

`scripts/s108-temporal-graph-ab-gate.ts` runs the existing temporal-planner fixture twice:

1. **baseline** — `HARNESS_MEM_TEMPORAL_GRAPH` unset (PoC code path is bypassed entirely)
2. **candidate** — `HARNESS_MEM_TEMPORAL_GRAPH=1` (PoC bonus blended into the linear score)

Both runs share the same fixture, query order, and seed. The harness emits `docs/benchmarks/artifacts/s108-temporal-graph-ab/ab-report.json` with:

- per-run metrics: `answer_top1_rate`, `hit_at_10_rate`, `mean_order_score`, `p95_latency_ms`
- delta of each metric (candidate − baseline)
- decision: `improved` / `neutral` / `regressed`
- decision reason

## Decision thresholds

| Metric | Threshold | Direction |
|---|---|---|
| `hit_at_10_rate` lift | ≥ 0.02 (2 %pt) | candidate must beat baseline by this margin to count as **improved** |
| `hit_at_10_rate` drop | ≥ 0.02 (2 %pt) | candidate losing by this margin is **regressed** |
| `p95_latency_ms` regression | > 5 ms | hard fail — overrides any recall lift |
| anything in between | — | **neutral** |

`scripts/s108-temporal-graph-ab-gate.test.ts` locks each row of this table with a unit test so the threshold cannot drift silently.

## Default policy by decision

| Decision | Default policy | Action |
|---|---|---|
| **improved** | flip default `ON` | next minor: remove the env-gate, add `HARNESS_MEM_TEMPORAL_GRAPH=0` as the rollback flag, update `README.md` claim map. |
| **neutral** | keep PoC opt-in | leave the env-gate in place, document in README as a diagnostic flag, do **not** advertise as a feature. Re-evaluate after the next fixture refresh. |
| **regressed** | roll back PoC | revert `temporal-graph-signal.ts` and the wiring in `observation-store.ts` on the next patch. Update `temporal-graph-selective-import-2026-05-07.md` decision table to flip items #1, #3, #4, #5 from **adopt** to **defer / reject** with the regression evidence linked. |

## Rollback env (post-promotion)

If the gate flips default `ON`, the env-gate inverts:

- `HARNESS_MEM_TEMPORAL_GRAPH` (unset) → ON (new default)
- `HARNESS_MEM_TEMPORAL_GRAPH=0` → OFF (rollback)
- `HARNESS_MEM_TEMPORAL_GRAPH=1` → ON (no-op)

This mirrors the precedent set by `HARNESS_MEM_GRAPH_OFF=1` for the proximity signal (see `memory-server/src/core/observation-store.ts` near line 3464).

## Docs impact when promoting

When the gate decides `improved` and we promote to default ON, the following surfaces must be updated **in the same PR**:

1. `README.md` claim map (`docs/readme-claims.md`) — add the temporal-graph signal as a measured capability, link to the artifact JSON.
2. `README_ja.md` and `docs/readme-claims-ja.md` — mirror the EN row.
3. `CHANGELOG.md` and `CHANGELOG_ja.md` — note default flip with rollback env.
4. `docs/release-process.md` — add the AB gate to the release checklist.
5. `scripts/s105-proof-bundle.sh` — include the AB report in the proof bundle.
6. `Plans.md` — mark S108-015 as `cc:完了` with the artifact path and decision reason.

If the gate decides `neutral`, only `Plans.md` is updated (with the artifact path); README / CHANGELOG stay unchanged so we do not advertise a tie as a win.

If the gate decides `regressed`, `temporal-graph-selective-import-2026-05-07.md` is updated to flip the affected decision-table rows back to `defer` / `reject`.

## When to run the gate

- Before any release that touches `temporal-graph-signal.ts`, `observation-store.ts` score blender, or `mem_relations` reads.
- On a 30-day cadence when the PoC is in `neutral` mode, to detect ranking drift as the fixture grows.
- Manually whenever a maintainer suspects relation-aware scoring is contributing to a recall regression.

## Acceptance for S108-015

- This document exists and lists the threshold table, default policy, rollback env, and docs impact per decision.
- `scripts/s108-temporal-graph-ab-gate.ts` is runnable and emits a structured `ab-report.json` artifact.
- `scripts/s108-temporal-graph-ab-gate.test.ts` locks the threshold table — all rows pass.
- The actual `improved` / `neutral` / `regressed` call is **not** made by this document; it is an output of running the harness against the live fixture. Plans.md S108-015 will be set to `cc:完了` once the harness has produced an `ab-report.json` and the corresponding default-policy update has been made.
