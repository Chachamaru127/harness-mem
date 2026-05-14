# Hermes Agent ↔ harness-mem 統合

[Nous Research の Hermes Agent](https://github.com/nousresearch/hermes-agent) から harness-mem の MCP ツール群を利用するための設定例とドキュメント。

Hermes は標準 MCP プロトコルに対応しているため、harness-mem の既存 stdio MCP サーバー (`mcp-server/` または `mcp-server-go/`) を **そのまま** 接続できる。新規実装は不要。

## このintegrationの位置付け

**これは何か**:
- Claude Code / Codex / Cursor が harness-mem に記録した作業記憶を、**Hermesから検索・参照するための窓口**
- Hermes 側から明示的に harness-mem に書き込む（`record_checkpoint` / `record_event`）ことも可能
- 複数ツール横断の **継続性レイヤー (cross-tool continuity layer)** として機能

**これは何でないか**:
- Hermes built-in の `~/.hermes/MEMORY.md` / `USER.md` / `skills/` を **置き換える** ものではない。Hermesに memory backend 差し替え API が公式docs上存在しないため、これら built-in 記憶層はそのまま動き続ける。
- Hermesが自動学習した内容を harness-mem に **自動転送する** 機構ではない。Hermes Skill / システムプロンプト側で明示的に `harness_mem_record_checkpoint` を呼ぶ運用が必要。

### memory layer 比較

| 観点 | Hermes built-in | harness-mem (本統合) |
|---|---|---|
| データ形式 | Markdown (`MEMORY.md`, `USER.md`, `skills/`) | 構造化 observation (SQLite) |
| 上限 | MEMORY.md ~2,200字 / USER.md ~1,375字 | 無制限 (DB) |
| recall | システムプロンプト先頭への注入 (prefix cached) | MCP tool 経由の query |
| 更新 | LLM が markdown を直接編集 | `record_checkpoint` / `record_event` の明示呼び出し |
| 共有範囲 | Hermes 単体 | Claude Code / Codex / Cursor / Hermes |
| 主目的 | Hermes 自己学習 (closed learning loop) | クロスツール作業記憶 |

両者は **競合せず補完** の関係。harness-mem は Hermes built-in memory の代替ではなく、別ツール (Claude Code / Codex) で蓄積した記憶を Hermes が参照できるようにする橋渡し役。

### サポート tier

harness-mem の Plans.md (§69-92) では **Hermes 統合は tier 3 (experimental)** 指定。Claude Code + Codex (tier 1) と同等の動作保証は現時点でなし。挙動が不安定な場合があるため、本番運用前に動作確認を推奨。

## 前提

- harness-mem **v0.20.0 以上** が install 済み（[ルート README](../../README.md) のセットアップ参照）
- `~/.harness-mem/runtime/harness-mem` runtime バイナリが存在（`harness-mem doctor` で確認可能）
- Hermes Agent が install 済み（`uv pip install -e ".[mcp]"` を含む）

## クイックスタート

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

## オプション: セッション自動保存 plugin

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

詳細は [`plugin/README.md`](plugin/README.md) を参照。tier 3 (experimental) — per-message hookは Hermes 側に無いため、turn粒度の event は別途 JSONL ingest で補完予定 (Plans.md §111 S111-006)。

## 詳細・トラブルシューティング

[`docs/integrations/hermes.md`](../../docs/integrations/hermes.md) を参照。

## 関連ドキュメント

- [`docs/claude-harness-companion-contract.md`](../../docs/claude-harness-companion-contract.md) — runtime バイナリ仕様
- [`docs/environment-variables.md`](../../docs/environment-variables.md) — env 変数一覧
- [`mcp-server/README.md`](../../mcp-server/README.md) — MCP サーバー詳細
