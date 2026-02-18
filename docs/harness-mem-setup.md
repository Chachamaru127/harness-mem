# Harness-mem Setup Guide

This guide is the detailed reference for setup, diagnostics, migration, and environment tuning.

If you only want to get started quickly, use `/README.md` first.

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

## 2. Setup Flow

`harness-mem setup` performs:

1. Dependency checks (`bun`, `node`, `curl`, `jq`)
2. Tool wiring (Codex, OpenCode, Cursor)
3. Daemon start (`harness-memd`)
4. Smoke test
5. Search quality guard
6. Optional Claude-mem import + optional Claude-mem stop

When `--platform` is omitted, setup is interactive:

1. Language
2. Target tools (multi-select)
3. Import from Claude-mem (yes/no)
4. Stop Claude-mem after verified import (yes/no)

## 3. Command Reference

### `setup`

Configure wiring, start daemon, and run verification checks.

```bash
harness-mem setup
harness-mem setup --platform codex,cursor
harness-mem setup --platform opencode,cursor --skip-quality
```

Options:

- `--platform <all|codex|opencode|claude|cursor|comma-list>`
- `--skip-start`
- `--skip-smoke`
- `--skip-quality`
- `--project <path>`
- `--quiet`

### `doctor`

Validate wiring and daemon health.

```bash
harness-mem doctor
harness-mem doctor --platform codex,cursor
harness-mem doctor --fix --platform opencode
```

Options:

- `--fix`
- `--platform <all|codex|opencode|claude|cursor|comma-list>`
- `--project <path>`
- `--quiet`

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
- `--platform <all|codex|opencode|claude|cursor|comma-list>`

### `import-claude-mem`

Import from existing Claude-mem SQLite.

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

Stop Claude-mem only after verification passed.

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
- Checks ingest primary path from sessions rollout logs

### OpenCode

- Uses `~/.config/opencode/opencode.json`
- Uses `~/.config/opencode/plugins/harness-memory/index.ts`
- `doctor --fix --platform opencode` normalizes config schema

### Cursor

- Uses `~/.cursor/hooks.json`
- Uses `~/.cursor/hooks/memory-cursor-event.sh`
- Ingests events from hook spool path

### Claude workflows

- Validates compatibility hooks through harness plugin checks
- Supports import/verify/cutover migration flow

### Antigravity

- Experimental and hidden by default
- Requires explicit enable flags

## 5. Environment Variables

### Core runtime

- `HARNESS_MEM_HOST` (default: `127.0.0.1`)
- `HARNESS_MEM_PORT` (default: `37888`)

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

### Cursor ingest

- `HARNESS_MEM_ENABLE_CURSOR_INGEST` (default: `true`)
- `HARNESS_MEM_CURSOR_EVENTS_PATH` (default: `~/.harness-mem/adapters/cursor/events.jsonl`)
- `HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_CURSOR_BACKFILL_HOURS` (default: `24`)

### Antigravity ingest

- `HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST` (default: `false`)
- `HARNESS_MEM_ANTIGRAVITY_ROOTS` (default: auto-detect)
- `HARNESS_MEM_ANTIGRAVITY_LOGS_ROOT` (default: `~/Library/Application Support/Antigravity/logs`)
- `HARNESS_MEM_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT` (default: `~/Library/Application Support/Antigravity/User/workspaceStorage`)
- `HARNESS_MEM_ANTIGRAVITY_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_ANTIGRAVITY_BACKFILL_HOURS` (default: `24`)

## 6. API Endpoints Used by UI / Diagnostics

- `GET /v1/feed`
- `GET /v1/stream`
- `GET /v1/projects/stats`
- `GET /v1/sessions/list`
- `GET /v1/sessions/thread`
- `GET /v1/search/facets`
- `POST /v1/ingest/codex-history`
- `POST /v1/ingest/codex-sessions`
- `POST /v1/ingest/opencode-history`
- `POST /v1/ingest/opencode-sessions`
- `POST /v1/ingest/cursor-history`
- `POST /v1/ingest/cursor-events`
- `POST /v1/ingest/antigravity-history`
- `POST /v1/ingest/antigravity-files`
- `POST /v1/events/record`

## 7. Import and Cutover Playbook

1. Import data:

```bash
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
```

2. Verify quality and privacy checks:

```bash
harness-mem verify-import --job <job_id>
```

3. Cut over only after verification passes:

```bash
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

## 8. Validation Checklist

Run these after setup:

```bash
harness-mem doctor
harness-mem smoke
./tests/test-memory-search-quality.sh
```

Expected outcome:

- daemon is healthy
- wiring is present for selected platforms
- private/sensitive records stay hidden by default
- quality guard checks pass

## 9. Local Repository Usage

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem
scripts/harness-mem setup
scripts/harness-mem doctor
```

## 10. Mem UI (Standalone)

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui
bun install
bun run dev
```

Default URL: `http://127.0.0.1:37901`

## 11. Uninstall and Cleanup

```bash
harness-mem uninstall
harness-mem uninstall --purge-db
```

This will:

- stop daemon
- remove managed wiring blocks
- remove OpenCode plugin wiring
- optionally remove `~/.harness-mem/harness-mem.db`

## 12. Related Files

- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-mem`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-memd`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-mem-client.sh`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/test-memory-search-quality.sh`
