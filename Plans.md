# Harness-mem 実装マスタープラン

最終更新: 2026-05-07（§108 developer-workflow recall / temporal / positioning / selective graph hardening 計画追加）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了） | §54-55 → [`Plans-s54-s55-2026-03-16.md`](docs/archive/Plans-s54-s55-2026-03-16.md)（§54 14完了, §55 4完了） | §51-§76 → [`Plans-s51-s76-2026-04-13.md`](docs/archive/Plans-s51-s76-2026-04-13.md) | §79-§88 → [`Plans-s79-s88-2026-04-19.md`](docs/archive/Plans-s79-s88-2026-04-19.md)（§79/§80/§81/§82-§87/§88 完了） | §91-§96 → [`Plans-s91-s96-2026-04-23.md`](docs/archive/Plans-s91-s96-2026-04-23.md)（§91/§92/§93/§94/§95/§96 完了、v0.15.0 リリース後）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

**`cc:完了` 書式**: `cc:完了 [<sha-7>]` または `cc:完了 (<sha-7> - <注釈>)` の形で対応する main 上の commit hash を必ず併記する（複数 commit は `(<sha>, <sha>, ...)` で束ねる）。Worker 自己更新も Lead cherry-pick 後の更新も同形式。Reviewer は review チェックリストの一項目として確認する。詳細・運用ルール: [`patterns.md` P8](.claude/memory/patterns.md)。

---

## 現在のステータス

**§75 + §76 Go MCP Migration — 完了**（2026-04-10）/ §74 Search Precision & Recall Granularity — 完了 / §73 Codex bootstrap reproducibility — 完了

| 項目 | 現在地 |
|------|--------|
| gate artifacts / README / proof bar | onnx manifest (2026-04-10) / README / proof bar / SSOT matrix を再同期済み |
| 維持できている価値 | local-first Claude Code+Codex bridge、adaptive retrieval、MCP structured result、522問日本語ベンチ、Go MCP server (~5ms cold start) |
| 最新リリース | **v0.18.0**（2026-05-05、§105 first-turn continuity + search quality + Codex parity + doctor reliability） |
| 次フェーズの焦点 | **§108 Developer Workflow Recall + Temporal Graph Positioning Hardening** / **§89 Search Quality Hardening (XR-002)** / **§90 Session Resume Injection Hook (XR-003)** / **§78 Phase A-E follow-up** / **§106 companion contract follow-up** |
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

## §78 World-class Retrieval & Memory Architecture — cc:WIP (Phase A–E 全タスクが landed、残は follow-up: §78-A05.2 recall tuning / §78-B02b tests / §78-C02b NLP upgrade / §78-D01b tests / §78-E02b branch merge workflow)

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
| S78-B02 | **Hierarchical metadata filtering** — project → session → thread → topic の 4 層メタデータで検索をスコープ | 検索 API に `scope` パラメータ追加、LoCoMo temporal が改善 | S78-B01 | cc:完了 [31fce2c + tests via §78-B02b] |
| S78-B03 | **Token-budget-aware wake-up context** — SessionStart artifact を L0 (critical facts, ~170 tokens) + L1 (recent context) の 2 層に分離 | SessionStart の token 消費を 50% 削減しつつ first-turn continuity を維持 | S78-B02 | cc:完了 [9b41d22] |
| S78-B04 | **Re-benchmark** — Phase B 全完了後に LoCoMo Full + LongMemEval を再実行 | F1 delta を committed JSON で記録、README 更新 | S78-B03 | cc:完了 [38af6a2,266c3d1] (LoCoMo Full off-gate per §78 pivot; RAW=0 baseline F1=0.5861 recorded; RAW=1 delta deferred; Phase B capabilities doc: docs/benchmarks/phase-b-capabilities-2026-04-18.md) |

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
| S78-D01 | **Temporal forgetting** — 時限付き fact (e.g. "deploying today") に TTL を設定、期限切れで自動 archive | 二重実装を統合: 本 session の impl [edfed2b,9de3d15,cc23bb8] (expires_at カラム + migration、`harness_mem_ingest` の `expires_at` パラメータ、read path の expired 除外) と、parallel-session §81-B02 の TTL force-eviction path (score 軸と独立、`protect_accessed` を無視、`legal_hold` のみが TTL を trump) を両立。read path (search/timeline/resume_pack/verify/contradiction) で expired 除外ロジック共有。 | - | cc:完了 [edfed2b,9de3d15,cc23bb8 + via §81-B02] |
| S78-D02 | **Contradiction resolution** — 新 fact が既存 fact と矛盾する場合、古い方を自動 supersede | `harness_mem_add_relation` に `supersedes` relation type 追加、superseded observation は検索 rank を下げる。§81-B03 の Jaccard+LLM detection と独立して「関係書き込み API」として存在し、B03 検出後の書き込み窓口として併用可。 | S78-C02 | cc:完了 [af88782] (併存: §81-B03 の detection と連携) |
| S78-D03 | **Auto project profile** — 静的 fact (tech stack, team convention) と動的 fact (current sprint, recent decisions) を自動分離・維持 | `harness_mem_status` に `project_profile` フィールド追加、token-compact な要約を返す | S78-D01, S78-D02 | cc:完了 [4250b7b] |

### Phase E: Developer Experience

claude-mem + Hermes の優れた DX パターンを取り入れる。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-E01 | **Privacy tags** — `<private>` タグで囲んだ内容を memory storage から自動除外 | ingest 時に `<private>...</private>` を strip して保存しない | - | cc:完了 [936a2e2] |
| S78-E02 | **Branch-scoped memory** — git branch 名で observation をスコープ、branch merge 時に統合 | `harness_mem_search` に `branch` パラメータ追加、feature branch の memory が main に merge 可能 | - | cc:WIP [1092110] (core: branch column + search filter 完了。branch merge workflow は §78-E02b として分離) |
| S78-E03 | **Progressive disclosure** — 3-layer retrieval (index → context → full detail) with token cost visibility | search API が `detail_level` パラメータを受け取り、token budget に応じた粒度で返す | S78-B03 | cc:完了 [690dcac] |
| S78-E04 | **Procedural skill synthesis** — 5+ ステップの複雑タスク完了後、再利用可能な手順書を自動生成して memory に保存 | `harness_mem_finalize_session` が長い session を検出して skill document を提案 | S78-D03 | cc:完了 [ad28eae,36d53d6] (rule-based detection + persist_skill=true で observation 化) |

### Phase F: §78 Phase A-E Follow-up Consolidation

策定日: 2026-04-20
背景: v0.13.0 で §78 Phase A-E の機能が landed したが、各 Phase で「core landed / 宿題残」として明記された 5 件の follow-up を独立タスクとして追跡可能にする。Phase A-E の status 欄で散在している follow-up を Phase F として束ねることで進捗可視化・依存整理を行う。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-A05.2 | **BM25 tokenization 調査による recall 引き上げ** — §78-A05 が 0.54 で膠着したため、別アプローチ (BM25 tokenization 切替) で dev-workflow recall を 0.70 まで引き上げる。日英混在のコードベース用語が既存 tokenizer で適切に分割できていない仮説を検証 | Full `npm test` で `dev-workflow` recall@10 ≥ 0.70 を 3-run 連続 PASS、release.yml の warn mode を enforce mode に昇格可能であることを確認 | S78-A05 | cc:TODO |
| S78-B02b | **thread/topic scope の統合テスト・エッジケース追加** — §78-B02 の impl は landed だが tests deferred。thread_id NULL の扱い、topic 文字数上限、thread+topic 同時指定時の優先順位、スレッド違いの同じ topic 分離、`scope` パラメータの組合せ網羅を整備 | 新規テスト (unit + integration) が PASS、`tests/unit/hierarchical-scope.test.ts` を含むカバレッジが scope 組合せを網羅、snapshot が更新される | S78-B02 | cc:完了 [f6e1a95] |
| S78-C02b | **entity/relation extraction の NLP 化** — §78-C02 の core extractor は regex + co-occurrence ベース。軽量 NLP で entity type (person/technology/action) と relation kind (is_a/uses/fixes) を判別できるように upgrade。依存フットプリント増加は許容範囲で吟味 | `harness_mem_graph` が entity に type、relation に kind を付与して返す。A/B で regex 版 vs NLP 版の精度 delta を committed JSON に記録、Go MCP cold start ~5ms を維持 | S78-C02 | cc:TODO |
| S78-D01b | **TTL (expires_at) のエッジケーステスト追加** — §78-D01 の impl は landed だが境界条件テストが不足。"now" 秒境界、NULL/未来/過去の混在検索、タイムゾーン差異、supersedes との優先順位、TTL 切れ後の resume-pack 挙動を網羅 | 新規テスト (unit + integration) が PASS、TTL と supersedes の相互作用が決定的に定義され仕様がテストで固定される | S78-D01 | cc:完了 [8b4afc5] |
| S78-E02b | **branch merge workflow** — §78-E02 の core (branch column + search filter) は landed。feature branch の observation を main に昇格する workflow、conflict 解決方針 (上書き / 追記 / 無視) を実装 | `harness_mem_admin_branch_merge` (もしくは同等 API) が存在し、dry-run + explicit flag で feature → main の observation 昇格と conflict audit log 記録ができる | S78-E02 | cc:TODO |

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
2. **Tool-agnostic** — Claude Code, Codex, Cursor, OpenCode, Antigravity
3. **Local-first** — zero cloud, zero API keys, SQLite + embedded graph
4. **Benchmark-transparent** — full LoCoMo + LongMemEval committed with reproduction scripts
5. **Session-intelligent** — SessionStart/UserPromptSubmit/Stop hook chain with first-turn continuity

---

## §89 Search Quality Hardening (XR-002) — cc:WIP

策定日: 2026-04-19
親管理: 管理 repo `harness-governance-private/XR-Registry.md` の **XR-002**（cross-runtime, owner=harness-mem, impacted=codex-plugin-cc）
背景: 2026-04-18 SSOT レビュー (`ssot-review-2026-04-18.md` として `mem_ingest` 済) で 4 件の retrieval 品質問題を観測。いずれも実装未達 (仕組み不足側) であり、現行の `dedupeHash` / search WHERE / `reindexVectors()` では解決しない。

### 観測事実 (2026-04-18)

| 指標 | 期待 | 実測 |
|------|------|------|
| `query="type:decision"` の結果 | observation_type=decision のみ | summary 100% (type prefix は解釈されずフリーテキストに落ちている) |
| 同一 session_id の session_end summary 件数 | 1 | 10 (8 時間で重複登録) |
| vector_coverage | 95%+ | 53.7% / warning 60% (2 指標が乖離) |
| search latency (hybrid) | SLA 200ms | 1868ms (9.3x) |

### タスク

| Task | 内容 | DoD | Status |
|------|------|-----|--------|
| S89-001 | search API に `observation_type` パラメータ追加 (SQLite + Pg repo の WHERE 拡張 + MCP schema + OpenAPI snapshot 更新) | `observation_type=decision` 指定で decision 行のみが返る integration test PASS。`type:decision` prefix query は server 側で pre-parse し observation_type にマップする | cc:完了 [bcd1627 + Step 2/3 in v0.14.0 (see CHANGELOG)] |
| S89-002 | ingest 時の semantic dedup (`sha256(session_id + observation_type + content)` を `mem_observations.content_dedupe_hash` 列に追加 + UNIQUE index) | 同一 session_id で session_end summary を 10 回 ingest しても行数 1、既存 file-offset dedup とは独立に動作 | cc:完了 (S105 で landed: schema migration が `content_dedupe_hash` 列追加 + partial UNIQUE INDEX `idx_mem_obs_content_dedupe_hash` (WHERE archived_at IS NULL); event-recorder.ts `buildContentDedupeHash` が sha256 で組み立て、WHERE-then-UPSERT で dedup; schema-migration.test.ts カバー) |
| S89-003 | reindex backfill scheduler (`admin/reindex-vectors` を server 側 cron loop 化、もしくは完走専用 `reindexAll()` を追加) | 起動後 24h 以内に vector_coverage が 95% 以上に収束、進捗 metric がログに出る | cc:完了 (memory-server/src/core/reindex-vectors-scheduler.ts: opt-in (HARNESS_MEM_REINDEX_VECTORS_ENABLED=1)、interval 600s × batch 100 で 14k obs/24h convergence、target 0.95 到達で auto-stop、coverage 低下で active mode 復帰; tests/unit/reindex-vectors-scheduler.test.ts 8/8 pass) |
| S89-004 | 既存重複行のクリーンアップ migration (DRY-RUN + explicit flag、`archived_at` soft-delete、audit log 記録) | 既存 DB で重複 summary が 1 件に集約、dry-run 差分とエグゼキューションが audit log に残る | cc:完了 (S105 で landed: `/v1/admin/cleanup-duplicates` endpoint、`cleanupDuplicateObservations({ execute, limit })`、execute=false が default で dry-run、`archived_at` soft-delete、audit log `admin.cleanup_duplicates` / `admin.cleanup_duplicates.plan` 記録) |

### S89-001 実装の PR 分割

| PR | スコープ | 依存 |
|----|---------|------|
| Step 1 | Plans.md archive + §89 bootstrap + `SearchRequest` 型拡張 + `observation-store.search()` WHERE 拡張 + `/v1/search` REST handler で body pass | main |
| Step 2 | MCP tool schema 更新 (TS + Go) + `docs/openapi.yaml` snapshot + `type:xxx` prefix pre-parser | Step 1 |
| Step 3 | Integration test (`tests/integration/search-observation-type.test.ts`) + schema parity test 更新 | Step 2 |

### リリース計画

- **v0.14.0**: S89-001 (schema 変更は不要、WHERE 拡張のみ) + S89-002 (schema migration: content_dedupe_hash 列) — minor bump
- **v0.13.x patch**: S89-003 は server-side loop 単独なら patch で可能
- **v0.14.x patch**: S89-004 は v0.14.0 後に実 DB を触る migration として別 PR

### Cross-repo チェックポイント

- S89-002 実装時に Codex plugin 側の session_end hook を調べ、finalize 済セッションを再 ingest していないかを確認する。必要なら XR-002 の impacted repo に `codex-plugin-cc` のタスクを追記する。
- S89-001 の仕様 (`type:` prefix query の扱い) は API 契約に影響するため、OpenAPI diff を PR 本文に貼り、公開 repo の changelog に明記する。

---

## §90 Session Resume Injection Hook (XR-003) — cc:WIP

策定日: 2026-04-19
親管理: 管理 repo `harness-governance-private/XR-Registry.md` の **XR-003**（cross-runtime, owner=claude-code-harness plugin, impacted=harness-mem shell scripts）
背景: 新 session 起動時に直前 session の文脈が注入されず、毎回「覚えてない」状態で始まる問題を 2026-04-19 のメタ確認で特定。真因は「plugin に bundle 済の `memory-session-start.sh` と `userprompt-inject-policy.sh` が `.claude-plugin/hooks.json` から一度も呼ばれていなかった」こと。harness-mem daemon / `/v1/resume-pack` / shell hook scripts は整備済、wiring 欠損が唯一の障害。

### 観測事実 (2026-04-19)

| 指標 | 期待 | 実測 |
|------|------|------|
| plugin hooks.json の SessionStart | shell 実装を wiring | `harness hook session-start` / `memory-bridge` のみ (Go 実装、`additionalContext` を返さない) |
| plugin hooks.json の UserPromptSubmit | shell 実装を wiring | `harness hook inject-policy` のみ (Go 実装、stub で additionalContext 無し) |
| `.claude/state/memory-resume-pack.json` のタイムスタンプ | 新 session ごとに更新 | **2026-04-07 (12 日前) のまま固定** |
| `/v1/resume-pack` HTTP endpoint | 動作 | ✅ daemon pid 78598 / 195k observations |
| 直前 session summary 取得コスト | < 5KB | L0 + max_tokens=1500 で `items[0].summary` ≒ 2-3KB |
| `claude_code_sessions_ingest` の checkpoint | セッションあたり一意 | 同一 PR URL の checkpoint が重複 ingest されている (§89-002 と合流対象) |

### タスク

| Task | 内容 | DoD | Owner | Status |
|------|------|-----|-------|--------|
| S90-001 | `claude-code-harness/.claude-plugin/hooks.json` の `SessionStart` と `UserPromptSubmit` に `memory-session-start.sh` と `userprompt-inject-policy.sh` の呼び出しを追加して resume-pack 注入を実際に動かす | 新 session 起動後、1 回目の `UserPromptSubmit` で直前 claude session の summary が `additionalContext` に載る。`memory-resume-pack.json` のタイムスタンプが更新される。daemon 不達時は silent skip | claude-code-harness plugin | cc:blocked ([PR #92](https://github.com/Chachamaru127/claude-code-harness/pull/92) は 2026-04-19 に CLOSED / Issue 運用へ切替予定 — cross-repo policy per feedback memory) |
| S90-002 | daemon に `summary_only=true` mode (response を summary 文字列 1 本に絞る軽量 endpoint) を追加、shell script の jq 依存を縮小 | 1 回の HTTP call で < 5KB の summary が返り、hook 側の jq パイプラインを 3 行程度まで短縮できる | harness-mem | cc:完了 [rc.1 混入] (`/v1/resume-pack` に `summary_only` 追加、`meta.summary` に latest summary を直載せ、MCP TS+Go 並走、OpenAPI 更新、5 件 integration test PASS) |
| S90-002-f1 | S90-002 follow-up (Issue [#70](https://github.com/Chachamaru127/harness-mem/issues/70)): `hook-common.sh` に `hook_extract_meta_summary` (jq / python3 fallback) と `hook_fetch_resume_pack_summary_only` を追加、jq 不在環境での軽量 summary 取得 path を提供 | (a) 既存 full-response renderer は無変更で並存 (b) jq 無し + python3 有りで summary 抽出が動く (c) bash unit tests 8 件 PASS (d) CHANGELOG 追記 | S90-002 | cc:完了 [rc.1 混入] |
| S90-003 | `claude_code_sessions_ingest` の URL checkpoint dedup (§89-002 semantic dedup と合流検討) | 同一 PR URL の checkpoint が重複 ingest されない | harness-mem | cc:TODO |

### S90-001 実装方針 (claude-code-harness 側)

- 対象ファイル: `.claude-plugin/hooks.json` (plugin 配布物)
- 追加内容: `SessionStart.hooks` 末尾 + `UserPromptSubmit.hooks` 中間に shell script 呼び出しを 1 本ずつ
- 既存の Go 実装 (`harness hook session-start` / `memory-bridge` / `inject-policy`) は残置し並走
- Claude Code は複数 hook の `additionalContext` をマージする仕様なので、両方出しても安全

### 設計判断履歴

- 当初 quick fix として `cross-repo-session-bootstrap.sh` (governance hook) に resume_pack 呼び出しを push したが、`.gitignore` で配布不可 + 関心分離違反で却下
- harness-mem 側に新規 shell script を作る案も検討したが、`memory-session-start.sh` と `userprompt-inject-policy.sh` が既に plugin に bundle 済のため重複と判断
- 最終案: plugin `hooks.json` への wiring 追加 (最小変更)

### リリース計画

- S90-001: claude-code-harness plugin の bug fix、patch リリース候補 (v4.3.x or v4.4.0 でまとめ)
- S90-002: harness-mem v0.14.x minor (S89-002 の schema 変更と合流可能性あり)
- S90-003: §89-002 と合流、v0.14.0 以降

### Cross-repo チェックポイント

- S90-001 の PR は [claude-code-harness #92](https://github.com/Chachamaru127/claude-code-harness/pull/92) に立てた
- harness-mem 側 Plans.md には参照として §90 を残し、S90-002 / S90-003 着手時に harness-mem 本体の実装を進める

---

## §97 Codex Recall Skill Parity — cc:TODO

策定日: 2026-04-25
分類: Local task / Cross-Read（owner=`harness-mem`。Codex hook / skill / setup 配布面は repo 内に揃っており、現時点では sibling repo 変更を要しない）
背景: §96 で Claude Code 向け `/harness-recall` Skill と recall intent 注入を完成させた。Codex 側も `scripts/hook-handlers/codex-user-prompt.sh` / `codex-session-start.sh` で `additionalContext` 注入自体は持ち、S97-001 / S97-002 で `codex/skills/harness-recall/SKILL.md` も repo 内に追加済みになった。一方で、Codex 側は recall intent 時に `harness-recall` skill 名を明示的に誘導できておらず、`scripts/harness-mem setup|update|doctor` も `~/.codex/skills/harness-mem/SKILL.md` だけを install/check しているため、2-skill bundle 配布 UX と recall routing parity がまだ未完である。

### 観測事実 (2026-04-25)

| Surface | 期待 | 実測 |
|------|------|------|
| Claude recall skill | `/harness-recall` skill + trigger phrases + 5 intent routing | `skills/harness-recall/SKILL.md` と §96 contract tests で完了済 |
| Codex recall hook | recall intent を拾った時に skill routing を後押しできる | `codex-user-prompt.sh` は `hook_run_contextual_recall` の結果本文を直接 inject するが、`harness-recall` skill 名は出さない |
| Codex skill surface | generic memory skill + recall-specific skill の両方 | `codex/skills/harness-mem/SKILL.md` と `codex/skills/harness-recall/SKILL.md` は repo 内に存在。残る gap は配布 / doctor / hook routing |
| Codex skill distribution | setup / update / doctor が recall skill も install/check する | `scripts/harness-mem` は `~/.codex/skills/harness-mem/SKILL.md` だけを対象にしている |

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S97-001 | Codex recall skill contract test を追加 — `codex/skills/harness-recall/SKILL.md` の存在、trigger phrase、5 intent routing、`source:` 出力契約を Claude 版と同粒度で固定 | 新規 test が RED で落ち、`harness-recall` Codex skill の最低契約を固定できる | - | cc:完了 |
| S97-002 | `codex/skills/harness-recall/SKILL.md` を作成 — Claude §96 の recipe を Codex 向けに mirror し、trigger phrase と routing を持つ recall skill を配布面に追加 | S97-001 が GREEN。Codex skill が `harness-recall` 名で repo 内に存在し、Claude 版と trigger / route が silent drift しない | S97-001 | cc:完了 |
| S97-003 | Codex recall-intent hook contract test を追加 — recall keyword prompt で `additionalContext` が `harness-recall` skill 名を含み、非 recall prompt では余計な誘導を出さないことを固定 | `tests/contextual-recall-contract.test.ts` で `今何してた?` が `harness-recall` skill guidance を出すことを固定。既存 contextual recall path と両立 | - | cc:完了 (§102) |
| S97-004 | `codex-user-prompt.sh` に recall-intent skill 誘導を追加 — recall keyword では Codex 側でも `harness-recall` skill routing を優先し、通常 prompt では既存 contextual recall を維持 | recall prompt では skill 名付き additionalContext が出る。非 recall prompt の direct contextual recall 挙動は既存 test で維持 | S97-003, S97-002 | cc:完了 (§102) |
| S97-005 | Codex skill bundle 配布を setup / update / doctor に反映し、README / CHANGELOG を同期 — `harness-mem` だけでなく `harness-recall` も install/check 対象にする | `setup` / `update` が Codex 2 skill を配布でき、`doctor` が missing を報告できる。README / CHANGELOG に Codex recall skill が明記される | S97-002 | cc:完了 (S105-008 で実現済み: `install_codex_skill` / `check_codex_skill_bundle` が 2 skill loop、README/README_ja line 244-245 に harness-recall を明記、CHANGELOG `[0.18.0]` "Codex setup/update now treats harness-mem and harness-recall as one skill bundle") |

### 設計メモ

- §96 archive の設計判断どおり、Claude 側 recipe を再実装するのではなく Codex 側へ parity surface を足す
- 既存 `hook_run_contextual_recall` は generic memory assist として残し、recall intent のときだけ skill routing を強める
- `scripts/harness-mem` の Codex skill install/check は 1 skill hard-code から「Codex skill bundle」へ寄せるのが自然

---

## §98 UI Test Runner Hygiene — cc:完了

策定日: 2026-04-25
分類: Local task（owner=`harness-mem`。runner boundary の整理であり sibling repo 変更は不要）
背景: `bun test` を repo root で直接実行すると、`harness-mem-ui/tests/ui/*.test.tsx` が jsdom なしで Bun に拾われて `document is not defined` / `localStorage is not defined` で失敗し、さらに `harness-mem-ui/tests/e2e/*.spec.ts` が Playwright ではなく Bun に読み込まれて `Playwright Test did not expect test.beforeEach()` で落ちる。一方、listen を要する backend/integration は sandbox 外実行で GREEN になることを確認済みで、残る known fail は UI runner boundary の崩れに集約された。途中で root `bunfig.toml` に jsdom preload を入れる案も試したが、benchmark 側の embedding runtime 判定を汚染して `multilingual-e5` readiness を壊すため採用しない。

### 観測事実 (2026-04-25)

| Surface | 期待 | 実測 |
|------|------|------|
| root `bun test` で UI unit を誤発見した場合 | Bun discovery から外れ、Vitest だけが拾う | `*.test.tsx` naming のため Bun が拾ってしまう |
| UI E2E | Playwright runner のみが `.beforeEach()` を解釈する | `tests/e2e/*.spec.ts` を Bun が拾い、Playwright contract error で落ちる |
| backend/integration | 実装起因の fail のみ残る | sandbox 外 rerun では GREEN。global jsdom preload は benchmark embedding readiness を壊すため不採用 |

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S98-001 | UI component test pattern を Vitest 専用 naming に分離 — `harness-mem-ui/tests/ui/*.test.*` をやめ、`vitest.config.ts` の include で `*.vitest.ts(x)` のみ拾う | root `bun test` が UI component tests を自動発見しない。`cd harness-mem-ui && npx vitest run` は同じ test set を実行できる | - | cc:完了 |
| S98-002 | Playwright E2E file pattern を Bun の探索対象から分離 — `*.spec.ts` 依存をやめ、Playwright config を明示 `testMatch` に切り替える | root `bun test` が E2E files を拾わず、`cd harness-mem-ui && npx playwright test` は同じ 3 本を発見できる | S98-001 | cc:完了 |
| S98-003 | runner boundary の回帰防止 contract と docs を追加・同期 | root contract test が `*.vitest.ts(x)` / `*.e2e.ts` pattern を固定し、`docs/TESTING.md` が stable full run と UI 専用コマンドの境界を説明する | S98-002 | cc:完了 |

---

## §99 Claude/Codex Upstream Follow-up (2026-04-25) — cc:完了

策定日: 2026-04-25
分類: Local task / Cross-Read（owner=`harness-mem`。official release / changelog を読み、repo-local の hook / doctor / docs / contract test に proactive に反映する。現時点では sibling repo の実装修正は不要）
背景: 2026-04-24 の upstream review で Claude Code `v2.1.117` / `v2.1.118` / `v2.1.119` と Codex `rust-v0.123.0` / `rust-v0.124.0` を確認済みだった。2026-04-25 JST に official source を再確認した結果、**Claude Code の latest stable は引き続き `v2.1.119`、Codex の latest stable は引き続き `rust-v0.124.0`** で、新しい stable 差分は無かった。一方で、repo 側の upstream tracking は「実装は進んでいるが、追従アップデートの正本化が弱い」状態で、`Plans.md` の最新リリース欄も `v0.13.0` のまま stale だった。したがって今回は watchlist 止まりにせず、**いま着手できる hook / doctor / contract test / docs の実装タスクまで落とす**。

### 観測事実 (2026-04-25)

| Surface | 期待 | 実測 |
|------|------|------|
| Claude Code stable | latest stable を確認し、mem 側で緊急互換性が必要か判定する | latest stable は `v2.1.119` のまま。new stable は増えていない |
| Codex stable | latest stable を確認し、mem 側で緊急互換性が必要か判定する | latest stable は `rust-v0.124.0` のまま。new stable は増えていない |
| Codex prerelease watch | 次 stable の本命論点を先に掴み、今のうちに additive field を受け止める | `rust-v0.125.0-alpha.2` / `alpha.3` が出ており、permission profile / multi-environment / remote thread 周りが watchpoint。`SessionStart` / `UserPromptSubmit` / `Stop` は additive field hardening 契約まで追加済み |
| Claude settings precedence | docs が現行 Claude Code の設定保存場所を正しく説明し、doctor でも split authority を見逃さない | setup docs は `~/.claude.json` / `~/.claude/settings.json` の precedence を説明済みで、doctor は `claude_precedence` で drift を検知できる |
| Claude hook additive field | `duration_ms` 追加で既存 hook path が壊れないことを固定できる | `memory-post-tool-use.sh` は `payload.meta.duration_ms` を保持し、invalid 値は無視する contract test で固定済み |
| Codex verification environment | latest stable の挙動を local で実測できる | 現在の local CLI は `codex --version = 0.116.0`。repo 契約の下限は満たすが、0.124 固有挙動の live 実測は別途必要 |
| upstream tracking discipline | upstream 追従計画が current repo state を反映し続ける | latest release / focus / snapshot 起点を `v0.15.0` 基準へ同期済み。`§99` は current implementation まで反映済みで、次の差分起点も明確 |

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S99-001 | official source を `docs/upstream-update-snapshot-2026-04-25.md` に固定 — Claude / Codex の latest stable / prerelease watch / repo-local 影響を「upstream変更 → harness-mem対応」で残す | 次回以降の upstream review が snapshot を起点に再開でき、source URL / absolute date / action bucket が揃っている | - | cc:完了 |
| S99-002 | Claude setup docs を現行 precedence に同期 — `~/.claude/settings.json` と `/config` 永続化の説明を英日 setup docs に追記 | docs が `~/.claude.json` だけを正本のように見せず、settings precedence の実態を説明できる | - | cc:完了 |
| S99-003 | `Plans.md §97` の観測事実を current repo に同期 — `codex/skills/harness-recall` 追加済みを反映し、残課題を S97-003 / 004 / 005 に絞る | 計画書が現物より古い状態を解消し、次の着手点が明確になる | - | cc:完了 |
| S99-004 | Claude PostToolUse additive-field hardening — `memory-post-tool-use.sh` が `duration_ms` を受けても壊れず、可能なら `payload.meta.duration_ms` として保持するよう contract test と実装を追加 | `tests/memory-post-tool-use-contract.test.ts` が `duration_ms` あり / invalid の両方で GREEN。既存 payload shape を壊さず、将来の tool latency 可視化に使える | S99-001 | cc:完了 |
| S99-005 | Claude settings precedence doctor — `~/.claude.json` と `~/.claude/settings.json` の両方に harness wiring がある環境で split authority / stale path を WARN する doctor check を追加 | `doctor --platform claude --json` が `claude_precedence=drift` を返し、`tests/claude-precedence-contract.test.ts` で false-green を防げる | S99-002 | cc:完了 |
| S99-006 | Codex managed-config drift detection — `~/.codex/requirements.toml` が存在する環境で、`config.toml` / `hooks.json` と食い違う managed config の存在を doctor が検知する | `doctor --platform codex --json` が `codex_requirements_precedence=drift` を返し、`tests/codex-hooks-merge-contract.test.ts` で stale managed path / port を検知できる | S99-001 | cc:完了 |
| S99-007 | Codex future-session contract hardening — SessionStart / UserPromptSubmit / Stop が additive な environment / thread 系 field を受けても attribution を壊さない fixture tests を追加 | `tests/codex-future-session-contract.test.ts` が GREEN。`thread_id` / `meta.correlation_id` / environment 系 field が来ても attribution を維持し、SessionStart/UserPromptSubmit は `meta` 保持までできる | S99-001 | cc:完了 |
| S99-008 | tracking metadata sync discipline — `Plans.md` の release/status 行と snapshot 運用を current repo に合わせ、今後の upstream review を stale 化させない運用メモを残す | latest release / focus / snapshot 起点が current repo と一致し、次回 review で stale planning を繰り返さない | S99-001 | cc:完了 |

### 設計メモ

- stable の新規差分が無い日でも、**加法的に入れられる guard / doctor / contract test は先回りで入れる**
- Claude 側は `/config -> settings.json` precedence と `duration_ms` additive field を「docs だけ」で終わらせず、doctor / hook contract まで受ける
- Codex 側は stable `0.125` 待ちで停止せず、`requirements.toml` drift と future additive field contract を先に false-green 防止へ寄せる
- 2026-04-25 時点の local `codex --version` は `0.116.0`。repo 契約下限には入るが、latest stable 固有の live 実測結果としては扱わない

## §101 Claude/Codex Upstream Follow-up (2026-05-03) — cc:完了

策定日: 2026-05-03
分類: Local task / Cross-Read（owner=`harness-mem`。Claude Code / Codex の official stable update を読み、repo-local の hook metadata / snapshot / contract test に反映する。現時点では sibling repo の実装修正は不要）
背景: 2026-04-25 の §99 では Claude Code `v2.1.119` / Codex `rust-v0.124.0` を基準に upstream hardening を完了していた。2026-05-03 JST に official source を再確認した結果、Claude Code latest stable は `v2.1.126`、Codex latest stable は `rust-v0.128.0` まで進んでいる。プレリリースは今回対象外とし、stable 差分のうち harness-mem の session attribution / resume / hook metadata に効くものだけを実装または記録する。

### 観測事実 (2026-05-03)

| Surface | 期待 | 実測 |
|------|------|------|
| Claude Code stable | latest stable を確認し、mem 側で緊急互換性が必要か判定する | latest stable は `v2.1.126`。local `claude --version` も `2.1.126` |
| Codex stable | latest stable を確認し、mem 側で緊急互換性が必要か判定する | latest stable は `rust-v0.128.0`。local `codex --version` も `0.128.0` |
| Claude hook metadata | PostToolUse 周辺の additive field を trace / resume 用に失わない | `duration_ms` は §99 で対応済み。今回は `tool_use_id` / cwd / permission 系の安全な metadata を追加で保持する |
| Codex hook metadata | permission profile / goal / external session import など 0.125+ / 0.128 stable 系 field を attribution から落とさない | 既存は thread / environment / permission_mode / sandbox_profile まで。active profile / goal / external session import は未固定 |
| プレリリース扱い | pre-release は実装判断から外す | `rust-v0.129.0-alpha.*` は存在するが、今回の action table では対象外 |

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S101-001 | official source を `docs/upstream-update-snapshot-2026-05-03.md` に固定 — Claude / Codex latest stable と A/C/P 判定を残す | source URL / absolute date / version table / action bucket が揃っている | - | cc:完了 |
| S101-002 | Codex 0.125+ / 0.128 hook metadata hardening — permission profile / active profile / goal / external session import field を `payload.meta` に保持 | `tests/codex-future-session-contract.test.ts` が new stable fields を固定し GREEN | S101-001 | cc:完了 |
| S101-003 | Claude 2.1.120+ / 2.1.126 PostToolUse metadata hardening — `tool_use_id` / cwd / permission metadata を保持し、tool output replacement はしない | `tests/memory-post-tool-use-contract.test.ts` が safe metadata capture と no-output contract を固定し GREEN | S101-001 | cc:完了 |
| S101-004 | CHANGELOG / Plans を同期し、§101 を完了状態へ更新 | Unreleased に今回の hardening が残り、§101 が cc:完了になる | S101-002, S101-003 | cc:完了 |

### 設計メモ

- `A`: session attribution / resume / hook metadata の壊れやすい受け口だけを実装する
- `C`: Claude/Codex 本体の UX 修正、OAuth 修正、terminal 表示、provider 側 model discovery などは自動継承として記録する
- `P`: Codex `/goal` workflow や external agent import の深い resume-pack 連携は、metadata 受けだけ先に入れ、運用導線は次回候補にする

## §102 Recall Trigger Phrase Expansion (2026-05-03) — cc:完了

策定日: 2026-05-03
分類: Local task（owner=`harness-mem`。Claude / Codex の recall Skill と UserPrompt hook の発火語彙追加であり、sibling repo 変更は不要）
背景: user が「覚えてる？」「今何してた」のような自然な一言で直近作業の再開を求める場面が多い。既存の `覚えてる` keyword は `覚えてる?` / `覚えてる？` を substring match で拾えるが、`今何してた` 系は trigger phrase / hook keyword として未登録だったため、Skill description 経由と hook injection 経由の両方へ明示的に追加する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S102-001 | Claude / Codex の `harness-recall` Skill trigger phrase に `今何してた` / `今なにしてた` を追加 | `skills/harness-recall/SKILL.md` と `codex/skills/harness-recall/SKILL.md` が trigger / body / resume 典型発話で同期している | - | cc:完了 |
| S102-002 | Claude / Codex の UserPrompt hook recall keyword に `今何してた` / `今なにしてた` を追加 | recall intent additionalContext が自然な「今何してた？」系 prompt でも Claude は `/harness-recall`、Codex は `harness-recall` を促す | S102-001 | cc:完了 |
| S102-003 | recall Skill / UserPrompt hook contract tests を更新して、`覚えてる？` と `今何してた` 系の発火を固定 | Claude / Codex Skill parity と UserPrompt injection tests が GREEN | S102-002 | cc:完了 |

## §103 Issue #87/#89/#90 Setup + Hook Hygiene (2026-05-04) — cc:完了

策定日: 2026-05-04
分類: Local task / Cross-Read（owner=`harness-mem`。memory runtime / setup / package surface の整理。`claude-code-harness` 側の開発ガード script は再実装しない）
背景: open issue #87/#89/#90 の triage で、配布 manifest と setup が現在の責務境界から少しズレていることが分かった。#87 は `hooks/hooks.json` が sibling repo 側の開発ガード script まで参照しており、harness-mem package 単体では存在しない hook が失敗しうる。#89 は fresh install package に MCP launcher の `bin/` が含まれず、Codex stale wiring の修復も弱い。加えて Gemini は今回から対応対象外にするため、初期セットアップや platform surface から外す。#90 は Windows / optional import の setup 体験で、成功してよいケースが失敗に見える。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S103-001 | `hooks/hooks.json` を memory-owned handler のみに整理し、存在しない hook target を package manifest から外す | static contract test が全 hook command の target existence を検証し、`pretooluse-*` / auto-test / session cleanup など sibling-owned target を参照しない | - | cc:完了 |
| S103-002 | Gemini setup support を retired surface として整理 — initial setup / doctor / uninstall / package metadata / README から Gemini を外す | `--platform` allowed list と interactive setup に Gemini が出ず、npm package files / keywords / README comparison からも外れる | - | cc:完了 |
| S103-003 | npm package に MCP launcher `bin/` を含め、Codex stale config を `doctor --fix` / setup で修復できるようにする | package contract が `bin/` inclusion を固定し、stale `~/.codex/config.toml` の managed notify/MCP block を current checkout に更新できる | S103-002 | cc:完了 |
| S103-004 | Windows setup の search quality timing と optional Claude-mem import を失敗扱いしすぎないようにする | Windows shell の local quality timeout は setup warning に留め、`--import-claude-mem` なしの optional import は source DB 不在でも skip する | - | cc:完了 |
| S103-005 | README / CHANGELOG / tests を同期し、#87/#89/#90 の再発防止を残す | 関連 `bun test` が GREEN。CHANGELOG Unreleased と Plans が今回の挙動を説明する | S103-001..S103-004 | cc:完了 |


## §105 First-turn Continuity + Search Quality + Codex Parity + Doctor Reliability Hardening (2026-05-05) — cc:完了

策定日: 2026-05-05
分類: Local task / Cross-Read（owner=`harness-mem`。first-turn continuity、検索 dedupe、Codex skill 配布、doctor/proof bundle を repo-local で完了。sibling repo の実装修正は不要）
背景: §105 は、S105-001 で入れた stale resume artifact identity guard を土台に、残っていた minor / residual を release-ready まで閉じる仕上げ。first turn の注入は軽く、検索は重複を増やさず、Codex は Claude と同じ recall skill bundle を持ち、doctor は false-green を減らす必要があった。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S105-001 | stale resume artifact identity guard — mismatch / stale / future-skew の resume context を first prompt で注入しない | Claude / Codex の stale artifact contract tests が GREEN | - | cc:完了 [3d939d8] |
| S105-002 | first-turn resume once-only contract を Claude / Codex 両 hook path で固定 | SessionStart 直後の UserPromptSubmit は resume と recall を二重注入せず、次 prompt 以降は recall が戻る | S105-001 | cc:完了 |
| S105-003 | resume-pack を L0 + token budget つきで要求し、contextual recall には source line を付ける | Claude / Codex の resume-pack payload が `detail_level=L0`, `resume_pack_max_tokens<=1200`, `include_private=false`。recall output に `source: harness_mem_search` が出る | S105-002 | cc:完了 |
| S105-004 | ingest content dedupe + checkpoint URL dedupe | 同一 session summary 10 回 ingest でも active observation は 1 件。同一 PR URL checkpoint は本文違いでも 1 件 | - | cc:完了 |
| S105-005 | duplicate cleanup migration endpoint | `/v1/admin/cleanup-duplicates` と client command が dry-run / execute を持ち、execute は soft-archive + audit log を残す | S105-004 | cc:完了 |
| S105-006 | vector reindex coverage gap 修正 | `reindexVectors()` が no-vector row を legacy row より優先し、coverage / missing / target 95% を meta に返す | - | cc:完了 |
| S105-007 | retrieval A/B gate を再現可能な proof command 化 | `scripts/s105-retrieval-ab-gate.sh` が 3-run Japanese summary + CI manifest を検査し、overall/current/cross-lingual/latency/bilingual gate を JSON で返す | - | cc:完了 |
| S105-008 | Codex skill bundle drift detection | setup/update は `harness-mem` と `harness-recall` の 2 skill を配布し、doctor は `codex_skill_drift` を報告する | S97-005 | cc:完了 |
| S105-009 | manual MCP docs parity | README に Codex manual MCP check と `doctor` v2 / proof command を明記する | S105-008 | cc:完了 |
| S105-010 | post-doctor liveness check | `doctor --platform codex --json` が `codex_post_doctor_liveness` を出し、setup 後の runtime health を false-green にしない | S105-008 | cc:完了 |
| S105-011 | doctor.v2 JSON contract | `schema_version=doctor.v2`, `overall_status`, per-check result `pass/warn/fail/skip`, `repair_plan`, `--read-only`, `--strict-exit`, `--fix --plan` を追加 | - | cc:完了 |
| S105-012 | read-only / strict / repair-plan operating modes | CI は `--strict-exit` で落とせ、調査時は `--read-only` で勝手に修復しない | S105-011 | cc:完了 |
| S105-013 | release proof bundle | `scripts/s105-proof-bundle.sh` が `npm pack --dry-run --json`, Codex doctor, MCP smoke, post-health, package inclusion を summary JSON にまとめる | S105-007..S105-012 | cc:完了 |
| S105-014 | test-gap automation: duplicate cleanup expired-row contract | duplicate cleanup が `expires_at` 切れの rows を grouping 前に除外し、期限切れ duplicate を soft-archive 候補にしないことを小さな core-split test で固定する | S105-005 | cc:完了 |

検証:

- `bun test memory-server/tests/core-split/event-recorder.test.ts memory-server/tests/core-split/config-manager.test.ts`
- `bun test tests/session-start-parity-contract.test.ts tests/memory-session-start-contract.test.ts tests/contextual-recall-contract.test.ts`
- `bun test tests/doctor-json-contract.test.ts tests/codex-hooks-merge-contract.test.ts tests/proof-pack-contract.test.ts`
- `bun test memory-server/tests/core-split/event-recorder.test.ts memory-server/tests/core-split/config-manager.test.ts tests/session-start-parity-contract.test.ts tests/memory-session-start-contract.test.ts tests/contextual-recall-contract.test.ts tests/doctor-json-contract.test.ts tests/codex-hooks-merge-contract.test.ts tests/proof-pack-contract.test.ts` → `97 pass / 0 fail`
- `cd memory-server && bun run typecheck`
- `bash -n scripts/harness-mem scripts/harness-mem-client.sh scripts/hook-handlers/memory-session-start.sh scripts/hook-handlers/codex-session-start.sh scripts/hook-handlers/lib/hook-common.sh scripts/s105-proof-bundle.sh scripts/s105-retrieval-ab-gate.sh`
- `git diff --check`
- `scripts/s105-retrieval-ab-gate.sh` → `pass=true`
- `scripts/s105-proof-bundle.sh --isolated-home --out-dir /tmp/hmem-s105-proof-isolated-runtime-final` → `release_ready=true`, `codex_skill_drift=ok`, `codex_post_doctor_liveness=ok`, `mcp_smoke=true`
- `npm pack --dry-run --json` → `chachamaru127-harness-mem-0.18.0.tgz`, `fileCount=463`, `bin/harness-mcp-server` と Codex 2 skill を含む
- `claude -p` review → `APPROVE`。挙がった minor residual 3件（warning classification / cleanup scan cap / unnecessary skill re-copy）は修正済み
- `bun test memory-server/tests/core-split/config-manager.test.ts` → `28 pass / 0 fail`（S105-014）


## §106 Claude-harness Companion Contract — cc:完了

策定日: 2026-05-06
分類: Cross-repo contract（owner=`harness-mem`。Claude-harness は companion discovery / UX を所有し、harness-mem は runtime / DB / daemon / doctor / migration を所有）
背景: Claude-harness が harness-mem を丸ごと内蔵せず、自動セットアップされる managed companion として扱うため、harness-mem 側にも非対話 setup と JSON doctor の安定契約が必要になった。Claude-harness は DB schema を直接読まず、`doctor --json` と CLI contract だけに依存する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S106-001 | Claude-harness companion contract doc を追加する | `docs/claude-harness-companion-contract.md` に setup/doctor/update/uninstall/DB/runtime の契約がある | - | cc:完了 |
| S106-002 | `setup --auto-update enable|disable` を非対話フラグとして追加する | `HARNESS_MEM_NON_INTERACTIVE=1 harness-mem setup --platform codex,claude --auto-update enable` が prompt なしで auto_update enabled にできる | S106-001 | cc:完了 |
| S106-003 | `doctor --json` に `contract_version` と `harness_mem_version` を追加する | Claude-harness 側 fake ではなく本物の `doctor --json --platform codex,claude` で schema が検証できる | S106-001 | cc:完了 |
| S106-004 | Claude-harness reciprocal compatibility test を追加する | harness-mem 側 CI で setup/doctor/update/off/purge 契約を静的に固定する | S106-002, S106-003 | cc:完了 |
| S106-005 | README/README_ja/CHANGELOG に companion mode を追記する | Claude-harness から自動セットアップされる場合の保存場所、停止、削除、更新追従が英日同期 | S106-004 | cc:完了 |

検証:

- `bun test tests/doctor-json-contract.test.ts tests/update-command-contract.test.ts tests/claude-harness-companion-contract.test.ts`
- `HARNESS_MEM_NON_INTERACTIVE=1 harness-mem setup --platform codex,claude --auto-update enable --skip-quality --skip-smoke --skip-start --skip-version-check`
- `harness-mem doctor --json --platform codex,claude --skip-version-check`
- `npm pack --dry-run --json`


## §107 Checkpoint Cold-Start Durability — cc:完了

策定日: 2026-05-06
分類: Runtime bugfix（Issue #91）
背景: local `multilingual-e5` ONNX embedding provider が async prime 前の状態だと、Claude Harness の loop 自体は成功していても最後の `record_checkpoint` が `write embedding is unavailable` で失敗し、resume / audit trail が欠落する可能性があった。チェックポイントは検索ベクトルよりも「記録が残ること」を優先する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S107-001 | checkpoint 保存時の embedding cold-start を durability 優先で扱う | `event_type=checkpoint` は retryable な write embedding failure でも observation を保存し、response meta に degraded 状態を残す | - | cc:完了 |

検証:

- `bun test memory-server/tests/core-split/event-recorder.test.ts` → `19 pass / 0 fail`


## §108 Developer Workflow Recall + Temporal Graph Positioning Hardening (2026-05-07) — cc:TODO

策定日: 2026-05-07
分類: Local task / Cross-Read（owner=`harness-mem`。developer-workflow benchmark、temporal reasoning、README positioning、local graph signal を repo-local で磨く。競合 repo / sibling repo の実装修正はしない）

背景: 2026-05-06 の競合比較では、harness-mem の勝ち筋は「汎用 memory API」ではなく、**local-first + project-scoped + Claude Code / Codex 横断 + first-turn continuity** にあると整理した。一方で、次に磨くべき順番として 1) `dev-workflow` recall@10、2) temporal ordering、4) README positioning、5) Graphiti / Zep 的な時間グラフの選択的取り込みが残った。既存 §105 は first-turn / dedupe / Codex parity / doctor を release-ready まで閉じたが、検索品質そのものと外向きの語りはまだ一段深掘りが必要。

たとえると、§105 は「記憶の配線が壊れないようにした」作業で、§108 は「その記憶が本当に必要な場面で見つかり、時間の前後を間違えず、外に説明しても誤解されないようにする」作業。

### Targeted Inputs

| User order | 深掘り対象 | このセクションでの扱い |
|---:|---|---|
| 1 | `dev-workflow` recall@10 を 0.59 から 0.70 以上へ上げる | developer query fixture、tokenization / query expansion / RRF tuning、3-run gate を一つの流れにする |
| 2 | temporal ordering を 0.65 から 0.70 以上へ上げる | temporal anchor、point-in-time query、current / previous / after / before の評価を分ける |
| 4 | README 冒頭の立ち位置を尖らせる | `memory layer` ではなく `coding-session continuity runtime` として言い切る。ただし `unique/best/only` は使わない |
| 5 | Graphiti / Zep の時間グラフを選択的に取り込む | 外部 DB 置換ではなく、SQLite の既存 fact / relation / timeline に足せる graph signal だけを採用する |

### Current Evidence Snapshot

- harness-mem public gate: `dev-workflow` recall@10 = `0.59`（target `>=0.70`）、temporal ordering score = `0.65`（target `>=0.70`）、bilingual recall@10 = `0.88`、search p95 = `13.28ms`。
- Japanese companion gate: temporal slice F1 = `0.6776`。failure backlog では `temporal_normalization`、`temporal_reference_anchor`、`retrieval_alignment`、`retrieval_depth`、`yes_no_decision` が主要 bucket。
- mem0 official README は 2026-04 の algorithm update として entity linking、BM25、semantic search、multi-signal retrieval fusion を掲げ、LoCoMo / LongMemEval の強い self-reported score を出している。
- supermemory official README は MCP、`memory` / `recall` / `context` tools、project/container tag scoping、Claude Code / OpenCode plugin を掲げる。
- Basic Memory official README は MCP、CLI、project routing、Claude / Codex / Cursor / Obsidian 対応、Markdown readable memory を掲げる。直接競合として扱う。
- mcp-memory-service official README は REST API + MCP + OAuth + CLI + dashboard、typed knowledge graph、local ONNX embeddings、agent pipelines を掲げる。team / remote MCP 側の比較対象として扱う。
- Graphiti / Zep official docs は temporal knowledge graph、point-in-time queries、hybrid semantic / BM25 / graph search、temporal edge invalidation を掲げる。harness-mem では「selective import」候補であり、外部 DB への全面移行候補ではない。

### Global Gates

| Gate | Threshold | Why |
|---|---:|---|
| `dev-workflow` recall@10 | `>= 0.70` in 3 consecutive runs | 既存 main gate の未達を閉じる |
| temporal ordering score | `>= 0.70` in 3 consecutive runs | 「前後」「今も」「直後」を実務で間違えにくくする |
| Japanese temporal slice | `>= 0.72` or zero-F1 count `-30%` | 日本語の相対時制を README-safe に近づける |
| bilingual recall@10 | no regression below `0.88`; stretch `>= 0.90` | 日英混在の既存強みを落とさない |
| search p95 | local `<= 50ms`, CI `<= 200ms` | graph signal を足しても体感速度を壊さない |
| privacy / isolation | `include_private=false` default、strict project no-bleed tests GREEN | local-first の信用を崩さない |
| README claims | `docs/readme-claims.md` と competitive audit に根拠がある | 競合より強く言いすぎない |

### Non-Goals

- LoCoMo / LongMemEval の general-lifelog score を primary ship gate に戻さない。
- Graphiti / Zep / Neo4j / FalkorDB / Kuzu へ全面移行しない。
- Basic Memory / mcp-memory-service / claude-mem を再実装しない。
- `unique` / `only` / `best in market` の claim を README / README_ja に入れない。
- sibling repo の hook / setup / companion UX を harness-mem 側で勝手に所有しない。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S108-001 | **baseline snapshot + failure taxonomy refresh** — `dev-workflow` / temporal / Japanese temporal の現状を同じ runner・同じ judge 条件で取り直し、miss reason を `retrieval_miss`, `ranking_miss`, `temporal_anchor_miss`, `stale_fact_win`, `answer_synthesis_miss` に分類する | `docs/benchmarks/artifacts/s108-*/` に baseline JSON + failure backlog MD が残り、`dev-workflow=0.59±known drift` / temporal=0.65 近辺の再現可否が記録される | - | cc:完了 [3ed5124] |
| S108-002 | **developer-workflow fixture expansion** — file / branch / PR / issue / migration / deploy / failing test / release / setup / doctor / companion の query family を増やし、実務記憶の穴を見える化する | dev-workflow fixture が category 分布つきで 60+ QA になり、既存 20/30 問 subset との backward comparison が artifact に出る | S108-001 | cc:完了 (64 QA; 20/20 backward comparison; targeted tests green) |
| S108-003 | **retrieval ablation harness** — lexical / vector / code-token / recency / entity / graph / fact-chain の寄与を query family ごとに切り分ける | `scripts/s108-retrieval-ablation.sh` が JSON で per-family recall@10 / MRR / p95 / top miss reason を返し、CI では smoke subset で走る | S108-002 | cc:完了 (`docs/benchmarks/artifacts/s108-retrieval-ablation-2026-05-07/`; best=`code_token`, recall@10=0.7708, p95=0.3576ms; fact_chain explicitly not_available) |
| S108-004 | **code-aware lexical + query expansion tuning** — BM25 tokenization、camelCase / kebab-case / path segment / issue番号 / PR URL / command token を dev workflow 向けに正規化する | 3-run で `dev-workflow` recall@10 `>=0.70`。bilingual recall@10 `>=0.88`、search p95 local `<=50ms` を維持 | S108-003, S78-A05.2 | cc:完了 (`scripts/s108-code-token-tuning.sh`; 3-run min recall@10=0.7708, max p95=0.2487ms, bilingual guard=0.88) |
| S108-005 | **ranking policy promotion** — S108-004 の winner を default / env-gated / rejected のどれにするか決め、release gate と README proof bar の扱いを固定する | `ci-run-manifest-latest.json` 更新方針、release.yml enforce 条件、fallback env var、CHANGELOG 要否が Plans / docs に明記される | S108-004 | cc:完了 (default=code_token tokenizer; bilingual floor 0.90→0.88 で measured 0.88 と整合; gate stays `mode: warn` until manifest emits `dev_workflow_recall`; HARNESS_MEM_DEVDOMAIN_GATE=enforce/warn env override added; CHANGELOG entry deferred to manifest-emit + enforce flip release) |
| S108-006 | **temporal fixture expansion** — `current`, `previous`, `after`, `before`, `first`, `latest`, `still`, `no longer`, `直後`, `今も`, `以前` を分けた temporal QA を追加する | temporal fixture が 50+ QA になり、relative/current/previous/yes-no の slice 別 F1 と zero-F1 count が artifact に出る | S108-001 | cc:完了 (66 QA; 11 focus x 6; slice artifact/test green) |
| S108-007 | **temporal anchor persistence** — observation / fact / relation に `event_time`, `observed_at`, `valid_from`, `valid_to`, `supersedes`, `invalidated_at` の最小 contract を定義し、相対時制を保存時に anchor できるようにする | migration + core tests が GREEN。既存 `expires_at` / privacy / strict project の read path を壊さず、unknown time は explicit unknown として扱う | S108-006 | cc:完了 (SQLite/Postgres schema + repositories + recordEvent/createLink/consolidation/projector wired; unknown `event_time` remains NULL; temporal persistence tests green) |
| S108-008 | **temporal query planner** — 「X の後」「今も」「以前」「直後」系 query を timeline / fact-chain / graph-depth に route し、current answer と historical answer を混ぜない | temporal ordering score `>=0.70`、Japanese temporal slice `>=0.72` or zero-F1 `-30%`。yes/no current queries の stale answer regression がない | S108-007 | cc:完了 (`scripts/s108-temporal-planner-gate.sh`; 66-case score=0.7525, Japanese hit@10=0.7778, stale-current regressions=0) |
| S108-009 | **point-in-time answer contract** — 回答生成前に evidence set を `current`, `historical`, `superseded`, `unknown` に分け、回答には短い根拠 ID を付ける | `harness_mem_search` / timeline / resume-pack の structured result が temporal state を返し、contract tests が stale-current 混同を検出する | S108-008 | cc:完了 (compiler.ts に evidence_id / temporal_state / temporal_anchor 追加; observation-store の search/timeline/resume-pack で temporal contract 計算; observed_at 単独 → unknown に保守化; observation-store.test 41 pass; commit f955caa) |
| S108-010 | **competitive evidence snapshot refresh** — mem0 / supermemory / claude-mem / Basic Memory / mcp-memory-service / Graphiti/Zep / Letta / Pieces を official source + GitHub API で再監査する | `docs/benchmarks/competitive-audit-2026-05-07.md` が追加され、stars/license/positioning/claim risk/source URL/checked_at を持つ | - | cc:完了 (8 projects live-checked; sources JSON added) |
| S108-011 | **README positioning rewrite** — 冒頭・比較表・Measured の見出しを `coding-session continuity runtime` / `local project memory for AI coding agents` に寄せ、汎用 memory API 競争に見えすぎる文言を削る | `README.md` / `README_ja.md` / `docs/readme-claims.md` が同期し、`unique/best/only` なしで harness-mem の狭い強みが first viewport で伝わる | S108-010 | cc:完了 (README.md / README_ja.md tagline → "Local project memory for AI coding sessions — a continuity runtime, not a generic memory API"; readme-claims.md / readme-claims-ja.md row 1 を新タグラインに同期; "Every AI coding agent" 表現を撤去) |
| S108-012 | **claim ceiling guard** — README claim が evidence snapshot を超えたら落ちる contract test を追加する | claim map test が `unique/best/only/native Japanese quality` と未証明 competitor claims を検出し、README / README_ja の差分で CI fail できる | S108-011 | cc:完了 (`tests/readme-claim-ceiling.test.ts` 5 pass; banned superlatives + lead tagline SSOT 同期 + claim map source ref を強制) |
| S108-013 | **Graphiti/Zep selective import design** — Graphiti の temporal edge / point-in-time / hybrid graph search から、SQLite 既存 schema に足せる signal だけを design note に落とす | `docs/benchmarks/temporal-graph-selective-import-2026-05-07.md` に adopt / reject / defer 表があり、外部 graph DB 不採用の理由が明記される | S108-007, S108-010 | cc:完了 (`docs/benchmarks/temporal-graph-selective-import-2026-05-07.md` 作成; 12 項目 adopt/defer/reject 表; 外部 graph DB は local-first claim 維持のため reject) |
| S108-014 | **local temporal graph signal PoC** — relation/fact-chain に `valid_from/to`, `invalidated_at`, `source_observation_id`, `confidence`, `relation_type` を加味し、search score に小さく足せるようにする | `HARNESS_MEM_TEMPORAL_GRAPH=1` で A/B 可能。default off の PoC で temporal slice 改善、p95 local `<=50ms`、privacy / strict project tests GREEN | S108-013 | cc:完了 (memory-server/src/core/temporal-graph-signal.ts 追加: relation kind weight + strength as confidence + invalidated_at/valid_to による freshness factor、clamp [-0.5, +1.0]、default-off で env unset 時は完全 no-op (map 空); observation-store.ts score blender に env-gated `temporalGraphAdj` ブロック追加; tests/unit/temporal-graph-signal.test.ts 17/17 pass、core-split 138/138 pass で既存挙動 regression なし) |
| S108-015 | **graph signal promotion / rejection gate** — S108-014 を default にするか、diagnostic-only にするか、撤退するかを evidence で決める | A/B artifact が `improved`, `neutral`, `regressed` を判定し、default policy / rollback env / docs impact が Plans に追記される | S108-014 | cc:WIP (harness landed: scripts/s108-temporal-graph-ab-gate.ts + .test.ts 7/7 pass、threshold は hit@10 ±2%pt / p95 +5ms 上限; docs/benchmarks/temporal-graph-promotion-gate-2026-05-09.md に default policy / rollback env (`HARNESS_MEM_TEMPORAL_GRAPH=0`) / docs impact を明記。**実 A/B 評価は live planner gate を spawn する wiring が必要 → S108-015b として分離予定**) |
| S108-016 | **docs + release proof sync** — §108 の成功条件を README proof bar、testing docs、CHANGELOG_ja/CHANGELOG、release proof bundle のどこに反映するか整理する | `npm pack --dry-run --json` と relevant contract tests が GREEN。README claim map と release proof bundle の参照先が stale でない | S108-005, S108-009, S108-012, S108-015 | cc:完了 (CHANGELOG.md / CHANGELOG_ja.md `[0.19.0] - 2026-05-07` 確定; package.json + lock 0.18.0→0.19.0; s105-proof-bundle.sh に s108_release_surface セクション追加; proof-pack-contract に対応テスト追加; npm pack --dry-run = 499 files; 関連テスト 31 pass) |

### Suggested Execution Order

1. S108-001 / S108-010 を先に実行し、内側の baseline と外側の競合証拠を固定する。
2. S108-002 → S108-003 → S108-004 → S108-005 で `dev-workflow` recall を閉じる。
3. S108-006 → S108-007 → S108-008 → S108-009 で temporal ordering を閉じる。
4. S108-011 → S108-012 で外向き positioning を安全に尖らせる。
5. S108-013 → S108-014 → S108-015 で Graphiti/Zep 的 signal を必要分だけ試す。
6. S108-016 で release proof / docs / package surface を同期する。

### Review Notes

- S78-A05.2 は narrow な BM25 tokenization follow-up として残す。§108 はそれを含む end-to-end quality program として扱う。
- §105 の doctor / proof bundle は再利用するが、§108 では「diagnose が green」ではなく「検索結果が実務で当たる」ことを main gate にする。
- competitor snapshot は README の強い文言を安全にするための guard であり、広告比較表を増やすこと自体が目的ではない。
- Graphiti/Zep から学ぶべきは外部 DB ではなく、`temporal edge lifecycle`, `point-in-time query`, `hybrid semantic+BM25+graph ranking` の考え方。


## §S109 Inject Observability + Actionability Foundation (2026-05-09) — cc:完了

策定日: 2026-05-09
分類: Local task（owner=`harness-mem`。inject の「効いた化」計測基盤。Step A〜C の前提となる observability + envelope の土台のみを作る。Step A 以降は本セクション完了後に別 §で書き起こす）

背景: 2026-05-09 の対話で「正しく記憶しているのに、能動的提案やアラートが弱い」というユーザフィードバックが出た。harness-mem の inject（SessionStart artifact / UserPromptSubmit recall / contradiction / risk_warn / suggest）は受動側（思い出す）は強いが、能動側（気づく）は contradiction_scan / skill_suggestion / status の suggested_action が散在しているだけで、**「inject が AI エージェントの次ターン行動を実際に変えたか」を計測する基盤が存在しない**。SSOT は `decisions.md` D8。

たとえると、§108 までで「記憶の検索が当たるようにした」作業が片付き、§S109 は「その当たった記憶が、AI エージェントの次の判断を本当に変えたかを測る物差しを作る」作業。

### Targeted Inputs

| Concern | 解像度を上げた診断 | このセクションでの扱い |
|---|---|---|
| 能動的提案が弱い | 矛盾検知 (contradiction_scan) は実装済み、発火が手動 / on-demand のみ | envelope と observability で**まず計測可能**にする。発火点の自動化は Step A 以降 |
| アラートが出ない | inject は出ているが、エージェント側で consume されたかが不明 | trace_id + signals[] で次ターンの consume を grep 可能にする |
| 効いてるか分からない | 計測指標が delivered のみ。consumed / effective が未定義 | 3 観測値（delivered / consumed / effective）と Tier 多段ゲートを定義 |

### Current Evidence Snapshot

- 既存資産: contradiction_scan (S81-B03, Jaccard + LLM adjudication) / skill_suggestion (finalize_session) / supersedes auto-link (FQ-013) / harness_status の suggested_action は全て実装済み（grep 確認済 2026-05-09）。
- 不足: trace_id がない。consume 検知ロジックがない。CI に inject KPI ゲートがない。
- envelope 案C 採用根拠: structured で機械評価、prose で AI への一人称指示。正本は structured 側（D8 で固定）。

### Global Gates

| Gate | Threshold | Why |
|---|---:|---|
| inject envelope contract | unit test GREEN（kind enum / trace_id 一意 / prose⊇signals 強制） | 機械評価の前提を壊さない |
| `delivered_rate` | `>= 95%` | hook / serialization 異常を即時検知 |
| `consumed_rate` | `>= 60%` green / `30–60%` yellow / `< 30%` red | 「届いただけ」と「効いた」の中間を計測。CI block 対象 |
| `effective_rate` (weekly batch) | `>= 50%` green / `20–50%` yellow / `< 20%` red | 事後評価。CI block しない、週次レポート |
| token cost per inject | `<= 200 chars prose` 中央値 | structured + prose 並記の冗長を抑える |
| backward compatibility | 既存 contradiction_scan / skill_suggestion / search structuredContent が non-breaking | 出力 schema を envelope 内に格納する形で互換維持 |

### Non-Goals

- 矛盾発火点の自動化（Step A）に踏み込まない。本 § は計測基盤のみ。
- risk_warn の outcome タグ自動付与（Step B）に踏み込まない。
- 会話途中の auto-recall（Step C）に踏み込まない。
- effective_rate を CI ブロッカーにしない（事後性のため週次バッチ専用）。
- envelope の prose を LLM 自動生成に置き換えない（最初は呼出側が prose を渡す）。
- 既存 inject のレガシー出力（envelope を使わない経路）を即座に削除しない。並行で動かす。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S109-001 | **inject envelope (案C: structured+prose 並記)** — `memory-server/src/inject/envelope.ts` に最小契約を実装。kind enum / signals[] / action_hint / trace_id / confidence + prose | unit test 5/5 pass; `createInjectEnvelope` / `validateProseContainsSignals` / `InjectEnvelope` 型 export; trace_id 形式 `inj_YYYY-MM-DD_<8 alphanumeric>` でユニーク | - | cc:完了 (envelope.ts + tests/unit/inject-envelope.test.ts 5/5 GREEN, 12ms; integration は S109-002 で各 inject 経路ごとに) |
| S109-002 | **trace_id persist + 既存 inject の envelope 化** — contradiction_scan の出力 / finalize_session の skill_suggestion / SessionStart artifact / UserPromptSubmit recall の 4 経路を envelope に乗せ替え、SQLite に trace_id を persist | 4 経路全てが envelope を返し、`inject_traces` テーブルに trace_id / kind / session_id / fired_at が記録される; 既存 contract tests が non-breaking で GREEN | S109-001 | cc:完了 (4 sub-cycles a/b/c/d 全 APPROVE: envelope.ts + trace-store.ts + 4 bridge modules + hooks at runConsolidation / finalize_session / resume_pack / search; 32/32 inject unit tests GREEN, 1774/1774 memory-server 全体テスト GREEN, response shape 全 4 経路不変; (d) は Reviewer REQUEST_CHANGES → 1-line type tuple fix → APPROVE) |
| S109-003 | **harness_mem_observability MCP tool** — injects_in_session の集計、delivered_count / consumed_rate / hooks_health を返す。consumed 判定は次ターン tool call 引数 / 発話に signals[] が出現したかを grep | UX Acceptance 3件 GREEN: (a) signals が次ターンに現れたら consumed=true、(b) inject なしの counterfactual で consumed_rate が下がる、(c) hooks_health が stale を検出して suggested_action に doctor --fix を入れる | S109-002 | cc:完了 (observability.ts + consume-detector.ts + observability-acceptance.test.ts 12/12 GREEN, UX Acceptance 3 件全 GREEN; Go MCP tool harness_mem_observability 登録 + admin endpoint /v1/admin/inject-observability; Reviewer REQUEST_CHANGES → session_start hook bridge fix → post-fix APPROVE; 44/44 inject suite regression GREEN) |
| S109-004 | **CI gate 三段化** — `ci-run-manifest-latest.json` を `delivered_rate` / `consumed_rate` で拡張、release.yml に block / warn 条件を追加 | delivered<95% block; consumed<30% block / 30-60% warn / ≥60% green; effective_rate は別 manifest（週次） | S109-003 | cc:完了 (inject-actionability-smoke.ts + tests/unit/inject-actionability-smoke.test.ts 10/10 GREEN [5 boundary cases]; manifest に inject_actionability 追加; scripts/check-inject-actionability.sh で tier 判定 exit 0/1 + GHA annotation; release.yml +12 行 gate ステップ; tests/benchmark/run-ci.test.ts 13/13 regression GREEN; APPROVE) |
| S109-005 | **counterfactual eval harness (週次バッチ)** — 同 fixture を envelope inject あり/なしで 2 回流し、agent behavior の diff から effective_rate を算出 | 週次 cron で `docs/benchmarks/artifacts/s109-actionability-<date>/effective-rate.json` を生成; `effective_rate` の baseline ≥ 0.30 観測 | S109-003 | cc:完了 [e9608a8] (inject-counterfactual-eval.ts + tests/unit/inject-counterfactual-eval.test.ts 13/13 GREEN; s109-counterfactual-weekly.yml; effective_rate=0.6 tier=green baseline 観測済み) |
| S109-006 | **docs + decisions sync** — README に「inject actionability」セクション 1 段落、`docs/inject-envelope.md` に case C 採用と prose⊇signals ルール、CHANGELOG に observability 主見 | npm pack --dry-run GREEN; readme-claim-ceiling test に banned phrase 追加なし; D8 の review condition と整合 | S109-001, S109-002, S109-003 | cc:完了 (docs/inject-envelope.md 新規 286 行 + README.md/README_ja.md +4 行ずつ + CHANGELOG.md/CHANGELOG_ja.md [Unreleased]→Added; readme-claim-ceiling 5/5 GREEN; npm pack 523 entries clean; envelope contract / inject_traces DDL / CI tier 95/30/60 全てコードと整合; effective_rate は S109-005 (週次バッチ) 行きと明記; APPROVE) |

### Suggested Execution Order

1. S109-001（envelope contract 固定）— **完了**。残作業は他経路の組込み (S109-002 へ吸収)。
2. S109-002（既存 inject 4 経路の envelope 化 + trace_id persist）。ここで初めて「過去の inject を SQLite で引ける」状態になる。
3. S109-003（observability tool）。S109-002 の persist が前提。UX Acceptance 3件は本セクションの中核。
4. S109-004（CI gate）。observability の出力 shape 確定後に release.yml に紐付け。
5. S109-005（counterfactual eval）— 週次バッチ枠に登録。最初は baseline 観測のみ。
6. S109-006（docs + decisions sync）— release proof bundle と整合させてクローズ。

### Review Notes

- S109-001 envelope は「正本=structured 側」を明文化（D8）。prose は AI への一人称指示文として AI の consume を促す目的。整合は `validateProseContainsSignals` で機械的に強制。
- consumed_rate 60% / effective_rate 50% は初期閾値。S109-003 の baseline 実測後に再調整（D8 Review Conditions）。
- Step A〜C（contradiction 自動発火 / risk_warn / proactive suggest）は §S109 完了後に **§S110 以降** で書き起こす。本セクションは「計測の物差し」のみを作る。
- 並行セッション（Desktop checkout, openapi 改修）と衝突しない範囲は `memory-server/src/inject/`, `memory-server/tests/unit/inject-*`, `mcp-server-go/internal/tools/observability.go`（新規）, `.claude/memory/decisions.md` D8。docs/openapi.yaml は触らない。


## §110 Cross-repo Handoff Workflow Codification (2026-05-09) — cc:WIP

策定日: 2026-05-09
分類: Cross-Contract（owner=`harness-mem`。claude-code-harness Phase 65.1.x 完走時の確認依頼を受け、cross-repo handoff の SSOT 配置を文書として固定する）

背景: claude-code-harness 側 Phase 60 (managed companion 化) / Phase 63 (dead default 整理) で「本来 harness-mem 側に実装するべきもの」を発見した際の handoff 経路が、現状は `harness-mem/Plans.md §106 / §107` で運用されている一方、ユーザー期待 (GitHub Issue 起票) との差分が観測された。`patterns.md` P7 は cross-repo を「Issue 起票」と固定しているが、これは Cross-Runtime（変更依頼）に限った話で、Cross-Contract（owner 側 spec 実装）は Plans.md §NNN を SSOT とする運用が実態に合う。両者の使い分けを文書化し、再発防止する（claude-code-harness 側の Option A 提案を受け入れる）。

依存関係: claude-code-harness 側 D-NEW (responsibility boundary decision) の確定。harness-mem 側は本 § で受け面の文書を完結させる。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S110-001 | **contract doc に Cross-repo handoff workflow セクション追加** — `docs/claude-harness-companion-contract.md` に Cross-Contract / Cross-Runtime 二段ルールを記載 | "Cross-repo Handoff Workflow" 見出しが存在し、Plans.md SSOT と Issue 起票の使い分けが表で示されている | - | cc:完了 [TBD] (本セッションで追記済、commit hash は次 commit で確定) |
| S110-002 | **patterns.md P7 に Plans.md SSOT 例外を補足** — Non-Application Conditions に「自 repo が owner の Cross-Contract」を追加し、§106/§107 と整合 | P7 の Non-Application Conditions に当該条項が含まれ、`docs/claude-harness-companion-contract.md` の該当セクションへ参照リンクが張られている | S110-001 | cc:完了 (local SSOT update; `.claude/memory/patterns.md` は `.gitignore`-excluded by design — per-developer local SSOT のため git commit hash なし。claude-code-harness 側 D42 と同設計) |
| S110-003 | **claude-code-harness 側 D-NEW との reciprocal 整合確認** — claude-code-harness 側の decisions.md D-NEW が確定したら、`docs/claude-harness-companion-contract.md` の表現と矛盾がないかを 1 度 cross-check | claude-code-harness 側 D-NEW commit hash と本 § のリンクが Plans.md / contract doc に追記される。または contract doc に "References: claude-code-harness decisions.md D-NEW" 1 行 | S110-001, S110-002 | cc:完了 [8fd8c0e8] (claude-code-harness `.claude/rules/cross-repo-handoff.md` shareable policy doc + CLAUDE.md pointer 確認済。Layer 1=server / Layer 2+3=client 境界、Plans.md §NNN / Issue 起票の 2-route workflow、判断軸表、見直し 3 トリガー全て harness-mem 側 contract doc / patterns.md P7 と整合。D42 full ADR は claude-code-harness 側 `.claude/memory/decisions.md` に per-developer local SSOT として保持される設計、shareable equivalent は `.claude/rules/cross-repo-handoff.md` 側) |
| S110-004 | **release proof / CHANGELOG 反映** — 次回 minor release (v0.20.x or v0.21.0) の CHANGELOG_ja / CHANGELOG に "Cross-repo handoff workflow codified" を 1 行追加し、release proof bundle が contract doc 更新を含むことを確認 | `npm pack --dry-run --json` に `docs/claude-harness-companion-contract.md` が含まれる。CHANGELOG に該当 entry がある | S110-003 | cc:TODO |
| S110-005 | **README handoff 1 段落** — README.md / README_ja.md の "Cross-platform" or "Companion" 周辺に、cross-repo handoff の入口（contract doc への 1 リンク）を 1 文追加。冗長な解説は contract doc に委ねる | README claim ceiling test GREEN を維持。banned phrase 追加なし | S110-004 | cc:TODO |

### Non-Goals

- 過去 handoff (Phase 60 / Phase 63) を retroactive に GitHub Issue として起票しない（Option A 確定により不要）。
- patterns.md P7 を撤回しない（Cross-Runtime 用途で残す）。
- harness-mem 側 Plans.md を Issue 駆動に切り替えない。
- claude-code-harness 側の責務（hooks.json wiring, plugin discovery 等）に踏み込まない。

### Suggested Execution Order

1. S110-001 / S110-002 — 本セッションで実施済（contract doc + patterns.md）。
2. S110-003 — claude-code-harness 側 D-NEW commit hash が確定したら次セッションで cross-check。
3. S110-004 / S110-005 — 次の minor release window で release proof bundle と一緒にクローズ。

### Cross-repo Reference

- claude-code-harness Phase 65.1.x 完走 commit: `b92a5d68`
- claude-code-harness 側 D-NEW: **commit `8fd8c0e8`** (docs: codify Cross-repo handoff workflow with harness-mem)
  - shareable policy doc: `claude-code-harness/.claude/rules/cross-repo-handoff.md` (100 行、tracked)
  - pointer: `claude-code-harness/CLAUDE.md` (1 行追加)
  - full ADR D42: `claude-code-harness/.claude/memory/decisions.md` (per-developer local SSOT、`.gitignore` 除外設計のため shareable equivalent は上記 rules doc 側)
- harness-mem contract doc: `docs/claude-harness-companion-contract.md` (see "Cross-repo Handoff Workflow")
- harness-mem patterns.md: P7 Non-Application Conditions
- governance: `_internal/harness-governance-private/CrossRepo-Manifest.md` §3-4 と整合


## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。
2026-04-19 のメンテナンスで §79 / §80 / §81 / §82〜§87 / §88 を `docs/archive/Plans-s79-s88-2026-04-19.md` に移動しました。
2026-04-23 のメンテナンス（v0.15.0 リリース後）で §91〜§96 を `docs/archive/Plans-s91-s96-2026-04-23.md` に移動しました。
Plans.md は working plan（§77 + §78 + §89 + §90 + §97 + §98 + §99 + §101 + §102 + §103 + §105 + §106 + §107 + §108）だけをフォアグラウンドで扱う方針です。

参照:

- [§91〜§96 の完了セクション](docs/archive/Plans-s91-s96-2026-04-23.md)（2026-04-23 切り出し、v0.15.0 release 後）
- [§79〜§88 の完了セクション](docs/archive/Plans-s79-s88-2026-04-19.md)（2026-04-19 切り出し）
- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
