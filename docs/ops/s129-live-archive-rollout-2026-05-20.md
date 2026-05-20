# S129 Live Archive-First Rollout

- generated_at: 2026-05-20T09:17:41Z
- generated_at_jst: 2026-05-20 18:17:41 JST
- result: PASS
- live_db: `/Users/tachibanashuuta/.harness-mem/harness-mem.db`
- hard_purge: not executed
- vacuum: not executed

## Backup

- path: `/Users/tachibanashuuta/.harness-mem/harness-mem-backup-2026-05-20T08-49-44-193Z.db`
- size_bytes: 14241361920
- sha256: `2c566c961d2a53048718fd25afd80b669ba19b44bd5988c1b63cc9e8d2713734`
- integrity_check: ok

## Runtime

- LaunchAgent plist: `/Users/tachibanashuuta/Library/LaunchAgents/com.harness-mem.daemon.plist`
- LaunchAgent backup: `/Users/tachibanashuuta/.harness-mem/launchd-backups/com.harness-mem.daemon.plist.pre-s129-20260520181634`
- entry: `/Users/tachibanashuuta/.codex/worktrees/c6b1/harness-mem/memory-server/src/index.ts`
- working_directory: `/Users/tachibanashuuta/.codex/worktrees/c6b1/harness-mem`
- health: ok
- pid: 48548

## Baseline

- observations_total: 345266
- observations_archived: 0
- legal_hold_tags: 0
- archive tables before rollout: none

## Schema Rollout

- `mem_archive_stubs`: created
- `mem_archive_full`: created
- initial `mem_archive_stubs` rows: 0
- initial `mem_archive_full` rows: 0
- integrity_check_after_schema: ok

## Archive Plan

- candidate_count: 100
- manifest_sha256: `0505353927d0c51d6c7bfee8a470b121fca5242b0ac7c48bc9b8cc8991a46b14`
- cross_store_impact:
  - observations: 100
  - mem_vectors: 147
  - mem_links_touching: 205
  - mem_facts: 9
  - mem_events: 100
  - mem_tags: 261
  - mem_vectors_vec_map: 147

## Archive Execute

- note: counts are point-in-time. Live history ingest resumed after LaunchAgent restart, so total observation count may drift; the safety counters are archived/stub/full.
- execute: true
- archived_count: 100
- skipped_legal_hold: 0
- skipped_already_archived: 0
- archive_state `archived`: 100
- `mem_archive_stubs` rows: 100
- `mem_archive_full` rows: 100
- `admin.archive.create` audit rows: 1

## Read-Path Checks

- `get_observations` default count for archived sample: 0
- `verify` default on archived sample: rejected as expected
- `verify include_archived=true` on archived sample: ok
- default search contains archived sample: false
- archive stub raw-content check: stub has no raw content
- archive stub search endpoint: ok
- archive stub search returns `payload_json`: false
- archive stub search returns raw content: false

## Restore-To-Copy

- copy_path: `/tmp/s129-restore-copy-20260520180806.db`
- copy_retained: false
- copy_integrity_check: ok
- copy archived/stub/full counts before restore: 100 / 100 / 100
- restore plan on copy: ok
- restore execute on copy: ok
- restored archive_state on copy: restored
- restored observation `archived_at` on copy: null
- sqlite-vec repair on copy: ok, repaired=2, failed=0, skipped=0

## Boundary

This rollout stopped at archive-first. It did not hard purge rows and did not run
VACUUM or `VACUUM INTO` compaction after archive.
