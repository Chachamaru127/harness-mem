# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-logo-official.jpg" alt="Harness-mem official logo" width="560" />
</p>

<p align="center"><strong>Claude / Codex / Cursor / OpenCode / Gemini CLI で共通利用できるメモリランタイム。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/v/@chachamaru127/harness-mem" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/dm/@chachamaru127/harness-mem" alt="npm downloads" /></a>
  <a href="https://github.com/Chachamaru127/harness-mem/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Chachamaru127/harness-mem/release.yml?label=release" alt="release workflow" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Chachamaru127/harness-mem" alt="license" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> | 日本語
</p>

Harness-mem は、複数ツール間でメモリ挙動を統一するためのローカル実行ランタイムです。

## なぜ harness-mem？

Claude 組み込みメモリは Claude の中でしか使えません。[claude-mem](https://github.com/thedotmack/claude-mem) は永続化を追加しますが Claude Code 専用です。[Mem0](https://github.com/mem0ai/mem0) はクロスアプリ対応ですがクラウド基盤と API 統合が必要です。

**harness-mem のアプローチ**: ローカルデーモン1つ、SQLite 1ファイル、5つの対応ツールチェーン + 実験的 Antigravity — クラウド不要、Python不要、APIキー不要。

| | harness-mem | Claude 組み込みメモリ | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **対応ツール** | Claude, Codex, Cursor, OpenCode, Gemini CLI, Antigravity | Claude のみ | Claude のみ | API経由でカスタム統合 |
| **データ保管** | ローカル SQLite | Anthropic クラウド | ローカル SQLite + Chroma | クラウド（セルフホスト有料） |
| **クロスツール記憶共有** | 自動 — Claude で学習、Codex で想起 | 不可 | 不可 | アプリごとに手動接続 |
| **セットアップ** | `harness-mem setup`（1コマンド） | 組み込み | npm install + 設定編集 | SDK統合が必要 |
| **検索方式** | ハイブリッド（lexical + vector + recency + tag + graph） | 非公開 | FTS5 + Chroma vector | ベクター中心 |
| **外部依存** | Node.js + Bun | なし | Node.js + Python + uv + Chroma | Python + APIキー |
| **移行パス** | `import-claude-mem` → `verify` → `cutover` | — | — | — |
| **ワークスペース分離** | 厳格（symlink 解決済みパス） | グローバル | basename のみ | ユーザー / エージェント単位 |

### つまり、こういうことです

- **複数の AI ツールを使っている** → harness-mem は、Claude / Codex / Cursor / OpenCode / Gemini をまたいで記憶を共有するローカル指向の選択肢です。
- **プライバシーを重視する** → すべて `~/.harness-mem/harness-mem.db` にローカル保存。クラウド通信ゼロ。LLM 強化はオプション。
- **今 claude-mem を使っている** → 1コマンドで移行でき、ロールバックも可能。データ損失もダウンタイムもありません。

## 日本語対応（ベンチマーク検証済み）

harness-mem は日英バイリンガル対応です。日本語専用 embedding モデルと形態素解析による全文検索を搭載し、180 問の QA ベンチマークで品質を継続的に検証しています。

### 日本語対応の技術基盤

| 技術 | 詳細 |
|------|------|
| **Embedding モデル** | [Ruri V3 30M](https://huggingface.co/cl-nagoya/ruri-v3-30m) — 日本語特化 ONNX モデル（名古屋大学 cl-nagoya 研究室） |
| **全文検索** | `Intl.Segmenter` による日本語形態素解析 + FTS5（外部依存ゼロ） |
| **言語自動検出** | 日本語テキストを検出して Ruri を自動選択、英語は multilingual-e5 |

### 出荷判定ゲート（`run-ci` — Ruri V3 30M）

| 指標 | 値 |
|---|---:|
| LoCoMo F1 | 0.5481 |
| bilingual recall@10 | 0.8800 |
| freshness | 1.0000 |
| temporal | 0.6375 |
| cat-1 F1 | 0.5946 |
| search p95 | 10.74ms |

判定: **PASS**（3 層 CI ゲート全通過）

### Japanese Companion Gate（スライス別品質）

| スライス | F1 | 判定 |
|----------|---:|------|
| current（今の値） | 0.8171 | PASS（≥ 0.80） |
| exact（完全一致） | 0.5913 | PASS（≥ 0.55） |
| why（理由） | 0.9008 | PASS（≥ 0.85） |
| list（列挙） | 0.7564 | PASS（≥ 0.70） |
| temporal（時系列） | 0.5526 | PASS（≥ 0.50） |

### multilingual-e5 との比較

| 指標 | multilingual-e5 | Ruri V3 30M | 差分 |
|------|---:|---:|---:|
| F1 | 0.5333 | 0.5481 | **+1.48pp** |
| cat-1 F1 | 0.5801 | 0.5946 | **+1.45pp** |
| bilingual | 0.9000 | 0.8800 | -2.00pp |

### 実測に使った日本語クエリ例

- `今、使っている CI は何ですか？`
- `email だけの運用をやめた理由は何ですか？`
- `Q2 に出した admin 向け機能をすべて挙げてください。`
- `最後に出た機能は何ですか？`

## クイックスタート

### A) npx で実行（グローバルインストール不要）

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor,claude
```

### B) グローバルインストール

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup --platform codex,cursor,claude
```

### 既存インストールを更新

```bash
harness-mem update
```

`harness-mem update` 実行時は、自動更新が無効な場合のみ「harness-mem の自動更新（opt-in）を有効化しますか?」の確認が表示され、選択後にグローバル更新を実行します。
従来どおり `npm install -g @chachamaru127/harness-mem@latest` で手動更新も可能です。

### セットアップ確認

```bash
harness-mem doctor --platform codex,cursor,claude
harness-mem doctor --fix --platform codex,cursor,claude
```

### Mem UI を開く

```bash
open 'http://127.0.0.1:37901'
```

### Environment タブ（非専門家向け）

Mem UI の `Environment` タブでは、次を1画面で確認できます。

1. 現在動作中の内部サーバー
2. インストール済みの言語 / ランタイム
3. CLI ツール
4. AI / MCP ツールの配線状態

V1 は read-only（閲覧専用）で、機密値は表示前にマスクされます。

## 主なコマンド

| コマンド | 用途 |
|---|---|
| `setup` | ツール配線を自動設定し、daemon + Mem UI を起動 |
| `doctor` | 配線/稼働状態を検査し、`--fix` で修復 |
| `versions` | 各ツールの local / upstream バージョン差分を記録 |
| `update` | グローバル更新を実行（自動更新が無効な場合のみ opt-in を確認） |
| `smoke` | プライバシーと検索品質の最小 E2E 検証 |
| `uninstall` | 配線解除と必要時の DB 削除（`--purge-db`） |
| `import-claude-mem` + `verify-import` + `cutover-claude-mem` | Claude-mem からの安全移行 |

## 対応ツール

| ツール | 状態 | 補足 |
|---|---|---|
| Codex | Supported | 設定配線、取り込み、doctor チェック |
| OpenCode | Supported | グローバル配線 + 設定修復 |
| Cursor | Supported | グローバル hooks + MCP 配線 + doctor |
| Claude workflows | Supported | `~/.claude.json` MCP 配線 + 移行/cutover |
| Antigravity | Experimental | 既定では無効、明示有効化で利用 |

## トラブルシューティング

### `harness-mem: command not found`

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### `doctor` で依存不足が出る

`bun`, `node`, `curl`, `jq`, `ripgrep` をインストールして再実行:

```bash
harness-mem doctor --fix
```

### 完全リセットしたい

```bash
harness-mem uninstall --purge-db
```

### ワークスペースが `harness-mem` と絶対パスに分断される

```bash
harness-memd restart
```

## Plans.md ワークフロー

harness-mem ではタスク管理の正本として `Plans.md` を使用します。

### Phase マーカー

| マーカー | 意味 |
|---|---|
| `cc:TODO` | 未着手 |
| `cc:WIP` | 作業中 |
| `cc:完了` | 完了 |
| `blocked` | ブロック（理由を記載） |

### 着手時

Plans.md のマーカーを `cc:TODO` → `cc:WIP` に変更してから作業を開始します。各 Phase 内のタスクは並列実行が可能です。

### 完了時

マーカーを `cc:完了` に変更し、未解決の課題があれば記載します。

## ドキュメント

- セットアップ詳細: `docs/harness-mem-setup.md`
- Environment API 契約: `docs/plans/environment-tab-v1-contract.md`
- 変更履歴（英語・正本）: `CHANGELOG.md`
- 変更履歴（日本語要約）: `CHANGELOG_ja.md`
- 英語 README（デフォルト）: `README.md`
- ベンチマーク手順書: `docs/benchmarks/`

## 公式マスコット

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-mascot-official.jpg" alt="Harness-mem official mascot" width="360" />
</p>

## ライセンス

Business Source License 1.1 (BSL). 詳細は [`LICENSE`](LICENSE) を参照。

**許可**: 社内利用、個人利用、開発・テスト、OSS プロジェクト、自社アプリの一部としての組み込み。

**制限**: harness-mem をマネージドメモリサービスとして第三者に提供すること。

**2029-03-08** に自動的に **Apache License 2.0** に切り替わります。
