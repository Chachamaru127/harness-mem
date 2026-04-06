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

Harness-mem bridges memory between Claude Code and Codex through a shared local runtime. Learn in one, recall in the other. Fully local, no cloud, no API keys.

## Why harness-mem?

Claude's built-in memory only works inside Claude. [claude-mem](https://github.com/thedotmack/claude-mem) adds persistence but is still locked to Claude Code. [Mem0](https://github.com/mem0ai/mem0) offers cross-app memory but requires cloud infrastructure and custom API integration.

**harness-mem takes a different approach**: one local daemon, one SQLite database, shared Claude Code ↔ Codex runtime with first-turn continuity on supported hook paths — no cloud, no Python, no API keys required.

| | harness-mem | Claude built-in memory | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **Supported tools** | Claude Code, Codex (Tier 1) · Cursor (Tier 2) · Gemini CLI, OpenCode (experimental) | Claude only | Claude only | Custom API integration |
| **Data storage** | Local SQLite | Anthropic cloud | Local SQLite + Chroma | Cloud (self-host on paid plan) |
| **Cross-tool memory** | Shared local runtime + first-turn continuity on supported hook paths | N/A | N/A | Manual wiring per app |
| **Setup** | `harness-mem setup` (1 command) | Built-in | npm install + config | SDK integration required |
| **Search** | Hybrid (lexical + vector + recency + tag + graph) | Undisclosed | FTS5 + Chroma vector | Vector-centric |
| **External dependencies** | Node.js + Bun | None | Node.js + Python + uv + Chroma | Python + API keys |
| **Migration path** | `import-claude-mem` → `verify` → `cutover` | — | — | — |
| **Workspace isolation** | Strict (symlink-resolved paths) | Global | Basename only | Per-user / per-agent |
| **Benchmark (F1)** | 0.5861 (LoCoMo 120Q, 3-run PASS) | — | — | — |
| **Cross-tool transfer** | Recall@10: 0.60 | N/A | N/A | N/A |
| **Cost** | Free (local) | Included in Claude plan | Free | $99+/mo (cloud) |

### What this means in practice

- **You use Claude Code and Codex** → harness-mem gives both tools the same local memory runtime. With supported hook paths enabled, the first turn stays chain-first (`what we were just doing`) and can also show a small `Also Recently in This Project` teaser for nearby project context.
- **You care about privacy** → Everything stays in `~/.harness-mem/harness-mem.db`. Zero cloud calls. No API keys required.
- **You also use Cursor** → Tier 2 support: hooks and MCP work out of the box. Gemini CLI and OpenCode are experimental.

### Current behavior today

- Claude Code and Codex share one local daemon and one local SQLite database.
- First-turn continuity is supported on the Claude Code and Codex hook paths after `harness-mem setup` and `harness-mem doctor` are green.
- On those supported hook paths, the default SessionStart artifact is hybrid: chain-first continuity stays on top, and a short recent-project teaser may appear second when there is distinct nearby work worth surfacing.
- If hook wiring or the local runtime is stale, search and recall can still work while the "open a fresh session and it already remembers" UX degrades.
- Experimental or maintenance-tier clients can still ingest/search, but parity with Claude Code and Codex is not claimed.
- Large MCP search responses now also return `structuredContent`, so newer Claude / Codex clients can consume machine-readable results instead of only long JSON text.

### What this does not claim

- Perfect automatic understanding for every brand-new session on every client.
- Parity on unsupported clients, broken hook wiring, or unhealthy local runtime.
- Perfect chain selection in every long-lived project with multiple mixed threads.
- A full project digest on every fresh session. The recent-project portion is intentionally capped to a few low-noise bullets.

## Adaptive Retrieval Engine

Harness-mem also includes an `adaptive` embedding mode for teams that mix Japanese, English, and code in the same project.

What it does:

- Route A: Japanese-heavy queries go to the Japanese model.
- Route B: English-heavy or code-heavy queries go to the general model.
- Route C: Mixed queries search both routes and fuse the scores.
- Query expansion adds a few controlled synonyms, so `本番反映` can still find notes written as `deploy`.

Why this exists:

- A single embedding model is usually a compromise.
- Japanese-focused models are often better for Japanese nuance.
- General-purpose models are often better for English API names, logs, and code-like text.
- Adaptive routing lets harness-mem choose the better path per query instead of forcing one model to do everything.

Free path vs Pro path:

- Free path: local Japanese route + local or fallback general route. No external API required.
- Pro path: set `HARNESS_MEM_PRO_API_KEY` and `HARNESS_MEM_PRO_API_URL` to enable the remote general route. If that route becomes unhealthy, harness-mem automatically falls back to the free path and retries with exponential backoff.

Quick example:

```bash
export HARNESS_MEM_EMBEDDING_PROVIDER=adaptive
export HARNESS_MEM_ADAPTIVE_JA_THRESHOLD=0.85
export HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD=0.50

# optional: enable Pro path
export HARNESS_MEM_PRO_API_KEY=your-token
export HARNESS_MEM_PRO_API_URL=https://example.com/embeddings
```

Useful commands:

```bash
npm run benchmark
npm run benchmark:tune-adaptive
```

More detail:

- [`docs/adaptive-retrieval.md`](docs/adaptive-retrieval.md)
- [`docs/pro-api-data-policy.md`](docs/pro-api-data-policy.md)
- [`docs/environment-variables.md`](docs/environment-variables.md)

## Measured Proof

Primary release gate, current Japanese companion, and historical baseline are intentionally separated.

### Primary release gate (`run-ci`, current latest)

Source:
- [`memory-server/src/benchmark/results/ci-run-manifest-latest.json`](memory-server/src/benchmark/results/ci-run-manifest-latest.json)
- [`docs/benchmarks/japanese-release-proof-bar.md`](docs/benchmarks/japanese-release-proof-bar.md)

Current latest run:
- generated_at: `2026-04-03T19:20:02.437Z`
- git_sha: `c77da08`
- embedding: `adaptive`

| Metric | Value |
|---|---:|
| LoCoMo F1 | 0.5861 |
| Bilingual recall@10 | 0.8400 |
| Freshness | 1.0000 |
| Temporal | 0.6472 |
| Search p95 | 14.04ms |
| Token avg | 428.93 |

Verdict: `PASS`

Latest adaptive run passed the current release gate. The companion Japanese proof remains a separate artifact-backed evidence pack rather than a replacement for `run-ci`.

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

### First-time setup in one view

There are three separate steps:

1. Install or invoke the CLI
   Use one of the options below: Claude plugin, `npx`, or global `npm install -g`.
2. Run `harness-mem setup`
   This is the real wiring step. It writes hooks and MCP settings for the selected clients and starts the local runtime.
3. Run `harness-mem doctor`
   This verifies the daemon, hooks, and MCP wiring are healthy.

`npm install` by itself is not the whole setup. It only makes the command available.

If you are running from a repo checkout and want a reproducible Codex-only bootstrap, use:

```bash
bash scripts/setup-codex-memory.sh
npm run codex:doctor
```

Important:

- Prefer `npx` if global npm install asks for `sudo`.
- Do not run `harness-mem setup` with `sudo`.
- Native Windows PowerShell / Command Prompt by itself is still not the safest path.
- If Git for Windows is installed, `harness-mem` now tries to run the existing POSIX setup scripts through Git Bash automatically.
- The most reliable Windows path is still WSL2 (for example Ubuntu) and running `harness-mem` inside that Linux shell.
- Exception: native Windows can also run `harness-mem mcp-config --write --client claude,codex` for MCP-only config updates even when you do not want the full hook/setup flow there.
- `setup` writes into user config locations like `~/.harness-mem`, `~/.codex`, `~/.claude*`, and `~/.cursor`. Running it as root can create the wrong ownership and wire the wrong home directory.
- For Codex specifically, the critical user-scoped files are `~/.codex/config.toml` and `~/.codex/hooks.json`. `doctor` now checks that those files still point at the current harness-mem checkout instead of an older absolute path.

### Option A: Claude Code Plugin Marketplace (recommended for Claude Code users)

```
/plugin marketplace add Chachamaru127/harness-mem
/plugin install harness-mem@chachamaru127
```

Claude-side hooks and MCP wiring are configured automatically. If you also want Codex or Cursor wired, run `harness-mem setup --platform codex,cursor` once. The daemon auto-starts on the next Claude session via the self-check hook.

### Option B: Run with npx (no global install)

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor,claude
```

On Windows, `npx` is currently less reliable than Git Bash + global install. Prefer Option C when testing on native Windows.

> **Note**: npx downloads are temporary, but harness-mem automatically copies itself to `~/.harness-mem/runtime/` for persistence. The daemon and hooks keep working after the npx cache is cleaned.
>
> **Recommended when npm suggests sudo**: choose this path instead of forcing a root-owned global install.

### Option C: Global install (full CLI access)

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup --platform codex,cursor,claude
```

On Windows, this is the preferred native route when Git for Windows / Git Bash is installed.

> **When to use global install**: Choose this if you want `harness-mem doctor`, `harness-memd restart`, and other CLI commands available in your terminal. Options A and B install the runtime but don't add CLI commands to your PATH.
>
> **Important**: only use this path when your normal user can run `npm install -g` without `sudo`. Do not run `sudo harness-mem setup`.

### Native Windows options

If you are on Windows, there are now two practical paths:

1. **Claude plugin route**: best option for Claude Code users on Windows.
2. **Git Bash + global install**: preferred native route for manual `setup` / `doctor`.
3. **MCP-only route**: if you only want Claude / Codex MCP wiring, run:

```bash
harness-mem mcp-config --write --client claude,codex
```

4. **WSL2**: still the most reliable full-lifecycle route.

If you use the Git Bash route, treat these as required prerequisites on Windows:

- `node` and `npm`
- `curl`
- `jq`
- `bun`
- `rg` (`ripgrep`)

Current validation status:

- Claude Code on Windows: validated with Git Bash
- Codex on Windows: Git Bash route validated for `setup --platform codex`, `doctor --platform codex`, exact hook commands, notify, and MCP connection
- `mcp-config` on Windows: available for MCP-only config updates; it does not validate the Codex hook lifecycle

### Update existing install

```bash
harness-mem update
```

`harness-mem update` prompts for auto-update opt-in only when auto-update is currently disabled, then updates the global package. After a successful update, it also runs a quiet `doctor --fix` for remembered client platforms so stale wiring can self-heal.
You can still update manually with `npm install -g @chachamaru127/harness-mem@latest`.

### Verify setup

```bash
harness-mem doctor --platform codex,cursor,claude
harness-mem doctor --fix --platform codex,cursor,claude
```

A green `doctor` plus active `SessionStart`, `UserPromptSubmit`, and `Stop` hooks is the runtime contract for first-turn continuity on Claude Code and Codex.

### If you already used sudo and ownership is broken

Typical symptom: later `setup` or `doctor --fix` only works with `sudo`, because files under your home directory became root-owned.

Recovery:

```bash
sudo chown -R "$USER":staff ~/.harness-mem ~/.codex ~/.cursor ~/.claude ~/.claude.json 2>/dev/null || true
harness-mem setup --platform codex,claude
harness-mem doctor --fix --platform codex,claude
```

Adjust the group if your machine does not use `staff`.

### Contextual recall ("Banto mode")

`UserPromptSubmit` can surface a short memory whisper when the prompt looks like a file-path jump, error investigation, or decision point.

```bash
harness-mem recall status
harness-mem recall quiet
harness-mem recall on
harness-mem recall off
```

- `quiet` is the default. It is conservative: high rerank threshold when reranking is available, otherwise only the top recall item.
- `on` is more proactive: lower rerank threshold and up to 3 fallback items when reranking is unavailable.
- `off` disables contextual recall while keeping normal search and SessionStart continuity intact.
- `HARNESS_MEM_WHISPER_MAX_TOKENS` controls the per-prompt recall budget. See [`docs/environment-variables.md`](docs/environment-variables.md).

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
| `recall` | Switch contextual recall mode (`on`, `quiet`, `off`, `status`) |
| `versions` | Snapshot local vs upstream tool versions |
| `update` | Update global package; prompt auto-update opt-in only if currently disabled |
| `smoke` | Run isolated privacy/search sanity checks |
| `uninstall` | Remove wiring and optional local DB (`--purge-db`) |
| `import-claude-mem` + `verify-import` + `cutover-claude-mem` | Safe migration from Claude-mem |

## Release Reproducibility

If you maintain this repo, release quality should not depend on whether you used a skill, a shell script, or a manual checklist.

- Normal feature work goes to `CHANGELOG.md` under `## [Unreleased]`.
- `CHANGELOG.md` is the source of truth for release notes. `CHANGELOG_ja.md` is a Japanese summary, not a separate contract.
- The release contract is the same whether you use the `harness-release` skill or run the commands yourself: `package.json` version, changelog entry, git tag, GitHub Release, and npm publish must all refer to the same version.
- The canonical maintainer checklist lives in [`docs/release-process.md`](docs/release-process.md).
- The test execution details, including the Bun panic mitigation path used by `npm test`, live in [`docs/TESTING.md`](docs/TESTING.md).
- If you need the maintainer-facing repro notes for the known Bun teardown crash, see [`docs/bun-test-panic-repro.md`](docs/bun-test-panic-repro.md).

In practice, a reproducible release means all of these are true before you ship:

1. Working tree is clean.
2. User-visible changes are already written in `CHANGELOG.md` under `[Unreleased]`.
3. Quality gates are green.
4. `npm pack --dry-run` passes.
5. The release tag matches `package.json`.
6. The resulting npm version and GitHub Release point to the same shipped version.

## Supported Tools

| Tier | Tool | Tested With | Notes |
|---|---|---|---|
| **Tier 1** | Claude Code | v2.1.80 | Full hook lifecycle (18 events incl. StopFailure), MCP, plugin marketplace, `--channels` push, `--inline-plugin` setup |
| **Tier 1** | Codex CLI | v0.116.0+ | SessionStart + UserPromptSubmit + Stop hooks, MCP, memory citation, structured MCP result, rules |
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

## Maintained by

<p align="center">
  Developed and maintained by <a href="https://canai.jp/">CAN AI Inc.</a><br />
  AI adoption consulting — helping organizations build lasting AI capabilities.
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
