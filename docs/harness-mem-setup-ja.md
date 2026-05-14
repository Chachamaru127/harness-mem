# Harness-mem セットアップガイド

このガイドは、セットアップ、診断、移行、環境調整のための詳細リファレンスです。
まず全体像だけ知りたい場合は `README.md` を先に読んでください。

Claude Code + Codex の初回セットアップは、まずこの手順を使ってください。

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude
npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform codex,claude
```

成功の目安は次の3つです。

- `doctor` が両方のクライアントで green
- `~/.codex/hooks.json` と `~/.claude.json` が現在の harness-mem の checkout を参照している
- 各対応クライアントの最初のプロンプトで、直前の作業コンテキストを復元できる

関連ドキュメント:

- [`onboarding-checklist-ja.md`](./onboarding-checklist-ja.md)
- [`onboarding-dry-run-ja.md`](./onboarding-dry-run-ja.md)
- [`readme-claims-ja.md`](./readme-claims-ja.md)
- [`doctor-ux-scope-ja.md`](./doctor-ux-scope-ja.md)

## 1. インストール経路

### Claude Code + Codex 向けの推奨セットアップ

セットアップは 3 段階で考えると分かりやすいです。

1. パッケージの入手
   まず上の `npx` コマンドを使ってください。常用のコマンドとして残したい場合だけ `npm install -g` を代替として使います。
2. クライアント配線
   `harness-mem setup` を実行すると、各クライアントの home 配下の設定に hooks と MCP 配線を書き込みます。
3. 検証
   `harness-mem doctor` を実行して、daemon・hooks・MCP 配線が本当に正常か確認します。

`npm install` だけではセットアップは完了しません。CLI が使えるようになるだけです。Claude / Codex / Cursor への接続作業は `harness-mem setup` で行われます。

このガイドでの既定方針は次の通りです。

- 初回は `npx`
- `sudo` を使わずに global install できる場合だけ `npm install -g`
- repo checkout の手順は contributor 向け
- Windows では標準の Unix 系パスが使えない場合にだけ Git Bash / WSL2 を選ぶ

### `sudo` なしで進める理由

`harness-mem setup` はユーザー単位の path に書き込みます。

- `~/.harness-mem/`
- `~/.codex/`
- `~/.claude.json`
- `~/.claude/settings.json`
- `~/.cursor/`

`sudo harness-mem setup` を使うと、`HOME` が root 側に寄ってしまい、設定が違う場所に書かれたり、作成された file の所有権が root になることがあります。あとで更新や self-repair をしにくくなるので避けてください。

### Windows メモ

Windows の PowerShell / CMD 単体は、まだ full setup の最適経路ではありません。

理由:

- 公開 CLI は setup と hook wiring で POSIX shell script に依存している
- runtime wiring は Unix 寄りの hook command と path を書き込む
- harness-mem は Windows 上の Git Bash を検出して、既存 shell script をそこから起動できる
- Codex / Claude の manual setup と doctor では、Git Bash が実用的な native Windows 経路になる
- どうしても shell / toolchain が不安定なら WSL2 を fallback にする
- 例外として、Claude / Codex の MCP-only 更新は `harness-mem mcp-config --write --client claude,codex` で native に実行できる

Windows で full setup を行う場合に必要なもの:

- `node`
- `npm`
- `curl`
- `jq`
- `bun`
- `rg` (`ripgrep`)

global npm install に昇格権限が必要な環境なら、`sudo` で通すより `npx` 経路を使ってください。

### `npx`

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

Windows では、native compatibility path としては global install のほうを優先してください。

### global install

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup
```

Windows では Git Bash から実行してください。

normal user で `npm install -g` が通る場合、または npm prefix が user-writable になっている場合だけこの経路を使ってください。

### 既存 install の更新

```bash
harness-mem update
```

`harness-mem update` は、auto-update opt-in がまだ無効なときだけ確認を出し、その後に次を実行します。

```bash
npm install -g @chachamaru127/harness-mem@latest
```

package 更新が成功したあと、harness-mem は過去の `setup` で覚えた client platforms に対して quiet な post-update repair (`doctor --fix`) を走らせ、壊れた hook/config wiring を自己修復します。

## 2. セットアップの流れ

`harness-mem setup` が行うこと:

1. 依存チェック (`bun`, `node`, `curl`, `jq`, `ripgrep`)
2. tool wiring (`codex`, `opencode`, `cursor`, `claude`, `antigravity`)
3. daemon 起動 (`harness-memd`)
4. Mem UI 起動 (`http://127.0.0.1:37901` 既定)
5. smoke test (`--skip-smoke` で省略可)
6. search quality check (`--skip-quality` で省略可)
7. 任意の Claude-mem import と、検証済み cutover 後の停止
8. version snapshot (`local` と `upstream`)

`--platform` を指定しない場合は対話式です。

1. 言語
2. 対象 tools (複数選択)
3. Claude-mem から import するか
4. 検証済み import 後に Claude-mem を止めるか
5. auto-update opt-in を有効にするか

### `1 コマンド setup` の意味

最初の導入では、次の3段階で考えると分かりやすいです。

1. まず 1 つの install path を選ぶ
   ここでは `npx` が最も安全な既定です。global install が不要で、権限問題にも引っかかりにくいからです。
2. `harness-mem setup` を実行する
   これが実際の wiring 作業です。選んだ client の hooks と MCP を設定し、local runtime を起動して、各種チェックも行います。
3. `harness-mem doctor` を実行する
   本当に動いているかを確認します。

例:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude
npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform codex,claude
```

repo checkout から再現可能に進めたい contributor は、次を使ってください。

```bash
bash scripts/setup-codex-memory.sh
npm run codex:doctor
```

### Claude Plugin Marketplace

- Claude Code に plugin を入れる
- Claude 側の hooks と MCP は自動で wired される
- Codex や Cursor も配線したい場合は、別途 `harness-mem setup --platform codex,cursor` を実行する

### Continuity UX の現在の契約

- Claude Code と Codex は、client hook path が有効で daemon が healthy で、`harness-mem doctor` が green のときに first-turn continuity を出せる
- supported hook path では、SessionStart は chain-first を先頭に置き、distinct な近接プロジェクト活動がある場合にだけ短い `Also Recently in This Project` teaser を追加する
- これは runtime contract であり、全 client に対する blanket guarantee ではない
- hook や local runtime が stale だと、search や manual recall は動いても、「新しい session を開いたら前回の続きを覚えている」体験は落ちる

### runtime 構成と MCP プロセス

プロセス層は 2 つに分かれます。

| 層 | 既定の接続先 | 役割 | 正常な数 |
|---|---|---|---|
| memory daemon (`harness-memd`) | `127.0.0.1:37888` | TypeScript/Bun server、SQLite 接続、runtime API | local runtime ごとに 1 つ |
| Streamable HTTP MCP gateway (opt-in) | `127.0.0.1:37889/mcp` | token 認証付き loopback HTTP transport の Go MCP gateway。`:37888` に proxy する | 共有 local gateway として 1 つ |
| stdio MCP frontend | client stdin/stdout | MCP tool を公開し、`:37888` に proxy する frontend process。Go binary を優先し、Node.js fallback も使える | 開いている MCP client session ごとに 1 つ |

stdio MCP frontend process が複数見えるだけでは、すぐ障害とは判定しません。Go binary
経路では `harness-mcp-darwin-arm64` / `harness-mcp-*` として見えることが多いです。
Claude Code / Codex / Cursor / Hermes の session を複数開いているなら、stdio MCP frontend が
session 数に応じて増えるのは自然です。cleanup 対象は、親 client が消えた stale / orphan な
stdio 子プロセスです。

本当に危険なのは、`127.0.0.1:37888` や同じ SQLite runtime state を複数の memory daemon が
取り合う daemon split-brain です。これは daemon lifecycle の問題であり、通常の stdio MCP
frontend 増加とは別物です。

stdio 自体を shared singleton broker にする方針は推奨しません。stdio MCP client は、自分が
起動した local server subprocess を監視する前提で動くため、broker 化すると停止責任、
project 分離、認証の見通しが悪くなります。frontend プロセス数を減らす中期方針は、
既存 stdio MCP を互換 fallback として残しつつ、`http://127.0.0.1:37889/mcp` の
local-only Streamable HTTP MCP gateway を opt-in で導入することです。

opt-in gateway lifecycle:

```bash
export HARNESS_MEM_MCP_TOKEN="<local-secret>"
harness-mem mcp-gateway start
harness-mem mcp-gateway status
harness-mem doctor --mcp-transport http
```

`mcp-gateway status --json` は running pid、endpoint、auth mode、gateway probe、memory
daemon health を返します。gateway は `HARNESS_MEM_HOME` 配下の独立した pidfile / log を
使い、`harness-memd` を置き換えるものではありません。

HTTP MCP の opt-in 設定生成:

```bash
# Claude / Codex の HTTP MCP 設定。token の値そのものは shell env に残す
harness-mem mcp-config --transport http --client claude,codex --write

# Hermes は tier 3 / experimental なので、明示したときだけ YAML を書く
harness-mem mcp-config --transport http --client hermes --write
```

生成される HTTP 設定は `http://127.0.0.1:37889/mcp` を向きます。設定ファイルに書くのは
`HARNESS_MEM_MCP_TOKEN` という環境変数名、または `Bearer ${HARNESS_MEM_MCP_TOKEN}` という
参照文字列だけです。秘密 token の実値は書きません。`--client all` は意図的に Claude +
Codex だけを対象にします。Hermes YAML を書く場合は `--client hermes` を明示します。

## 3. コマンドリファレンス

### `setup`

配線、daemon/UI 起動、検証チェックを行います。

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

配線と daemon/UI の健康状態を確認します。

```bash
harness-mem doctor
harness-mem doctor --platform codex,cursor
harness-mem doctor --fix --platform opencode
harness-mem doctor --json --read-only
harness-mem doctor --json --strict-exit
harness-mem doctor --fix --plan
```

Options:

- `--fix`
- `--json`
- `--read-only`
- `--strict-exit`
- `--plan`（`--fix` と組み合わせると、変更せず修復予定だけ確認する）
- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`
- `--skip-version-check`
- `--project <path>`
- `--quiet`

### `update`

global package を更新し、auto-update opt-in が無効なら有効化確認を出します。

```bash
harness-mem update
```

備考:

- interactive TTY では、auto-update がまだ無効なときだけ `Enable opt-in automatic updates for harness-mem?` (`y/N`) を聞く
- 選択結果は `~/.harness-mem/config.json` (`auto_update.enabled`) に保存される

### `versions`

local と upstream の version を snapshot します。

```bash
harness-mem versions
```

出力先:

- `~/.harness-mem/versions/tool-versions.json`
- `~/.harness-mem/versions/tool-versions-history.jsonl`

### `smoke`

record/search と privacy 行動の isolated end-to-end validation を行います。

```bash
harness-mem smoke
```

### `uninstall`

配線を削除し、必要に応じて local DB も消します。

```bash
harness-mem uninstall
harness-mem uninstall --purge-db
```

Options:

- `--purge-db`
- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`

### `import-claude-mem`

既存の Claude-mem SQLite DB から import します。

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

cutover 前に import job を検証します。

```bash
harness-mem verify-import --job <job_id>
```

Options:

- `--job <job_id>`
- `--quiet`

### `cutover-claude-mem`

検証に通った後だけ Claude-mem を止めます。

```bash
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

Options:

- `--job <job_id>`
- `--stop-now`
- `--quiet`

## 4. プラットフォーム別 wiring

### Codex

- `~/.codex/hooks.json` の `SessionStart`、`UserPromptSubmit`、`Stop` を維持する
- `~/.codex/config.toml` で experimental hooks engine (`features.codex_hooks = true` または `[features] codex_hooks = true`) を有効にする
- `~/.codex/config.toml` の memory bridge entry を確認する
- `~/.codex/config.toml` と `~/.codex/hooks.json` が古い absolute path ではなく、現在の harness-mem checkout を指しているか確認する
- `~/.codex/skills/harness-mem/SKILL.md` と `~/.codex/skills/harness-recall/SKILL.md` の 2 skill を install / check する
- `doctor.v2` JSON では `codex_skill_drift` と `codex_post_doctor_liveness` を報告する
- 代表例: `codex_skill_drift.status="ok"` は 2 skill が同期済み、`codex_post_doctor_liveness.status="ok"` は doctor 後も runtime health が取れている状態を示す
- Codex session logs から ingest path を確認する
- Codex の first-turn continuity は、上の hook path と healthy な daemon/runtime の両方に依存する

手動 MCP 確認:

ローカル checkout の binary を使う場合は、harness-mem repo root で実行してください。global install 済みなら `harness-mcp-server`、一回だけ package から確認するなら `npx -y --package @chachamaru127/harness-mem harness-mcp-server` を使えます。

```bash
./bin/harness-mcp-server <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-check","version":"1"}}}'
codex mcp list
codex mcp get harness
```

この確認コマンドは、1 つの stdio MCP frontend process を起動します。実運用では、
開いている MCP client session ごとに frontend process が起動することがあります。
それらの frontend は、背後の `127.0.0.1:37888` daemon を共有します。

### OpenCode

- `~/.config/opencode/opencode.json` を使う
- `~/.config/opencode/plugins/harness-memory/index.ts` を使う
- `doctor --fix --platform opencode` で config schema を正規化できる

### Cursor

- `~/.cursor/hooks.json` を使う
- `~/.cursor/hooks/memory-cursor-event.sh` を使う
- `~/.cursor/mcp.json` (`mcpServers.harness`) を使う

### Claude の流れ

- Claude Code Plugin Marketplace の wiring は、Claude 側の hooks と MCP を自動設定する
- `harness-mem setup --platform claude` でも、同じ Claude-side runtime path を marketplace を使わずに設定できる
- `mcpServers.harness` を `~/.claude.json` に設定する
- `~/.claude/settings.json` に MCP block がある場合はそれも更新する
- Claude Code `v2.1.119` では `/config` の変更が `~/.claude/settings.json` に永続化されるので、実運用では `~/.claude.json` と `~/.claude/settings.json` の両方で project/local/policy precedence を意識する
- 2 つのファイルが併存していると、高い precedence 側の設定が古い MCP wiring を上書きすることがある。`/config` を触った後は `harness-mem doctor` で、active path が current harness-mem checkout を向いているか確認する
- Claude の first-turn continuity は、`SessionStart` / `UserPromptSubmit` / `Stop` の hook path と healthy な daemon/runtime に依存する
- Codex や Cursor も使うなら、`harness-mem setup --platform codex,cursor` でそれぞれ別に wiring する
- import / verify / cutover migration flow もサポートする

### Antigravity

- experimental で hidden by default
- explicit opt-in flags が必要

## 5. 環境変数

### core runtime

- `HARNESS_MEM_HOST` (default: `127.0.0.1`)
- `HARNESS_MEM_PORT` (default: `37888`) は memory daemon 用。shared stdio MCP frontend 用ではない
- `HARNESS_MEM_UI_PORT` (default: `37901`)
- `HARNESS_MEM_ENABLE_UI` (default: `true`)
- `HARNESS_MEM_LOG_MAX_BYTES` (default: `5242880`, 5MB)
- `HARNESS_MEM_LOG_ROTATE_KEEP` (default: `5`)
- `HARNESS_MEM_MCP_ADDR` (default: `127.0.0.1:37889`)
- `HARNESS_MEM_MCP_URL` (`mcp-config --transport http` で使う接続先 URL を直接指定する場合)
- `HARNESS_MEM_MCP_PATH` (default: `/mcp`, `HARNESS_MEM_MCP_URL` 未指定時に使用)
- `HARNESS_MEM_MCP_TOKEN` (`mcp-gateway start` では必須。互換 fallback として `HARNESS_MEM_REMOTE_TOKEN` も使用可)
- `HARNESS_MEM_MCP_TOKEN_ENV_VAR` (default: `HARNESS_MEM_MCP_TOKEN`, 設定時に書く token 環境変数名)
- `HARNESS_MEM_MCP_GATEWAY_START_TIMEOUT_SEC` (default: `10`)
- `HARNESS_MEM_MCP_GATEWAY_STOP_TIMEOUT_SEC` (default: `5`)
- `HARNESS_MEM_MCP_GATEWAY_LAUNCHD_LABEL` (default: `com.harness-mem.mcp-gateway`)

### Codex ingest

- `HARNESS_MEM_CODEX_SESSIONS_ROOT` (default: `~/.codex/sessions`)
- `HARNESS_MEM_CODEX_INGEST_INTERVAL_MS` (default: `60000`)
- `HARNESS_MEM_CODEX_BACKFILL_HOURS` (default: `24`)

### OpenCode ingest

- `HARNESS_MEM_ENABLE_OPENCODE_INGEST` (default: `true`)
- `HARNESS_MEM_OPENCODE_DB_PATH` (default: `~/.local/share/opencode/opencode.db`)
- `HARNESS_MEM_OPENCODE_STORAGE_ROOT` (default: `~/.local/share/opencode/storage`)
- `HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS` (default: `60000`)
- `HARNESS_MEM_OPENCODE_BACKFILL_HOURS` (default: `24`)

## 6. Environment タブ (read-only)

Mem UI には non-specialist 向けの `Environment` タブがあります。

- Purpose:
  - 現在の internal servers を表示する
  - installed されている languages/runtimes を表示する
  - installed CLI tools を表示する
  - AI / MCP tool status を表示する
- API:
  - daemon: `GET /v1/admin/environment` (admin token required)
  - UI proxy: `GET /api/environment`
- Safety:
  - V1 は read-only
  - API は sensitive values (`token`, `api_key`, `secret` など) を mask する

Contract details: `plans/environment-tab-v1-contract.md`

## 7. Troubleshooting

### `Command not found`

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### doctor が dependency 不足を報告する

必要な dependency を入れて repair します。

```bash
harness-mem doctor --fix
```

### UI が開かない

```bash
harness-memd doctor
curl -sS http://127.0.0.1:37901/api/health | jq '.ok'
```
