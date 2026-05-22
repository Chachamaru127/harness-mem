# Recall Runtime Benefit / No-Go Gate

Status: frozen for S128-002a
Date: 2026-05-22
Plan source: `Plans.md` §128
Inputs: `Spec.md`, `docs/recall-runtime.md`,
`docs/adr/ADR-003-recall-runtime-architecture.md`, `docs/workgraph.md`,
`docs/inject-envelope.md`

## Verdict

Proceed with Recall Runtime, but keep it sliced.

Required:

- hot/cold recall projection
- scoped normal recall contract
- degraded recall SLO
- repeat recall query cache
- ADR as recall object
- local-first OpenTelemetry instrumentation

Not required for MVP:

- default Postgres/pgvector
- default Qdrant/vector sidecar
- managed memory service
- external OTLP export by default
- replacing existing `/v1/search` or `harness_mem_search`

## Scoring Method

Scores are 1 to 5.

| Score | Meaning |
|---:|---|
| 5 | Strong evidence and direct product value |
| 4 | Good evidence; worth implementing with tests |
| 3 | Plausible; implement if bounded and reversible |
| 2 | Weak; document or prototype only |
| 1 | Do not build now |

Slices with Evidence Strength <= 2 must not be marked required.

## Slice Scores

| Slice | Product Fit | Evidence | User Value | Feasibility | Regression Safety | Strategic Leverage | Evidence Strength | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Hot/cold recall projection | 5 | 4 | 5 | 4 | 4 | 5 | 4 | GO / required |
| Scoped normal recall contract | 5 | 4 | 5 | 4 | 4 | 5 | 4 | GO / required |
| Degradation SLO | 5 | 4 | 4 | 4 | 5 | 4 | 4 | GO / required |
| Repeat recall query cache | 4 | 3 | 4 | 5 | 4 | 3 | 3 | GO / required after projection |
| ADR as recall object | 5 | 4 | 4 | 4 | 4 | 4 | 4 | GO / required |
| Local OTel instrumentation | 4 | 3 | 3 | 4 | 3 | 4 | 3 | GO / required, local/no-export default |
| Local telemetry inspect/export | 4 | 3 | 3 | 4 | 4 | 3 | 3 | GO / required after OTel |
| Recall explanation UX | 5 | 4 | 5 | 4 | 4 | 5 | 4 | GO / required |
| Postgres/pgvector default | 2 | 2 | 2 | 3 | 2 | 3 | 2 | NO-GO for MVP |
| Qdrant sidecar default | 2 | 2 | 2 | 3 | 2 | 2 | 2 | NO-GO for MVP |
| Managed memory default | 1 | 1 | 1 | 2 | 1 | 1 | 1 | NO-GO |
| Replace core search surface | 1 | 1 | 1 | 2 | 1 | 1 | 1 | NO-GO |

## Why This Is Worth Doing

The current system has already handled part of the large-DB problem: bounded
workers, safe fallback, and readiness behavior reduce blocking. That is
necessary, but it is not sufficient for the product.

The remaining product gap is recall quality under repeated real use:

- The user asks similar questions during the same work loop.
- The agent needs current project context, not a broad memory dump.
- The agent needs to know why a decision was made.
- The runtime needs to stay useful when vector, worker, projection, or telemetry
  paths are degraded.

Recall Runtime addresses those directly. It turns recall from "search the DB" to
"return the right scoped memory object with provenance and fallback semantics".

## Why This Is Not Overbuilding

The plan avoids the high-cost moves:

- no default external backend
- no managed service dependency
- no default telemetry export
- no replacement of existing search compatibility
- no automatic ADR or Plans mutation

The first implementation remains local, additive, and reversible:

- projection tables can be rebuilt or dropped
- query cache can be disabled with TTL 0
- OTel export is opt-in
- ADR ingestion is read/index behavior, not a workflow takeover
- WorkGraph remains connected evidence, not a second task manager

## User-Visible Change If Implemented

For an operator, the upgrade should feel like this:

| Current behavior | After Recall Runtime |
|---|---|
| Search may revisit many old observations | Recall prefers current scoped projection |
| Repeating a recall repeats DB work | Short-TTL cache serves repeated recall |
| Search result explains relevance weakly | Result explains scope, type, source, decision/work evidence |
| Decision rationale can be buried | ADR/decisions become recallable objects |
| Degraded vector/worker path is confusing | Response names fallback reason and minimum guarantee |
| Observability is local and custom | OTel names the path while external export stays opt-in |

## Required Safeguards

- Keep `mem_observations` as cold truth.
- Keep projection additive.
- Keep existing `/v1/search` and `harness_mem_search` compatible.
- Require scope for normal recall.
- Make forensic broad search explicit.
- Redact telemetry.
- Include cache invalidation tests for TTL, knobs hash, scope, privacy, tenant,
  and projection watermark.
- Keep `HARNESS_MEM_TOOLS=core` unchanged unless a future plan explicitly changes
  it.

## Go / No-Go Decision

GO for §128 Wave 1 through Wave 4 with the following scope:

1. Build core projection and degraded scoped recall first.
2. Add repeat recall query cache after projection materialize/refresh exists.
3. Add local OTel instrumentation and local inspect/export without external
   export by default.
4. Add ADR template/ingestion and connect ADR/WorkGraph evidence to explanations.
5. Keep Postgres/Qdrant/managed service as future optional ADRs only.

No-go trigger:

- If S128-003/S128-004 cannot prove additive projection without compatibility
  risk, stop at docs/ADR.
- If cache invalidation cannot prevent cross-scope/privacy stale hits, ship
  projection without repeat cache.
- If OTel redaction cannot be proven, keep local custom telemetry and defer OTel.
- If ADR tooling becomes ceremony without recall usage, keep ADR template but
  defer ingestion.
