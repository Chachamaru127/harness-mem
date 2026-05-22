# S132 Live Cleanup And Maintenance Evidence

- Date: 2026-05-22
- DB: `/Users/tachibanashuuta/.harness-mem/harness-mem.db`
- Scope: live DB cleanup, archive-first automation implementation, offline maintenance runner, compact.
- Raw preverified tokens and confirmation phrases are intentionally not recorded.

## Implementation

- Added `POST /v1/admin/forget/maintenance` as an opt-in archive-first maintenance surface.
- Added schedule/threshold config for forget maintenance. Defaults are disabled and dry-run.
- Added explicit Bun request timeout extension for `/v1/admin/forget/*` admin endpoints.
- Added `scripts/forget-maintenance-offline.ts` for daemon-stopped maintenance using core gates rather than raw observation deletes.
- Added offline modes:
  - archived hard purge with backup evidence.
  - archive-first then hard purge.
  - stale vector cache pruning when the current vector already exists.
- Hard purge and compact remain outside automatic schedule/threshold execution.

## Live Operations

### Backup Evidence

- Pre-archive backup: `/Users/tachibanashuuta/.harness-mem/s132/harness-mem-backup-2026-05-21T14-34-38Z.db`
  - SHA-256: `eadc978f6ebc71d5a7debc882ad2596fb120a0c8803ce3c456a2b4f161390a45`
  - Integrity: `ok`
- Post-archive backup: `/Users/tachibanashuuta/.harness-mem/s132/harness-mem-post-archive-backup-2026-05-21T14-47-40Z.db`
  - SHA-256: `cc0491dd50ba7c4f8e439f5bd44844bd00945fcb76ff5054090a0e83d32496cf`
  - Integrity: `ok`
- Post-archive-500 backup: `/Users/tachibanashuuta/.harness-mem/s132/harness-mem-post-archive-500-backup-2026-05-22T02-04-28Z.db`
  - SHA-256: `e98df3867481b11585a8d086256ac487b1ea4cbcedc305455540bb188df4abbf`
  - Size: `14461427712`
  - Integrity: `ok`
- Pre-compact rollback DB: `/Users/tachibanashuuta/.harness-mem/s132/harness-mem-pre-compact-live-2026-05-22T02-48-53Z.db`

### Archive And Purge

- HTTP archive plan for 100 candidates succeeded.
- HTTP archive execute for 100 candidates succeeded.
- HTTP hard purge plan/execution timed out on the large live DB path, so hard purge moved to the offline runner.
- Offline hard purge canary for 100 already archived rows succeeded.
- A 500-row archive-first offline batch was interrupted after archive and before purge; this left `archive_state='archived'` for 500 rows.
- The hard purge gate correctly rejected the old backup because it did not contain restore-capable archive payloads for those 500 newly archived rows.
- A new post-archive-500 backup was created and verified.
- Offline hard purge of those 500 archived rows then succeeded.

Final purge totals:

- `archive_purged`: `700`
- `archived`: `0`
- 500-row purge deleted:
  - `mem_observations`: `500`
  - `mem_vectors`: `500`
  - sqlite-vec rows: `1000`
  - `mem_links_touching`: `12`
  - `mem_tags`: `1021`
  - `mem_facts`: `5`
  - `mem_events_deleted`: `500`
  - `mem_archive_full_purged`: `500`
  - `mem_archive_stubs_purged`: `500`

### Vector Cache Prune

Dry-run found stale vector cache rows with current-vector replacements:

- Current model: `adaptive:general:local:multilingual-e5`
- Removable rows: `177184`
- Removable vector JSON bytes: `1198148902`
- By model:
  - `local:multilingual-e5`: `104308` rows, `834748884` bytes
  - `adaptive:ruri:local:ruri-v3-30m`: `54833` rows, `313322187` bytes
  - `fallback:local-hash-v3`: `18043` rows, `50077831` bytes

Execute succeeded:

- Stale vector rows after prune: `0`
- Remaining `mem_vectors`: `342299` immediately after prune, later live ingest increased this slightly.
- Reclaimable estimate after prune: about `1309618176` bytes.
- This did not delete observation content.

### Compact

- First compact artifact was valid but rejected for live swap because concurrent MCP/daemon ingest changed live counts during generation.
- After stopping daemon, MCP gateway, UI, and harness-mcp processes, stable compact was regenerated.
- Compact artifact: `/Users/tachibanashuuta/.harness-mem/s132/harness-mem-compact-stable-2026-05-22T02-46-58Z.db`
  - SHA-256: `43c1460bbc796ef032d81a0ec149f3133c287bb23834786f46371c23c66a91a0`
  - Size: `13107539968`
  - Integrity: `ok`
- Live/compact counts matched before swap:
  - active observations: `348779`
  - archived observations: `0`
  - vectors: `342299`
  - links: `6568200`
  - relations: `4979577`
  - events: `356502`
  - archive purged: `700`
- Live DB was swapped to the compact artifact.
- Final live DB:
  - Path: `/Users/tachibanashuuta/.harness-mem/harness-mem.db`
  - SHA-256 immediately after swap: `43c1460bbc796ef032d81a0ec149f3133c287bb23834786f46371c23c66a91a0`
  - Size immediately after swap: `13107539968`
  - Integrity: `ok`
  - `PRAGMA quick_check`: `ok`
  - `freelist`: `0`

### Runtime State

- During cleanup, stale/orphan daemon processes from `/Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem` repeatedly reopened the live DB.
- LaunchAgent plist targets were verified and restored to the worktree path:
  - daemon: `/Users/tachibanashuuta/.codex/worktrees/c6b1/harness-mem/memory-server/src/index.ts`
  - MCP gateway: `/Users/tachibanashuuta/.codex/worktrees/c6b1/harness-mem/scripts/harness-mem mcp-gateway start --foreground`
  - UI: `/Users/tachibanashuuta/.codex/worktrees/c6b1/harness-mem/harness-mem-ui/src/server.ts`
- Final health:
  - `/health`: `ok:true`
  - DB size from health: about `13115142144` bytes after a small amount of new ingest
  - warnings: `[]`
  - `/health/ready`: `ok:true`, `ready:true`

## Result

- Live DB file size moved from about `14.42GB` to about `13.11GB`.
- The direct low-score forget candidates only reclaimed megabytes; the meaningful space recovery came from stale vector cache pruning plus compact.
- Remaining large areas are graph/link derived data and indexes:
  - `mem_links` plus indexes are several GB.
  - `mem_relations` and relation indexes are also large.
  - These need a separate derived-graph compaction policy because they are not primary memory content.

## Follow-up

- Add a first-class derived-cache maintenance policy for stale vectors, graph links, and co-occurrence relations.
- Keep automatic schedule/threshold maintenance archive-only.
- Keep hard purge and compact manual/offline with fresh backup and daemon stop evidence.
- Resolve the remaining source of MCP-triggered old-checkout daemon startup before release.
