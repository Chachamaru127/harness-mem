# Hermes Agent 統合ガイド

[Nous Research の Hermes Agent](https://github.com/nousresearch/hermes-agent) を harness-mem に接続するための詳細セットアップガイド。

Quickstart は [`integrations/hermes/README.md`](../../integrations/hermes/README.md) を参照。本ドキュメントは仕様・運用・トラブルシューティングを掘り下げる。

## Positioning — この統合の役割

本統合は **Hermes の記憶層を置き換えるものではない**。Hermes は built-in でファイルベースの記憶 (`~/.hermes/MEMORY.md`, `USER.md`, `skills/`) と FTS5 SQLite session search を持っており、これらは **Layer 2 を有効化しても継続** する。

harness-mem との接続は **2 レイヤー** で、いずれも **追加経路**:

| レイヤー | 接続 | 動作 |
|---|---|---|
| **Layer 1 — MCP** | `mcp_servers.harness_mem`（stdio / HTTP） | モデルが `harness_mem_search` / `harness_mem_record_checkpoint` 等を **明示 tool call** |
| **Layer 2 — MemoryProvider** | `memory.provider=harness_mem` + `~/.hermes/plugins/harness_mem` | `sync_turn()` / `prefetch()` / `on_session_end()` + provider ツール 3 種 |

Layer 2 は Hermes 公式の [MemoryProvider plugin API](https://hermes-agent.nousresearch.com/docs/developer-guide/memory-provider-plugin) を使う。実装は `integrations/hermes/provider/`。Layer 1 MCP 設定は Layer 2 と **独立** — 併用可能。

代わりに本統合が提供するのは:

1. **読み取り (Layer 1 / 2)**: Claude Code / Codex / Cursor が harness-mem に蓄積した記憶を、Hermes が `harness_mem_search` または Layer 2 `prefetch()` で参照できる
2. **書き込み (Layer 1 / 2)**: 明示 `harness_mem_record_checkpoint` / provider `harness_mem_record`、または Layer 2 `sync_turn()` による turn 記録
3. **共有**: 同一 `HARNESS_MEM_PROJECT_KEY` を持つ複数ツール間で観測データを共有できる（同一 daemon / DB）

Hermes 自身が `MEMORY.md` を更新しても、それは harness-mem には自動同期されない（Layer 2 の `on_memory_write` mirror は opt-in 的で、built-in 全文同期ではない）。

### memory layer 役割分担

| Hermes built-in | harness-mem Layer 1 (MCP) | harness-mem Layer 2 (MemoryProvider) |
|---|---|---|
| Hermes 自身のキャラクター・学習 (USER.md / skills) | 横断ツールの作業記憶 (observations / events) | 同上 + turn 自動同期・prefetch |
| プロンプト先頭注入で常時利用 | tool call で明示的に query | `prefetch()` で turn 前注入 + provider ツール |
| LLM が直接編集 | `record_*` で構造化記録 | `sync_turn()` + `harness_mem_record` |

### tier 指定

Plans.md §69-92 では Hermes 統合は **tier 3 (experimental)**。tier 1 (Claude Code + Codex) と異なり、自動 hook 連携や first-turn continuity の保証はない。手動運用前提。

## アーキテクチャ概要

### Layer 1 — MCP

```
┌─────────────┐  stdio MCP   ┌──────────────────────┐  HTTP   ┌──────────────┐
│ Hermes      │ ───────────▶ │ stdio MCP frontend   │ ──────▶ │ harness-memd │
│ Agent       │              │ (Go or Node.js)      │  :37888 │ (memory      │
└─────────────┘              └──────────────────────┘         │  daemon)     │
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                              ~/.harness-mem/harness-mem.db
```

### Layer 2 — MemoryProvider

```
┌─────────────┐  HTTP (urllib)  ┌──────────────┐
│ Hermes      │ ──────────────▶ │ harness-memd │ ──▶ ~/.harness-mem/harness-mem.db
│ MemoryProvider               │  :37888      │
│ (harness_mem)│                └──────────────┘
│  sync_turn() │ POST /v1/events/record
│  prefetch()  │ POST /v1/search (safe_mode)
│  tools       │ harness_mem_search / record / status
└─────────────┘
  plugin path: ~/.hermes/plugins/harness_mem
  config: memory.provider=harness_mem
```

Layer 1 / Layer 2 は **同じ daemon と DB** を共有する。Layer 2 provider は LLM extraction を **行わない**（thin bridge — consolidation は memory-server 側）。

### 事実抽出 LLM ポリシー（consolidation / H156-001）

Hermes MemoryProvider は **thin bridge** であり、LLM による事実抽出は **行いません**。consolidation daemon（`memory-server/src/consolidation/`）が事実抽出ポリシーを所有します。

| 項目 | 現行契約 |
|---|---|
| 既定モード | `heuristic`（ルールベース）。LLM 抽出は `HARNESS_MEM_FACT_EXTRACTOR_MODE=llm` の明示が必要 |
| LLM モード provider 既定 | 未設定時 `ollama`（loopback のみ） |
| 外部クラウド (`openai` / `anthropic` / `gemini`) | `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1`（trim 後が正確に `1`）と各 credential の**両方**が必要 |
| 非 loopback Ollama | `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1` があっても拒否 |
| 適用経路 | 通常抽出と差分抽出の両方。ブロック時は空結果のうえ heuristic にフォールバック |
| 監査 | provider / model / byte 数等のメタデータのみ。prompt・response 本文・secret は記録しない |

環境変数の詳細は [`docs/environment-variables.md`](../environment-variables.md) の LLM セクションを参照。

**本 docs 同期 (H156-006) の検証範囲:** 上記は H156-001 実装後の **現行契約** を文書化したものです。live cloud E2E は実施していません。H156-007 の optional loopback Ollama live smoke も **未実行** です（本タスクでは実行手順を追加しません）。

- **Hermes 側**: 標準 MCP クライアント。`~/.hermes/config.yaml` の `mcp_servers` で stdio サーバーを宣言。
- **harness-mem stdio MCP frontend**: 設定済みの `harness_mem_*` ツールを公開。Hermes からは stdio server として見えるが、実体はクライアント session ごとに起動する frontend process。Go binary を優先し、必要なら Node.js MCP server に fallback する。
- **harness-memd**: SQLite DB (`~/.harness-mem/harness-mem.db`) を所有する TypeScript/Bun の HTTP memory daemon。既定では `127.0.0.1:37888` で待受けする。

複数のクライアント（Claude Code, Codex, Cursor, Hermes）が同じ daemon に接続することで、`project_key` 単位でのメモリ共有が成立する。

重要: stdio MCP frontend process が複数見えること自体は、複数の Codex / Claude Code /
Hermes セッションを開いているなら正常です。Go binary 経路では
`harness-mcp-darwin-arm64` / `harness-mcp-*` として見えることが多いです。stdio MCP は
クライアントが local server subprocess を起動する方式なので、frontend は session 数に
応じて増えます。共有されるべき singleton は `:37888` の memory daemon と SQLite owner です。

cleanup の対象は、親クライアントが終了した後も残った stale / orphan MCP 子プロセス、
または同じ `:37888` / SQLite state を複数 daemon が取り合う split-brain です。
プロセス数だけで異常判定しないでください。

stdio frontend を singleton broker 化する方針は推奨しません。Hermes を含む stdio MCP
クライアントは「自分が起動した subprocess と stdio で話す」前提で lifecycle を管理します。
そこを共有 broker にすると、親子関係、停止、認証、project_key 分離の責任が曖昧になります。
frontend プロセス数を減らす方針として、Claude Code / Codex の新規 setup は local-only の
Streamable HTTP MCP gateway (`http://127.0.0.1:37889/mcp`) を default にします。ただし Hermes
はこの default 対象ではなく、既存 stdio を互換 fallback として残します。

Hermes で HTTP MCP を使う場合は、先に token 付き gateway を起動し、Hermes 用 YAML を明示生成します。
秘密 token の値は config へ書かず、`Bearer ${HARNESS_MEM_MCP_TOKEN}` という環境変数参照だけを
残します。

```bash
harness-mem mcp-gateway start
harness-mem mcp-config --transport http --client hermes --write
```

## runtime バイナリパス

`~/.harness-mem/runtime/harness-mem` は [companion contract v1](../claude-harness-companion-contract.md) で固定パス。Hermes config から直接指定する。

実際のパスを確認:

```bash
which harness-mem || ls -la ~/.harness-mem/runtime/harness-mem
```

開発時など runtime 配置をしていない環境では `bunx` 経由で起動する on-demand spawn 方式（`integrations/hermes/examples/hermes-config-full.yaml` 参照）を選ぶ。

## Layer 2 MemoryProvider 運用

Quickstart は [`integrations/hermes/README.md`](../../integrations/hermes/README.md) の「Layer 2 (MemoryProvider)」を参照。本節は setup・discovery・live smoke・rollback・トラブルシューティングを詳述する。

S112-008 実機 E2E で Layer 2 は **turn 記録・search・prefetch・別 session recall** まで成功済み。以下はその再現手順。live session ID / observation ID / 過去 marker 値は docs に固定しない。

### 前提

- harness-mem daemon ready: `~/.harness-mem/runtime/harness-mem doctor`
- Hermes Agent install 済み（MemoryProvider API 対応版）
- operator 承認のうえ config を変更する（自動化 script は本タスク scope 外）

### config バックアップ（有効化前必須）

`hermes config set` はローカル `~/.hermes/config.yaml` を **mutate** する。必ず事前バックアップ:

```bash
cp ~/.hermes/config.yaml \
  ~/.hermes/config.yaml.bak.harness_mem_provider.$(date +%Y%m%d%H%M%S)
```

パターン: `~/.hermes/config.yaml.bak.harness_mem_provider.<YYYYMMDDHHMMSS>`

**警告:** 過去 E2E で生成された特定タイムスタンプ付きファイル名を universal path としてコピーしない。各自の環境で新しいバックアップを取る。

### provider 配置と有効化

リポジトリ root から:

```bash
mkdir -p "$HOME/.hermes/plugins/harness_mem"
rsync -a --delete integrations/hermes/provider/harness_mem/ "$HOME/.hermes/plugins/harness_mem/"
hermes config set memory.provider harness_mem
```

docs に API key / token 等の **秘密情報は含めない**。必要な env（`HARNESS_MEM_PROJECT_KEY` 等）は Hermes 実行環境で Layer 1 と同様に設定する。

Layer 2 provider が参照する主な env:

| 変数 | 既定値 | 説明 |
|---|---|---|
| `HARNESS_MEM_URL` | `http://127.0.0.1:37888` | daemon ベース URL |
| `HARNESS_MEM_TOKEN` | (空) | 任意。設定時は `X-harness-mem-token` ヘッダ |
| `HARNESS_MEM_PROJECT_KEY` | `default` | メモリ空間キー。他ツールと揃える |
| `HARNESS_MEM_HERMES_CONSOLIDATE_ON_END` | `0` | `1` のときのみ `on_session_end` で consolidation |

完全な env 一覧は [`docs/environment-variables.md`](../environment-variables.md)（Layer 2 専用 flag の canonical 更新は別タスク）。

### discovery / load 検証

S112-008 実機 E2E で確認済みの期待値:

| 確認項目 | 期待結果 |
|---|---|
| plugin 配置 | `~/.hermes/plugins/harness_mem` に `__init__.py` / `plugin.yaml` |
| config | `memory.provider=harness_mem` |
| `discover_memory_providers()` | `harness_mem` が **available** |
| `load_memory_provider("harness_mem")` | `HarnessMemMemoryProvider` インスタンス |
| provider ツール | `harness_mem_search`, `harness_mem_record`, `harness_mem_status` |

repo checkpoint には `discover_memory_providers()` を呼ぶ固定 CLI コマンドは記録されていない。Hermes の MemoryProvider discovery 手順（Python REPL / Hermes 内部 API）で上表を確認する。

provider 契約の offline 回帰:

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  integrations/hermes/provider/tests/test_provider.py -v --tb=short
```

### live smoke / search / prefetch チェックリスト

以前の live E2E で以下の流れが成功している。各 run では **新しい非 secret marker** を使う（過去の marker / session / observation ID を再利用しない）。

1. **daemon ready** — `~/.harness-mem/runtime/harness-mem doctor` が healthy
2. **Hermes session 開始** — MemoryProvider が load された状態
3. **marker 記録** — 一意の非 secret 文字列を turn 同期または `harness_mem_record` で記録
4. **search** — 同 session で `harness_mem_search` が marker を hit
5. **prefetch** — 次 turn の prefetch ブロックに `## harness-mem Context` が含まれ、関連 item が載る
6. **別 session recall** — 新 session を開き、prefetch または search 経由で marker を recall

checkpoint で使われた live smoke パターン（marker は run ごとに生成）:

```bash
MARKER="hm_provider_live_smoke_$(date +%Y%m%d_%H%M%S)_your_unique_token"
hermes chat -q "Hermes provider live smoke. Please reply exactly: ACK $MARKER" \
  -Q --max-turns 3 --source cli
```

続けて daemon 側 search で marker が見えることを確認する（例: `harness-mem search` CLI または provider `harness_mem_search`）。prefetch は次 turn 開始時に `## harness-mem Context` 見出し付きブロックとして注入される。

### rollback

MemoryProvider を無効化する手順:

**A. 有効化前バックアップから restore（推奨）**

有効化直前に取った config バックアップを restore する:

```bash
cp ~/.hermes/config.yaml.bak.harness_mem_provider.<YYYYMMDDHHMMSS> ~/.hermes/config.yaml
```

`<YYYYMMDDHHMMSS>` は **各自が有効化前に取った** バックアップのタイムスタンプに置き換える。特定の過去タイムスタンプを universal path としてコピーしない。

**B. 以前の provider 名を明示設定（代替）**

有効化前の `memory.provider` 値を operator が記録済み、または正確に把握している場合のみ:

```bash
hermes config set memory.provider <previous_provider>
```

`<previous_provider>` は有効化前の実際の値に置き換える。repo や docs から推測しない。

**C. rollback 後の確認**

Hermes 再起動後、以下を確認する:

- `~/.hermes/config.yaml` の `memory.provider` がバックアップまたは記録した有効化前の値と一致している
- `discover_memory_providers()` / active provider が期待どおり

**D. （任意）plugin ディレクトリ削除**

deactivate 完了後、不要なら:

```bash
rm -rf ~/.hermes/plugins/harness_mem
```

harness-mem DB 内の observation は削除されない。Layer 1 MCP 設定は rollback の影響を受けない。

## 環境変数

Hermes config の `env:` ブロックで指定する変数:

| 変数 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `HARNESS_MEM_PROJECT_KEY` | 推奨 | `default` | メモリ空間の分離キー。Claude Code / Codex と揃えて共有 |
| `HARNESS_MEM_HOST` | 任意 | `127.0.0.1` | daemon ホスト |
| `HARNESS_MEM_PORT` | 任意 | `37888` | daemon ポート |
| `HARNESS_MEM_REMOTE_URL` | 任意 | (空) | リモート daemon を使う場合のフル URL |
| `HARNESS_MEM_MCP_SEARCH_SAFE_MODE` | 推奨 | `0` | `1` にすると MCP search が link / graph / vector を切った軽量候補検索になる。大規模 DB + `js-fallback` vector 環境では Hermes の tool timeout 回避に有効 |
| `HARNESS_MEM_HEALTH_TIMEOUT_MS` | 任意 | `2500` | MCP proxy の health check 待ち時間。軽量な `/health/ready` を先に確認し、full health へ fallback する |
| `HARNESS_MEM_STARTUP_HEALTH_TIMEOUT_MS` | 任意 | `5000` | MCP proxy が daemon 起動前後に既存 daemon を再確認する待ち時間 |

完全なリストは [`docs/environment-variables.md`](../environment-variables.md) を参照。

## セッション継続性

### `project_key` の同期

Hermes と Claude Code で同じメモリ空間を見るには、両者で `HARNESS_MEM_PROJECT_KEY` を **同じ値** に揃える。

```yaml
# Hermes config
env:
  HARNESS_MEM_PROJECT_KEY: "my-project-2026"
```

```toml
# Codex config (~/.codex/config.toml の MCP server セクション)
[mcp_servers.harness_mem.env]
HARNESS_MEM_PROJECT_KEY = "my-project-2026"
```

ずれていると、検索結果も resume_pack も独立した空間になる（コンテンツが見えない）。

### `session_id` の扱い

`session_id` は harness-mem daemon が MCP リクエスト単位で自動採番。Hermes 側で明示する必要はない。`harness_mem_record_event` などの書き込み呼び出し時に、daemon が現在の `session_id` を内部で解決する。

複数の Hermes セッションが同時並行で書き込む場合も `project_key` が同じなら統合済みのタイムラインに記録される（`harness_mem_sessions_list` で個別セッションを参照可能）。

## 履歴 Backfill

Hermes は過去セッションを `~/.hermes/state.db` に保存する。Backfill は、この SQLite database を読み取り、Hermes の過去会話を harness-mem の event として一括登録する機能。

たとえると、Hermes の日記帳をあとから harness-mem の共有台帳へ写す作業です。写したあとも Hermes の元データは消さない。再実行しても同じ event は dedupe される。

### まず dry-run

```bash
harness-mem ingest-hermes-state \
  --source ~/.hermes/state.db \
  --project-key default \
  --dry-run \
  --json
```

dry-run は書き込みをしない。`sessions_seen` / `messages_seen` / `events_planned` を確認し、取り込み規模を把握する。

### 実行

```bash
harness-mem ingest-hermes-state \
  --source ~/.hermes/state.db \
  --project-key default \
  --execute \
  --batch-size 100 \
  --json
```

`--execute` を付けない限り、既定は dry-run。大きい `state.db` では batch 実行が安全。途中で止まった場合は、出力の `last_message_id` を使って続きから再開できる。

```bash
harness-mem ingest-hermes-state \
  --source ~/.hermes/state.db \
  --project-key default \
  --execute \
  --after-message-id 1200 \
  --limit 100 \
  --json
```

### 取り込む event

| Hermes source | harness-mem event_type |
|---|---|
| `sessions.started_at` | `session_start` |
| `messages.role = user` | `user_prompt` |
| `messages.role = assistant` | `checkpoint` |
| `messages.role = tool` | `tool_use` |
| `sessions.ended_at` | `session_end` |

### 安全設計

- tool result の本文は既定では保存しない。`result_present` / `result_chars` のような metadata だけを残す。
- tool result 本文まで必要な場合だけ `--include-tool-content` を明示する。
- 長文を抑えたい場合は `--max-content-chars 4000` のように上限を付ける。
- 期間を絞る場合は `--since 2026-05-01T00:00:00+09:00` を使う。
- dedupe key は source database / project / Hermes message id から決まるため、同じ project への再実行は安全。

### 動作確認

Backfill 後は、軽量検索で入ったか確認する。

```bash
harness-mem search '{"query":"Hermes 作業確認","safe_mode":true,"vector_search":false,"expand_links":false,"graph_depth":0,"limit":5}'
```

## ツール allowlist 設計指針

### ベースライン: 5 ツール（minimal）

Hermes が初めて接続するときの最小セット。読み取り 4 + 書き込み 1。

```yaml
tools:
  include:
    - harness_mem_search
    - harness_mem_timeline
    - harness_mem_get_observations
    - harness_mem_resume_pack
    - harness_mem_record_checkpoint
```

### 拡張パターン

| ユースケース | 追加ツール |
|---|---|
| ファセット分析・統計を見たい | `harness_mem_search_facets`, `harness_mem_stats` |
| 関連エンティティを辿りたい | `harness_mem_graph`, `harness_mem_add_relation` |
| 外部ソースを取り込みたい | `harness_mem_ingest`, `harness_mem_bulk_add` |
| チーム共有 | `harness_mem_share_to_team` |
| 運用 / debug | `harness_mem_admin_metrics`, `harness_mem_admin_audit_log`, `harness_mem_health` |

### 公開を避けるべきツール（LLM 操作下）

- `harness_mem_bulk_delete` — 大量削除リスク
- `harness_mem_admin_consolidation_run` — 重い処理を誤起動するリスク
- `harness_mem_admin_reindex_vectors` — index 再構築は運用判断が必要

これらは Hermes プラグインから手動で呼ぶより、CLI (`harness-mem ...`) から実行する方が安全。

## トラブルシューティング

### 0. Layer 2 — `RuntimeError: Event loop is closed`

症状: Hermes 終了時または MCP cleanup 時に stderr に:

```text
RuntimeError: Event loop is closed
```

S112-008 live E2E では、**record / search / prefetch が成功し memory write も確認できた場合**、この警告は Hermes MCP cleanup の **非ブロッキングノイズ** として観測された。

**対処の切り分け:**

| 状況 | 扱い |
|---|---|
| `harness_mem_search` / prefetch が成功し、daemon に observation がある | 多くは無視してよい cleanup ノイズ |
| search 空、prefetch 空、daemon に write が無い | **相関 failure** として調査（daemon 到達性、`memory.provider`、plugin 配置、env） |

write 欠落と同時に出る場合は「無害な警告」と決め打ちしない。

### 1. Hermes 起動時に MCP サーバーが見つからない

症状: `mcp_server connection failed` エラー、ツール一覧に `harness_mem_*` が出ない。

原因と対処:

| 原因 | 確認方法 | 対処 |
|---|---|---|
| runtime バイナリが存在しない | `ls ~/.harness-mem/runtime/harness-mem` | `harness-mem setup --platform claude,codex` を実行 |
| パスが間違っている | yaml の `command:` を絶対パスで指定 | `<you>` を実 username に置換 |
| 実行権限なし | `chmod +x ~/.harness-mem/runtime/harness-mem` | `harness-mem doctor --fix` |
| bunx が見つからない (方式 B) | `which bunx` | bun を install: `curl -fsSL https://bun.sh/install \| bash` |

### 2. ツール呼び出しでエラー（`daemon not reachable` 等）

症状: `harness_mem_search` 呼び出し時に `health check failed` が返る。

原因: harness-memd daemon が起動していない、または Hermes 側からアクセスできない host:port を指定している。

対処:

```bash
# daemon の状態確認
~/.harness-mem/runtime/harness-mem doctor

# daemon が落ちていれば再起動
~/.harness-mem/runtime/harness-mem daemon start
```

`HARNESS_MEM_REMOTE_URL` を使ってリモート daemon に繋いでいる場合は、URL の到達性とトークン認証を確認。

### 2-b. `daemon_unavailable: failed to start daemon` だが daemon は動いている

症状: `curl http://127.0.0.1:37888/health/ready` は返るのに、Hermes MCP の `harness_mem_search` が `daemon_unavailable` を返す。

原因: MCP proxy の短い health check が一時的に失敗し、既存 daemon を再利用する前に二重起動を試みている可能性がある。大きい DB で検索中の Bun daemon は health 応答も詰まることがある。

対処:

```yaml
env:
  HARNESS_MEM_MCP_SEARCH_SAFE_MODE: "1"
  HARNESS_MEM_HEALTH_TIMEOUT_MS: "5000"
  HARNESS_MEM_STARTUP_HEALTH_TIMEOUT_MS: "8000"
  # v0.21.3 以前や大規模な履歴ディレクトリでは、履歴取り込みを粗くして API starvation を避ける
  HARNESS_MEM_CODEX_INGEST_INTERVAL_MS: "60000"
  HARNESS_MEM_CLAUDE_CODE_INGEST_INTERVAL_MS: "60000"
  HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS: "60000"
  HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS: "60000"
  HARNESS_MEM_GEMINI_INGEST_INTERVAL_MS: "60000"
```

それでも遅い場合は、Step 1 は `harness_mem_search(safe_mode=true, limit=1)` で候補 ID だけ取り、必要な ID を `harness_mem_get_observations` で読む。

`safe_mode=true` は次をまとめて行う:

- `expand_links=false`
- `graph_depth=0`
- `graph_weight=0`
- `vector_search=false`

### 2-c. `harness-mcp-darwin-arm64` が複数見える

症状: `ps` や Activity Monitor で `harness-mcp-darwin-arm64` / `harness-mcp-*` が複数残っているように見える。

まず見るべきポイント:

- 親プロセスが生きている Codex / Claude Code / Hermes なら、通常の stdio MCP frontend です。
- 親プロセスが消えている、または長時間孤立している子だけが cleanup 対象です。
- `127.0.0.1:37888` の memory daemon が複数いる場合は、別問題として daemon split-brain を疑います。

stdio MCP は session ごとに subprocess を持つため、frontend process 数だけを減らす目的で
singleton 化しないでください。Claude Code / Codex の新規 setup は Streamable HTTP MCP gateway
(`127.0.0.1:37889/mcp`) を default にしますが、Hermes は明示 opt-in のままです。stdio は互換
fallback として残します。

### 3. メモリが Claude Code と分離している

症状: Claude Code で記録したメモリが Hermes から見えない（`harness_mem_search` が空を返す）。

原因: `HARNESS_MEM_PROJECT_KEY` が両者で異なる。

対処:

```bash
# Claude Code 側の project_key を確認（Claude が記録した event を見る）
~/.harness-mem/runtime/harness-mem search --recent

# Hermes config の env:HARNESS_MEM_PROJECT_KEY を一致させる
```

### 4. Hermes context が膨張する

症状: ツール一覧の token cost が高い、Hermes が遅い。

原因: 多数の `harness_mem_*` ツールを公開すると、各ツールの input schema が context を圧迫。

対処: minimal allowlist (5 ツール) に戻し、必要なツールだけ段階的に追加。

### 5. `~/.harness-mem/runtime/harness-mem mcp` が即座に終了する

症状: Hermes 起動時に `mcp_server exited unexpectedly` が即座に出る。

原因: stdio mode は標準入力からのリクエストを待つため、手動でテストする際は echo パイプが必要。Hermes が起動していれば問題ないはず。手動 sanity check:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  | ~/.harness-mem/runtime/harness-mem mcp
```

応答が返れば runtime 側は正常。Hermes 側の log を確認。

## オプション: セッション自動保存 plugin

`integrations/hermes/plugin/` に **harness-mem-hermes-bridge** Python plugin を同梱している。Hermes の `on_session_start` / `on_session_end` hook に登録し、Claude Code の `SessionStart` / `Stop` hook と機能的に等価な自動保存を実現する。

### 動作

| Hermes hook | harness-mem への動作 |
|---|---|
| `on_session_start(session_id, model, platform, **kwargs)` | `record_event(event_type="session_start", platform="hermes")` |
| `on_session_end(session_id, completed, interrupted, model, platform, **kwargs)` | `record_event(event_type="session_end", ...)` を必ず呼び、`completed=True and interrupted=False` のときのみ `finalize_session()` も呼ぶ |

### Install

```bash
pip install -e integrations/hermes/plugin
```

または公開版がpypiに乗っていれば `pip install harness-mem-hermes-bridge`。

### Enable

`~/.hermes/config.yaml`:
```yaml
plugins:
  enabled:
    - harness-mem-bridge
```

plugin discovery は `pyproject.toml` の `[project.entry-points."hermes_agent.plugins"]` 経由。

### 環境変数

| 変数 | 既定値 | 役割 |
|---|---|---|
| `HARNESS_MEM_URL` | `http://127.0.0.1:37888` | daemon ベースURL |
| `HARNESS_MEM_TOKEN` | (空) | `x-harness-mem-token` ヘッダで送る token |
| `HARNESS_MEM_PROJECT_KEY` | `default` | `finalize_session` で渡す project namespace |

Claude Code / Codex で使っている `HARNESS_MEM_PROJECT_KEY` と揃えて初めて記憶が共有される。

### Plugin 設計判断

- **lazy singleton**: `HarnessMemClient` はプロセス内で1回だけ初期化（複数 session で reuse）
- **forward-compat**: hook callback は `**kwargs` を受け取り、Hermes が将来追加する引数で plugin が落ちないようにする
- **interrupted の扱い**: 中断 (`/stop` や新メッセージで打ち切り) されたセッションは finalize しない。これは「最終応答が生成されたターン」と区別するため
- **エラー伝播**: 現実装では `HarnessMemClient` 呼び出し失敗時に例外を raise する。Hermes 側が try/except でwrapするため agent loop は止まらないが、log は出る。将来 silent-fail/log-only モードへの切り替えは S112 follow-up で検討

### Plugin tests

```bash
cd integrations/hermes/plugin
pip install -e .[test]
pytest
```

`HarnessMemClient` をモックして 15 件のテストが pass する設計（実 daemon 不要）。E2E (実 Hermes での動作確認) は Plans.md §112 S112-005 で別途実施。

## 既知の制約

- **Hermes built-in memory との並行運用**: Hermes は組み込みメモリ層 (procedural memory) を持つ。Layer 1 MCP と Layer 2 MemoryProvider は **追加経路** であり、built-in の `MEMORY.md` / `USER.md` / `skills/` を置き換えない。Layer 2 実装は `integrations/hermes/provider/`。
- **Layer 1 と Layer 2 の独立性**: `memory.provider=harness_mem` は Layer 1 の `mcp_servers.harness_mem` を自動無効化しない。必要に応じて併用する。
- **lifecycle hook bridge との区別**: `integrations/hermes/plugin/`（`harness-mem-hermes-bridge`）は session 境界 hook bridge。Layer 2 MemoryProvider（`integrations/hermes/provider/`）とは別レイヤー。
- **Backfill は過去データの取り込み**: `harness-mem ingest-hermes-state` は `~/.hermes/state.db` に既にある履歴を取り込む one-shot 処理。Hermes の per-message hook を追加するものではない。
- **Hermes の HTTP MCP transport は opt-in**: local Streamable HTTP MCP gateway (`harness-mem mcp-gateway start`, `127.0.0.1:37889/mcp`) と Hermes 用 `url:` config 生成 (`harness-mem mcp-config --transport http --client hermes --write`) は使える。ただし Hermes は Claude/Codex の HTTP default 対象ではなく、既定案内は stdio fallback を維持する。
- **on-demand spawn と複数クライアント**: 方式 B（`bunx` で Hermes 起動時に spawn）を選ぶと、Hermes セッション間でも独立 daemon になる場合がある。複数ツールでメモリ共有する用途では方式 A（別プロセス常駐）を推奨。

## 外部チャネル送出ポリシー (S154-900)

Hermes の応答が外部チャネル (Telegram / Slack / Discord / WhatsApp 等) に中継される構成では、memory content の読み出しは **external-channel egress policy** を通すこと:

- 読み出しは `HarnessMemCore.searchForExternalChannel()` (`memory-server/src/core/external-channel-policy.ts`) 経由が必須。`include_private` を強制 OFF した上で、
  - `privacy_tags` に `private` / `internal` / `secret` を含む観測は**送出から除外**（redact ではなく drop。malformed な privacy_tags も fail-closed で除外）
  - 残る title/content は決定的 redactor (`stripPrivateBlocks` + `redactSecrets`) を**必ず通過**
- `resume_pack` は pack 形状のため item 単位の除外ができず、**外部チャネル送出面として使用禁止**（tool-internal 専用）。
- policy test: `memory-server/tests/unit/external-channel-policy.test.ts`。
- 実証まで宣伝 non-use・実顧客データを外部チャネルに流さない (decisions.md D2 整合)。

## 関連リソース

- [`integrations/hermes/README.md`](../../integrations/hermes/README.md) — Quickstart
- [`integrations/hermes/examples/hermes-config-minimal.yaml`](../../integrations/hermes/examples/hermes-config-minimal.yaml) — 最小設定
- [`integrations/hermes/examples/hermes-config-full.yaml`](../../integrations/hermes/examples/hermes-config-full.yaml) — 全 `harness_mem_*` ツールを公開する例
- [`docs/claude-harness-companion-contract.md`](../claude-harness-companion-contract.md) — runtime 仕様
- [`docs/environment-variables.md`](../environment-variables.md) — env 変数仕様
- [`mcp-server/README.md`](../../mcp-server/README.md) — MCP サーバー全体仕様
- [Hermes Agent MCP ガイド](https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes)
