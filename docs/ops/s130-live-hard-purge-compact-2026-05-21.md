# S130 Live Hard Purge Canary + Safe Compact Evidence (2026-05-21)

## Summary

- Result: PASS.
- Live DB: `/Users/tachibanashuuta/.harness-mem/harness-mem.db`.
- Fresh restorable backup: `/Users/tachibanashuuta/.harness-mem/s130/harness-mem-backup-2026-05-21T04-05-55-483Z.db`.
- Backup SHA-256: `f44284dcf05cb5d5ff425a10163bb7154a5714536fff25d682dcd9ecad4449a1`.
- Backup `PRAGMA integrity_check`: `ok`.
- Candidate scope: 10 archived observations.
- Hard purge manifest: `fc5de703d760a19e63c02975115d6a6f631343faab6e2c913a8df374991f97aa`.
- Compact result: live DB size `14,874,537,984` bytes -> `14,374,510,592` bytes.
- Reclaimed bytes: `500,027,392`.

## Backup Evidence

- Evidence kind: `preverified_backup`.
- Evidence token was not written to this artifact.
- Evidence token SHA-256: `91196f574136f75dbfa7535265bdd2165adf12b21ac153b780364b0acec4aeb1`.
- Candidate coverage SHA-256: `6b8ac3881d11950aff97295bcf623a98ef79fe0c6d15330700a54e30fbb71584`.
- Evidence checks: backup path, size, SHA-256, SQLite integrity, DB identity, and exact candidate archive/full-payload coverage.

## Readiness

- `readiness_only:true`: PASS.
- Candidate count: `10`.
- `confirmation_phrase`: absent.
- Active execute window: not created by readiness.
- Legal hold blockers: `0`.
- Restore-capable archive rows: `10 / 10`.
- Impact: observations `10`, mem_vectors `20`, sqlite-vec map rows `20`, links touching target `44`, facts `2`, events `10`, tags `32`.

## Execute

- Hard purge canary: PASS.
- Deleted observations: `10`.
- Deleted vector rows: `20`.
- Deleted sqlite-vec rows: `40`.
- Deleted links touching target: `44`.
- Deleted facts: `2`.
- Deleted events: `10`.
- Deleted tags: `32`.
- Archive stubs marked `purged`: `10`.
- Full archive payloads cleared: `10`.
- Audit entry: `admin.purge.execute` present.
- Token replay with a remaining archived row was rejected as `preverified_backup_evidence_token is unknown or consumed`.

## Post-Purge Verification

- Target observations remaining in `mem_observations`: `0`.
- Target `get_observations` result count: `0`.
- Total archived stubs remaining: `90`.
- Total purged stubs: `10`.
- Full payloads still available: `90`.
- Full payloads cleared: `10`.
- Daemon health after purge: ready.

## Compact

- Method: stop LaunchAgent daemon, `sqlite3 VACUUM INTO`, verify compact DB, move live DB to rollback path, move compact DB into live path, restart daemon.
- Rollback DB: `/Users/tachibanashuuta/.harness-mem/s130/harness-mem-pre-compact-live-2026-05-21T04-36-00Z.db`.
- Rollback SHA-256: `89d7d3b70e9ba62e86add0c992731a248f43d814bdc88d7e153a570e0c2162fc`.
- New live DB SHA-256: `ac1b77f057d970dc5dd5c495aa116dd8312297f83697cd9ba55f913c205f76eb`.
- New live DB `PRAGMA integrity_check`: `ok`.
- Page count: `3,631,479` -> `3,509,402`.
- Freelist count: `74` -> `0`.
- Page size: `4096`.
- Daemon health after compact: ready.

## Notes

- LaunchAgent `com.harness-mem.daemon` was switched to the S130 worktree before live verification because it had drifted back to the main checkout.
- Raw preverified token and confirmation phrase were intentionally omitted from committed evidence.
