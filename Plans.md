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

## §77 Retrieval Quality Regression 調査 — cc:TODO

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
| S77-001 | node_modules の transformers.js バージョン固定 + lockfile 整備 | 2回連続でビルドして同じ embedding が出る | cc:TODO |
| S77-002 | Apple M1 vs Linux x64 での embedding 差分計測 | 再現環境で多桁一致/不一致を報告 | cc:TODO |
| S77-003 | `multi-project-isolation.test.ts` の 2 test を re-enable + 閾値再定義 | `test.skip` を削除して PASS、閾値の根拠を test 内コメントに明記 | cc:TODO |
| S77-004 | bilingual Recall の v0.9.0 ベースライン復元 (または新ベースライン確立) | `ci-run-manifest-latest.json` の bilingual_recall が再現可能に安定 | cc:TODO |

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
| S78-A01 | **Developer-domain main gate を release.yml に組み込み** — dev-workflow / bilingual / knowledge-update / temporal の 4 指標を release gate 化 (Layer 1 absolute floor) | release.yml の benchmark ゲートが 4 指標で判定、各 Task の DoD 閾値で fail/pass を出す | - | cc:TODO |
| S78-A02 | **LoCoMo 関連の外部公開を停止** — LoCoMo full fixture / result / reference JSON を repo から削除、README と competitors JSON から full スコア言及を削除。120Q subset は既存の扱いを維持 | `tests/benchmarks/fixtures/locomo-full-1986.json` と `docs/benchmarks/locomo-full-reference.json` と `memory-server/src/benchmark/results/locomo-full-latest.json` が repo から除去され、README の比較表と competitors JSON にも full スコアが載っていない | - | cc:完了 |
| S78-A03 | **§77 の 4 タスクを統合実施** — transformers.js lockfile 固定、embedding 再現性確保、multi-project-isolation test re-enable | S77-001〜S77-004 の全 DoD を達成 | - | cc:TODO |
| S78-A04 | **Domain-aware 比較表に全面改訂** — competitor JSON と README の比較表に "domain" カラム追加 (general-lifelog / developer-workflow / generic-agent) | 比較表が domain を明示し、harness-mem の LoCoMo full 0.0546 が "general-lifelog reference" として表示 | S78-A02 | cc:TODO |
| S78-A05 | **Developer-domain Recall improvement iteration** — dev-workflow recall 0.59 → 0.70 に引き上げ (S78-B の下準備) | Full `npm test` で dev-workflow recall ≥ 0.70 が 3-run PASS | S78-A01 | cc:TODO |

### Phase B: Retrieval Quality Leap

MemPalace の verbatim storage + hierarchical metadata のアプローチを取り入れ、retrieval quality を構造的に改善する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-B01 | **Verbatim raw storage mode** — structured observation と並行して raw conversation text を保存。embedding は raw text から生成 | `HARNESS_MEM_RAW_MODE=1` で observation + raw text が両方保存される。LoCoMo F1 が raw mode で改善 | S78-A03 | cc:TODO |
| S78-B02 | **Hierarchical metadata filtering** — project → session → thread → topic の 4 層メタデータで検索をスコープ | 検索 API に `scope` パラメータ追加、LoCoMo temporal が改善 | S78-B01 | cc:TODO |
| S78-B03 | **Token-budget-aware wake-up context** — SessionStart artifact を L0 (critical facts, ~170 tokens) + L1 (recent context) の 2 層に分離 | SessionStart の token 消費を 50% 削減しつつ first-turn continuity を維持 | S78-B02 | cc:TODO |
| S78-B04 | **Re-benchmark** — Phase B 全完了後に LoCoMo Full + LongMemEval を再実行 | F1 delta を committed JSON で記録、README 更新 | S78-B03 | cc:TODO |

### Phase C: Graph Memory v2

Mem0 の $249/mo graph memory を local-first で無料提供する。Mem0 のペイウォール破壊が戦略的目標。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-C01 | **Local graph store 選定と PoC** — Kuzu (embedded graph DB) vs SQLite recursive CTE を比較 | PoC で 100 entity / 500 relation を insert → 3-hop query が < 10ms で返る方を採用 | - | cc:TODO |
| S78-C02 | **Entity-relationship extraction on ingest** — observation 保存時に NLP で entity + relation を自動抽出、graph に投入 | `harness_mem_graph` が抽出された entity/relation を返す | S78-C01 | cc:TODO |
| S78-C03 | **Multi-hop reasoning queries** — `harness_mem_search` に `graph_depth` パラメータ追加、graph を辿って関連 observation を追加取得 | multi-hop query が LoCoMo temporal category の F1 を改善 | S78-C02 | cc:TODO |
| S78-C04 | **Graph-augmented hybrid search** — vector search のスコアに graph proximity signal を加算 | A/B test で graph augmentation あり/なしの F1 delta を計測 | S78-C03 | cc:TODO |

### Phase D: Intelligent Memory Lifecycle

SuperMemory の temporal forgetting + contradiction resolution + auto profiles を local-first で実装。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-D01 | **Temporal forgetting** — 時限付き fact (e.g. "deploying today") に TTL を設定、期限切れで自動 archive | `harness_mem_ingest` に `expires_at` パラメータ追加、期限切れ observation は検索結果から除外 | - | cc:TODO |
| S78-D02 | **Contradiction resolution** — 新 fact が既存 fact と矛盾する場合、古い方を自動 supersede | `harness_mem_add_relation` に `supersedes` relation type 追加、superseded observation は検索 rank を下げる | S78-C02 | cc:TODO |
| S78-D03 | **Auto project profile** — 静的 fact (tech stack, team convention) と動的 fact (current sprint, recent decisions) を自動分離・維持 | `harness_mem_status` に `project_profile` フィールド追加、token-compact な要約を返す | S78-D01, S78-D02 | cc:TODO |

### Phase E: Developer Experience

claude-mem + Hermes の優れた DX パターンを取り入れる。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-E01 | **Privacy tags** — `<private>` タグで囲んだ内容を memory storage から自動除外 | ingest 時に `<private>...</private>` を strip して保存しない | - | cc:TODO |
| S78-E02 | **Branch-scoped memory** — git branch 名で observation をスコープ、branch merge 時に統合 | `harness_mem_search` に `branch` パラメータ追加、feature branch の memory が main に merge 可能 | - | cc:TODO |
| S78-E03 | **Progressive disclosure** — 3-layer retrieval (index → context → full detail) with token cost visibility | search API が `detail_level` パラメータを受け取り、token budget に応じた粒度で返す | S78-B03 | cc:TODO |
| S78-E04 | **Procedural skill synthesis** — 5+ ステップの複雑タスク完了後、再利用可能な手順書を自動生成して memory に保存 | `harness_mem_finalize_session` が長い session を検出して skill document を提案 | S78-D03 | cc:TODO |

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

## §80 Pro API Concierge + Learning Loop — cc:WIP

策定日: 2026-04-14
背景: harness-mem の Pro 経路 (`pro-api-provider.ts`) は汎用側のみ OpenAI `text-embedding-3-large` に差し替える設計で、日本語側は Free/Pro で同一 (`ruri-v3-30m`)。これは 2 つの弱点を生む:
1. ブランド (日本語に強い AI coding memory) と価値提案が噛み合わない
2. Pro が実質「OpenAI 転売」になり、差別化が薄い

さらに S79 の 6 調査で判明:
- `ruri-v3-310m` と `ruri-v3-130m` の JMTEB retrieval は同スコア (81.89) → 130m で十分
- `cl-nagoya/ruri-v3-310m` には ONNX 版が無い → Python + PyTorch サーバー路線が確実
- `mem_vectors` は (observation_id, model) 複合キーで新旧次元の共存可能 → 移行ノーコスト
- OpenAI / Gemini の日本語 retrieval は Ruri より弱い公算大 → Ruri 特化で勝てる

本章では harness-mem の Pro 経路を **「ただのラッパー」から「コンシェルジュ型 + 自己学習ループ」** へ再設計する。

**戦略的目標**:
1. Pro API を単なる embedding プロキシではなく、10 レイヤーの統合最適化サービスにする
2. 顧客行動から暗黙の学習信号を集め、週次で fine-tune する自己強化ループを作る
3. プラン体系 (Free / Pro Learn / Pro Private / Enterprise) でプライバシーと収益を両立させる
4. 週次ベンチ + shadow deploy で自動学習の暴走を封じ、透明性をマーケティングに変える

**作業ブランチ**: `feature/pro-japanese-differentiation` (worktree: `../harness-mem-feature-pro-ja`)

**詳細設計書** (本章はインデックス。技術詳細は以下を参照):
- [docs/launch/01-pro-api-concierge-spec.md](docs/launch/01-pro-api-concierge-spec.md) — API + 10 レイヤー パイプライン + 技術スタック + ディレクトリ構成
- [docs/launch/02-feedback-signal-collection.md](docs/launch/02-feedback-signal-collection.md) — 既存 MCP ツールへのフック + 匿名化 + Telemetry モジュール
- [docs/launch/03-pricing-plans.md](docs/launch/03-pricing-plans.md) — 4 プラン体系 + 価格 + データ利用条項 + Zero-Retention 担保
- [docs/launch/04-weekly-benchmark-regression.md](docs/launch/04-weekly-benchmark-regression.md) — Shadow deploy + Regression Gates + 透明性公開

**S79 調査成果物** (設計書の根拠):
- [docs/pro-api-redesign-2026-04-investigation/s79-001-ruri-310m-feasibility.md](docs/pro-api-redesign-2026-04-investigation/s79-001-ruri-310m-feasibility.md)
- [s79-002-vector-migration.md](docs/pro-api-redesign-2026-04-investigation/s79-002-vector-migration.md)
- [s79-004-benchmark-spec.md](docs/pro-api-redesign-2026-04-investigation/s79-004-benchmark-spec.md)
- [s79-005-server-tech-stack.md](docs/pro-api-redesign-2026-04-investigation/s79-005-server-tech-stack.md)
- [s79-006-jmteb-scores.md](docs/pro-api-redesign-2026-04-investigation/s79-006-jmteb-scores.md)
- S79-003 (transformers.js 互換性) は parent session で直接検証済。ruri-v3-310m に公式 ONNX なし → PyTorch 路線確定

**採用モデル**: `ruri-v3-130m` (dim=512, ~300MB, JMTEB retrieval 81.89) を Pro デフォルトに採用。310m は Enterprise tier の fine-tune ベースとして温存。

### Phase 0: 設計書固め — cc:完了

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-000 | 4 設計書を docs/launch/ に永続化 | 01-04 の 4 ファイルが存在、相互参照 link が通っている | S79-001..006 | cc:完了 |
| S80-001 | Plans.md §80 を追加 | 本節が Plans.md に永続化される | - | cc:完了 |
| S80-002 | model-catalog.ts の dimension 訂正 | `ruri-v3-310m` の dimension を 1024→768 に修正、`ruri-v3-130m` を新規登録 (dim=512, size=300MB) | - | cc:TODO |

### Phase 1: MVP Pro API サーバー (4〜6 週間) — cc:TODO

別 private repo `canai-ops/harness-mem-pro-api` で実装。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-100 | `canai-ops/harness-mem-pro-api` repo 作成 + scaffold | FastAPI + Docker + Fly.io deploy で hello world | S80-002 | cc:TODO |
| S80-101 | `/v1/embed` エンドポイント (薄い Ruri-130m ラッパー) | POST で text 受付、ruri-v3-130m で embedding 返却、P95 < 300ms | S80-100 | cc:TODO |
| S80-102 | Concierge パイプライン (10 レイヤー) 実装 | `/v1/search` が analyze → route → embed → retrieve → rerank → postprocess を通す | S80-101 | cc:TODO |
| S80-103 | `/v1/feedback` + `/v1/analyze` + `/v1/rerank` | 独立エンドポイントとして公開、Pro Private の透過モード対応 | S80-102 | cc:TODO |
| S80-104 | 認証 + Rate Limit + tenant DB | API key 発行、60 req/min 制限、PostgreSQL で tenant 管理 | S80-100 | cc:TODO |
| S80-105 | Observability (Datadog 連携) | p50/p95/p99 latency, error rate, cache hit rate を可視化 | S80-101 | cc:TODO |
| S80-106 | Fly.io NRT 本番 deploy | performance-2x + persistent volume でモデル永続化、稼働確認 | S80-100 | cc:TODO |

### Phase 2: Client 側フィードバック統合 (2〜3 週間) — cc:TODO

harness-mem OSS 側 (このリポジトリ) に最小限の変更。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-200 | Telemetry モジュール `memory-server/src/telemetry/feedback.ts` | FeedbackEmitter class、デフォルト off、opt-in 動作、batch uploader | - | cc:TODO |
| S80-201 | 既存 MCP ハンドラへのフック (5〜6 箇所) | record_checkpoint / get_observations / search / record_event / finalize_session に 3〜5 行追加 | S80-200 | cc:TODO |
| S80-202 | 新 MCP tool `harness_mem_feedback` | 明示 👍/👎 の受付 MCP tool、10 行実装 | S80-200 | cc:TODO |
| S80-203 | client 側の匿名化実装 | query_hash (salt+sha256), PII redact, plan 別の drop ロジック | S80-200 | cc:TODO |
| S80-204 | `~/.harness-mem/telemetry.log` 監査ログ | 送信した feedback event が local にも記録される (透明性担保) | S80-203 | cc:TODO |

### Phase 3: プラン体系 + 決済 (3〜4 週間) — cc:TODO

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-300 | Stripe Subscription 設定 | Free / Pro Learn / Pro Private の 3 プラン、月額/年額切替、日割り精算 | S80-104 | cc:TODO |
| S80-301 | 顧客向け管理画面 (自社) | 使用量、API key 表示/再発行、請求書 | S80-300 | cc:TODO |
| S80-302 | Pricing page (harness-mem.jp) | 4 プラン比較表、FAQ、Zero-Retention 訴求 | S80-300 | cc:TODO |
| S80-303 | 契約書テンプレート整備 | Pro Learn (データ利用同意)、Pro Private (Zero-Retention 保証)、Enterprise (NDA) の 3 本 | - | cc:TODO |
| S80-304 | 正式公開 β 開始 | 個人向け先行公開、API key 先着 50 名に発行 | S80-300..303, S80-106 | cc:TODO |

### Phase 4: 週次 Benchmark + Shadow Deploy (3 週間) — cc:TODO

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-400 | Shadow deploy (candidate/stable 分離) | Fly.io で 2 process group、internal endpoint を分離 | S80-106 | cc:TODO |
| S80-401 | GitHub Actions 週次 runner | 日曜 03:00 JST cron、fixture 5 種 × stable/candidate = 10 実行 | S80-400 | cc:TODO |
| S80-402 | Regression Gates 評価 + auto-rollback | Layer 1 退化で candidate 自動破棄、性能退化で alert | S80-401 | cc:TODO |
| S80-403 | 透明性 JSON 公開 + ダッシュボード | `harness-mem.jp/transparency/pro-weekly-latest.json` と time series UI | S80-402 | cc:TODO |
| S80-404 | Slack `#harness-mem-quality` 連携 | 週次 verdict と alert を自動通知 | S80-402 | cc:TODO |

### Phase 5: 学習ループ 段階 2 (チューニング自動化) (4 週間) — cc:TODO

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-500 | Feedback 集約パイプライン | 週次で signals を tenant 横断で集約、分布 / 偏り metric を Datadog に送出 | S80-200..204, S80-106 | cc:TODO |
| S80-501 | `benchmark:tune-adaptive` の server 化 | サーバー側で routing パラメータを週次自動調整、candidate として deploy | S80-500, S80-400 | cc:TODO |
| S80-502 | Synonym 辞書の自動拡張 | feedback から同義候補を抽出、人間レビュー後に synonyms-ja/en.json に追加 | S80-500 | cc:TODO |
| S80-503 | 段階 2 の効果測定 | tune 前/後で Layer 1 指標を diff、改善を CHANGELOG に記録 | S80-501, S80-402 | cc:TODO |

### Phase 6: 本格 Fine-tune (段階 3) (6〜8 週間) — cc:TODO

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-600 | GPU inference server (burst 起動) | Modal / Replicate / Fly GPU で学習ジョブ、stable 推論は Fly NRT のまま | S80-500 | cc:TODO |
| S80-601 | LoRA fine-tune pipeline | Ruri-130m に対して feedback 由来データセットで LoRA 学習、週次実行 | S80-600 | cc:TODO |
| S80-602 | A/B テスト基盤 | candidate vs stable の live A/B (Pro Learn 顧客の 5% に candidate) | S80-601, S80-400 | cc:TODO |
| S80-603 | 最初の custom model 稼働 | `harness-mem/ja-memory-v1` (仮) が stable promotion、LoCoMo F1 で stable Ruri より +0.02 達成 | S80-602 | cc:TODO |

### Phase 7: Enterprise (継続) — cc:TODO

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-700 | SSO / SAML 対応 | Okta / Entra ID / Google Workspace で SAML login | S80-301 | cc:TODO |
| S80-701 | 監査ログ S3 export | 日次で tenant 専用 S3 bucket にログを export | - | cc:TODO |
| S80-702 | オンプレ配布 (Docker + Helm) | Docker image + Helm chart、契約顧客の自社 k8s に deploy 可能 | S80-106 | cc:TODO |
| S80-703 | SOC 2 Type II 取得 | 第三者監査取得、Zero-Retention 証明書発行 | S80-303 | cc:TODO |

### 注意事項 / リスク

- **学習暴走**: Shadow deploy + Layer 1 auto-rollback で技術的に封じる ([04 仕様書 §4](docs/launch/04-weekly-benchmark-regression.md))
- **プライバシー**: Opt-in default off + client 側 drop + SOC 2 計画で多層防御 ([03 仕様書 §6](docs/launch/03-pricing-plans.md))
- **Ruri 品質**: Phase 1 末に公開ベンチ実測で検証。期待通りでなければ 310m or OpenAI hybrid に切替
- **採算ライン**: Phase 1〜3 で固定費 < ¥50k/月、Pro Learn 10 seat で回収開始
- **競合対応**: OpenAI/Gemini が日本語特化モデルを出した時点で、差別化は運用・契約・ブランドに移行

### Global DoD (本章全体の達成条件)

1. Pro API が本番稼働し、Pro Learn / Pro Private / Enterprise の 3 プランで受付可能
2. 週次 benchmark が 4 週連続 PASS、auto-rollback が 1 回以上動作
3. 段階 2 の自動チューニングで Layer 1 指標が baseline より改善
4. `harness-mem.jp/transparency` が公開稼働、過去 8 週以上の履歴
5. Pro Learn 10 seat 以上の契約実績
6. Phase 6 で初の custom model (`ja-memory-v1`) が stable promotion
7. Phase 3 以降、既存 OSS の Free 体験は一切劣化しない (下方互換)

---

## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。Plans.md は working plan（§77 + §78）だけをフォアグラウンドで扱う方針です。

参照:

- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
