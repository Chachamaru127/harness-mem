# WorkGraph Spec

Status: frozen for S125-001  
Date: 2026-05-17  
Package baseline: `@chachamaru127/harness-mem` `0.23.0`  
Plan source: `Plans.md` §125 WorkGraph Task Continuity MVP  
Research source: `/Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem/docs/harness_mem_final_research_improvement_report.md`

## Purpose

WorkGraph is a task-continuity layer for harness-mem. It connects the
existing memory runtime to concrete work items, dependencies, claims,
handoffs, and evidence so the next coding session can answer:

- What was in progress?
- What is ready to start now?
- What is blocked, duplicated, superseded, or waiting for a checkpoint?
- Who has claimed a work item?
- Why is a work item suggested, and what evidence supports it?

WorkGraph is not a replacement for `Plans.md` and is not a new large task
manager. The initial design keeps `Plans.md` as the source of truth and adds
safe, additive structure around it.

## Users

- Operator: chooses the next work stream without rereading all of `Plans.md`.
- Lead agent: imports or queries active work and assigns focused workers.
- Worker agent: claims one task, sees blockers, records evidence, and avoids
  stepping on another worker.
- Reviewer agent: follows work evidence back to observations, sessions, files,
  leases, signals, and verification output.
- Human reader: sees a generated view of ready, blocked, claimed, and completed
  work without learning the database schema.

## Version And Current Assumptions

- The current package version is `0.23.0` in `package.json`.
- `Plans.md` §125 is the active plan for WorkGraph.
- `Plans.md` remains the SSOT during the MVP. WorkGraph imports from it; it does
  not replace it.
- The importer is dry-run by default and must not auto-edit `Plans.md`.
- Existing lease, signal, verify, inject, graph, privacy, and project-isolation
  features already exist and must be connected, not reimplemented.
- `HARNESS_MEM_TOOLS=core` stays at exactly seven tools:
  `harness_mem_search`, `harness_mem_timeline`,
  `harness_mem_get_observations`, `harness_mem_sessions_list`,
  `harness_mem_record_checkpoint`, `harness_mem_resume_pack`,
  `harness_mem_health`.
- WorkGraph tools are opt-in. They do not appear in the core tool set.
- The research report contains older version text; this spec treats `0.23.0` as
  the current truth because it is verified from this repository.

## User-Facing Outcome

Today, harness-mem remembers useful context from past work. With WorkGraph,
it also shows the shape of the work itself.

In plain terms: current harness-mem is a notebook that remembers what happened.
WorkGraph adds sticky notes and an order board. A new session can see "start
this next", "do not start that yet", "this is already claimed", and "this is
why the suggestion exists".

The first user-visible win should be CLI-only:

```bash
harness-mem work import-plans ./Plans.md --dry-run
harness-mem work ready --project .
```

MCP, hooks, and UI exposure come only after parser/schema/ready quality is
measured.

## Schema Sketch

All schema changes are additive `mem_work_*` tables. Existing `mem_*`,
search, lease, signal, graph, verify, and inject tables are not changed for
the S125-001 spec.

### `mem_work_items`

```sql
CREATE TABLE IF NOT EXISTS mem_work_items (
  work_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 2,
  work_type TEXT NOT NULL DEFAULT 'task',
  project TEXT NOT NULL,
  branch TEXT,
  assignee TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  parent_work_id TEXT,
  session_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

Required status vocabulary:

- `open`
- `in_progress`
- `blocked`
- `closed`
- `deferred`

`source_type` starts with `manual`, `plans`, `hook`, and `import`.
`source_ref` is the stable source pointer, for example `plans:S125-001`.

### `mem_work_dependencies`

```sql
CREATE TABLE IF NOT EXISTS mem_work_dependencies (
  from_work_id TEXT NOT NULL,
  to_work_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(from_work_id, to_work_id, relation),
  FOREIGN KEY(from_work_id) REFERENCES mem_work_items(work_id) ON DELETE CASCADE,
  FOREIGN KEY(to_work_id) REFERENCES mem_work_items(work_id) ON DELETE CASCADE
);
```

Supported relations:

| Relation | Meaning | Affects ready |
|---|---|---|
| `blocks` | `from` is not ready until `to` is closed | yes |
| `parent_child` | Epic or child relationship | partial |
| `related` | Context-only relationship | no |
| `discovered_from` | Follow-up found while doing another task | no |
| `supersedes` | New task replaces old task | yes |
| `duplicates` | Duplicate task | yes |
| `checkpoint` | CI, approval, release, or deploy gate | yes |

### `mem_work_events`

```sql
CREATE TABLE IF NOT EXISTS mem_work_events (
  event_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  session_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(work_id) REFERENCES mem_work_items(work_id) ON DELETE CASCADE
);
```

Initial event types: `created`, `imported`, `claimed`, `released`,
`handoff`, `blocked`, `unblocked`, `linked`, `suggested_close`,
`closed`, `reopened`, `checkpoint_passed`, `checkpoint_failed`.

### `mem_work_links`

```sql
CREATE TABLE IF NOT EXISTS mem_work_links (
  work_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'evidence',
  created_at TEXT NOT NULL,
  PRIMARY KEY(work_id, target_type, target_id, relation)
);
```

Supported target types:

- `observation`
- `session`
- `event`
- `file`
- `github_issue`
- `plan_task`
- `lease`
- `signal`

## CLI, API, And MCP Surfaces

### CLI

CLI comes first because it is easiest to test and does not change MCP tool
visibility.

```bash
harness-mem work import-plans ./Plans.md --dry-run
harness-mem work import-plans ./Plans.md --write
harness-mem work sync-plans --project . --write
harness-mem work ready --project .
harness-mem work next --project . --agent codex
harness-mem work create "Fix SessionStart duplicate injection" --priority 1
harness-mem work claim hm-wk-a1b2 --agent codex --cwd "$PWD"
harness-mem work close hm-wk-a1b2 --reason "Fixed and tested"
harness-mem work dep add hm-wk-a1b2 hm-wk-b7c9 --type blocks
harness-mem work export-plans --project . > Plans.generated.md
```

S125-006 only requires:

- `harness-mem work import-plans --dry-run`
- `harness-mem work ready --project .`

### HTTP API

HTTP is added after the CLI model is stable.

```text
POST /v1/work/create
POST /v1/work/update
GET  /v1/work/query
POST /v1/work/link
POST /v1/work/import-plans
GET  /v1/work/export-plans
```

Every query and mutation requires project or cwd scope. WorkGraph must not
infer project scope from the daemon process cwd.

### MCP

MCP tools are opt-in and capped at five:

| Tool | Purpose |
|---|---|
| `harness_work_create` | Create a work item |
| `harness_work_update` | Update status, claim, close, priority, or handoff |
| `harness_work_query` | Query ready, next, blocked, by id, or by project |
| `harness_work_link` | Add dependency or evidence links |
| `harness_work_import_plans` | Dry-run or explicit write import from `Plans.md` |

Visibility rule:

- `HARNESS_MEM_TOOLS=core`: no WorkGraph tools, still seven tools.
- `HARNESS_MEM_TOOLS=all`: WorkGraph tools may be exposed after the value gate.
- `HARNESS_MEM_WORKGRAPH=1`: explicit WorkGraph opt-in may expose tools even
  when the implementation wants a narrower rollout.

## Plans Importer Constraints

- Default mode is dry-run.
- `--write` is required before any database upsert.
- Dry-run must report parsed tasks, dependency edges, diagnostics, and skipped
  lines, but must write zero rows.
- The importer must not edit `Plans.md`.
- Completed historical archive sections are out of scope by default.
- Active sections, `cc:TODO`, `cc:WIP`, `blocked`, and recent `cc:完了` rows are
  the first import target.
- `Plans.md` row mapping:

| Plans marker | WorkGraph mapping |
|---|---|
| `cc:TODO` | `status=open` |
| `cc:WIP` | `status=in_progress` |
| `cc:完了` | `status=closed` |
| `blocked` | `status=blocked` |
| `[P]` | `metadata_json.parallel=true` |
| `Depends` / `Depends:` | `mem_work_dependencies` |
| Section heading | `metadata_json.plan_section` |
| Task id | `source_ref=plans:<task-id>` |

- Accepted task id formats include `S125-001`, `S78-A05.2`,
  project-prefixed ids such as `GIFT-M1-03` / `DEP-02`, and existing
  project dotted ids such as `7.1` / `9.B.3`.
- Generated exports must be written as a generated view such as
  `Plans.generated.md`, not as an automatic overwrite of `Plans.md`.

## SessionStart Auto Sync

Codex and Claude SessionStart hooks automatically sync an existing
`$PROJECT_ROOT/Plans.md` into the local WorkGraph DB by calling:

```bash
harness-mem work sync-plans --project "$PROJECT_ROOT" --write --json
```

This is intentionally DB-only:

- It does not create `Plans.md`.
- It does not edit `Plans.md`.
- It silently skips projects without `Plans.md`.
- It records the last synced `Plans.md` mtime under plugin state and skips
  unchanged files when the DB already exists, so opening a session does not keep
  refreshing every work item's recency.

Operators can disable the automation with `HARNESS_MEM_WORKGRAPH_AUTO_SYNC=0`
or force a one-off resync with `HARNESS_MEM_WORKGRAPH_AUTO_SYNC_FORCE=1`.

## Integration With Existing Runtime

### Claim Uses Lease

Work claim uses the existing lease API. It does not create a second locking
system.

```text
work claim
  -> /v1/lease/acquire target=work:<work_id>
  -> optional file leases target=file:<path>
  -> mem_work_items.status=in_progress
  -> mem_work_items.assignee=<agent_id>
  -> mem_work_events event_type=claimed
```

If lease acquisition fails, the work status update must roll back or be left
unchanged. A second agent should see the existing `already_leased` behaviour.

### Handoff Uses Signal

Work handoff uses existing signal primitives.

```text
work handoff
  -> mem_work_events event_type=handoff
  -> /v1/signal/send type=handoff
  -> mem_work_links target_type=signal
```

Signals stay threadable and ackable through the existing signal store.

### Evidence Uses Verify And Graph

Work evidence links to observations, sessions, events, files, leases, and
signals through `mem_work_links`.

```text
work_id
  -> mem_work_links target_type=observation
  -> harness_mem_verify
```

Graph integration is a provenance path and explainability layer. WorkGraph must
not pollute ordinary memory search results unless the caller explicitly asks for
work context.

### Injection Uses Existing Inject Observability

SessionStart and prompt-time hints may show "Current Work", "Next Ready Work",
and "Blockers", but they must stay within the existing inject envelope and
consumed-rate observability model.

Work hints are suggestions. They must not override resume packs, recall
whispers, or risk warnings.

### Stop Hook Suggests, It Does Not Auto-Close

Stop hook integration may attach a session summary, record next action, create
`discovered_from` follow-ups, or suggest closing a work item. It must not close
work automatically without an explicit agent or user action.

## Privacy And Project Isolation

- Work descriptions, metadata, evidence links, and generated exports must use
  the same privacy filtering expectations as observations.
- Private tags and sensitive text must not leak into cross-project results.
- Every WorkGraph query and mutation requires a `project` or `cwd` scope.
- WorkGraph must preserve existing repo/worktree isolation. It must not use the
  daemon launch directory as implicit scope.
- Branch data is metadata attached to work. It does not replace existing branch
  memory.
- WorkGraph rows are local-first SQLite data. No external service is required.

## Non-Goals And Reject List

Rejected for the MVP:

- Dolt backend or Dolt push/pull workflow.
- `iii` engine or any new required runtime engine.
- mesh sync, team-first sync, or managed memory service behaviour.
- Full GitHub, Jira, Linear, or other tracker sync.
- WorkGraph tools in `HARNESS_MEM_TOOLS=core`.
- More than five WorkGraph MCP tools.
- Automatic `Plans.md` edits from import.
- Automatic close, autonomous approval, or human approval bypass.
- WorkGraph rows mixed into normal memory search without an explicit work query
  or filter.
- Reimplementing existing lease, signal, verify, inject, graph, privacy, or
  project-isolation logic.

## Quality Gates And Metrics

Initial WorkGraph gates:

| Metric | Purpose | Gate |
|---|---|---:|
| `plans_import_fidelity` | Correctly parse Plans tasks and status | `>= 0.98` |
| `ready_precision` | Ready items are actually startable | `>= 0.95` |
| `blocker_recall` | Blockers are not missed | `>= 0.95` |
| `next_action_accuracy` | Suggested next item matches fixture truth | `>= 0.80` |
| `duplicate_work_rate` | Re-import does not create duplicates | `<= 0.05` |
| `claim_lease_success_rate` | Claim and lease stay synchronized | `>= 0.98` |
| `work_hint_consumed_rate` | Injected work hints are used | yellow `>= 0.30`, green `>= 0.60` |

Required test families:

- Schema migration tests for fresh and migrated DBs.
- Plans importer fixture tests.
- Ready algorithm tests.
- Claim and lease integration tests.
- Handoff and signal integration tests.
- Verify/provenance link tests.
- SessionStart/UserPromptSubmit injection regression tests.
- Stop-hook suggestion tests.
- MCP registry tests proving `HARNESS_MEM_TOOLS=core` remains seven tools.
- Privacy and project-isolation tests.
- Benchmark smoke fixture for ready/next/import metrics.

## Rollout Phases

| Phase | Scope | Gate |
|---|---|---|
| 0 | Freeze spec and non-goals in this document | `docs/workgraph.md` exists and version baseline is `0.23.0` |
| 1 | Plans parser dry-run fixture and additive schema | Dry-run writes zero rows; fresh/migrate schema tests pass |
| 2 | Dry-run import, ready algorithm, CLI-only MVP | `work ready` returns scoped, explainable results |
| 3 | Work events, evidence links, explicit write import, generated export, HTTP query | Idempotency and provenance tests pass |
| 4 | Claim/close via lease and handoff/verify via signal | Double claim fails safely; handoff is traceable |
| 5 | Opt-in MCP tools and hook suggestions | Core seven unchanged; consumed-rate visible |
| 6 | Mem UI explainability and release gate | UI shows why; benchmark manifest is committed |

Release posture:

- The first release with WorkGraph metrics may warn instead of block.
- After two stable releases, parser/ready/claim regressions can become blocking.
- Any regression that changes core tool visibility, auto-edits `Plans.md`, or
  bypasses human approval is a stop-ship issue.
