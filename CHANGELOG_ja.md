# CHANGELOG_ja

日本語の変更履歴は要約のみを記載します。

- 公式の変更履歴（Source of Truth）: [CHANGELOG.md](./CHANGELOG.md)
- 最新のリリース内容と移行手順は英語版を参照してください。

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
