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
- [トラブルシューティング](#トラブルシューティング)
- [リリースの再現性](#リリースの再現性)
- [ドキュメント](#ドキュメント)
- [ライセンス](#ライセンス)

---

## 何が変わるのか

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/readme/before-after.png" alt="harness-mem の Before / After — 月曜 Claude Code の文脈が火曜の Codex に自動で引き継がれる" width="820" />
</p>

**harness-mem がない世界**

- 月曜: Claude Code で `worker.ts` の race condition をデバッグした。
- 火曜: Codex を開く。Codex は月曜のことを何も知らない。バグの内容、仮説、半分直した箇所を全部説明し直す羽目になる。
- 水曜: Claude Code のセッションが落ちる。今朝積み上げた文脈が全部消える。

**harness-mem を入れた世界**

- 火曜の Codex を開いた最初のターンで、月曜の `worker.ts` 修正の続きがすでに分かっている。
- 水曜に新しい Claude Code を起動しても、最初のプロンプトで今日の判断材料が手元に戻ってくる。
- 1つのローカル SQLite ファイルがメモリの実体。クラウド不要、API キー不要、Python スタック不要。

### つまり、こういうことです

- **Claude Code と Codex を両方使っている** → harness-mem は両方に同じローカルメモリランタイムを渡します。対応 hook path が有効なら、初手は chain-first（いまの続き）が主役のまま、その下に `Also Recently in This Project` として周辺の最近文脈を短く出せます。
- **プライバシーを重視する** → すべて `~/.harness-mem/harness-mem.db` にローカル保存。クラウド通信ゼロ。API キー不要。
- **Cursor も使っている** → Tier 2 サポート: フックと MCP がそのまま動きます。Gemini CLI と OpenCode は実験的対応です。

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

### harness-mem の target domain は "developer workflow memory"（一般会話メモリではない）

メモリ系ベンチは大きく 2 つのドメインに分かれます:

- **一般会話メモリ（general lifelog）** — 架空の人物の日常の記憶を問う（「Caroline はいつ LGBTQ サポートグループに行った？」）。LoCoMo / LongMemEval / Mem0 / MemPalace / SuperMemory が主にこちら。
- **Developer workflow memory** — 昨日の race fix、技術スタックの決定、やりかけの migration、deploy 手順。harness-mem が実際に担う領域。

その前提を置いた上で、LoCoMo は透明性リファレンスとして公開します（目標メトリクスではない）。zero-LLM の honest 比較:

| ツール | LoCoMo F1 | スコープ | そのツールの target domain | 出典 |
|---|---:|---|---|---|
| **harness-mem（120 Q サブセット）** | **0.5917** | サブセット、3-run PASS、release-gate の smoke として内部利用 | developer-workflow | [`ci-run-manifest-latest.json`](memory-server/src/benchmark/results/ci-run-manifest-latest.json) |
| **harness-mem（full 1,986 Q reference-only）** | **0.0546** | LoCoMo 全量、zero-LLM token-F1、**リリースゲートではない** | developer-workflow | [`locomo-full-reference.json`](docs/benchmarks/locomo-full-reference.json) |
| LangMem | 0.581 | LoCoMo（p95 検索: 59.82 秒） | generic-agent | [2026 比較記事](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3) |
| Kumiho | 0.565 | LoCoMo 全量（1,986 Q / 10 会話） | general-lifelog | [kumihoclouds/kumiho-benchmarks](https://github.com/kumihoclouds/kumiho-benchmarks) |
| MemPalace（raw, zero-LLM） | ≈0.603 | LoCoMo top-10、API 呼び出しゼロ | general-lifelog | [milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace) |
| SimpleMem | 0.432 | LoCoMo（平均） | generic-agent | [alphaXiv 2601.02553](https://www.alphaxiv.org/overview/2601.02553v1) |
| Mem0（single-hop） | 0.387 | LoCoMo single-hop token-F1（GPT-4o-mini extractor + LLM judge） | generic-agent | [arXiv 2504.19413](https://arxiv.org/abs/2504.19413) |
| claude-mem / Claude 組み込みメモリ / ChatGPT メモリ | — | 非公開 | さまざま | — |

**明示しておく前提**

- **harness-mem は LoCoMo 全量 1,986 Q で 0.0546 をあえて公開しています。** ここを tune する気はありません。LoCoMo は架空の人物の日常会話の記憶を測る general lifelog domain で、harness-mem の target domain（developer workflow）ではないためです。Kumiho（0.565）や MemPalace（≈0.603 raw）は一般会話メモリとして設計されているので LoCoMo で強いのは当然の話です。
- 120 Q サブセットの 0.5917 は、harness-mem の session 的な取り込み形式と偶然相性が良い小規模セットです。「subset なので score は盛られやすい」の caveat をそのまま残しています。
- Mem0 の token-F1 数値（0.387）は LLM 依存パイプライン（GPT-4o-mini extractor + LLM-as-judge）での計測です。別軸の LLM-judge では 0.669。harness-mem の上記 2 値は **全工程 zero-LLM** で計測したもので、完全に別の軸です。
- Letta の 0.832 は **LongMemEval** という別ベンチマーク。違うベンチ同士を並べると誤解を生むのであえて表に入れていません。
- 他社ツールは私たちの手元では実行していません。表の harness-mem 以外の値は全て各社の公開値をそのまま引用しています。

**harness-mem が実際に戦う場所**

harness-mem のリリースゲートは `ci-run-manifest-latest.json` の developer-workflow domain にあります:

| 指標 | 現状 | 目標（main gate） | 何を測っている |
|---|---:|---:|---|
| `dev-workflow` recall@10 | 0.59 | ≥ 0.70 | 開発者的なファイル / 判断ジャンプのクエリ |
| `bilingual` recall@10 | **0.88** | ≥ 0.90 | 日本語 / 英語 / コード混在の検索 |
| `knowledge-update` freshness@K | **1.00** | ≥ 0.95 ✓ | 情報が更新された時に古い事実を外せるか |
| `temporal` ordering score | 0.65 | ≥ 0.70 | 「X の後に Y があったか？」的な時系列推論 |

読者が自分のユースケースに照らして「どのベンチが自分に効くか」を判断できるよう、domain 列を明示しています。生データ（出典 URL、取得日、除外理由、行ごとの注釈）は機械可読な監査証跡として [`docs/benchmarks/competitors-2026-04.json`](docs/benchmarks/competitors-2026-04.json) に commit しています。

完全な benchmark gate（main ship gate + 日本語 companion + 歴史 baseline）は [実測ベンチマーク](#実測ベンチマーク) セクションに残してあります。

---

## インストール

自分の使い方に合う行を 1 つ選ぶだけです。

| 使う道具 | 実行コマンド |
|---|---|
| **Claude Code のみ** | `/plugin marketplace add Chachamaru127/harness-mem` → `/plugin install harness-mem@chachamaru127` |
| **Claude Code + Codex**（推奨） | `npm install -g @chachamaru127/harness-mem` → `harness-mem setup` |
| **`npm install -g` で sudo が要求される** | `npx -y --package @chachamaru127/harness-mem harness-mem setup` |

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

Claude 組み込みメモリは Claude の中でしか使えません。[claude-mem](https://github.com/thedotmack/claude-mem) は永続化を追加しますが Claude Code 専用です。[Mem0](https://github.com/mem0ai/mem0) はクロスアプリ対応ですがクラウド基盤と API 統合が必要です。harness-mem のアプローチは別の方向です: ローカルデーモン1つ、SQLite 1ファイル、Claude Code ↔ Codex の共有ランタイム、クラウドゼロ。

| | harness-mem | Claude 組み込みメモリ | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **Claude Code + Codex の両方で使える** | ✓ | — | — | アプリごとに手動配線 |
| **ローカル完結、クラウド不要** | ✓ | — | ✓ | クラウド / 有料セルフホスト |
| **セットアップ** | 1コマンド（`setup`） | 組み込み | npm install + 設定編集 | SDK 統合が必要 |
| **MCP コールドスタート** | **~5ms**（Go バイナリ） | — | — | — |
| **費用** | 無料 | Claude プランに含まれる | 無料 | 99ドル/月〜（クラウド） |

<details>
<summary>全項目の比較表</summary>

| | harness-mem | Claude 組み込みメモリ | claude-mem | Mem0 |
|---|:---:|:---:|:---:|:---:|
| **対応ツール** | Claude Code, Codex（Tier 1）· Cursor（Tier 2）· Gemini CLI, OpenCode（実験的） | Claude のみ | Claude のみ | API経由でカスタム統合 |
| **データ保管** | ローカル SQLite | Anthropic クラウド | ローカル SQLite + Chroma | クラウド（セルフホスト有料） |
| **クロスツール記憶共有** | 共有ローカルランタイム + 対応 hook path 上の first-turn continuity | 不可 | 不可 | アプリごとに手動接続 |
| **セットアップ** | `harness-mem setup`（1コマンド） | 組み込み | npm install + 設定編集 | SDK統合が必要 |
| **検索方式** | ハイブリッド（lexical + vector + nugget + recency + tag + graph + fact chain） | 非公開 | FTS5 + Chroma vector | ベクター中心 |
| **MCP サーバー起動** | ~5ms 中央値（Go バイナリ、実測） | — | — | — |
| **外部依存** | Node.js + Bun（Go バイナリは自動ダウンロード） | なし | Node.js + Python + uv + Chroma | Python + APIキー |
| **移行パス** | `import-claude-mem` → `verify` → `cutover` | — | — | — |
| **ワークスペース分離** | 厳格（symlink 解決済みパス） | グローバル | basename のみ | ユーザー / エージェント単位 |

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

## ドキュメント

- セットアップリファレンス: [`docs/harness-mem-setup.md`](docs/harness-mem-setup.md)
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
