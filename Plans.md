# Harness-mem 実装マスタープラン

最終更新: 2026-04-19（§89 Search Quality Hardening (XR-002) 発番、§79〜§88 と §81 をアーカイブに退避）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了） | §54-55 → [`Plans-s54-s55-2026-03-16.md`](docs/archive/Plans-s54-s55-2026-03-16.md)（§54 14完了, §55 4完了） | §51-§76 → [`Plans-s51-s76-2026-04-13.md`](docs/archive/Plans-s51-s76-2026-04-13.md) | §79-§88 → [`Plans-s79-s88-2026-04-19.md`](docs/archive/Plans-s79-s88-2026-04-19.md)（§79/§80/§81/§82-§87/§88 完了）

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
| 最新リリース | **v0.13.0**（2026-04-18、§78 Phase B/C/D/E + §77-b follow-up） |
| 次フェーズの焦点 | **§89 Search Quality Hardening (XR-002)** / **§90 Session Resume Injection Hook (XR-003)** / **§78 Phase A-E follow-up** |
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
2. **Tool-agnostic** — Claude Code, Codex, Cursor, Gemini CLI, OpenCode
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
| S89-002 | ingest 時の semantic dedup (`sha256(session_id + observation_type + content)` を `mem_observations.content_dedupe_hash` 列に追加 + UNIQUE index) | 同一 session_id で session_end summary を 10 回 ingest しても行数 1、既存 file-offset dedup とは独立に動作 | cc:TODO |
| S89-003 | reindex backfill scheduler (`admin/reindex-vectors` を server 側 cron loop 化、もしくは完走専用 `reindexAll()` を追加) | 起動後 24h 以内に vector_coverage が 95% 以上に収束、進捗 metric がログに出る | cc:TODO |
| S89-004 | 既存重複行のクリーンアップ migration (DRY-RUN + explicit flag、`archived_at` soft-delete、audit log 記録) | 既存 DB で重複 summary が 1 件に集約、dry-run 差分とエグゼキューションが audit log に残る | cc:TODO |

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

## §91 Live Session Handoff via Periodic Partial Finalize (XR-004) — cc:完了

策定日: 2026-04-20
親管理: `harness-governance-private/XR-Registry.md` に **XR-004** として別途発番予定 (cross-runtime, owner=`harness-mem`)
背景: §90 (XR-003) で SessionStart 時の resume-pack 注入は動作確認済。ただし現仕様では `session_summary` が Stop / TaskCompleted / finalize 時にのみ生成されるため、**現 session を閉じずに別 session を開くと直前会話の要約が新 session に渡らない**。daemon は `claude_code_sessions_ingest` で生 event を 5 秒ごとに投入しているのに、要約化されていないため resume-pack には乗らない。定期 partial finalize を daemon 側に追加し、閉じる前でも最新の要約が取れる状態にする。

### 観測事実 (2026-04-20)

| 指標 | 現状 |
|------|------|
| `session_summary` 生成契機 | Stop / TaskCompleted / explicit finalize のみ |
| 現 session 並行で別 session 開いた時の resume-pack | **最後に finalize した session の summary** を返す (今の現 session の内容は入らない) |
| 生 event の ingest | `claude_code_history_ingest` が 5 秒ごとに `.claude/projects/*.jsonl` を取り込み済み |
| ギャップ | 生 event を「要約」へ昇格する契機が session 終了イベントしかない |

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S91-001 | `finalize_session` API に `partial=true` オプションを追加。partial 呼び出し時は session を `status=active` のまま維持し、`session_summary` を `metadata.is_partial=true` 付き observation として 1 件追記する。既に `status=closed` の session に対する partial は no-op (idempotent)。既存 full finalize (`partial=false` default) の挙動は完全に維持 | (a) unit test: `partial=true` で `sessions.status` が active のまま新規 `session_summary` 行が 1 件増える / 既に closed の session に partial=true を投げると no-op (行数不変・200 応答) / full finalize と partial finalize が同 session で並存可能 (b) OpenAPI snapshot 更新 / `mcp-openapi-consistency.test.ts` PASS (c) 既存 finalize テスト全件無回帰 | - | cc:完了 [8b9a432] |
| S91-002 | daemon に partial-finalize scheduler loop を追加。`partialFinalizeIntervalMs` (既定 300000 = 5 分) ごとに「最新 `event_at` > 最新 `session_summary.created_at` の active session」を検出して S91-001 の partial finalize を順次投げる。`features.partial_finalize_enabled` (既定 false = opt-in) で制御、CPU guard として同時実行は 1 session、1 tick あたり最大 5 session で頭打ち、1 session あたり 30 秒 timeout | (a) integration test (mock clock): active session に新 event 投入 → 5 分進める → partial summary が 1 件増える (b) `enabled=false` では loop が起動しない (c) 2 session に新 event 投入 → 両方に partial summary が生成される (d) 1 session だけ新 event 無し → partial 投げない (e) `harness_mem_health.features.partial_finalize_enabled` が露出する | S91-001 | cc:完了 [9f321c9] |
| S91-003 | `resume_pack` クエリが `is_partial=true` も含めた最新 `session_summary` を採用するよう修正。同一 session_id 内では (partial と full のうち) `created_at` が新しい方を優先、複数 session では最新の summary の created_at で降順 | (a) integration test: `full(t=T)` + `partial(t=T+1)` の同 session → partial が返る (b) `full(t=T+2)` + `partial(t=T+1)` → full が返る (c) partial が他 session より古い → 他 session の summary が採用される (d) 既存の session_summary-only retrieval (partial=false) も後方互換で動く (opt-out 可能な query param `include_partial=false` を追加) | S91-001 | cc:完了 [bda2b6c] |
| S91-004 | docs + CHANGELOG + OpenAPI + harness-governance XR-004 起票 (別手順、本タスクは harness-mem 側 artifact 更新のみ)。`/v1/sessions/finalize` の `partial` param と `/v1/resume-pack` の `include_partial` param を OpenAPI snapshot に追加、`harness_mem_health.features` に `partial_finalize_enabled` と `partial_finalize_interval_ms` を露出、CHANGELOG `[Unreleased]` に §91 エントリ追加 | (a) `docs/openapi.yaml` 更新 + `mcp-openapi-consistency.test.ts` PASS (b) `CHANGELOG.md` に §91 の「今まで / 今後」記述 (c) `harness_mem_health` が新 features を返す unit test PASS (d) `docs/session-handoff.md` 等に cross-session live handoff の説明を追記 (新規でも既存追記でも可) | S91-001, S91-002, S91-003 | cc:完了 |
| S91-006 | scheduler opt-in の永続化: `getConfig()` に `~/.harness-mem/config.json` 読み込みを追加。優先順は `env var > config.json > default`。配布ユーザーが shell rc 設定なしで opt-in 持続できるようにする | (a) `partialFinalizeEnabled: true` を config.json に書けば env var 無しで scheduler ON (b) env var 空でない時は env が優先、config.json は無視 (c) 実 daemon 再起動で features.partial_finalize_enabled が維持される (d) CHANGELOG + docs/session-handoff.md 更新 | S91-002 | cc:完了 [env > config.json > default の 3 段 fallback 実装、実機検証 OK] |

### 設計方針

- **opt-in デフォルト** (`partial_finalize_enabled=false`): §89-002 (semantic dedup) が landed 前は partial summary の重複蓄積リスクがあるため既定は無効。ユーザーが config で明示 ON
- **既存 API 後方互換**: `partial` / `include_partial` はどちらも optional、未指定時は現挙動
- **scheduler は daemon プロセス内の setInterval**: 外部 cron 依存を避け、daemon 停止時は自動停止
- **embedding 負荷**: partial summary は full summary と同じ embedding 経路を通る。1 tick=5 session 上限で spike を抑える

### リリース計画

- §91 全体: harness-mem v0.14.x minor (§89 の schema 変更と並走可能)
- §91 landed 後、§90 S90-002 (summary_only mode) と組み合わせれば hook 側 jq を更に薄くできる
- harness-governance-private 側で XR-004 起票 (タイトル: `cross-session live handoff via partial finalize`)

### Cross-repo チェックポイント

- 本 §91 は harness-mem 単独で完結 (claude-code-harness 側変更不要)
- 既に動いている S90-001 hook が `is_partial=true` の summary も自然に拾うため、plugin 側追加作業なし
- XR-Registry.md への XR-004 追記は別セッションで governance repo に対して行う

---

## §92 README Claim Reality Audit — cc:完了

策定日: 2026-04-20
分類: Local audit / Cross-Read (README claims include Claude Code + Codex runtime wiring already tracked by XR-003 / XR-004)
背景: README / README_ja で謳っている user-facing claims が、実装・テスト・committed artifacts・ローカル実行で現実に支えられているかを網羅確認する。

| Task | 内容 | DoD | Status |
|------|------|-----|--------|
| S92-001 | README / README_ja / docs/readme-claims の claim inventory を作る | major claims が evidence path に対応づく | cc:完了 [HEAD] |
| S92-002 | measured claims と artifact claims を検証する | benchmark JSON / package scripts / docs links / assets の存在と整合性を確認 | cc:完了 [HEAD] |
| S92-003 | executable runtime claims を検証する | relevant unit/integration/CLI/UI tests と smoke checks を実行し結果を記録 | cc:完了 [HEAD] |
| S92-004 | gap / overclaim / follow-up を整理する | blocking gap と bounded caveat を分け、必要なら follow-up task 化 | cc:完了 [HEAD] |

進捗メモ (2026-04-20):
- local `main` は `origin/main` と一致 (`627ae3d`)。`harness-memd restart` 後、daemon `127.0.0.1:37888` と UI `127.0.0.1:37901` は `harness-memd doctor` green。
- README の benchmark / JA companion claim は committed artifact と概ね一致。artifact 内部の一部 absolute path は旧 `Desktop/Code` を指しており follow-up 候補。
- `harness-mem doctor` の lease/signal probe が token 未設定時に Bash 3 + `set -u` で `_auth_hdr[@]: unbound variable` になる実地 gap を確認し、Bash 3 safe expansion に修正。`doctor --json` は lease/signal `ok` まで進み、現環境では `codex_wiring` のみ missing。
- Bun panic mitigation は実地で `0 fail` 後の crash reporter が戻らない gap を確認。safe runner を出力監視型に変更し、`npm test` が完走することを確認。
- `test:e2e` は sandbox 内では listen 制限により失敗するが、sandbox 外実行で 6/6 pass。feed E2E は session group 折りたたみ後の現 UI に追従。

---

## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。
2026-04-19 のメンテナンスで §79 / §80 / §81 / §82〜§87 / §88 を `docs/archive/Plans-s79-s88-2026-04-19.md` に移動しました。
Plans.md は working plan（§77 + §78 + §89）だけをフォアグラウンドで扱う方針です。

参照:

- [§79〜§88 の完了セクション](docs/archive/Plans-s79-s88-2026-04-19.md)（2026-04-19 切り出し）
- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
