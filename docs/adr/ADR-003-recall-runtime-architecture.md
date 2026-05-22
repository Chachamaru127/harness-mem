# ADR-003: Recall Runtime Architecture

Date: 2026-05-22
Status: Proposed
Related: `Spec.md`, `Plans.md` §128, `docs/recall-runtime.md`,
`docs/workgraph.md`, `docs/inject-envelope.md`,
`docs/adr-001-auto-memory-coexistence.md`

---

## Context

Harness-mem has already improved large-DB operational stability through bounded
workers, safe search fallback, queue limits, and readiness fixes. That solves a
runtime failure class, but it does not fully solve the product problem.

The product should not become a generic RAG backend that repeatedly searches a
large raw observation table. Harness-mem's differentiated value is local-first
continuity for AI coding sessions: scoped memory, resumable work, recoverable
decisions, and useful degraded behavior.

Current primitives exist but are not yet unified:

- raw observations for audit and reconstruction
- hybrid search for memory lookup
- WorkGraph for task continuity
- ADR/decisions parsing for decision recovery
- inject observability for delivered/consumed/effective hints
- bounded search worker behavior from S127

The missing layer is an explicit Recall Runtime contract.

## Boundary

This decision owns the recall architecture inside harness-mem:

- hot/cold recall projection
- scoped normal recall
- repeat recall cache
- degraded recall behavior
- OpenTelemetry instrumentation boundaries
- ADR and WorkGraph as recall evidence

This decision does not own:

- sibling repo execution policy
- claude-code-harness companion behavior
- Context-Harness knowledge backend ownership
- managed cloud memory service design
- default migration to Postgres, Qdrant, Dolt, or any external backend

## Evidence

- `Plans.md` §128 records that S115/S127 moved large-DB blocking and readiness
  risk to operational green, but does not turn that into a product recall
  contract.
- `Spec.md` defines harness-mem as a local-first continuity runtime, not a
  generic cloud memory API.
- `docs/workgraph.md` shows the task-continuity layer already exists and should
  be connected, not reimplemented.
- `docs/inject-envelope.md` shows recall needs measurable effect, not just
  delivered text.
- `memory-server/src/connectors/adr-decisions.ts` shows ADR/decisions ingestion
  exists, but is not yet a first-class recall object with BEADS-shaped evidence.
- Current search code still routes core search through observation search; repeat
  recall result caching and projection-aware recall are not implemented yet.

## Alternatives

### A. Continue DB/search tuning only

Keep improving raw observation search, worker offload, indexes, and timeouts.

Rejected as the primary direction. It improves stability, but it keeps normal
recall tied to raw DB search and does not solve why/explanation/work-continuity
as product primitives.

### B. Adopt Recall Runtime on local SQLite projections

Keep `mem_observations` as durable truth and add additive `mem_recall_*`
projections for normal scoped recall.

Adopted. It preserves local-first operation, allows safe rebuilds, and gives
recall a product contract without forcing an external backend.

### C. Move default runtime to Postgres/pgvector

Use Postgres and pgvector as the main scale answer.

Rejected for default. It may become an optional future backend, but making it
default would weaken local-first simplicity and increase setup cost before the
product contract is proven.

### D. Add Qdrant or another vector sidecar

Use a separate vector database for search and recall.

Rejected for MVP. It can improve vector scale, but it adds an operational
dependency and does not by itself solve scoping, ADR evidence, degradation, or
repeat recall invalidation.

### E. Use a managed memory service

Send recall workload to a hosted memory backend.

Rejected. It conflicts with local-first ownership and the project's commercial
packaging boundary unless explicitly opted into as a separate managed offering.

## Decision

Adopt Recall Runtime Architecture as the next product foundation.

Rules:

1. `mem_observations` remains the cold audit/reconstruction source of truth.
2. Normal prompt-time recall uses scoped, rebuildable hot projection items.
3. Broad unscoped search is forensic/admin/debug mode, not normal recall.
4. Repeat recall may use a short-TTL local query cache keyed by normalized query
   hash, scope tuple, recall mode, limits, privacy/forensic flags, retrieval
   knobs hash, and projection/data watermark.
5. Degraded modes are product behavior and must return structured fallback
   reasons.
6. OpenTelemetry is the standard instrumentation vocabulary, with no external
   export by default.
7. ADRs are first-class recall objects and new ADRs should be expressible through
   BEADS: Boundary, Evidence, Alternatives, Decision, Signals.
8. WorkGraph and ADR evidence connect to recall explanations, but neither
   displaces SessionStart continuity or existing core search compatibility.

## Signals

Proceed when:

- `docs/recall-runtime.md` and this ADR remain consistent with `Spec.md`.
- The benefit/no-go gate scores core recall, ADR, local OTel, and repeat cache
  separately.
- Projection tests prove additive migration and safe fallback.
- Cache tests prove TTL expiry, knobs hash, scope, privacy, tenant, and
  projection watermark invalidation.
- OTel redaction tests prove no raw content/secret leakage.
- Release gate reports recall latency, fallback rate, projection freshness,
  repeat recall cache hit rate, cache invalidation correctness, ADR precision,
  and core search compatibility.

Review or roll back if:

- projection weakens raw observation audit truth
- normal recall returns to broad unscoped raw DB search
- existing `/v1/search` or `harness_mem_search` behavior changes without
  migration tests
- telemetry externally exports content by default
- ADR or WorkGraph hints crowd out SessionStart continuity
- the benefit gate shows Evidence Strength <= 2 for a slice that is still marked
  required

## Consequences

Positive:

- Repeat recall becomes faster and less noisy.
- First-turn and prompt-time recall become more explainable.
- Decisions and work evidence can be cited instead of rediscovered.
- Large local DB growth is handled through scope, projection, cache, and
  degraded behavior rather than raw search alone.

Costs:

- Adds schema, cache, and invalidation complexity.
- Requires careful compatibility tests around existing search surfaces.
- Requires telemetry redaction tests before OTel can be trusted.
- Requires ADR tooling discipline so ADRs do not become ceremony.

## Status Notes

This ADR starts as `Proposed`. It can move to `Accepted` after S128-002a confirms
the value gate and the first implementation slice has red tests for projection,
cache invalidation, degraded fallback, and compatibility.
