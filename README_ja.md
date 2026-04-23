# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/readme/hero.png" alt="Harness-mem — Claude Code と Codex で共有する1つのローカルメモリ" width="820" />
</p>

<p align="center"><strong>プロジェクトごとに、1つの記憶。すべての AI コーディングエージェントで。</strong></p>

<p align="center">
  Claude Code にも、Codex にも、Cursor にも、昨日の作業を説明し直さなくていい。harness-mem は<em>プロジェクト単位で</em> 1 つのローカル SQLite を、あなたが使うすべての AI コーディングエージェントに共有します。コールドスタート ~5ms。クラウドゼロ、API キーゼロ。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/v/@chachamaru127/harness-mem" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/dm/@chachamaru127/harness-mem" alt="npm downloads" /></a>
  <a href="https://github.com/Chachamaru127/harness-mem/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Chachamaru127/harness-mem/release.yml?label=release" alt="release workflow" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-0f766e" alt="platforms" />
  <img src="https://img.shields.io/badge/MCP%20cold%20start-~5ms-orange" alt="MCP cold start" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BUSL--1.1-0f766e" alt="license BUSL-1.1" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> | 日本語
</p>

<p align="center">
  <img src="docs/assets/readme/continuity-briefing-flow.svg" alt="continuity briefing の流れ — ローカルのプロジェクト記憶が次のセッションの初手に入る" width="820" />
</p>

---

## 目次

- [何が変わるのか](#何が変わるのか)
- [実測値](#実測値)
- [インストール](#インストール)
- [しくみ](#しくみ)
- [他ツールとの比較](#他ツールとの比較)
- [Adaptive Retrieval Engine](#adaptive-retrieval-engine)
- [実測ベンチマーク](#実測ベンチマーク) — full release gate
- [主なコマンド](#主なコマンド)
- [対応ツール](#対応ツール)
- [デュアルエージェント協調](#デュアルエージェント協調)
- [トラブルシューティング](#トラブルシューティング)
- [リリースの再現性](#リリースの再現性)
- [ドキュメント](#ドキュメント)
- [ライセンス](#ライセンス)

---

## 何が変わるのか

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/readme/before-after.png" alt="harness-mem の Before / After — 月曜 Claude Code の文脈が火曜の Codex に自動で引き継がれる" width="820" />
</p>

### 30秒版

harness-mem は、Claude Code と Codex に同じローカルのプロジェクト記憶を渡します。次のセッションは空白から始まらず、いま続けている話題の上から始められます。
同じプロジェクト内でツールをまたぎながら作業する人向けの設計です。

### 3分で試す流れ

1. `npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude` を実行する
2. `npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform codex,claude` で確認する
3. 両方の client が green で、現在の checkout または install path を指していることを確認する
4. Claude Code か Codex の新しいセッションを開き、最初のターンに今の話題が戻ってくるかを見る

### 信頼ブロック

- **ローカルファースト**: データベースは `~/.harness-mem/harness-mem.db` にあります。
- **プライバシー**: 記憶のためだけにクラウドへ送る仕組みはなく、API キーも要りません。
- **プライベートタグ**: テキストを `<private>...</private>` で囲むと、保存前に自動的に除去されます。メモリ全体を無効にせずに秘密情報だけを記憶から守れます。
- **プロジェクト分離**: 各プロジェクトは別の記憶棚に入るので、別リポジトリの内容が混ざりません。

### サポートの強さ

- **最も強い経路: Claude Code + Codex**: ここが主戦場です。共有ローカルランタイム、first-turn continuity、setup / doctor の導線まで含めて最優先で整えています。
- **対応済み経路: Cursor**: hooks と MCP はそのまま使えます。ただし continuity の主役は Claude Code + Codex です。
- **実験的経路: Gemini CLI, OpenCode**: 動きますが、同じ品質保証までは置いていません。

### つまり、こういうことです

- **Claude Code と Codex を両方使っている** → harness-mem は両方に同じローカルのプロジェクトランタイムを渡します。対応 hook path が有効なら、初手は chain-first（いまの続き）が主役のまま、その下に `Also Recently in This Project` として周辺の最近文脈を短く出せます。
- **プライバシーを重視する** → すべて `~/.harness-mem/harness-mem.db` にローカル保存。クラウド通信ゼロ。API キー不要。
- **Cursor も使っている** → hooks と MCP はそのまま動きますが、主軸は Claude Code + Codex です。

---

## 実測値

以下の数値はすべて、リポジトリに commit 済みの artifact から再実行できるものです。マーケティングのフカしは含みません。

| 指標 | 値 | 計測元 |
|---|---|---|
| **MCP コールドスタート** | ~5ms（中央値、n=10） | [bench JSON](docs/benchmarks/go-mcp-bench/) · `scripts/bench-go-mcp.sh` |
| **Go バイナリ** | 7.04MB stripped · 4 プラットフォーム | macOS arm64/amd64 · Linux amd64 · Windows amd64 |
| **メモリ使用量（RSS）** | ~13MB（`initialize` + `tools/list` 後） | bench JSON、Apple M1 実測 |
| **LoCoMo F1** | 0.5917（120 QA · 3-run PASS） | [run-ci manifest](memory-server/src/benchmark/results/ci-run-manifest-latest.json) |
| **Search p95** | 13.28ms | 同 manifest |
| **Bilingual recall@10** | 0.8800 | 同 manifest |

Go MCP サーバーは Claude Code / Codex が実際に通信する層です。Go バイナリが無ければ wrapper script が透過的に Node.js 版にフォールバックします。機能は全部使えて、コールドスタートだけ Node.js 相当になります。

### この数値がユーザーにとって何を意味するか

- **~5ms コールドスタート** は、記憶レイヤーが体感的に待たせないことを意味します。
- **Bilingual recall@10** は、日本語・英語・コードが混ざっていても、情報を探し直しやすいことを意味します。
- **Freshness@K = 1.00** は、更新済みの事実が古いメモに負けにくいことを意味します。
- **Developer-workflow recall** は、昨日の migration、バグ修正、デプロイ判断をもう一度すぐ引けることが価値だという意味です。

### harness-mem の target domain は "developer workflow memory"

メモリ系ベンチは大きく 2 つのドメインに分かれます:

- **一般会話メモリ（general lifelog）** — 架空の人物の日常の記憶を問う（「Caroline はいつ LGBTQ サポートグループに行った？」）。LoCoMo / LongMemEval / Mem0 / MemPalace / SuperMemory が主にこちら。
- **Developer workflow memory** — 昨日の race fix、技術スタックの決定、やりかけの migration、deploy 手順。harness-mem が実際に担う領域。

**harness-mem が実際に戦う場所**

harness-mem のリリースゲートは `ci-run-manifest-latest.json` の developer-workflow domain にあります:

| 指標 | 現状 | 目標（main gate） | 何を測っている |
|---|---:|---:|---|
| `dev-workflow` recall@10 | 0.59 | ≥ 0.70 | 開発者的なファイル / 判断ジャンプのクエリ |
| `bilingual` recall@10 | **0.88** | ≥ 0.90 | 日本語 / 英語 / コード混在の検索 |
| `knowledge-update` freshness@K | **1.00** | ≥ 0.95 ✓ | 情報が更新された時に古い事実を外せるか |
| `temporal` ordering score | 0.65 | ≥ 0.70 | 「X の後に Y があったか？」的な時系列推論 |

general-lifelog 系のベンチ (LoCoMo / LongMemEval 等) の比較は、それぞれの競合自身が公開している数値を各社サイトで参照してください。harness-mem はそちらの domain を target にしていません。

general-lifelog 競合の公開数値については、機械可読な監査証跡として [`docs/benchmarks/competitors-2026-04.json`](docs/benchmarks/competitors-2026-04.json) に出典リンク付きで保管しています。

商用-safe な external benchmark では、最初の対象を `τ³-bench` と `SWE-bench Pro` に絞り、`NoLiMa` は commercial use 不可のため research-only に分離しています。

完全な benchmark gate（main ship gate + 日本語 companion + 歴史 baseline）は [実測ベンチマーク](#実測ベンチマーク) セクションに残してあります。

---

## インストール

自分の使い方に合う行を 1 つ選ぶだけです。

| 使う道具 | 実行コマンド |
|---|---|
| **Claude Code のみ** | `/plugin marketplace add Chachamaru127/harness-mem` → `/plugin install harness-mem@chachamaru127` |
| **Claude Code + Codex**（初回推奨） | `npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude` → `npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform codex,claude` |
| **Claude Code + Codex**（常用 CLI を残したい） | `npm install -g @chachamaru127/harness-mem` → `harness-mem setup --platform codex,claude` → `harness-mem doctor --platform codex,claude` |

### `harness-mem setup` について

`harness-mem setup` は **対話式** です。どのツールを配線するか聞いてくれます:

```
[harness-mem] setup 対象を選択してください（複数可）
  1) codex        (global: ~/.codex/config.toml)
  2) cursor       (global: ~/.cursor/hooks.json + ~/.cursor/mcp.json)
  3) opencode     (global: ~/.config/opencode/opencode.json)
  4) claude       (global: ~/.claude.json mcpServers)
  5) antigravity  (experimental workspace scanning)
  6) gemini       (global: ~/.gemini/settings.json)
  a) all
入力例: 1,2   (Enter=1,2)
```

`--platform` フラグは不要です。CI やスクリプトから非対話で流したいときだけ `--platform codex,claude,cursor` のように渡せます。

### 動作確認

```bash
harness-mem doctor
```

全部 green なら準備完了。何かおかしければ:

```bash
harness-mem doctor --fix
```

`doctor` が green で、`SessionStart` / `UserPromptSubmit` / `Stop` のフックが生きていることが、Claude Code / Codex の first-turn continuity を成立させるランタイム契約です。

### アップデート

```bash
harness-mem update
```

auto-update がまだ無効なときだけオプトインを尋ね、その後 global パッケージを更新します。アップデート成功後、記憶している client platform に対して静かに `doctor --fix` を走らせるので、古い配線が自己修復されます。

<details>
<summary><strong>Windows（Git Bash / WSL2）</strong></summary>

Windows では次の経路があります:

1. **Claude plugin ルート**: Windows 上の Claude Code ユーザー向けにはこれが最短です。
2. **Git Bash + global install**: `setup` / `doctor` を手動で叩きたいときの native ルート。
3. **MCP-only ルート**: Claude / Codex の MCP 配線だけでよければ:

```bash
harness-mem mcp-config --write --client claude,codex
```

4. **WSL2**: フルライフサイクルで最も安定するのはここ。

Git Bash ルートを使う場合、以下が Windows 側の前提条件になります:

- `node` と `npm`
- `curl`
- `jq`
- `bun`
- `rg`（`ripgrep`）

現時点の検証状況:

- Windows 上の Claude Code: Git Bash で検証済み
- Windows 上の Codex: Git Bash ルートで `setup --platform codex`, `doctor --platform codex`, exact hook commands, notify, MCP connection を検証済み
- Windows 上の `mcp-config`: MCP-only 更新は可能。ただし Codex の hook lifecycle までは検証対象外です。

</details>

<details>
<summary><strong>リポジトリ直下で動かす（コントリビューター向け）</strong></summary>

repo から Codex 専用の再現可能な bootstrap だけ試したい場合:

```bash
bash scripts/setup-codex-memory.sh
npm run codex:doctor
```

`setup` は `~/.harness-mem`, `~/.codex`, `~/.claude*`, `~/.cursor` などユーザー領域の設定を書き換えます。root で実行すると所有権が壊れてしまうので `sudo` はつけないでください。

Codex については `~/.codex/config.toml` と `~/.codex/hooks.json` が鍵になります。`doctor` はこれらが「現在の harness-mem checkout」をちゃんと指しているかを確認します。昔の絶対パスに取り残されている状態も検知します。

</details>

---

## しくみ

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/readme/architecture.png" alt="harness-mem のアーキテクチャ — 1 デーモン、1 SQLite、2 ツール" width="820" />
</p>

- **デーモンは 1 つ** (`harness-memd`)。`localhost:37888` で待受けする Go MCP サーバーで、Claude Code と Codex はここに stdio で話しかけます。
- **ローカル SQLite データベースも 1 つ**。`~/.harness-mem/harness-mem.db` にすべての observation、session thread、embedding、fact chain が入ります。
- **hook path は 3 つ**。`SessionStart`（first-turn continuity）、`UserPromptSubmit`（contextual recall）、`Stop`（session finalization）。
- **memory server は TypeScript のまま**。embedding、hybrid search、rerank、日本語 / 英語 / code の adaptive ルーティングはここで走ります。ML スタックが TS 側にあるので、意図的に Go 化していません。Go 層は MCP の front desk 役に特化しています。

大きい MCP 検索結果は `structuredContent` でも返します。つまり最新の Claude / Codex は長い JSON 文字列だけでなく、構造付きの結果としても扱えます。

### 現在の挙動

- Claude Code と Codex は、1つのローカルデーモンと 1つの SQLite DB を共有します。
- first-turn continuity は、Claude Code / Codex の対応 hook path が有効で、`harness-mem setup` と `harness-mem doctor` が green のときに使えます。
- この対応 hook path では、SessionStart artifact は hybrid です。最上段は常に chain-first continuity で、その下に distinct な最近作業がある場合だけ短い recent-project teaser を補助表示します。
- hook 配線やローカル runtime が stale の場合、検索や recall は動いていても「新しいセッションを開いた瞬間に覚えている」体験は崩れます。
- 実験的 / maintenance tier のクライアントでも ingest/search はできますが、Claude Code / Codex と同じ parity までは現時点で主張しません。

### 現時点で保証しないこと

- どのクライアントでも、どんな fresh session でも完全自動で理解できること。
- hook 配線が壊れている環境や runtime 不整合下での parity。
- 長期運用で複数スレッドが混ざった project すべてでの perfect な chain selection。
- 毎回フルな project ダイジェストを出すこと。recent-project 部分はノイズを抑えるため数 bullet に制限します。

---

## 他ツールとの比較

Claude 組み込みメモリは Claude の中でしか使えません。[claude-mem](https://github.com/thedotmack/claude-mem) は永続化を追加しますが Claude Code 専用です。[Mem0](https://github.com/mem0ai/mem0) はクロスアプリ対応ですがクラウド基盤と API 統合が必要です。harness-mem のアプローチは別の方向です: プロジェクトごとに分離されたローカルランタイム、1つの SQLite ファイル、Claude Code ↔ Codex の first-turn continuity、クラウド依存なし。

| | harness-mem | Claude 組み込みメモリ | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **ドメイン** | developer-workflow | generic-agent | generic-agent | general-lifelog |
| **Claude Code + Codex の両方で使える** | ✓ | — | — | アプリごとに手動配線 |
| **ローカル完結、クラウド不要** | ✓ | — | ✓ | クラウド / 有料セルフホスト |
| **セットアップ** | 1コマンド（`setup`） | 組み込み | npm install + 設定編集 | SDK 統合が必要 |
| **MCP コールドスタート** | **~5ms**（Go バイナリ） | — | — | — |
| **費用** | 無料 | Claude プランに含まれる | 無料 | 99ドル/月〜（クラウド） |

> **ドメインについて:** `developer-workflow` = コーディングセッションの記憶（harness-mem のターゲット）。`general-lifelog` = 架空の日常会話の記憶（LoCoMo / LongMemEval の領域）。`generic-agent` = 特定ドメインに特化しない汎用エージェントメモリ。LoCoMo スコアは `general-lifelog` の性能を示しており、developer-workflow ツールとの直接比較にはなりません。

<details>
<summary>全項目の比較表</summary>

| | harness-mem | Claude 組み込みメモリ | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **ドメイン** | developer-workflow | generic-agent | generic-agent | general-lifelog |
| **対応ツール** | Claude Code, Codex（Tier 1）· Cursor（Tier 2）· Gemini CLI, OpenCode（実験的） | Claude のみ | Claude のみ | API経由でカスタム統合 |
| **データ保管** | ローカル SQLite | Anthropic クラウド | ローカル SQLite + Chroma | クラウド（セルフホスト有料） |
| **クロスツール記憶共有** | プロジェクト分離された共有ローカルランタイム + 対応 hook path 上の first-turn continuity | 不可 | 不可 | アプリごとに手動接続 |
| **セットアップ** | `harness-mem setup`（1コマンド） | 組み込み | npm install + 設定編集 | SDK統合が必要 |
| **検索方式** | ハイブリッド（lexical + vector + nugget + recency + tag + graph + fact chain） | 非公開 | FTS5 + Chroma vector | ベクター中心 |
| **MCP サーバー起動** | ~5ms 中央値（Go バイナリ、実測） | — | — | — |
| **外部依存** | Node.js + Bun（Go バイナリは自動ダウンロード） | なし | Node.js + Python + uv + Chroma | Python + APIキー |
| **移行パス** | `import-claude-mem` → `verify` → `cutover` | — | — | — |
| **ワークスペース分離** | 厳格（symlink 解決済みパス） | グローバル | basename のみ | ユーザー / エージェント単位 |

> **ドメインについて:** `developer-workflow` = コーディングセッションの記憶（harness-mem のターゲット）。`general-lifelog` = 架空の日常会話の記憶（LoCoMo / LongMemEval の領域）。`generic-agent` = 特定ドメインに特化しない汎用エージェントメモリ。LoCoMo スコアは `general-lifelog` の性能を示しており、developer-workflow ツールとの直接比較にはなりません。

</details>

---

## Adaptive Retrieval Engine

`adaptive` は、日本語・英語・コードが混ざる現場向けの埋め込みモードです。

やることはシンプルです。

- Route A: 日本語が多い検索は、日本語向けモデルを使います。
- Route B: 英語やコードが多い検索は、汎用モデルを使います。
- Route C: 日本語と英語が混ざる検索は、両方で検索して結果を合成します。
- さらに query expansion（検索語の言い換え展開）で、`本番反映` と `deploy` のような言い換えも少数だけ自動で補います。

なぜ必要か:

- 1つのモデルだけだと、日本語の細かい言い回しと英語の API 名・ログ・コード記述を同時にうまく扱いにくいからです。
- `adaptive` なら、検索のたびに「どの経路が向いているか」を見て、より合うモデルへ自動で振り分けられます。

Free 経路と Pro 経路:

- Free 経路: ローカル日本語モデル + ローカルまたは fallback の汎用経路。外部 API は不要です。
- Pro 経路: `HARNESS_MEM_PRO_API_KEY` と `HARNESS_MEM_PRO_API_URL` を設定すると、汎用側をリモート API で強化できます。
- Pro 経路が落ちた場合でも、harness-mem は自動で Free 経路へ切り替え、しばらく待ってから再試行します。つまり「止まる」のではなく「精度を少し落として継続する」設計です。

最小設定例:

```bash
export HARNESS_MEM_EMBEDDING_PROVIDER=adaptive
export HARNESS_MEM_ADAPTIVE_JA_THRESHOLD=0.85
export HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD=0.50

# 任意: Pro 経路を有効化
export HARNESS_MEM_PRO_API_KEY=your-token
export HARNESS_MEM_PRO_API_URL=https://example.com/embeddings
```

便利コマンド:

```bash
npm run benchmark
npm run benchmark:tune-adaptive
```

さらに詳しく:

- [`docs/adaptive-retrieval.md`](docs/adaptive-retrieval.md)
- [`docs/pro-api-data-policy.md`](docs/pro-api-data-policy.md)
- [`docs/environment-variables.md`](docs/environment-variables.md)

---

## 実測ベンチマーク

main の release gate、現行の日本語 companion、歴史 baseline を明確に分けて扱います。

### main release gate（`run-ci`、最新）

出典:
- [`memory-server/src/benchmark/results/ci-run-manifest-latest.json`](memory-server/src/benchmark/results/ci-run-manifest-latest.json)
- [`docs/benchmarks/japanese-release-proof-bar.md`](docs/benchmarks/japanese-release-proof-bar.md)

最新 run:
- generated_at: `2026-04-10T08:10:51.561Z`
- git_sha: `512f027`
- embedding: `onnx`

| 指標 | 値 |
|---|---:|
| LoCoMo F1 | 0.5917 |
| bilingual recall@10 | 0.8800 |
| freshness | 1.0000 |
| temporal | 0.6458 |
| search p95 | 13.28ms |
| token avg | 427.75 |

判定: `PASS`

補足:
- 最新の onnx run は現行 release gate を通過しています。
- Japanese companion は別の artifact-backed evidence として保持し、`run-ci` の代替ではなく補助証跡として扱います。

### Japanese companion gate（`96 QA`, current claim source）

出典:
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

残っているリスクとして、`current_vs_previous`, `relative_temporal`, `yes_no`, `entity`, `location` は watch スライスです。この companion gate は README に書ける日本語主張を支えますが、`run-ci` を置き換えるものではありません。

### 歴史 baseline（`32 QA`, historical only）

出典:
- [`docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json`](docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json)
- [`docs/benchmarks/artifacts/s40-ja-baseline-latest/repro-report.json`](docs/benchmarks/artifacts/s40-ja-baseline-latest/repro-report.json)

| 指標 | 値 |
|---|---:|
| Overall F1 mean | 0.8020 |
| Cross-lingual F1 mean | 0.7563 |
| Zero-F1 count | 1 / 32 |
| 3-run span | 0.0000 |

これは以前 README の proof bar が参照していた数字です。**現行の日本語主張の出典ではありません**。歴史的な位置付けとして残しています。

サポートする主張:
- EN↔JA の cross-lingual retrieval がベンチ済みであること。
- 日本語の short-answer 品質が release pack で計測されていること。
- `why`, `current`, `list`, `temporal` が artifact-backed slice report で計測されていること。

主張しないこと:
- native レベルの日本語品質
- 完璧な日本語の temporal reasoning
- `run-ci` ship gate の置き換え

### 日本語サンプルクエリ

- `今、使っている CI は何ですか？`
- `email だけの運用をやめた理由は何ですか？`
- `Q2 に出した admin 向け機能をすべて挙げてください。`
- `最後に出た機能は何ですか？`

---

## 主なコマンド

| コマンド | 目的 |
|---|---|
| `setup` | ツール配線とデーモン + Mem UI の起動（デフォルトで対話式） |
| `doctor` | 配線とヘルスを検証。`--fix` で自動修復 |
| `recall` | contextual recall モード切替（`on`, `quiet`, `off`, `status`） |
| `versions` | ローカルと upstream のツールバージョンをスナップショット |
| `update` | global パッケージを更新。auto-update がオフのときだけ opt-in を尋ねる |
| `smoke` | 独立したプライバシー / 検索の sanity check |
| `uninstall` | 配線削除。オプションで `--purge-db` |
| `import-claude-mem` + `verify-import` + `cutover-claude-mem` | claude-mem からの安全な移行 |

### Contextual recall（"Banto モード"）

`UserPromptSubmit` は、プロンプトがファイルパスへのジャンプ、エラー調査、判断の節目っぽく見えたときに、短い記憶の"耳打ち"を差し込めます。

```bash
harness-mem recall status
harness-mem recall quiet
harness-mem recall on
harness-mem recall off
```

- `quiet` がデフォルト。reranker があれば高い閾値、無ければ最上位 1 件だけという保守的な設定です。
- `on` はより積極的: 閾値を下げ、reranker が無いときも fallback で最大 3 件出します。
- `off` は contextual recall だけを無効化します。通常の検索と SessionStart continuity は動いたままです。
- 1 prompt あたりの recall 予算は `HARNESS_MEM_WHISPER_MAX_TOKENS` で制御できます。詳細は [`docs/environment-variables.md`](docs/environment-variables.md)。

### `/harness-recall` Skill（Claude Code 向け、v0.15.0 以降）

Claude Code ユーザー向けに、「思い出して」「覚えてる」「前回」「続き」「直近」「最後に」「先ほど」「さっき」「resume」「recall」等の自然な発話で自動発火する Skill を同梱しました。ユーザー側の設定は不要です（`scripts/userprompt-inject-policy.sh` が `RECALL_KEYWORDS` を検知して毎 `UserPromptSubmit` で Skill invoke を促します）。

意図ごとに適切な記憶経路へ自動 routing します:

- 続き / resume → `harness_mem_resume_pack`
- 決定 / 方針 → `.claude/memory/decisions.md` + `patterns.md`（SSOT）
- 前に踏んだ同じ問題 → `harness_cb_recall`
- 直近 session 一覧 → `harness_mem_sessions_list`
- 特定キーワード → `harness_mem_search`

出力は必ず `source:` 行から始まるため、情報の鮮度を判断できます（auto-memory は point-in-time と明記、現役の決定は SSOT 優先）。

上の "Banto モード" とは直交します: Banto は毎プロンプトで短い "耳打ち" を出す advisory、`/harness-recall` は recall 意図が明確なときだけ動く directed query です。

### Mem UI

```bash
open 'http://127.0.0.1:37901'
```

Mem UI の `Environment` タブでは、動いている内部サーバー、インストール済みの言語 / ランタイム、CLI ツール、AI / MCP の配線状態を確認できます。V1 では read-only で、センシティブな値は表示前にマスクされます。

---

## 対応ツール

| ティア | ツール | 検証バージョン | 備考 |
|---|---|---|---|
| **Tier 1** | Claude Code | v2.1.80 | フル hook lifecycle（18 イベント、StopFailure 含む）、MCP、plugin marketplace、`--channels` push、`--inline-plugin` setup |
| **Tier 1** | Codex CLI | v0.116.0+ | SessionStart + UserPromptSubmit + Stop フック、MCP、memory citation、structured MCP result、rules |
| **Tier 2** | Cursor | 最新 | hooks.json + sandbox.json + MCP。メンテナンス投資のみ |
| **Tier 3** | Gemini CLI | 最新 | 実験的。コミュニティ貢献 |
| **Tier 3** | OpenCode | 最新 | 実験的。コミュニティ貢献 |

---

## デュアルエージェント協調

Claude Code と Codex CLI を同じリポジトリで同時に走らせても、両者は
`harness-mem` 経由で同じメモリを共有し、2 つの協調プリミティブで衝突を防ぎます。

**Lease** — ファイル／アクション／任意のキーに対して TTL 付きの排他クレームを取得します。
2 つ目の agent が同じ target を claim しようとすると `already_leased` と共に
現在の保持者と有効期限が返ります。

**Signal** — 1:1 またはブロードキャストのメッセージング。未 ack の signal のみ
`_read` で戻り、`reply_to` で会話がスレッド化されます。TTL で古い signal は自動失効します。

```jsonc
// Claude が auth.ts をリファクタする前に lease を取得
{ "tool": "harness_mem_lease_acquire",
  "args": { "target": "file:/src/auth.ts", "agent_id": "claude-1", "ttl_ms": 600000 } }
// Codex が競合を検知して別作業へ切替
{ "tool": "harness_mem_lease_acquire",
  "args": { "target": "file:/src/auth.ts", "agent_id": "codex-1" } }
// → { "ok": false, "error": "already_leased", "heldBy": "claude-1", "expiresAt": "..." }

// Claude が Codex に完了を通知
{ "tool": "harness_mem_signal_send",
  "args": { "from": "claude-1", "to": "codex-1", "content": "auth.ts refactor ready for review" } }
// Codex が次ターン冒頭で未読を取得
{ "tool": "harness_mem_signal_read",  "args": { "agent_id": "codex-1" } }
// → [{ signal_id, from: "claude-1", content: "auth.ts refactor ready for review", ... }]
{ "tool": "harness_mem_signal_ack",  "args": { "signal_id": "...", "agent_id": "codex-1" } }
```

`harness-mem doctor` は `/v1/lease/acquire` と `/v1/signal/read` を probe するため、
daemon 設定不備があれば早期に表面化します。

---

## トラブルシューティング

### `harness-mem: command not found`

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### `doctor` が依存関係の不足を報告する

macOS では `bun` と `ripgrep` は setup 時に自動インストールされます。それ以外の `node`, `curl`, `jq` などは手動で入れたうえで:

```bash
harness-mem doctor --fix
```

### 同じワークスペースが `harness-mem` と `/.../harness-mem` として二重に見える

```bash
harness-memd restart
```

### `sudo` を使ってしまって所有権が壊れている

症状: あとから `setup` や `doctor --fix` を動かすとき、`sudo` を付けないと動かなくなっている（home 以下のファイルが root 所有になった）。

```bash
sudo chown -R "$USER":staff ~/.harness-mem ~/.codex ~/.cursor ~/.claude ~/.claude.json 2>/dev/null || true
harness-mem setup
harness-mem doctor --fix
```

OS のグループが `staff` 以外の場合は適宜置き換えてください。

### クリーンにやり直したい

```bash
harness-mem uninstall --purge-db
```

---

## リリースの再現性

このリポジトリを maintain するなら、リリース品質は「スキルを使ったか、シェルスクリプトを使ったか、手動チェックリストでやったか」に依存してはいけません。

- 通常の機能開発は `CHANGELOG.md` の `## [Unreleased]` に追記します。
- `CHANGELOG.md` がリリースノートの source of truth。`CHANGELOG_ja.md` はあくまで日本語サマリで、別契約ではありません。
- リリース契約は `harness-release` スキルを使っても手作業でやっても同じです: `package.json` のバージョン、CHANGELOG エントリ、git tag、GitHub Release、npm publish が全部同じバージョンを指すこと。
- 正式な maintainer チェックリストは [`docs/release-process.md`](docs/release-process.md) にあります。
- テスト実行の詳細（`npm test` で使う Bun panic mitigation 経路を含む）は [`docs/TESTING.md`](docs/TESTING.md) にあります。
- 既知の Bun teardown crash に関する maintainer 向け再現ノートは [`docs/bun-test-panic-repro.md`](docs/bun-test-panic-repro.md) にあります。

実運用上、再現可能なリリースとは出荷前に次の全てが成り立っていることです:

1. working tree が clean である。
2. ユーザー向けの変更がすでに `CHANGELOG.md` の `[Unreleased]` に書かれている。
3. 品質ゲートが green。
4. `npm pack --dry-run` が通る。
5. リリースタグと `package.json` のバージョンが一致している。
6. 発行後の npm バージョンと GitHub Release が同じ出荷バージョンを指している。

---

## Plans.md ワークフロー

harness-mem ではタスク管理の single source of truth として `Plans.md` を使っています。

### フェーズマーカー

| マーカー | 意味 |
|---|---|
| `cc:TODO` | 未着手 |
| `cc:WIP` | 進行中 |
| `cc:完了` | worker 側完了 |
| `blocked` | ブロック中（理由付き） |

### 着手時

実装を開始する前に該当行のマーカーを `cc:TODO` から `cc:WIP` に更新してください。各 Phase は並列実行できるタスクをまとめた単位です。

### 完了時

マーカーを `cc:完了` にして、残課題があれば note を残してください。

---

## Phase B 機能追加（2026年4月）

Phase B（2026年4月）では、verbatim raw ストレージ（`HARNESS_MEM_RAW_MODE=1`）、マルチセッション向け階層メタデータスコープ、および SessionStart のトークンコストを削減しつつ first-turn continuity を維持する L0/L1 ウェイクアップコンテキストの 3 機能を追加しました。いずれも opt-in または後方互換の変更で、既存の導入環境に設定変更は不要です。ランディングしたコミット、ベースライン測定値、および延期された項目については [Phase B capabilities](docs/benchmarks/phase-b-capabilities-2026-04-18.md)（英語）を参照してください。

---

## ドキュメント

- セットアップリファレンス: [`docs/harness-mem-setup-ja.md`](docs/harness-mem-setup-ja.md)
- 初見向け onboarding checklist: [`docs/onboarding-checklist-ja.md`](docs/onboarding-checklist-ja.md)
- README claim map: [`docs/readme-claims-ja.md`](docs/readme-claims-ja.md)
- 導入 dry-run メモ: [`docs/onboarding-dry-run-ja.md`](docs/onboarding-dry-run-ja.md)
- doctor UX の次フェーズ候補: [`docs/doctor-ux-scope-ja.md`](docs/doctor-ux-scope-ja.md)
- 商用-safe benchmark ポートフォリオ: [`docs/benchmarks/commercial-benchmark-portfolio.md`](docs/benchmarks/commercial-benchmark-portfolio.md)
- 30 USD direct-API pilot runbook: [`docs/benchmarks/pilot-30usd-direct-api.md`](docs/benchmarks/pilot-30usd-direct-api.md)
- τ³-bench runbook: [`docs/benchmarks/tau3-runbook.md`](docs/benchmarks/tau3-runbook.md)
- SWE-bench Pro memory ablation: [`docs/benchmarks/swebench-pro-memory-ablation.md`](docs/benchmarks/swebench-pro-memory-ablation.md)
- Environment API 契約: [`docs/plans/environment-tab-v1-contract.md`](docs/plans/environment-tab-v1-contract.md)
- 変更履歴（source of truth）: [`CHANGELOG.md`](CHANGELOG.md)
- 日本語変更履歴サマリ: [`CHANGELOG_ja.md`](CHANGELOG_ja.md)
- 英語 README: [`README.md`](README.md)
- ベンチマーク runbook: [`docs/benchmarks/`](docs/benchmarks/)
- Go MCP サーバー bench proof: [`docs/benchmarks/go-mcp-bench/`](docs/benchmarks/go-mcp-bench/)

---

## 公式マスコット

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-mascot-official.jpg" alt="Harness-mem 公式マスコット" width="360" />
</p>

---

## 開発・運営

<p align="center">
  開発・運営: <a href="https://canai.jp/">CAN AI Inc.</a><br />
  AI 定着コンサルティング — AI を組織の当たり前にする伴走。
</p>

---

## ライセンス

Business Source License 1.1（SPDX: `BUSL-1.1`）。[`LICENSE`](LICENSE) を参照してください。

**許可**: 社内利用、個人利用、開発、テスト、オープンソースプロジェクト、アプリケーションのコンポーネントとしての組み込み。

**制限**: harness-mem 自体をサードパーティ向けのマネージド memory サービスとして提供すること。

**2029-03-08** に、ライセンスは自動的に **Apache License 2.0** へ変換されます。

**よくある質問**:
- *業務で使っていい？* — はい。組織内の利用は許可されています。
- *harness-mem を使った製品は作れる？* — はい、コンポーネントとしては可。harness-mem 自体をホスト型 memory サービスとして提供することはできません。
- *2029 年以降はどうなる？* — Apache 2.0 へ自動変換されます。追加作業は不要です。

**メタデータ補足**: リポジトリのルートは BUSL-1.1 です。配布可能なサブパッケージはパッケージ単位で独自の SPDX を維持している場合があります（例: `sdk/`, `mcp-server/`, `vscode-extension/` は MIT）。GitHub の repo header や API が `Other` / `NOASSERTION` と表示する場合は、[`LICENSE`](LICENSE) と各 package の `package.json` を正として扱ってください。
