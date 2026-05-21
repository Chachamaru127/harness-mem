# Memory Lifecycle Archive Design

- Status: refreshed for S130 preverified-evidence candidate coverage review fix
- Date: 2026-05-21
- Plan source: `Plans.md` sections 127-130
- Scope: current contract snapshot for archive-first, restore, gated hard
  purge, and compact boundaries.

## Purpose

The forgetting pipeline must stay reversible before it becomes destructive.
The design is:

1. Plan candidates with a dry-run manifest.
2. Archive first by writing a searchable, non-sensitive stub plus a lossless
   full archive reference.
3. Restore from the full archive while the archive is retained.
4. Allow hard purge and database compaction only behind a separate risk gate.

This keeps the current local-first behavior intact: normal search, resume, and
consolidation see only active rows, while admin flows can explain what was
archived and what can still be restored.

## Current Baseline

The current implementation provides the safety surface this design builds on:

- `mem_observations.archived_at` marks a row as soft-archived.
- Bulk delete adds the `deleted` privacy tag and sets `archived_at`.
- The forget policy is dry-run by default unless explicitly enabled for
  auto-forget wet mode.
- `/v1/admin/forget/plan` and `harness_mem_admin_forget_plan` return candidate
  IDs plus cross-store impact counts. They do not mutate memory.
- `/v1/admin/forget/archive` plans or executes archive-first mutation.
- `/v1/admin/forget/archive/search` returns archive stubs only.
- `/v1/admin/forget/restore` plans or executes restore from full archive
  payload while the archive is not purged.
- `/v1/admin/forget/hard-purge` plans, readiness-checks, or executes gated
  physical deletion for already archived rows only.
- The forget policy excludes `private`, `secret`, `sensitive`, and
  `legal_hold` rows from automatic archive candidates. `legal_hold` also
  trumps TTL expiry.
- Hard delete is never part of the forget plan response. It lives behind the
  separate hard-purge endpoint and risk gate.

S129 live evidence:

- Live archive rollout created `mem_archive_stubs` and `mem_archive_full`, then
  archived 100 rows with `mem_archive_stubs=100`, `mem_archive_full=100`, and
  `archive_state='archived'`.
- Default `get_observations`, `verify`, and search excluded the archived sample;
  `verify include_archived=true` still worked for admin diagnostics.
- Archive stub search returned no `payload_json` and no raw content.
- Restore was executed on a copy and set the restored observation
  `archived_at` back to `NULL`.
- Hard purge readiness selected 100 archived rows with legal-hold blockers 0
  and restore-capable stub/full payload count 100, but did not delete rows or
  run compaction.

## Current Endpoint Matrix

| Endpoint | Mode | Mutates DB | Current contract |
|---|---|---:|---|
| `POST /v1/admin/forget/plan` | dry-run plan | No | Returns candidate IDs, manifest hash, scores, and cross-store impact. It never archives or deletes. |
| `POST /v1/admin/forget/archive` | archive plan when `execute` is false | No | Recomputes archive manifest for candidate IDs or policy-selected rows. |
| `POST /v1/admin/forget/archive` | archive execute when `execute:true` | Yes | Requires matching `manifest_sha256` and `reason`; writes `mem_archive_full` and `mem_archive_stubs` in one transaction, then sets `archived_at`. |
| `POST /v1/admin/forget/archive/search` | admin stub search | No | Returns `mem_archive_stubs` fields only; response metadata states `payload_json_returned:false` and `raw_content_returned:false`. |
| `POST /v1/admin/forget/restore` | restore plan when `execute` is false | No | Verifies archive row and payload integrity, returns `restore_supported:true` if not purged and original row is not active. |
| `POST /v1/admin/forget/restore` | restore execute when `execute:true` | Yes | Requires `reason`; rehydrates archived rows from `payload_json`, clears `archived_at`, marks stub `restored`, and audits `admin.archive.restore`. |
| `POST /v1/admin/forget/hard-purge` | purge plan when `execute` is false | No | Selects already archived rows only, validates backup evidence, archive coverage, retention, legal hold, and returns a short-lived confirmation phrase. |
| `POST /v1/admin/forget/hard-purge` | readiness when `readiness_only:true` and `execute` is false | No | Same safety manifest as plan, but no `confirmation_phrase` and no active execute window. |
| `POST /v1/admin/forget/hard-purge` | purge execute when `execute:true` | Yes | Requires exact manifest hash, candidate count, manifest expiry, backup evidence, `retention_ack`, `archive_ack`, restore-capable archive coverage, legal-hold clearance, and exact confirmation. |

## Lifecycle State Machine

```text
active observation
  | archive execute
  v
archived
  | restore execute
  v
restored

archived
  | hard purge execute
  v
purged
```

State rules:

- `active`: `mem_observations.archived_at IS NULL`. Normal read paths may see
  the row if privacy and project filters allow it.
- `archived`: `mem_observations.archived_at IS NOT NULL` and
  `mem_archive_stubs.archive_state='archived'`. Full payload must be present in
  `mem_archive_full` for restore-capable archive coverage.
- `restored`: restore has executed, the observation is active again, and the
  stub remains as audit evidence with `archive_state='restored'`.
- `purged`: hard purge has physically deleted source lifecycle rows, marks the
  stub `archive_state='purged'`, and clears or removes the full payload.
  Restore must fail with `archive_purged`.
- Hard purge candidates must be in `archived`, not `active`, `restored`, or
  already `purged`.

## Read-Path Exclusion

Active read paths exclude archived rows by default. This includes normal
search, resume/timeline-style reads, consolidation, contradiction detection,
content dedupe, default `get_observations`, and default `verify`.

Admin-only exceptions:

- `include_archived=true` may be used by privileged diagnostics where supported.
- `/v1/admin/forget/archive/search` exposes stubs, not full payload.
- Restore reads full payload internally, but does not return `payload_json` to
  normal search or MCP core tools.

## Backup Evidence Boundary

Hard purge execute currently accepts these backup evidence shapes:

- `backup_path` plus `backup_sha256`: the server verifies file existence,
  streams SHA-256, opens the backup read-only, and runs SQLite
  `PRAGMA integrity_check`.
- `preverified_backup_evidence_token`: the server trusts a prior
  `/v1/admin/forget/backup-evidence` verification only when token expiry,
  DB identity, backup file stat, and exact candidate coverage all still match.
- `temp_test_backup_token`: test-only, accepted only for temp DB paths.
- `backup_sha256` alone: metadata only; useful in plan output but not enough
  for execute.

S129 motivation and S130 resolution:

- A 14GB live backup passed out-of-band SHA and `integrity_check`, but running
  full backup integrity inside the live hard-purge HTTP request path timed out
  and previously risked whole-file memory pressure. S129 changed SHA checking
  to streaming, which avoids ENOMEM, but request-path integrity verification
  remains too slow for release-quality physical purge.
- S130 therefore adds preverified backup evidence before live canary purge:
  a separate command/API verifies path, size, sha256, SQLite
  `integrity_check`, DB identity, `created_at`, `expires_at`, replay/path
  binding, and candidate coverage, then lets hard purge consume that evidence
  without rereading a 14GB file inline.
- Candidate coverage is part of the safety proof. Backup evidence creation
  requires `candidate_ids`/`target_ids`, verifies that the backup SQLite file
  contains every candidate observation plus `mem_archive_stubs` rows with
  `archive_state='archived'` and matching non-empty `mem_archive_full`
  `payload_json`/`payload_sha256`, and records sorted candidate IDs plus
  `candidate_coverage_sha256`. Hard purge with preverified evidence rejects
  tokens whose coverage is missing, whose candidate IDs do not exactly match
  the current purge manifest, or whose current archive coverage hash no longer
  matches the backup evidence hash.

## Risk Gates

- Archive execute is mutating but reversible. It may proceed after manifest
  match and reason, but it must never delete source rows or run compaction.
- Hard purge execute is irreversible and requires an explicit operator risk
  gate. As of 2026-05-21, S130-006 is pre-approved only if a restorable fresh
  backup, preverified evidence, manifest match, legal-hold clearance, archive
  coverage, retention acknowledgement, and exact confirmation are all present.
- `VACUUM`, `VACUUM INTO`, or safe compact is a separate irreversible
  operational gate. As of 2026-05-21, S130-007 is pre-approved only after purge
  and only if rollback backup, free-space checks, daemon stop/start handling,
  and expected reclaimed bytes are recorded.
- npm publish, tag, and GitHub Release remain outside this lifecycle risk gate
  and require separate release approval.

## Data Model

Archive state should be represented by two additive tables plus the existing
`mem_observations.archived_at` marker. The full payload location is deliberately
opaque so SQLite-table and sidecar-file implementations can share the same API.

### `mem_archive_stubs`

This table is the durable searchable tombstone. It must survive even if the
original observation row is hard-purged later.

```sql
CREATE TABLE IF NOT EXISTS mem_archive_stubs (
  archive_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  project TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  team_id TEXT DEFAULT NULL,
  archive_stub TEXT NOT NULL,
  archive_full_ref TEXT DEFAULT NULL,
  archive_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  legal_hold_snapshot INTEGER NOT NULL DEFAULT 0,
  content_sha256 TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  restored_at TEXT DEFAULT NULL,
  purged_at TEXT DEFAULT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

Required `archive_state` values:

- `archived`: full archive is present and restore may be possible.
- `restored`: a restore was performed; the stub remains as audit evidence.
- `purged`: full archive has been removed after the hard-purge gate.

`archive_stub` is the only archived text that may be returned by archive search.
It is built from redacted fields, IDs, timestamps, and reason metadata. It must
not contain raw `content`, `raw_text`, private payloads, or vector contents.

`archive_full_ref` is an opaque pointer such as `sqlite:<archive_id>` or
`file:<sha256>`. Public and MCP responses treat it as a token, not a filesystem
path.

### `mem_archive_full`

This table is the default local SQLite backing store for lossless archives.
Large installations may later replace it with a sidecar file store as long as
the `archive_full_ref` contract stays opaque.

```sql
CREATE TABLE IF NOT EXISTS mem_archive_full (
  archive_full_ref TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  purged_at TEXT DEFAULT NULL,
  FOREIGN KEY(archive_id) REFERENCES mem_archive_stubs(archive_id)
);
```

The payload must contain a complete restore manifest for the observation:

- The original `mem_observations` row.
- `mem_vectors` rows for each model.
- `mem_links` rows where the observation is either side of the edge.
- `mem_relations`, `mem_facts`, `mem_tags`, `mem_observation_entities`, and
  observation-linked `mem_events` rows.
- `mem_nuggets` rows for the observation. These are canonical searchable
  sub-observation content and must be preserved losslessly.
- `mem_nugget_vectors` rows for those nuggets when present. They are derived
  from `mem_nuggets.content` plus model/dimension metadata, so restore may
  reuse compatible rows or rebuild them when the vector model has changed.
- Integrity metadata: schema version, source DB identifier if available,
  `content_sha256`, `payload_sha256`, `manifest_sha256`, created timestamp,
  actor, reason, and cross-store impact counts.

SQLite vector virtual tables are derived indexes, not the source of truth. The
archive may record their row IDs for diagnostics, but restore must rehydrate
from canonical `mem_vectors` and `mem_nuggets` rows, then run the existing
vector repair or backfill path for observation and nugget vector indexes.

## Admin/API Flow

### 1. Plan

Current endpoint:

- `POST /v1/admin/forget/plan`
- MCP: `harness_mem_admin_forget_plan`

The plan stays read-only. It returns candidate IDs, scores, TTL reason when
present, and cross-store impact counts. Future archive execution must require a
manifest derived from this plan, not an ad hoc list typed by hand.

Representative response fields:

```json
{
  "archive_first": true,
  "hard_delete_supported": false,
  "manifest_sha256": "<sha256>",
  "candidate_ids": ["obs_..."],
  "cross_store_impact": {
    "observations": 1,
    "mem_vectors": 2,
    "mem_links_touching": 3,
    "mem_relations": 0,
    "mem_facts": 1,
    "mem_events": 1,
    "mem_tags": 2,
    "mem_observation_entities": 1,
    "mem_nuggets": 3,
    "mem_nugget_vectors": 3
  }
}
```

### 2. Archive

Current endpoint:

- `POST /v1/admin/forget/archive`
- MCP: intentionally not exposed; destructive lifecycle execution remains
  admin HTTP/CLI only unless a future risk-gated MCP design is approved.

Required inputs:

- `manifest_sha256`
- `candidate_ids`
- `reason`
- `execute: true`

Behavior:

1. Recompute the plan and reject if the candidate set or impact counts differ.
2. Skip any row with current `legal_hold`; report it as `skipped_legal_hold`.
3. Write `mem_archive_full` and `mem_archive_stubs` in one transaction.
4. Set `mem_observations.archived_at` for archived rows.
5. Add `deleted` to `privacy_tags_json` only for user-requested delete flows.
   Score-based or TTL archive may use `archived_at` without implying a user
   deletion request.
6. Write audit rows with manifest hash, counts, actor, and reason.

Archive execution is mutating but not destructive. It must not delete
observations, nuggets, vectors, facts, links, or full archive payloads.

### 3. Search Archived Stubs

Normal search, timeline, resume pack, consolidation, contradiction detection,
and dedupe stay active-row only.

Archived stub search is admin-only and should return `archive_stub`, IDs,
timestamps, reason, state, and `restore_supported`. It must not return
`payload_json`, raw content, raw vectors, or filesystem paths.

Current endpoint:

- `POST /v1/admin/forget/archive/search`
- MCP: intentionally not exposed; archive stub search stays admin HTTP/CLI
  only unless a future risk-gated MCP design is approved.

### 4. Restore

Current endpoint:

- `POST /v1/admin/forget/restore`
- MCP: intentionally not exposed; restore stays admin HTTP/CLI only unless a
  future risk-gated MCP design is approved.

Required inputs:

- `archive_id` or `archive_full_ref`
- `reason`
- `execute: true`

Restore behavior:

1. Load the stub and full archive payload.
2. Verify `payload_sha256` and `manifest_sha256`.
3. Reject if `archive_state = purged` or `archive_full_ref` is absent.
4. Reject by default if the original observation ID is active. A future
   `mode: duplicate` may restore into a new ID, but overwrite must not be the
   default.
5. Restore the observation row, tags, facts, relations, links, canonical
   nugget rows, observation vectors, compatible nugget vectors, and event
   references from the payload.
6. Set `archived_at = NULL` and remove `deleted` only when the archive reason
   was not a user-requested deletion. User-deletion restores require an explicit
   admin reason.
7. Mark the stub `archive_state = restored` and write audit evidence.
8. Rebuild or repair derived vector indexes after canonical rows are restored.
   If archived `mem_nugget_vectors` rows are missing, stale, or for an
   incompatible model/dimension, regenerate them from restored `mem_nuggets`.

## Hard Purge And VACUUM Gate

Hard purge is implemented, but it remains a separate risk gate from archive
creation.

Purge may physically delete source rows and the full archive payload only when
all conditions are true:

- The operator supplied the exact hard-purge `manifest_hash`.
- The archive exists and its payload integrity check passes.
- A fresh dry-run plan still matches the target set, or the operator supplies a
  documented mismatch override.
- `legal_hold_snapshot = 0` and the current row is not tagged `legal_hold`.
- The configured retention window has elapsed, unless the user explicitly
  confirms an emergency purge.
- A restorable backup exists and its evidence is accepted. Direct
  `backup_path` evidence still performs inline streaming SHA and SQLite
  integrity verification, so live canary purge must use the S130
  preverified-evidence path with exact candidate coverage instead.
- The run is against the intended project scope.

After purge:

- `mem_archive_stubs.archive_state` becomes `purged`.
- `mem_archive_full.payload_json` is removed or the sidecar payload is deleted.
- `archive_full_ref` may remain only as a non-resolvable historical token.
- Restore is impossible and must return a clear `archive_purged` error.

Database compaction (`VACUUM` or `VACUUM INTO`) is allowed only after purge
audit has been written, backup integrity is recorded, rollback is possible, and
no restore-capable archives are being processed in the same transaction.
Compaction must never be part of the archive step or the hard-purge transaction.

## Invariants

- Dry-run plan does not mutate memory.
- Archive execution is reversible and does not reclaim disk space.
- Hard purge is the first irreversible step.
- Active reads exclude archived rows by default.
- Admin archived search returns stubs only.
- Full archive payloads are never returned by normal search, resume, timeline,
  or MCP core tools.
- `mem_nuggets` are part of the canonical restore payload for an observation.
- `mem_nugget_vectors` may be archived for faster restore, but search
  correctness must not depend on preserving stale vector rows; they are
  rebuildable from canonical nugget content.
- `legal_hold` blocks automatic archive and all purge attempts.
- `archive_stub` is safe to index; `payload_json` is not.
- `archive_full_ref` is opaque and must not expose host-specific paths in API
  responses.
- Audit entries store hashes, counts, actor, reason, and IDs, not full content.
- Public external code or dependencies are not part of this design.

## Audit Events

Use `mem_audit_log` for every lifecycle transition:

| Action | When | Required details |
|---|---|---|
| `admin.forget.plan` | dry-run plan generated | manifest hash, candidate count, impact counts |
| `admin.archive.create` | full archive + stub written | archive IDs, manifest hash, reason, skipped legal holds, nugget/vector counts |
| `admin.archive.restore` | archive restored | archive ID, restored observation ID, payload hash, nugget/vector restore or rebuild counts |
| `admin.purge.plan` | hard purge dry-run | target IDs, archive states, retention status |
| `admin.purge.execute` | hard purge executed | manifest hash, deleted counts, full archive refs removed |
| `admin.vacuum.execute` | compaction run | backup path hash, DB size before/after |

## Test Plan

S130-001 is docs-only, so repository tests are not required for this change.
Implementation work must add targeted coverage before landing:

- Schema migration adds archive tables without modifying active search results.
- Forget plan remains read-only and stable across repeated calls.
- Archive execute writes stub + full payload and sets `archived_at`.
- Archived rows disappear from normal search/resume/consolidation but appear in
  admin archive search as stubs only.
- Restore round-trips an observation with vectors, nuggets, nugget vectors,
  links, facts, relations, tags, entity links, and event references.
- Restore repairs or schedules rebuild for derived SQLite vector indexes and
  nugget vector rows when archived vector metadata is missing or incompatible.
- `legal_hold` rows are excluded from archive and purge candidates.
- Purge rejects missing manifest, mismatched manifest, missing backup, active
  legal hold, and unelapsed retention window.
- Purge tests run only against temporary databases and verify cascade behavior.
- VACUUM tests use a temporary copy or `VACUUM INTO` artifact, never the user DB.

## S130 Plan-Vs-Implementation Diff

Implemented now:

- Archive-first schema and API exist for plan, execute, stub search, and
  restore.
- Live DB has archive tables and 100 restore-capable archived rows from S129.
- Normal read paths exclude archived rows by default.
- Hard purge readiness exists, including `readiness_only:true` with no
  confirmation phrase and no execute window.
- Hard purge execute has code-level gates for manifest, expiry, candidate
  count, backup evidence, retention ack, archive ack, restore-capable
  stub/full coverage, legal hold, and confirmation.
- Backup SHA verification is streaming rather than whole-file memory loading.

Still changed by S130:

- S130-002/S130-003 now implement preverified backup evidence, readiness-only
  hard purge contract, OpenAPI docs, integration tests, and explicit MCP
  exclusion checks. The S130 review fix adds candidate coverage binding so a
  token proves the backup covers the exact purge manifest candidates.
- MCP currently exposes forget plan only; archive/search/restore/hard-purge
  and backup-evidence remain intentionally absent from TS, Go, and dist MCP
  tool surfaces.
- S130-004/S130-005 must create a fresh live backup after implementation and
  rerun live readiness using the new evidence path without deletion.
- S130-006 may execute a small live hard-purge canary only after the
  pre-approved conditions are all true.
- S130-007 may execute compact/VACUUM only after purge and rollback evidence.
- S130-008 must review release surface and changelog/readme/package evidence;
  publish/tag remains a separate approval.

## S127 Boundary

- S127-001: repaired active/archived visibility and soft-delete contracts.
- S127-002: exposed dry-run forget planning and impact accounting.
- S127-003: fixed the initial design contract.
- S127-004: implemented hard purge behind the risk gate and
  temporary-database tests.
- S129-002/S129-004: implemented and live-validated archive-first restore
  capability without physical deletion.
- S129-005: added live hard-purge readiness and `readiness_only:true`; no live
  physical deletion or compaction was performed.
