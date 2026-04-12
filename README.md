# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/readme/hero.png" alt="Harness-mem — one local memory shared between Claude Code and Codex" width="820" />
</p>

<p align="center"><strong>One project. One memory. Every AI coding agent.</strong></p>

<p align="center">
  Stop re-explaining yesterday's work to Claude Code, Codex, or Cursor. Harness-mem keeps a single local SQLite memory <em>per project</em> and shares it across every AI coding agent you use. ~5ms cold start. Zero cloud, zero API keys.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/v/@chachamaru127/harness-mem" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/dm/@chachamaru127/harness-mem" alt="npm downloads" /></a>
  <a href="https://github.com/Chachamaru127/harness-mem/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Chachamaru127/harness-mem/release.yml?label=release" alt="release workflow" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-0f766e" alt="platforms" />
  <img src="https://img.shields.io/badge/MCP%20cold%20start-~5ms-orange" alt="MCP cold start" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BUSL--1.1-0f766e" alt="license BUSL-1.1" /></a>
</p>

<p align="center">
  English | <a href="README_ja.md">日本語</a>
</p>

---

## Table of Contents

- [What changes](#what-changes)
- [Measured](#measured)
- [Install](#install)
- [How it works](#how-it-works)
- [Compare with alternatives](#compare-with-alternatives)
- [Adaptive Retrieval Engine](#adaptive-retrieval-engine)
- [Measured Proof](#measured-proof) — full benchmark gate
- [Core Commands](#core-commands)
- [Supported Tools](#supported-tools)
- [Troubleshooting](#troubleshooting)
- [Release Reproducibility](#release-reproducibility)
- [Documentation](#documentation)
- [License](#license)

---

## What changes

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/readme/before-after.png" alt="Before and after harness-mem — Monday's Claude Code context becomes Tuesday's Codex context automatically" width="820" />
</p>

**Before harness-mem**

- Monday: you debug a race condition in `worker.ts` with Claude Code.
- Tuesday: you open Codex. It has no idea what Monday was about. You re-explain the bug, the hypothesis, the half-fix.
- Wednesday: Claude Code session restarts. The context you built up this morning is gone.

**With harness-mem**

- Tuesday's Codex opens and the very first turn already knows about the `worker.ts` race fix.
- Wednesday's fresh Claude Code pulls back today's decisions on the first prompt.
- One local SQLite file is the memory surface. No cloud. No API keys. No Python stack to install.

### What this means in practice

- **You use Claude Code and Codex** → harness-mem gives both tools the same local memory runtime. With supported hook paths enabled, the first turn stays chain-first (`what we were just doing`) and can also show a small `Also Recently in This Project` teaser for nearby project context.
- **You care about privacy** → Everything stays in `~/.harness-mem/harness-mem.db`. Zero cloud calls. No API keys required.
- **You also use Cursor** → Tier 2 support: hooks and MCP work out of the box. Gemini CLI and OpenCode are experimental.

---

## Measured

All numbers below come from committed artifacts you can rerun yourself — no marketing approximations.

| Metric | Value | Where it lives |
|---|---|---|
| **MCP cold start** | ~5ms (median, n=10) | [bench JSON](docs/benchmarks/go-mcp-bench/) · `scripts/bench-go-mcp.sh` |
| **Single Go binary** | 7.04MB stripped · 4 platforms | macOS arm64/amd64 · Linux amd64 · Windows amd64 |
| **Memory (RSS)** | ~13MB after `initialize` + `tools/list` | bench JSON, measured on Apple M1 |
| **LoCoMo F1** | 0.5917 (120 QA · 3-run PASS) | [run-ci manifest](memory-server/src/benchmark/results/ci-run-manifest-latest.json) |
| **Search p95** | 13.28ms | same manifest |
| **Bilingual recall@10** | 0.8800 | same manifest |

The Go MCP server is the layer Claude Code and Codex actually talk to. If the Go binary is missing, a wrapper script transparently falls back to the Node.js build — you still get every feature, just at Node.js cold start.

### harness-mem's target domain is developer workflow memory (not general lifelog)

Memory benchmarks cluster into two domains:

- **General lifelog** — remembering a fictional person's everyday life ("when did Caroline go to the support group?"). This is what **LoCoMo**, LongMemEval, and most of Mem0/MemPalace/SuperMemory evaluate.
- **Developer workflow** — remembering yesterday's race fix, the tech-stack decisions, the half-done migration, the deploy recipe. This is what harness-mem actually serves.

We run LoCoMo on purpose anyway — as a transparency reference, not as a target to tune for. Here is the honest zero-LLM comparison:

| Tool | LoCoMo F1 | Scope | Tool's target domain | Source |
|---|---:|---|---|---|
| **harness-mem (120 Q subset)** | **0.5917** | subset, 3-run PASS, used internally as a release-gate smoke | developer-workflow | [`ci-run-manifest-latest.json`](memory-server/src/benchmark/results/ci-run-manifest-latest.json) |
| **harness-mem (full 1,986 Q, reference-only)** | **0.0546** | full LoCoMo, zero-LLM token-F1, **NOT a release gate** | developer-workflow | [`locomo-full-reference.json`](docs/benchmarks/locomo-full-reference.json) |
| LangMem | 0.581 | LoCoMo (p95 search: 59.82 s) | generic-agent | [2026 comparison](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3) |
| Kumiho | 0.565 | LoCoMo full (1,986 Q / 10 conversations) | general-lifelog | [kumihoclouds/kumiho-benchmarks](https://github.com/kumihoclouds/kumiho-benchmarks) |
| MemPalace (raw, zero-LLM) | ≈0.603 | LoCoMo top-10, zero API calls | general-lifelog | [milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace) |
| SimpleMem | 0.432 | LoCoMo (average) | generic-agent | [alphaXiv 2601.02553](https://www.alphaxiv.org/overview/2601.02553v1) |
| Mem0 (single-hop) | 0.387 | LoCoMo single-hop token-F1 (LLM-dependent extractor + judge) | generic-agent | [arXiv 2504.19413](https://arxiv.org/abs/2504.19413) |
| claude-mem / Claude built-in / ChatGPT memory | — | not published | varies | — |

**Caveats we keep visible**

- **harness-mem publishes 0.0546 on the full LoCoMo 1,986 Q on purpose.** We do not tune for it. LoCoMo measures general lifelog memory over fictional characters' everyday conversations (e.g. "When did Caroline attend the LGBTQ support group?"). That is not harness-mem's target domain — tuning for it would weaken our session-lifecycle, project-scoped, developer-workflow design. Kumiho (0.565) and MemPalace (≈0.603 raw) explicitly target general lifelog memory; harness-mem does not.
- The 120 Q subset number (0.5917) is a smaller sample that happens to fit harness-mem's session-like ingestion shape. We report it with the same "not apples-to-apples" caveat: smaller subsets can flatter the score.
- Mem0's token-F1 score (0.387) is on an LLM-dependent pipeline (GPT-4o-mini extractor + LLM-as-judge). Mem0's separately reported 0.669 is on the LLM-as-judge metric. harness-mem's numbers above are on **zero-LLM** methodology throughout, which is a fundamentally different axis.
- Letta publishes 0.832 on **LongMemEval**, a different benchmark. It is intentionally not in the table above because cross-benchmark comparison would mislead.
- We do not run competitors ourselves — every non-harness number above is a self-reported figure from the source linked in the same row.

**Where harness-mem actually competes**

Our release gate lives in `ci-run-manifest-latest.json` on the developer-workflow domain:

| Metric | Current | Target (main gate) | Measures |
|---|---:|---:|---|
| `dev-workflow` recall@10 | 0.59 | ≥ 0.70 | Developer-style file/decision jump queries |
| `bilingual` recall@10 | **0.88** | ≥ 0.90 | Mixed JA/EN/code retrieval |
| `knowledge-update` freshness@K | **1.00** | ≥ 0.95 ✓ | Supersede stale facts when content is updated |
| `temporal` ordering score | 0.65 | ≥ 0.70 | "When did X happen relative to Y?" on project history |

These are what harness-mem actually competes on. The domain column in the comparison table exists so readers can judge which benchmarks map to their real-world use case.

Raw data (source URLs, fetched dates, exclusion reasons, per-row notes) is committed as a machine-readable audit trail at [`docs/benchmarks/competitors-2026-04.json`](docs/benchmarks/competitors-2026-04.json). New snapshots will be added as dated files rather than mutating the existing one.

Full benchmark gate (primary ship gate + Japanese companion + historical baseline) is in the [Measured Proof](#measured-proof) section below.

---

## Install

Pick the path that matches your stack. That's the whole decision.

| You use... | Run this |
|---|---|
| **Only Claude Code** | `/plugin marketplace add Chachamaru127/harness-mem` → `/plugin install harness-mem@chachamaru127` |
| **Claude Code + Codex** _(recommended)_ | `npm install -g @chachamaru127/harness-mem` → `harness-mem setup` |
| **`npm install -g` blocked (sudo)** | `npx -y --package @chachamaru127/harness-mem harness-mem setup` |

### About `harness-mem setup`

`harness-mem setup` is **interactive**. It asks which tools to wire up:

```
[harness-mem] Select setup targets (multiple allowed)
  1) codex        (global: ~/.codex/config.toml)
  2) cursor       (global: ~/.cursor/hooks.json + ~/.cursor/mcp.json)
  3) opencode     (global: ~/.config/opencode/opencode.json)
  4) claude       (global: ~/.claude.json mcpServers)
  5) antigravity  (experimental workspace scanning)
  6) gemini       (global: ~/.gemini/settings.json)
  a) all
Example: 1,2   (Enter=1,2)
```

No `--platform` flag is required. For CI / scripted installs you can still pass `--platform codex,claude,cursor` to skip the prompt.

### Verify

```bash
harness-mem doctor
```

All green = ready. If something is off:

```bash
harness-mem doctor --fix
```

A green `doctor` plus active `SessionStart`, `UserPromptSubmit`, and `Stop` hooks is the runtime contract for first-turn continuity on Claude Code and Codex.

### Update

```bash
harness-mem update
```

Prompts for auto-update opt-in only when auto-update is currently disabled, then updates the global package. After a successful update, it also runs a quiet `doctor --fix` for remembered client platforms so stale wiring can self-heal.

<details>
<summary><strong>Windows (Git Bash / WSL2)</strong></summary>

If you are on Windows, there are now practical paths:

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

</details>

<details>
<summary><strong>Running from a repo checkout (contributors)</strong></summary>

If you are running from a repo checkout and want a reproducible Codex-only bootstrap, use:

```bash
bash scripts/setup-codex-memory.sh
npm run codex:doctor
```

`setup` writes into user config locations like `~/.harness-mem`, `~/.codex`, `~/.claude*`, and `~/.cursor`. Running it as root can create the wrong ownership and wire the wrong home directory — do not use `sudo`.

For Codex specifically, the critical user-scoped files are `~/.codex/config.toml` and `~/.codex/hooks.json`. `doctor` now checks that those files still point at the current harness-mem checkout instead of an older absolute path.

</details>

---

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/readme/architecture.png" alt="harness-mem architecture — one daemon, one SQLite, two AI coding tools" width="820" />
</p>

- **One daemon** (`harness-memd`) listens on `localhost:37888`. It is the Go MCP server that Claude Code and Codex speak to over stdio.
- **One local SQLite database** at `~/.harness-mem/harness-mem.db` stores every observation, session thread, embedding, and fact chain.
- **Two hook paths** wire the tools in: `SessionStart` (first-turn continuity), `UserPromptSubmit` (contextual recall), and `Stop` (session finalization).
- **The memory server** (TypeScript) does embeddings, hybrid search, rerank, and the adaptive JA/EN/code routing. It is intentionally kept in TypeScript because that's where the ML stack lives — the Go layer is only the MCP front desk.

Large MCP search responses now also return `structuredContent`, so newer Claude / Codex clients can consume machine-readable results instead of only long JSON text.

### Current behavior today

- Claude Code and Codex share one local daemon and one local SQLite database.
- First-turn continuity is supported on the Claude Code and Codex hook paths after `harness-mem setup` and `harness-mem doctor` are green.
- On those supported hook paths, the default SessionStart artifact is hybrid: chain-first continuity stays on top, and a short recent-project teaser may appear second when there is distinct nearby work worth surfacing.
- If hook wiring or the local runtime is stale, search and recall can still work while the "open a fresh session and it already remembers" UX degrades.
- Experimental or maintenance-tier clients can still ingest/search, but parity with Claude Code and Codex is not claimed.

### What this does not claim

- Perfect automatic understanding for every brand-new session on every client.
- Parity on unsupported clients, broken hook wiring, or unhealthy local runtime.
- Perfect chain selection in every long-lived project with multiple mixed threads.
- A full project digest on every fresh session. The recent-project portion is intentionally capped to a few low-noise bullets.

---

## Compare with alternatives

Claude's built-in memory only works inside Claude. [claude-mem](https://github.com/thedotmack/claude-mem) adds persistence but is still locked to Claude Code. [Mem0](https://github.com/mem0ai/mem0) offers cross-app memory but requires cloud infrastructure and custom API integration. harness-mem takes a different path: one local daemon, one SQLite database, shared Claude Code ↔ Codex runtime, zero cloud.

| | harness-mem | Claude built-in | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **Works across Claude Code + Codex** | ✓ | — | — | Manual per-app wiring |
| **Local-only, no cloud** | ✓ | — | ✓ | Cloud / paid self-host |
| **Setup** | 1 command (`setup`) | Built-in | npm install + config | SDK integration required |
| **MCP cold start** | **~5ms** (Go binary) | — | — | — |
| **Cost** | Free | Included in plan | Free | $99+/mo (cloud) |

<details>
<summary>Full comparison (all dimensions)</summary>

| | harness-mem | Claude built-in memory | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **Supported tools** | Claude Code, Codex (Tier 1) · Cursor (Tier 2) · Gemini CLI, OpenCode (experimental) | Claude only | Claude only | Custom API integration |
| **Data storage** | Local SQLite | Anthropic cloud | Local SQLite + Chroma | Cloud (self-host on paid plan) |
| **Cross-tool memory** | Shared local runtime + first-turn continuity on supported hook paths | N/A | N/A | Manual wiring per app |
| **Setup** | `harness-mem setup` (1 command) | Built-in | npm install + config | SDK integration required |
| **Search** | Hybrid (lexical + vector + nugget + recency + tag + graph + fact chain) | Undisclosed | FTS5 + Chroma vector | Vector-centric |
| **MCP server cold start** | ~5ms median (Go binary, measured) | — | — | — |
| **External dependencies** | Node.js + Bun (Go binary auto-downloaded) | None | Node.js + Python + uv + Chroma | Python + API keys |
| **Migration path** | `import-claude-mem` → `verify` → `cutover` | — | — | — |
| **Workspace isolation** | Strict (symlink-resolved paths) | Global | Basename only | Per-user / per-agent |
| **Benchmark (F1)** | 0.5917 (LoCoMo 120Q, 3-run PASS, p95 13.28ms) | — | — | — |
| **Cross-tool transfer** | Recall@10: 0.60 | N/A | N/A | N/A |
| **Cost** | Free (local) | Included in Claude plan | Free | $99+/mo (cloud) |

</details>

---

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

---

## Measured Proof

Primary release gate, current Japanese companion, and historical baseline are intentionally separated.

### Primary release gate (`run-ci`, current latest)

Source:
- [`memory-server/src/benchmark/results/ci-run-manifest-latest.json`](memory-server/src/benchmark/results/ci-run-manifest-latest.json)
- [`docs/benchmarks/japanese-release-proof-bar.md`](docs/benchmarks/japanese-release-proof-bar.md)

Current latest run:
- generated_at: `2026-04-10T08:10:51.561Z`
- git_sha: `512f027`
- embedding: `onnx`

| Metric | Value |
|---|---:|
| LoCoMo F1 | 0.5917 |
| Bilingual recall@10 | 0.8800 |
| Freshness | 1.0000 |
| Temporal | 0.6458 |
| Search p95 | 13.28ms |
| Token avg | 427.75 |

Verdict: `PASS`

Latest onnx run passed the current release gate. The companion Japanese proof remains a separate artifact-backed evidence pack rather than a replacement for `run-ci`.

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

---

## Core Commands

| Command | Purpose |
|---|---|
| `setup` | Configure tool wiring and start daemon + Mem UI (interactive by default) |
| `doctor` | Validate wiring/health and optionally repair with `--fix` |
| `recall` | Switch contextual recall mode (`on`, `quiet`, `off`, `status`) |
| `versions` | Snapshot local vs upstream tool versions |
| `update` | Update global package; prompt auto-update opt-in only if currently disabled |
| `smoke` | Run isolated privacy/search sanity checks |
| `uninstall` | Remove wiring and optional local DB (`--purge-db`) |
| `import-claude-mem` + `verify-import` + `cutover-claude-mem` | Safe migration from Claude-mem |

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

### Mem UI

```bash
open 'http://127.0.0.1:37901'
```

The Mem UI includes an `Environment` tab that explains internal servers, installed languages/runtimes, CLI tools, and AI/MCP wiring status. Read-only in V1, sensitive values are masked before rendering.

---

## Supported Tools

| Tier | Tool | Tested With | Notes |
|---|---|---|---|
| **Tier 1** | Claude Code | v2.1.80 | Full hook lifecycle (18 events incl. StopFailure), MCP, plugin marketplace, `--channels` push, `--inline-plugin` setup |
| **Tier 1** | Codex CLI | v0.116.0+ | SessionStart + UserPromptSubmit + Stop hooks, MCP, memory citation, structured MCP result, rules |
| **Tier 2** | Cursor | Latest | hooks.json + sandbox.json + MCP. No new investment beyond maintenance |
| **Tier 3** | Gemini CLI | Latest | Experimental. Community-contributed |
| **Tier 3** | OpenCode | Latest | Experimental. Community-contributed |

---

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

### Same workspace appears as both `harness-mem` and `/.../harness-mem`

```bash
harness-memd restart
```

### You already used `sudo` and ownership is broken

Typical symptom: later `setup` or `doctor --fix` only works with `sudo`, because files under your home directory became root-owned.

```bash
sudo chown -R "$USER":staff ~/.harness-mem ~/.codex ~/.cursor ~/.claude ~/.claude.json 2>/dev/null || true
harness-mem setup
harness-mem doctor --fix
```

Adjust the group if your machine does not use `staff`.

### Need a clean reset

```bash
harness-mem uninstall --purge-db
```

---

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

---

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

---

## Documentation

- Setup reference: [`docs/harness-mem-setup.md`](docs/harness-mem-setup.md)
- Environment API contract: [`docs/plans/environment-tab-v1-contract.md`](docs/plans/environment-tab-v1-contract.md)
- Changelog (source of truth): [`CHANGELOG.md`](CHANGELOG.md)
- Japanese changelog summary: [`CHANGELOG_ja.md`](CHANGELOG_ja.md)
- Japanese README: [`README_ja.md`](README_ja.md)
- Benchmark runbooks: [`docs/benchmarks/`](docs/benchmarks/)
- Go MCP server bench proof: [`docs/benchmarks/go-mcp-bench/`](docs/benchmarks/go-mcp-bench/)

---

## Official Mascot

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-mascot-official.jpg" alt="Harness-mem official mascot" width="360" />
</p>

---

## Maintained by

<p align="center">
  Developed and maintained by <a href="https://canai.jp/">CAN AI Inc.</a><br />
  AI adoption consulting — helping organizations build lasting AI capabilities.
</p>

---

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
