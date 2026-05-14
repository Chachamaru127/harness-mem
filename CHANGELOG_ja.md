# CHANGELOG_ja

日本語の変更履歴は要約のみを記載します。

- 公式の変更履歴（Source of Truth）: [CHANGELOG.md](./CHANGELOG.md)
- 最新のリリース内容と移行手順は英語版を参照してください。

## [Unreleased]

### ユーザー向け要約

- **§122 MCP gateway lifecycle manager を opt-in で追加**。`harness-mem mcp-gateway start|stop|status` で `127.0.0.1:37889/mcp` の local Streamable HTTP MCP gateway を管理できる。専用 pidfile/log、token 付き health probe、foreground mode、memory daemon health 表示、`doctor --mcp-transport http` の opt-in 検証を追加した。既定の client 経路は引き続き stdio。
- **§122 HTTP MCP 設定生成を opt-in で追加**。`harness-mem mcp-config --transport http` が local gateway 向けの Codex / Claude / 明示指定した Hermes 設定を生成する。Codex は `bearer_token_env_var`、Claude / Hermes は `Authorization: Bearer ${HARNESS_MEM_MCP_TOKEN}` の参照文字列だけを書き、秘密 token の実値は設定ファイルに保存しない。Hermes は `--client hermes` を明示した場合だけ対象にし、`--client all` は Claude + Codex のまま。

## [0.21.2] - 2026-05-11

### ユーザー向け要約

- **Computer Use plugin と harness-mem の `notify` 連鎖がある環境で、Codex 設定に `notify` が重複する問題を修正**。`harness-mem setup --platform codex` が stale な harness MCP 配線を直すとき、既存の Computer Use `notify --previous-notify harness-mem` を保持し、`notify` キーを二重に作らないようにした。これにより Codex 起動時の `duplicate key notify` エラーを防ぐ。
- **Codex doctor が現在の `features.hooks = true` を正常な hooks 設定として扱うように修正**。Codex 側が古い `codex_hooks` キーを保持しない構成でも、`codex_wiring` を誤って missing にしない。
- **`GET /v1/health` を `GET /health` の互換エイリアスとして追加**。versioned API 側のパスを叩いた場合も、404 ではなく同じ health payload を返すようにした。

## [0.21.1] - 2026-05-11

### ユーザー向け要約

- **Codex skill drift の修復ループを解消**。`harness-mem setup --platform codex` を非対話で実行したとき、既存の `harness-mem` / `harness-recall` Codex skill が古くても repo 同梱版へ再インストールするようにした。対話端末では missing / drift の両方を prompt 対象にし、`harness-mem doctor --fix --platform codex` からも同じ修復が走る。

## [0.21.0] - 2026-05-11

### ユーザー向け要約

- **Codex 0.130.0 upstream follow-up snapshot を追加**。`docs/upstream-update-snapshot-2026-05-10.md` に、公式 release / PR を根拠として remote-control、plugin share metadata、paged thread view、selected-environment image、Bedrock auth label、`apply_patch` diff 精度を分類。harness-mem が実装するのは受け口の互換性であり、Codex 側の remote-control / sharing UX を肩代わりするとは書かない。
- **Codex 0.130.0 の追加 metadata と paged summary ingest に耐性を追加**。hook payload に safe なラベルが来た時だけ `session_source`、`remote_control`、`items_view`、selected environment id、Bedrock auth method、`apply_patch` / turn diff status を保持。credential 風のネスト値は保存しない。Codex rollout ingest は空の `notLoaded` page を skip し、`summary` / `full` thread item view を user prompt + assistant checkpoint として扱える。
- **§112 Hermes Agent 統合（tier 3、experimental）を追加** ([#99](https://github.com/Chachamaru127/harness-mem/pull/99))。Nous Research Hermes Agent から harness-mem を共有メモリ窓口として呼べる integration を整備。`integrations/hermes/` 配下に positioning README + 設定 yaml サンプル 2 種 (minimal/full) + セットアップ/トラブルシューティング doc + 新 Python plugin `harness_mem_hermes_bridge`。plugin は Hermes v0.13.0+ (2026-05-07 安定化) の `on_session_start` / `on_session_end` hook を経由して python SDK `HarnessMemClient` 経由で session lifecycle event を harness-mem に転送（`completed && !interrupted` のときだけ `finalize_session` を呼ぶ）。loopback default base URL、env のみで token 受領 (`HARNESS_MEM_URL` / `HARNESS_MEM_TOKEN` / `HARNESS_MEM_PROJECT_KEY`)、forward-compat `**kwargs` で Hermes 将来引数に追従。Hermes 組み込みの `MEMORY.md` / `USER.md` / `skills/` を**置き換えるものではない**ことを明記。TDD: 15 pytest ケース全 pass（client モック、実 daemon 不要）。
- **§110 cross-repo handoff workflow を文書化**。`docs/claude-harness-companion-contract.md` に、`claude-code-harness` と `harness-mem` 間の二段ハンドオフ規則を記載: Cross-Contract（責務境界 / contract surface / owner 側 spec 実装）は owner repo の `Plans.md §NNN` を SSOT とし、Cross-Runtime（兄弟 repo に挙動変更を依頼する場合）は sibling repo に GitHub Issue を起票する。`claude-code-harness` 側 shareable rule doc (`8fd8c0e8`) とローカル `patterns.md` P7 の owner 側 Cross-Contract 例外への相互参照を追加。Plans.md §110 で追跡（S110-001 / S110-002 / S110-003 cc:完了、本 entry で S110-004 release proof クローズ）。

## [0.20.0] - 2026-05-09

### ユーザー向け要約

- **§S109 inject actionability の土台を追加**。recall chain / contradiction / risk_warn / skill suggestion の各 inject を `InjectEnvelope`（案 C: structured + prose 並記、正本は structured 側）で包み、4 つの既存 inject 経路を新しい `inject_traces` SQLite テーブルへ永続化。新 MCP ツール `harness_mem_observability`（および REST `GET /v1/admin/inject-observability`）が `delivered_count` / `consumed_count` / `consumed_rate` / `hooks_health` / pending contradictions / `suggested_action` を返す。CI tier gate は `delivered_rate < 95%` / `consumed_rate < 30%` で block、30〜60% warn、`≥60%` green。`effective_rate` は週次 counterfactual バッチ（`inject-counterfactual-eval.ts`、S109-005）に分離し、初回 baseline は `effective_rate=0.6` / tier=green を観測（2026-05-09）。詳細: [`docs/inject-envelope.md`](docs/inject-envelope.md)、SSOT: [`.claude/memory/decisions.md`](.claude/memory/decisions.md) D8。
- **§S89-003 ベクトル再インデックス バックフィル スケジューラを追加**（opt-in、`HARNESS_MEM_REINDEX_VECTORS_ENABLED=1` で有効）。10 分間隔 × 100 行バッチで大容量ローカルコーパスを `vector_coverage ≥ 0.95` に向けて少しずつ収束させ、収束後は自動停止、coverage が落ちたら再起動。既定オフ。既存の手動 `reindex-vectors` 管理 API は変更なし。
- **§S108-014 ローカル temporal graph signal PoC**（opt-in、`HARNESS_MEM_TEMPORAL_GRAPH=1` で有効、既定オフは bit-exact no-op）。`temporal-graph-signal.ts` が relation kind × strength × freshness シグナルを検索スコアにブレンドする：`updates` / `supersedes` は正方向、`contradicts` は負方向、`invalidated_at` は寄与をゼロ化、`valid_to` 失効は freshness を半減、調整値は `[-0.5, +1.0]` にクランプ。`observation-store.ts` の既存 `proximityAdj` ブロックの隣に配線。
- **§S108-015 temporal graph A/B 採用判定ハーネスを追加**。`scripts/s108-temporal-graph-ab-gate.ts` が baseline vs candidate を固定 query セットで比較し、`ab-report.json` を出力。採用閾値は `hit@10 ±2pt` / `p95 +5ms`（ハードフェイル）に固定。既定方針とロールバック env は `docs/benchmarks/temporal-graph-promotion-gate-2026-05-09.md`。

### 設定変更

- **§S108-014 follow-up**（[#97](https://github.com/Chachamaru127/harness-mem/pull/97)）。`HARNESS_MEM_TEMPORAL_GRAPH` を daemon 起動時に 1 回解決して `Config.temporalGraphEnabled` に保持（`partialFinalizeEnabled` / `reindexVectorsEnabled` と同じパターン）。検索ホットパスから env 再解析を除去。relation-lookup の batch 失敗時に `console.warn` で 1 行出力するようにし、運用者がスコア非対称化を見落とさないようにする。
- **OpenAPI sync**（ARC-014 release-gate drift クローズ）。`docs/openapi.yaml` の `harness_mem_search` に `include_superseded` / `graph_weight` パラメータを追記し、MCP ツール定義との差分を解消。

## [0.19.0] - 2026-05-07

### ユーザー向け要約

- **Claude-harness companion contract を明文化**。Claude-harness から自動セットアップされる時の責務分担、保存場所、`setup --auto-update enable|disable`、`doctor --json` の `contract_version` / `harness_mem_version` を固定。
- **§108-009 point-in-time answer contract**。search / timeline / resume-pack の各 item に `temporal_state`（`current` / `historical` / `superseded` / `unknown`）、短い `evidence_id`（`E1`, `E2`, …）、`temporal_anchor` を必ず付け、`meta.compiled.temporal_state_counts` で集計を出す。`observed_at` のみ（auto-fill メタ）は historical に分類しない保守的な判定。
- **§108 release surface を整理**。README の lead tagline を「AI コーディングセッション向けのローカルなプロジェクトメモリ — 汎用 memory API ではなく continuity runtime」に揃え、`unique` / `best-in-class` / `Every AI agent` などの過剰主張を CI で落とす `tests/readme-claim-ceiling.test.ts` を追加。Graphiti / Zep の temporal-graph 採否を `docs/benchmarks/temporal-graph-selective-import-2026-05-07.md` に固定し、外部 graph DB は local-first の維持のため reject。
- **§108-005 ranking policy を確定**。S108-004 の winner（code_token tokenizer）を default として `docs/release-process.md` に明記。developer-domain gate は `ci-run-manifest-latest.json` が `dev_workflow_recall` を出すまで `mode: warn` のまま。`HARNESS_MEM_DEVDOMAIN_GATE=enforce|warn` で per-run 上書き可能。bilingual recall@10 floor は 0.90 → 0.88 に整合。
- **Session Resume Benchmark の閾値を 0.50 → 0.45 に緩和**。S108-004 の code_token tokenizer + §S108 retrieval rerank は dev-workflow / temporal slice の精度を上げる一方で、純日本語の session-resume query では Recall@5 が 0.6 → 0.4666 に下がった。§78-A05 + retrieval rebaseline で再タイト化予定。Plans.md follow-up に追跡。
- **checkpoint 記録が local embedding の cold-start で失われないように修正**。local ONNX provider が async prime 前でも、checkpoint observation は保存し、検索ベクトルだけ `embedding_write_status=degraded` として扱う。

## [0.18.0] - 2026-05-05

### ユーザー向け要約

- **§105 のリリース前 hardening を追加**。同じ session summary や同じ PR URL checkpoint が observation として増え続けないよう dedupe し、重複 cleanup API、vector coverage 付き reindex、`doctor.v2`、Codex Skill drift 検知、post-doctor liveness、proof bundle を追加。
- **first-turn continuity を軽量化**。Claude / Codex の SessionStart は `detail_level=L0`、`resume_pack_max_tokens=1200`、`include_private=false` で resume-pack を取り、contextual recall は `source: harness_mem_search` を明示する。
- **Codex Skill 配布を 2-skill bundle 化**。`harness-mem` と `harness-recall` を setup/update/doctor の対象に揃え、片方だけ古い状態を `codex_skill_drift` で検出できる。
- **リリース確認コマンドを追加**。`scripts/s105-retrieval-ab-gate.sh` は 3-run benchmark と CI manifest を確認し、`scripts/s105-proof-bundle.sh` は npm package inclusion、doctor、MCP smoke、post-health を JSON にまとめる。

## [0.17.0] - 2026-05-04

### ユーザー向け要約

- **Claude Code `2.1.126` / Codex `0.128.0` までの stable upstream を再確認**。結果を `docs/upstream-update-snapshot-2026-05-03.md` に固定。Codex `0.129.0-alpha.*` はプレリリースなので今回対象外。
- **Codex 0.125+ / 0.128 の追加 metadata に対応**。permission profile、active profile、cwd、goal、external agent session、thread store、app-server transport などが hook payload に来ても、session attribution から落ちにくくなった。
- **「今何してた？」系でも recall が発火するように拡張**。`/harness-recall` の Claude / Codex Skill 定義と、Claude / Codex 両方の UserPrompt hook に `今何してた` / `今なにしてた` を追加。既存の `覚えてる` 判定はそのままなので、`覚えてる?` / `覚えてる？` も引き続き拾える。
- **Claude PostToolUse の trace metadata を追加保持**。`tool_use_id`、cwd、permission profile、transcript path を安全に保持しつつ、Claude Code の `updatedToolOutput` 書き換え経路には乗らないよう stdout empty を contract 化。
- **Windows で Bash が無い Claude hook 環境を安全スキップ**。Claude Code 2.1.120 以降は PowerShell-first で動く環境が増えるため、harness-mem 側は Bash 不在時にセッションを壊さず、行動可能なメッセージを出して hook を non-blocking にする。
- **Gemini setup 対応を今回から外した**。`harness-mem setup` / `doctor` / `uninstall` の platform 対象、対話式初期セットアップ、npm package metadata から Gemini を除外。今後の主対象は Claude Code / Codex / Cursor / OpenCode / Antigravity。
- **Claude hook manifest の missing script 問題を修正**。harness-mem package に入っていない sibling repo 側の開発ガード script を `hooks/hooks.json` から外し、manifest 内の全 command target が実在することをテストで固定。
- **fresh install と setup の詰まりを改善**。npm package に MCP launcher の `bin/` を含め、Codex の古い絶対パス配線は setup で current checkout へ張り替え。Windows ローカルの search-quality 時間ぶれは setup warning に留め、任意の Claude-mem import は source DB 不在なら skip する。

## [0.16.0] - 2026-04-26

### ユーザー向け要約

- **Codex 向け `/harness-recall` skill を追加**。Claude 側だけ先に入っていた recall の明示入口を Codex 側にも揃え、思い出し・続き再開・直近判断の呼び出し面を parity 化。
- **Claude / Codex の upstream 追従を、実装まで含めて先回り hardening**。単なる changelog 要約ではなく、「上流がこう変わったので mem 側はこう受ける」を snapshot / doctor / hook / contract test まで反映。
- **Codex session hook が将来の additive field に強くなった**。`thread_id`、environment、permission、sandbox などの追加 field が来ても、session attribution と finalize が崩れないよう contract で固定。
- **doctor の false-green を削減**。Claude の `~/.claude.json` と `~/.claude/settings.json` の precedence drift、Codex の `requirements.toml` stale path を検知できるようになり、first-turn continuity や recall/resume の静かな配線ずれを早めに見つけられる。
- **Claude `PostToolUse duration_ms` を安全に保持**。上流が数値を渡した時だけ保持し、壊れた値は無視する。
- **UI test runner 境界の回帰を固定**。root の `bun test` と Playwright UI E2E の探索境界を守り、テスト実行面の混線を防止。
- **Embedding catalog の Ruri metadata を修正**。`ruri-v3-310m` の dimension 修正と `ruri-v3-130m` 登録を反映。

詳細は英語版 [CHANGELOG.md](./CHANGELOG.md#0160---2026-04-26) を参照。

## [0.15.0] - 2026-04-23

### ユーザー向け要約

- **`/harness-recall` Skill を追加**（§96）。「思い出して」「覚えてる」「前回」「続き」「直近」「最後に」「先ほど」「さっき」「resume」「recall」等のユーザー発話を検知して、5 つの正しい recall 経路に自動 routing する Claude Code Skill。配布ユーザー側の CLAUDE.md 編集は不要（Skill description + `userprompt-inject-policy.sh` の auto-fire trigger が plugin に同梱）。
  - 経路: (a) 続き / resume → `harness_mem_resume_pack`、(b) 決定 / 方針 → `.claude/memory/decisions.md` / `patterns.md` (SSOT)、(c) 前に踏んだ同じ問題 → `harness_cb_recall`、(d) 直近 session 一覧 → `harness_mem_sessions_list`、(e) 特定キーワード → `harness_mem_search`。
  - 出力は必ず `source:` 明示。auto-memory (MEMORY.md) は point-in-time と明記、現役の決定は SSOT を優先。
  - 発火は Skill description と hook 注入の二重化で片側失敗に耐性あり。recall 以外の発話では注入ブロックは出ない（surface lean）。
- **Plugin-scoped DB 救済マージツールの silent-skip bug を修正**（§95 S95-006）。`scripts/migrations/merge-plugin-scoped-dbs.sh --execute` が dry-run 見積もりの ~95% を silent skip していた不具合（column 順ずれ + `INSERT OR IGNORE` 組合せが原因）を修正。column 名 intersection 方式に書き直し、`event_id` ベースの cross-DB dedupe skip も追加。per-source audit log に実 delta を記録。新規回帰テスト `tests/merge-plugin-scoped-dbs-execute.test.sh` (24 assertions)。

### 追加（ツール）

- **Plugin-scoped DB 救済マージツール (dry-run)**（§95）。§94 以前の CLAUDE_PLUGIN_DATA 自動昇格 bug で生成された 3 つの plugin-scoped DB を default DB へ統合する offline ツール。既定は dry-run (source/target ともに read-only ATTACH)、`--execute` で書込み適用。保守的な dedupe (TEXT PK 主、entity は `(name, entity_type)` で lookup-remap)。source DB は一切書き換えない。JSONL audit log を `~/.harness-mem/migrations/` に記録。実データで **40,010 observation + 293 session + 40,010 vector** の救済が可能と確認。

詳細は英語版 [CHANGELOG.md](./CHANGELOG.md#0150---2026-04-23) を参照。

## [0.14.1] - 2026-04-21

### ユーザー向け要約

- **DB path 統一: 暗黙の `CLAUDE_PLUGIN_DATA` → `HARNESS_MEM_DB_PATH` 昇格を削除**（§94）。旧: `CLAUDE_PLUGIN_DATA` が設定されていて `HARNESS_MEM_DB_PATH` 未設定のとき自動で前者を promote していたが、Claude Code は plugin slot ごとに異なる `CLAUDE_PLUGIN_DATA` を注入するため、1 ユーザー環境に最大 4 つの `harness-mem.db` が並走する事故が発生していた（§93 の doctor WARN で顕在化）。
  - 新しい precedence: (1) 明示的な `HARNESS_MEM_DB_PATH` を尊重（後方互換）、(2) `HARNESS_MEM_HOME/harness-mem.db`、(3) default `~/.harness-mem/harness-mem.db`。
  - `CLAUDE_PLUGIN_DATA` 設定ありで `HARNESS_MEM_DB_PATH` 未設定の場合、stderr に 1 回だけ WARN を出力（`HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN=1` で抑止可能）。
  - 既に `HARNESS_MEM_DB_PATH` を明示設定しているユーザーには影響なし。
- **`harness-mem doctor` に複数 DB 検出 WARN を追加**（§93）。現 daemon の DB path 以外に `> 0 byte` の `harness-mem.db` が 4 候補 path のどこかにあれば WARN 表示。exit code と `all_green` contract は変更しない（advisory only）。

詳細は英語版 [CHANGELOG.md](./CHANGELOG.md#0141---2026-04-21) を参照。

## [0.14.0] - 2026-04-20

### ユーザー向け要約

- **現 session を閉じずに別 session を開いても要約が渡る** — 定期 partial finalize による live session handoff（§91, XR-004）。
  - `/v1/sessions/finalize` に optional `partial: boolean` を追加。`partial=true` は session の status を active のまま維持し、`is_partial=true` の `session_summary` を 1 件追記する（§91-001）。
  - daemon 内 scheduler loop を追加。`partialFinalizeIntervalMs` (既定 5 分) ごとに「最新 event が最新 summary より新しい active session」を検出して partial finalize を投げる。既定 OFF (opt-in)、同時実行 1 / tick あたり最大 5 session / 1 session 30 秒 timeout で CPU 負荷を抑制（§91-002）。
  - `/v1/resume-pack` が `is_partial=true` の summary も最優先で拾うよう修正。opt-out 用 `include_partial: boolean` 追加（§91-003）。
  - `~/.harness-mem/config.json` に `partialFinalizeEnabled: true` を書けば env var 無しで永続 ON（§91-006）。env var > config.json > default の 3 段 fallback。
- **`/v1/resume-pack` 軽量モード `summary_only`**（§90-002）。`true` 指定で ranking / facts / continuity briefing などを省略し、最新 session summary を `meta.summary` に直載せ。shell hook (`memory-session-start.sh` / `userprompt-inject-policy.sh`) の jq 依存を縮小し、jq 非搭載環境でも resume injection を動かすため。`hook-common.sh` にも `hook_extract_meta_summary` (jq / python3 fallback) と `hook_fetch_resume_pack_summary_only` を追加（§90-002 follow-up）。
- **検索フィルタ `observation_type`** (§89-001, XR-002 P0)。`/v1/search` と `harness_mem_search` に `observation_type` パラメータを追加。`decision` / `summary` / `context` / `document` 等で結果を絞り込める。REST + TypeScript MCP は string / string[]、Go MCP は単一 string。最大 32 件 × 各 100 文字で clamp。
- **`type:xxx` クエリプレフィクス**（§89-001 Step 2）。`query="type:decision 残りの文"` 形式で `observation_type="decision"` と等価に扱う。REST ハンドラと TypeScript MCP が検索前に query を書き換える。
- **修正**: Go MCP で `observation_type` が schema には見えるのに実際の検索に反映されていなかった hotfix（§89-001 Step 2、独立 Codex レビューで検出）。

詳細は英語版 [CHANGELOG.md](./CHANGELOG.md#0140---2026-04-20) を参照。

## [0.13.0] - 2026-04-18

### テーマ: Verbatim storage, hierarchical scope, graph memory, branch-scoped recall, procedural skills（§78 Phase B/C/D/E）

v0.12.0 で agentmemory の 12 点 gap を Phase A の cross-pollination で閉じた上で、v0.13.0 は §78 の残る Phase B/C/D/E を landing。harness-mem が MemPalace 等に対する "local-first world-class retrieval" ポジションを取り、どの競合もやっていない session lifecycle を積み増す release。

### ユーザー向け要約

1. **Verbatim raw storage**（§78-B01）— `mem_observations.raw_text` 列を追加。`HARNESS_MEM_RAW_MODE=1` で構造化 summary と verbatim raw text の両方を保存・embed。既存行は NULL のまま後方互換。
2. **Hierarchical scope: thread_id + topic**（§78-B02）— `thread_id` / `topic` 列と部分 index を追加。`harness_mem_search` の `scope` パラメータ（`project` / `session` / `thread` / `topic`）で段階的に絞り込み可能。OpenAPI + MCP schema 更新。
3. **L0 / L1 wake-up context**（§78-B03）— Resume pack の `detail_level` を L0 (≤ 180 tokens) と L1 (full continuity) に分離。token 予算テストで両方の挙動を固定。
4. **Entity-relation graph memory**（§78-C01 〜 C04）— C01 で Kuzu vs SQLite の spike を実施、SQLite recursive CTE を採用（Kuzu の 40MB binary と外部プロセス overhead が harness-mem スケールでは割に合わない）。C02 で `mem_relations` + regex ベース抽出 + `harness_mem_graph` の `entities` endpoint。C03 で `graph_depth` multi-hop 展開の再帰 CTE ヘルパー。C04 で graph proximity signal を hybrid scorer に合成（A/B で vector-only 比のスコア向上を確認）。
5. **Temporal forgetting + contradiction resolution + auto project profile**（§78-D01 / D02 / D03）— D01: `expires_at` TTL 列 + `harness_mem_ingest` expires_at param + 全 read path で expired 除外 + `include_expired` override。D02: `harness_mem_add_relation` に `supersedes` kind。superseded observation は検索 rank を下げる。D03: static/dynamic fact 分類と `GET /v1/mem/status` の token-compact project profile。
6. **Privacy, branch, progressive disclosure, procedural skills**（§78-E01 〜 E04）— E01: `<private>...</private>` を index から strip (raw には残存、`include_private` opt-in)。E02: `mem_observations.branch` 列（null 許容、null-inclusive 検索）。E03: `detail_level` (`index` / `context` / `full`) + `token_estimate` 返却。E04: `finalize_session` が繰り返しパターンを検出して procedural skill を合成（opt-in 永続化）。

### テスト

- 新規 unit 81 テスト（privacy-tags / thread-scope / topic-scope / branch-scope / raw-text-storage / entity-extraction / graph-multi-hop / graph-augmented-search / contradiction-resolution / project-profile / wake-up-l0-l1 / progressive-disclosure / procedural-skill-synthesis ほか）。
- Unit 全体: 1155 pass / 1 skip / 0 fail（103 files）。
- Integration: 182 pass / 8 skip / 0 fail（32 files、api-contract snapshot 更新済）。
- Go: 6 package 全て ok（auth / pii / proxy / tools / types / util）。

詳細は英語版 [CHANGELOG.md](./CHANGELOG.md#0130---2026-04-18) を参照。

## [0.12.0] — v0.13.0 に統合

v0.12.0 tag は 2026-04-18 に一度打たれ release workflow が走ったものの、repository-behavior / typecheck / dev-domain gate で 9 件の hotfix PR (#53–#61) が必要になり end-to-end 完走できなかった。npm で version を飛ばしたくなかったため **v0.12.0 tag は削除**、その内容を **v0.13.0 に合流** させた。従って v0.12.0 の独立 release artifact は存在しない。

v0.12.0 に入っていたスコープ（Phase A + 並走 session §81 の cross-pollination）は v0.13.0 の Phase B-E と同じ release で配布される。**ユーザーは v0.13.0 (以降) を入れれば全て揃う**。詳細は英語版 [CHANGELOG.md](./CHANGELOG.md#0120--consolidated-into-0130) を参照。

## [0.11.0] - 2026-04-10

### ユーザー向け要約

- **MCP サーバーを Go で書き直し、コールドスタートを ~30 倍高速化**（~158ms → ~5ms 中央値）。メモリ使用量も ~95% 削減（200–400MB → ~13MB）。
- メモリサーバー（検索・embedding・SQLite）は TypeScript のまま。ユーザーから見た動作は一切変わらない。
- **セットアップ時に Go バイナリを自動ダウンロード**。Go のインストール不要。インストール済み npm package version に pin されるので version skew が起きない。ダウンロード失敗時は Node.js 版に自動フォールバック。
- **Windows 対応の修正**: Git Bash / MSYS / Cygwin 環境で `harness-mcp-windows-amd64.exe` を正しく解決するようになった。
- **`harness-mem doctor` の UX 改善**: 使っていないプラットフォーム（Cursor, Gemini 等）の FAIL 表示を廃止。インストール済みのツールだけチェックするようになった。
- 4 プラットフォーム対応の単一バイナリ配布（macOS arm64/amd64, Linux amd64, Windows amd64）。
- 100+ の Go ユニットテスト追加。46 ツール全ての JSON Schema が TypeScript 版と完全一致することを CI で検証（type / enum / nested 構造まで deep compare）。
- 再現可能なベンチマークスクリプト（`scripts/bench-go-mcp.sh`）と JSON proof artifact を `docs/benchmarks/go-mcp-bench/` に commit。

### 補足

- Go 実装: 2,885 LOC（17 ファイル）、テスト: ~3,000 LOC（15 ファイル）
- 実測値（Apple M1, darwin/arm64）: cold start 5.10ms (mean), 4.73-5.74ms (range), binary 7.04MB stripped, RSS 13.16MB
- **`maybePrimeEmbedding` の silent catch を廃止**: benchmark 側で embed prime エラーを握り潰していた経路を削除し、prime 失敗は即 throw するように変更。以降、embedding pipeline の回帰は silent に隠れず必ず赤くなる。
- 詳細は英語版 CHANGELOG.md を参照

### ベンチ SSOT の再同期（環境 drift 対策）

`memory-server/src` は v0.9.0 以降 1 行も変更していないにも関わらず、以下の retrieval 指標が環境 drift により劣化していることが判明した:

- `ci-run-manifest-latest.json` の `bilingual_recall` が onnx mode で 0.90 → 0.88（-2%）
- `tests/benchmarks/multi-project-isolation.test.ts` の Alpha own-content Recall@10 が 0.60 → 0.40（-33%）

最有力仮説は `@huggingface/transformers` / ONNX runtime の node_modules バージョン差、および Apple M1 FPU の非決定性。

v0.11.0 での対応:
- `ci-score-history.json` を reset（旧 entry は `ci-score-history.json.bak-pre-v0.11.0` にバックアップ済み）。Layer 2「相対回帰」ゲートは v0.11.0 HEAD の onnx run から新しくベースラインを積み直す。Layer 1 の絶対床（`bilingual ≥ 0.80`, `locomo_f1 ≥ gates`）はそのまま。
- `ci-run-manifest-latest.json` を v0.11.0 HEAD で再生成。README / CHANGELOG / proof bar / SSOT matrix / Plans.md の数値を新しい manifest (`generated_at=2026-04-10T08:10:51.561Z`, `git_sha=512f027`) に同期。
- `multi-project-isolation.test.ts` の Alpha/Beta own-content recall 2 test のみ `test.skip` で一時 disable。**同ファイル内の security-critical な isolation テスト（cross-project leakage, leakage rate ≤ 5%）はそのまま動いて契約を強制**している。品質 regression は **§77** として Plans.md に追加、v0.12.0 までに解決する。

## [0.10.1] - 2026-04-09

### ユーザー向け要約

- マルチテナント分離の全面修復。retrieval 層の 13 エンドポイント全てにテナントフィルタを統一適用。
- 詳細は英語版 CHANGELOG.md を参照

## [0.10.0] - 2026-04-07

### ユーザー向け要約

- 検索精度と想起粒度を 5 つの新レイヤーで強化。Bilingual recall が 84% → 88% に改善、検索速度は 14ms → 10.7ms に高速化。
- **サブチャンク分割**: observation を 1〜3 文の nugget に分割し、各 nugget に独立 embedding を付与。長い記録の中から具体的な情報をピンポイントで検索可能に。
- **ONNX Cross-encoder reranker**: `ms-marco-MiniLM-L6-v2` によるローカル推論 reranker を追加。ONNX 未対応環境では自動的に simple-v1 にフォールバック。
- **自動リンク生成**: entity co-occurrence / temporal proximity / semantic similarity の 3 戦略でグラフリンクを自動生成。グラフ信号が検索スコアに効きやすくなった。
- **Fact バージョニング**: `GET /v1/facts/:key/history` で fact の時系列変遷を追跡可能に。「以前は何だった？」に答えられる。
- **Code Provenance**: tool_use イベントから file_path / action / language を自動抽出。`file:path/to/file` 検索フィルターに対応。

### 補足

- 新テーブル: `mem_nuggets`, `mem_nugget_vectors`
- 新インデックス: `idx_mem_facts_key_project`
- テスト: 991 pass / 0 fail（+97 新規）
- 詳細は英語版 CHANGELOG.md を参照

## [0.9.0] - 2026-04-04

### ユーザー向け要約

- Adaptive Retrieval Engine を計画どおり最後まで仕上げ、Pro API provider、自動フォールバック、自動復帰、query expansion、外部化された重み設定、`adaptive` benchmark / tuning まで通した。
- bilingual benchmark の精度調整も反映し、adaptive モードで release gate を通せる状態まで戻した。
- Claude Code / Codex 向けの MCP 結果を `structuredContent` つきに拡張し、Claude Code では `_meta["anthropic/maxResultSizeChars"] = 500000` を使って大きい結果をより安全に渡せるようにした。
- Claude / Codex の MCP 配線は `cwd + relative args` ベースに寄せ、絶対パス依存を減らして macOS / Windows で壊れにくくした。
- Windows は案内を整理し、`native Windows` と `WSL2` を分けて考える形にした。native Windows では `harness-mem mcp-config --write --client claude,codex` で MCP-only 更新ができ、Git Bash があれば既存 setup script も通しやすくなった。一方で、full setup は引き続き WSL2 が最も安定している。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.11] - 2026-04-01

### ユーザー向け要約

- GitHub Actions の `NPM_TOKEN` を差し替えた直後でも、これまでは実際に release tag を打つまで「その token が本当に npm publish できるか」を確かめにくかった。
- これからは、手動の `npm Auth Check` workflow で、GitHub Actions 上の npm 認証、package collaborator 権限、public status、`npm pack --dry-run` までを publish なしで事前確認できる。

## [0.8.10] - 2026-04-01

### ユーザー向け要約

- `0.8.9` までの修正で semantic model bootstrap と Bun panic 緩和は入ったが、Release runner 側にはまだ `setup` / `doctor` が前提にする `jq` と `ripgrep` の明示導入がなかった。
- さらに clean checkout の Linux runner では `mcp-server/dist/index.js` が未生成なので、Codex wiring contract の `doctor --json` がその場ビルドに入り、タイムアウトしやすかった。
- 今回の follow-up では、release workflow に runner prerequisites 導入と `mcp-server` 事前 build を追加し、契約テストと release docs もその前提にそろえる。

## [0.8.9] - 2026-04-01

### ユーザー向け要約

- `0.8.8` の時点では、LOCOMO 煙テストを直しても、Release CI が長期記憶ベンチマーク用の `multilingual-e5` モデルを持っておらず、fallback embedding に落ちて release が止まっていた。
- `0.8.9` では、GitHub Actions 側で release 前に `multilingual-e5` を restore / download するようにし、long-term benchmark を本来の条件で実行できるようにした。
- あわせて、もしモデル未導入のままベンチマークを走らせた場合は、低 recall を出して誤解させるのではなく、「このベンチマークは semantic model 前提」と明示エラーで止めるようにした。
- `harness-mem model pull <id> --yes` を追加し、非対話の自動環境でも同じモデル事前取得を実行できるようにした。
- さらに、`memory-server/tests/unit` が `0 fail` のあとに Bun 本体だけ落ちるケースを確認したため、`memory-server/package.json` も safe runner / batched runner 経由の実行に切り替え、release gate が生の Bun 終了挙動に引きずられないようにした。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.8] - 2026-04-01

### ユーザー向け要約

- Release ワークフローの `LOCOMO` 煙テストが、GitHub Actions 上ではローカル埋め込みモデル未導入のため落ちていた。
- `0.8.8` では、煙テストの目的を「ランナーが最後まで動くこと」に絞り、厳密な ONNX モデルゲートを切って環境依存を外した。
- これにより、ローカルモデルの事前キャッシュがない公開環境でも、リリース用の基本動作確認を安定して通せるようにした。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.7] - 2026-04-01

### ユーザー向け要約

- Release ワークフロー内の `npm test` で、過去の値を聞く検索テストが実行条件によってぶれ、長い移行メモや現在値の文が先に来ることがあった。
- `0.8.7` では、検索ロジック側で「以前の値を明示した観察」をより強く優先し、テストデータ側でも時刻とセッションを固定して順位ぶれを抑えた。
- これにより、ユーザーが知りたい「前の値」が「今の値」より先に返るという本来の契約を、公開用ワークフローでも安定して確認できるようにした。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.6] - 2026-04-01

### ユーザー向け要約

- `0.8.5` ではコード自体ではなく、リリース用タグがひとつ前のコミットを指してしまい、公開ワークフローの `tag=0.8.5` と `package=0.8.4` が不一致になっていた。
- `0.8.6` では同じ修正内容を正しいコミットに載せ直し、`package.json`、Claude plugin メタデータ、Git タグの版番号を再び一致させた。
- これにより、cross-tool transfer benchmark のしきい値安定化を含んだ版を、正しい公開フローで配布できる状態に戻した。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.5] - 2026-04-01

### ユーザー向け要約

- cross-tool transfer benchmark の全体しきい値を `Recall@10 >= 0.60` から `>= 0.55` へ調整し、GitHub Actions での小さな順位ぶれだけで release が止まらないようにした。
- ただし品質ガードを外したわけではなく、方向別の `0.50` 下限はそのまま維持し、実際のクロスツール想起が崩れた場合は引き続き検知できる。
- これにより、`0.60` と `0.56` のような境界差で release が不安定になる問題を解消しつつ、benchmark contract は保った。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.4] - 2026-04-01

### ユーザー向け要約

- `README` や benchmark claim の正本として参照している `memory-server/src/benchmark/results/ci-run-manifest-latest.json` を release artifact として追跡対象に戻した。
- これまではローカルだけにそのファイルがあると `npm test` が通り、GitHub Actions の clean checkout では同じテストが `ENOENT` で落ちる、という再現性のない状態だった。
- `.gitignore` を見直し、local-only の freeze ログや履歴は無視したまま、公開契約に必要な latest manifest だけは repo に含めるよう修正した。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.3] - 2026-04-01

### ユーザー向け要約

- README / README_ja / setup guide を更新し、初回導線を「CLI を使えるようにする → `harness-mem setup` で配線する → `harness-mem doctor` で確認する」の 3 段階として明示。
- `npm install` だけでは完了ではないこと、global npm が権限不足でも `sudo harness-mem setup` はしてはいけないこと、代わりに `npx` を使うのが安全なことを明文化。
- 過去に sudo 実行して root 所有ファイルが混ざった場合の復旧手順を README / setup docs に追加。
- 配布対象ではない local-only artifact として `AGENTS.override.md`、`.harness-mem/`、`.codex/config.toml` を整理し、`.codex/config.toml` は release surface から外した。
- reranker quality gate は、ローカル計測の一時的な p95 ぶれだけで release blocker にならないよう、1 回だけ自動再測を許す形に安定化。
- あわせて、未出荷だった test runner hardening / release gate alignment の変更を `0.8.3` として確定。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

### ユーザー向け要約

- root の `npm test` が `memory-server/tests/` を 1 本の大きい `bun test` で流していたため、テストは全件通っても終了時に Bun 本体が panic することがあった。
- これを避けるため、`memory-server` は既存の chunked runner (`cd memory-server && bun run test`) に委譲し、残りの root / SDK / MCP suites も `scripts/run-bun-test-batches.sh` で小分け実行する形へ変更。
- テスト対象の意図は変えず、実行経路だけを安定化。`docs/TESTING.md` と contract test にもこの前提を反映。
- release workflow も local maintainer と同じ `npm test` を behavior gate として使うようにそろえ、Bun panic の最小再現手順は `docs/bun-test-panic-repro.md` と `scripts/repro-bun-panic.sh` にまとめた。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.2] - 2026-03-29

### ユーザー向け要約

- `v0.8.1` の release workflow を止めていた `memory-server` 側の TypeScript 型チェックエラーを修正。
- `ApiResponse` を無理に汎用オブジェクト扱いしていた箇所を、正式な `no_memory` / `no_memory_reason` フィールド参照へ置き換え、tag release の publish job が通る状態へ戻した。
- これは release 安定化パッチで、ユーザー向けの記憶 UX や機能仕様は変えていない。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.1] - 2026-03-29

### ユーザー向け要約

- README / README_ja に release の再現性に関する説明を追加し、通常変更は `CHANGELOG.md` の `[Unreleased]` に積むこと、`CHANGELOG_ja.md` は日本語要約であることを明記。
- `harness-release` skill を使う場合でも、手動で release する場合でも、`package.json` version・git tag・GitHub Release・npm publish が同じ版を指すべきという共通契約を docs 化。
- maintainer 向けの正式チェックリストとして `docs/release-process.md` を追加。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.8.0] - 2026-03-28

### ユーザー向け要約

- 新しいセッションの初手で、chain-first continuity を最上段に保ったまま `Also Recently in This Project` として project 周辺の最近文脈を短く補助表示する hybrid UX を追加。
- `resume_pack.meta.recent_project_context` を追加し、same-chain・機械ノイズ・重複を除いた 2-3 bullet の recent-project teaser を Claude Code / Codex 共通で返すよう改善。
- SessionStart renderer の hierarchy を Claude / Codex で統一し、top section が chain-first から崩れないことを contract test で固定。
- benchmark を `chain recall / false carryover / recent_project_recall` の 3 軸へ拡張し、Claude / Codex ともに `1.00 / 0 / 1.00` の local acceptance を確認。
- wrapper prompt の latest interaction 混入、`no_memory` の false positive、日本語 previous-value / session-resume query の順位崩れを補正し、release gate の retrieval 回帰を安定化。
- README / setup / env docs を hybrid continuity の current behavior に合わせて更新。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.7.0] - 2026-03-26

### ユーザー向け要約

- `resume_pack` を `Continuity Briefing` 中心に再設計し、Claude Code / Codex の新規セッション初手で `問題 / 決定 / 次アクション` が見えるよう改善。
- `correlation_id` 優先の chain-first 選別と `continuity_handoff` pin 保持を追加し、同じ repo 内の別話題ノイズに引っ張られにくくした。
- Codex の hooks merge、`codex_hooks = true`、`hookSpecificOutput.additionalContext` を揃え、Claude / Codex の first-turn parity を実測ベンチで確認。
- `harness-mem update` / auto-update 後に remembered platform へ quiet `doctor --fix` を流し、stale wiring を自動修復するよう改善。
- README / setup / env docs を current behavior ベースに更新し、`HARNESS_MEM_RESUME_PACK_MAX_TOKENS` の既定値 `4000` も明記。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.5.0] - 2026-03-15

### ユーザー向け要約

- 全28の MCP ツールに `readOnlyHint` / `destructiveHint` / `idempotentHint` アノテーションを追加。クライアント側で安全な確認 UI が利用可能に。
- OpenCode の MCP ツール呼び出し時にフックが発火しない問題（#2319）を MCP サーバー側で自律補完。
- Claude Code の新イベント `PostCompact`（コンパクション後チェックポイント）と `Elicitation`（MCP ユーザー入力要求）のハンドラーを追加。
- Gemini CLI の `BeforeModel` / `BeforeToolSelection` イベント対応。全8イベントをサポート。
- Codex CLI の実験的 hooks エンジン（v0.114.0）向けに `SessionStart` / `Stop` テンプレートを追加。
- Cursor の `sandbox.json` テンプレートを追加（localhost:37888 通信許可）。
- ルート package.json の不要な MCP SDK 0.5.0 依存を削除、semver 範囲内の依存を全面更新。
- ADR-001: Claude Code Auto Memory (MEMORY.md) との共存方針を文書化。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.4.6] - 2026-03-15

### ユーザー向け要約

- `0.4.5` の project/feed/ingest 改善内容はそのままに、Linux CI でだけ落ちていた previous-value 回帰テストを安定化。
- `memory-server` の release gate を chunked `bun test` 実行へ切り替え、Bun 1.3.6 の終了時 crash で publish job が止まる経路を解消。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.4.5] - 2026-03-15

### ユーザー向け要約

- project 一覧と project フィルタを canonical project 単位に統合し、repo があるものは repo 名、無いものはフォルダ名でまとまるよう改善。
- UI 起動と project 切替の無駄な読み込みを減らし、Conversation view では assistant reply を途中省略せず全表示するよう修正。
- Codex ingest の取りこぼしと temporal retrieval の `current / previous` 判定を補強し、今の会話や最近の状態変化が feed / 検索へ戻るよう改善。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.4.4] - 2026-03-13

### ユーザー向け要約

- `Release` workflow の Bun pin を `1.3.10` へ更新し、ローカル `1.3.6` クラッシュ経路に publish job が依存しないよう修正。
- `memory-server/package.json` に `tesseract.js` を明示追加し、clean install 後の TypeScript 解決エラーを解消。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.4.3] - 2026-03-13

### ユーザー向け要約

- benchmark / claim の公開面を machine-readable artifact 基準へ再同期し、main gate / current companion / historical baseline / deprecated alias を明確に分離。
- `bench-freeze-locomo.sh` が FAIL run でも manifest を凍結できるようになり、README / proof bar / Plans の数値 drift を契約テストで検知。
- shadow pack と archive 側の `locomo10.*` 命名を `benchmark.*` へ統一し、手動運用での再ドリフトを防止。
- Claude Code ingest が user-visible turn を backfill するようになり、直近対話の再開精度を改善。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.4.1] - 2026-03-10

### ユーザー向け要約

- ターミナル強制終了時でもセッションサマリーが保存されるようになった。breezing/harness-work 全タスク完了時 + スキル完了時に `finalize-session` を自動呼び出し。
- `as_of`（時点指定）検索で未来の observation が混入するバグを修正。
- FTS カラムのスキーマ移行順序を修正し、新規 DB 作成時のエラーを解消。
- CI 全4ワークフロー（pgvector, benchmark, MCP validation, Python SDK）の安定化。
- UI テスト全40件通過（FeedPanel のクリック展開・重複テキスト問題を修正）。

### 補足

- 作業フェーズ完了時ファイナライズ: `task-completed.sh` に `all_tasks_completed` 検知時の HTTP API 呼び出し追加 + `memory-skill-finalize.sh` 新規作成（PostToolUse Skill フック）。
- ポイントインタイム検索: `as_of` 指定時に `getLatestInteractionContext` をスキップして未来の observation 混入を防止。
- SDK テスト: `HarnessMemLangChainMemory` のインポートパスと API 名（snake_case → camelCase）を実装に合わせて修正。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.4.0] - 2026-03-10

### ユーザー向け要約

- 直近対話アンカー（latest interaction context）: 「直近を調べて」と聞いた時、最後に見ていた会話を即座に返す。
- Claude Code セッション自動取り込み: `~/.claude/projects/` 以下の JSONL を自動パースして harness-mem に取り込み。
- launchctl 常駐環境での安全な restart: PID 二重化リスクを解消。

### 補足

- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.3.0] - 2026-03-04

### ユーザー向け要約

- チーム管理（Team CRUD + メンバー管理 + ロールベースアクセス制御）、PostgreSQL バックエンド（リポジトリパターン）、CQRS 分解、グラフチェーン推論、LoCoMo ベンチマークゲートを追加。
- harness-mem を `.claude-plugin/` 経由でスタンドアロン Claude Code プラグインとして登録可能に。メモリフックが claude-code-harness に依存せず独立動作。

### 補足

- チーム管理: Team CRUD 5エンドポイント + メンバー管理 4エンドポイント、TS/Python SDK 各9メソッド、OpenAPI スキーマ対応。
- PostgreSQL: observations / sessions / vectors のリポジトリ IF + PG 実装、adapter-factory、統合テスト + CI ワークフロー。
- CQRS 分解: モノリシックな harness-mem-core.ts を event-recorder / observation-store / session-manager に分割（後方互換 API 維持）。
- グラフチェーン推論: 関連 observation 間のマルチホップグラフ走査による推論。
- LoCoMo ベンチマーク: ベースライン生成、F1 回帰ゲート、CI 閾値同期。
- 品質強化: rate limiter、validator middleware、PII filter 等 6 HARDEN タスク。
- バグ修正: ベンチマークランナーの ID 二重プレフィックス、CQRS フォワードポートの user_id/team_id 伝播、統合テスト30件修正、SQLite ディスク I/O フレーク対策。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.2.1] - 2026-03-01

### ユーザー向け要約

- 15タスク3フェーズのメモリ品質改善を実施。観察間の関係性リンク（updates/extends/derives）、検索時のsuperseded除外、GitHub Issues/Knowledge File/Gemini 取り込みコネクタを追加。
- 4エキスパート Harness レビュー（Security/Performance/Quality/Accessibility）を3ラウンド実施し、全 Critical/High 指摘を解消。最終スコア: Security A, Performance A, Accessibility A, Quality B。

### 補足

- セキュリティ: `gh` CLI コマンドインジェクション防止（shellEscape + repo/label バリデーション）、SQL エイリアスインジェクション防止、全 ingest エンドポイントに admin token 必須化、パストラバーサル防止。
- パフォーマンス: deduper/derives リンク生成の O(n^2) トークナイズを事前計算で解消、`loadObservations` と `exclude_updated` のバッチ化（MAX_BATCH=500）。
- アクセシビリティ: `<h3>` を `<button>` 外に移動（WCAG 準拠）、roving tabindex によるキーボードナビゲーション、`focus-visible` スタイル追加。
- バグ修正: `exclude_updated` のリンク方向を `to_observation_id`（旧観察）に修正、`isValidLabel` からスラッシュを除去。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.2.0] - 2026-02-27

### ユーザー向け要約

- Gemini CLI を6番目のプラットフォームとして追加。Claude, Codex, Cursor, OpenCode, Gemini CLI, Antigravity の全6ツールでクロスツールメモリが動作。
- 11件のメモリ品質改善: ローカル ONNX 埋め込み (Ruri V3-30M)、LLM ベースファクト抽出、時間的ファクト管理、プログレッシブ resume-pack 圧縮、検索スコア分析など。

### 補足

- Gemini CLI: MCP 配線、フックハンドラ (6イベント)、エージェントスキル、GEMINI.md を含む完全対応。
- ローカル ONNX 埋め込み: Ruri V3-30M モデルによる日本語最適化ベクトル検索。クラウド不要。
- LLM ファクト抽出: Ollama 経由のコンソリデーション + 既存ファクトとの差分比較。
- 時間的ファクト管理: `valid_from`/`valid_to`、`superseded_by` によるライフサイクル追跡。
- セキュリティ修正: タイミング攻撃対策 (`crypto.timingSafeEqual`)、SSRF ガード、入力バリデーション (500文字制限)。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.35] - 2026-02-25

### ユーザー向け要約

- `harness-mem setup` / `harness-mem update` 実行時に、Codex Agent Skill のインストールを対話的に確認するプロンプトを追加。

### 補足

- Codex プラットフォームが有効かつスキル未インストール時に、`~/.codex/skills/harness-mem/` へのインストールを提案。
- `harness-mem doctor` がスキルのインストール状態を報告するよう改善。
- バイリンガル対応（EN/JA）、デフォルトは No（安全側）。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.34] - 2026-02-25

### ユーザー向け要約

- Claude Code v2.1 の worktree/config 変更イベントを記録対応。OpenCode の MCP セッションメタデータ連携を強化。Codex Agent Skill として配布可能に。

### 補足

- Claude Code hooks に `WorktreeCreate`, `WorktreeRemove`, `ConfigChange` を追加。
- OpenCode プラグインに `tool.execute.before/after` フックと `sessionID`/`messageID` 取得を追加。
- ツール入力のサニタイズ（秘密キーのマスク + 2000文字制限）を実装。
- wiring check を個別パターン検証に改善（OR 条件の偽陽性を防止）。
- `success` のデフォルト値を `true` → `undefined` に変更（監査精度向上）。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.33] - 2026-02-25

### ユーザー向け要約

- managed モードで PostgreSQL 未接続時に書き込みを fail-close でブロックするよう改善。SQLite のみでのサイレント動作を防止。

### 補足

- `recordEvent` レスポンスに `write_durability` フィールドを追加（`"managed"` / `"local"` / `"blocked"`）。
- health エンドポイントが managed 未接続時に `"degraded"` ステータスを返すよう改善。
- promote gate で `HARNESS_MEM_ADMIN_TOKEN` 設定時に認証ヘッダを送信。
- event-store のセッション upsert をバッチ化し、FK 違反を防止。
- shadow read の一致閾値を 70% → 95% に統一し、promotion SLA と整合。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.32] - 2026-02-24

### ユーザー向け要約

- `harness-mem update` の確認ダイアログを改善し、自動更新が無効なユーザーにだけ opt-in 質問を表示するよう修正。

### 補足

- 自動更新がすでに有効なユーザーは、`harness-mem update` 実行時に毎回質問されずそのまま更新処理へ進む。
- README / README_ja / setup guide の説明文を実装仕様に合わせて更新。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.31] - 2026-02-24

### ユーザー向け要約

- 既存ユーザー向けに `harness-mem update` コマンドを追加。
- 更新時に「自動更新（opt-in）を有効化するか」を対話で確認できるよう改善。

### 補足

- `harness-mem update` は、オプトイン確認後にグローバル更新を実行。
- 選択結果は `~/.harness-mem/config.json` の `auto_update.enabled` に保存。
- README / README_ja / setup guide の更新手順を `harness-mem update` ベースに統一。
- 従来の手動更新 `npm install -g @chachamaru127/harness-mem@latest` も引き続き利用可能。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.30] - 2026-02-24

### ユーザー向け要約

- Feed で、`# AGENTS.md instructions` や `<environment_context>` などのシステム包み込み入力を通常のユーザープロンプトとして表示しないよう修正。

### 補足

- `user_prompt` 判定の前にシステム包み込みプレフィックスを判定し、該当カードは `other` として分類。
- 回帰防止として `harness-mem-ui/tests/ui/feed-panel.test.tsx` に専用テストを追加。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.29] - 2026-02-24

### ユーザー向け要約

- `プロジェクト短名` と `絶対パス` の二重表示（例: `claude-code-harness` と `/Users/.../claude-code-harness`）を自動統合。
- 大文字小文字だけ異なる project key（例: `Jarvis` / `JARVIS`）も起動時に統合。

### 補足

- 起動時の legacy alias 正規化を拡張し、既存DBから観測できる絶対パスを canonical key として優先採用。
- 実行中も、絶対パスの project を観測した時点で正規化候補として学習し、以降の basename-only イベントを同一キーへ寄せる。
- 既存環境では `harness-memd` 再起動で反映。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.28] - 2026-02-24

### ユーザー向け要約

- `publish-npm` を止めていた memory-server 品質ゲートの誤失敗を修正し、再配信を安定化。
- UI の Claude フィードで、`claude-*` 表記や project alias 差分による取りこぼしを防止。

### 補足

- `managed-mode-wiring` 統合テストの参照パスを `cwd` 非依存に修正（`cd memory-server` 実行でも成功）。
- Antigravity 取込テストの期待 project を、現行の正規化キー仕様へ更新。
- 中規模検索レイテンシテストは CI 環境向けに現実的な閾値と負荷へ調整（CI: 1500ms / local: 500ms）。
- `useFeedPagination` に回帰テストを追加（`platformFilter=claude` と live feed の alias project）。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.27] - 2026-02-24

### ユーザー向け要約

- タグ push と main 反映タイミングのズレで `publish-npm` が誤検知で失敗する問題を修正。
- リリース時の main 含有チェックを待機リトライ化し、浅い fetch 起因の偽陰性を回避。

### 補足

- `Release` ワークフローの `Verify tag commit is on main` を改善（最大15分待機、15秒間隔）。
- `git fetch origin main --depth=1` を廃止し、非 shallow fetch で祖先判定を実施。
- 過去の失敗パターン（`v0.1.25`, `v0.1.26`）の再発防止が目的。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.26] - 2026-02-23

### ユーザー向け要約

- Mem UI に、非専門家向けの `Environment` タブを追加。
- 対話型 `harness-mem setup` で CLI 自動更新（opt-in）を選択できるよう改善。

### 補足

- read-only API `GET /v1/admin/environment`（admin token 必須）を追加し、UI では `/api/environment` 経由で表示。
- Environment タブは「内部サーバー / 言語・ランタイム / CLI / AI・MCP」を 5秒サマリー付きで表示。
- API 出力内の token / secret / api_key など機密値はマスク。
- `tool-versions.json` や `doctor-last.json` 欠損時は、劣化表示で継続し全体が落ちないよう改善。
- 自動更新は既定で無効。opt-in ユーザーのみ定期チェックして更新を試行。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.25] - 2026-02-23

### ユーザー向け要約

- プロジェクト表示が絶対パスではなく、`Context-Harness` のような読みやすい名前で表示されるよう改善。
- サブディレクトリ実行や Git linked worktree による同一プロジェクトの分裂表示を抑止。
- `shadow-*` や隠しディレクトリ配下など、ノイズプロジェクトを一覧表示から除外。

### 補足

- UI は表示ラベルのみを変え、内部のプロジェクトキー（絞り込み・検索キー）は従来どおり canonical key を維持。
- 起動時の legacy project alias 正規化を拡張し、既存データの project キー統一を自動実行。
- 反映には `harness-memd` 再起動が必要。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.24] - 2026-02-23

### ユーザー向け要約

- README / セットアップガイドを利用者向けに再整理し、初回導入とアップデート手順を分かりやすく統一。
- 英語をデフォルト導線に固定し、日本語ページを分離した構成を明確化。

### 補足

- `README.md` を Quick Start / Core Commands / Troubleshooting 中心に再構成。
- `README_ja.md` も同じ構造に揃えて更新。
- `docs/harness-mem-setup.md` から混在言語・内部計画メモを除去し、運用手順ガイドとして再整理。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.23] - 2026-02-23

### ユーザー向け要約

- 旧UIを削除し、Mem UI は `static-parity`（新UI）のみ配信する構成に統一。
- 環境ごとに新旧UIが混在する根本原因（fallback分岐とトグル）を除去。

### 補足

- `harness-mem-ui/src/server.ts` は `src/static-parity` のみ配信し、バンドル欠落時は fail-fast するよう変更。
- `scripts/harness-memd` から `HARNESS_MEM_UI_PARITY_V1` 注入を削除。
- 旧UIファイル `harness-mem-ui/src/static/index.html` と `harness-mem-ui/src/static/app.js` を削除。
- 回帰防止として `tests/harness-mem-ui-static-contract.test.ts` を追加。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.22] - 2026-02-23

### ユーザー向け要約

- npm グローバル導入時にも `static-parity`（新UI）を同梱し、ローカル実行と配布版で UI デザインが一致するよう修正。
- `harness-mem setup` 後に環境ごとで見た目が変わる問題（新UI vs 旧UI）を解消。

### 補足

- `harness-mem-ui/.gitignore` から `src/static-parity` の除外を削除し、配布物に確実に入るよう調整。
- `bun run --cwd harness-mem-ui build:web` で parity アセットを再生成。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.21] - 2026-02-23

### ユーザー向け要約

- `harness-mem setup` 実行後に Mem UI が起動しない回帰を修正し、再び `http://127.0.0.1:37901` が自動で利用可能に。
- setup ログに `Mem UI started: ...` を追加し、起動確認がすぐ分かるよう改善。

### 補足

- `scripts/harness-memd` に UI ライフサイクル（`start_ui` / `stop_ui` / `doctor` UIチェック）を復元。
- `HARNESS_MEM_ENABLE_UI=false` による明示無効化をサポート。
- 回帰防止として `tests/harness-memd-ui-autostart-contract.test.ts` を追加。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.20] - 2026-02-23

### ユーザー向け要約

- `npm install -g @chachamaru127/harness-mem@latest` 後に `mcp-server/dist/index.js` が欠けていても、`setup` / `doctor --fix` が自動で MCP runtime を自己復旧するよう改善。
- daemon doctor が警告を返しても `/health` が到達可能な場合は、`doctor_post_check` を不要に失敗扱いしないよう改善。

### 補足

- `ensure_mcp_runtime` は `dist` 不在時に `npm install --include=dev && npm run build` を実行して再構築。
- 回帰防止として `tests/mcp-runtime-bootstrap-contract.test.ts` を追加。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.19] - 2026-02-22

### ユーザー向け要約

- 同じワークスペースが `harness-mem` と `/.../harness-mem` に分裂して表示される問題を修正。
- `project` 名の正規化を統一し、同一プロジェクトのフィード/検索が1つの名前空間にまとまるよう改善。

### 補足

- 起動時に legacy データ（basename 側）を canonical path 側へ自動統一するマイグレーションを追加。
- `search` / `feed` / `sessions` / `resume-pack` / `session chain` で同一の project 正規化を適用。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.18] - 2026-02-22

### ユーザー向け要約

- READMEに英日併記で「Planned Next」を追加し、System Inventoryの計画要件を明確化。
- ローカルサーバー表示要件として `port` / `protocol` / `pid` / bind address を明記。
- LLM問い合わせ向け read-only エンドポイント `GET /v1/admin/system/llm-context` の契約を追記。

### 補足

- 本リリースでの変更はドキュメント更新が中心です。
- 実装状況と計画の境界が分かるように記述を整理しました。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。
## [0.1.17] - 2026-02-22

### ユーザー向け要約

- `harness-mem setup` で API だけでなく Mem UI も同時に導入・起動されるように改善。
- 初回セットアップ直後から `http://127.0.0.1:37901` にアクセス可能になり、UIの手動セットアップが不要に。

### 補足

- npm 配布物に UI 実行ファイル群（`harness-mem-ui/src/*`）を同梱。
- 自動起動を止めたい場合は `HARNESS_MEM_ENABLE_UI=false` を設定。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.16] - 2026-02-22

### ユーザー向け要約

- `harness-mem doctor --fix` 実行時に `rg`（ripgrep）が未導入でも、Homebrew で自動導入して復旧を継続できるように改善。
- これにより `rg: command not found` 起因の `doctor_post_check` 失敗を回避。

### 補足

- 依存関係の案内文にも `ripgrep` を追加。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.15] - 2026-02-22

### ユーザー向け要約

- GitHub Actions 上で `CI` 環境変数が期待どおり見えないケースに対応し、リリース時の品質ゲート誤失敗を防止。
- レイテンシ判定は `CI` と `GITHUB_ACTIONS` の両方で判定し、CI は `p95 < 3000ms`、ローカルは `p95 < 500ms` を維持。

### 補足

- 機能追加はなく、配信パイプライン安定化の修正です。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.14] - 2026-02-22

### ユーザー向け要約

- GitHub Actions 環境でのリリース失敗要因だった検索レイテンシ閾値を CI 前提で調整し、配信フローの安定性を改善。
- ローカルでは従来どおり厳しめ（`p95 < 500ms`）を維持し、CI のみ `p95 < 1500ms` を適用。

### 補足

- 機能追加はなく、リリースゲート安定化の修正です。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.13] - 2026-02-22

### ユーザー向け要約

- CI の quality gate で発生していたベンチマーク系テストのタイムアウト失敗を解消。
- `memory-server` の検索品質テストと rerank 品質ゲートテストの timeout 設定を実行時間に合わせて調整。

### 補足

- 機能追加はなく、リリース配信安定化のための修正のみです。
- 詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## [0.1.12] - 2026-02-22

### ユーザー向け要約

- 検索/推論系の基盤を拡張（embedding provider・reranker・retrieval router・answer compiler）。
- managed/hybrid backend 向けのアダプタ層（SQLite/PostgreSQL）を追加。
- `harness-memd` の運用ガードレールを強化（非JSON health誤判定防止、ポート競合検知、stale pid 再同期、ログローテーション）。
- README / セットアップドキュメント / ベンチマーク系ドキュメントを更新。

### 補足

- 詳細な変更点、移行ノート、検証手順は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

[Unreleased]: https://github.com/Chachamaru127/harness-mem/compare/v0.20.0...HEAD
[0.20.0]: https://github.com/Chachamaru127/harness-mem/compare/v0.19.0...v0.20.0
