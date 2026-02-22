# Harness-mem

<p align="center">
  <img src="docs/assets/logos/harnes-mem/official/harness-mem-logo-official.jpg" alt="Harness-mem official logo" width="560" />
</p>

<p align="center"><strong>One memory runtime for Codex, OpenCode, Cursor, and Claude workflows.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/v/@chachamaru127/harness-mem" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/dm/@chachamaru127/harness-mem" alt="npm downloads" /></a>
  <a href="https://github.com/Chachamaru127/harness-mem/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Chachamaru127/harness-mem/release.yml?label=release" alt="release workflow" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Chachamaru127/harness-mem" alt="license" /></a>
</p>

Harness-mem helps teams keep memory behavior consistent across multiple coding tools without wiring each tool by hand.

## Quick Start

### Option A: run with npx (no global install)

```bash
# 1コマンドで全自動セットアップ (Claude + Codex + Cursor を一括配線)
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor,claude
```

### Option B: global install

```bash
npm install -g @chachamaru127/harness-mem

# 1コマンドで全自動セットアップ
harness-mem setup --platform codex,cursor,claude
```

### セットアップ後の確認

```bash
# doctor で全項目 green を確認
harness-mem doctor --platform codex,cursor,claude

# 問題があれば自動修復
harness-mem doctor --fix --platform codex,cursor,claude
```

```bash
# メモリUI（setupで自動起動）
open http://127.0.0.1:37901
```

### setup 失敗時の復旧

`setup` が失敗した場合、失敗ステップと修復コマンドが自動表示されます:

```
[harness-mem] セットアップで失敗がありました。修復手順:
  [FAIL] codex_wiring   => harness-mem setup --platform codex

  自動修復: harness-mem doctor --fix --platform codex,cursor,claude
```

1コマンドで復旧:

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

## Documentation (EN / JA)

- English setup reference: `docs/harness-mem-setup.md`
- English changelog (source of truth): `CHANGELOG.md`
- Japanese changelog summary: `CHANGELOG_ja.md`
- Benchmark runbooks: `docs/benchmarks/`

## Plans Workflow Rules

`Plans.md` is the implementation SSOT (single source of truth) for this repository.

Status labels:

- `cc:TODO`: not started
- `cc:WIP`: currently in progress
- `cc:完了`: implementation done
- `blocked`: paused with reason and unblock condition

Execution order:

1. Follow `Phase` order strictly (`Phase 0` -> `Phase 1` -> ... -> `Phase 7`)
2. 着手時: change target task from `cc:TODO` to `cc:WIP`
3. 完了時: update the task to `cc:完了` and append 1-3 lines of change reason
4. If blocked, switch to `blocked` and record cause / attempts / next action

## What You Get

| Capability | What it gives you |
|---|---|
| `setup` | Automated wiring for Codex, OpenCode, Cursor, Claude MCP, plus daemon + Mem UI startup |
| `doctor` | Deterministic health and wiring checks with optional repair (`--fix`), structured JSON output (`--json`) |
| `versions` | Local/Upstream version snapshot + status tracking for all supported tools |
| `smoke` | End-to-end privacy and retrieval sanity check |
| `import-claude-mem` + `verify-import` + `cutover-claude-mem` | Controlled migration that blocks unsafe cutover |
| Memory feed + search APIs | Shared memory view across supported tools |

## Phase1 KPI & SLA

Phase1 Multi-Tool UX Superiority の完了判定に使う指標・却下条件を固定する。

### KPI / SLA 一覧

| 指標 | 基準値 |
|---|---|
| セットアップコマンド数 | 1コマンドで完結 |
| セットアップ所要時間 | 5分以内 |
| doctor チェック結果 | 全項目 green |
| 手編集の要否 | 手編集なし |
| クロスツール記憶共有レイテンシ | P95 3秒以内（準リアルタイム） |
| クロスツール記憶継続率（主 KGI） | 95%以上 |

記憶境界はワークスペース（フォルダ）単位で厳格分離。private 指定は全ツール共通で適用し、保存時除外・検索デフォルト除外・監査ログを必須とする。

### 却下条件

Phase1 は以下のいずれかを満たさない場合、完了とみなさない。

- クロスツール記憶継続率 < 95%
- 導入に手編集が必要
- 導入に5分以上かかる
- doctor 全 green に到達しない
- P95 同期レイテンシ > 3秒
- 別フォルダのデータ混入が1件でも発生
- private データが検索デフォルトで出現
- 移行後のロールバック導線がない

詳細は [docs/harness-mem-setup.md](docs/harness-mem-setup.md#phase1-spec-lock) および [docs/world1-architecture-and-ops.md](docs/world1-architecture-and-ops.md#decision-lock) を参照。

### Phase1 証跡提出と凍結レビュー

```bash
# 証跡収集（提出物4JSONを生成）
scripts/harness-mem-proof-pack.sh --out-dir artifacts/proof-pack

# 3-run 凍結レビュー（必須ゲート + 連続pass判定）
scripts/freeze-review.sh

# 人間評価の最終ゲート検証
scripts/verify-human-eval.sh artifacts/human-eval/report.json
```

proof-pack の提出物（`--out-dir` 直下）:

- `onboarding-report.json`
- `continuity-report.json`
- `privacy-boundary-report.json`
- `session-selfcheck-report.json`

freeze-review の必須ゲート:

- 漏えい 0（`privacy.leak_count == 0`）
- 境界漏れ 0（`boundary.leak_count == 0`）
- 継続率 95%以上（`continuity_rate_pct >= 95`）
- 1コマンド導入（`one_command_onboarding == true`）
- 提出物4JSON不足なし
- 3-run 連続pass

## Supported Tools

| Tool | Status | Notes |
|---|---|---|
| Codex | Supported | Config wiring, ingestion, doctor checks |
| OpenCode | Supported | Global wiring + schema-safe config repair |
| Cursor | Supported | Global hooks + global MCP wiring + doctor checks |
| Claude workflows | Supported | Global MCP wiring (`~/.claude.json`) + migration/cutover path |
| Antigravity | Experimental | Hidden by default, opt-in via environment flags |

## Common Use Cases

1. Standardize memory behavior across mixed local toolchains.
2. Migrate from Claude-mem while preserving privacy tags.
3. Diagnose broken wiring quickly with one doctor command.
4. Keep local memory runtime stable when using npm/npx setup paths.

## Migration from Claude-mem

```bash
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
harness-mem verify-import --job <job_id>
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

Migration behavior:

- Imports by schema introspection (`observations`, `session_summaries`, `sdk_sessions`).
- Preserves privacy tags (`private`, `sensitive`) with default-hidden search behavior.
- Blocks cutover unless verification passes.

## Version Management

Capture and persist version status for Codex, Claude Code, OpenCode, Cursor, and Antigravity:

```bash
harness-mem versions
```

Saved files:

- `~/.harness-mem/versions/tool-versions.json` (latest snapshot)
- `~/.harness-mem/versions/tool-versions-history.jsonl` (append-only history)
- Snapshot includes Antigravity hook-introduction signals:
  - `upstream.antigravity.hooks_detected`
  - `alerts.antigravity_hooks_introduced` (one-time transition alert)

`setup` and `doctor` also run this snapshot automatically (disable with `--skip-version-check`).

## World-1 Baseline Benchmark

Capture comparable baseline JSON for quality/performance/token metrics:

```bash
bun test tests/benchmarks/baseline-output.test.ts
./tests/benchmarks/run-world1-baseline.sh before
# apply changes
./tests/benchmarks/run-world1-baseline.sh after
```

Generated files:

- `tests/benchmarks/output/before.json`
- `tests/benchmarks/output/after.json`

If both files exist, the script prints a compact delta summary (`Recall@10`, `MRR@10`, `search p95`, token reduction ratio).

## LOCOMO Benchmark

Run LOCOMO benchmark (harness-mem path):

```bash
bun run tests/benchmarks/run-locomo-benchmark.ts \
  --system harness-mem \
  --dataset tests/benchmarks/fixtures/locomo10.sample.json \
  --output artifacts/locomo-harness-mem.json
```

Detailed runbook:

- `docs/benchmarks/locomo-runbook.md`

## 3-layer Retrieval Workflow

Use progressive disclosure for lower token cost and better relevance:

1. `search` (ID shortlist + `meta.token_estimate`)
2. `timeline` (context around one ID + `meta.token_estimate`)
3. `get_observations` (full detail fetch for filtered IDs only)

When `get_observations` receives a large ID list, the API returns `meta.warnings[]` with guidance to go back to `search -> timeline -> get_observations`.

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

## FAQ

### Is this a hosted service?

No. Harness-mem is a local runtime and wiring CLI.

### Does it support private memory filtering?

Yes. Default retrieval hides private/sensitive data unless explicitly requested.

### Can I run setup without changing files first?

Yes. Use command-level dry runs where available (for example import planning with `--dry-run`).

### Where are advanced options and environment variables?

See `docs/harness-mem-setup.md`.

## Advanced Setup

For full command reference, environment variables, ingestion paths, and platform-specific notes:

- [Harness-mem Setup Guide](docs/harness-mem-setup.md)
- [World-1 Architecture, Migration, and Operations](docs/world1-architecture-and-ops.md)

## Release and Changelog

- Versioning follows SemVer.
- Automated release flow runs from Git tags via `.github/workflows/release.yml`.
- User-facing change history lives in [`CHANGELOG.md`](CHANGELOG.md).

## Contributing

Contributions are welcome through issues and pull requests.

- Issues: <https://github.com/Chachamaru127/harness-mem/issues>
- Repository: <https://github.com/Chachamaru127/harness-mem>

## License

MIT. See [`LICENSE`](LICENSE).

## Official Mascot

<p align="center">
  <img src="docs/assets/logos/harnes-mem/official/harness-mem-mascot-official.jpg" alt="Harness-mem official mascot" width="360" />
</p>

The mascot section is for brand continuity only and is intentionally separate from feature explanations.
