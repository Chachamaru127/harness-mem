# Harness-mem Product Spec

Status: active SSOT
Last updated: 2026-06-15
Owner: harness-mem
Companion plan: `Plans.md` §128 Recall Runtime Architecture / §130 Local Streamable HTTP MCP Default Migration / §138 Internal Memory Benchmark / §139 Benchmark Competency Mapping / §140 Real-Data Benchmark Pilot / §141 Real-Data Benchmark Scale / §142 Agentmemory Live Comparison Benchmark / §143 LoCoMo Common Benchmark / §145 Large DB Search Timeout Fix / §146 MCP Workflow Plans Scope Fix

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

### Managed / Enterprise extensions (scope boundary)

A managed/server tier — remote sync, VPS/BigQuery storage, OpenTelemetry egress,
and a Pro/ZDR embedding endpoint — is permitted, but only as a **customer-owned,
opt-in extension** of the local-first runtime, never as a redefinition of the
default. To stay inside this spec, any managed or cloud path MUST:

- Keep local-first the default: the OSS local runtime stays fully functional with
  no account, no API key, and no cloud dependency. The managed tier is additive,
  never required.
- Be opt-in and customer-owned: memory and telemetry land in the customer's own
  VPS / BigQuery / embedding endpoint, not a harness-mem-operated store-of-record.
  Nothing is exported by default (consistent with the Adoption Gate).
- Not become a generic cloud memory API: the managed tier serves the same
  coding-continuity purpose (continuity, data residency, team continuity), not
  general-purpose lifelog or memory-as-a-service.
- Carry only spans/metadata in telemetry, never raw memory or prompt text
  (the ZDR seam).

This clause makes the enterprise direction in
`docs/strategy/server-product-strategy-2026-06-15.md` spec-consistent without
weakening the local-first default. (Added 2026-06-15, per independent review.)

## North Star And Flagship Metric

Harness-mem's flagship metric is **Bilingual Coding-Memory Freshness@k**: in
Japanese/English mixed developer memory, the rate at which recall returns only
the current value (not a superseded older value) after a fact has been
overturned. `Plans.md` §153 CodingMemory Bench is promoted to the flagship
benchmark; the North Star roadmap of record is `docs/strategy/northstar-2026-06-07.md`.

### Flagship KPI definition (must)

- Freshness@k = for observations whose value has been overturned, the fraction
  of top-k responses that return only the new current value and not the stale
  prior value.
- It is a relative metric on the self-seeded dataset and is not a claim of
  superiority over competitors (see Self-seeded benchmark non-superiority).
- The green threshold is a release-gate constant: Freshness@k >= 0.95
  (`FLAGSHIP_FRESHNESS_GREEN_THRESHOLD` in
  `memory-server/src/benchmark/flagship-kpi.ts`). The flagship KPI leads the CI
  run manifest and the benchmark scorecard (display promotion); enforcement
  (process-exit gating) is a separate step tracked as Plans.md §154-305.

### Shallow vs deep freshness (must)

- Shallow freshness = simple stale regression (current
  `current_stale_answer_regressions`).
- Deep freshness = three metrics measured on a held-out slice: tense-rewrite
  accuracy, supersession precision (rate of not returning the stale value), and
  freshness lag (time from overturn to no longer returning the stale value).
- Bi-temporal columns are an implementation mechanism, not a scoring axis
  (their A/B is neutral; see decisions D25/D26).

### Embedding migration — shadow-first / non-destructive (must)

- A new embedding model (BGE-M3 / Ruri) is built in parallel as a shadow,
  measurement-only path. The incumbent (multilingual-e5 / 384dim) stays the
  default. The 14GB incumbent index MUST NOT be destroyed.
- Switch the default only when shadow metrics clear a deterministic threshold,
  keeping both vector tables resident so rollback is immediate. If the threshold
  is not cleared, keep the incumbent.
- New-model inference defaults to local (ONNX); external embedding APIs are a
  Risk Gate.

### Hermes business deferral (must)

- Hermes business adoption is deferred until the dev phase (bilingual search /
  consolidation / freshness KPI) is complete and the flagship KPI is green.
- Before that evidence exists, Hermes business results MUST NOT be used in
  external claims, and customer data MUST NOT be sent to external channels.

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
2. Keep project scope explicit. Search, WorkGraph, recall, lease, signal,
   telemetry inspection, and MCP tools that read or write file-backed
   `Plans.md` state must not infer scope from the daemon launch directory.
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
   should still return a structured degraded result. While the local DB remains
   readable, search MUST NOT return `empty_error` (`ok=false` with `items=[]`).
   A bounded in-process degraded path (recent/scoped lexical scan with strict
   row caps) with stable degradation labels is required before surfacing a true
   error.

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
- `in_process_degraded`
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

## Benchmark And Competitive Evaluation

Harness-mem maintains an internal benchmark to compare against competitors and
track retrieval quality. The following product contracts govern how benchmark
results may be used.

### Fairness (must)

- Local reproduced measurements MUST use the same dataset, scorer, and manifest
  for every competitor measured in a reproduced run.
- Published (reference-only) competitor values MUST NOT appear in reproduced
  ranking tables.
- Live external competitor measurement requires explicit opt-in and valid
  credentials; it is not the default.

### Competitor measurement tier (must)

- **Reproduced**: harness-mem only (default local measurement).
- **Published (reference-only)**: Agentmemory, Supermemory, Claude-mem, Mem0,
  MemPalace — reference numbers from external sources; not mixed into reproduced
  rankings unless explicitly labeled as published reference.

### Self-seeded benchmark non-superiority (must)

- harness-mem seeds and retrieves its own benchmark cases in the internal
  benchmark.
- Perfect scores on self-seeded internal cases confirm implementation health
  only; they MUST NOT be cited as proof of superiority over competitors in
  README or external materials.

### Two-tier scoring (should)

- **Accurate Retrieval (AR)** and **Conflict Resolution (CR)**: substring match
  scoring is permitted for baseline checks.
- Hard cases SHOULD be supplemented with LLM judge grounding scores (OpenRouter,
  budget-capped) as a separate field; do not conflate string-match recall with
  end-to-end memory capability (see LoCoMo-Plus critique that exact-match scoring
  mixes memory with prompt adaptation).

### Standard capability vocabulary (must)

Benchmark cases and reports SHOULD map to MemoryAgentBench's four capabilities:

- **Accurate Retrieval (AR)**: find the correct fact or memory fragment.
- **Test-Time Learning (TTL)**: apply a recent correction or instruction in
  subsequent queries.
- **Long-Range Understanding (LRU)**: connect facts across distant turns or
  sessions.
- **Conflict Resolution (CR)**: prefer newer facts over superseded ones.

Official MemoryAgentBench dataset runs MAY be reproduced locally from
`ai-hyz/MemoryAgentBench`, but raw upstream data MUST NOT be committed. Reports
MUST record the dataset id, source URL, revision or download timestamp, split,
sample limit, transform version, and whether results use official metrics,
internal retrieval metrics, or both. Official MemoryAgentBench compatibility is
a benchmark-runner capability; superiority claims require reproduced runs under
the same dataset, scorer, and manifest rules as other competitors. Official
dataset transforms SHOULD split large upstream context into document/session
chunks before seeding memory, and `relevant_ids` SHOULD point to chunks that
contain the accepted answer or keypoint rather than to a whole upstream context
blob.

Benchmark runs MUST use a three-stage gate before full all-split execution:

1. **Smoke gate** (`--limit N`): bounded chunks (4KB cap, 8 chunks/row max) and
   trimmed queries for wiring and regression checks.
2. **Medium gate** (`--mab-row-limit N` without `--limit`): full chunking (64KB
   cap, all chunks) on a limited number of upstream rows; MUST complete within
   practical wall-clock and record per-case timing in the manifest.
3. **Full gate** (`--mab-split all`, no row/case limit): only after medium gate
   PASS on at least one row per split that includes temporal queries.

Smoke results MUST NOT be treated as proof of full-scale search performance.
Full runs with LLM judge (`--use-openrouter`) MUST record OpenRouter spend in
reproducibility artifacts; LLM judge applies to TTL/LRU only.

Companion implementation plan: `Plans.md` §138 Internal Memory Benchmark /
§139 Benchmark Competency Mapping / §140 Real-Data Benchmark Pilot.

### Real-Data Benchmark (must)

When conversation history is used to build benchmark cases:

- PII MUST be irreversibly masked (consistent token replacement) before LLM
  generation, storage, or commit. Mapping tables MUST NOT be persisted.
- Generated cases MUST pass a leakage filter (questions answerable without
  retrieval context are discarded).
- Japanese and mixed-language hard cases MUST use semantic scoring (LLM judge
  and/or morphological normalization), not raw substring match alone.
- Real-data self-seeded results MUST follow the non-superiority rule above;
  live competitor comparison requires the same masked dataset for all systems.
- LLM leakage filter (query-alone N=3 trials; discard if any trial answers without
  context) MUST be implemented for scale datasets (v2+).
- OpenRouter spend (cap, actual spend, generator/judge model separation) MUST be
  recorded in pipeline manifest and reproducibility artifacts when OpenRouter is
  used.
- Runner loads `coding-memory-real-ja-mixed-v3.jsonl` when present (v3 → v2 → v1
  priority); v1 pilot is archived and not double-counted.

### Public CodingMemory Benchmark (must)

CodingMemory Bench is the public developer-domain benchmark for Japanese and
JA/EN mixed coding-session memory. It complements MemoryAgentBench; it does not
replace it.

- **Name / dataset id**: `CodingMemory Bench` — `coding-memory-real-ja-mixed-v3`
  and later v3 revisions.
- **Scope**: JA / mixed / coding-session memory. English encyclopedic LoCoMo full
  remains a Non-Goal for the primary public KPI.
- **Public artifacts**: masked JSONL, dataset card, schema, statistics manifest.
  Raw logs, PII mapping tables, and checkpoints MUST NOT be committed.
- **Hugging Face**: public dataset uses a separate LICENSE (for example
  CC-BY-4.0 with irreversible PII masking note). Record HF revision and pipeline
  version in reports.
- **Public claim ceiling**: README and advocacy pages MAY cite reproduced
  3-system tables (harness-mem, Agentmemory, Supermemory), per-competency
  breakdown, and reproducibility env (secrets as set/unset only). They MUST NOT
  cite harness-mem self-seed perfect scores, mixed published/reproduced
  rankings, or MemoryAgentBench English scores as CodingMemory proxy KPIs.
- **Reproduced competitor minimum (public)**: harness-mem + Agentmemory +
  Supermemory on the same v3 dataset, scorer, and manifest. Mem0 live is
  optional stretch.
- **Production search profile**: public runs SHOULD set
  `HARNESS_MEM_INTERNAL_BENCH_EMBEDDING=1` (ONNX/adaptive equivalent). Hash
  fallback profiles MUST be recorded separately and MUST NOT be presented as the
  public baseline.
- **Scoring transparency**: public tables treat ID recall@10 as primary; AR
  substring content fallback is secondary and documented in the charter.

Companion docs: `docs/benchmarks/codingmemory-bench.md`,
`docs/benchmarks/codingmemory-bench-charter.md`. Implementation plan:
`Plans.md` §153.

### Bilingual retrieval discrimination gate (must)

Bilingual / CJK retrieval improvements (CJK normalization, lexical fusion,
dual-query) MUST be validated by a discrimination gate, not by the default
internal benchmark adapter. The default adapter runs `safe_mode` (bounded
substring scan) and bypasses the FTS/RRF path these improvements target, so its
recall cannot move when they change. The discrimination gate MUST:

- Run the real lexical/FTS path with vector retrieval disabled
  (`vector_search: false`) so the lexical contribution is isolated and a dense
  self-seed match cannot mask or inflate the measured delta.
- Use an improvement-OFF negative control as the A/B baseline and report the
  ON/OFF delta (per `decideAb`), not an absolute self-seed score. Each measured
  improvement MUST have a deterministic OFF switch (e.g. a regression env flag).
- Include 表記ゆれ (orthographic-variation) cases that are NOT NFKC-fixable
  (送り仮名, 漢字⇔かな, 複合語分割境界) alongside NFKC-fixable ones, with
  per-improver slice tags, so each improvement is shown to be slice-localized
  rather than tautological (NFKC fixing only NFKC-shaped shifts).
- Use ID recall and top1/MRR as the gate signal. Raw-substring content fallback
  MUST NOT be the gate signal (it bypasses normalization and fabricates delta).
- Prefer delta thresholds over fixed `min` values so the gate stays meaningful
  as absolute scores saturate (see the `japanese_temporal_slice` saturation at
  1.0).

Self-seed-perfect absolute scores and raw-substring fallback MUST NOT be cited
as the gate signal (Self-seeded benchmark non-superiority; semantic-scoring
requirement for JA/mixed hard cases above). Implementation plan: `Plans.md`
§154 Phase 1b.

### Agentmemory live comparison (must)

When Agentmemory is live-measured via `--competitors agentmemory`:

- Use official local REST only: default `AGENTMEMORY_URL=http://127.0.0.1:3111`,
  endpoints `/agentmemory/health`, `/agentmemory/remember`, `/agentmemory/smart-search`.
- Protected Agentmemory deployments use `AGENTMEMORY_SECRET` as bearer token.
  Secret values MUST NOT appear in reports, logs, or commits; reproducibility
  records set/unset only.
- Non-localhost Agentmemory URLs MUST be rejected unless a later explicit
  risk-gated plan approves remote targets.
- Agentmemory is promoted from published(reference-only) to reproduced only
  after adapter E2E seed+search smoke passes on the same dataset, scorer, and
  manifest as harness-mem.
- Live Agentmemory comparison on real-data v2 still follows the non-superiority
  rule; domain mismatch (generic-agent vs developer-workflow) MUST be noted in
  claim safety.

Companion implementation plan: `Plans.md` §142 Agentmemory Live Comparison Benchmark.

### LoCoMo cross-system comparison (must)

When comparing harness-mem against Agentmemory on the official LoCoMo dataset:

- Use the official LoCoMo dataset (`snap-research/locomo`, `data/locomo10.json`) as the
  common benchmark data. Do not commit raw dataset files; record source URL and license
  in docs.
- Compare with the same dataset, EM/F1 scorer (`locomo-evaluator`), and shared answer
  synthesis (`synthesizeLocomoAnswer`). Only retrieval differs between systems.
- Align embedding backbone on OpenAI `text-embedding-3-small` for both harness-mem
  (`HARNESS_MEM_EMBEDDING_PROVIDER=openai`) and Agentmemory daemon
  (`EMBEDDING_PROVIDER=openai`). `fallback` hash embeddings are smoke-only; ONNX/local
  is optional for fully-local runs.
- Agentmemory live runs inherit §142 localhost-only / `AGENTMEMORY_SECRET` non-exposure
  rules. `OPENAI_API_KEY` / `HARNESS_MEM_OPENAI_API_KEY` are handled via `.env` guard;
  values MUST NOT appear in reports (set/unset only).
- LoCoMo is English general-lifelog domain; harness-mem's primary domain is Japanese
  developer workflow. Domain mismatch MUST be noted in claim safety. Results are
  same-run reproduced measurements only; they MUST NOT be cited as external superiority
  proof.

Companion implementation plan: `Plans.md` §143 LoCoMo Common Benchmark.

### Large DB search p95 regression gate (must)

When the local observation store exceeds 100k active rows:

- Search MUST remain degradation-safe: worker/child offload failures MUST fall
  back to bounded in-process degraded results (Rule #5), never `empty_error`.
- A read-only snapshot reproduction harness MUST measure fixed-query search p95
  before/after changes; live production DB files MUST NOT be mutated by the gate.
- p95 thresholds and query fixtures MUST be recorded in reproducibility artifacts;
  gate failure blocks release claims about large-DB search stability.

Companion implementation plan: `Plans.md` §145 Large DB Search Timeout Fix.

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
- Do not present competitor marketing or published benchmark numbers as locally
  reproduced measurements.
- Do not transcribe internal self-seeded perfect scores into README or external
  materials as superiority claims over competitors.
- Do not persist PII mask mapping tables (reversible keys) in the repository,
  reports, or committed datasets.

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
- Published (reference-only) competitor values appear in reproduced ranking
  tables or dashboards without explicit separation.
- Raw PII (names, emails, phone numbers, API keys, home-directory paths) appears
  in committed benchmark datasets or generated reports.

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
- `Plans.md` §138 Internal Memory Benchmark
- `Plans.md` §139 Benchmark Competency Mapping
- `Plans.md` §140 Real-Data Benchmark Pilot / §141 Real-Data Benchmark Scale / §142 Agentmemory Live Comparison Benchmark / §143 LoCoMo Common Benchmark
- `docs/benchmarks/real-data-pipeline.md`
- `docs/adr/ADR-002-commercial-packaging.md`
- `docs/adr-001-auto-memory-coexistence.md`
- BEADS / agentmemory research is incorporated through `docs/workgraph.md` and
  this spec; external local download paths are not canonical SSOT.
