# Hermes Agent 統合ガイド

[Nous Research の Hermes Agent](https://github.com/nousresearch/hermes-agent) を harness-mem に接続するための詳細セットアップガイド。

Quickstart は [`integrations/hermes/README.md`](../../integrations/hermes/README.md) を参照。本ドキュメントは仕様・運用・トラブルシューティングを掘り下げる。

## Positioning — この統合の役割

本統合は **Hermesの記憶層を置き換えるものではない**。Hermes は built-in でファイルベースの記憶 (`~/.hermes/MEMORY.md`, `USER.md`, `skills/`) と FTS5 SQLite session search を持っており、これらは公式docs上 **外部に差し替えるAPIが存在しない**。

代わりに本統合が提供するのは:

1. **読み取り**: Claude Code / Codex / Cursor が harness-mem に蓄積した記憶を、Hermes が `harness_mem_search` などで参照できる
2. **書き込み**: Hermes 側で明示的に `harness_mem_record_checkpoint` を呼ぶことで、他ツールから見える記録を残せる
3. **共有**: 同一 `HARNESS_MEM_PROJECT_KEY` を持つ複数ツール間で観測データを共有できる

つまり、harness-mem は Hermes にとって「**追加の MCP ツールセット**」であり、built-in memory の代替ではない。Hermes 自身が `MEMORY.md` を更新しても、それは harness-mem には自動同期されない。

### memory layer 役割分担

| Hermes built-in | harness-mem |
|---|---|
| Hermes 自身のキャラクター・学習 (USER.md / skills) | 横断ツールの作業記憶 (observations / events) |
| プロンプト先頭注入で常時利用 | tool call で明示的に query |
| LLM が直接編集 | `record_*` で構造化記録 |

### tier 指定

Plans.md §69-92 では Hermes 統合は **tier 3 (experimental)**。tier 1 (Claude Code + Codex) と異なり、自動 hook 連携や first-turn continuity の保証はない。手動運用前提。

## アーキテクチャ概要

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
frontend プロセス数を減らす中期方針は、既存 stdio を互換 fallback として残し、
local-only の Streamable HTTP MCP gateway (`http://127.0.0.1:37889/mcp`) を opt-in で
使えるようにすることです。

HTTP MCP を試す場合は、先に token 付き gateway を起動し、Hermes 用 YAML を明示生成します。
秘密 token の値は config へ書かず、`Bearer ${HARNESS_MEM_MCP_TOKEN}` という環境変数参照だけを
残します。

```bash
export HARNESS_MEM_MCP_TOKEN="<local-secret>"
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
singleton 化しないでください。将来の opt-in 方向は Streamable HTTP MCP gateway
(`127.0.0.1:37889/mcp`) であり、stdio は互換 fallback として残します。

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
- **エラー伝播**: 現実装では `HarnessMemClient` 呼び出し失敗時に例外を raise する。Hermes 側が try/except でwrapするため agent loop は止まらないが、log は出る。将来 silent-fail/log-only モードへの切り替えは S111 follow-up で検討

### Plugin tests

```bash
cd integrations/hermes/plugin
pip install -e .[test]
pytest
```

`HarnessMemClient` をモックして 15 件のテストが pass する設計（実 daemon 不要）。E2E (実 Hermes での動作確認) は Plans.md §111 S111-005 で別途実施。

## 既知の制約

- **Hermes built-in memory との並行運用**: Hermes は組み込みメモリ層 (procedural memory) を持つ。本統合では harness-mem を **追加の MCP ツール** として並行運用する形になる。built-in memory を harness-mem で置換する Python adapter は今回スコープ外（将来検討、`integrations/hermes/README.md` "Out of Scope" 参照）。
- **HTTP MCP transport は opt-in 段階**: local Streamable HTTP MCP gateway (`harness-mem mcp-gateway start`, `127.0.0.1:37889/mcp`) と Hermes 用 `url:` config 生成 (`harness-mem mcp-config --transport http --client hermes --write`) は使える。ただし既定の案内はまだ stdio fallback を維持する。互換 smoke / latency benchmark を見ながら recommended/default 化を判断する。
- **on-demand spawn と複数クライアント**: 方式 B（`bunx` で Hermes 起動時に spawn）を選ぶと、Hermes セッション間でも独立 daemon になる場合がある。複数ツールでメモリ共有する用途では方式 A（別プロセス常駐）を推奨。

## 関連リソース

- [`integrations/hermes/README.md`](../../integrations/hermes/README.md) — Quickstart
- [`integrations/hermes/examples/hermes-config-minimal.yaml`](../../integrations/hermes/examples/hermes-config-minimal.yaml) — 最小設定
- [`integrations/hermes/examples/hermes-config-full.yaml`](../../integrations/hermes/examples/hermes-config-full.yaml) — 全 `harness_mem_*` ツールを公開する例
- [`docs/claude-harness-companion-contract.md`](../claude-harness-companion-contract.md) — runtime 仕様
- [`docs/environment-variables.md`](../environment-variables.md) — env 変数仕様
- [`mcp-server/README.md`](../../mcp-server/README.md) — MCP サーバー全体仕様
- [Hermes Agent MCP ガイド](https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes)
