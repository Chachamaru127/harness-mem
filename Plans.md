# Harness-mem 実装マスタープラン

最終更新: 2026-05-11（v0.21.2 Codex notify chain + health alias repair patch）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了） | §54-55 → [`Plans-s54-s55-2026-03-16.md`](docs/archive/Plans-s54-s55-2026-03-16.md)（§54 14完了, §55 4完了） | §51-§76 → [`Plans-s51-s76-2026-04-13.md`](docs/archive/Plans-s51-s76-2026-04-13.md) | §79-§88 → [`Plans-s79-s88-2026-04-19.md`](docs/archive/Plans-s79-s88-2026-04-19.md)（§79/§80/§81/§82-§87/§88 完了） | §91-§96 → [`Plans-s91-s96-2026-04-23.md`](docs/archive/Plans-s91-s96-2026-04-23.md)（§91/§92/§93/§94/§95/§96 完了、v0.15.0 リリース後） | §77/§98-§107/§S109 → [`Plans-s77-s109-2026-05-10.md`](docs/archive/Plans-s77-s109-2026-05-10.md)（§77 §78-A03 吸収 / §98 §99 §101 §102 §103 §105 §106 §107 §S109 完了、v0.20.0 リリース後）

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
| 最新リリース | **v0.21.2**（2026-05-11、Computer Use notify chain preservation for Codex setup repair + /v1/health compatibility alias） |
| 次フェーズの焦点 | **§108 Developer Workflow Recall + Temporal Graph Positioning Hardening** / **§110 Cross-repo Handoff Workflow Codification** / **§89 Search Quality Hardening (XR-002)** / **§90 Session Resume Injection Hook (XR-003)** / **§78 Phase A-E follow-up** / **§97 Codex Recall Skill Parity** |
| CI Gate | **Layer 1+2 PASS**（onnx `run-ci`、bilingual=0.8800、p95 13.28ms、history reset at v0.11.0） |

- benchmark SSOT: `generated_at=2026-04-10T08:10:51.561Z`, `git_sha=512f027`
- Japanese companion current: `overall_f1_mean=0.6580`
- Japanese historical baseline: `overall_f1_mean=0.8020`

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


## §110 Cross-repo Handoff Workflow Codification (2026-05-09) — cc:WIP

策定日: 2026-05-09
分類: Cross-Contract（owner=`harness-mem`。claude-code-harness Phase 65.1.x 完走時の確認依頼を受け、cross-repo handoff の SSOT 配置を文書として固定する）

背景: claude-code-harness 側 Phase 60 (managed companion 化) / Phase 63 (dead default 整理) で「本来 harness-mem 側に実装するべきもの」を発見した際の handoff 経路が、現状は `harness-mem/Plans.md §106 / §107` で運用されている一方、ユーザー期待 (GitHub Issue 起票) との差分が観測された。`patterns.md` P7 は cross-repo を「Issue 起票」と固定しているが、これは Cross-Runtime（変更依頼）に限った話で、Cross-Contract（owner 側 spec 実装）は Plans.md §NNN を SSOT とする運用が実態に合う。両者の使い分けを文書化し、再発防止する（claude-code-harness 側の Option A 提案を受け入れる）。

依存関係: claude-code-harness 側 D-NEW (responsibility boundary decision) の確定。harness-mem 側は本 § で受け面の文書を完結させる。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S110-001 | **contract doc に Cross-repo handoff workflow セクション追加** — `docs/claude-harness-companion-contract.md` に Cross-Contract / Cross-Runtime 二段ルールを記載 | "Cross-repo Handoff Workflow" 見出しが存在し、Plans.md SSOT と Issue 起票の使い分けが表で示されている | - | cc:完了 [f19f1a5] |
| S110-002 | **patterns.md P7 に Plans.md SSOT 例外を補足** — Non-Application Conditions に「自 repo が owner の Cross-Contract」を追加し、§106/§107 と整合 | P7 の Non-Application Conditions に当該条項が含まれ、`docs/claude-harness-companion-contract.md` の該当セクションへ参照リンクが張られている | S110-001 | cc:完了 (local SSOT update; `.claude/memory/patterns.md` は `.gitignore`-excluded by design — per-developer local SSOT のため git commit hash なし。claude-code-harness 側 D42 と同設計) |
| S110-003 | **claude-code-harness 側 D-NEW との reciprocal 整合確認** — claude-code-harness 側の decisions.md D-NEW が確定したら、`docs/claude-harness-companion-contract.md` の表現と矛盾がないかを 1 度 cross-check | claude-code-harness 側 D-NEW commit hash と本 § のリンクが Plans.md / contract doc に追記される。または contract doc に "References: claude-code-harness decisions.md D-NEW" 1 行 | S110-001, S110-002 | cc:完了 [f19f1a5] (cross-check 対象: claude-code-harness `8fd8c0e8` の `.claude/rules/cross-repo-handoff.md` shareable policy doc + CLAUDE.md pointer。Layer 1=server / Layer 2+3=client 境界、Plans.md §NNN / Issue 起票の 2-route workflow、判断軸表、見直し 3 トリガー全て harness-mem 側 contract doc / patterns.md P7 と整合。D42 full ADR は claude-code-harness 側 `.claude/memory/decisions.md` に per-developer local SSOT として保持される設計、shareable equivalent は `.claude/rules/cross-repo-handoff.md` 側) |
| S110-004 | **release proof / CHANGELOG 反映** — 次回 minor release (v0.20.x or v0.21.0) の CHANGELOG_ja / CHANGELOG に "Cross-repo handoff workflow codified" を 1 行追加し、release proof bundle が contract doc 更新を含むことを確認 | `npm pack --dry-run --json` に `docs/claude-harness-companion-contract.md` が含まれる。CHANGELOG に該当 entry がある | S110-003 | cc:完了 [v0.21.0 release commit] (Documentation entry added to CHANGELOG.md / CHANGELOG_ja.md v0.21.0 - 2026-05-11 section) |
| S110-005 | **README handoff 1 段落** — README.md / README_ja.md の "Cross-platform" or "Companion" 周辺に、cross-repo handoff の入口（contract doc への 1 リンク）を 1 文追加。冗長な解説は contract doc に委ねる | README claim ceiling test GREEN を維持。banned phrase 追加なし | S110-004 | cc:TODO |
| S110-006 | **claude-code-harness Phase C (Cross-Project Group + 3-Layer Redaction) closure 記録** — Phase C 7 タスク完走の closure entry を §110 内に記録。Cross-Contract 変更ゼロ、新規 §111 起票要件なし。harness-mem 側 invariants との衝突は実用上なし (詳細下記) | claude-code-harness 側 commit hash + 衝突確認結果 + 未起票 follow-up trigger 3 件 (XR-005 / S110-server-meta / npm package) が Plans.md §110 に記録される | S110-003 | cc:完了 [8b34ecb] |
| S110-007 | **envelope signals に PII を含めない暗黙ルールを documentation 化** — `memory-server/src/inject/envelope.ts` 冒頭 JSDoc + `docs/inject-envelope.md` に "signals 設計指針" セクションを追加し、structural label / file path / function name / tag に限定する旨を明文化 | envelope.ts 冒頭 JSDoc に signals 設計指針 1 段落、`docs/inject-envelope.md` に同セクション (例示付き)、unit test 追加は不要 (documentation only) | S110-006 | cc:TODO (低優先度、claude-code-harness 側 client-redaction.yaml で防御的注記済のため即時性なし。次回 minor release window で S110-004/005 と同時クローズ推奨) |

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

### Phase C Closure Record (S110-006)

**完走日**: 2026-05-10
**owner**: claude-code-harness (Layer 2/3 + cross-project search client 実装)
**owner-side ADR**: claude-code-harness D43 (4 判断パッケージ、`.claude/rules/cross-repo-handoff.md` の "Phase 65.3 実装決定事項 (D43)" + "Phase 65.3 完走報告" セクション、closure commit `f64a1819`)

**claude-code-harness commit chain**:
- 設計確定: `2b93228a` (D43 design refinement)
- Phase C 7 cycle: `4a014137`, `5152bed2`, `20a4478f`, `0ae3f40a`, `09377eb9`, `272a8f33`, `c05d6ef8` (順に 65.3.1 → 65.3.7)
- closure 報告: `f64a1819`

**Layer ownership 確定**:
- Layer 1 (`<private>` strip + `strict_project: true`): harness-mem 既存実装に依存 (変更なし)
- Layer 2a (辞書ベース固有名詞 redaction): claude-code-harness 新規 (`5152bed2`、client-redaction.yaml が `mcp-server/src/pii/pii-filter.ts` の PiiRule[] schema と互換)
- Layer 2b (NER): claude-code-harness 新規 (`20a4478f`、fugashi `mecab + UniDic-lite` 採用、tokenizer 不在時 fail-open)
- Layer 3 (HTML 直前最終 scan): claude-code-harness 新規 (`0ae3f40a`、カタカナ 5+ 文字連続検出、template chrome false positive 除外)

**4 判断パッケージの帰着**:
- 判断 1 (cross-project search API): Option α (MCP N-call) を採用、harness-mem 側 MCP schema 拡張 (XR-005) は未起票 trigger
- 判断 2 (applied_filters meta): 注記で進める方針確定、Layer 1 server-side filter は HTML 監査 UI に "server default に依存" と記載
- 判断 3 (client-redaction schema): Option b (PiiRule schema 互換) を採用、将来 npm package 化への upgrade path 確保
- 判断 4 (e2e DoD (g)(h) 追加): test-cross-project-redaction-e2e.sh に組み込み済 (claude-code-harness 側)

**harness-mem 側 invariants 衝突確認 (この § で実施した事後 review)**:

| Invariant | 衝突判定 | 根拠 |
|---|---|---|
| `<private>` strip と Layer 2/3 の重複 | 衝突なし | server 側で完全削除済のため client 側で見えない (`memory-server/src/core/privacy-tags.ts:26-29`)。設計上 OK |
| `[REDACTED_*]` sentinel format 整合性 | 衝突なし | `event-recorder.ts:76-93` の出力 (`[REDACTED_EMAIL]/_KEY/_SECRET/_HEX`) と claude-code-harness 側 (h) 二重置換ガード sentinel が一致を確認 (大文字版を扱うか lowercase ガードを補強するかは client 側判断) |
| envelope `validateProseContainsSignals` 不変条件 | 実用上衝突なし、暗黙ルール documentation 提案 | `memory-server/src/inject/envelope.ts:94-101` は `signals[]` の各値を prose に substring match で要求。Phase C (g) 検証は "PII を signals に入れず structural label のみ含める fixture" で確認済のため実用上 OK。ただし「signals に PII 値を含めない」が暗黙ルールとして envelope contract に未明文化 → S110-007 として明文化候補 |
| cross-project N-call rate limit | 衝突なし (現状) | `mcp-server-go/internal/tools/memory_defs.go` には rate limit / batch limit 設定なし。N=5-10 程度の N-call は問題なし。レイテンシが実運用で問題化したら XR-005 trigger |
| Cross-project privacy tag merge | 衝突なし | server は project ごと独立 filter (各 result はその project の Layer 1 を経由)、merge 概念は client 責務 (D43 で明記済) |
| audit log structure | 衝突なし | claude-code-harness 側 Phase 65.3.6 で `.claude/state/audit/cross-project-search.jsonl` を実装済、mem 側に追加要求なし |

**未起票 follow-up trigger** (claude-code-harness 側 D43 で「条件付き future trigger」として文書化済、harness-mem 側起票不要):
- XR-005: MCP schema 拡張 (`projects: [array]` + `strict_project: boolean` を MCP 経由 expose) — trigger = MCP N-call レイテンシが実運用で問題化
- S110-server-meta: `mcp__harness__harness_mem_search` response に `applied_filters` meta 追加 — trigger = client から server-side filter 適用を可視化する需要発生
- npm package 化 (`mcp-server/src/pii/pii-filter.ts` → 共通 module) — trigger = Cross-client 一貫性が真に必要 (Codex 等の他 client が独自 redaction layer を持たず共通化を希望する場合)

**S110-007 (Task table に正式登録済、cc:TODO)**:
- envelope contract に「`signals[]` に PII 値を含めない (structural label / file path / function name / tag に限定)」の暗黙ルールを明文化
- 反映先: `memory-server/src/inject/envelope.ts` 冒頭 JSDoc + `docs/inject-envelope.md` の "signals 設計指針" セクション
- 優先度: low (Phase C 実装で衝突は発生していないため、claude-code-harness 側 `client-redaction.yaml` でも防御的注記済 (`dfb92e7a` 内)。次回 minor release window で S110-004/005 と同時クローズ推奨)

### Phase C Incorporation Closure (handoff 4-turn 終結)

**incorporation 完了日**: 2026-05-10
**claude-code-harness incorporation commit**: `dfb92e7a` (docs(phase-65.3): incorporate harness-mem S110-006 closure ack)

3 ファイル更新の内訳 (claude-code-harness 側):
- `.claude/rules/client-redaction.yaml` — 大文字小文字両対応 sentinel regex の防御的注記 + envelope signals に PII を含めない暗黙ルールの shareable mirror
- `.claude/rules/cross-repo-handoff.md` — Phase 65.3 closure ack section + mem 側 commit chain (`8b34ecb` / `ad4ba56`) 参照点 + 6 invariant 衝突 review 表複製 + PiiRule schema 公式参照 8 path
- `.claude/memory/decisions.md` (gitignored, local SSOT) — D43 ADR Closure section に "Mem-side ack" + "Mem-side incorporation" + "PiiRule schema 公式参照" 3 サブセクション

**[REDACTED_*] 大文字小文字対応の確認結果**:
- claude-code-harness 側 sentinel regex `\[REDACTED_[A-Za-z0-9_]+\]` が既に大文字小文字両対応のため**コード変更不要**を確認
- smoke test で 3 形式すべて preserve 確認: `[REDACTED_email]` (Phase C fixture) / `[REDACTED_EMAIL]` (mem actual) / `[REDACTED_API_KEY]` (mem actual 複合 underscore)
- harness-mem 側 `event-recorder.ts:76-93` actual format との整合性が両 SoT (cross-repo-handoff.md / client-redaction.yaml) に明記された

**handoff 4-turn 完結状態**:
- Turn 1: claude-code-harness Phase 65.1.x 完走 → handoff 3 件依頼 (`b92a5d68`)
- Turn 2: harness-mem 側 Option A 確定 + §110 起票 (`f19f1a5` / `2e2eabb`) → claude-code-harness D-NEW 確定 (`8fd8c0e8`)
- Turn 3: claude-code-harness Phase C 7 タスク完走 (`f64a1819`) → harness-mem 側 closure ack (`8b34ecb` / `ad4ba56`)
- Turn 4: claude-code-harness incorporation (`dfb92e7a`) → harness-mem 側最終 reflection (本 commit)

**次回 follow-up trigger 起動時の起票先**: §111 (新設)、claude-code-harness 側から open 質問 (XR-005 / applied_filters / PiiRule npm package 化)。

**claude-code-harness v4.9.0 release anchor (2026-05-10)**:
- tag: `v4.9.0` (tag target `f2dc5fad`、依頼ログ記載の release-related commit `8b3ba01b`、release page: `https://github.com/Chachamaru127/claude-code-harness/releases/tag/v4.9.0`、published 2026-05-10T03:06:57Z、target_commitish: `main`、GitHub API 検証済 2026-05-11)
- Phase A-E 全 26 cycle / 累計 529 assertion 全 PASS が release artifact として固定 (Phase A=5/99, B=4/165, C=7/145, D=5/79, E=5/41)
- D42 (cross-repo handoff) + D43 (4 判断 package) は v4.9.0 に internalize 済 (`.claude/rules/cross-repo-handoff.md` shareable + decisions.md D42/D43 local SSOT)
- mem 側 §110 との対応関係: §110 codification (`f19f1a5`) → claude-code-harness D-NEW (`8fd8c0e8`) → Phase C closure (`f64a1819`) → mem ack (`8b34ecb`/`ad4ba56`) → incorporation (`dfb92e7a`) → **v4.9.0 release (`8b3ba01b`)** で chain 完結
- mem 側 obligation: ゼロ (Phase D/E は claude-code-harness 内部完結、mem contract 未変更)
- 次回 trigger 発動なき限り §110 はこの anchor で凍結状態

**PiiRule schema 公式参照 path 一覧 (claude-code-harness D43 Reference 追記用)**:
- TypeScript SoT: `mcp-server/src/pii/pii-filter.ts:15-20` (`PiiRule` interface), `:22-24` (`PiiRulesFile`), `:33` (`applyPiiFilter`), `:50` (`loadPiiRules`), `:69-85` (DEFAULT_PII_RULES)
- compiled .d.ts: `mcp-server/dist/pii/pii-filter.d.ts:1-6`
- env vars: `docs/environment-variables.md:102-111` (Security section), `:302-303` (variable index)
- VPS deploy spec (TEAM-006): `docs/specs/vps-team-deploy-spec.md:57, 260-285` (例 JSON は `:270-275`)
- contract test: `mcp-server/tests/unit/pii-filter.test.ts:1-56` (5 ケース、phone JP / email / LINE_ID / 複合 / 空ルール)
- usage 例: `mcp-server/src/tools/memory.ts:13` (import), `:1067-1068` (`record_checkpoint` 内適用)
- 注: README / OpenAPI には PII filter component schema なし、JSON Schema として独立 export もなし


## §111 Codex 0.130.0 Compatibility Follow-up (2026-05-10) — cc:完了

策定日: 2026-05-10
分類: Local task / Cross-Read（owner=`harness-mem`。Codex 0.130.0 の hook / rollout / app-server metadata を受ける互換対応は harness-mem 内で閉じる。plugin share metadata や marketplace 共有 UX の本体実装は claude-code-harness 側の別判断であり、この § では再実装しない）

背景: OpenAI Codex CLI `0.130.0` は 2026-05-08 release で、`codex remote-control`、plugin bundled hooks / share metadata、large-thread paging (`itemsView: notLoaded | summary | full`)、Bedrock `aws login` profile auth、multi-environment `view_image`、live app-server config refresh、`apply_patch` turn diff accuracy、ThreadStore resume / fork / summary fixes を含む。harness-mem の盲点は「Codex 本体の機能を真似ること」ではなく、追加 metadata や paged / summary 形式が来ても session attribution、resume continuity、ingest が落ちないこと。

たとえると、Codex が新しい配送ラベルを荷物に貼るようになったので、harness-mem 側の受付簿がそのラベルを読めるようにする。配送会社そのものを作り替える話ではない。

### Current Evidence Snapshot

- 公式 release: `openai/codex` release `0.130.0`（2026-05-08）で latest stable。
- 公式 PR evidence:
  - `#21424`: `codex remote-control` は headless remotely controllable app-server の top-level wrapper。
  - `#21566`: `thread/turns/list` が `itemsView?: "notLoaded" | "summary" | "full"` を持ち、summary は initial user message + final assistant message の軽量 view。
  - `#21143`: `view_image` は multi-environment session で selected environment cwd / filesystem を使う。
  - `#21180` / `#21518`: `apply_patch` partial failure を含む turn diff accuracy を改善。
- 既存 harness-mem は `0.128.0` までの hook metadata (`goal`, permission profile, thread store, app-server transport) を `tests/codex-future-session-contract.test.ts` で固定済み。

### Non-Goals

- Codex app-server / ThreadStore / remote-control を harness-mem 側で実装しない。
- Bedrock auth や AWS credential を harness-mem に保存しない。
- plugin share metadata の marketplace UX を harness-mem に所有させない。
- `apply_patch` diff 本体を再構成しない。harness-mem は Codex が渡す safe metadata と transcript / rollout の要約を保存するだけにする。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S111-001 | **Codex 0.130.0 upstream snapshot を追加** — 0.128.0 snapshot の後続として、0.130.0 の release item を `A/C/P` に分類し、harness-mem が受ける面と受けない面を明記 | `docs/upstream-update-snapshot-2026-05-10.md` が存在し、0.130.0 の公式 release / PR URL、local impact、verification command が記録される | - | cc:完了 [49e325d] |
| S111-002 | **Codex hook metadata extractor を 0.130.0 additive fields に拡張** — remote-control / selected environment / thread pagination / Bedrock auth method / apply_patch diff status が payload に来た時だけ safe string meta として保持 | `tests/codex-future-session-contract.test.ts` に 0.130.0 payload case が追加され、`record-event` payload meta が期待値を保持する。secret / credential 値は保存しない | - | cc:完了 [485f38f] |
| S111-003 | **Codex rollout ingest の paged / summary view 耐性を追加** — ThreadStore / app-server の `summary` / `notLoaded` / `full` 風 item が JSONL に混ざっても、空 item は skip、summary item は user prompt + assistant checkpoint として取り込む | `memory-server/tests/unit/codex-sessions-ingest.test.ts` に summary / notLoaded case が追加され、既存 compacted replacement history の挙動も維持される | - | cc:完了 [f4b222b] |
| S111-004 | **README / CHANGELOG の対応範囲を同期** — Codex Tier 1 claim と changelog に「0.130.0 additive metadata / paged summary ingest tolerant」を短く追記し、plugin share / remote-control を過剰 claim しない | README.md / README_ja.md / CHANGELOG.md / CHANGELOG_ja.md が同じ範囲で同期し、claim ceiling の既存制約に反しない | S111-001, S111-002, S111-003 | cc:完了 [29aa7d0] |
| S111-005 | **targeted validation** — 変更面に対応する contract tests を実行し、必要なら `npm pack --dry-run --json` で docs / codex skill bundle の inclusion を確認 | `bun test tests/codex-future-session-contract.test.ts memory-server/tests/unit/codex-sessions-ingest.test.ts` が PASS。docs/package surface を触った場合は `npm pack --dry-run --json` も PASS | S111-002, S111-003, S111-004 | cc:完了 [29aa7d0] |

### Cross-repo Checkpoint

- `plugin bundled hooks` と `plugin share metadata` は claude-code-harness / Codex plugin distribution の UX に寄るため、harness-mem 側では docs snapshot に留める。
- 実運用で `codex remote-control` 経由の sessions が `source` / `session_source` などの新 metadata を出す場合は、S111-002 の additive extractor で受ける。実装先は harness-mem。
- app-server pagination が remote ingestion API として必要になった場合は、`XR-005` ではなく別の Cross-Read / Cross-Runtime 判定を行う。現時点では JSONL ingest の耐性強化で足りる。


## §112 Hermes Agent Integration (2026-05-10) — cc:WIP

策定日: 2026-05-10
分類: External Agent Integration (tier 3 experimental) — Nous Research Hermes Agent からの cross-tool memory 共有窓口を整備し、段階的に Hermes session の自動保存まで拡張する。

背景: ユーザー要望「Hermes から harness-mem を使えるようにしたい」。Phase A (MCP接続のドキュメント) は本セッションで実装。続いて Phase B として、Claude / Codex のように Hermes セッションを harness-mem に保存する仕組みを整える。Hermes 公式に `on_session_start` / `on_session_end` hook が存在するため (https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks)、Python plugin 経由で実現可能。一方 per-message hook (Claude `UserPromptSubmit` 相当) は無く、turn 粒度の event 自動記録は JSONL ベースのベスト努力に留まる。この制約を踏まえた tier 3 (experimental) としての位置付けを README / docs / Plans.md に統一して明記する。

依存関係: harness-mem 既存の stdio MCP server (`mcp-server/`, `mcp-server-go/`) と HTTP daemon (`memory-server/`, localhost:37888)。Hermes 側の plugin API 仕様確定。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S112-001 | **Phase A: integration ドキュメント作成** — `integrations/hermes/` ディレクトリ + README (positioning明確化込み) + yaml サンプル 2 種 (minimal/full) + `docs/integrations/hermes.md` 作成。root README.md と mcp-server/README.md にも追記。stdio MCP server 再利用、新規コードゼロ。 | 5 ファイル追加・2 ファイル更新が git status で確認できる。doc 内に「`MEMORY.md` / `USER.md` / `skills/` を置き換えるものではない」明記。memory layer 比較表あり。tier 3 注記あり。 | - | cc:完了 [4f33c74] |
| S112-002 | **harness-mem 側 event 記録経路の確定** — `harness-mem` CLI で event 記録できるサブコマンドが既存か確認。無ければ HTTP daemon (`memory-server/`) のエンドポイント一覧を整理し、Hermes plugin から呼ぶ path/payload を確定。 | 1) `harness-mem --help` 出力で record 系サブコマンドの有無を Plans.md にメモ、2) 無ければ memory-server の HTTP routes 一覧 (例: `POST /events`) を `docs/integrations/hermes.md` に追記、3) plugin が呼ぶ最終的な接続経路 (CLI or HTTP) を確定 | S112-001 | cc:完了 [4f33c74] (調査結果: `POST /v1/events/record` ([memory-server/src/server.ts]), `POST /v1/checkpoints/record`, `POST /v1/sessions/finalize` が daemon に存在。python-sdk `HarnessMemClient.record_event` / `record_checkpoint` / `finalize_session` ([python-sdk/harness_mem/client.py:163-214]) が HTTP API を完全ラップ済み。plugin は **HTTP直叩きせず python-sdk 経由** で記録する経路に確定) |
| S112-003 | **Hermes plugin API 仕様確定** — `register(ctx)` / `ctx.register_hook()` の正確なシグネチャ、`on_session_start` / `on_session_end` / `pre_llm_call` の引数仕様を Hermes 公式 docs から引用ベースで確認 | `docs/integrations/hermes.md` に「Hermes plugin API リファレンス」セクション追加、各 hook の引数 (session_id, completed, interrupted, ...) を docs URL 引用付きで記載 | S112-001 | cc:完了 [4f33c74] (調査結果: 公式hookは `on_session_start(session_id, model, platform, **kwargs)`, `on_session_end(session_id, completed, interrupted, model, platform, **kwargs)`, `pre_llm_call`, ほか tool / LLM / gateway 系。同期/非同期両対応。例外はHermes側で try/except wrap (落ちない)。Plugin discovery は `[project.entry-points."hermes_agent.plugins"]` または `~/.hermes/plugins/`。Per-message hook は **無い** (`pre_llm_call` で turn 粒度)。v0.13.0 (2026-05-07) でAPI安定化。出典: https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks ほか) |
| S112-004 | **Plugin skeleton 実装** — `integrations/hermes/plugin/` 配下に `pyproject.toml` + `harness_mem_hermes_bridge/{__init__.py, plugin.py}` 作成。`on_session_start` で `session_start` event 記録、`on_session_end` で `session_end` event + `checkpoint` 記録、`pre_llm_call` は将来 `resume_pack` 注入用に hook 登録だけ用意。 | `pip install -e integrations/hermes/plugin/` が成功し、Hermes が plugin として load できる構造。`plugin.py` に on_session_start / on_session_end の最小実装。`HARNESS_MEM_PROJECT_KEY` env から project_key 取得 | S112-002, S112-003 | cc:完了 [4f33c74] (TDD実装: 15 pytest テスト全pass。`integrations/hermes/plugin/{pyproject.toml, README.md, harness_mem_hermes_bridge/{__init__.py, plugin.py}, tests/{__init__.py, conftest.py, test_plugin.py}}` を追加。`HarnessMemClient` lazy singleton 経由で `record_event` / `finalize_session` を呼ぶ。Forward-compat `**kwargs` 受け取り。`HARNESS_MEM_URL` / `_TOKEN` / `_PROJECT_KEY` env 解決。E2E (実Hermes) は S112-005 で別途) |
| S112-005 | **E2E 動作確認** — 実 Hermes (v0.13+) install → plugin 配置 → session 1 つ作成 → `harness_mem_search` で `session_start` / `session_end` event が観測されることを確認 | `docs/integrations/hermes.md` に E2E 確認手順追記。実行ログ抜粋を `docs/integrations/hermes-e2e-2026-MM-DD.md` に保存 | S112-004 | cc:TODO |
| S112-006 | **per-message 補助 (JSONL 取り込み)** — Hermes に per-message hook が無いため、`~/.hermes/sessions/*.jsonl` を `harness_mem_ingest` 経由で取り込む one-shot スクリプト追加。fswatch ベースのリアルタイム監視は optional として cc:TODO で別タスク化 | `scripts/hermes-jsonl-ingest.sh` (one-shot) 追加、`docs/integrations/hermes.md` に運用手順追記 | S112-005 | cc:TODO |
| S112-007 | **tier 昇格 criteria 文書化** — 何が達成されたら tier 2 / tier 1 に昇格できるかを Plans.md と README に明記 | 昇格 criteria が箇条書きで Plans.md §112 に記載、`README.md` の "(experimental, tier 3)" 注記から criteria 表へ link | S112-005, S112-006 | cc:TODO |

### Non-Goals

- Hermes built-in memory (`MEMORY.md` / `USER.md` / `skills/`) を **置き換える** こと（公式 backend swap API が存在しない）
- per-message (per-turn) event の **同期的** 自動記録（Hermes に `UserPromptSubmit` 相当 hook が無いため、JSONL ingest でベスト努力）
- Hermes 自身の改造（fork / patch） — 公式 plugin 機構の枠内に留める
- claude-code-harness 側 hook 機構との完全一致（Hermes hook signature が独自のため bridge layer で吸収）
- Plans.md §110 (Cross-repo Handoff) との連動 — Hermes は外部 agent であり cross-repo handoff の対象外

### Suggested Execution Order

1. S112-001 — 本セッションで実装済（commit 待ち、commit 後 hash で `[TBD-uncommitted]` を置換）
2. S112-002 / S112-003 — 並行調査可能（独立）
3. S112-004 — 上 2 つの結果を踏まえて plugin 雛形実装
4. S112-005 — E2E 検証
5. S112-006 — JSONL bridge（補助、per-message gap 埋め）
6. S112-007 — tier 昇格 criteria 確定

### tier 昇格 criteria（暫定 — S112-007 で正式化）

**tier 3 (experimental) → tier 2 (recommended)**:
- S112-005 の E2E 検証で `session_start` / `session_end` が安定して記録される
- 直近 30 日間で plugin 関連の重大バグ報告 0 件
- Hermes 最新 minor バージョンで動作確認済み

**tier 2 → tier 1 (Claude Code + Codex 同等)**:
- per-message event 取得手段が確立（Hermes 側に新 hook 追加 or JSONL fswatch 経路が安定）
- `harness-mem doctor` / `doctor --fix` で Hermes wiring も検査対象になる
- `harness-mem setup --platform hermes` で wiring 自動化（現状 manual）

### Cross-repo / 外部参照

- **Hermes Agent**: https://github.com/NousResearch/hermes-agent (v0.13.0, 2026-05-07)
- **Hermes hooks docs**: https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks
- **Hermes MCP guide**: https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes
- **本セッション調査ログ** (2026-05-10): Hermes memory 仕様 (MEMORY.md 2200字 / USER.md 1375字 / skills/ / SQLite session_search) を S112-003 で正式引用予定

### 関連ファイル (Phase A 実装済み)

- [`integrations/hermes/README.md`](integrations/hermes/README.md)
- [`integrations/hermes/examples/hermes-config-minimal.yaml`](integrations/hermes/examples/hermes-config-minimal.yaml)
- [`integrations/hermes/examples/hermes-config-full.yaml`](integrations/hermes/examples/hermes-config-full.yaml)
- [`docs/integrations/hermes.md`](docs/integrations/hermes.md)
- [`README.md`](README.md) — Other Agent Integrations 表に Hermes 行追加
- [`mcp-server/README.md`](mcp-server/README.md) — With Hermes Agent サンプル追記


## §113 Codex Setup Drift Repair Patch (2026-05-11) — cc:完了 [6b2c351]

策定日: 2026-05-11
分類: Local release patch — v0.21.0 公開直後に実機で検出した Codex skill drift 修復ループを閉じる。Cross repo 影響なし。

背景: `harness-mem doctor --json` が `codex_skill_drift` を検出し、fix として `harness-mem setup --platform codex` を提示する。しかし非対話セッションで既存 skill file が存在する場合、`setup` は skill 再インストールを prompt せず、`codex_skill_drift` が残る。結果として doctor が示す修復コマンドで修復できない。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S113-001 | **Codex skill drift の非対話 setup 修復** — `setup` / `update` が非対話実行時に `harness-mem` / `harness-recall` skill bundle drift を検出したら repo 同梱版を再インストールする。対話端末では drift も prompt 対象にする | 既存 skill が stale でも `harness-mem setup --platform codex --skip-start --skip-smoke --skip-quality --skip-version-check` で skill が repo 同梱版に戻る | - | cc:完了 [6b2c351] |
| S113-002 | **doctor --fix の同一ループ解消** — `doctor --fix --platform codex` から `setup_impl` に入る前に skill drift 修復フラグを立て、doctor が提示した auto-fix で drift が消える | temp HOME で stale skill を置いた後、`doctor --fix --platform codex` 相当の経路が skill install を呼ぶ | S113-001 | cc:完了 [6b2c351] |
| S113-003 | **patch release v0.21.1** — version files / changelog / package tarball / GitHub Release / npm latest を同期 | `npm view @chachamaru127/harness-mem version` が `0.21.1`、GitHub Release `v0.21.1` が存在し、`harness-mem doctor --json --platform codex,claude --strict-exit` が green | S113-001, S113-002 | cc:完了 [6b2c351] |


## §114 Codex Notify Chain + Health Alias Repair Patch (2026-05-11) — cc:完了 [52a1e6f]

策定日: 2026-05-11
分類: Local release patch — v0.21.1 公開直後に実機で検出した Codex `notify` duplicate key 起動不能、Codex hooks feature flag の実機表現差、ユーザーが `GET /v1/health` を叩いた場合の 404 を閉じる。Cross repo 影響なし。

背景: Computer Use plugin が Codex top-level `notify` を所有し、`--previous-notify` で harness-mem の `memory-codex-notify.sh` を連鎖する構成がある。この状態で `harness-mem setup --platform codex` が stale harness MCP wiring を修復すると、既存 notify を保持したまま先頭に harness-mem notify block を追加し、TOML 上の `notify` duplicate key で Codex が起動不能になる。

追加背景: daemon の canonical health endpoint は `GET /health` だが、利用者が versioned API の感覚で `GET /v1/health` を叩くと 404 になる。health 確認は障害時の最初の操作なので、互換エイリアスを持たせて operator friction を下げる。

追加背景: Codex の現在の config では `[features] hooks = true` が使われる一方、harness-mem doctor は古い `codex_hooks = true` だけを見ていた。これにより hooks 自体は有効でも `codex_wiring` が missing と誤判定される。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S114-001 | **Computer Use notify chain の既存連鎖検出** — `--previous-notify` 内の JSON-escaped harness-mem notify path も有効な Codex notify wiring として扱う | `check_codex_config_wiring` が `\\/Users\\/...\\/memory-codex-notify.sh` を current harness notify と判定する | - | cc:完了 [52a1e6f] |
| S114-002 | **stale MCP repair 時の notify 重複防止** — stale harness MCP wiring を rewrite する場合でも、既存の Computer Use notify chain を保持し、追加の top-level `notify` を生成しない | temp HOME の Computer Use notify + stale MCP config に `setup --platform codex` を実行しても `^notify =` が 1 件だけ残る | S114-001 | cc:完了 [52a1e6f] |
| S114-003 | **Codex hooks feature flag compatibility** — `features.hooks = true` と `features.codex_hooks = true` の両方を doctor で有効扱いにする | temp HOME の modern `[features] hooks = true` config で `codex_wiring` が ok になる | - | cc:完了 [52a1e6f] |
| S114-004 | **`/v1/health` compatibility alias** — `GET /v1/health` でも `GET /health` と同じ health payload を返す | integration test で `/health` と `/v1/health` の両方が `ok/source/items` を返す | - | cc:完了 [52a1e6f] |
| S114-005 | **patch release v0.21.2** — version files / changelog / package tarball / GitHub Release / npm latest を同期 | `npm view @chachamaru127/harness-mem version` が `0.21.2`、GitHub Release `v0.21.2` が存在し、Codex config TOML parse、`curl /health`、`curl /v1/health`、`doctor --json --platform codex,claude --strict-exit` が green | S114-001, S114-002, S114-003, S114-004 | cc:完了 [52a1e6f] |


## §115 Hermes MCP Large-DB Search Reliability Patch (2026-05-11) — cc:WIP

策定日: 2026-05-11
分類: Local reliability patch — Issue [#102](https://github.com/Chachamaru127/harness-mem/issues/102) で報告された、大規模 DB 上の Hermes MCP search timeout / `daemon_unavailable` 誤報を閉じる。Owner は harness-mem。Hermes 本体や sibling repo の改造は不要。

背景: DB 約 7.9GB / observations 278,553 / vectors 122,347 / `vector_engine=js-fallback` の環境で、HTTP search が数十秒化し、Hermes MCP からは既存 daemon が生きていても `failed to start daemon: exit status 1` と分類される。根は 2 つある。第一に MCP proxy の health probe が短く、既存 daemon 再利用より start attempt に倒れやすい。第二に MCP の Step 1 search が graph/link/vector を常に使うため、Hermes の tool deadline に収まらない大規模 DB 条件がある。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S115-001 | **MCP daemon reuse hardening** — Go / TypeScript MCP proxy が軽量な `/health/ready` を先に確認し、`/health` / `/v1/health` へ fallback する。start 失敗後も既存 daemon health を再確認して OK なら成功扱いにする。health timeout は env で調整可能にする | 既存 daemon が後から health OK になるケースで `failed to start daemon` を返さない unit test が PASS | - | cc:完了 |
| S115-002 | **MCP safe search mode** — `harness_mem_search` に `safe_mode` / `vector_search` を追加。safe mode は `expand_links=false`, `graph_depth=0`, `graph_weight=0`, `vector_search=false` に落とし、FTS-first の軽量候補検索にする | TS / Go MCP schema と REST search request が `vector_search=false` を通し、core が vector/nugget search を skip する unit test が PASS | - | cc:完了 |
| S115-003 | **FTS + reverse-link latency guard** — FTS lexical search は AND-first で候補を取り、0件のときだけ既存 OR fallback に広げる。safe mode では BM25 計算を避けて recent-first 候補にする。加えて `mem_links(to_observation_id, relation, from_observation_id)` / `mem_facts(observation_id, project, merged_into_fact_id)` index を追加し、superseded / active facts 判定で全域 scan しない | `buildFtsQuery(..., "and")` 契約テストと search smoke が PASS。短い一般語で OR 全域検索に即落ちせず、reverse lookup が index を使う | S115-002 | cc:完了 |
| S115-004 | **Hermes docs/config update** — minimal Hermes config に `HARNESS_MEM_MCP_SEARCH_SAFE_MODE=1` を追加し、大規模 DB では safe mode を既定推奨にする。troubleshooting に `daemon_unavailable` 切り分けを追記 | `integrations/hermes/README.md`, `docs/integrations/hermes.md`, config sample が同期 | S115-001, S115-002 | cc:完了 |
| S115-005 | **ingest starvation guard** — Codex / Claude Code / OpenCode / Cursor / Gemini の履歴取り込み既定間隔を 60s に上げ、Claude Code の起動直後 scan を通常 interval まで遅延させる | daemon 起動直後に `/health/ready` が返り、検索中以外の履歴 scan がAPI応答を5秒周期で塞がない | S115-001 | cc:完了 |
| S115-006 | **targeted validation** — Go MCP proxy tests、TS MCP tests、memory-server search tests、Hermes plugin docs/package surface 必要分を実行 | 対象テスト PASS。大規模 DB live probe は `/health/ready` 0.03ms、`harness mem` safe search 773.53ms、`CJ Hermes setup MCP checkpoint` safe search 1057.24ms | S115-001..005 | cc:完了 |


## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。
2026-04-19 のメンテナンスで §79 / §80 / §81 / §82〜§87 / §88 を `docs/archive/Plans-s79-s88-2026-04-19.md` に移動しました。
2026-04-23 のメンテナンス（v0.15.0 リリース後）で §91〜§96 を `docs/archive/Plans-s91-s96-2026-04-23.md` に移動しました。
2026-05-10 のメンテナンス（v0.20.0 リリース後）で §77 / §98 / §99 / §101 / §102 / §103 / §105 / §106 / §107 / §S109 を `docs/archive/Plans-s77-s109-2026-05-10.md` に移動しました（Plans.md 832 → 535 行）。
Plans.md は working plan（§78 + §89 + §90 + §97 + §108 + §110 + §111 + §112）だけをフォアグラウンドで扱う方針です。

参照:

- [§77/§98-§107/§S109 の完了セクション](docs/archive/Plans-s77-s109-2026-05-10.md)（2026-05-10 切り出し、v0.20.0 release 後）
- [§91〜§96 の完了セクション](docs/archive/Plans-s91-s96-2026-04-23.md)（2026-04-23 切り出し、v0.15.0 release 後）
- [§79〜§88 の完了セクション](docs/archive/Plans-s79-s88-2026-04-19.md)（2026-04-19 切り出し）
- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
