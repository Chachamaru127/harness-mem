# S131 Remaining Purge + Release Decision (2026-05-21)

## Result

PASS. The remaining 90 archived observations were hard-purged after a fresh
restorable backup and a new preverified backup evidence token.

Release decision: release-candidate-ready. npm publish, git tag, and GitHub
Release still require separate approval.

## Runtime Cleanup

- `harness-mem doctor --fix --platform codex --skip-version-check` repaired
  Codex wiring, hooks, and skill drift.
- Daemon, Mem UI, and MCP gateway LaunchAgents were aligned to the same S130/S131
  worktree:
  `/Users/tachibanashuuta/.codex/worktrees/c6b1/harness-mem`.
- Final health: ready, embedding ready, health warnings `[]`.
- Doctor result: failed count `0`, warning count `1`.
- Remaining doctor warning: daemon `reachable_with_warnings`; classified
  non-blocking because `/health` reports no daemon warnings.

## Backup Evidence

- Backup:
  `/Users/tachibanashuuta/.harness-mem/s131/harness-mem-backup-2026-05-21T05-18-16-046Z.db`.
- Backup size: `14,377,254,912` bytes.
- Backup SHA-256:
  `aee8903cc5f7e0f5848a5f0f12bc7b5b1477fa546c8d832235ba7f2fb5120014`.
- Backup `PRAGMA integrity_check`: `ok`.
- Evidence token SHA-256:
  `c3953cf15d0e2f4441710acb35234f5021d6b0c3f8001b63efee383a1c7b878d`.
- Candidate coverage SHA-256:
  `6cde0f6cd7b35b0af353b6cadb3efc0634830985ea6684b8f5be5d4ba0032ea0`.
- Raw token and confirmation phrase were not committed.

## Hard Purge

- Manifest:
  `51ee798b2a265abd4939c6141fbf0983ecfb5e9c82595f624357d9aadcfc1035`.
- Candidate count: `90`.
- Legal hold blockers: `0`.
- Restore-capable archive rows: `90 / 90`.

Deleted counts:

- Observations: `90`.
- `mem_vectors`: `127`.
- sqlite-vec rows/map rows: `254`.
- links touching targets: `161`.
- facts: `7`.
- events: `90`.
- tags: `229`.
- archive stubs marked purged: `90`.
- full archive payloads cleared: `90`.

Post-purge counts:

- Archived stubs remaining: `0`.
- Purged stubs total: `100`.
- Full payloads available: `0`.
- Full payloads cleared: `100`.
- Remaining target observations: `0`.
- Audit entry for S131 manifest: `1`.
- Replay after purge: rejected as non-executable because hard-purge target rows
  are missing after physical deletion.

## Compact Decision

No full `VACUUM INTO` was executed after S131.

Reason: after the 90-row purge, `freelist_count=316` with `page_size=4096`,
or about `1,294,336` reclaimable bytes. Copying the full 14GB DB for about
1.3MB of recovery is not operationally worth it.

Current live DB:

- Size: `14,397,116,416` bytes.
- WAL size: `5,854,552` bytes.
- DB SHA-256:
  `158af21e06cc686142021e03329a41c7104ca7a4d9ae52e20cfc3e2c451d50c7`.

## Verification

- `git diff --check`: PASS.
- `bash -n scripts/harness-mem scripts/harness-mem-client.sh`: PASS.
- Targeted tests: PASS, `30 pass / 0 fail / 397 expect calls`.
- `cd memory-server && bun run typecheck`: PASS.
- `npm pack --dry-run --json`: PASS,
  `@chachamaru127/harness-mem@0.23.0`, `533` files.
- `./scripts/harness-mem smoke`: PASS.
- `./scripts/harness-mem doctor --json --platform codex --skip-version-check --read-only`:
  degraded but failed count `0`; remaining warning is non-blocking daemon
  reachable-with-warnings.

## Release Boundary

- Ready for release-candidate review.
- Do not publish npm without separate approval.
- Do not create git tag without separate approval.
- Do not create GitHub Release without separate approval.
- Before formal release, decide whether LaunchAgents should keep pointing at
  this S130/S131 worktree or be moved back to the canonical checkout after
  merge.
