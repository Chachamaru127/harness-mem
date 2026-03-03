# Competitive Analysis Benchmark v5: harness-mem v0.2.1+§28P1+ReviewR1

> **Snapshot date**: 2026-03-03 (v5 — CQRS分解 + 4ラウンド品質レビュー完了後)
> **harness-mem version**: v0.2.1 + §27.1/§28P1/ReviewR1 (main branch, commit `26b88a1`)
> **Previous snapshot**: [`competitive-analysis-2026-03-02-v4.md`](competitive-analysis-2026-03-02-v4.md) (119/140)
> **Purpose**: CQRS分解+セキュリティ/パフォーマンスレビュー修正後の再評価。5並列リサーチエージェントで全ツールの最新状態を調査。

---

## Methodology

- 14 evaluation axes (1-10 each, max 140 points)
- 5 parallel research agents deployed concurrently (2026-03-03)
  - harness-mem: Explore agent がコード実査（CQRS分解後 + ReviewR1修正の全モジュール検証、very thorough）
  - supermemory: WebSearch + GitHub + 公式ドキュメント + MemoryBench + Unforgettable Launch Week 調査
  - mem0: WebSearch + GitHub Releases + arXiv論文 + AWS Strands + OpenMemory MCP + Reranker 調査
  - OpenMemory: WebSearch + GitHub Releases + MCP エコシステム + Chrome Extension 調査
  - claude-mem: WebSearch + GitHub Releases + Smart Explore + CVE調査 + PR 分析

---

## Scorecard (14 Axes)

| # | Axis | harness-mem | supermemory | mem0 | OpenMemory | claude-mem |
|---|------|:-----------:|:-----------:|:----:|:----------:|:----------:|
| 1 | Memory Model | 8 | **9** | **9** | **9** | **9** |
| 2 | Search / Retrieval | 9 | 9 | **10** | 8 | 8 |
| 3 | Storage Flexibility | **9** | **9** | **9** | **9** | 7 |
| 4 | Platform Integration | 9 | **10** | **10** | 9 | 8 |
| 5 | Security | **9** | 7 | **9** | 8 | 5 |
| 6 | UI / Dashboard | 8 | **9** | 7 | 8 | 7 |
| 7 | Consolidation / Dedup | **8** | **8** | **8** | 7 | **8** |
| 8 | Graph / Relations | 8 | **10** | 9 | 8 | 2 |
| 9 | Privacy (Local-first) | 9 | 6 | 9 | **10** | 8 |
| 10 | Multi-user / Team | **8** | 7 | 7 | 7 | 2 |
| 11 | Cloud Sync | 9 | **10** | 8 | 6 | 2 |
| 12 | Multi-modal | **8** | **8** | 7 | 5 | 1 |
| 13 | Benchmark / Eval | 9 | **9** | **9** | 6 | 3 |
| 14 | Temporal Reasoning | **8** | **8** | **8** | **8** | 6 |
| | **Total (/140)** | **119** | **119** | **119** | **108** | **76** |
| | **Pct** | **85.0%** | **85.0%** | **85.0%** | **77.1%** | **54.3%** |

### Ranking

| Rank | Tool | Score | Grade | v4比 | Trend |
|:----:|------|:-----:|:-----:|:----:|:-----:|
| **1** | **harness-mem** | **119/140** | **A** | ±0 | → リード消失 |
| **1** | **supermemory** | **119/140** | **A** | **+2** | ↑ 同率首位 |
| **1** | **mem0** | **119/140** | **A** | **+2** | ↑↑ 同率首位 |
| 4 | OpenMemory | 108/140 | B+ | +1 | → 安定 |
| 5 | claude-mem | 76/140 | B- | **-8** | ↓↓ 相対後退 |

> **危機的状況: harness-mem のリードが完全に消失。3社同率首位。次のスプリントで差をつけなければ逆転される。**

---

## 競合変動分析（v4→v5）

### supermemory: 117 → 119 (+2)

| Axis | v4 | v5 | Reason |
|------|:--:|:--:|--------|
| Security | 6 | **7** | SOC 2 コンプライアンス明言、エンタープライズ向けセルフホスト対応拡充 |
| Cloud Sync | 9 | **10** | GitHub/S3/Web Crawler の3コネクタ追加で計7種。リアルタイムWebhook同期 |

**脅威**: Developer Changelog は停止しているが、エコシステム（MemoryBench、MCP v4、Embeddable Graph）が自律成長中。Graph(10)は唯一の -2pt ギャップ。

### mem0: 117 → 119 (+2)

| Axis | v4 | v5 | Reason |
|------|:--:|:--:|--------|
| Memory Model | 8 | **9** | v1.0.0メジャーリリース、timestamp制御、Project Settings追加 |
| Consolidation | 7 | **8** | Conflict Detector + Update Resolver の非破壊的invalidation確立 |
| Benchmark | 8 | **9** | arXiv論文公開、Zep反論で透明性向上 |
| UI | 8 | **7** | 期待されたダッシュボードが未リリース（-1） |

**脅威**: AWS Strands 公式採用（186M API calls/四半期）、$24M Series A。Search(10)は harness-mem の最大の弱点。Reranker 5種（Cohere/ZeroEntropy/HF/ST/LLM）で検索精度が圧倒的。

### 新たな業界動向

| 動向 | 影響 |
|------|------|
| **Mastra Observational Memory** | LongMemEval 94.87% (GPT-5-mini)。supermemory 85.2% を大幅超過 |
| **OMEGA** | LongMemEval 95.4%。新たな精度 SOTA |
| **LiCoMemory** | LongMemEval 73.8%。Temporal subset で mem0g を +15.9pp 上回る |
| **TiMem** | 階層的時間記憶。LoCoMo 75.30% |
| **CVE-2025-59536/CVE-2026-21852** | Claude Code フック機構に RCE 脆弱性。claude-mem に影響 |

---

## harness-mem が負けている軸（GAP 分析）

| Axis | harness-mem | Best | Gap | Priority | 改善コスト |
|------|:-----------:|:----:|:---:|:--------:|:----------:|
| **Graph / Relations** | 8 | SM **10** | **-2** | **CRITICAL** | 大 |
| **Search / Retrieval** | 9 | mem0 **10** | **-1** | **HIGH** | 中 |
| **Platform Integration** | 9 | SM/mem0 **10** | **-1** | **HIGH** | 中 |
| **Memory Model** | 8 | 4社 **9** | **-1** | **HIGH** | 中 |
| **Cloud Sync** | 9 | SM **10** | **-1** | **MEDIUM** | 大 |
| **UI / Dashboard** | 8 | SM **9** | **-1** | **MEDIUM** | 中 |

**理論上の上限**: 119 + 7 = **126/140**（全ギャップ解消時）

---

## Competitive Landscape (v5)

```
140 ┬
    │
130 ┤                                ★ Target: 130/140
    │
119 ┤  ┌─ harness ─┬─ supermem ─┬─ mem0 ─┐ 119  ← 3社同率首位
    │  │           │            │        │
    │  │           │            │        │
108 ┤  │           │            │  ┌ OM ─┤108│ ← #4
    │  │           │            │  │     └────┘
    │  │           │            │  │
 76 ┤  │           │            │  │  ┌ c-m ┤76│ ← #5 (-8)
    │  │           │            │  │  │     └──┘
  0 ┴──┴───────────┴────────────┴──┴──┴──
         Gap: 0pt ← 危機的
         ⚠️ 3社同率首位。差別化が急務
```
