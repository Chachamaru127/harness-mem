# Recall Runtime Spec

Status: frozen for S128-001
Date: 2026-05-22
Package baseline: `@chachamaru127/harness-mem` `0.24.1`
Plan source: `Plans.md` §128 Recall Runtime Architecture
Product source: `Spec.md`

## Purpose

Recall Runtime is the product-level layer that decides what harness-mem should
remember for an AI coding session, under which scope, and with what fallback
when the local runtime is degraded.

It is not a replacement for search, WorkGraph, ADR files, or session resume.
It connects those surfaces so Claude Code, Codex, and local clients can answer:

- What matters for this project right now?
- Why is this memory being shown?
- What decision or work item is this memory tied to?
- Is this result fresh, scoped, and safe to use?
- What degraded path was used when vector/search/worker/projection was not ready?

## Baseline

The current runtime already has valuable primitives:

- `mem_observations` stores the durable local audit trail.
- `/v1/search` and `harness_mem_search` provide hybrid lexical/vector/graph
  search over observations.
- S127 added bounded search worker behavior, safe fallback, queue limits, and
  readiness fixes for large local DBs.
- WorkGraph adds task dependency, claim, ready/blocked, and evidence concepts.
- ADR parsing already exists through `memory-server/src/connectors/adr-decisions.ts`.
- Inject observability measures whether delivered recall hints were consumed.

The gap is that normal recall still depends too much on searching the raw
observation surface. That makes repeated prompt-time recall unstable as the DB
grows and makes it harder to explain why a result was returned.

## Product Boundary

Recall Runtime belongs to harness-mem. It may expose context to Claude Code,
Codex, Hermes, WorkGraph, and UI surfaces, but it does not move ownership of
developer workflow, execution, or sibling repo policy.

Non-goals:

- Do not require Postgres, Qdrant, Dolt, or a managed memory service.
- Do not externally export telemetry by default.
- Do not put raw prompts, raw observations, secrets, or PII in telemetry.
- Do not silently change existing `/v1/search` or `harness_mem_search`
  compatibility.
- Do not auto-edit `Plans.md` or auto-create ADRs from hooks.
- Do not make broad unscoped search the normal recall path.

## Object Taxonomy

| Object | Meaning | Hot path | Source of truth |
|---|---|---:|---|
| Raw observation | Full local audit/reconstruction record | No | `mem_observations` |
| Episode | Session-level event sequence or summary | Sometimes | sessions/events |
| Fact | Extracted durable statement | Yes | observations / consolidation |
| Decision | Chosen direction plus rationale | Yes | decisions.md / ADR / observations |
| Work item | Task, dependency, claim, blocker, handoff | Yes | WorkGraph / Plans.md |
| Profile | Project conventions and stable context | Yes | project profile |
| Recall item | Rebuildable retrieval projection | Yes | derived projection |

Raw observations remain canonical for audit and rebuild. Recall items are
derived, disposable, and rebuildable.

## Scope Contract

Normal recall must be scoped. Callers provide or derive at least one of:

- `project`
- `cwd`
- `workspace`
- `tenant` / access scope
- `session` / thread scope

Unscoped broad search is forensic/admin/debug mode. It must be explicit,
bounded, observable, and must not become the default prompt-time recall path.

Existing broad `/v1/search` and `harness_mem_search` compatibility is preserved
unless a migration plan and tests explicitly change it.

## Hot/Cold Projection

The hot path is a rebuildable recall projection, not the raw DB. Initial schema
names should use additive `mem_recall_*` tables unless implementation discovers
a better local pattern.

Recommended tables:

| Table | Purpose |
|---|---|
| `mem_recall_items` | compact recall objects with type, scope, source, score hints |
| `mem_recall_chunks` | optional chunk text for larger facts/episodes/decisions |
| `mem_recall_profiles` | stable project/client/profile context |
| `mem_recall_projection_runs` | generation, watermark, staleness, diagnostics |

Minimum item fields:

- stable recall id
- recall type: `fact`, `decision`, `work_item`, `episode`, `profile`
- project/workspace/tenant/session scope
- source pointer: observation id, ADR path, Plans task, WorkGraph id, or session
- projection generation
- content redacted for recall
- title/summary
- timestamps: source time, projected time, valid-from/to where available
- privacy and visibility labels
- provenance metadata

Projection writes are explicit:

- Dry-run reports row counts, skipped reasons, privacy diagnostics, and proposed
  writes without changing the DB.
- Manual materialize/refresh requires `--write` or an admin API action. Current
  local surface: `POST /v1/admin/recall-projection` with
  `action=dry-run|write|clear`.
- Refresh is idempotent and bounded to the requested project scope.
- Missing or stale projection falls back to current scoped observation search
  with a structured degraded reason.
- Missing/stale recall may also schedule a bounded, debounced one-shot child
  refresh for that project. The recall response remains degraded fallback; the
  child only rebuilds the hot projection and clears the parent repeat cache on
  success. Auto refresh is local/off-main and can be disabled with
  `HARNESS_MEM_RECALL_PROJECTION_AUTO_REFRESH=0`.

## Repeat Recall Cache

Repeated recall may use a bounded local query cache to avoid recomputing the
same scoped recall in short intervals. The cache is an acceleration layer, not
semantic truth.

Start with in-process bounded LRU. Disk persistence is not required for MVP.

Cache key components:

- normalized query hash
- scope tuple: project, workspace, tenant, session where applicable
- recall mode and result shape
- limit / top-k / detail level
- privacy and forensic flags
- retrieval knobs hash: vector, rerank, graph, temporal, projection settings
- projection generation or data watermark

Default TTL: 60 seconds.
Maximum TTL: 300 seconds.
Disable: 0 ms.

Invalidation requirements:

- TTL expiry returns miss.
- Projection refresh or data watermark change returns miss.
- Knobs hash change returns miss.
- Scope, tenant, private flag, or forensic flag change returns miss.
- Cache metadata may expose hit/miss and a safe key hash.
- Cache metadata must not expose raw prompt text or raw observation content.

## Retrieval Flow

Normal recall flow:

1. Normalize query and derive scope.
2. Reject or downgrade unscoped normal recall into explicit forensic/admin mode.
3. Build repeat recall cache key.
4. Return cache hit when TTL and watermark are valid.
5. Query hot projection by scope and recall type.
6. Blend lexical/vector/rerank/recency/work/decision signals.
7. Attach compact explanation: scope, type, source, decision/work evidence, and
   degraded reason when applicable.
8. Store cache entry with safe metadata only.

Fallback flow:

1. If projection is missing or stale, use scoped observation search.
2. If vector is unavailable, use lexical/recent/decision/work fallback.
3. If worker is busy, return structured backpressure or bounded degraded result.
4. If telemetry exporter is unavailable, keep recall working and record local
   warning only.

Current local HTTP surface:

- `POST /v1/recall`: scoped normal recall. Requires `project` or `session_id`
  unless `forensic=true`.
- `POST /v1/search`: compatibility observation search. It is not silently
  converted into scoped recall.
- `GET /v1/admin/recall-degradation-manifest`: machine-readable degraded mode
  codes and fallback paths.

## Degradation Contract

Structured recall responses should include `recall_degraded_reason` when a
fallback path is used.

| Reason | Meaning | Minimum useful result |
|---|---|---|
| `projection_missing` | Projection has not been built yet | scoped observation fallback plus optional auto refresh |
| `projection_stale` | Projection watermark is behind source data | scoped observation fallback plus optional auto refresh |
| `vector_unavailable` | embedding/vector path unavailable | lexical + recent + decision/work fallback |
| `worker_timeout` | worker exceeded bounded latency | partial result or retryable backpressure |
| `queue_full` | queue is saturated | `503` with retry/backoff metadata |
| `safe_lexical_fallback` | safe mode disabled vector/graph paths | lexical scoped results |
| `otel_exporter_down` | exporter is down | recall succeeds; telemetry warning only |

`503` means backpressure, not "no memory".

## Observability

OpenTelemetry is the standard vocabulary for instrumentation, not permission to
send local memory off-machine.

Default behavior:

- no external OTLP export
- local inspect/export allowed
- exporter failure does not fail recall

Allowed attributes and metrics focus on structure:

- `service.name=harness-mem`
- `service.version`
- component/client/project scope labels
- latency
- result count
- fallback reason
- projection staleness
- worker queue depth
- repeat cache hit/miss
- ADR/work evidence count

Forbidden telemetry data:

- raw prompt text
- raw observation text
- secrets
- private-tag content
- PII

## ADR And WorkGraph Connection

ADR is a recall object because decisions are only useful when agents can recover
why a path was chosen.

ADR recall must preserve:

- ADR path and number
- title
- status
- alternatives
- consequences
- BEADS fields: Boundary, Evidence, Alternatives, Decision, Signals
- links to Plans tasks, WorkGraph items, decisions.md entries, or observations

WorkGraph recall must preserve:

- work id
- Plans source ref
- ready/blocked/claimed status
- dependency and evidence links
- close reason and checkpoint state

Recall explanations should stay compact. They should show why the item appeared
without dumping full ADRs, raw observations, or long task histories into the
prompt.

## Regression Gates

Stop-ship regressions:

- `/v1/search` or `harness_mem_search` compatibility changes without migration
  tests.
- Normal recall can run broad unscoped search without explicit forensic/admin
  mode.
- Projection overwrites or weakens raw observation audit truth.
- Cache crosses scope, tenant, privacy, or projection generation boundaries.
- OpenTelemetry exports raw content or secrets.
- SessionStart continuity is displaced by WorkGraph/ADR hints.
- `HARNESS_MEM_TOOLS=core` gains new tools without an explicit plan.

## Implementation Order

1. `S128-003`: projection schema red tests.
2. `S128-004`: projection builder dry-run.
3. `S128-004a`: materialize/refresh path.
4. `S128-004b`: repeat recall query cache.
5. `S128-005`: scoped recall API contract.
6. `S128-006`: degradation SLO manifest.
7. `S128-007` to `S128-009`: OpenTelemetry and local telemetry inspection.
8. `S128-010` to `S128-011`: ADR template and ADR ingestion.
9. `S128-012` to `S128-013`: explanation UX and release gate.

## Value Gate

Proceed only if the implementation remains a continuity runtime:

- scoped
- local-first
- explainable
- degraded-but-useful
- connected to decisions and work

If a slice only adds ceremony, dependency weight, or duplicate surfaces, reduce
it to documentation or reject it.
