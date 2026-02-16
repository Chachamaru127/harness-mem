# harness-mem

Unified memory runtime for Claude Code / Codex / OpenCode.

## Main components

- `memory-server/`: Bun daemon + SQLite storage + hybrid retrieval
- `mcp-server/`: MCP tools (`harness_mem_*`) bridge
- `harness-mem-ui/`: standalone viewer UI (separate from harness-ui)
- `scripts/harness-mem`: setup/doctor/smoke/import/cutover CLI

## Quick start

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem
scripts/harness-mem setup
scripts/harness-mem doctor
```

## UI

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui
bun install
bun run dev
```

URL: `http://127.0.0.1:37901`

## Migration from Claude-mem

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem
scripts/harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
scripts/harness-mem verify-import --job <job_id>
scripts/harness-mem cutover-claude-mem --job <job_id> --stop-now
```
