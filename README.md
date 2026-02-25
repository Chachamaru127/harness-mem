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

Harness-mem keeps memory behavior consistent across coding tools without hand-editing each tool config.

## Why harness-mem?

Claude's built-in memory only works inside Claude. [claude-mem](https://github.com/thedotmack/claude-mem) adds persistence but is still locked to Claude Code. [Mem0](https://github.com/mem0ai/mem0) offers cross-app memory but requires cloud infrastructure and custom API integration.

**harness-mem takes a different approach**: one local daemon, one SQLite database, six platforms — no cloud, no Python, no API keys required.

| | harness-mem | Claude built-in memory | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **Supported tools** | Claude, Codex, Cursor, OpenCode, Gemini CLI, Antigravity | Claude only | Claude only | Custom API integration |
| **Data storage** | Local SQLite | Anthropic cloud | Local SQLite + Chroma | Cloud (self-host on paid plan) |
| **Cross-tool memory** | Automatic — work in Claude, recall in Codex | N/A | N/A | Manual wiring per app |
| **Setup** | `harness-mem setup` (1 command) | Built-in | npm install + config | SDK integration required |
| **Search** | Hybrid (lexical + vector + recency + tag + graph) | Undisclosed | FTS5 + Chroma vector | Vector-centric |
| **External dependencies** | Node.js + Bun | None | Node.js + Python + uv + Chroma | Python + API keys |
| **Migration path** | `import-claude-mem` → `verify` → `cutover` | — | — | — |
| **Workspace isolation** | Strict (symlink-resolved paths) | Global | Basename only | Per-user / per-agent |

### What this means in practice

- **You use multiple AI tools** → harness-mem is the only option that shares memory across Claude, Codex, Cursor, OpenCode, and Gemini in a single project.
- **You care about privacy** → Everything stays in `~/.harness-mem/harness-mem.db`. Zero cloud calls by default. Optional LLM enhancement if you choose.
- **You're on claude-mem today** → One-command migration with rollback. No data loss, no downtime.

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

### Update existing install

```bash
harness-mem update
```

`harness-mem update` prompts for auto-update opt-in only when auto-update is currently disabled, then updates the global package.
You can still update manually with `npm install -g @chachamaru127/harness-mem@latest`.

### Verify setup

```bash
harness-mem doctor --platform codex,cursor,claude
harness-mem doctor --fix --platform codex,cursor,claude
```

### Open Mem UI

```bash
open 'http://127.0.0.1:37901'
```

### Environment Tab (for non-specialists)

The Mem UI includes an `Environment` tab that explains:

1. Internal servers currently running
2. Installed languages and runtimes
3. Installed CLI tools
4. AI / MCP tool wiring status

The tab is read-only in V1 and masks sensitive values before rendering.

## Core Commands

| Command | Purpose |
|---|---|
| `setup` | Configure tool wiring and start daemon + Mem UI |
| `doctor` | Validate wiring/health and optionally repair with `--fix` |
| `versions` | Snapshot local vs upstream tool versions |
| `update` | Update global package; prompt auto-update opt-in only if currently disabled |
| `smoke` | Run isolated privacy/search sanity checks |
| `uninstall` | Remove wiring and optional local DB (`--purge-db`) |
| `import-claude-mem` + `verify-import` + `cutover-claude-mem` | Safe migration from Claude-mem |

## Supported Tools

| Tool | Status | Notes |
|---|---|---|
| Codex | Supported | Config wiring, ingestion, doctor checks |
| OpenCode | Supported | Global wiring + schema-safe config repair |
| Cursor | Supported | Global hooks + global MCP wiring + doctor checks |
| Claude workflows | Supported | Global MCP wiring (`~/.claude.json`) + migration/cutover path |
| Antigravity | Experimental | Hidden by default, opt-in via environment flags |

## Troubleshooting

### `harness-mem: command not found`

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### `doctor` reports missing dependencies

Install required tools (`bun`, `node`, `curl`, `jq`, `ripgrep`) and run:

```bash
harness-mem doctor --fix
```

### Need a clean reset

```bash
harness-mem uninstall --purge-db
```

### Same workspace appears as both `harness-mem` and `/.../harness-mem`

```bash
harness-memd restart
```

## Documentation

- Setup reference: `docs/harness-mem-setup.md`
- Environment API contract: `docs/plans/environment-tab-v1-contract.md`
- Changelog (source of truth): `CHANGELOG.md`
- Japanese changelog summary: `CHANGELOG_ja.md`
- Japanese README: `README_ja.md`
- Benchmark runbooks: `docs/benchmarks/`

## Official Mascot

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-mascot-official.jpg" alt="Harness-mem official mascot" width="360" />
</p>

## License

MIT. See [`LICENSE`](LICENSE).
