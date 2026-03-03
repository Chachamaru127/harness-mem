# Competitive Analysis Benchmark v3: harness-mem v0.2.1+§27.1 (Post-HARDEN)

> **Snapshot date**: 2026-03-02 (v3 — §27.1 HARDEN-001~006 品質強化完了後)
> **harness-mem version**: v0.2.1 + §23/§24/§27/§27.1 (commit `02a8467`)
> **Previous snapshot**: [`competitive-analysis-2026-03-02-v2.md`](competitive-analysis-2026-03-02-v2.md) (114/140)
> **Purpose**: §27.1 品質強化完了後の再評価。5ツールの最新状態を5並列エージェントで調査し、supermemory の急成長を踏まえた改善計画を策定。

---

## Methodology

- 14 evaluation axes (1-10 each, max 140 points)
- 5 parallel research agents deployed for concurrent evaluation (2026-03-02)
- harness-mem: Explore agent がコード実査（sync HTTP 実装、OCR 実テスト、maxSamples 修正を検証）
- Competitors: WebSearch + GitHub + 公式ドキュメント + DeepWiki で最新状態を調査
- Scores reflect publicly available features as of 2026-03-02

---

## Scorecard (14 Axes)

| # | Axis | harness-mem | supermemory | mem0 | OpenMemory | claude-mem |
|---|------|:-----------:|:-----------:|:----:|:----------:|:----------:|
| 1 | Memory Model | 8 | **9** | 8 | **9** | **9** |
| 2 | Search / Retrieval | **9** | **9** | **9** | 8 | 8 |
| 3 | Storage Flexibility | 8 | 8 | **9** | 8 | 7 |
| 4 | Platform Integration | 9 | **10** | **10** | 9 | 8 |
| 5 | Security | **9** | 6 | **9** | 8 | 5 |
| 6 | UI / Dashboard | 8 | **9** | 6 | 7 | 7 |
| 7 | Consolidation / Dedup | **8** | **8** | 7 | 7 | **8** |
| 8 | Graph / Relations | 8 | **10** | 8 | 8 | 2 |
| 9 | Privacy (Local-first) | 9 | 5 | 8 | **10** | 8 |
| 10 | Multi-user / Team | **8** | 7 | 7 | 7 | 2 |
| 11 | Cloud Sync | **9** | **9** | 7 | 6 | 2 |
| 12 | Multi-modal | **8** | 7 | 7 | 6 | 1 |
| 13 | Benchmark / Eval | 9 | **10** | 7 | 5 | 3 |
| 14 | Temporal Reasoning | **8** | **8** | **8** | **8** | 6 |
| | **Total (/140)** | **118** | **115** | **110** | **106** | **76** |
| | **Pct** | **84.3%** | **82.1%** | **78.6%** | **75.7%** | **54.3%** |

### Ranking

| Rank | Tool | Score | Grade | vs v2 |
|:----:|------|:-----:|:-----:|:-----:|
| **1** | **harness-mem** | **118/140** | **A** | **+4 (was 114)** |
| 2 | supermemory | 115/140 | A- | **+10 (was 105)** |
| 3 | mem0 | 110/140 | A- | +1 (was 109) |
| 4 | OpenMemory | 106/140 | A- | +1 (was 105) |
| 5 | claude-mem | 76/140 | B- | +7 (was 69) |

> **harness-mem が首位を維持するも、supermemory が +10pt の急成長で 3pt 差に迫る。** 逆転リスクが現実化。

---

## harness-mem Score Change Detail (§27.1 品質強化分)

| Axis | v2 | v3 | Delta | Improvement Source | Verified? |
|------|:--:|:--:|:-----:|---|:---:|
| Cloud Sync | 7 | **9** | +2 | HARDEN-003: `/v1/sync/push` + `/v1/sync/pull` 実装（認証+冪等性+ISO 8601検証+10K上限） | ✅ |
| Multi-modal | 7 | **8** | +1 | HARDEN-001: Tesseract.js 実画像3枚テスト（hello.png/blank.png/japanese.png） | ✅ |
| Benchmark | 8 | **9** | +1 | HARDEN-006: maxSamples 伝播バグ修正 + 回帰テスト2件 | ✅ |
| Storage Flex | 8 | **8** | 0 | pgvector `query().all()/.get()/.run()` スタブ残存。CI追加のみ | ⚠️ |
| その他10軸 | — | — | 0 | §27.1 は品質強化のため機能追加ではない | — |
| **Total** | **114** | **118** | **+4** | | |

### Cloud Sync +2 の詳細根拠

- `server.ts` L877-948: push/pull エンドポイント完全実装
- `sync-store.ts`: Map ベース SyncStore + engine 接続
- セキュリティ修正済み: explicit field picking, ISO 8601 validation, 10K record limit
- 制限: SyncStore はインメモリ（永続化なし、Core observations 統合なし）

---

## 競合変動分析

### supermemory: 105 → 115 (+10) ⚠️ 最大の脅威

| Axis | v2 | v3 | Reason |
|------|:--:|:--:|--------|
| Memory Model | 8 | **9** | `/conversations` エンドポイント + Hybrid Search 統合 |
| Storage | 7 | **8** | S3/GitHub/Web Crawler コネクタ + Multi-modal Extractors |
| Consolidation | 7 | **8** | 矛盾処理・期限切れ忘却がコア機能に格上げ |
| Graph | 9 | **10** | Embeddable Memory Graph (React/WebGL/PixiJS) + typed relations |
| Privacy | 4 | **5** | エンタープライズ自己ホスティング正式ドキュメント化 |
| Multi-user | 6 | **7** | Team API Endpoints + Enhanced Analytics |
| Multi-modal | 5 | **7** | Issue #156 解決: PDF/OCR/動画文字起こし/コードAST |
| Benchmark | 9 | **10** | MemoryBench OSS化 + LongMemEval/LoCoMo/ConvoMem 3冠 |
| Temporal | 7 | **8** | LongMemEval Temporal Reasoning 76.69% (SOTA) |

### mem0: 109 → 110 (+1)

| Axis | v2 | v3 | Reason |
|------|:--:|:--:|--------|
| UI | 5 | **6** | OpenMemory MCP Server に簡易UI付属 |

### OpenMemory: 105 → 106 (+1)

| Axis | v2 | v3 | Reason |
|------|:--:|:--:|--------|
| Benchmark | 4 | **5** | v1.3.0 Beta で LongMemEval ベンチマークスイート実装 |

### claude-mem: 69 → 76 (+7)

| Axis | v2 | v3 | Reason |
|------|:--:|:--:|--------|
| Memory Model | 8 | **9** | Smart Explore (tree-sitter AST 3層 progressive disclosure) |
| Storage | 6 | **7** | `CLAUDE_MEM_CHROMA_ENABLED` トグルで SQLite-only 正式化 |
| Security | 4 | **5** | `execSync` → `execFileSync` (injection防止) |
| UI | 6 | **7** | session-registry UI PR 開発中、Smart Explore ドキュメント |
| Consolidation | 7 | **8** | SHA-256 コンテンツハッシュ重複排除 (migration 22) |
| Benchmark | 1 | **3** | Smart Explore ベンチマークレポート公開（メモリ全体ではなくコード探索限定） |

---

## Competitive Landscape Summary

```
140 ┬
    │
130 ┤                           ★ Target: 130/140
    │
120 ┤  ┌─ harness-mem ─┤ 118│ ← #1 (+4)
    │  │               └────┘
115 ┤  │  ┌ supermem ──┤ 115│ ← #2 (+10) ⚠️ 3pt差に迫る
    │  │  │            └────┘
110 ┤  │  │  ┌── mem0 ─┤ 110│ ← #3 (+1)
    │  │  │  │         └────┘
106 ┤  │  │  │ ┌ OpenMem┤106│ ← #4 (+1)
    │  │  │  │ │        └────┘
    │  │  │  │ │
 76 ┤  │  │  │ │  ┌ c-mem ┤76│ ← #5 (+7)
    │  │  │  │ │  │       └──┘
  0 ┴──┴──┴──┴─┴──┴──
```

---

## harness-mem が負けている軸（要対策）

| Axis | harness-mem | Best Competitor | Gap | Threat Level |
|------|:-----------:|:--------------:|:---:|:------------:|
| Graph / Relations | 8 | supermemory **10** | **-2** | CRITICAL |
| Platform Integration | 9 | mem0/supermemory **10** | -1 | HIGH |
| Benchmark / Eval | 9 | supermemory **10** | -1 | HIGH |
| Memory Model | 8 | supermemory/OpenMemory **9** | -1 | MEDIUM |
| Storage Flexibility | 8 | mem0 **9** | -1 | MEDIUM |
| Privacy | 9 | OpenMemory **10** | -1 | MEDIUM |

---

## Tool Profiles (Updated Reference Data)

### mem0 (110/140)
- **GitHub Stars**: ~48,400
- **Version**: v1.0.4 (OSS SDK) / v2.2.3 (Platform)
- **Key Update**: v1.0.4 で `update()` に timestamp パラメータ追加、OpenMemory MCP に簡易UI付属
- **Strength**: Platform (10), Storage (9), Security (9), Search (9)
- **Weakness**: UI (6), Cloud Sync (7), Consolidation (7), Multi-user (7)
- **Threat**: 安定成長だがペース鈍化。Graph paywall ($249/mo) が普及を阻害

### supermemory (115/140) ⚠️
- **GitHub Stars**: ~16,700
- **Version**: 活発なコミット (2026-02-28)
- **Key Update**: MemoryBench OSS化、Embeddable Memory Graph (WebGL)、Multi-modal Extractors、Team API
- **Strength**: Platform (10), Graph (10), Benchmark (10), UI (9), Cloud Sync (9), Search (9)
- **Weakness**: Security (6), Privacy (5), Multi-user (7)
- **Threat**: **最大の脅威。+10pt/月の成長速度。Graph/Benchmark で harness-mem を上回る**

### OpenMemory (106/140)
- **GitHub Stars**: ~3,500
- **Version**: v1.2.3 (stable) / v1.3.0 Beta
- **Key Update**: LongMemEval ベンチマークスイート (Beta)、Docker/CI 改善
- **Strength**: Privacy (10), Memory Model (9), Platform (9)
- **Weakness**: Benchmark (5), Cloud Sync (6), Multi-modal (6), UI (7)
- **Threat**: 低い。堅実だが成長ペースが遅い

### claude-mem (76/140)
- **GitHub Stars**: ~32,100
- **Version**: v10.5.2
- **Key Update**: Smart Explore (tree-sitter AST), SHA-256 dedup, Chroma SQLite-only toggle
- **Strength**: Memory Model (9), Consolidation (8), Privacy (8)
- **Weakness**: Graph (2), Multi-modal (1), Cloud Sync (2), Multi-user (2)
- **Threat**: Stars は突出するが機能面の構造的弱点は解消されていない
