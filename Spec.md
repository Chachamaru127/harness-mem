# Harness-mem Product Spec

Status: active SSOT
Last updated: 2026-05-28
Owner: harness-mem
Companion plan: `Plans.md` §128 Recall Runtime Architecture / §130 Local Streamable HTTP MCP Default Migration

## Purpose

Harness-mem is a local-first continuity runtime for AI coding sessions. It lets
Claude Code, Codex, and supported local clients resume the same project thread,
decisions, work state, and evidence without turning the product into a generic
cloud memory API.

This file is the project-level specification SSOT: it defines what must stay true.
`Plans.md` defines what work must be done. ADRs define why durable decisions were
made.

## Adoption Gate

Recall Runtime work is justified only if it improves continuity without
repackaging existing features. Before schema, SDK, or tool-surface work starts,
the plan must show that the change satisfies at least one of these value gates:

- Reduces large-DB recall instability without reopening daemon-blocking paths.
- Makes first-turn or prompt-time recall more explainable with less cognitive
  load.
- Preserves why a decision was made in a way agents can cite and reuse.
- Improves operator diagnosis without exporting local memory by default.

If a proposed slice only adds ceremony, dependencies, or duplicate runtime
surface, it should be scoped down to documentation or rejected.

## Product Position

Harness-mem competes on four properties together:

- Local-first project memory: the default runtime uses local storage and does not
  require cloud memory, signup, or API keys.
- Cross-tool continuity: Claude Code and Codex are the Tier 1 path. Other clients
  can integrate, but must not dilute Tier 1 quality.
- Developer workflow recall: the primary domain is coding-session continuity,
  not general lifelog memory.
- Operator-owned evidence: important recall, work, and decisions must be
  inspectable through source pointers, provenance, and compact explanations.

Codex support is scoped:

- Codex CLI is the Tier 1 Codex target.
- Codex App may use the same user-scoped Codex config path in local dogfood
  setups, but App-specific support must stay a scoped dogfood note until a
  reproducible App smoke exists.

## Source-Of-Truth Layers

| Layer | File / surface | Owns | Must not do |
|---|---|---|---|
| Product spec | `Spec.md` | What behaviour and boundaries are correct | Track task status |
| Work plan | `Plans.md` | Task contracts, DoD, dependencies, status | Define ambiguous product truth alone |
| Durable Why | `docs/adr/`, `.claude/memory/decisions.md` | Decisions, alternatives, consequences, review triggers | Become hidden implementation notes only |
| Feature specs | `docs/workgraph.md`, `docs/recall-runtime.md`, `docs/recall-runtime-benefit-gate.md` | Detailed contracts for one subsystem | Override this file silently |
| Public claims | `README.md`, `README_ja.md`, `docs/readme-claims.md` | User-facing claims with evidence | Exceed measured / bounded claims |

If these conflict, prefer this order: current code and tests for actual state,
then `Spec.md` for desired product truth, then `Plans.md` for work sequencing,
then older reports or memory.

## Core Runtime Rules

1. Keep local-first as the default. Optional external integrations are allowed
   only when explicitly configured.
2. Keep project scope explicit. Search, WorkGraph, recall, lease, signal, and
   telemetry inspection must not infer scope from the daemon launch directory.
   Existing broad `harness_mem_search` compatibility must not be broken without
   an explicit migration plan and tests.
3. Keep existing primitives connected, not duplicated. Lease, signal, verify,
   graph, inject observability, privacy filtering, and project isolation are
   existing runtime primitives.
4. Keep additive migrations. New runtime features add tables or projections
   without breaking `mem_observations`, `mem_sessions`, `mem_events`, existing
   search, or existing MCP core tools.
5. Keep degradation useful. If vector search, a worker, a projection, or a
   telemetry exporter fails, scoped lexical / recent / decision / work recall
   should still return a structured degraded result.

## Recall Runtime

Recall Runtime is the product-level evolution after large-DB search stability
work. It is not only a DB performance patch.

### Recall Object Taxonomy

| Object | Meaning | Hot path? | Source |
|---|---|---:|---|
| Raw observation | Full local audit/reconstruction record | No | `mem_observations` |
| Episode | Session-level event sequence or summary | Sometimes | sessions/events |
| Fact | Extracted durable statement | Yes | observations / consolidation |
| Decision | Chosen direction plus rationale | Yes | decisions.md / ADR / observations |
| Work item | Task, dependency, claim, blocker, handoff | Yes | WorkGraph / Plans.md |
| Profile | Project conventions and stable context | Yes | project profile |
| Recall item | Rebuildable retrieval projection | Yes | derived projection |

Normal recall must prefer scoped hot objects. Raw observation search is allowed
for forensic/admin/debug use, but must not be the default path for first-turn
continuity or prompt-time recall.

### Scope Contract

Normal recall surfaces must accept or derive one of:

- project
- cwd
- workspace
- tenant/access scope
- session/thread scope

Unscoped broad search is a forensic mode and must be explicit, bounded, and
observable.

### Repeat Recall Cache

Repeated recall may use a bounded local query cache, but the cache is an
acceleration layer, not semantic truth.

Cache keys must include:

- normalized query hash
- scope tuple (`project`, `workspace`, `tenant`, `session` where applicable)
- recall mode and result shape
- limit / top-k / detail level
- privacy and forensic flags
- retrieval knobs hash (vector/rerank/graph/temporal/projection settings)
- projection generation or data watermark

Default TTL should be short and configurable. Cache entries must never cross
scope, privacy, tenant, or projection-generation boundaries. Cache metadata may
expose hit/miss and a safe key hash, but not raw prompt text or raw observation
content.

### Degradation Contract

Structured recall responses should identify fallback causes with stable labels
such as:

- `projection_stale`
- `vector_unavailable`
- `worker_timeout`
- `worker_queue_full`
- `safe_lexical_fallback`
- `otel_exporter_unavailable`

`503` means backpressure, not "no memory". Agents and skills must treat it as a
retry/fallback signal.

## WorkGraph And BEADS-Informed Planning

The BEADS research input is adopted as a planning and ADR lens through the
dependency-aware work graph idea, not as a backend or tracker replacement.

Adopt:

- ready work
- claim
- dependency graph
- discovered-from
- metadata extension
- close reason
- JSON-first task operation

Reject:

- Dolt backend as a requirement
- Dolt push/pull workflow
- molecule/swarm features
- full external tracker sync as MVP
- copying an external issue schema wholesale

WorkGraph remains a task-continuity layer connected to existing lease, signal,
verify, inject observability, graph, privacy, and project isolation. It must not
become a second runtime that reimplements those primitives.

## ADR And Decision Runtime

ADR support is a first-class recall feature because agent continuity depends on
recovering why a decision was made, not only what changed.

### BEADS ADR Shape

Every new architecture decision should be expressible through this BEADS-shaped
contract:

| Field | Meaning | Required evidence |
|---|---|---|
| Boundary | What this decision owns, affects, and explicitly does not own | owner repo, affected surfaces, non-goals |
| Evidence | Why this is the right problem and why now | code paths, Plans section, tests, metrics, reports |
| Alternatives | Other viable choices and rejection reasons | at least one rejected option for material decisions |
| Decision | The chosen rule, architecture, or default | clear must/should language |
| Signals | Review triggers, regression gates, rollback conditions | measurable checks where possible |

This BEADS shape complements existing ADR sections (`Status`, `Context`,
`Decision`, `Consequences`). It does not require rewriting old ADRs.

### ADR Storage Rules

- Shareable ADRs live under `docs/adr/ADR-NNN-*.md`.
- Legacy ADRs that already live outside `docs/adr/` are allowed, but new ADR
  tooling must either index them explicitly or migrate them through a separate
  planned task.
- Local/project operator decisions can stay in `.claude/memory/decisions.md`.
- ADR and decisions.md ingestion must preserve source path, title, status,
  number, tags, and project scope.
- ADR recall must be able to explain source, decision status, alternatives, and
  review signals.
- ADR generation must be explicit. No hook or importer may auto-create or
  auto-accept an ADR without user/agent action.

## OpenTelemetry

OpenTelemetry is standard for instrumentation vocabulary, not permission to send
local memory off-machine.

Rules:

- Default mode must not externally export telemetry.
- OTLP export is opt-in through explicit environment/config.
- Raw prompt text, raw observation text, secrets, private-tag content, and PII
  must not appear in span names, attributes, metric labels, or logs.
- Local inspect/export surfaces are allowed and preferred for default diagnosis.
- Exporter failure must not fail recall, search, WorkGraph, or daemon readiness.

Recommended resource attributes:

- `service.name=harness-mem`
- `service.version=<package version>`
- `harness.project`
- `harness.client`
- `harness.component`

Allowed recall telemetry should focus on structural data: latency, queue depth,
fallback reason, projection staleness, result count, scope type, and tool/client
surface.

## Memory Lifecycle And Autonomous Forgetting

Harness-mem may become self-maintaining, but it must not silently destroy local
memory by default. Autonomous forgetting is a staged lifecycle, not one command
that deletes everything.

### Autonomy Ladder

| Level | Behaviour | Default | Safety boundary |
|---|---|---:|---|
| L0 report | Measure DB size, active/archive counts, stale vectors, candidate impact | On | No mutation |
| L1 reversible archive | Archive low-value or expired rows with full restore payload | Opt-in | Restore must work before purge |
| L2 derived cache prune | Delete stale vector/cache rows only when canonical memory remains | Opt-in | Rebuildable data only |
| L3 guarded purge | Physically delete already archived rows after retention and backup evidence | Opt-in only | Backup, archive coverage, legal-hold, audit |
| L4 compact | Reclaim file size with `VACUUM`/safe compact after purge | Opt-in only | Daemon stop/start and rollback backup |

L1 is the highest level that may become regular daemon automation. L3/L4 may be
autonomous only under an explicit local maintenance profile that the operator
enabled; they must never be the default for new installs.

### Forgetting Policy Contract

Autonomous forgetting must preserve these rules:

- `legal_hold`, `private`, `secret`, and `sensitive` rows are never automatic
  archive or purge candidates.
- Explicit `expires_at` beats value scoring, except `legal_hold` still wins.
- Durable memory types such as `decision`, `pattern`, `preference`, and `lesson`
  must not receive default TTL unless a policy explicitly opts them in.
- Candidate selection must report cross-store impact before mutation.
- Archive execute must be reversible and must not run hard purge or compact in
  the same request.
- Hard purge must target archived rows only and must prove restore-capable
  archive coverage in a backup created after archive.
- Compact must run after purge and record before/after bytes, duration, and
  daemon health.
- Every autonomous run must write audit evidence and expose status explaining
  what was skipped, archived, purged, compacted, and why.
- `/v1/admin/forget/maintenance`, the offline lifecycle runner, and
  `harness-mem forget status` must expose the lifecycle level, candidate
  counts, estimated reclaim bytes, exclusion reasons, restore requirements, and
  risk level without returning raw memory content, backup tokens, or
  confirmation phrases.

### Completion Definition

This feature is done when a local user can enable a conservative maintenance
profile and harness-mem keeps memory growth under configured thresholds without
blocking `/health/ready`, while still giving the user an understandable audit
trail and a restore window before irreversible purge.

## Cursor Conversation Capture

Cursor session continuity for harness-mem uses **official Cursor Agent Hooks**
as the primary ingest path. MCP tools may read memory but must not become the
primary write path for Cursor conversation events.

### Ingest contract

- **Primary input**: JSON lines appended from Cursor hook commands to the local
  spool at `~/.harness-mem/adapters/cursor/events.jsonl` (override via
  `HARNESS_MEM_CURSOR_EVENTS_PATH`).
- **Saved hook events** (minimum):
  - `sessionStart` → `session_start`
  - `beforeSubmitPrompt` → `user_prompt`
  - `afterAgentResponse` → `checkpoint` with `title: assistant_response`
  - `afterMCPExecution` / `afterShellExecution` / `afterFileEdit` → `tool_use`
  - `sessionEnd` and `stop` → `session_end`
- **Out of scope**:
  - `afterAgentThought` (not ingested)
  - Automatic reading or parsing of `transcript_path` file contents
- **Session identity**: `conversation_id` is preferred; `session_id` is
  equivalent when `conversation_id` is absent. `generation_id` is stored in
  event metadata only and must not be used as the session id.
- **Common metadata** (when present on the hook payload): `generation_id`,
  `transcript_path`, `model`, `cursor_version`, `workspace_roots`. Only
  `transcript_path` is metadata-only; harness-mem must not open transcript files
  during ingest.
- **Fail-open**: hook receiver and ingest must never block or fail Cursor user
  actions. Spool append and ingest errors are ignored or logged without
  surfacing errors back to Cursor.

### Setup contract

- User-scope `~/.cursor/hooks.json` must register harness-mem hook commands for
  all saved events above without removing unrelated user hooks (superset merge).
- `harness-mem setup --platform cursor` and `harness-mem doctor --platform cursor`
  verify the hook script, spool path, MCP wiring, and required hook entries.

## MCP Transport Defaults

Harness-mem has two local MCP layers:

- The memory daemon (`harness-memd`) is the local HTTP API owner on
  `127.0.0.1:37888`.
- The MCP transport surface is either a per-client stdio frontend or the local
  Streamable HTTP gateway on `127.0.0.1:37889/mcp`.

The product direction is to make the local Streamable HTTP gateway the default
MCP transport for new Tier 1 Claude Code and Codex setup, after the migration
gates in `Plans.md` §130 pass. This is a local-first default, not a remote or
managed-service default.

Default HTTP MCP is allowed only if all of these stay true:

- The gateway binds to loopback by default and does not listen on public
  interfaces unless the user explicitly opts in.
- The gateway requires local authentication or an equivalent verified local
  protection model. Tokens or secrets must not be printed in config previews,
  logs, telemetry, README examples, or doctor output.
- Setup may create a local gateway token file under `HARNESS_MEM_HOME` with
  owner-only permissions; client config must refer to token environment names or
  placeholders rather than writing token values.
- Setup and doctor can prove the client config, token propagation, gateway
  health, and daemon health are coherent before reporting green.
- Existing stdio installs keep working, and users can explicitly choose or roll
  back to stdio.
- Hermes remains explicit opt-in until its transport compatibility and support
  tier are re-evaluated.
- Cursor is a supported local client through user-scoped Cursor MCP config at
  `~/.cursor/mcp.json`. Cursor setup must not depend on whether the current
  workspace is a git worktree; project-scoped Cursor config can be added later
  only with an explicit plan. The Cursor user-scope MCP server id is
  `harness-mem`; setup/write flows must remove the older Cursor-only `harness`
  id to avoid duplicate MCP registration. Claude/Codex keep their existing
  `harness` server id, and Hermes keeps `harness_mem`.
- HTTP transport failures degrade to actionable doctor guidance or stdio
  fallback, not to broken first-turn continuity.

Default HTTP MCP must not:

- Require cloud accounts, external collectors, managed backends, or API keys.
- Delete or rewrite local memory data.
- Remove the stdio compatibility path before a separate deprecation decision.
- Widen `HARNESS_MEM_TOOLS=core` or weaken project / privacy isolation.

Release claims may say HTTP MCP is the new default only after Mac and Windows
package-install smoke gates cover a clean install, existing install migration,
token redaction, multi-session behavior, and rollback. This gate was promoted
for the v0.25.0 line; later README changes must still keep token, rollback,
Hermes opt-in, and existing stdio preservation visible.

## Non-Goals

- Do not turn harness-mem into a managed memory service by default.
- Do not make Postgres, Qdrant, Dolt, or any cloud collector required for local
  operation.
- Do not add WorkGraph tools to `HARNESS_MEM_TOOLS=core`.
- Do not auto-edit `Plans.md` from importers.
- Do not auto-close work or bypass human approval.
- Do not mix WorkGraph rows into normal memory search unless the caller asks for
  work context.
- Do not use public README copy to claim unmeasured quality or unsupported
  clients.

## Regression Gates

The following are stop-ship regressions:

- Core tool visibility changes without explicit plan and tests.
- Existing `harness_mem_search` or `/v1/search` compatibility changes without a
  documented migration path and regression tests.
- Local-first default becomes dependent on external service, API key, collector,
  or managed backend.
- Project isolation, privacy tag stripping, or private observation handling
  regresses.
- SessionStart continuity is displaced by WorkGraph or ADR hints.
- Unscoped broad search becomes normal recall again.
- OpenTelemetry leaks raw content or secrets.
- `Plans.md` is edited automatically by import/sync without an explicit write
  action intended for the plan itself.

## Open Decisions

| Decision | Current stance | Where to resolve |
|---|---|---|
| Recall projection schema names | Use additive `mem_recall_*` projection names unless implementation discovers a better local pattern | `Plans.md` §128 |
| ADR-003 status | Start as `Proposed`, then accept after spec review / first tests | `docs/adr/ADR-003-*` |
| OTel exporter default | No external export by default | `Plans.md` §128 / OTel tests |
| Postgres / vector sidecar | Optional future backend, not default | future ADR only |

## Links

- `Plans.md` §128 Recall Runtime Architecture
- `docs/recall-runtime.md`
- `docs/recall-runtime-benefit-gate.md`
- `docs/adr/ADR-003-recall-runtime-architecture.md`
- `docs/workgraph.md`
- `docs/inject-envelope.md`
- `docs/readme-claims.md`
- `docs/adr/ADR-002-commercial-packaging.md`
- `docs/adr-001-auto-memory-coexistence.md`
- BEADS / agentmemory research is incorporated through `docs/workgraph.md` and
  this spec; external local download paths are not canonical SSOT.
