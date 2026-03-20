# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-logo-official.jpg" alt="Harness-mem official logo" width="560" />
</p>

<p align="center"><strong>Memory bridge for Claude Code and Codex. Local-first, zero-cost.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/v/@chachamaru127/harness-mem" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/dm/@chachamaru127/harness-mem" alt="npm downloads" /></a>
  <a href="https://github.com/Chachamaru127/harness-mem/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Chachamaru127/harness-mem/release.yml?label=release" alt="release workflow" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BUSL--1.1-0f766e" alt="license BUSL-1.1" /></a>
</p>

<p align="center">
  English | <a href="README_ja.md">日本語</a>
</p>

Harness-mem bridges memory between Claude Code and Codex — learn in one, recall in the other. Fully local, no cloud, no API keys.

## Why harness-mem?

Claude's built-in memory only works inside Claude. [claude-mem](https://github.com/thedotmack/claude-mem) adds persistence but is still locked to Claude Code. [Mem0](https://github.com/mem0ai/mem0) offers cross-app memory but requires cloud infrastructure and custom API integration.

**harness-mem takes a different approach**: one local daemon, one SQLite database, seamless Claude Code ↔ Codex memory sharing — no cloud, no Python, no API keys required.

| | harness-mem | Claude built-in memory | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **Supported tools** | Claude Code, Codex (Tier 1) · Cursor (Tier 2) · Gemini CLI, OpenCode (experimental) | Claude only | Claude only | Custom API integration |
| **Data storage** | Local SQLite | Anthropic cloud | Local SQLite + Chroma | Cloud (self-host on paid plan) |
| **Cross-tool memory** | Automatic — design in Claude Code, execute in Codex, recall everywhere | N/A | N/A | Manual wiring per app |
| **Setup** | `harness-mem setup` (1 command) | Built-in | npm install + config | SDK integration required |
| **Search** | Hybrid (lexical + vector + recency + tag + graph) | Undisclosed | FTS5 + Chroma vector | Vector-centric |
| **External dependencies** | Node.js + Bun | None | Node.js + Python + uv + Chroma | Python + API keys |
| **Migration path** | `import-claude-mem` → `verify` → `cutover` | — | — | — |
| **Workspace isolation** | Strict (symlink-resolved paths) | Global | Basename only | Per-user / per-agent |
| **Benchmark (F1)** | 0.5861 (LoCoMo 120Q, 3-run PASS) | — | — | — |
| **Cross-tool transfer** | Recall@10: 0.60 | N/A | N/A | N/A |
| **Cost** | Free (local) | Included in Claude plan | Free | $99+/mo (cloud) |

### What this means in practice

- **You use Claude Code and Codex** → harness-mem automatically shares memory between both tools. Design decisions in Claude Code are instantly available when you switch to Codex.
- **You care about privacy** → Everything stays in `~/.harness-mem/harness-mem.db`. Zero cloud calls. No API keys required.
- **You also use Cursor** → Tier 2 support: hooks and MCP work out of the box. Gemini CLI and OpenCode are experimental.

## Measured Proof

Primary release gate, current Japanese companion, and historical baseline are intentionally separated.

### Primary release gate (`run-ci`, current latest)

Source:
- [`memory-server/src/benchmark/results/ci-run-manifest-latest.json`](memory-server/src/benchmark/results/ci-run-manifest-latest.json)
- [`docs/benchmarks/japanese-release-proof-bar.md`](docs/benchmarks/japanese-release-proof-bar.md)

Current latest run:
- generated_at: `2026-03-20T11:39:22.199Z`
- git_sha: `f3902d8`
- embedding: `multilingual-e5`

| Metric | Value |
|---|---:|
| LoCoMo F1 | 0.5861 |
| Bilingual recall@10 | 0.9000 |
| Freshness | 1.0000 |
| Temporal | 0.6403 |
| Search p95 | 10.26ms |
| Token avg | 428.93 |

Verdict: `PASS`

3 consecutive runs passed (2026-03-20). Layer 1 (Absolute Floor) + Layer 2 (Relative Regression) + Japanese Companion all green.

### Japanese companion gate (`96 QA`, current claim source)

Source:
- [`docs/benchmarks/japanese-release-proof-bar.md`](docs/benchmarks/japanese-release-proof-bar.md)
- [`docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json`](docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json)
- [`docs/benchmarks/artifacts/s43-ja-release-v2-latest/run3/companion-gate.json`](docs/benchmarks/artifacts/s43-ja-release-v2-latest/run3/companion-gate.json)

| Metric | Value |
|---|---:|
| Overall F1 mean | 0.6580 |
| Cross-lingual F1 mean | 0.6850 |
| Zero-F1 count | 16 / 96 |
| 3-run span | 0.0000 |
| Current slice F1 | 0.8171 |
| Exact slice F1 | 0.5628 |
| Why slice F1 | 0.9008 |
| List slice F1 | 0.7564 |
| Temporal slice F1 | 0.6776 |

Verdict: `PASS as companion gate`

Residual risks that stay visible:
- `current_vs_previous`, `relative_temporal`, `yes_no`, `entity`, and `location` remain watch slices.
- This companion gate supports README-safe Japanese claims, but it does not replace `run-ci`.

### Historical baseline (`32 QA`, historical only)

Source:
- [`docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json`](docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json)
- [`docs/benchmarks/artifacts/s40-ja-baseline-latest/repro-report.json`](docs/benchmarks/artifacts/s40-ja-baseline-latest/repro-report.json)

| Metric | Value |
|---|---:|
| Overall F1 mean | 0.8020 |
| Cross-lingual F1 mean | 0.7563 |
| Zero-F1 count | 1 / 32 |
| 3-run span | 0.0000 |

This baseline shows where the earlier README proof bar landed, but it is **not** the current Japanese claim source.

What this supports:
- Cross-lingual EN<->JA retrieval is benchmarked.
- Japanese short-answer quality is measured on dedicated release packs.
- `why`, `current`, `list`, and `temporal` are all measured with artifact-backed slice reports.

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

| Tier | Tool | Tested With | Notes |
|---|---|---|---|
| **Tier 1** | Claude Code | v2.1.80 | Full hook lifecycle (18 events incl. StopFailure), MCP, plugin marketplace, `--channels` push, `--inline-plugin` setup |
| **Tier 1** | Codex CLI | v0.116.0 | SessionStart + UserPromptSubmit + Stop hooks, MCP, memory citation, rules |
| **Tier 2** | Cursor | Latest | hooks.json + sandbox.json + MCP. No new investment beyond maintenance |
| **Tier 3** | Gemini CLI | Latest | Experimental. Community-contributed |
| **Tier 3** | OpenCode | Latest | Experimental. Community-contributed |

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

Business Source License 1.1 (SPDX: `BUSL-1.1`). See [`LICENSE`](LICENSE).

**Permitted**: internal use, personal use, development, testing, open-source projects, embedding as a component in your application.

**Restricted**: offering harness-mem as a managed memory service to third parties.

On **2029-03-08**, the license automatically converts to **Apache License 2.0**.

**FAQ**:
- *Can I use harness-mem at work?* — Yes. Internal use within your organization is permitted.
- *Can I build a product that uses harness-mem?* — Yes, as a component. You cannot offer harness-mem itself as a hosted memory service.
- *What happens after 2029?* — The license converts to Apache 2.0. No action needed.

**Metadata note**: The repository root is BUSL-1.1. Some distributable subpackages keep their own package-level SPDX fields (for example MIT in `sdk/`, `mcp-server/`, and `vscode-extension/`). If a GitHub repo header or API shows `Other` / `NOASSERTION`, treat [`LICENSE`](LICENSE) and each package's `package.json` as the authoritative source.
