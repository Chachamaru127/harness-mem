# CHANGELOG_ja

日本語の変更履歴は要約のみを記載します。

- 公式の変更履歴（Source of Truth）: [CHANGELOG.md](./CHANGELOG.md)
- 最新のリリース内容と移行手順は英語版を参照してください。

## [Unreleased]

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
