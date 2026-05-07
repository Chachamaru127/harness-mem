# Temporal Graph Selective Import — Design Note (S108-013)

- Date: 2026-05-07
- Owner: harness-mem core
- Scope: decide which Graphiti / Zep temporal-graph signals to adopt into the existing SQLite-backed harness-mem schema, and which to reject or defer.
- Inputs: `docs/benchmarks/competitive-audit-2026-05-07.md` (S108-010), §S108-007 temporal anchor persistence, current relation/observation schema in `memory-server/src/core/event-recorder.ts`.

## Goal

S108-013 forces an explicit yes/no/defer per Graphiti-style signal so that S108-014 (local PoC) and S108-015 (promotion gate) can proceed without scope creep, and so that we never quietly grow toward an external graph DB dependency.

The bar to **adopt** is:

1. Signal can be derived from columns already present (or trivially added) in `mem_observations` / `mem_relations` / `mem_facts`.
2. Signal does not require a separate graph engine, vector graph index, or Cypher-like query layer.
3. Signal pays for itself on the temporal slice without regressing developer-workflow recall or search p95.

If a signal fails any of those gates it goes to **defer** (re-evaluate next cycle) or **reject** (out of charter for this runtime).

## Decision table

| # | Graphiti / Zep signal | Decision | Rationale | Existing column / hook to reuse |
|---|------------------------|----------|-----------|---------------------------------|
| 1 | Temporal edges with `valid_from` / `valid_to` per relation | **Adopt (PoC, env-gated)** | We already persist `valid_from` / `valid_to` / `invalidated_at` on observations (S108-007). Lifting the same columns onto `mem_relations` is one ALTER TABLE. | `event-recorder.ts:617-648` already passes the temporal contract for observations; extend to relation insert. |
| 2 | Point-in-time answer split (current / historical / superseded / unknown) | **Adopt (PoC, env-gated)** — coordinated with S108-009 | Same enum is being wired by parent worktree on `compileAnswer`. PoC just needs to reuse it for relation traversal so a "stale fact win" can be detected. | `memory-server/src/answer/compiler.ts` (parent worktree) — do not duplicate; S108-014 will consume its output. |
| 3 | `relation_type` weight in score blender (`updates`, `supersedes`, `contradicts`, `causes`) | **Adopt (PoC, env-gated)** | `mem_relations.relation` already exists with a fixed enum (`event-recorder.ts:227`). Adding a small additive bonus in the score blender is local and reversible. | Current relation enum is the SSOT — no schema change needed. |
| 4 | `confidence` propagation on relations | **Adopt (PoC, env-gated)** | Already exists as `weight` on relation insert path; rename in-PoC as a `confidence` view, do not migrate the column. | Reuse `weight`; no migration. |
| 5 | Source-observation back-pointer on facts (`source_observation_id`) | **Adopt (PoC, env-gated)** | Required to attribute a stale-fact-win regression. Column already implicit in fact projector path; surface it in the score input. | `memory-server/src/projector/*` already keys off observation IDs. |
| 6 | Hybrid graph search (vector + traversal in one query) | **Defer** | Requires either an in-process graph engine or non-trivial CTE that we have not benchmarked. Not on the critical path for v0.19.0; revisit when temporal slice gains plateau. | n/a |
| 7 | Cypher-like query language exposure | **Reject** | Out of charter — harness-mem is a continuity runtime, not a graph DB. Adding a query language doubles the public surface and breaks the "one local SQLite" claim. | n/a |
| 8 | External graph DB (Neo4j / Memgraph / Zep cloud) backing store | **Reject** | Violates "Zero cloud, zero API keys" claim and the local-first architecture in `README.md`. Would also force a second migration story. | n/a |
| 9 | Bi-temporal (`event_time` and `observed_at` as two separate axes) | **Adopt (already shipped)** | S108-007 already persists both. PoC just needs to use them when ordering `historical` evidence. | `event-recorder.ts:214` |
| 10 | Auto-supersedes link generation (Jaccard-based) | **Adopt (already shipped)** | Existing FQ-013 path generates these links best-effort. PoC reuses them as `supersedes`-typed edges in the score blender. | `event-recorder.ts:658-715` |
| 11 | Graph traversal depth as a tunable | **Defer** | We do not yet know whether depth >1 helps. PoC stays at depth-1 (direct relations); revisit after 014/015 measure depth-1 lift. | n/a |
| 12 | Knowledge graph reasoning / inference (multi-hop fact synthesis) | **Reject** | This is an LLM-assisted layer, not a memory layer. Belongs in the answer compiler, not in retrieval. Keeping it out of the core preserves the "evidence-bound" contract. | n/a |

## What changes for v0.19.0

- Adopt items #1, #3, #4, #5 land as **default-off PoC** under `HARNESS_MEM_TEMPORAL_GRAPH=1` (S108-014).
- Items #2, #9, #10 are already shipped or coordinated elsewhere — the PoC consumes them.
- Items #6, #11 are defer; #7, #8, #12 are reject. None ship in v0.19.0.

## Risk register

- **Score-blender drift**: any new signal must keep the existing default ranking intact when the env flag is off. PoC will gate every code path on the flag and add a regression test that runs the existing search suite with the flag off.
- **p95 budget**: relation joins on read path can blow the 50ms p95. PoC must benchmark with `scripts/check-developer-domain-gate.sh` before promotion.
- **Privacy / strict project**: relation-aware scoring must not bypass `appendProjectFilter` / `appendTenantFilter`. PoC explicitly reuses those helpers.

## Acceptance for S108-013

- This document exists and lists every signal as adopt / defer / reject with a one-sentence rationale.
- External graph DB adoption is explicitly marked **reject** with a link back to the README local-first claim.
- S108-014 / S108-015 acceptance criteria can be evaluated against this table without re-reading Graphiti / Zep upstream docs.
