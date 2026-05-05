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
