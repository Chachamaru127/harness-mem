# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-logo-official.jpg" alt="Harness-mem official logo" width="560" />
</p>

<p align="center"><strong>One memory runtime for Codex, OpenCode, Cursor, and Claude workflows.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/v/@chachamaru127/harness-mem" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/dm/@chachamaru127/harness-mem" alt="npm downloads" /></a>
  <a href="https://github.com/Chachamaru127/harness-mem/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Chachamaru127/harness-mem/release.yml?label=release" alt="release workflow" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Chachamaru127/harness-mem" alt="license" /></a>
</p>

<p align="center">
  English | <a href="README_ja.md">日本語</a>
</p>

Harness-mem helps teams keep memory behavior consistent across multiple coding tools without wiring each tool by hand.

## Quick Start

### Option A: Run with npx (no global install)

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor,claude
```

### Option B: Global install

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup --platform codex,cursor,claude
```

### Verify setup

```bash
harness-mem doctor --platform codex,cursor,claude
harness-mem doctor --fix --platform codex,cursor,claude
```

```bash
# Mem UI
open http://127.0.0.1:37901
```

### If setup fails

Harness-mem prints the failed steps and direct recovery commands.

```bash
harness-mem doctor --fix --platform codex,cursor,claude
```

If you omit `--platform`, `setup` runs an interactive flow:

1. Language selection
2. Target tool selection (multi-select)
3. Optional Claude-mem import
4. Optional Claude-mem stop after verified import

## Why Harness-mem

1. One setup entrypoint for multi-tool memory wiring.
2. Safe migration path from Claude-mem with verify-before-cutover.
3. Built-in guardrails for privacy filtering and retrieval quality.

## What You Get

| Capability | What it gives you |
|---|---|
| `setup` | Automated wiring for Codex, OpenCode, Cursor, Claude MCP, plus daemon + Mem UI startup |
| `doctor` | Deterministic health and wiring checks with optional repair (`--fix`), structured JSON output (`--json`) |
| `versions` | Local/Upstream version snapshot + status tracking for all supported tools |
| `smoke` | End-to-end privacy and retrieval sanity check |
| `import-claude-mem` + `verify-import` + `cutover-claude-mem` | Controlled migration that blocks unsafe cutover |
| Memory feed + search APIs | Shared memory view across supported tools |

## Plans Workflow Rules

`Plans.md` is the implementation SSOT (single source of truth) for this repository.

Status labels:

- `cc:TODO`: not started
- `cc:WIP`: in progress
- `cc:完了`: implementation done
- `blocked`: paused with reason and unblock condition

Execution order:

1. Follow `Phase` order strictly (`Phase 0` -> `Phase 1` -> ... -> `Phase 7`)
2. When starting: change target task from `cc:TODO` to `cc:WIP`
3. When complete: update the task to `cc:完了` and append 1-3 lines of change reason
4. If blocked, switch to `blocked` and record cause / attempts / next action

## Planned Next

Next release track includes a dedicated **System Inventory** screen in Mem UI:

- Local server list with `port`, `protocol`, `pid`, and bind address.
- Installed language/runtime list (for example Python / Node / Go / Rust).
- Installed CLI tool list with short descriptions.
- Read-only endpoint for LLM queries: `GET /v1/admin/system/llm-context`.

## Documentation

- Setup reference: `docs/harness-mem-setup.md`
- Changelog (source of truth): `CHANGELOG.md`
- Japanese changelog summary: `CHANGELOG_ja.md`
- Japanese README: `README_ja.md`
- Benchmark runbooks: `docs/benchmarks/`

## Supported Tools

| Tool | Status | Notes |
|---|---|---|
| Codex | Supported | Config wiring, ingestion, doctor checks |
| OpenCode | Supported | Global wiring + schema-safe config repair |
| Cursor | Supported | Global hooks + global MCP wiring + doctor checks |
| Claude workflows | Supported | Global MCP wiring (`~/.claude.json`) + migration/cutover path |
| Antigravity | Experimental | Hidden by default, opt-in via environment flags |

## Troubleshooting

### 1) `harness-mem: command not found`

Use the npx path directly:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### 2) `doctor` reports missing dependencies

Install required tools (`bun`, `node`, `curl`, `jq`, `ripgrep`) and run:

```bash
harness-mem doctor
```

### 3) OpenCode fails after config drift

Repair OpenCode wiring:

```bash
harness-mem doctor --fix --platform opencode
```

### 4) npx-based setup breaks after cache cleanup

Re-run setup to refresh stable runtime wiring:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor
```

### 5) Need full local removal

```bash
harness-mem uninstall --purge-db
```

### 6) Same workspace appears as both `harness-mem` and `/.../harness-mem`

Restart daemon once to run automatic alias normalization (v0.1.18+):

```bash
harness-memd restart
```

## Official Mascot

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-mascot-official.jpg" alt="Harness-mem official mascot" width="360" />
</p>

The mascot section is for brand continuity only and is intentionally separate from feature explanations.

## License

MIT. See [`LICENSE`](LICENSE).
