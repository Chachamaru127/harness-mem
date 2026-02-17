# Harness Memory Setup Guide

`harness-mem` is the unified setup/operation entrypoint for shared memory across Claude Code, Codex, OpenCode, Cursor, and Antigravity.

## Quick Start

```bash
# from any project directory
/absolute/path/to/harness-mem/scripts/harness-mem setup
```

## Install After-Flow (Beginner Friendly)

`harness-mem` install alone is not enough.  
You must run project wiring once per workspace.

1. Run setup in the target project.

```bash
cd /your/project
/absolute/path/to/harness-mem/scripts/harness-mem setup --project "$PWD" --platform cursor --skip-start --skip-smoke --skip-quality
```

2. Validate wiring.

```bash
/absolute/path/to/harness-mem/scripts/harness-mem doctor --project "$PWD" --platform cursor
```

3. Send one message from Cursor, then verify feed count.

```bash
curl -sS 'http://127.0.0.1:37901/api/feed?project='$(basename "$PWD")'&limit=5&include_private=false' | jq '.ok, .meta.count'
```

Antigravity ingest is currently pending by default (hidden). If you temporarily enable it for verification, set envs explicitly:

```bash
export HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST=true
export HARNESS_MEM_ANTIGRAVITY_ROOTS=/absolute/path/to/antigravity-workspace
# then restart daemon and run manual ingest endpoint
curl -sS -X POST http://127.0.0.1:37888/v1/ingest/antigravity-history | jq '.ok, .items[0]'
```

What `setup` does:

1. Validates dependencies (`bun`, `node`, `curl`, `jq`)
2. Wires Codex memory bridge (`.codex/config.toml`)
3. Wires OpenCode memory bridge (`opencode.json`, `.opencode/opencode.json`, plugin files)
4. Wires Cursor memory hooks (`.cursor/hooks.json`, `.cursor/hooks/memory-cursor-event.sh`)
5. Validates Claude memory hook availability in harness plugin
6. Starts `harness-memd`
7. Runs isolated smoke test
8. Runs search quality guard test suite

## Commands

### Setup

```bash
scripts/harness-mem setup
scripts/harness-mem setup --platform codex
scripts/harness-mem setup --platform cursor
scripts/harness-mem setup --skip-quality
```

### Doctor

```bash
scripts/harness-mem doctor
scripts/harness-mem doctor --fix
```

Checks:

- daemon readiness (`scripts/harness-memd doctor`)
- Codex wiring (`notify`, `mcp_servers.harness`)
- Codex ingest primary path (`~/.codex/sessions/**/rollout-*.jsonl`)
- OpenCode wiring (`harness-memory` plugin + MCP)
- Cursor hook wiring (`beforeSubmitPrompt/afterMCPExecution/afterShellExecution/afterFileEdit/stop`)
- Claude memory hook availability

### Smoke

```bash
scripts/harness-mem smoke
```

Isolated end-to-end check:

- record public/private events
- default search hides private
- `include_private=true` reveals private

### Uninstall

```bash
scripts/harness-mem uninstall
scripts/harness-mem uninstall --purge-db
```

Behavior:

- stops daemon
- removes marker-managed Codex wiring blocks
- removes OpenCode memory wiring
- optional DB purge (`~/.harness-mem/harness-mem.db`)

### Claude-mem Import (One-shot)

```bash
# 1) import
scripts/harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db

# 2) verify
scripts/harness-mem verify-import --job <job_id>

# 3) cutover (stop Claude-mem immediately after verify pass)
scripts/harness-mem cutover-claude-mem --job <job_id> --stop-now
```

Behavior:

- imports `observations`, `session_summaries`, `sdk_sessions` via schema introspection
- preserves privacy tags (`private/sensitive`) with default-hidden behavior
- blocks cutover unless verify checks pass
- cutover performs Claude-mem stop + launch-agent disable + known JSON config cleanup

## Mem UI (Separated App)

`harness-mem-ui` is a standalone app and does not depend on `harness-ui`.

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui
bun install
bun run dev
```

Default URL: `http://127.0.0.1:37901`

UI feature flag:

- `HARNESS_MEM_UI_PARITY_V1=true` (default): React + TypeScript parity UI
- `HARNESS_MEM_UI_PARITY_V1=false`: legacy static fallback

Required daemon connection envs:

- `HARNESS_MEM_HOST` (default: `127.0.0.1`)
- `HARNESS_MEM_PORT` (default: `37888`)

Codex ingest envs:

- `HARNESS_MEM_CODEX_SESSIONS_ROOT` (default: `~/.codex/sessions`)
- `HARNESS_MEM_CODEX_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_CODEX_BACKFILL_HOURS` (default: `24`)

OpenCode ingest envs:

- `HARNESS_MEM_ENABLE_OPENCODE_INGEST` (default: `true`)
- `HARNESS_MEM_OPENCODE_DB_PATH` (default: `~/.local/share/opencode/opencode.db`)
- `HARNESS_MEM_OPENCODE_STORAGE_ROOT` (default: `~/.local/share/opencode/storage`)
- `HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_OPENCODE_BACKFILL_HOURS` (default: `24`)

Cursor ingest envs:

- `HARNESS_MEM_ENABLE_CURSOR_INGEST` (default: `true`)
- `HARNESS_MEM_CURSOR_EVENTS_PATH` (default: `~/.harness-mem/adapters/cursor/events.jsonl`)
- `HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_CURSOR_BACKFILL_HOURS` (default: `24`)

Antigravity ingest envs:

- `HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST` (default: `false`)
- `HARNESS_MEM_ANTIGRAVITY_ROOTS` (default: auto-detect from Antigravity workspaceStorage; comma/newline separated roots for override)
- `HARNESS_MEM_ANTIGRAVITY_LOGS_ROOT` (default: `~/Library/Application Support/Antigravity/logs`)
- `HARNESS_MEM_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT` (default: `~/Library/Application Support/Antigravity/User/workspaceStorage`)
- `HARNESS_MEM_ANTIGRAVITY_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_ANTIGRAVITY_BACKFILL_HOURS` (default: `24`)

Notes:

- Codex record ingest primary path is sessions rollout ingest.
- `notify` hook is optional low-latency assist path (best effort); ingest does not depend on it.
- Cursor record ingest primary path is hook spool ingest (`HARNESS_MEM_CURSOR_EVENTS_PATH`).
- Antigravity support is currently pending and hidden by default until official hooks are available.
- If you explicitly enable Antigravity ingest, primary path is workspace file ingest (`docs/checkpoints/*.md`, `logs/codex-responses/*.md`).
- Planner log fallback does not include raw prompt body; it records activity metadata only.
- Manual ingest endpoints:
  - `POST /v1/ingest/codex-history` (compat route, hybrid ingest)
  - `POST /v1/ingest/codex-sessions` (alias)
  - `POST /v1/ingest/opencode-history` / `POST /v1/ingest/opencode-sessions`
  - `POST /v1/ingest/cursor-history` / `POST /v1/ingest/cursor-events`
  - `POST /v1/ingest/antigravity-history` / `POST /v1/ingest/antigravity-files`
- `POST /v1/events/record` supports `platform=cursor|antigravity` as compatible supplemental path.

Parity UI uses:

- `GET /v1/feed`
- `GET /v1/stream`
- `GET /v1/projects/stats`
- `GET /v1/sessions/list`
- `GET /v1/sessions/thread`
- `GET /v1/search/facets`
- existing `search/timeline/get_observations/resume-pack/metrics`

## Search Quality Guard

Run directly:

```bash
./tests/test-memory-search-quality.sh
```

This runs:

1. `memory-server` unit/integration tests for hybrid ranking and privacy filtering
2. isolated daemon/client HTTP-path quality checks

## Related Files

- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-mem`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-memd`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-mem-client.sh`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/test-memory-search-quality.sh`
