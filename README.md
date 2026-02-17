# harness-mem

Unified memory runtime for Claude Code / Codex / OpenCode / Cursor.

## Install (npm / npx)

Run without global install:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

Install globally:

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup
harness-mem doctor
```

`setup` without `--platform` opens an interactive flow:

1. Language (Japanese / English)
2. Target tools (multi-select)
3. Import existing data from Claude-mem (optional)
4. Stop Claude-mem after import (optional)

## Main components

- `memory-server/`: Bun daemon + SQLite storage + hybrid retrieval
- `mcp-server/`: MCP tools (`harness_mem_*`) bridge
- `harness-mem-ui/`: standalone viewer UI
- `scripts/harness-mem`: setup/doctor/smoke/import/cutover CLI

## Local repository usage

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
scripts/harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
scripts/harness-mem verify-import --job <job_id>
scripts/harness-mem cutover-claude-mem --job <job_id> --stop-now
```

## Publish (npm)

```bash
npm login
npm publish
```

Pre-check:

```bash
npm pack --dry-run
npm publish --dry-run
```
