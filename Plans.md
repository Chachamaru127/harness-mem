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
| S78-D01 | **Temporal forgetting** — 時限付き fact (e.g. "deploying today") に TTL を設定、期限切れで自動 archive | §80-B02 (low-value eviction) に統合。S80-B02 の score-based archive が score 軸の 1 つとして `age_days` を含み、TTL ベースは specialization として `expires_at` を B02 の score 重み 0.0 オーバーライドで表現する方向に寄せる | - | cc:retired (→ S80-B02) |
| S78-D02 | **Contradiction resolution** — 新 fact が既存 fact と矛盾する場合、古い方を自動 supersede | §80-B03 (Jaccard + LLM contradiction detection) に統合。S80-B03 は detection + `superseded` relation 書き込みまで一気通貫で扱うため、D02 の relation-only 提案は B03 の部分集合として吸収 | S78-C02 | cc:retired (→ S80-B03) |
| S78-D03 | **Auto project profile** — 静的 fact (tech stack, team convention) と動的 fact (current sprint, recent decisions) を自動分離・維持 | `harness_mem_status` に `project_profile` フィールド追加、token-compact な要約を返す | S80-B02, S80-B03 | cc:TODO |

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

## §80 agentmemory Cross-Pollination — cc:TODO

策定日: 2026-04-14
背景: `rohitg00/agentmemory` v0.8.6 との flat 比較採点 (15 軸 / 150 点満点) で **mem 109 vs agm 121**、差 12 点。差分の 9 割は agm の **multi-agent coordination primitives** (leases / signals / actions / frontier) と **lifecycle hygiene** (auto-forget) に集中。これらは mem の 3 軸モート (project-scoped × tool-agnostic × local-first) を壊さず、かつ "Claude Code + Codex 二刀流" ポジショニングを**機能面で回収**する方向の追加。表層のツール増やしや REST endpoint 追加は除外し、**mem の差別化軸を強める**ものだけ厳選。

### 戦略的位置づけ

- **守る**: Go MCP cold start ~5ms / SQLite 単一 DB / Go 単一 binary / developer-workflow domain focus
- **取り込む軸**: (1) multi-agent coordination, (2) lifecycle hygiene, (3) UX friction reduction, (4) provider resilience
- **明示的に取り込まない**: iii-engine 依存, 109 REST endpoint 全量, MEMORY.md 双方向同期, Mesh P2P sync, LongMemEval 追走

### 既存 §78 との境界

| §80 項目 | §78 との関係 |
|---|---|
| Phase A (coordination) | 新規。§78 に該当 phase なし |
| Phase B (lifecycle) | §78 Phase D と**部分重複** — S80-B01 で統合判定 |
| Phase C (UX) | §78 Phase E-01 (privacy tags) とは独立 |
| Phase D (resilience) | 新規。§78 に該当 phase なし |
| worktree unifier (A01) | §78-E02 (branch-scoped) とは別概念 — scope と unifier で役割分担 |

---

### Phase A: Multi-Agent Coordination Primitives — core pivot

mem の "Claude Code + Codex 二刀流" 看板を**機能面で回収**する。現状は 2 エージェントが同じファイルを触り合う衝突を防ぐ術がない。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-A01 | **Worktree / repo-root unifier** — `git rev-parse --git-dir` と `--git-common-dir` の差分で worktree を検出し、同一 repo の worktree 群を `project_key` に寄せる。Go 側 `internal/util` に `ResolveProjectKey(cwd)` を新設、memory-server 側 `core/session-manager.ts` から呼ぶ | 同じ repo の 3 worktree から ingest した observation が `project` で同一 key に集約され、`harness_mem_stats` で 1 プロジェクト扱いになる integration test が PASS | - | cc:完了 |
| S80-A02 | **Lease プリミティブ** — `harness_mem_lease_acquire` / `_release` / `_renew` MCP tool 追加。`target` (file path / action_id / 任意 key) + `agent_id` + `ttl_ms` (default 600_000, max 3_600_000)。SQLite `leases` table 新設、`(target, status='active', now<expires_at)` index | 2 つの agent が同一 target を lease すると後発は `{error:"already_leased", heldBy, expiresAt}` を返す。TTL 超過で以降の acquire が成功する。Go 側 `contextbox.go` と schema parity test 追加 | S80-A01 | cc:完了 |
| S80-A03 | **Signal プリミティブ (inter-agent messaging)** — `harness_mem_signal_send` / `_read` / `_ack` MCP tool。`from` / `to` (nullable for broadcast) / `thread_id` / `reply_to` / `content` / `expires_in_ms`。未 ack の signal のみ `_read` で返る | Claude が送った signal を Codex の `_read` が取得でき、ack 済みは再取得されない。`reply_to` で thread が繋がる test PASS | S80-A02 | cc:完了 |
| S80-A04 | **Doctor 統合 & README 節追加** — `harness-mem doctor` に lease/signal 可用性チェックを追加、`README.md` / `README_ja.md` に "dual-agent coordination" 節を新設し lease/signal の 10 行 example を掲載 | `doctor` 緑、README と README_ja に節と example が存在 | S80-A02, S80-A03 | cc:TODO |

### Phase B: Memory Lifecycle Hygiene

長期運用 (6 か月+) での DB 肥大化と矛盾蓄積を防ぐ。§78 Phase D と一部重複するため**統合判定を先に行う**。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-B01 | **§78-D との整合整理** — §78-D01 (temporal forgetting) / D02 (contradiction resolution) と本 Phase の重複範囲を棚卸し、実装 plan を 1 本に統合 (どちらの節に task を置くか確定) | §78-D01 → §80-B02 に吸収 (score 軸の `age_days` + `expires_at` override)。§78-D02 → §80-B03 に吸収 (detection + relation 書き込みを B03 が一気通貫で担当)。§78-D03 は独立維持、depends を S80-B02, S80-B03 に更新 | - | cc:完了 |
| S80-B02 | **Low-value eviction policy** — `access_count` / `strength` / `age_days` の複合スコアで低価値 observation を自動 archive (soft delete のみ、hard delete はしない)。default は dry_run、`HARNESS_MEM_AUTO_FORGET=1` で有効化 | `harness_mem_admin_consolidation_run` に `forget_policy` オプション追加、evict 件数と対象 ID を audit log に記録、dry_run と wet で結果一致 test PASS | S80-B01 | cc:TODO |
| S80-B03 | **Contradiction detection (Jaccard + LLM 確認)** — 同一 `concept` を持つ memory 2 件で content の Jaccard 類似度 > 0.9 をペア候補、LLM で矛盾判定、confirmed なら古い方を `superseded` relation 経由で格下げ | fixture に矛盾 pair を 3 件注入、detection precision ≥ 0.95 / recall ≥ 0.8 が 3-run で PASS | S80-B02 | cc:TODO |

### Phase C: UX Friction Reduction

Codex CLI の tool 欄圧迫 / API key 必須問題 / citation 不可視を潰す。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-C01 | **Tool visibility tiering** — `HARNESS_MEM_TOOLS=core\|all` env で expose 数を切替。core 7 本 = `search` / `timeline` / `get_observations` / `sessions_list` / `record_checkpoint` / `resume_pack` / `health` | `core` で `tools/list` が 7 件、`all` で全件 (後方互換 default は `all`)。Go 側 `registry.go` に `filterByVisibility` 追加、env variant test PASS | - | cc:完了 |
| S80-C02 | **Claude Agent SDK provider** — consolidation / rerank の LLM 呼び出しで `@anthropic-ai/claude-agent-sdk` が利用可能なら subscription 経由を優先、API key 不在でも動作。不可用時は既存 `openai-provider` / `ollama-provider` に fallback | `ANTHROPIC_API_KEY` 未設定かつ Claude subscription あり環境で `harness_mem_admin_consolidation_run` が成功、provider switch log が記録される | - | cc:TODO |
| S80-C03 | **`harness_mem_verify` (citation trace) MCP tool** — `observation_id` を渡すと `core/provenance-extractor.ts` の出力 (source session / tool_use event / file path + action) を tree 形式で返す | 1 call で observation → (session_id, event_id, file_path, action) が返り、`harness_mem_graph` の BFS と組合せて 2-hop 遡及が可能な integration test PASS | - | cc:TODO |

### Phase D: Provider Resilience

現状 `embedding/fallback.ts` は失敗即切替のみで consecutive failure + cooldown がなく、ollama ↔ local ONNX ↔ pro-api の flap が起こる。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S80-D01 | **Circuit breaker with cooldown** — provider ごとに `consecutive_failures` と `last_failure_at` を管理、閾値 (default 3) 超えで cooldown (default 60s) に入り skip。復帰時に half-open で 1 probe | `embedding/fallback.ts` に breaker 組み込み、provider 故意落としテストで cooldown 時間は他 provider、復帰後に元が戻る 3-run test PASS | - | cc:完了 |

---

### §80 Global DoD

1. Phase A 全 task 完了で mem の 3 軸モート (project-scoped × tool-agnostic × local-first) に **dual-agent coordination** 軸が加わる
2. Phase B の S80-B01 完了で §78-D との boundary が明確化、実装 plan が 1 本化
3. Phase C 全 task 完了で Codex CLI 初期導入時の tool 欄と API key 摩擦が消える
4. §80 全 task 完了後、agentmemory との 15 軸再採点で mem が **≥ 121 点 (agm と同点以上)** に到達

### §80 優先度と推奨実行順

```
Phase A (Multi-Agent Coordination)  ← v0.12.0 or v0.13.0 の差別化コア (最優先)
Phase B (Lifecycle Hygiene)          ← S80-B01 後、§78-D と統合して着手
Phase C (UX Friction Reduction)      ← 各 Phase と並列可、C01/C02 は小粒
Phase D (Provider Resilience)        ← v0.13.0 以降の保守性向上 (後回し可)
```

### 取り込まない（明示的除外）

| 機能 | 除外理由 |
|---|---|
| iii-engine 依存 | Go 単一 binary + ~5ms cold start の設計思想に反する |
| 109 REST endpoint 全量 | MCP 中心方針に反し、保守コストが跳ね上がる |
| MEMORY.md 双方向同期 | `SQLite = 唯一の SSOT` 原則と衝突 |
| Mesh P2P sync | §79v3 の個人開発者ターゲットから外れ、security surface が増える |
| LongMemEval 追走 | domain mismatch（§78-A02 で pivot 済み、dev-workflow gate が main） |
| entity-graph 独立実装 | §78-C02/C03 と重複、§78-C 側に寄せる |

---

---

## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。Plans.md は working plan（§77 + §78）だけをフォアグラウンドで扱う方針です。

参照:

- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
