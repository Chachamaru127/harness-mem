# Hermes Agent ↔ harness-mem 統合

[Nous Research の Hermes Agent](https://github.com/nousresearch/hermes-agent) から harness-mem を利用するための設定例とドキュメント。

harness-mem との接続には **2 レイヤー** がある。どちらも **追加経路** であり、Hermes built-in の `MEMORY.md` / `USER.md` / `skills/` や、既存の MCP 設定を消すものではない。

| レイヤー | 接続方式 | 主な用途 |
|---|---|---|
| **Layer 1** | stdio / HTTP MCP (`mcp_servers.harness_mem`) | モデルが `harness_mem_search` 等を **明示 tool call** で呼ぶ cross-tool 検索・書き込み |
| **Layer 2** | Hermes MemoryProvider plugin (`memory.provider=harness_mem`) | `sync_turn` / `prefetch` / `on_session_end` で turn 同期と prefetch 注入。provider ツール `harness_mem_search` / `harness_mem_record` / `harness_mem_status` も公開 |

Layer 1 は stdio MCP サーバー (`mcp-server/` または `mcp-server-go/`) を **そのまま** 接続できる。Layer 2 は `integrations/hermes/provider/` の MemoryProvider plugin を `~/.hermes/plugins/harness_mem` に配置する。両方とも **同じ harness-mem daemon / SQLite DB** を使う。

### 事実抽出 LLM ポリシー（consolidation）

Layer 2 MemoryProvider は **thin bridge** で、LLM 事実抽出は **行いません**。consolidation daemon がポリシーを所有します。既定は `heuristic` 抽出。LLM 抽出は `HARNESS_MEM_FACT_EXTRACTOR_MODE=llm` が必要で、未設定の provider は `ollama`（loopback のみ）。外部クラウド provider は `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1` と credential の両方が必要。非 loopback Ollama は allow flag があっても拒否されます。

詳細: [`docs/environment-variables.md`](../../docs/environment-variables.md)（LLM セクション）。

**検証状況:** live cloud E2E は未実施です。H156-007 の loopback Ollama live smoke は、isolated daemon + temporary DB で実行済みです（fact extraction/search 成功、external LLM egress 0件）。

## このintegrationの位置付け

**これは何か**:
- Claude Code / Codex / Cursor が harness-mem に記録した作業記憶を、**Hermes から検索・参照するための窓口**
- Layer 1: MCP 経由で明示的に harness-mem に読み書き
- Layer 2: Hermes MemoryProvider API 経由で turn 同期・prefetch・checkpoint 記録（実機 E2E 済み）
- 複数ツール横断の **継続性レイヤー (cross-tool continuity layer)** として機能

**これは何でないか**:
- Hermes built-in の `~/.hermes/MEMORY.md` / `USER.md` / `skills/` を **置き換える** ものではない。Layer 2 を有効化しても built-in 記憶層はそのまま動き続ける。
- Layer 1 MCP を Layer 2 有効化で **無効化するものではない**。必要なら MCP と MemoryProvider を **並行** 運用できる。
- Layer 1 だけでは、Hermes が自動学習した内容を harness-mem に **自動転送する** 機構にはならない（明示 tool call または Layer 2 の `sync_turn` が必要）。

### memory layer 比較

| 観点 | Hermes built-in | harness-mem Layer 1 (MCP) | harness-mem Layer 2 (MemoryProvider) |
|---|---|---|---|
| データ形式 | Markdown (`MEMORY.md`, `USER.md`, `skills/`) | 構造化 observation (SQLite) | 同上（同一 DB） |
| recall | システムプロンプト先頭注入 | MCP tool 経由の明示 query | `prefetch()` による turn 前コンテキスト注入 + provider ツール |
| 更新 | LLM が markdown を直接編集 | `harness_mem_record_*` 等の明示呼び出し | `sync_turn()` による turn 記録 + `harness_mem_record` |
| 共有範囲 | Hermes 単体 | Claude Code / Codex / Cursor / Hermes | 同上 |

built-in memory、harness-mem Layer 1、Layer 2 は **競合せず補完** の関係。

### サポート tier

harness-mem の Plans.md (§69-92) では **Hermes 統合は tier 3 (experimental)** 指定。Claude Code + Codex (tier 1) と同等の動作保証は現時点でなし。挙動が不安定な場合があるため、本番運用前に動作確認を推奨。

## 前提

- harness-mem **v0.20.0 以上** が install 済み（[ルート README](../../README.md) のセットアップ参照）
- `~/.harness-mem/runtime/harness-mem` runtime バイナリが存在（`harness-mem doctor` で確認可能）
- Hermes Agent が install 済み（`uv pip install -e ".[mcp]"` を含む）

## クイックスタート — Layer 1 (MCP)

`~/.hermes/config.yaml` （または Hermes が読む config 配下）に以下を追記:

```yaml
mcp_servers:
  harness_mem:
    command: "/Users/<you>/.harness-mem/runtime/harness-mem"
    args: ["mcp"]
    env:
      HARNESS_MEM_PROJECT_KEY: "your-project-key"
      HARNESS_MEM_MCP_SEARCH_SAFE_MODE: "1"
      HARNESS_MEM_CODEX_INGEST_INTERVAL_MS: "60000"
      HARNESS_MEM_CLAUDE_CODE_INGEST_INTERVAL_MS: "60000"
      HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS: "60000"
      HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS: "60000"
      HARNESS_MEM_GEMINI_INGEST_INTERVAL_MS: "60000"
    tools:
      include:
        - harness_mem_search
        - harness_mem_timeline
        - harness_mem_get_observations
        - harness_mem_resume_pack
        - harness_mem_record_checkpoint
```

`<you>` は実際のホームディレクトリ名に置き換え。`HARNESS_MEM_PROJECT_KEY` は Claude Code / Codex で使っているものと **同じ値** にすると、メモリ空間が共有される。

`HARNESS_MEM_MCP_SEARCH_SAFE_MODE=1` は Hermes 向けの軽量検索モード。大きいローカル DB で `vector_engine=js-fallback` の場合、`harness_mem_search` が tool deadline を超えやすいため、Step 1 では link / graph / vector を切って FTS-first の候補検索に寄せる。必要な詳細は `harness_mem_timeline` / `harness_mem_get_observations` で段階的に読む。

HTTP MCP gateway を試す場合は、手書きではなく生成コマンドを使う:

```bash
export HARNESS_MEM_MCP_TOKEN="<local-secret>"
harness-mem mcp-gateway start
harness-mem mcp-config --transport http --client hermes --write
```

この方式は `url:` と `Authorization: "Bearer ${HARNESS_MEM_MCP_TOKEN}"` を書く。token の実値は
config に保存しない。Hermes は experimental tier のため、`--client all` には含めず
`--client hermes` を明示した場合だけ YAML を書く。

## クイックスタート — Layer 2 (MemoryProvider)

Hermes の [MemoryProvider plugin API](https://hermes-agent.nousresearch.com/docs/developer-guide/memory-provider-plugin) で harness-mem を **追加の記憶 backend** として有効化する。実機 E2E（turn 記録・search・prefetch・別 session recall）は S112-008 で確認済み。

### 1. 事前確認

- harness-mem daemon が ready（`~/.harness-mem/runtime/harness-mem doctor`）
- Hermes Agent が install 済み

### 2. config バックアップ（必須）

`hermes config set` は **ローカル config を書き換える**。必ず operator 承認のうえ、変更前にバックアップを取る:

```bash
cp ~/.hermes/config.yaml \
  ~/.hermes/config.yaml.bak.harness_mem_provider.$(date +%Y%m%d%H%M%S)
```

バックアップファイル名のタイムスタンプは環境ごとに異なる。**特定の過去ファイル名を universal path としてコピーしない**こと。

### 3. provider 配置と有効化

リポジトリ clone から provider ファイルを Hermes の plugin 配置先へ同期し、MemoryProvider を選択する:

```bash
mkdir -p "$HOME/.hermes/plugins/harness_mem"
rsync -a --delete integrations/hermes/provider/harness_mem/ "$HOME/.hermes/plugins/harness_mem/"
hermes config set memory.provider harness_mem
```

`HARNESS_MEM_PROJECT_KEY` 等の env は Layer 1 と同様に Hermes 実行環境で揃えると、Claude Code / Codex とメモリ空間が共有される。docs に **秘密情報（API key / token 実値）は書かない**。

### 4. discovery / load の期待結果

S112-008 実機 E2E で確認済みの期待値:

- 配置先: `~/.hermes/plugins/harness_mem`
- config: `memory.provider=harness_mem`
- `discover_memory_providers()` が `harness_mem` を **available** と報告
- `load_memory_provider("harness_mem")` が `HarnessMemMemoryProvider` を返す
- provider ツール: `harness_mem_search`, `harness_mem_record`, `harness_mem_status`

再現用の Hermes Python API 呼び出しコマンドは repo 内 checkpoint に固定されていないため、上記を Hermes 側の provider discovery 手順で確認する。詳細は [`docs/integrations/hermes.md`](../../docs/integrations/hermes.md) の「Layer 2 MemoryProvider 運用」を参照。

### 5. smoke チェックリスト（概要）

以前の live E2E で以下が成功している（observation ID / session ID / marker 値は docs に固定しない）:

1. daemon ready
2. Hermes session を開始
3. **非 secret の一意 marker** を `harness_mem_record` または turn 同期で記録
4. 同 session で `harness_mem_search` が marker を hit
5. 次 turn の prefetch が `## harness-mem Context` を含む
6. **別 session** から同 marker を recall できる

live smoke の具体手順・rollback は詳細ガイドを参照。

## 設定例の選び方

| シナリオ | 推奨 config |
|---|---|
| まず動かす / 試したい | [examples/hermes-config-minimal.yaml](examples/hermes-config-minimal.yaml) — 5ツール |
| 全機能を有効化 / admin 操作も使う | [examples/hermes-config-full.yaml](examples/hermes-config-full.yaml) — 28ツール |

最小設定では検索・読み取り・チェックポイント記録のみを許可し、context 膨張を避ける。
大規模 DB では最小設定のまま `HARNESS_MEM_MCP_SEARCH_SAFE_MODE=1` を維持するのが推奨。検索精度を上げたい場合だけ、個別 tool call で `safe_mode=false` または `vector_search=true` に戻す。

## ツール一覧（プレフィックス: `harness_mem_*`）

### 読み取り系（safe to expose）

| ツール | 用途 |
|---|---|
| `harness_mem_search` | 候補 ID 検索（3-layer Step1） |
| `harness_mem_timeline` | コンテキスト展開（3-layer Step2） |
| `harness_mem_get_observations` | ID指定で詳細取得（3-layer Step3） |
| `harness_mem_sessions_list` | セッション一覧 |
| `harness_mem_session_thread` | セッション内発話スレッド |
| `harness_mem_search_facets` | ファセット集計 |
| `harness_mem_resume_pack` | resume パック取得 |
| `harness_mem_health` | daemon ヘルスチェック |
| `harness_mem_stats` | メモリ統計 |
| `harness_mem_export` | データエクスポート |
| `harness_mem_graph` | エンティティグラフ |

### 書き込み系（用途を選んで公開）

| ツール | 用途 |
|---|---|
| `harness_mem_record_checkpoint` | チェックポイント記録 |
| `harness_mem_record_event` | イベント記録 |
| `harness_mem_finalize_session` | セッション終了処理 |
| `harness_mem_add_relation` | エンティティ間リレーション追加 |
| `harness_mem_bulk_add` | 一括登録 |
| `harness_mem_compress` | メモリ圧縮 |
| `harness_mem_ingest` | 外部ソース取り込み |
| `harness_mem_share_to_team` | チーム共有 |

### 削除・admin系（**慎重に公開**）

| ツール | 用途 |
|---|---|
| `harness_mem_delete_observation` | 単一削除 |
| `harness_mem_bulk_delete` | 一括削除 |
| `harness_mem_admin_import_claude_mem` | Claude memory import |
| `harness_mem_admin_import_status` | import 進捗 |
| `harness_mem_admin_verify_import` | import 検証 |
| `harness_mem_admin_reindex_vectors` | vector index 再構築 |
| `harness_mem_admin_metrics` | 内部メトリクス |
| `harness_mem_admin_consolidation_run` | consolidation 実行 |
| `harness_mem_admin_consolidation_status` | consolidation 状態 |
| `harness_mem_admin_audit_log` | 監査ログ |

admin 系を Hermes に公開するのは、運用ツールとして使う場合のみ推奨。LLM が誤って `harness_mem_bulk_delete` を呼ぶリスクを考慮し、デフォルトでは allowlist から外す。

## 起動方式

### 方式 A: 別プロセス常駐（推奨 — 複数ツールでメモリ共有しやすい）

ターミナル別タブで harness-mem daemon を起動済みにし、Hermes は stdio MCP に接続する:

```bash
# 別タブで先に起動
~/.harness-mem/runtime/harness-mem daemon start

# Hermes config はそのまま (command: ~/.harness-mem/runtime/harness-mem args: [mcp])
```

Claude Code / Codex / Hermes が同じ daemon に接続するため、メモリが完全共有される。

### 方式 B: Hermes から on-demand spawn

Hermes 起動時に harness-mem MCP プロセスを自動起動。シングル運用:

```yaml
mcp_servers:
  harness_mem:
    command: "bunx"
    args: ["-y", "@chachamaru127/harness-mem", "mcp"]
    env:
      HARNESS_MEM_PROJECT_KEY: "your-project-key"
```

Hermes セッション終了で MCP プロセスも終了。他ツールとメモリ共有はしづらい。

### 方式 C: Streamable HTTP MCP gateway（opt-in）

stdio frontend process 数を減らしたい場合の中期ルート。gateway は1つだけ起動し、Hermes は
`url:` で接続する。既存 stdio config は fallback として残せる。

```bash
export HARNESS_MEM_MCP_TOKEN="<local-secret>"
harness-mem mcp-gateway start
harness-mem mcp-config --transport http --client hermes --write
harness-mem doctor --mcp-transport http
```

HTTP gateway はまだ recommended/default ではない。複数セッションの process 数を抑えたい時だけ opt-in で使う。

## 過去セッションの Backfill

Hermes の過去会話は `~/.hermes/state.db` に入っている。harness-mem 側へあとから移す場合は、Backfill を使う。

まず書き込みなしで件数を確認:

```bash
harness-mem ingest-hermes-state \
  --source ~/.hermes/state.db \
  --project-key your-project-key \
  --dry-run \
  --json
```

問題なければ実行:

```bash
harness-mem ingest-hermes-state \
  --source ~/.hermes/state.db \
  --project-key your-project-key \
  --execute \
  --batch-size 100 \
  --json
```

Backfill は `session_start` / `user_prompt` / `checkpoint` / `tool_use` / `session_end` として記録する。再実行は dedupe される。tool result 本文は既定では保存せず、metadata のみ残す。本文も必要な場合だけ `--include-tool-content` を付ける。

## セッション継続性 (`session_id` / `project_key`)

harness-mem は `project_key` でメモリ空間を分離する。Hermes と他ツール（Claude Code / Codex 等）で同じ `HARNESS_MEM_PROJECT_KEY` を指定すれば、検索・resume の結果も共有される。

`session_id` は MCP リクエストごとに harness-mem 側で自動採番される。Hermes 側で明示指定する必要はない。

## 動作確認

設定後、以下を順に確認:

```bash
# 1. harness-mem daemon が動作中か
~/.harness-mem/runtime/harness-mem doctor

# 2. MCP 経由で tools/list が返るか（手動 stdio test）
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | ~/.harness-mem/runtime/harness-mem mcp
```

`tools/list` の応答に `harness_mem_search` を含む設定済みの `harness_mem_*` ツールが入っていれば OK。

Hermes 起動後は、ツール一覧表示コマンド（Hermes CLI 依存）で `harness_mem_*` が見えることを確認。検索クエリを投げて、結果が返れば統合成功。

## オプション: セッション自動保存 plugin（Layer 1 補助）

`integrations/hermes/plugin/` の `harness-mem-hermes-bridge` は **lifecycle hook bridge**（Layer 2 MemoryProvider とは別物）。`on_session_start` / `on_session_end` で session 境界 event を記録する。

`harness-mem-hermes-bridge` Python plugin を使うと、Claude Code / Codex の `SessionStart` / `Stop` hook と同じ感覚で、Hermesセッションを harness-mem に自動保存できる。

- `on_session_start` で `session_start` event を記録
- `on_session_end` で `session_end` event を記録 + 正常終了時は `finalize_session` を呼ぶ

```bash
pip install -e integrations/hermes/plugin
```

`~/.hermes/config.yaml`:
```yaml
plugins:
  enabled:
    - harness-mem-bridge
```

詳細は [`plugin/README.md`](plugin/README.md) を参照。tier 3 (experimental) — per-message hookは Hermes 側に無いため、過去履歴は `~/.hermes/state.db` Backfill で補完する。

## Layer 2 の rollback（概要）

MemoryProvider を外す場合:

1. **推奨:** 有効化直前に取った config バックアップを restore する（`~/.hermes/config.yaml.bak.harness_mem_provider.<YYYYMMDDHHMMSS>` — `<YYYYMMDDHHMMSS>` は各自のバックアップのタイムスタンプに置き換える）
2. **代替:** 有効化前の provider 名を記録済みの場合のみ、`hermes config set memory.provider <previous_provider>` を実行する（`<previous_provider>` は有効化前の実際の値に置き換える。推測しない）
3. Hermes 再起動後、`~/.hermes/config.yaml` の `memory.provider` がバックアップまたは記録した有効化前の値と一致することを確認する
4. **（任意）** deactivate 完了後に `rm -rf ~/.hermes/plugins/harness_mem`

詳細・`RuntimeError: Event loop is closed` の扱いは [`docs/integrations/hermes.md`](../../docs/integrations/hermes.md) を参照。

## 詳細・トラブルシューティング

[`docs/integrations/hermes.md`](../../docs/integrations/hermes.md) — Layer 1 MCP 運用、Layer 2 MemoryProvider セットアップ / smoke / rollback、トラブルシューティング。

## 関連ドキュメント

- [`docs/claude-harness-companion-contract.md`](../../docs/claude-harness-companion-contract.md) — runtime バイナリ仕様
- [`docs/environment-variables.md`](../../docs/environment-variables.md) — env 変数一覧
- [`mcp-server/README.md`](../../mcp-server/README.md) — MCP サーバー詳細
