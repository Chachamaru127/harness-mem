# CHANGELOG_ja

日本語の変更履歴は要約のみを記載します。

- 公式の変更履歴（Source of Truth）: [CHANGELOG.md](./CHANGELOG.md)
- 最新のリリース内容と移行手順は英語版を参照してください。

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
