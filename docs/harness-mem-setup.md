# Harness-mem Setup Guide

This guide is the detailed reference for setup, diagnostics, migration, and environment tuning.

If you only want to get started quickly, use `/README.md` first.

## Phase1 Spec Lock

Phase1 Multi-Tool UX Superiority の実装において、以下の仕様・KPI・SLA・却下条件を固定する。
この文書が唯一の正本（Single Source of Truth）であり、実装・テスト・レビューはすべてこの定義に準拠する。

### 導入体験 KPI

| 指標 | 基準値 |
|---|---|
| セットアップコマンド数 | 1コマンドで完結 |
| セットアップ所要時間 | 5分以内 |
| doctor チェック結果 | 全項目 green |
| 手編集の要否 | 手編集なし |

### 同期 SLA

| 指標 | 基準値 |
|---|---|
| クロスツール記憶共有レイテンシ | P95 3秒以内（準リアルタイム） |

### 記憶境界

- ワークスペース（フォルダ）単位で厳格分離する。
- 別フォルダのデータ混入は 0件を必達とする。

### プライバシー

- 全ツール共通で private 指定を適用する。
- 保存時除外・検索デフォルト除外・監査ログを必須とする。

### 移行体験

- 1コマンドで `import → verify → cutover` を完結させる。
- ロールバック導線を必ず提供する。

### 主 KGI・トレードオフ優先

| 指標 | 基準値 |
|---|---|
| クロスツール記憶継続率（主 KGI） | 95%以上 |
| トレードオフ優先順位 | 記憶継続率（KGI）を最優先 |

### 対象ツール

Claude Code, Codex, Cursor

### Phase1 却下条件

Phase1 は以下のいずれかを満たさない場合、完了とみなさない。

- クロスツール記憶継続率 < 95%
- 導入に手編集が必要
- 導入に5分以上かかる
- doctor 全 green に到達しない
- P95 同期レイテンシ > 3秒
- 別フォルダのデータ混入が1件でも発生
- private データが検索デフォルトで出現
- 移行後のロールバック導線がない

---

## 1. Installation Paths

### npx (no global install)

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### global install

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup
```

## 2. Setup Flow

`harness-mem setup` performs:

1. Dependency checks (`bun`, `node`, `curl`, `jq`)
2. Tool wiring (Codex, OpenCode, Cursor, Claude, Antigravity)
3. Daemon start (`harness-memd`)
4. Smoke test
5. Search quality guard
6. Optional Claude-mem import + optional Claude-mem stop
7. Version snapshot (local vs upstream)

When `--platform` is omitted, setup is interactive:

1. Language
2. Target tools (multi-select)
3. Import from Claude-mem (yes/no)
4. Stop Claude-mem after verified import (yes/no)

## 3. Command Reference

### `setup`

Configure wiring, start daemon, and run verification checks.

```bash
harness-mem setup
harness-mem setup --platform codex,cursor
harness-mem setup --platform opencode,cursor --skip-quality
```

Options:

- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`
- `--skip-start`
- `--skip-smoke`
- `--skip-quality`
- `--skip-version-check`
- `--project <path>`
- `--quiet`

### `doctor`

Validate wiring and daemon health.

```bash
harness-mem doctor
harness-mem doctor --platform codex,cursor
harness-mem doctor --fix --platform opencode
```

Options:

- `--fix`
- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`
- `--skip-version-check`
- `--project <path>`
- `--quiet`

### `versions`

Snapshot local and upstream versions for all supported tools.

```bash
harness-mem versions
```

Outputs:

- `~/.harness-mem/versions/tool-versions.json`
- `~/.harness-mem/versions/tool-versions-history.jsonl`
- `upstream.antigravity.hooks_detected` and `alerts.antigravity_hooks_introduced`
  (hook-introduction signal + one-time transition alert)

### `smoke`

Run isolated end-to-end validation for record/search + privacy behavior.

```bash
harness-mem smoke
```

### `uninstall`

Remove wiring and optionally purge local DB.

```bash
harness-mem uninstall
harness-mem uninstall --purge-db
```

Options:

- `--purge-db`
- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`

### `import-claude-mem`

Import from existing Claude-mem SQLite.

```bash
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db --dry-run
```

Options:

- `--source <path>`
- `--import-project <name>`
- `--dry-run`
- `--quiet`

### `verify-import`

Verify an import job before cutover.

```bash
harness-mem verify-import --job <job_id>
```

Options:

- `--job <job_id>`
- `--quiet`

### `cutover-claude-mem`

Stop Claude-mem only after verification passed.

```bash
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

Options:

- `--job <job_id>`
- `--stop-now`
- `--quiet`

## 4. Platform Wiring Details

### Codex

- Verifies memory bridge entries in `~/.codex/config.toml`
- Checks ingest primary path from sessions rollout logs

### OpenCode

- Uses `~/.config/opencode/opencode.json`
- Uses `~/.config/opencode/plugins/harness-memory/index.ts`
- `doctor --fix --platform opencode` normalizes config schema

### Cursor

- Uses `~/.cursor/hooks.json`
- Uses `~/.cursor/hooks/memory-cursor-event.sh`
- Uses `~/.cursor/mcp.json` (`mcpServers.harness`)
- Ingests events from hook spool path

### Claude workflows

- Configures `mcpServers.harness` in `~/.claude.json` (global)
- If `~/.claude/settings.json` already has `mcpServers`, it is updated too
- Validates compatibility hooks through harness plugin checks
- Supports import/verify/cutover migration flow

### Antigravity

- Experimental and hidden by default
- Requires explicit enable flags

## 5. Environment Variables

### Core runtime

- `HARNESS_MEM_HOST` (default: `127.0.0.1`)
- `HARNESS_MEM_PORT` (default: `37888`)
- `HARNESS_MEM_UI_PORT` (default: `37901`)
- `HARNESS_MEM_LOG_MAX_BYTES` (default: `5242880`, 5MB)
- `HARNESS_MEM_LOG_ROTATE_KEEP` (default: `5`)

`scripts/harness-memd status|doctor|start` は `daemon.log` / `harness-mem-ui.log` を自動ローテーションし、
`harness-mem-ui.pid` を UI リスナー（`HARNESS_MEM_UI_PORT`）から自動同期します。

### Codex ingest

- `HARNESS_MEM_CODEX_SESSIONS_ROOT` (default: `~/.codex/sessions`)
- `HARNESS_MEM_CODEX_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_CODEX_BACKFILL_HOURS` (default: `24`)

### OpenCode ingest

- `HARNESS_MEM_ENABLE_OPENCODE_INGEST` (default: `true`)
- `HARNESS_MEM_OPENCODE_DB_PATH` (default: `~/.local/share/opencode/opencode.db`)
- `HARNESS_MEM_OPENCODE_STORAGE_ROOT` (default: `~/.local/share/opencode/storage`)
- `HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_OPENCODE_BACKFILL_HOURS` (default: `24`)

### Cursor ingest

- `HARNESS_MEM_ENABLE_CURSOR_INGEST` (default: `true`)
- `HARNESS_MEM_CURSOR_EVENTS_PATH` (default: `~/.harness-mem/adapters/cursor/events.jsonl`)
- `HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_CURSOR_BACKFILL_HOURS` (default: `24`)

### Antigravity ingest

- `HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST` (default: `false`)
- `HARNESS_MEM_ANTIGRAVITY_ROOTS` (default: auto-detect)
- `HARNESS_MEM_ANTIGRAVITY_LOGS_ROOT` (default: `~/Library/Application Support/Antigravity/logs`)
- `HARNESS_MEM_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT` (default: `~/Library/Application Support/Antigravity/User/workspaceStorage`)
- `HARNESS_MEM_ANTIGRAVITY_INGEST_INTERVAL_MS` (default: `5000`)
- `HARNESS_MEM_ANTIGRAVITY_BACKFILL_HOURS` (default: `24`)

## 6. API Endpoints Used by UI / Diagnostics

- `GET /v1/feed`
- `GET /v1/stream`
- `GET /v1/projects/stats`
- `GET /v1/sessions/list`
- `GET /v1/sessions/thread`
- `GET /v1/search/facets`
- `POST /v1/ingest/codex-history`
- `POST /v1/ingest/codex-sessions`
- `POST /v1/ingest/opencode-history`
- `POST /v1/ingest/opencode-sessions`
- `POST /v1/ingest/cursor-history`
- `POST /v1/ingest/cursor-events`
- `POST /v1/ingest/antigravity-history`
- `POST /v1/ingest/antigravity-files`
- `POST /v1/events/record`

### Progressive retrieval note

Prefer the 3-layer workflow for agent/tool callers:

1. `POST /v1/search` (candidate IDs + `meta.token_estimate`)
2. `POST /v1/timeline` (local context + `meta.token_estimate`)
3. `POST /v1/observations/get` (details only for filtered IDs, `meta.warnings[]` on large batch)

## 7. Import and Cutover Playbook

1. Import data:

```bash
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
```

2. Verify quality and privacy checks:

```bash
harness-mem verify-import --job <job_id>
```

3. Cut over only after verification passes:

```bash
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

## 8. Validation Checklist

Run these after setup:

```bash
harness-mem doctor
harness-mem smoke
./tests/test-memory-search-quality.sh
```

Expected outcome:

- daemon is healthy
- wiring is present for selected platforms
- private/sensitive records stay hidden by default
- quality guard checks pass

```bash
# Phase1 proof collection
scripts/proof-pack.sh

# Phase1 freeze review (3x E2E)
scripts/freeze-review.sh

# Human evaluation gate verification
scripts/verify-human-eval.sh artifacts/human-eval/sample.json
```

`scripts/harness-mem-proof-pack.sh` は提出用に以下4JSONを常に生成する（`--out-dir` 直下）。

- `onboarding-report.json`
- `continuity-report.json`
- `privacy-boundary-report.json`
- `session-selfcheck-report.json`

`scripts/freeze-review.sh` は run ごとに以下を必須ゲートとして判定する。

- 漏えい 0（`privacy.leak_count == 0`）
- 境界漏れ 0（`boundary.leak_count == 0`）
- 継続率 95%以上（`continuity_rate_pct >= 95`）
- 1コマンド導入（`one_command_onboarding == true`）
- 提出物4JSONの不足なし
- 3-run 連続 pass

## 8.1 セットアップ時・セッション開始時の自動チェック

harness-mem は、ユーザーの手動定期実行に頼らず環境不整合を検出します。

### セットアップ時

`harness-mem setup` 実行後、診断結果が `~/.harness-mem/runtime/doctor-last.json` に保存されます。`all_green=false` の場合は終了メッセージで修復コマンド（`harness-mem doctor --fix`）が表示されます。

### セッション開始時（Claude）

SessionStart フック（startup/resume）で軽量セルフチェックが自動実行されます。

- **検出内容**: daemon 到達可否、backend_mode、warnings（managed blocked 等）
- **異常時**: 1回だけ `cleanup-stale` → `start` を試行（5分クールダウン）
- **結果**: `.claude/state/memory-self-check.json`（最新）、`memory-self-check.jsonl`（履歴）
- **警告**: 失敗時は `.claude/state/memory-self-check-warning.md` に修復手順を出力。成功時は自動クリア。

### 運用フロー（検出 → 自動回復 → 手動修復）

1. **検出**: セッション開始時に self-check が daemon 非到達などを検出
2. **自動回復**: 1回だけ daemon 再起動を試行（クールダウン内はスキップ）
3. **手動修復**: 自動回復で解決しない場合は `memory-self-check-warning.md` の手順に従い `harness-mem doctor --fix` を実行

## 9. Local Repository Usage

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem
scripts/harness-mem setup
scripts/harness-mem doctor
```

## 10. Mem UI (Standalone)

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui
bun install
bun run dev
```

Default URL: `http://127.0.0.1:37901`

## 11. Uninstall and Cleanup

```bash
harness-mem uninstall
harness-mem uninstall --purge-db
```

This will:

- stop daemon
- remove managed wiring blocks
- remove OpenCode plugin wiring
- optionally remove `~/.harness-mem/harness-mem.db`

## 12. Troubleshooting

### setup 失敗時の対処

`harness-mem setup` が失敗すると、失敗したステップとその修復コマンドが表示されます。

```
[harness-mem] セットアップで失敗がありました。修復手順:
  [FAIL] codex_wiring        => harness-mem setup --platform codex
  [FAIL] daemon_start        => harness-memd start

  自動修復:    harness-mem doctor --fix --platform codex,cursor
  再実行:      harness-mem setup --platform codex,cursor --skip-smoke --skip-quality
```

#### よくある失敗パターンと解決法

| 症状 | 原因 | 解決法 |
|---|---|---|
| `bun is missing` | bun 未インストール | `brew install bun` または https://bun.sh |
| `jq is missing` | jq 未インストール | `brew install jq` |
| `node is missing` | Node.js 未インストール | `brew install node` |
| `Codex notify wiring is missing` | Codex 配線なし | `harness-mem setup --platform codex` |
| `Cursor hooks wiring is incomplete` | Cursor 配線なし | `harness-mem setup --platform cursor` |
| `Claude MCP wiring is missing` | Claude 配線なし | `harness-mem setup --platform claude` |
| `Daemon doctor reported warnings` | daemon 停止中 | `harness-memd start` |
| `Port <port> is already in use by another process` | 既存プロセスがポート占有 | 競合プロセス停止または `HARNESS_MEM_PORT` / `HARNESS_MEM_UI_PORT` を変更 |
| `doctor_post_check` failed | セットアップ後の診断で不整合 | `harness-mem doctor --fix` |

### doctor --fix を使った自動修復

`doctor --fix` は失敗した項目を検出し、自動的に `setup_impl` を実行して修復します。

```bash
# 全プラットフォームを修復
harness-mem doctor --fix

# 特定プラットフォームのみ修復
harness-mem doctor --fix --platform codex,cursor,claude
```

### doctor --json で構造化出力を取得

スクリプトや CI から doctor 結果を取得する場合は `--json` フラグを使います。

```bash
harness-mem doctor --json
```

出力例:

```json
{
  "status": "unhealthy",
  "checks": [
    {"name": "bun", "status": "ok", "fix": null},
    {"name": "codex_wiring", "status": "missing", "fix": "harness-mem setup --platform codex"},
    {"name": "daemon", "status": "unhealthy", "fix": "harness-memd start"}
  ],
  "fix_command": "harness-mem doctor --fix"
}
```

### 手動修復手順

依存コマンドのインストール:

```bash
brew install bun curl jq node
```

Codex 配線の手動確認:

```bash
cat ~/.codex/config.toml | grep memory-codex-notify
```

Cursor 配線の手動確認:

```bash
cat ~/.cursor/hooks.json | jq '.hooks.beforeSubmitPrompt'
cat ~/.cursor/mcp.json | jq '.mcpServers.harness'
```

Claude 配線の手動確認:

```bash
cat ~/.claude.json | jq '.mcpServers.harness'
```

daemon の手動起動:

```bash
harness-memd start
curl http://127.0.0.1:37888/health
```

### doctor 全 green 到達フロー

```bash
# 1. doctor で現状確認
harness-mem doctor

# 2. 問題があれば自動修復
harness-mem doctor --fix

# 3. 再度 doctor で全 green 確認
harness-mem doctor

# 4. 確認（daemon が正常に動いているか）
curl -sS http://127.0.0.1:37888/health | jq '.ok'
```

## 13. Claude-mem からの移行

### 1コマンド移行フロー

`migrate-from-claude-mem` コマンドは `import → verify → cutover` を1コマンドで完結させます。

```bash
# Claude-mem から harness-mem へ1コマンド移行
harness-mem migrate-from-claude-mem
```

内部では以下の3ステップを自動実行します:

1. **Step 1/3: Import** - `~/.claude-mem/claude-mem.db` からイベントをインポート
2. **Step 2/3: Verify** - インポートしたデータの整合性・プライバシーチェックを検証
3. **Step 3/3: Cutover** - verify 通過後にのみ Claude-mem を停止

verify が失敗した場合は cutover は実行されず、エラーメッセージとともに中断されます。

### ロールバック

移行後に Claude-mem へ戻したい場合は `rollback-claude-mem` を使います。

```bash
harness-mem rollback-claude-mem
```

これにより:
- `claude-mem start` で Claude-mem を再起動
- 無効化された LaunchAgent (`.plist.disabled`) を再有効化

### 段階的移行（手動）

自動移行ではなく段階的に確認しながら進める場合は従来のサブコマンドを使います:

```bash
# 1. インポート（dry-run で確認）
harness-mem import-claude-mem --source ~/.claude-mem/claude-mem.db --dry-run

# 2. 本番インポート
harness-mem import-claude-mem --source ~/.claude-mem/claude-mem.db

# 3. インポート結果を検証
harness-mem verify-import --job <job_id>

# 4. verify 確認後に cutover
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

## 14. Related Files

- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-mem`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-memd`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-mem-client.sh`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/test-memory-search-quality.sh`
- `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/docs/world1-architecture-and-ops.md`
