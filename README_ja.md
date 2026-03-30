# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-logo-official.jpg" alt="Harness-mem official logo" width="560" />
</p>

<p align="center"><strong>Claude Code と Codex のメモリを橋渡し。ローカル完結、ゼロコスト。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/v/@chachamaru127/harness-mem" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/dm/@chachamaru127/harness-mem" alt="npm downloads" /></a>
  <a href="https://github.com/Chachamaru127/harness-mem/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Chachamaru127/harness-mem/release.yml?label=release" alt="release workflow" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BUSL--1.1-0f766e" alt="license BUSL-1.1" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> | 日本語
</p>

Harness-mem は Claude Code と Codex のメモリを、共有されたローカルランタイム経由で橋渡しします。Claude Code で得た文脈を Codex で想起。完全ローカル、API キー不要です。

## なぜ harness-mem？

Claude 組み込みメモリは Claude の中でしか使えません。[claude-mem](https://github.com/thedotmack/claude-mem) は永続化を追加しますが Claude Code 専用です。[Mem0](https://github.com/mem0ai/mem0) はクロスアプリ対応ですがクラウド基盤と API 統合が必要です。

**harness-mem のアプローチ**: ローカルデーモン1つ、SQLite 1ファイル、Claude Code ↔ Codex の共有ランタイムと、対応 hook path 上の first-turn continuity。クラウド不要、Python不要、APIキー不要です。

| | harness-mem | Claude 組み込みメモリ | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **対応ツール** | Claude Code, Codex（Tier 1）· Cursor（Tier 2）· Gemini CLI, OpenCode（実験的） | Claude のみ | Claude のみ | API経由でカスタム統合 |
| **データ保管** | ローカル SQLite | Anthropic クラウド | ローカル SQLite + Chroma | クラウド（セルフホスト有料） |
| **クロスツール記憶共有** | 共有ローカルランタイム + 対応 hook path 上の first-turn continuity | 不可 | 不可 | アプリごとに手動接続 |
| **セットアップ** | `harness-mem setup`（1コマンド） | 組み込み | npm install + 設定編集 | SDK統合が必要 |
| **検索方式** | ハイブリッド（lexical + vector + recency + tag + graph） | 非公開 | FTS5 + Chroma vector | ベクター中心 |
| **外部依存** | Node.js + Bun | なし | Node.js + Python + uv + Chroma | Python + APIキー |
| **移行パス** | `import-claude-mem` → `verify` → `cutover` | — | — | — |
| **ワークスペース分離** | 厳格（symlink 解決済みパス） | グローバル | basename のみ | ユーザー / エージェント単位 |

### つまり、こういうことです

- **Claude Code と Codex を使っている** → harness-mem は両ツールに同じローカルメモリランタイムを渡します。対応 hook path が有効なら、初手は chain-first（いまの続き）が主役のまま、その下に `Also Recently in This Project` として周辺の最近文脈を短く出せます。
- **プライバシーを重視する** → すべて `~/.harness-mem/harness-mem.db` にローカル保存。クラウド通信ゼロ。API キー不要。
- **Cursor も使っている** → Tier 2 サポート: フックと MCP がそのまま動きます。Gemini CLI と OpenCode は実験的対応です。

### 現在の挙動

- Claude Code と Codex は、1つのローカルデーモンと 1つの SQLite DB を共有します。
- first-turn continuity は、Claude Code / Codex の対応 hook path が有効で、`harness-mem setup` と `harness-mem doctor` が green のときに使えます。
- この対応 hook path では、SessionStart artifact は hybrid です。最上段は常に chain-first continuity で、その下に distinct な最近作業がある場合だけ短い recent-project teaser を補助表示します。
- hook 配線やローカル runtime が stale の場合、検索や recall は動いていても、「新しいセッションを開いた瞬間に覚えている」体験は崩れます。
- 実験的 / maintenance tier のクライアントでも ingest/search はできますが、Claude Code / Codex と同じ parity までは現時点で主張しません。

### 現時点で保証しないこと

- どのクライアントでも、どんな fresh session でも完全自動で理解できること。
- hook 配線が壊れている環境や runtime 不整合下での parity。
- 長期運用で複数スレッドが混ざった project すべてでの perfect な chain selection。
- 毎回フルな project ダイジェストを出すこと。recent-project 部分はノイズを抑えるため数 bullet に制限します。

## 実測ベンチマーク

primary release gate、current Japanese companion、historical baseline は意図的に分けて管理しています。

### Primary release gate（`run-ci`, current latest）

Source:
- [`memory-server/src/benchmark/results/ci-run-manifest-latest.json`](memory-server/src/benchmark/results/ci-run-manifest-latest.json)
- [`docs/benchmarks/japanese-release-proof-bar.md`](docs/benchmarks/japanese-release-proof-bar.md)

Current latest run:
- generated_at: `2026-03-20T11:39:22.199Z`
- git_sha: `f3902d8`
- embedding: `multilingual-e5`

| 指標 | 値 |
|---|---:|
| LoCoMo F1 | 0.5861 |
| bilingual recall@10 | 0.9000 |
| freshness | 1.0000 |
| temporal | 0.6403 |
| search p95 | 10.26ms |
| token avg | 428.93 |

判定: `PASS`

補足:
- 3連続 PASS（2026-03-20）。Layer 1（Absolute Floor）+ Layer 2（Relative Regression）+ Japanese Companion すべて green。
- 過去の PASS run は historical evidence として保持し、現行の出荷判定とは分けて扱います。

### Japanese companion gate（`96 QA`, current claim source）

Source:
- [`docs/benchmarks/japanese-release-proof-bar.md`](docs/benchmarks/japanese-release-proof-bar.md)
- [`docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json`](docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json)
- [`docs/benchmarks/artifacts/s43-ja-release-v2-latest/run3/companion-gate.json`](docs/benchmarks/artifacts/s43-ja-release-v2-latest/run3/companion-gate.json)

| 指標 | 値 |
|---|---:|
| Overall F1 mean | 0.6580 |
| Cross-lingual F1 mean | 0.6850 |
| Zero-F1 count | 16 / 96 |
| 3-run span | 0.0000 |
| current slice F1 | 0.8171 |
| exact slice F1 | 0.5628 |
| why slice F1 | 0.9008 |
| list slice F1 | 0.7564 |
| temporal slice F1 | 0.6776 |

判定: `PASS as companion gate`

残る注意点:
- `current_vs_previous`, `relative_temporal`, `yes_no`, `entity`, `location` は watch slice のままです。
- この companion gate は README-safe な日本語訴求の根拠ですが、`run-ci` の代替ではありません。

### Historical baseline（`32 QA`, historical only）

Source:
- [`docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json`](docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json)
- [`docs/benchmarks/artifacts/s40-ja-baseline-latest/repro-report.json`](docs/benchmarks/artifacts/s40-ja-baseline-latest/repro-report.json)

| 指標 | 値 |
|---|---:|
| Overall F1 mean | 0.8020 |
| Cross-lingual F1 mean | 0.7563 |
| Zero-F1 count | 1 / 32 |
| 3-run span | 0.0000 |

この baseline は過去の proof bar が到達していた水準を示すもので、current claim source ではありません。

補足:
- 過去の Ruri V3 30M 比較実験は historical docs に残しています。
- 現在 README で使う正本は、上記 `multilingual-e5` の main gate と `s43-ja-release-v2-latest` の companion artifact です。

### 実測に使った日本語クエリ例

- `今、使っている CI は何ですか？`
- `email だけの運用をやめた理由は何ですか？`
- `Q2 に出した admin 向け機能をすべて挙げてください。`
- `最後に出た機能は何ですか？`

## クイックスタート

### A) Claude Code Plugin Marketplace（Claude Code を主に使う場合）

```text
/plugin marketplace add Chachamaru127/harness-mem
/plugin install harness-mem@chachamaru127
```

Claude 側の hooks と MCP は自動で配線されます。Codex や Cursor も使うなら、別途 `harness-mem setup --platform codex,cursor` を 1 回実行してください。Claude の次回セッション開始時に self-check hook から daemon が起動します。

### B) npx で実行（グローバルインストール不要）

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor,claude
```

### C) グローバルインストール

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup --platform codex,cursor,claude
```

### 既存インストールを更新

```bash
harness-mem update
```

`harness-mem update` 実行時は、自動更新が無効な場合のみ「harness-mem の自動更新（opt-in）を有効化しますか?」の確認が表示され、選択後にグローバル更新を実行します。更新成功後は、記憶している client platform に対して静かな `doctor --fix` も流し、stale wiring を自動修復します。
従来どおり `npm install -g @chachamaru127/harness-mem@latest` で手動更新も可能です。

### セットアップ確認

```bash
harness-mem doctor --platform codex,cursor,claude
harness-mem doctor --fix --platform codex,cursor,claude
```

Claude Code / Codex の first-turn continuity は、`doctor` が green で、`SessionStart` / `UserPromptSubmit` / `Stop` hooks が有効なときの挙動です。

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

## リリースの再現性

この repo をメンテナンスする立場では、release の品質が「skill を使ったか」「手でコマンドを打ったか」に依存しない状態が理想です。

- 普段の変更は、まず `CHANGELOG.md` の `## [Unreleased]` に積みます。
- 正本は `CHANGELOG.md` です。`CHANGELOG_ja.md` は日本語要約であり、別の release 契約ではありません。
- `harness-release` skill を使う場合でも、手動で release する場合でも、守るべき契約は同じです。`package.json` の version、CHANGELOG の versioned entry、git tag、GitHub Release、npm publish が同じ版を指している必要があります。
- 正式なメンテナ向けチェックリストは [`docs/release-process.md`](docs/release-process.md) にまとめています。
- `npm test` が内部でどう動くか、Bun panic をどう避けているかは [`docs/TESTING.md`](docs/TESTING.md) に書いてあります。
- 既知の Bun 終了時クラッシュを upstream に説明するときの再現メモは [`docs/bun-test-panic-repro.md`](docs/bun-test-panic-repro.md) を参照してください。

再現性のある release とは、少なくとも次がそろっている状態です。

1. 作業ツリーが clean である。
2. ユーザーに見える変更が `CHANGELOG.md` の `[Unreleased]` に先に書かれている。
3. 品質ゲートが green である。
4. `npm pack --dry-run` が通る。
5. git tag と `package.json` の version が一致している。
6. 公開後の npm version と GitHub Release が同じ版を指している。

## 対応ツール

| Tier | ツール | 動作確認バージョン | 補足 |
|---|---|---|---|
| **Tier 1** | Claude Code | v2.1.80 | フルフックライフサイクル（StopFailure含む18イベント）、MCP、プラグインマーケットプレイス、`--channels` push、`--inline-plugin` setup |
| **Tier 1** | Codex CLI | v0.116.0 | SessionStart + UserPromptSubmit + Stop hooks、MCP、memory citation、rules |
| **Tier 2** | Cursor | Latest | hooks.json + sandbox.json + MCP。メンテナンスのみ、新規投資なし |
| **Tier 3** | Gemini CLI | Latest | 実験的。コミュニティ貢献 |
| **Tier 3** | OpenCode | Latest | 実験的。コミュニティ貢献 |

## トラブルシューティング

### `harness-mem: command not found`

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### `doctor` で依存不足が出る

macOS では `bun` と `ripgrep` は setup 時に自動導入されます。その他の依存 (`node`, `curl`, `jq`) を入れてから再実行してください:

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

Business Source License 1.1 (SPDX: `BUSL-1.1`)。詳細は [`LICENSE`](LICENSE) を参照。

**許可**: 社内利用、個人利用、開発・テスト、OSS プロジェクト、自社アプリの一部としての組み込み。

**制限**: harness-mem をマネージドメモリサービスとして第三者に提供すること。

**2029-03-08** に自動的に **Apache License 2.0** に切り替わります。

**metadata note**: repository root は BUSL-1.1 です。一方で `sdk/`, `mcp-server/`, `vscode-extension/` など一部の配布用 subpackage は package-level の SPDX を個別に持っています。GitHub の repo header や API が `Other` / `NOASSERTION` と表示しても、正本は [`LICENSE`](LICENSE) と各 package の `package.json` です。
