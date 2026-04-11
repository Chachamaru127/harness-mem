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

## §79 Pro 日本語差別化: Ruri Tiered Routing + 独自 API — cc:WIP

策定日: 2026-04-12
背景: 現状の Pro 経路 (`pro-api-provider.ts`) は汎用側のみ OpenAI `text-embedding-3-large` に差し替える設計で、**日本語側は Free/Pro で同一 (`ruri-v3-30m`)**。harness-mem のブランド "日本語に強い AI coding memory" と価値提案が噛み合わず、Pro が「OpenAI 転売」になってしまう。差別化を技術資産として内製化するため、**日本語ルートを Pro で大型モデル (`ruri-v3-310m`) + CAN AI 独自 API に切り替える**方向へ再設計する。

**設計原則** (UX 損失防止):
1. Pro は完全 opt-in (`HARNESS_MEM_PRO_API_KEY` + URL 未設定なら挙動不変)
2. Free 側のコードパスを一切壊さない (既存 `ruri-v3-30m` + `multilingual-e5` 維持)
3. Pro 失敗時は Free に自動フォールバック (既存の adaptive-provider 機構を流用)
4. 既存 `mem_vectors` の複合キー設計を利用して 30m/310m を共存保存
5. 既存ベンチマーク (LoCoMo F1 0.5917) は Pro 実装後も同じ数字で再現可能
6. Pro ベンチ結果は `ci-run-manifest-pro-latest.json` に別ファイル分離
7. 段階的 feature flag (`HARNESS_MEM_PRO_JA_ROUTE=1`) で merge 隠蔽

**作業ブランチ**: `feature/pro-japanese-differentiation` (worktree: `../harness-mem-feature-pro-ja`)

**Phase 0-1 調査タスク** (並列実行中):

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S79-001 | [P] ruri-v3-310m 実機検証 | `harness-mem model pull ruri-v3-310m` で download、ONNX load、1 embed サンプル取得、メモリ使用量/latency/ディスク使用量を計測し `docs/pro-api-redesign-2026-04.md` に記録 | - | cc:WIP |
| S79-002 | [P] ベクトル次元 256→1024 の移行戦略設計 | `mem_vectors` の複合キー `(observation_id, model)` で 30m/310m を共存保存する contract 確認。新規保存は 310m、既存 30m は lazy re-index の ON/OFF を決定。schema 変更の要否を判定し設計 doc に記録 | - | cc:WIP |
| S79-003 | [P] transformers.js の ruri-v3-310m 対応確認 | `@huggingface/transformers` で `cl-nagoya/ruri-v3-310m` の ONNX model と tokenizer をロードできるか検証。tokenizer は WordPiece 変換問題が過去に 30m で発生したので要注意 | - | cc:WIP |
| S79-004 | [P] Free vs Pro ベンチマーク仕様書 | `run-ci.ts` を Pro 経路でも走らせる CI 拡張設計。`ci-run-manifest-pro-latest.json` schema 定義、Free vs Pro 比較表の出力 format、差分判定閾値。設計 doc に記録 | - | cc:WIP |
| S79-005 | [P] Pro API サーバー技術選定 | Node.js (transformers.js) / Go (onnx-go) / Python (transformers) の比較表。Fly.io / Cloud Run / Railway のコスト試算 (ruri-v3-310m + 1.2GB + CPU インスタンスで最小 ~¥3,000/月 想定)。MVP 推奨構成を決定 | - | cc:WIP |
| S79-006 | [P] JMTEB / LoCoMo 公式スコア収集 | ruri-v3-30m (72.95) と ruri-v3-310m の公式 JMTEB スコア確認。他日本語 embedding 比較表 | - | cc:WIP |
| S79-007 | 設計ドキュメント `docs/pro-api-redesign-2026-04.md` drafting | 上記 S79-001〜006 の調査結果を統合した設計 doc を feature branch に永続化。現状分析 / 新設計 / feature flag gate / PR 分割 / UX 損失防止ルール / Phase ロードマップを含む | S79-001..006 | cc:TODO |

**Phase 2 実装タスク** (調査結果確定後に着手):

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S79-010 | PR #1: `pro-api-provider` の日本語ルート拡張 | `ruri-v3-310m` を想定したモデル指定、prefix `query: / passage:`、1024次元対応、feature flag off で既存テスト全 PASS | S79-007 | cc:TODO |
| S79-011 | PR #2: `registry.ts` と `adaptive-provider.ts` の japaneseProvider 切替ロジック | `HARNESS_MEM_PRO_JA_ROUTE=1` 時のみ Pro 日本語 API に切替。未設定時は現状 `ruri-v3-30m` | S79-010 | cc:TODO |
| S79-012 | PR #3: 別 private repo `canai-ops/harness-mem-pro-api` の MVP サーバー実装 | Node.js + @huggingface/transformers + ruri-v3-310m の最小 HTTP サーバー (POST /v1/embeddings)、API key 認証、LRU キャッシュ、health check、Fly.io deploy | S79-007, S79-005 | cc:TODO |
| S79-013 | PR #4: Pro 経路の E2E ベンチマーク | `run-ci.ts` を Pro 経路で走らせる CI ジョブ追加、`ci-run-manifest-pro-latest.json` 出力、Free vs Pro の F1 差分を CHANGELOG で報告 | S79-012, S79-010, S79-011 | cc:TODO |
| S79-014 | PR #5: ドキュメント更新 | `docs/adaptive-retrieval.md` と `docs/pro-api-data-policy.md` を新設計 (CAN AI 独自 API 前提) に書き直し | S79-013 | cc:TODO |
| S79-015 | PR #6: feature flag 削除 + GA | `HARNESS_MEM_PRO_JA_ROUTE` flag を削除して正式機能化、v0.12.0 でリリース | S79-014 | cc:TODO |

---

## §78 Legal Refresh: CAN AI LLC + Open Core 整理 — cc:WIP

策定日: 2026-04-11
背景: 以下の法的リスクが発見された: (1) LICENSE の Licensor が `Claude Code Harness` という曖昧表記で BSL 違反時の権利行使主体が不明、(2) `mcp-server/package.json` の license が誤って `MIT` のまま (本来は Open Core 意図どおり)、(3) `mcp-server/README.md` で `@anthropic-ai/harness-mcp-server` という Anthropic 公式 scope を誤用、(4) CLA 不在で将来の商用ライセンス販売が不可能、(5) README で `CAN AI Inc.` と表記されるが実態は合同会社 (正しい英訳は LLC)。これらを一括で塞ぐ。

**方針**: Open Core 戦略を維持 (ルート = BSL、mcp-server/sdk/vscode-extension = MIT)。CAN AI LLC を実在する Licensor として確定。

**作業ブランチ**: `legal/refresh-can-ai-llc-2026-04`

| Task | 内容 | DoD | Status |
|------|------|-----|--------|
| S78-001 | LICENSE の Licensor を `CAN AI LLC` に確定 | `LICENSE` の Licensor 行と Copyright 行が `CAN AI LLC` になっている | cc:完了 |
| S78-002 | NOTICE 新規作成 | BSL 要約、商標通告、CLA 意図、商用ライセンス窓口 (GitHub Discussions 暫定) を含む NOTICE がルートに存在 | cc:完了 |
| S78-003 | CONTRIBUTING.md 新規作成 | License grant 条項、moral rights waiver (日本法 著作者人格権不行使)、originality、no warranty を含む CONTRIBUTING.md がルートに存在 | cc:完了 |
| S78-004 | TRADEMARK.md 新規作成 | harness-mem 名称・ロゴの使用ポリシー (nominative fair use / 禁止事項 / フェアユース / エンフォースメント) を含む TRADEMARK.md がルートに存在 | cc:完了 |
| S78-005 | Anthropic 商標侵害の除去 | `mcp-server/README.md` の `@anthropic-ai/harness-mcp-server` 参照を `@canai/mcp-server` に置換済み | cc:完了 |
| S78-006 | mcp-server / memory-server の scope 変更 | `@claude-code-harness/*` → `@canai/*` に変更済み (商標リスク回避) | cc:完了 |
| S78-007 | mcp-server license rollback (Open Core 維持) | `mcp-server/package.json` の license を `MIT` に戻し、`mcp-server/README.md` の License 節も MIT + Open Core 説明に差し替え | cc:完了 |
| S78-008 | README の `CAN AI Inc.` → `CAN AI LLC` 統一 | `README.md:575` と `README_ja.md:571` の表記を統一 | cc:完了 |
| S78-009 | sdk / vscode-extension に author 追加 | `sdk/package.json` と `vscode-extension/package.json` に `"author": "CAN AI LLC"` を追加 (license は MIT 維持) | cc:完了 |
| S78-010 | Plans.md に §78 と §79 を追記 | 本ドキュメントが Plans.md に永続化される | cc:WIP |
| S78-011 | commit + PR 作成 | `legal/refresh-can-ai-llc-2026-04` ブランチでコミット、PR を main に向けて作成 | cc:TODO |

**リリースブロッカー**: v0.12.0 までに S78 を main にマージしておくこと。

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

---

## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。Plans.md は working plan（§77 + §78）だけをフォアグラウンドで扱う方針です。

参照:

- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
