# Harness-mem 実装マスタープラン

最終更新: 2026-03-03（v5ベンチマーク + §29改善プラン策定）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-21 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 → [`docs/archive/Plans-s22-2026-02-27.md`](docs/archive/Plans-s22-2026-02-27.md)
> §23-26 → [`docs/archive/Plans-s23-s26-2026-03-02.md`](docs/archive/Plans-s23-s26-2026-03-02.md)
> §27 → [`docs/archive/Plans-s27-2026-03-02.md`](docs/archive/Plans-s27-2026-03-02.md)
> §28P1 CQRS + ReviewR1 + FIX-001 + §27.1 → [`docs/archive/Plans-s28-review-2026-03-03.md`](docs/archive/Plans-s28-review-2026-03-03.md)
> §28 v2 アーキテクチャ再設計プラン → plan file `glowing-wibbling-brooks.md`
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md) / [`docs/test-designs-s27.1.md`](docs/test-designs-s27.1.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## §29. 3社同率首位からの単独トップ奪還（119→128/140）

**背景**: v5ベンチマークで harness-mem = supermemory = mem0 = **119/140** の3社同率首位。リード消失。
**ベンチマーク v5**: [`docs/benchmarks/competitive-analysis-2026-03-03-v5.md`](docs/benchmarks/competitive-analysis-2026-03-03-v5.md)
**前提**: §27.1 + §28P1(CQRS) + ReviewR1 全完了。811テスト全通過。

**負けている軸（6軸、-7pt）**:

| 軸 | 現状 | Best | Gap | 優先度 |
|----|:----:|:----:|:---:|:------:|
| Graph / Relations | 8 | SM **10** | **-2** | **CRITICAL** |
| Search / Retrieval | 9 | mem0 **10** | **-1** | HIGH |
| Platform Integration | 9 | SM/mem0 **10** | **-1** | HIGH |
| Memory Model | 8 | 4社 **9** | **-1** | HIGH |
| Cloud Sync | 9 | SM **10** | **-1** | MEDIUM |
| UI / Dashboard | 8 | SM **9** | **-1** | MEDIUM |

---

### Phase 1: 即効性の高い差別化（P0, +5pt → 124, 4並列可）

- [ ] `cc:TODO [feature:tdd] [P]` **V5-001**: Graph 強化 — ナレッジグラフ API + Embeddable コンポーネント
  - **8→10 (+2pt, CRITICAL)**
  - (a) サブグラフ取得 API: `GET /v1/graph?entity=X&depth=3`
  - (b) `shared_entity` リンク自動検出
  - (c) relation types: 既存5種 + `contradicts`/`causes`/`part_of`（計8種）
  - (d) `<HarnessMemGraph />` React コンポーネント (D3.js force-directed)
  - DoD: サブグラフAPI + 自動リンク + 8 relations + React可視化 + テスト 10件

- [ ] `cc:TODO [feature:tdd] [P]` **V5-002**: Cross-Encoder Reranker 統合
  - **9→10 (+1pt, HIGH)**
  - (a) `IReranker` プロバイダーインターフェース
  - (b) Cohere rerank-v3.5 / HF cross-encoder / ローカル sentence-transformers
  - (c) 既存 simple-reranker をフォールバック維持
  - DoD: 3プロバイダー + フォールバック + テスト 8件

- [ ] `cc:TODO [feature:tdd] [P]` **V5-003**: Platform SDK — Vercel AI + CrewAI + MCP Registry
  - **9→10 (+1pt, HIGH)**
  - (a) Vercel AI SDK MemoryProvider + CrewAI Memory ラッパー
  - (b) MCP Registry（smithery.ai）公式登録
  - (c) `npx harness-mem setup --client [claude|cursor|windsurf|cline]`
  - DoD: 2 SDK + Registry + セットアップ + テスト 8件

- [ ] `cc:TODO [feature:tdd] [P]` **V5-004**: Memory Model — episodic/semantic/procedural 自動分類
  - **8→9 (+1pt, HIGH)**
  - (a) `observation_type` 拡張 + `classifyMemoryType()`
  - (b) 検索時の `memory_type` フィルタ
  - DoD: 3記憶型の自動分類 + フィルタ + テスト 8件

---

### Phase 2: 優位性の固定化（P1, +2pt → 126, 3並列可）

- [ ] `cc:TODO [feature:tdd] [P]` **V5-005**: Cloud Sync コネクタ — GitHub/Notion/GDrive
  - **9→10 (+1pt)**. SyncStore DB永続化 + 3コネクタ
  - DoD: 3コネクタ + DB永続化 + テスト 8件

- [ ] `cc:TODO [feature:tdd] [P]` **V5-006**: UI Analytics ダッシュボード
  - **8→9 (+1pt)**. 使用量グラフ + エンティティヒートマップ + タイムライン
  - DoD: 4ビュー + テスト 6件

- [ ] `cc:TODO [P]` **V5-007**: ベンチマーク公開 + CI 自動実行
  - LoCoMo/LongMemEval 公式スコア計測 + CI 週次 + Recall@10 回帰ゲート
  - DoD: CI自動実行 + 結果公開 + テスト 5件

---

### Phase 3: 圧倒的差別化（P2, +2pt → 128）

- [ ] `cc:TODO [feature:tdd]` **V5-008**: 音声トランスクリプション（Whisper.cpp）
  - **Multi-modal 8→9 (+1pt)**. DoD: 音声取り込み + 検索 + テスト 6件

- [ ] `cc:TODO [feature:security]` **V5-009**: Ollama ファーストクラス対応
  - **Privacy 9→10 (+1pt)**. DoD: API キーなしで全LLM機能動作 + テスト 6件

- [ ] `cc:TODO` **V5-010**: Rate Limiting + バリデーション強化
  - Security 堅守. Token Bucket + 文字長上限 + tableAlias ホワイトリスト
  - DoD: Rate Limiter + バリデーション + テスト 8件

---

### §29 完了判定

| Phase | 期待 Δ | 累計 |
|-------|:------:|:----:|
| Phase 1 | +5 | **124/140** |
| Phase 2 | +2 | **126/140** |
| Phase 3 | +2 | **128/140** |

**目標**: 119 + 9 = **128/140 (91.4%)** — 2位に9pt以上の差

```
Phase 1 (4並列):
  V5-001 Graph ──┐
  V5-002 Reranker ├→ Phase 2 (3並列):
  V5-003 Platform ┤   V5-005 Connectors ─┐
  V5-004 MemModel ┘   V5-006 Analytics ───├→ Phase 3:
                       V5-007 Benchmark ───┘   V5-008〜010
```
