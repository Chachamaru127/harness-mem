# S130 Release Reflection Review (2026-05-21)

## Result

Release reflection is PASS with one non-blocking local-environment finding:
Codex wiring/skill drift is still present in the operator home config. The
daemon, package surface, lifecycle API contract, live hard-purge evidence, and
smoke path passed.

Publish, git tag, and GitHub Release were not executed. They remain a separate
release approval.

## Scope Reviewed

- Implementation commits: `8272934`, `f771a19`, `43dd201`, `c25c819`.
- Live ops evidence:
  `docs/ops/s130-live-hard-purge-compact-2026-05-21.md`.
- Design/spec surface:
  `docs/memory-lifecycle-archive-design.md`.
- API/CLI surface: `docs/openapi.yaml`, `scripts/harness-mem`,
  `scripts/harness-mem-client.sh`.
- Release notes: `CHANGELOG.md`, `CHANGELOG_ja.md`.
- README surface: reviewed and intentionally left unchanged because the new
  destructive admin lifecycle is documented in the dedicated lifecycle spec,
  OpenAPI, CLI help, and changelog rather than in the general user quickstart.

## Live Evidence Summary

- Restorable backup:
  `/Users/tachibanashuuta/.harness-mem/s130/harness-mem-backup-2026-05-21T04-05-55-483Z.db`.
- Backup SHA-256:
  `f44284dcf05cb5d5ff425a10163bb7154a5714536fff25d682dcd9ecad4449a1`.
- Backup integrity: `PRAGMA integrity_check = ok`.
- Preverified evidence token was not committed; only token SHA-256 was recorded.
- Candidate coverage SHA-256:
  `6b8ac3881d11950aff97295bcf623a98ef79fe0c6d15330700a54e30fbb71584`.
- Hard purge canary: 10 archived observations purged.
- Post-purge live DB counts: archived stubs `90`, purged stubs `10`, cleared
  full payloads `10`.
- Safe compact: live DB `14,874,537,984` bytes -> `14,374,510,592` bytes.
- Reclaimed bytes: `500,027,392`.
- Rollback DB:
  `/Users/tachibanashuuta/.harness-mem/s130/harness-mem-pre-compact-live-2026-05-21T04-36-00Z.db`.
- Post-compact live DB integrity: `ok`.

## Verification Matrix

| Check | Result | Evidence |
|---|---:|---|
| `git diff --check` | PASS | no output |
| `bun test memory-server/tests/unit/hard-purge.test.ts memory-server/tests/integration/admin.test.ts tests/mcp-memory-tool-descriptions.test.ts tests/harness-mem-backup-evidence-cli-contract.test.ts` | PASS | 30 pass / 0 fail / 397 expect calls |
| `cd memory-server && bun run typecheck` | PASS | `bunx tsc --noEmit` exited 0 |
| `bash -n scripts/harness-mem scripts/harness-mem-client.sh` | PASS | exited 0 |
| `npm pack --dry-run --json` | PASS | `@chachamaru127/harness-mem@0.23.0`, package `4,986,722` bytes, unpacked `16,718,296` bytes, 533 files |
| `./scripts/harness-mem smoke` | PASS | isolated smoke test OK |
| `curl http://127.0.0.1:37888/health/ready` | PASS | `meta.ready=true`, adaptive embeddings healthy |
| `./scripts/harness-mem doctor --json --platform codex --skip-version-check --read-only` | NON-BLOCKING FAIL | daemon OK; failed checks are `codex_wiring` and `codex_skill_drift` in local home config |
| `./scripts/harness-mem doctor --fix --plan --platform codex --skip-version-check` | REVIEWED | no changes applied; plan recommends `harness-mem setup --platform codex` / `harness-mem doctor --fix` |

## Release Findings

1. Code/API release surface is ready for review: targeted lifecycle tests,
   OpenAPI contract, MCP exclusion contract, CLI backup-evidence contract,
   typecheck, and package dry-run all pass.
2. Live DB destructive flow behaved as intended: purge required fresh
   restorable backup, preverified candidate coverage, manifest match, legal-hold
   clearance, and confirmation; token replay was rejected.
3. Compact was operationally safe: daemon was stopped, a compact DB was written
   with `VACUUM INTO`, compact integrity was checked, the old live DB was moved
   to a rollback path, and the daemon restarted healthy.
4. Codex local wiring drift is real but outside this package release gate. It
   should be fixed separately with `harness-mem doctor --fix` or
   `harness-mem setup --platform codex` when the operator wants to update home
   config and skills.

## Release Boundary

- Do not publish npm, create a tag, or create a GitHub Release without a
  separate release approval.
- Do not hard purge the remaining 90 archived rows without a new candidate
  manifest, fresh backup evidence, and approval.
- The LaunchAgent currently points at this S130 worktree for live validation.
  Before a formal release, decide whether to keep that runtime pointer or move
  it back to the canonical checkout after merge.
