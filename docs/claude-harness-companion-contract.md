# Claude-harness Companion Contract

harness-mem is the runtime owner for Claude-harness memory. Claude-harness may install, call, and display harness-mem state, but it must not embed harness-mem internals.

## Ownership

| Owner | Owns |
|---|---|
| harness-mem | daemon, local database, migrations, runtime copy, setup wiring, doctor checks, update flow, uninstall and purge behavior |
| Claude-harness | companion discovery, one-time setup trigger, `harness mem` command UX, hook wiring, compatibility display |

Claude-harness must never read the SQLite schema directly. The database remains an implementation detail of harness-mem.

## Standard Paths

| Resource | Path |
|---|---|
| Local DB | `~/.harness-mem/harness-mem.db` |
| Runtime copy | `~/.harness-mem/runtime/harness-mem` |
| Config | `~/.harness-mem/config.json` |
| Last doctor artifact | `~/.harness-mem/runtime/doctor-last.json` |

## Setup Contract

Claude-harness may run:

```bash
HARNESS_MEM_NON_INTERACTIVE=1 \
harness-mem setup \
  --platform codex,claude \
  --skip-quality \
  --auto-update enable
```

Requirements:

- `--platform codex,claude` must skip target-selection prompts.
- `--auto-update enable|disable` must set auto-update without prompting.
- `HARNESS_MEM_NON_INTERACTIVE=1` must suppress interactive prompts.
- Setup may create runtime/config/wiring, but must not delete the local DB.

## Doctor JSON Contract

`harness-mem doctor --json --platform codex,claude` must write one JSON object to stdout.

Minimum fields:

```json
{
  "status": "healthy",
  "all_green": true,
  "failed_count": 0,
  "checks": [],
  "fix_command": "harness-mem doctor --fix",
  "backend_mode": "local",
  "contract_version": "claude-harness-companion.v1",
  "harness_mem_version": "0.18.0"
}
```

Additional fields are allowed. Claude-harness treats malformed JSON as an unknown companion state.

## Update Contract

`harness-mem update` owns package update and post-update repair. If auto-update is enabled, the config records the remembered repair platforms, and update may run a quiet `doctor --fix` for those platforms.

Claude-harness only delegates to this command.

## Off And Purge

| Operation | harness-mem command | Meaning |
|---|---|---|
| off | `harness-mem recall off` | Disable contextual recall injection. Search and stored data remain available. |
| purge | `harness-mem uninstall --platform codex,claude --purge-db` | Remove wiring and delete the local DB. Callers must require explicit confirmation before using this. |

Automatic setup must never call purge.

## Compatibility Notes

- Contract version: `claude-harness-companion.v1`.
- DB migrations remain harness-mem-only.
- Claude-harness compatibility checks should use `doctor --json`, not direct filesystem or SQLite inspection except for detecting whether a CLI/runtime exists.

## Cross-repo Handoff Workflow

Cross-repo handoff between `claude-code-harness` and `harness-mem` follows a two-tier rule based on the change classification (see `CrossRepo-Manifest.md`):

| Change kind | Where the handoff lives | Why |
|---|---|---|
| **Cross-Contract** (role boundary, contract surface, owner-side spec implementation) | The owner repo's `Plans.md §NNN` is the single source of truth (e.g. `harness-mem` §106 companion contract, §107 checkpoint cold-start). Sibling repos reference the section. | Contracts need a detailed DoD table, dependency graph, and a status column; a GitHub Issue does not carry that surface well. The owner repo already operates `Plans.md` as its planning SSOT. |
| **Cross-Runtime** (asking the sibling repo to change behavior) | Open a GitHub Issue on the sibling repo (`gh issue create --repo Chachamaru127/<other-repo>`). Implementation timing and approach are owned by the sibling. See `patterns.md` P7 and XR-003 #70 / XR-004 #126 for prior examples. | The receiving repo retains the right to schedule, decline, or counter-propose. Direct PRs into a sibling repo can be re-implemented and CLOSED (XR-003 PR #92 incident). |

Long-running follow-ups that span multiple sessions (e.g. XR-003 follow-up Issue #70) may also use GitHub Issues even when classified as Cross-Contract, but the per-task DoD still lives in the owner repo's `Plans.md`.

GitHub Issues are intentionally **not** used for owner-side contract specs in `harness-mem`. If `claude-code-harness` discovers that a behavior belongs in `harness-mem`, the expected handoff is: (1) note it in the relevant `Plans.md` section, (2) open a Cross-Runtime Issue on `harness-mem` only when a concrete behavior change is requested.

### References

- `claude-code-harness/.claude/rules/cross-repo-handoff.md` — shareable policy doc with 3-Layer Redaction ownership table, 2-route handoff workflow, decision criteria, and review triggers (commit `8fd8c0e8`).
- `claude-code-harness/.claude/memory/decisions.md` D42 — full ADR (per-developer local SSOT; `.gitignore`-excluded by design).
- `harness-mem/.claude/memory/patterns.md` P7 — cross-repo Issue-first rule with the Cross-Contract / Plans.md SSOT exemption.
- `harness-mem/Plans.md` §110 — codification work (S110-001/002 contract & patterns updates, S110-003 reciprocal cross-check completed against `8fd8c0e8`).
