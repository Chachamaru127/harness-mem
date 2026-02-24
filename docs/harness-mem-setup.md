# Harness-mem Setup Guide

This guide is the detailed reference for setup, diagnostics, migration, and environment tuning.
If you only need a quick start, read `README.md` first.

## 1. Installation Paths

### npx (no global install)

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### global install

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup
```

### update existing install

```bash
harness-mem update
```

`harness-mem update` asks whether to enable auto-update opt-in, then runs:

```bash
npm install -g @chachamaru127/harness-mem@latest
```

## 2. Setup Flow

`harness-mem setup` performs:

1. Dependency checks (`bun`, `node`, `curl`, `jq`, `ripgrep`)
2. Tool wiring (Codex, OpenCode, Cursor, Claude, Antigravity)
3. Daemon start (`harness-memd`)
4. Mem UI start (`http://127.0.0.1:37901` by default)
5. Smoke test (unless `--skip-smoke`)
6. Search quality checks (unless `--skip-quality`)
7. Optional Claude-mem import + optional stop after verified cutover
8. Version snapshot (local vs upstream)

When `--platform` is omitted, setup is interactive:

1. Language
2. Target tools (multi-select)
3. Import from Claude-mem (yes/no)
4. Stop Claude-mem after verified import (yes/no)
5. Enable auto-update opt-in (yes/no)

If auto-update opt-in is enabled, `harness-mem` checks npm for newer versions periodically (default: every 24 hours) before command execution and runs:

```bash
npm install -g @chachamaru127/harness-mem@latest
```

Notes:
- Config is stored in `~/.harness-mem/config.json` (`auto_update.enabled`).
- Auto-update checks are skipped in repo checkout mode and npx runtime mode.
- Temporarily disable auto-update checks per command with `HARNESS_MEM_SKIP_AUTO_UPDATE=1`.

## 3. Command Reference

### `setup`

Configure wiring, start daemon/UI, and run verification checks.

```bash
harness-mem setup
harness-mem setup --platform codex,cursor
harness-mem setup --platform opencode,cursor --skip-quality
```

Options:

- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`
- `--skip-start`
- `--skip-smoke`
- `--skip-quality`
- `--skip-version-check`
- `--project <path>`
- `--quiet`

### `doctor`

Validate wiring and daemon/UI health.

```bash
harness-mem doctor
harness-mem doctor --platform codex,cursor
harness-mem doctor --fix --platform opencode
```

Options:

- `--fix`
- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`
- `--skip-version-check`
- `--project <path>`
- `--quiet`

### `update`

Update the global package and set auto-update opt-in interactively.

```bash
harness-mem update
```

Notes:

- On interactive TTY, it prompts: `Enable opt-in automatic updates for harness-mem?` (`y/N`).
- The selected value is stored in `~/.harness-mem/config.json` (`auto_update.enabled`).

### `versions`

Snapshot local and upstream versions for supported tools.

```bash
harness-mem versions
```

Outputs:

- `~/.harness-mem/versions/tool-versions.json`
- `~/.harness-mem/versions/tool-versions-history.jsonl`

### `smoke`

Run isolated end-to-end validation for record/search + privacy behavior.

```bash
harness-mem smoke
```

### `uninstall`

Remove wiring and optionally purge local DB.

```bash
harness-mem uninstall
harness-mem uninstall --purge-db
```

Options:

- `--purge-db`
- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`

### `import-claude-mem`

Import from an existing Claude-mem SQLite DB.

```bash
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db --dry-run
```

Options:

- `--source <path>`
- `--import-project <name>`
- `--dry-run`
- `--quiet`

### `verify-import`

Verify an import job before cutover.

```bash
harness-mem verify-import --job <job_id>
```

Options:

- `--job <job_id>`
- `--quiet`

### `cutover-claude-mem`

Stop Claude-mem only after verification passes.

```bash
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

Options:

- `--job <job_id>`
- `--stop-now`
- `--quiet`

## 4. Platform Wiring Details

### Codex

- Verifies memory bridge entries in `~/.codex/config.toml`
- Checks ingest path from Codex session logs

### OpenCode

- Uses `~/.config/opencode/opencode.json`
- Uses `~/.config/opencode/plugins/harness-memory/index.ts`
- `doctor --fix --platform opencode` can normalize config schema

### Cursor

- Uses `~/.cursor/hooks.json`
- Uses `~/.cursor/hooks/memory-cursor-event.sh`
- Uses `~/.cursor/mcp.json` (`mcpServers.harness`)

### Claude workflows

- Configures `mcpServers.harness` in `~/.claude.json`
- Updates `~/.claude/settings.json` if an MCP block already exists
- Supports import/verify/cutover migration flow

### Antigravity

- Experimental and hidden by default
- Requires explicit opt-in flags

## 5. Environment Variables

### Core runtime

- `HARNESS_MEM_HOST` (default: `127.0.0.1`)
- `HARNESS_MEM_PORT` (default: `37888`)
- `HARNESS_MEM_UI_PORT` (default: `37901`)
- `HARNESS_MEM_ENABLE_UI` (default: `true`)
- `HARNESS_MEM_LOG_MAX_BYTES` (default: `5242880`, 5MB)
- `HARNESS_MEM_LOG_ROTATE_KEEP` (default: `5`)

### Codex ingest

- `HARNESS_MEM_CODEX_SESSIONS_ROOT` (default: `~/.codex/sessions`)
- `HARNESS_MEM_CODEX_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_CODEX_BACKFILL_HOURS` (default: `24`)

### OpenCode ingest

- `HARNESS_MEM_ENABLE_OPENCODE_INGEST` (default: `true`)
- `HARNESS_MEM_OPENCODE_DB_PATH` (default: `~/.local/share/opencode/opencode.db`)
- `HARNESS_MEM_OPENCODE_STORAGE_ROOT` (default: `~/.local/share/opencode/storage`)
- `HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_OPENCODE_BACKFILL_HOURS` (default: `24`)

## 6. Environment Tab (read-only)

Mem UI now includes an `Environment` tab for non-specialists.

- Purpose:
  - Show current internal servers
  - Show installed languages/runtimes
  - Show installed CLI tools
  - Show AI/MCP tool status
- API:
  - daemon: `GET /v1/admin/environment` (admin token required)
  - UI proxy: `GET /api/environment`
- Safety:
  - V1 is read-only
  - API masks sensitive values (`token`, `api_key`, `secret`, etc.)

Contract details: `docs/plans/environment-tab-v1-contract.md`

## 7. Troubleshooting

### Command not found

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### Doctor reports missing dependencies

Install required dependencies and repair:

```bash
harness-mem doctor --fix
```

### UI does not open

```bash
harness-memd doctor
curl -sS http://127.0.0.1:37901/api/health | jq '.ok'
```

### Need full cleanup

```bash
harness-mem uninstall --purge-db
```

## 8. Related Docs

- `README.md`
- `README_ja.md`
- `docs/plans/environment-tab-v1-contract.md`
- `CHANGELOG.md`
- `CHANGELOG_ja.md`
- `docs/benchmarks/`
