# Competitive Analysis Benchmark v4: harness-mem v0.2.1+§28P1 (Post-CQRS)

> **Snapshot date**: 2026-03-02 (v4 — §28 Phase 1 CQRS 分解完了後)
> **harness-mem version**: v0.2.1 + §27.1/§27.2/§28P1 (worktree3 branch)
> **Previous snapshot**: [`competitive-analysis-2026-03-02-v3.md`](competitive-analysis-2026-03-02-v3.md) (118/140)
> **Purpose**: §28 Phase 1 CQRS分解 + 4ラウンド品質レビュー完了後の再評価。5ツールの最新状態を5並列エージェントで調査。

---

## Methodology

- 14 evaluation axes (1-10 each, max 140 points)
- 5 parallel research agents deployed concurrently (2026-03-02)
  - harness-mem: Explore agent がコード実査（CQRS分解後の全モジュール検証）
  - supermemory: WebSearch + GitHub + 公式ドキュメント + MemoryBench 調査
  - mem0: WebSearch + GitHub Releases + arXiv論文 + OpenMemory MCP 調査
  - OpenMemory: WebSearch + GitHub Releases + v1.3.0 Beta 調査
  - claude-mem: WebSearch + GitHub Releases + Smart Explore 調査
- 自己評価エージェントのワークツリー読み取りバイアスは main ブランチ検証で校正済み

---

## Scorecard (14 Axes)

| # | Axis | harness-mem | supermemory | mem0 | OpenMemory | claude-mem |
|---|------|:-----------:|:-----------:|:----:|:----------:|:----------:|
| 1 | Memory Model | 8 | **9** | 8 | **9** | **9** |
| 2 | Search / Retrieval | **9** | **9** | **10** | 8 | **9** |
| 3 | Storage Flexibility | **9** | **9** | **9** | **9** | 8 |
| 4 | Platform Integration | 9 | **10** | **10** | 9 | 9 |
| 5 | Security | **9** | 6 | **9** | 7 | 7 |
| 6 | UI / Dashboard | 8 | **9** | 8 | 8 | 8 |
| 7 | Consolidation / Dedup | **8** | **8** | 7 | 7 | **8** |
| 8 | Graph / Relations | 8 | **10** | **9** | 8 | 2 |
| 9 | Privacy (Local-first) | 9 | 6 | 9 | **10** | 8 |
| 10 | Multi-user / Team | **8** | 7 | 7 | 7 | 2 |
| 11 | Cloud Sync | **9** | **9** | 8 | 6 | 2 |
| 12 | Multi-modal | **8** | **8** | 7 | 5 | 1 |
| 13 | Benchmark / Eval | 9 | **9** | 8 | 6 | 5 |
| 14 | Temporal Reasoning | **8** | **8** | **8** | **8** | 6 |
| | **Total (/140)** | **119** | **117** | **117** | **107** | **84** |
| | **Pct** | **85.0%** | **83.6%** | **83.6%** | **76.4%** | **60.0%** |

### Ranking

| Rank | Tool | Score | Grade | vs v3 | Trend |
|:----:|------|:-----:|:-----:|:-----:|:-----:|
| **1** | **harness-mem** | **119/140** | **A** | **+1** | → 安定 |
| 2 | supermemory | 117/140 | A- | +2 | ↑ 成長鈍化 |
| 2 | mem0 | 117/140 | A- | **+7** | ↑↑ 急追 |
| 4 | OpenMemory | 107/140 | B+ | +1 | → 安定 |
| 5 | claude-mem | 84/140 | B | **+8** | ↑↑ 急成長 |

> **harness-mem は首位を維持するも、リードは2ptに縮小。mem0 が +7pt の急追で supermemory と同率2位に。**

---

## harness-mem Score Change Detail (v3→v4)

| Axis | v3 | v4 | Delta | Source |
|------|:--:|:--:|:-----:|--------|
| Storage Flexibility | 8 | **9** | +1 | AsyncStorageAdapter 正式公開、PostgresStorageAdapter async API、TS SDK 12エンドポイント |
| **他13軸** | — | — | 0 | §28P1 は内部品質改善（CQRS分解）のため外部機能スコア不変 |
| **Total** | **118** | **119** | **+1** | |

### CQRS 分解の間接的価値（スコア化されない）

| 価値 | 詳細 |
|------|------|
| **開発速度の加速** | 6,651行モノリス → 1,679行ファサード + 6ドメインサービス。新機能追加のリスク・コスト大幅低減 |
| **テスト保護** | 297テスト全通過。4ラウンドの Security/Performance/Quality レビューで全A達成 |
| **Phase 2以降の基盤** | Repository パターン、Ingester プラグインシステム、CLI TypeScript 化への道が開通 |

---

## 競合変動分析（v3→v4）

### mem0: 110 → 117 (+7) ⚠️ 最大の脅威に急浮上

| Axis | v3 | v4 | Reason |
|------|:--:|:--:|--------|
| Search | 9 | **10** | Reranker 追加（Cohere/ZeroEntropy/HF/Sentence Transformers）でハイブリッド検索を強化 |
| UI | 6 | **8** | OpenMemory MCP ダッシュボード大幅強化（bulk操作/app別アクセス制御/監査ログ） |
| Graph | 8 | **9** | Mem0g で edge invalidation による時間的推論を正式実装 |
| Privacy | 8 | **9** | OpenMemory MCP がローカル完結（Docker+PG+Qdrant、外部送信ゼロ） |
| Cloud Sync | 7 | **8** | インフラ成熟（186M API calls/四半期）、read replica routing |
| Benchmark | 7 | **8** | LOCOMO arXiv 論文公開（ただし再現性に疑義あり） |
| Temporal | 8 | **8** | Mem0g invalidation は前回評価済み（Delta修正） |

**脅威評価**: $24M Series A、AWS Strands 独占採用、186M API calls/四半期。エンタープライズ市場でのポジションが急速に固まりつつある。

### supermemory: 115 → 117 (+2) 成長鈍化

| Axis | v3 | v4 | Reason |
|------|:--:|:--:|--------|
| Storage | 8 | **9** | Google Drive/Notion/OneDrive 含む6種コネクタ正式化 |
| Privacy | 5 | **6** | 自己ホストガイド整備（Docker+PG+Redis） |
| Multi-modal | 7 | **8** | code-chunk（AST対応コードチャンキング、recall +28pt）正式リリース |
| Benchmark | 10 | **9** | Mastra 84.23% が LongMemEval #1 を奪取。supermemory は 81.6% で2位に後退 |

**脅威評価**: 2026年2月以降の実質的新機能ゼロ（Developer Changelog は 2025-12-30 で停止）。開発ペースの鈍化が顕著。

### claude-mem: 76 → 84 (+8) 急成長

| Axis | v3 | v4 | Reason |
|------|:--:|:--:|--------|
| Search | 8 | **9** | Smart Explore 3段ツール（smart_search/outline/unfold）正式リリース |
| Storage | 7 | **8** | Chroma MCP 接続方式に移行、SQLite/Chroma ハイブリッド切替 |
| Platform | 8 | **9** | OpenClaw 対応、Copilot/OpenCode PR レビュー中 |
| Security | 5 | **7** | execFileSync/CORS/XSS対策/認証分離を1リリースサイクルで実施 |
| UI | 7 | **8** | session-registry UI (PR中)、Web Viewer 改善 |
| Benchmark | 3 | **5** | Smart Explore ベンチマーク正式公開（11-18x トークン削減実測） |

**脅威評価**: 32kスターの巨大コミュニティ。Graph/Multi-user/Cloud Sync/Multi-modal の構造的弱点は未解消。

---

## harness-mem が負けている軸（要対策）

| Axis | harness-mem | Best Competitor | Gap | Priority |
|------|:-----------:|:--------------:|:---:|:--------:|
| **Graph / Relations** | 8 | supermemory **10** | **-2** | **CRITICAL** |
| **Search / Retrieval** | 9 | mem0 **10** | **-1** | HIGH |
| **Platform Integration** | 9 | mem0/SM **10** | **-1** | HIGH |
| **Memory Model** | 8 | SM/OM/CM **9** | **-1** | MEDIUM |
| **Benchmark / Eval** | 9 | SM **9** (was 10) | 0 | WATCH |
| **Privacy** | 9 | OpenMemory **10** | **-1** | LOW |

---

## 新たな脅威: 業界全体の動向

| 動向 | 影響 |
|------|------|
| **Mastra Observational Memory** | LongMemEval 84.23% で SOTA。新たなベンチマーク競合が出現 |
| **EmergenceMem** | 82.40% で supermemory を上回る。ベンチマーク競争が激化 |
| **AWS Strands SDK** | mem0 を独占メモリプロバイダーに採用。クラウド市場での地位固定化 |
| **MCP 標準化** | メモリサーバーの MCP 対応が業界標準に。未対応は脱落リスク |
| **code-chunk / Smart Explore** | コード構造理解（AST）がメモリツールの差別化軸として浮上 |

---

## Competitive Landscape (v4)

```
140 ┬
    │
130 ┤                                ★ Target: 130/140
    │
119 ┤  ┌── harness-mem ──┤119│ ← #1 (+1)
    │  │                 └────┘
117 ┤  │  ┌─ supermem ───┤117│ ← #2 (+2)
    │  │  │  ┌── mem0 ───┤117│ ← #2 (+7) ⚠️
    │  │  │  │           └────┘
107 ┤  │  │  │  ┌ OpenMem ┤107│ ← #4 (+1)
    │  │  │  │  │         └────┘
    │  │  │  │  │
 84 ┤  │  │  │  │  ┌ c-mem ─┤84│ ← #5 (+8)
    │  │  │  │  │  │        └──┘
  0 ┴──┴──┴──┴──┴──┴──
         Gap: 2pt (was 3pt)
         ⚠️ mem0 が +7pt で急追中
```
