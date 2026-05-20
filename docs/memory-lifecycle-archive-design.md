# Memory Lifecycle Archive Design

- Status: frozen for S127-003
- Date: 2026-05-20
- Plan source: `Plans.md` section 127
- Scope: design only. No hard purge implementation is part of S127-003.

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

The current implementation already provides the safety surface this design
builds on:

- `mem_observations.archived_at` marks a row as soft-archived.
- Bulk delete adds the `deleted` privacy tag and sets `archived_at`.
- The forget policy is dry-run by default unless explicitly enabled for
  auto-forget wet mode.
- `/v1/admin/forget/plan` and `harness_mem_admin_forget_plan` return candidate
  IDs plus cross-store impact counts. They do not mutate memory.
- The forget policy excludes `private`, `secret`, `sensitive`, and
  `legal_hold` rows from automatic archive candidates. `legal_hold` also
  trumps TTL expiry.
- Hard delete is not currently supported by the forget plan response.

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

Recommended future fields:

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

Future endpoint:

- `POST /v1/admin/forget/archive`
- MCP: `harness_mem_admin_archive`

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

Recommended endpoint:

- `POST /v1/admin/archives/search`
- MCP: `harness_mem_admin_archives_search`

### 4. Restore

Recommended endpoint:

- `POST /v1/admin/forget/restore`
- MCP: `harness_mem_admin_restore_archive`

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

Hard purge is S127-004 or later. It must remain a separate risk gate from
archive creation.

Purge may physically delete source rows and the full archive payload only when
all conditions are true:

- The operator supplied the exact `manifest_sha256`.
- The archive exists and its payload integrity check passes.
- A fresh dry-run plan still matches the target set, or the operator supplies a
  documented mismatch override.
- `legal_hold_snapshot = 0` and the current row is not tagged `legal_hold`.
- The configured retention window has elapsed, unless the user explicitly
  confirms an emergency purge.
- A `VACUUM INTO` backup has succeeded and its size/hash are recorded.
- The run is against the intended project scope.

After purge:

- `mem_archive_stubs.archive_state` becomes `purged`.
- `mem_archive_full.payload_json` is removed or the sidecar payload is deleted.
- `archive_full_ref` may remain only as a non-resolvable historical token.
- Restore is impossible and must return a clear `archive_purged` error.

Database compaction (`VACUUM`) is allowed only after purge audit has been
written, backup integrity is recorded, and no restore-capable archives are being
processed in the same transaction. `VACUUM` must never be part of the archive
step.

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

S127-003 is docs-only, so repository tests are not required for this change.
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

## S127 Boundary

- S127-001: repaired active/archived visibility and soft-delete contracts.
- S127-002: exposed dry-run forget planning and impact accounting.
- S127-003: fixes this design contract only.
- S127-004: may implement hard purge, but only with the risk gate above and
  temporary-database tests.
