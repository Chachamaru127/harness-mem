# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-logo-official.jpg" alt="Harness-mem official logo" width="560" />
</p>

<p align="center"><strong>One memory runtime for Claude, Codex, Cursor, OpenCode, and Gemini CLI workflows.</strong></p>

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

**harness-mem takes a different approach**: one local daemon, one SQLite database, five supported toolchains plus experimental Antigravity — no cloud, no Python, no API keys required.

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

- **You use multiple AI tools** → harness-mem is a local-first option for sharing memory across Claude, Codex, Cursor, OpenCode, and Gemini in a single project.
- **You care about privacy** → Everything stays in `~/.harness-mem/harness-mem.db`. Zero cloud calls by default. Optional LLM enhancement if you choose.
- **You're on claude-mem today** → One-command migration with rollback. No data loss, no downtime.

## Measured Proof

Primary release gate and Japanese README claims use different evidence on purpose.

### Primary release gate (`run-ci`)

Source:
- [`memory-server/src/benchmark/results/ci-run-manifest-latest.json`](memory-server/src/benchmark/results/ci-run-manifest-latest.json)

| Metric | Value |
|---|---:|
| LoCoMo F1 | 0.4723 |
| Bilingual recall@10 | 0.9000 |
| Freshness | 1.0000 |
| Temporal | 0.6889 |
| Search p95 | 10.29ms |
| Token avg | 428.93 |

Verdict: `PASS`

### Japanese claim gate (`ja-release-pack`)

Source:
- [`docs/benchmarks/japanese-release-proof-bar.md`](docs/benchmarks/japanese-release-proof-bar.md)
- [`docs/benchmarks/artifacts/s40-ja-release-latest/summary.md`](docs/benchmarks/artifacts/s40-ja-release-latest/summary.md)
- [`docs/benchmarks/artifacts/s40-ja-release-latest/repro-report.json`](docs/benchmarks/artifacts/s40-ja-release-latest/repro-report.json)

| Metric | Value |
|---|---:|
| Overall F1 mean | 0.7645 |
| Cross-lingual F1 mean | 0.7563 |
| Zero-F1 mean | 2 / 32 |
| 3-run span | 0.0000 |
| Current slice F1 | 0.8171 |
| Exact slice F1 | 0.7879 |
| Why slice F1 | 0.9008 |
| List slice F1 | 0.8846 |
| Temporal slice F1 | 0.5276 |

What this supports:
- Cross-lingual EN<->JA retrieval is benchmarked.
- Japanese short-answer quality is measured on a dedicated release pack.
- `why`, `list`, `current`, and `exact` are currently the strongest Japanese slices.

What this does **not** claim:
- Native-level Japanese quality
- Perfect Japanese temporal reasoning
- A replacement for the main `run-ci` ship gate

### Sample Japanese queries

- `今、使っている CI は何ですか？`
- `email だけの運用をやめた理由は何ですか？`
- `Q2 に出した admin 向け機能をすべて挙げてください。`
- `最後に出た機能は何ですか？`

## Quick Start

### Option A: Claude Code Plugin Marketplace (recommended for Claude Code users)

```
/plugin marketplace add Chachamaru127/harness-mem
/plugin install harness-mem@chachamaru127
```

Hooks and MCP wiring are configured automatically. The daemon auto-starts on next session via the self-check hook.

### Option B: Run with npx (no global install)

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor,claude
```

> **Note**: npx downloads are temporary, but harness-mem automatically copies itself to `~/.harness-mem/runtime/` for persistence. The daemon and hooks keep working after the npx cache is cleaned.

### Option C: Global install (full CLI access)

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup --platform codex,cursor,claude
```

> **When to use global install**: Choose this if you want `harness-mem doctor`, `harness-memd restart`, and other CLI commands available in your terminal. Options A and B install the runtime but don't add CLI commands to your PATH.

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

`bun` and `ripgrep` are auto-installed on macOS during setup. For other tools (`node`, `curl`, `jq`), install them manually and run:

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

## Plans.md Workflow

harness-mem uses `Plans.md` as the single source of truth for task management.

### Phase markers

| Marker | Meaning |
|---|---|
| `cc:TODO` | Not started |
| `cc:WIP` | Work in progress |
| `cc:完了` | Worker completed |
| `blocked` | Blocked (reason noted) |

### When starting a task

Update the marker from `cc:TODO` to `cc:WIP` in Plans.md before beginning implementation. Each Phase groups related tasks that can be executed in parallel.

### When complete

Update the marker to `cc:完了` and note any unresolved issues.

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

Business Source License 1.1 (BSL). See [`LICENSE`](LICENSE).

**Permitted**: internal use, personal use, development, testing, open-source projects, embedding as a component in your application.

**Restricted**: offering harness-mem as a managed memory service to third parties.

On **2029-03-08**, the license automatically converts to **Apache License 2.0**.
