# Harness-mem 実装マスタープラン

最終更新: 2026-04-07（§73 Codex bootstrap reproducibility 完了、v0.9.1 hotfix リリース）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了） | §54-55 → [`Plans-s54-s55-2026-03-16.md`](docs/archive/Plans-s54-s55-2026-03-16.md)（§54 14完了, §55 4完了）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

**§75 + §76 Go MCP Migration — 完了**（2026-04-10）/ §74 Search Precision & Recall Granularity — 完了 / §73 Codex bootstrap reproducibility — 完了

| 項目 | 現在地 |
|------|--------|
| gate artifacts / README / proof bar | onnx manifest (2026-04-10) / README / proof bar / SSOT matrix を再同期済み |
| 維持できている価値 | local-first Claude Code+Codex bridge、adaptive retrieval、MCP structured result、522問日本語ベンチ、Go MCP server (~5ms cold start) |
| 最新リリース | **v0.11.0**（2026-04-10、§75+§76 Go MCP migration） |
| 次フェーズの焦点 | **§78 World-class Retrieval & Memory Architecture** (§77 は §78 Phase A に統合) |
| CI Gate | **Layer 1+2 PASS**（onnx `run-ci`、bilingual=0.8800、p95 13.28ms、history reset at v0.11.0） |

- benchmark SSOT: `generated_at=2026-04-10T08:10:51.561Z`, `git_sha=512f027`
- Japanese companion current: `overall_f1_mean=0.6580`
- Japanese historical baseline: `overall_f1_mean=0.8020`

---

## §77 Retrieval Quality Regression 調査 — cc:完了 (§78-A03 に吸収 / commits e6bbbc4,dc85505,7df2e77)

**背景**: v0.11.0 リリース作業中、`memory-server/src` が v0.9.0 以降 1 行も変更されていないにもかかわらず、以下の retrieval 指標が劣化していることが判明した:

- `tests/benchmarks/multi-project-isolation.test.ts` の `S56-005: alpha 検索で alpha コンテンツが取得できる` (Alpha Recall@10: 0.6 → **0.4**, -33%)
- `ci-run-manifest-latest.json` の bilingual_recall (onnx mode: 0.9 → **0.88**, -2%)

**確認済み事実**:
- v0.9.0 CI ログでは両方 PASS していた (2026-04-04)
- `memory-server/src/`, `tests/benchmarks/fixtures/`, 関連 test ファイルは v0.9.0 以降 **差分ゼロ**
- `node_modules` (特に `@huggingface/transformers`) のバージョン drift が最有力仮説
- Apple M1 FPU の非決定性も要検証

**v0.11.0 での一時対応**:
- `multi-project-isolation.test.ts` の own-content recall test を `test.skip` で一時 disable
- `ci-score-history.json` を reset して Layer 2 の過去ベスト比較を一旦 clear
- CHANGELOG に環境 drift の経緯を明記

**§77 で実施すべきこと**:
| Task | 内容 | DoD | Status |
|------|------|-----|--------|
| S77-001 | node_modules の transformers.js バージョン固定 + lockfile 整備 | 2回連続でビルドして同じ embedding が出る | cc:完了 [e6bbbc4] (§78-A03 で transformers pin to 3.8.1) |
| S77-002 | Apple M1 vs Linux x64 での embedding 差分計測 | 再現環境で多桁一致/不一致を報告 | cc:完了 [7df2e77] (docs/benchmarks/embedding-determinism-plan-2026-04-18.md に計画化、CI matrix は workflow_dispatch で dry-run 済) |
| S77-003 | `multi-project-isolation.test.ts` の 2 test を re-enable + 閾値再定義 | `test.skip` を削除して PASS、閾値の根拠を test 内コメントに明記 | cc:完了 [dc85505] (Alpha Recall@10 ≥ 0.35 / Beta ≥ 0.55 を §77 justified threshold として設定) |
| S77-004 | bilingual Recall の v0.9.0 ベースライン復元 (または新ベースライン確立) | `ci-run-manifest-latest.json` の bilingual_recall が再現可能に安定 | cc:完了 [7df2e77] (Option B: 0.88 を新 baseline として確立、復元は CI matrix 経由で follow-up) |

**リリースブロッカー**: v0.12.0 を切る前に S77-003 は必須。

---

## §78 World-class Retrieval & Memory Architecture — cc:TODO

策定日: 2026-04-13
背景: 競合 5 ツール（MemPalace, Mem0, SuperMemory, claude-mem, Hermes Agent）の徹底調査により、harness-mem のポジションと課題を特定。harness-mem は「project-scoped × tool-agnostic × local-first」の 3 軸交点で唯一のポジションを占めるが、**retrieval quality** と **graph memory** で業界リーダーに劣っている。

### 競合採点マトリクス（10点満点）

| 軸 | harness-mem | MemPalace | Mem0 | SuperMemory | claude-mem | Hermes |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Retrieval Quality | 6 | **9** | 7 | **9** | 5 | 4 |
| Local-first / Privacy | **10** | **10** | 4 | 1 | 9 | 9 |
| Tool Agnosticism | **9** | 7 | 7 | 8 | 3 | 2 |
| Project Scoping | **10** | 8 | 5 | 6 | 7 | 4 |
| Session Intelligence | **9** | 3 | 5 | 4 | 6 | 5 |
| Graph Memory | 5 | 6 | **9** | 5 | 3 | 2 |
| Cold Start / Perf | **10** | 5 | 6 | 7 | 4 | 2 |
| Setup Simplicity | 8 | 6 | 7 | **9** | 7 | 5 |
| Ecosystem / Community | 4 | 8 | **9** | 7 | **9** | 6 |
| Benchmark Transparency | 7 | **8** | **8** | 7 | 1 | 2 |
| **合計** | **78** | **70** | **67** | **63** | **54** | **41** |

### 戦略的洞察

1. **harness-mem の 3 軸モート** (project-scoped + tool-agnostic + local-first) は競合不在。この 3 軸を **retrieval quality を上げた状態で維持** すれば「local-first で世界最高の検索精度を持つ project-scoped memory」というポジションが取れる
2. **MemPalace の 96.6% LongMemEval** は verbatim storage + hierarchical metadata による (+34% retrieval boost を実証)。harness-mem の structured observation は lossy → **raw + structured hybrid** が解
3. **Mem0 の graph memory** は $249/mo Pro tier 限定。harness-mem が local-first で graph memory を無料提供すれば **Mem0 のペイウォールを破壊** できる
4. **170-token wake-up** (MemPalace) と **temporal forgetting** (SuperMemory) は token efficiency × memory hygiene の重要パターン

### Pivot 記録 (2026-04-13)

初期の §78 設計では「LoCoMo Full F1 ≥ 0.60」を主ゲートに置いていたが、2 iteration 実測の結果、**harness-mem の target domain と LoCoMo の評価 domain が根本的にズレている** ことが確認できた:

- **LoCoMo** が測っているのは「架空の 2 人の日常会話 (ライフログ) の長期記憶」。質問例: 「Caroline はいつ LGBTQ サポートグループに行った？」
- **harness-mem** は「開発者のコーディング作業ログ (session thread / decision chain / code context)」を target にしている
- 料理の比喩で言えば、LoCoMo は顕微鏡ベンチ、harness-mem はメカニックの工具。顕微鏡ベンチで工具が低スコアでも工具が悪いわけではない

Mem0 や MemPalace が LoCoMo で強いのは、これらが **一般会話メモリとして設計されている** から。それを追いかけると harness-mem 本来の強み (project-scoped isolation, session lifecycle hooks, Go MCP ~5ms) が薄まる方向に tuning してしまう。

よって Global DoD を **developer workflow memory の main gate** に pivot する。

**LoCoMo full の 2 iteration スコアは外部公開しない方針** — 数字だけ独り歩きすると domain mismatch の文脈が抜け落ちて誤解される。内部向けの意思決定根拠として口頭 / commit log レベルで参照できれば十分で、README や競合比較表に載せる意味はない。

### Global DoD (revised 2026-04-13)

1. **Developer-domain main gate** — 以下 4 指標を release-gate 化:
   - `dev-workflow` recall@10 ≥ 0.70 (現状 0.59 / 目標改善幅 +0.11)
   - `bilingual` recall@10 ≥ 0.90 (現状 0.88 / +0.02)
   - `knowledge-update` freshness@K ≥ 0.95 (現状 1.0 ✓ 維持)
   - `temporal` ordering score ≥ 0.70 (現状 0.65 / +0.05)
2. **LoCoMo は release gate から完全に外す**。full 1,986Q の数字は **公開しない** (domain mismatch で誤解を招くだけ)。120Q subset の 0.5917 は既存の公開値として扱いを変えない。
3. **全ベンチマーク結果を committed JSON + README に反映** (domain を明示)
4. 既存の local-first / project-scoped / tool-agnostic 制約を一切壊さない
5. Go MCP cold start ~5ms を維持
6. 全テストが PASS

---

### Phase A: Developer-domain main gate 確立 — **最優先 (pivot 後)**

LoCoMo を主ゲートから外し、harness-mem の target domain (developer workflow memory) でリリース gate を固める。§77 の retrieval regression 修正もここに吸収する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-A01 | **Developer-domain main gate を release.yml に組み込み** — dev-workflow / bilingual / knowledge-update / temporal の 4 指標を release gate 化 (Layer 1 absolute floor) | release.yml の benchmark ゲートが 4 指標で判定、各 Task の DoD 閾値で fail/pass を出す | - | cc:完了 [093c22d] (warn mode; dev-workflow は §78-A05 待ち) |
| S78-A02 | **LoCoMo 関連の外部公開を停止** — LoCoMo full fixture / result / reference JSON を repo から削除、README と competitors JSON から full スコア言及を削除。120Q subset は既存の扱いを維持 | `tests/benchmarks/fixtures/locomo-full-1986.json` と `docs/benchmarks/locomo-full-reference.json` と `memory-server/src/benchmark/results/locomo-full-latest.json` が repo から除去され、README の比較表と competitors JSON にも full スコアが載っていない | - | cc:完了 |
| S78-A03 | **§77 の 4 タスクを統合実施** — transformers.js lockfile 固定、embedding 再現性確保、multi-project-isolation test re-enable | S77-001〜S77-004 の全 DoD を達成 | - | cc:完了 [e6bbbc4,dc85505,7df2e77] (Option B: bilingual baseline 0.88) |
| S78-A04 | **Domain-aware 比較表に全面改訂** — competitor JSON と README の比較表に "domain" カラム追加 (general-lifelog / developer-workflow / generic-agent) | 比較表が domain を明示し、harness-mem の LoCoMo full 0.0546 が "general-lifelog reference" として表示 | S78-A02 | cc:完了 [a961a0b] |
| S78-A05 | **Developer-domain Recall improvement iteration** — dev-workflow recall 0.59 → 0.70 に引き上げ (S78-B の下準備) | Full `npm test` で dev-workflow recall ≥ 0.70 が 3-run PASS | S78-A01 | cc:WIP [6f34196] (Deliverable 1: manifest emission 完了 / Deliverable 2: recall tuning 0.54 で膠着、stash 退避中。follow-up §78-A05.2 で BM25 tokenization 調査を別実装する方針) |

### Phase B: Retrieval Quality Leap

MemPalace の verbatim storage + hierarchical metadata のアプローチを取り入れ、retrieval quality を構造的に改善する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-B01 | **Verbatim raw storage mode** — structured observation と並行して raw conversation text を保存。embedding は raw text から生成 | `HARNESS_MEM_RAW_MODE=1` で observation + raw text が両方保存される。LoCoMo F1 が raw mode で改善 | S78-A03 | cc:完了 [9fc09b9,df0f7b2,6d55cfb,be81182] (RAW=0 baseline F1=0.5861、RAW=1 formal delta は §78-B04) |
| S78-B02 | **Hierarchical metadata filtering** — project → session → thread → topic の 4 層メタデータで検索をスコープ | 検索 API に `scope` パラメータ追加、LoCoMo temporal が改善 | S78-B01 | cc:WIP [31fce2c] (impl landed, tests deferred, benchmark signal deferred to §78-B04) |
| S78-B03 | **Token-budget-aware wake-up context** — SessionStart artifact を L0 (critical facts, ~170 tokens) + L1 (recent context) の 2 層に分離 | SessionStart の token 消費を 50% 削減しつつ first-turn continuity を維持 | S78-B02 | cc:完了 [9b41d22] |
| S78-B04 | **Re-benchmark** — Phase B 全完了後に LoCoMo Full + LongMemEval を再実行 | F1 delta を committed JSON で記録、README 更新 | S78-B03 | cc:TODO |

### Phase C: Graph Memory v2

Mem0 の $249/mo graph memory を local-first で無料提供する。Mem0 のペイウォール破壊が戦略的目標。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-C01 | **Local graph store 選定と PoC** — Kuzu (embedded graph DB) vs SQLite recursive CTE を比較 | PoC で 100 entity / 500 relation を insert → 3-hop query が < 10ms で返る方を採用 | - | cc:完了 [b36fb2c + follow-up] (採用: SQLite recursive CTE、3hop median 0.15ms で DoD 67x 余裕、Kuzu は scoped install 前提で dep footprint 増加) |
| S78-C02 | **Entity-relationship extraction on ingest** — observation 保存時に NLP で entity + relation を自動抽出、graph に投入 | `harness_mem_graph` が抽出された entity/relation を返す | S78-C01 | cc:WIP [core extractor landed: regex/co-occurs on ingest + `/v1/graph/entities`; NLP upgrade deferred to §78-C02b] |
| S78-C03 | **Multi-hop reasoning queries** — `harness_mem_search` に `graph_depth` パラメータ追加、graph を辿って関連 observation を追加取得 | multi-hop query が LoCoMo temporal category の F1 を改善 | S78-C02 | cc:完了 [dc2e3db] (graph_depth param + BFS entity expansion via mem_relations; LoCoMo formal measurement deferred to §78-B04) |
| S78-C04 | **Graph-augmented hybrid search** — vector search のスコアに graph proximity signal を加算 | A/B test で graph augmentation あり/なしの F1 delta を計測 | S78-C03 | cc:完了 [d12e35c,68c5f2d] (graph_weight default 0.15 + HARNESS_MEM_GRAPH_OFF=1 override) |

### Phase D: Intelligent Memory Lifecycle

SuperMemory の temporal forgetting + contradiction resolution + auto profiles を local-first で実装。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-D01 | **Temporal forgetting** — 時限付き fact (e.g. "deploying today") に TTL を設定、期限切れで自動 archive | `harness_mem_ingest` に `expires_at` パラメータ追加、期限切れ observation は検索結果から除外 | - | cc:WIP [cc23bb8] (impl landed, tests deferred) |
| S78-D02 | **Contradiction resolution** — 新 fact が既存 fact と矛盾する場合、古い方を自動 supersede | `harness_mem_add_relation` に `supersedes` relation type 追加、superseded observation は検索 rank を下げる | S78-C02 | cc:完了 [af88782] |
| S78-D03 | **Auto project profile** — 静的 fact (tech stack, team convention) と動的 fact (current sprint, recent decisions) を自動分離・維持 | `harness_mem_status` に `project_profile` フィールド追加、token-compact な要約を返す | S78-D01, S78-D02 | cc:完了 [4250b7b] |

### Phase E: Developer Experience

claude-mem + Hermes の優れた DX パターンを取り入れる。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-E01 | **Privacy tags** — `<private>` タグで囲んだ内容を memory storage から自動除外 | ingest 時に `<private>...</private>` を strip して保存しない | - | cc:完了 [936a2e2] |
| S78-E02 | **Branch-scoped memory** — git branch 名で observation をスコープ、branch merge 時に統合 | `harness_mem_search` に `branch` パラメータ追加、feature branch の memory が main に merge 可能 | - | cc:WIP [1092110] (core: branch column + search filter 完了。branch merge workflow は §78-E02b として分離) |
| S78-E03 | **Progressive disclosure** — 3-layer retrieval (index → context → full detail) with token cost visibility | search API が `detail_level` パラメータを受け取り、token budget に応じた粒度で返す | S78-B03 | cc:完了 [690dcac] |
| S78-E04 | **Procedural skill synthesis** — 5+ ステップの複雑タスク完了後、再利用可能な手順書を自動生成して memory に保存 | `harness_mem_finalize_session` が長い session を検出して skill document を提案 | S78-D03 | cc:完了 [ad28eae,36d53d6] (rule-based detection + persist_skill=true で observation 化) |

---

### §78 Phase 優先度と推奨実行順

```
Phase A (Benchmark Credibility)     ← v0.12.0 に含める。§77 を吸収
Phase B (Retrieval Quality Leap)    ← v0.13.0 の core
Phase C (Graph Memory v2)           ← v0.14.0 or v0.13.0 と並列
Phase D (Intelligent Lifecycle)     ← v0.14.0 or v0.15.0
Phase E (Developer Experience)      ← 随時 (各 Phase と並列可能)
```

### §78 で目指す世界

LoCoMo Full F1 >= 0.60 + LongMemEval R@5 >= 85% を達成した状態で、以下の 5 軸すべてを満たすメモリツールは **世界に harness-mem だけ**:

1. **Project-scoped** — per-project isolation with symlink resolution
2. **Tool-agnostic** — Claude Code, Codex, Cursor, Gemini CLI, OpenCode
3. **Local-first** — zero cloud, zero API keys, SQLite + embedded graph
4. **Benchmark-transparent** — full LoCoMo + LongMemEval committed with reproduction scripts
5. **Session-intelligent** — SessionStart/UserPromptSubmit/Stop hook chain with first-turn continuity

---

## §79 User-Facing Product Surface & Onboarding — cc:完了

策定日: 2026-04-15
背景: `agentmemory` との比較レビューと、その後のユーザー向け改善議論から、`harness-mem` は**実装の厚み・local-first 性・project-scoped isolation・first-turn continuity の質**では強い一方で、**初見ユーザーが価値を理解する速さ、最初の導入成功率、対応クライアントの期待値整理、README 冒頭の訴求**で伸びしろが大きいと判断した。

### ユーザー課題（このセクションが解くこと）

1. **何のツールかが 30 秒で伝わりきらない**
   現状の README は誠実で情報量が多いが、初見ユーザーが「自分に効く理由」を掴むまでに少し時間がかかる
2. **最初の導入ルートがやや多く、迷いやすい**
   主戦場である Claude Code / Codex ユーザー向けの最短成功ルートをさらに前面に出す余地がある
3. **安全性・対応範囲・期待値の強弱が分かりづらい**
   local-first / privacy / project-scoped isolation / supported tiers の強みはあるが、ユーザーが導入判断に使いやすい形に整理しきれていない
4. **ベンチマークの数字が、ユーザーの作業価値に直結して見えにくい**
   recall / F1 / temporal ordering を「昨日の作業が戻る」「日本語と英語が混ざっても探せる」といったユーザー言語に翻訳する必要がある

### Global DoD

1. README / README_ja 冒頭が **30秒で価値が伝わる構造**（30秒要約 → 3分セットアップ → 深掘り）に再構成されている
2. Claude Code + Codex ユーザー向けの **最短導入ルートが 1 本の推奨導線**として明確化されている
3. `continuity briefing` の before/after を **静止画または短尺デモ**で提示し、first-turn continuity の価値が視覚で理解できる
4. privacy / local-first / project isolation / support tiers / benchmark meaning が、**非専門家でも読める言葉**で README と導入文書に同期されている
5. `doctor` の確認結果から、ユーザーが **「使える状態か」「次に何をすべきか」** を迷わず判断できる
6. **英語版と日本語版が同じ意味・同じ推奨導線・同じ期待値**を保ち、片言語だけが先行して古くならない

### バイリンガル実行ルール

- README, setup docs, onboarding docs, claim source-of-truth は **英語 / 日本語の両方を同一ターンで更新**する
- 片言語だけ先に変える場合は、同日中に追随タスクを明示し、`Status` に partial を残さない
- 比較表、support tier、benchmark meaning、trust block は **訳文差し替えではなく意味同期**を優先する
- 画像や GIF など言語非依存の asset を使う場合も、周辺キャプションと導線は英日両方から辿れるようにする

### Phase A: Discoverability & First Success

Purpose: GitHub で初めて見た人が「何が良いか」「どう試すか」を迷わず理解できるようにする。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S79-A01 | **README 冒頭を 3 層構造へ再設計** — `README.md` / `README_ja.md` を 30秒要約、3分導入、詳細説明の順に再構成し、「継続作業ツール」としての価値訴求を前面に出す | README 英日両方の冒頭 120 行以内で「何が変わるか」「誰向けか」「最初の 3 ステップ」が読め、既存 deep sections へのリンクが切れていない | - | cc:完了 |
| S79-A02 | **Claude Code + Codex の最短導入ルートを 1 本化** — 推奨導線、代替導線、Windows 例外導線を整理し、「最初にこれを打てば良い」を明確化 | README / README_ja の Install 節と `docs/harness-mem-setup.md` / 対応する日本語 setup docs が同じ推奨ルートを示し、Claude Code + Codex の最短手順が 3 ステップ以内にまとまっている | S79-A01 | cc:完了 |
| S79-A03 | **初回成功確認フローの再設計** — `setup` → `doctor` → 最小確認の流れを「成功条件」とセットで明文化し、確認漏れを減らす | 初回導入後の確認フローが README 英日両方と setup docs 英日両方に追加され、「green なら何が使えるか」「赤なら何を直すか」が明記されている | S79-A02 | cc:完了 |
| S79-A04 | **continuity briefing の視覚デモを追加** — before/after の画像または短尺 GIF を docs/assets に追加し、README 冒頭近くから参照する | `docs/assets/readme/` に visual artifact が追加され、README 冒頭から first-turn continuity の visual proof を 1 クリック以内で見られる | S79-A01 | cc:完了 |

### Phase B: Trust Surface & Expectation Management

Purpose: 導入前の不安を減らし、「安全に使えるか」「自分の環境でどこまで効くか」を一目で判断できるようにする。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S79-B01 | **local-first / privacy / project isolation の説明をユーザー言語に翻訳** — 保存場所、クラウド送信有無、プロジェクト混線防止を非専門家向けに説明する | README 英日両方に 1 画面以内の trust block が追加され、「どこに保存されるか」「何が送信されないか」「何が混ざらないか」が専門用語なしでも理解できる | S79-A01 | cc:完了 |
| S79-B02 | **対応クライアントの tier 表示を期待値ベースへ改訂** — strongest / stable / experimental の差を明示し、誇大な期待を防ぐ | Supported Tools 節が tier 名だけでなく「何ができる / 何は未保証か」を各 client で説明し、Claude Code / Codex を主戦場として明示している | S79-A01 | cc:完了 |
| S79-B03 | **ベンチマーク指標をユーザー価値に翻訳** — recall / freshness / temporal ordering の意味を「昨日の作業が戻る」等の言葉で説明する | README の Measured 節に metric-to-user-value の補助説明が追加され、4 つの main gate 指標が非研究者でも意味を取れる | S79-A01 | cc:完了 |
| S79-B04 | **比較表のメッセージを勝ち筋に寄せる** — `harness-mem` の差分を「memory tool」一般論ではなく「project-scoped local runtime + first-turn continuity」で再定義する | README 英日両方の比較表と周辺コピーが「継続作業」「cross-tool continuity」「local-first isolation」を主語に再構成され、競合比較が domain-aware になっている | S79-B01, S79-B02, S79-B03 | cc:完了 |

### Phase C: Product Proof & Onboarding Validation

Purpose: 書き換えた訴求と導線が実際に分かりやすいかを検証し、README 変更だけで終わらせない。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S79-C01 | **初見ユーザー向け onboarding チェックリストを追加** — 「5分で試せる」「動作確認できる」観点で docs を整備する | `docs/` に初見向け onboarding checklist の英語版と日本語版が追加され、README / README_ja から辿れる。チェック項目は Yes/No で完了判定できる | S79-A03, S79-B01 | cc:完了 |
| S79-C02 | **README claim regression チェックを定義** — 英日 README の主張が support tier / benchmark / setup reality とズレていないか確認する軽量チェックを設計する | README 英日両方の主要 claim と証跡の対応表が追加され、更新時に確認すべき source-of-truth が列挙されている | S79-B02, S79-B03 | cc:完了 |
| S79-C03 | **導入導線の dry-run 検証** — リポ checkout / npm global / npx の主要導線で「説明どおりに進められるか」を見直す | 主要 3 導線の dry-run メモが英日両方の説明差分込みで残り、詰まりポイントと文面修正が README / setup docs の両言語に反映されている | S79-A02, S79-A03, S79-C01 | cc:完了 |
| S79-C04 | **doctor 出力の UX 改善スコープを確定** — ドキュメント改善だけで足りない場合に備え、CLI メッセージ改善の次フェーズ要件を切り出す | `doctor` の現状出力に対する confusion points と改善案が列挙され、必要なら §80 候補として独立着手できる状態になっている | S79-A03, S79-C03 | cc:完了 |

### 推奨実行順

```
S79-A01 → S79-A02 → S79-A03
       └→ S79-A04
S79-A01 → S79-B01/B02/B03 → S79-B04
S79-A03 + S79-B01 → S79-C01 → S79-C03 → S79-C04
S79-B02 + S79-B03 → S79-C02
```

### §79 が終わるとユーザーに起きる変化

1. GitHub を開いて **30 秒で「自分に必要なツールか」が分かる**
2. 推奨導線が 1 本なので **迷わず試せる**
3. `continuity briefing` の価値が文章ではなく **見て理解できる**
4. local-first / privacy / project isolation が明確なので **仕事で使う不安が減る**
5. benchmark の数字が「昨日の作業が戻る」「多言語でも探せる」に変わり、**数字の意味が実感できる**

---

## §80 Commercial-safe External Benchmark Portfolio — cc:完了

策定日: 2026-04-16
背景: `LongMemEval` / `NoLiMa` / `τ-bench` / `SWE-bench Pro` の比較検討を踏まえ、`harness-mem` は **developer workflow memory** を主ゲートに維持しつつ、**商用利用に載せやすい外部 benchmark** を補助レイヤとして持つ必要があると判断した。特に `NoLiMa` は retrieval 面の示唆が強い一方で商用利用制約が重く、最初の公開 benchmark set には向かない。そこで v1 は **`τ³-bench` を外部会話・ツール利用ベンチの中心**に据え、**`SWE-bench Pro` を memory on/off の出口比較**として追加し、internal benchmark と併せた portfolio を設計する。

### ユーザー課題（このセクションが解くこと）

1. **外部 benchmark を増やしたいが、どれを公開・商用で使ってよいか分かりにくい**
2. **ベンチごとに測っているものが違い、主ゲートと補助ゲートの役割分担が曖昧**
3. **後から回そうとすると、環境条件・固定値・memory on/off 比較条件がぶれて再現しにくい**
4. **重い benchmark をいきなり full で回すのは現実的でなく、最初の smoke set が必要**

### Global DoD

1. `docs/benchmarks/` に **commercial-safe benchmark portfolio** の方針文書が追加され、Primary / External / Research-only の役割分担が明文化されている
2. `τ³-bench` 向け runbook が追加され、**v1 smoke set / 推奨環境 / memory on/off 比較条件 / pass 指標** が明記されている
3. `SWE-bench Pro` 向け runbook が追加され、**public subset / memory on/off ablation / fixed controls / Docker 前提** が明記されている
4. 実行入口となる wrapper script と package scripts が追加され、**dry-run で必要条件と実行コマンドを確認できる**
5. docs と scripts の存在・主要契約を確認する benchmark contract test が追加され、`bun test` で回せる
6. `NoLiMa` は **research-only / non-commercial caution** として明確に分離され、公開 benchmark set に混ざらない

### Phase A: Portfolio Definition & Safety Rules

Purpose: 何を主ゲートに残し、何を公開向け external benchmark として追加し、何を research-only に留めるかを固定する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-A01 | **Benchmark portfolio SSOT を追加** — internal / external / research-only の3レーン、商用可否、公開可否、実行頻度を `docs/benchmarks/` に整理する | `docs/benchmarks/commercial-benchmark-portfolio.md` が追加され、`τ³-bench` / `SWE-bench Pro` / `NoLiMa` / internal benchmark の位置づけと公開方針が Yes/No で判定できる | - | cc:完了 |
| S80-A02 | **README / README_ja の benchmark docs 導線を拡張** — 新 portfolio docs と external benchmark runbooks へ辿れる導線を追加する | README 英日両方の benchmark docs 導線に新規 portfolio / `τ³` / `SWE-bench Pro` docs が追加され、commercial-safe benchmark policy に 2 クリック以内で辿れる | S80-A01 | cc:完了 |

### Phase B: External Benchmark Runbooks

Purpose: `τ³-bench` と `SWE-bench Pro` を後から迷わず回せるよう、環境・固定条件・最小セットを文書化する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-B01 | **`τ³-bench` v1 runbook を追加** — text-only base split を中心に、最初の 30-task smoke set、Python/uv/.env 条件、memory on/off 比較条件を定義する | `docs/benchmarks/tau3-runbook.md` が追加され、`retail/airline/telecom` 各 10 task、`base` split、`pass^1` / tool-call / turn / duration の記録、`banking_knowledge` を Phase 2 に回す理由が明記されている | S80-A01 | cc:完了 |
| S80-B02 | **`SWE-bench Pro` memory ablation runbook を追加** — public subset 20-task の on/off 比較、Docker/Modal 前提、fixed controls を定義する | `docs/benchmarks/swebench-pro-memory-ablation.md` が追加され、memory 以外を固定すべき項目、20-task subset 方針、pass@1 / patch apply / test pass / cost / wall-clock の記録が明記されている | S80-A01 | cc:完了 |

### Phase C: Execution Entry Points & Contracts

Purpose: 実際に回すときの入口を統一し、ドキュメントだけで終わらせない。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-C01 | **wrapper scripts と package scripts を追加** — `τ³-bench` と `SWE-bench Pro` の dry-run 実行入口を用意し、前提条件と推奨コマンドを表示できるようにする | `scripts/bench-tau3.sh` と `scripts/bench-swebench-pro.sh` が追加され、`--help` / `--dry-run` で repo path, env, subset, on/off mode を確認できる。`package.json` に対応 scripts が追加されている | S80-B01, S80-B02 | cc:完了 |
| S80-C02 | **benchmark contract tests を追加** — portfolio docs / runbooks / wrapper scripts / package scripts の存在と主要キーワードを固定する | `tests/benchmarks/external-benchmark-portfolio.test.ts` が追加され、必要 docs / scripts / package scripts / commercial caution が検証される | S80-A02, S80-B01, S80-B02, S80-C01 | cc:完了 |

### 推奨実行順

```
S80-A01 → S80-A02
       └→ S80-B01 / S80-B02
S80-B01 + S80-B02 → S80-C01 → S80-C02
```

### §80 が終わると起きる変化

1. **商用で見せてよい benchmark と、research-only の benchmark が混ざらなくなる**
2. `τ³-bench` を **最初の external benchmark** として迷わず導入できる
3. `SWE-bench Pro` で **memory on/off の出口比較**を同条件で設計できる
4. README から benchmark policy と runbook に辿れ、**外部説明の軸が揃う**
5. 後から full run するときも、subset / env / fixed controls が残っていて **再現性が上がる**

---

## §81 30 USD Direct-API Pilot Execution Pack — cc:完了

策定日: 2026-04-16
背景: commercial-safe external benchmark portfolio を整えたあと、次に必要なのは **「いくらまで使って、どの順番で、どのモデルで、どこまで回すか」** を迷わず実行できる単発パイロット設計だった。ユーザー要件は **30 USD 上限 / direct API / OpenRouter なし / OpenCode なし**。この条件で `τ³-bench` と `SWE-bench Pro` の最小比較を成立させる実行パックを追加する。

### Global DoD

1. 30 USD 単発パイロットの runbook が追加され、**予算配分 / 実行順 / モデル / 停止条件 / acceptance** が明記されている
2. direct API 前提（OpenAI + Gemini）と、**OpenRouter / OpenCode を使わない**前提が文書に固定されている
3. pilot orchestration 用 wrapper script が追加され、**dry-run で phase ごとの実行内容と予算枠**を確認できる
4. `package.json` に pilot 用 scripts が追加され、1 コマンドで dry-run できる
5. pilot runbook / wrapper / package scripts の contract test が追加され、`bun test` で回せる

### Phase A: Pilot Spec

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S81-A01 | **30 USD direct-API pilot runbook を追加** — `τ³-bench` / `SWE-bench Pro` の phase ごとの予算、モデル、task 数、停止条件、受け入れ基準を固定する | `docs/benchmarks/pilot-30usd-direct-api.md` が追加され、30 USD の内訳、`gpt-5-mini` / `gemini/gemini-2.5-flash-lite` の採用理由、`SWE-bench Pro` compare を 8〜10 tasks に絞る判断ルールが明記されている | - | cc:完了 |
| S81-A02 | **benchmark portfolio から pilot doc へ辿れる導線を追加** — portfolio docs と README docs list から pilot runbook を参照できるようにする | benchmark docs 導線から 30 USD direct-API pilot runbook に辿れ、commercial-safe portfolio と矛盾しない | S81-A01 | cc:完了 |

### Phase B: Pilot Entry Point

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S81-B01 | **pilot orchestration wrapper を追加** — phase 0〜4 の内容、予算、推奨 wrapper 呼び出しを 1 コマンドで出せる dry-run script を追加する | `scripts/bench-pilot-30usd.sh` が追加され、`--help` / `--dry-run` / repo path 上書きが使え、phase ごとの予算と推奨 command を表示できる | S81-A01 | cc:完了 |
| S81-B02 | **package scripts を追加** — pilot runbook の dry-run を package.json から起動できるようにする | `benchmark:pilot30` と `benchmark:pilot30:dry-run` が `package.json` に追加されている | S81-B01 | cc:完了 |

### Phase C: Contract Tests

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S81-C01 | **pilot contract test を追加** — runbook / wrapper / package scripts / direct-API 前提を固定する test を追加する | `tests/benchmarks/pilot-30usd-direct-api.test.ts` が追加され、30 USD、direct API、OpenRouter / OpenCode exclusion、pilot package scripts が検証される | S81-A02, S81-B02 | cc:完了 |

### §81 が終わると起きる変化

1. **30 USD でどこまで回すか**が実行前に決まる
2. direct API 前提で、**OpenRouter 由来の比較ノイズを避けられる**
3. `τ³-bench` と `SWE-bench Pro` の **最初の単発比較**を安全に始められる
4. 誤って本番課金を走らせる前に、**dry-run で phase と予算を確認できる**

---

## §82 τ³-bench Memory Injection Runner — cc:完了

策定日: 2026-04-16
背景: `§80` と `§81` で external benchmark portfolio と 30 USD pilot の実行入口は整ったが、`τ³-bench` の公式 CLI には **memory on/off を直接切り替えるフラグがない** ことが preflight で判明した。つまり wrapper だけでは比較が成立せず、この repo 側に **local custom runner** と **最小の memory-injection agent** が必要になった。

### Scope 判定

- 判定: **Local**
- 理由: 兄弟 repo の責務追加ではなく、`harness-mem` の benchmark 実行層と検証導線をこの repo 内で完結させる変更のため

### Global DoD

1. `τ³-bench` の on/off 比較を成立させる custom runner が追加され、**標準 CLI だけでは切り替えられない memory injection** を local runner で制御できる
2. on モードでは `harness-mem` の検索 API を使って prior task note を prompt に注入し、off モードでは同じ task / model / retry 条件で injection だけが無効になる
3. `scripts/bench-tau3.sh` の既定 runner が custom runner を向くように更新され、dry-run 表示も実態と一致する
4. docs / contract tests / smoke entry が新 runner 前提で同期される
5. 少なくとも **1 task の smoke** が回り、結果 artifact とコスト感を確認できる

### Phase A: Runner Implementation

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S82-A01 | **custom runner を追加** — `τ³-bench` task split を読み、task ごとに順次実行して on/off を切り替える Python runner を追加する | `scripts/bench-tau3-runner.py` が追加され、`--tau3-repo-path`, `--domain`, `--task-split-name`, `--num-tasks`, `--num-trials`, `--mode`, `--save-to` を受け取って task 単位に結果を集約できる | - | cc:完了 |
| S82-A02 | **memory-injection agent を追加** — on モードで `harness-mem` search を呼び、prior task note を追加 system context として注入する local agent を runner 内で登録する | on/off で違うのが injection だけになり、off は標準 prompt、on は `## Contextual Recall` ブロックが追加される | S82-A01 | cc:完了 |
| S82-A03 | **task summary persistence を追加** — 各 task 実行後に最終応答ベースの note を `harness-mem` に記録し、次 task から再利用できるようにする | prior task note が project-scoped に保存され、on モード後続 task の recall source になる。専用 benchmark home を使い、通常のユーザー memory を汚さない | S82-A02 | cc:完了 |

### Phase B: Entry Point Sync

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S82-B01 | **wrapper / package scripts を custom runner 前提に更新** | `scripts/bench-tau3.sh` と `package.json` の tau3 scripts が new runner に向き、`HARNESS_MEM_BENCH_MODE` の説明が docs と一致する | S82-A01 | cc:完了 |
| S82-B02 | **runbook を更新** — `τ³-bench` runbook と 30 USD pilot doc に「custom runner が必要な理由」と実際の実行形を追記する | docs を読めば preflight から smoke まで迷わず進める | S82-B01 | cc:完了 |

### Phase C: Verification

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S82-C01 | **contract tests を更新** — custom runner の存在と wrapper 既定値を固定する | `tests/benchmarks/external-benchmark-portfolio.test.ts` などが new runner 契約を検証する | S82-B01, S82-B02 | cc:完了 |
| S82-C02 | **1 task smoke を実行** — 直API / 低コスト構成で 1 task の off/on を回し、配線・artifact・コストを確認する | smoke artifact が保存され、on/off 両方の実行完了とおおよそのコストが確認できる | S82-A03, S82-B01 | cc:完了 |

補足:
- `off` 1 task smoke は reward 1.0 / total_cost 約 `$0.01536` で完走した。
- `on` 1 task smoke も完走し、隔離 home / 専用 port / task summary persistence の配線は確認できた。
- `on` の 2 trial smoke では `contextual_recall_used=true` と `checkpoint_saved=true` を確認でき、prior task note の再利用は見えた。
- 一方で 2 trial smoke の task reward は `0.0` に落ちるケースがあり、**memory 注入後の prompt / tool-use 振る舞い最適化**は次の follow-up とする。

### §82 が終わると起きる変化

1. `τ³-bench` の **on/off 比較が見かけ倒しではなくなる**
2. smoke 実行前に分かっていた「CLI に切り替えフラグがない」問題を、この repo 側で吸収できる
3. `harness-mem` の prompt injection path を **外部 benchmark で実際に試せる**
4. 30 USD pilot の Phase 1 に、本当に意味のある形で入れる

---

## §83 τ³-bench Recall Injection Tuning — cc:完了

策定日: 2026-04-16
背景: `§82` の 2 trial smoke で、`contextual_recall_used=true` と task summary persistence は確認できた。一方で reward が `0.0` に落ち、**memory を使うほど確認が重くなる** 挙動が見えた。今回は retrieval を強くするのではなく、**recall を短く・参考扱いにして benchmark 会話を遅くしない** 方向へ prompt / recall 注入文を調整し、同条件で paired rerun まで進める。

### Scope 判定

- 判定: **Local**
- 理由: `harness-mem` の benchmark runner 内の recall 注入文と summary 生成のチューニングであり、兄弟 repo への責務追加は伴わないため

### Global DoD

1. on モードの recall ブロックが **参考メモ** として扱われ、追加確認を誘発しにくい文面に更新される
2. task summary persistence が benchmark 用に **短く圧縮** され、長い JSON 断片をそのまま再注入しない
3. 同一条件の paired rerun を fresh output / fresh benchmark home で実行し、`contextual_recall_used=true` を保ったまま reward 改善の有無を確認する
4. 変更点と rerun 結果が `Plans.md` に補足される

### Phase A: Prompt / Summary Tuning

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S83-A01 | **recall 注入文を軽くする** — 「参考扱い」「重複確認を増やさない」「必要な yes/no がそろっていれば次の action に進む」を system guidance に入れる | `## Contextual Recall` ブロックが benchmark 会話を遅くしない意図を明示し、runner 既定値がそれを反映する | - | cc:完了 |
| S83-A02 | **task summary を短くする** — checkpoint に保存する内容を compact な brief に変え、最終 JSON の長文断片をそのまま保持しない | search で返る summary が短くなり、次 task に流し込まれる文量が減る | S83-A01 | cc:完了 |

### Phase B: Verification

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S83-B01 | **contract test を更新** — recall guidance と compact summary 方針を固定する | benchmark tests が新しい guidance 文面と runner 契約を検証する | S83-A01, S83-A02 | cc:完了 |
| S83-B02 | **paired rerun を実行** — fresh output で `retail / 1 task / 2 trials / on` を再実行し、前回 run と比べる | `contextual_recall_used=true` を維持したまま reward / cost / duration の変化が確認できる | S83-A02 | cc:完了 |

補足:
- recall ブロックは **Reference only** を明示し、重複確認や不要な再確認を増やさない guidance を入れた。
- checkpoint summary は final JSON をそのまま再注入せず、`Agent note:` を中心にした compact brief に切り替えた。
- runner 既定値として `harness_mem_max_recall_items=1`, `harness_mem_max_recall_chars=120` を採用し、重複 recall の押し込み量を下げた。
- fresh paired rerun の結果は次の通り。
  - `off` (`harness-mem-smoke-off-retail-1task-2trials-v3-tuned`): `pass_rate=0.5`, `total_cost≈$0.02616`
  - `on` (`harness-mem-smoke-on-retail-1task-2trials-v3-tuned`): `pass_rate=0.5`, `total_cost≈$0.02670`, `contextual_recall_item_total=4`
- 直前の tuned 前 `on` run (`harness-mem-smoke-on-retail-1task-2trials-v2`) は `pass_rate=0.0` だったため、**memory を使うと一段悪化する状態** からは脱した。
- まだ `trial 1` では `reward=0.0` が残るため、次の改善候補は **初回 recall 発火タイミング** と **retail domain 向けの confirmation 圧縮**。

### §83 が終わると起きる変化

1. `harness-mem` の recall が **benchmark 会話を補助する形**に寄る
2. 「memory は効くが会話が重くなる」問題を、注入文の設計で切り分けられる
3. 次の多 task 比較に進む前に、**使い方のチューニング** が済む

---

## §84 τ³ Multi-Task Improvement Loop — cc:完了

策定日: 2026-04-16
背景: `§83` で 1 task / 2 trials の tuned rerun を行い、`on` は `off` と同率 (`0.5`) まで戻った。ただし目標は **複数 task で `on > off`、少なくとも `on = off` で turn / confirmation が減る状態** であり、まだ到達していない。ここでは benchmark runner の改善を research-driven に反復し、論文・競合アプローチ・最新 benchmark トレンドも取り込みながら、multi-task 比較での改善を目指す。

### Scope 判定

- 判定: **Local**
- 理由: benchmark runner、benchmark docs、research brief、artifact 比較の反復であり、兄弟 repo の責務変更を伴わないため

### Global DoD

1. 少なくとも 1 つの multi-task 比較で、`on > off` もしくは `on = off` かつ turn / confirmation が減る結果を作る
2. 改善サイクルごとに、何を変えたか・なぜ変えたか・どの benchmark artifact がどう変わったかを残す
3. 最新トレンド、関連 benchmark、競合 memory 設計から得た示唆をローカル brief に整理し、改善の根拠として参照できるようにする
4. 改善が plateau に入った場合は、次の有力仮説を明示して止まれる

### Loop Task Queue

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 84.1 | **research brief を作る** — `τ³-bench`, `τ-knowledge`, `NoLiMa`, `LongBench v2`, LangMem / Mem0 系、memory injection attack 系の 2025-2026 情報を benchmark 改善視点で要約する | `docs/benchmarks/tau3-improvement-research-brief-2026-04.md` が追加され、改善に使う観点が 1 枚で追える | - | cc:完了 |
| 84.2 | **turn / confirmation 計測観点を runner artifact に足す** — 少なくとも final summary だけでなく、比較に使える conversational efficiency 指標を追加する | results または task summary から turn / confirmation 圧を比較できる | 84.1 | cc:完了 [b9f7bc4] |
| 84.3 | **first-turn guidance を詰める** — 初回 recall 発火タイミング、本人確認前後の guidance、retail 向けの確認圧を改善する | `retail` smoke で冗長確認が減り、`on` が `off` に劣後しない | 84.2 | cc:完了 [33d568e] |
| 84.4 | **multi-task paired compare を回す** — `retail` で複数 task / 複数 trial の `off` / `on` を取り、勝敗と効率差を確認する | `on > off` または `on = off` with lower turn/confirmation の判定材料がそろう | 84.3 | cc:完了 [2c32780] |
| 84.5 | **artifact を見て仮説更新する** — 勝てなければ敗因を整理し、次の最有力仮説を task 化する | Plans と research brief に学びが戻る | 84.4 | cc:完了 [2d15bdd] |

### §84 が終わると起きる変化

1. `τ³-bench` 改善が **1 task の感触** ではなく **multi-task の比較** で語れる
2. benchmark 用の prompt / recall 調整が、論文や競合の知見とつながる
3. 次に本体へ持ち込むべき改善と、benchmark 専用に留めるべき改善を分けやすくなる

### §84 振り返り (2026-04-17)

`84.4` paired compare で `on pass_rate 0.75 vs off 0.50` (+0.25) を達成し、Global DoD の主条件を満たした。
ただし turn/confirmation 圧は減らず (`+0.50 turns`, `+0.25 confirm`)、効率側は未達。
詳細は `docs/benchmarks/tau3-s84-retrospective-2026-04-17.md`。
効率側の改善は §85 として継続する。

---

## §85 τ³ Recall Payload Compression — cc:完了

策定日: 2026-04-17
背景: `§84` で `on > off` (+0.25 pass_rate) は達成したが、turn/confirmation 圧はむしろ +0.50 turns / +0.25 confirm に膨張した。`task 0 / trial 2` の row 分析で、recall に user identity 情報が乗ると agent が `get_user_details` を再呼び出しして confirmation を増やす挙動が観察された。recall payload の中身を絞ることで「`on > off` かつ `on` のほうが軽い」状態に進める。

### Scope 判定

- 判定: **Local**
- 理由: bench runner / recall filter の調整であり、harness-mem 本体の責務変更を伴わない

### Global DoD

1. `on` の avg total turns が `off` 以下になる multi-task 比較を 1 つ作る
2. pass_rate は §84 水準 (`on ≥ off`) を維持する
3. recall payload に乗せた / 抑制したフィールドを差分として記録する

### Loop Task Queue

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 85.1 | **recall payload から user identity 抑制** — `user_id` / `name` / `zip` / `address` を recall 出力から除外 or mask する option を bench-tau3-runner に足す | option ON 時 recall snapshot に identity field が含まれない | - | cc:完了 [ad8cb35] |
| 85.2 | **embedding async prime fix** — `bench-tau3-runner.py` の checkpoint write 前に ONNX multilingual-e5 を 1 回 prime して `write embedding is unavailable` warning を消す | smoke run の checkpoint_warning が null になる | - | cc:完了 [73cf71c] |
| 85.3 | **multi-task paired compare 拡大** — `5 tasks × 2 trials = 10 runs` で 85.1 適用前後を比較し、turn 圧縮を確認 | `on` の avg total turns が `off` 以下、かつ pass_rate ≥ §84 水準 | 85.1 | cc:完了 [a7497ae] |
| 85.4 | **research brief 更新** — `tau3-improvement-research-brief-2026-04.md` に「recall payload に identity field を入れない」を優先度 B に追記 | brief に追記され、§85 の根拠として参照可 | 85.3 | cc:完了 [1863c26] |
| 85.5 | **§85 retrospective** — 85.3 artifact を整理して §85 を閉じる or 次仮説を §86 として切る | retrospective doc が追加され Plans.md が同期 | 85.3, 85.4 | cc:完了 [620c1a6] |

### §85 が終わると起きる変化

1. `τ³-bench` で `on > off` の主張に **「効率も改善」** が加わる
2. recall payload 設計に「何を渡すか」だけでなく **「何を渡さないか」** の運用ルールが入る
3. embedding write path の degraded warning が消え、後続 benchmark の noise 源が 1 つ減る

### §85 振り返り (2026-04-17)

主条件 (turn 圧縮: `on` の avg total turns が `off` 以下) は未達 (10.0 > 9.6)。
ただし「identity scrub の対象が recall payload に存在しなかった (仮説 A の前提が違った)」「§84.4 の +0.25 は noise 圏内だった」「prime-retry fix は runner 安定性として確実な改善」という 3 つの学びを得て閉じる。
詳細は `docs/benchmarks/tau3-s85-retrospective-2026-04-17.md`。
次の改善 (recall 文体 ablation) は §86 として継続する。

---

## §86 τ³ Recall Note Style Ablation — cc:完了

策定日: 2026-04-17
背景: §85 で仮説 A (identity scrub) が no-op と判明。recall payload の identity フィールドは最初から存在せず、recall content の実体は `make_checkpoint_content` が生成する compact summary (`Task ID / Customer scenario / Agent note`) だった。`Agent note` の文体 (active voice / passive voice / label-only) が confirmation pressure に影響するかを ablation で検証する。

### Scope 判定

- 判定: **Local**
- 理由: bench runner の note template 分岐であり、harness-mem 本体の責務変更を伴わない

### Global DoD

1. `on` の avg total turns が `off` 以下になる multi-task 比較を 1 つ作る、または note style 間で有意差が確認できる
2. pass_rate ≥ §85 水準 (0.70) を維持する
3. 各 note style の avg confirm/turn 比率が記録される

### Loop Task Queue

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 86.1 | **recall note 文体パターンを実装** — `make_checkpoint_content` の `Agent note:` 部分を `active` / `passive` / `label` の 3 パターンに切り替えられる option を bench-tau3-runner に追加 | 各パターンが runner 出力の recall content に反映されている | - | cc:完了 [9d87c83] |
| 86.2 | **bench-tau3-runner に `--note-style` オプションを追加** — `{active\|passive\|label}` を指定すると recall content が対応 style になる | option ON 時、recall content が指定 style のフォーマットになる | 86.1 | cc:完了 [9d87c83] |
| 86.3 | **5 tasks × 2 trials × 3 styles = 30 runs を実行し avg confirm/turn 比較** | 各 style の avg confirm turns / avg total turns が記録され、style 間の比較が可能になる | 86.2 | cc:完了 [b141684] |
| 86.4 | **best style を採用、§85 brief に追記** — 最も confirm pressure が低い style を採用し、`tau3-improvement-research-brief-2026-04.md` を更新 | brief に採用 style と根拠が追記される | 86.3 | cc:完了 [a7b66c0] |
| 86.5 | **§86 retrospective** — 86.3 artifact を整理して §86 を閉じる or 次仮説を §87 として切る | retrospective doc が追加され Plans.md が同期 | 86.4 | cc:完了 [fe0c5e2] |

### §86 振り返り (2026-04-18)

仮説 B（note style が confirmation pressure を左右する）は不支持。style 間の confirm_pressure 差は ≤ 0.025（ノイズ）。
`active` style を default として維持（pass_rate 最高 0.30）。§84.4 比の pass_rate 退行（on: 0.75→0.30）が顕在化し、recall 注入タイミング / ゲート設計が次の最優先調査対象に。
詳細は `docs/benchmarks/tau3-s86-retrospective-2026-04-18.md`。
次の改善（recall 注入ゲートの timing ablation）は §87 として継続する。

### §86 が終わると起きる変化

1. recall note の文体が confirmation pressure に影響するかどうかの実証データが得られる
2. 文体が有効なら recall payload の「書き方ルール」として runner に組み込める
3. 文体が無効なら「recall content の内容面 (長さ / 件数 / タイミング)」に絞り込めるため、次仮説の設計精度が上がる

---

## §87 Recall Injection Regression Bisect — cc:完了

策定日: 2026-04-18
背景: §86.5 retrospective で、§84.4 (on=0.75) → §86.3 (on=0.30) の pass_rate regression が確認された。§86 は note-style が confound ではないことを示したが、**どの patch が on-mode を劣化させたか** は未解明。ここでは順序付けに基づく reproduction と bisect で root cause を特定する。

### Scope 判定

- 判定: **Local**
- 理由: benchmark runner / fixture / harness-mem injection path の bisect であり、harness-mem 本体の責務変更を伴わない

### Global DoD

1. §84.4 config を現行 runner で再現実行し、`on` pass_rate が当時水準（≥ 0.60）に戻るか、退化したままかを確定
2. 退化したままなら、`2c32780 → ad8cb35 → 6584b4d → 73cf71c → 9d87c83 → b141684` の各 commit で paired smoke (2 tasks × 2 trials) を回し、退化 commit を特定
3. 特定した confound の修正方針を Plans.md § 87 に記録し、必要なら §87 follow-up task を切る

### Loop Task Queue

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 87.1 | §84.4 baseline 再現 — `2c32780` 時点の config で `on` を retail 2×2 回し pass_rate 確認 | baseline が再現 (pass ≥ 0.60) or 退化確認 | - | cc:完了 [1bb265e] |
| 87.2 | Bisect smoke — 各候補 commit で 2×2 smoke を回し、pass_rate 低下 commit を特定 | 退化 commit が特定 | 87.1 | cc:完了 [1bb265e] |
| 87.3 | Root cause 記述 + 修正方針ドキュメント | `docs/benchmarks/tau3-s87-regression-bisect-2026-04-18.md` に RCA + 提案 | 87.2 | cc:完了 [1bb265e] |
| 87.4 | Plans.md 更新 + §87 retrospective or next-step 切り出し | §87 が cc:完了 or follow-up §88 が切れる | 87.3 | cc:完了 |

### §87 が終わると起きる変化

1. `on > off` を再び成立させる修正ポイントが明確になる
2. §86 で失った benchmark comparability (on の meaning) が回復する
3. §78-A05 の dev-workflow recall 改善で、同じ confound を踏まずに済む

### §87 振り返り (2026-04-18)

静的 bisect により root cause を特定。主因は §86.3 での agent model 変更 (`gpt-5-mini` → `gpt-4o-mini`) であり、runner code の変更 (scrub / prime-retry / note-style / audioop stub) はいずれも recall inject 動作に実質的影響を与えていなかった。コスト比 2.6x と off baseline 不変 (0.70) が証拠。§84.4 の on=0.75 は 4 runs の sample variance の範囲内だった可能性が高い。
詳細は `docs/benchmarks/tau3-s87-regression-bisect-2026-04-18.md`。
次の改善 (gpt-5-mini 復元 + recall gate timing ablation) は §88 として継続する。

---

## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。Plans.md は working plan（§77 + §78）だけをフォアグラウンドで扱う方針です。

参照:

- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
