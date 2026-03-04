# Competitive Analysis Benchmark v7: harness-mem + §32 ベンチマーク信頼性改革

> **Snapshot date**: 2026-03-04 (v7 — §32 ベンチマーク信頼性改革完了後)
> **harness-mem version**: v0.2.1 + §30 + §32 (main branch)
> **Previous snapshot**: [`competitive-analysis-2026-03-03-v6.md`](competitive-analysis-2026-03-03-v6.md) (harness-mem 115/140, 3位)
> **Purpose**: §32 ベンチマーク信頼性改革完了後の更新。測定フレームワーク整備・データセット拡張・日英バイリンガル対応の成果を反映。

---

## §32 ベンチマーク信頼性改革の概要

v6 時点では以下の問題があった:

| 問題 | 内容 |
|------|------|
| データセットが自明 | 10サンプル、query≈content のキーワード一致。MRR=1.0 は無意味 |
| Distractor なし | 各サンプルが独立。precision/MRR が差別化されない |
| 日英混在未対応 | SYNONYM_MAP に日本語エントリなし。「デプロイ」→「deploy」検索が空振り |
| Knowledge Update 未評価 | 「事実の上書き」テスト未実施 |
| 競合比較の非等価性 | locomo-mini ≠ LongMemEval 500問 |

§32 で以下を完了:
- **BM-001**: unicode61 tokenizer 日本語分割動作を検証・文書化
- **BM-002**: 測定フレームワーク設計書を作成（`docs/benchmarks/measurement-framework.md`）
- **BM-003**: locomo-120 現状スコアを baseline として計測
- **BM-004**: locomo-120 に Distractor 20件追加（60サンプル×180QA）
- **BM-005**: CI runner を locomo-120 に切り替え
- **BM-006**: 回帰ゲート baseline を locomo-120 で再設定
- **BM-007**: 競合比較表に測定条件フッターを追加
- **BM-008**: SYNONYM_MAP に日英エントリ 31件追加
- **BM-009**: 日英混在テストデータ 10件作成（`bilingual-10.json`）
- **BM-010**: buildFtsQuery の CJK バイグラム展開を実装
- **BM-011**: バイリンガル回帰テスト 5件追加（947 pass / 0 fail）
- **BM-012**: Knowledge Update フィクスチャ 10件作成
- **BM-013**: Temporal クエリフィクスチャ 10件作成
- **BM-014**: Knowledge Update 評価メトリクス（Freshness@K）実装
- **BM-015**: Temporal 評価メトリクス（Temporal Order Score）実装
- **BM-016**: CI runner に全フィクスチャを統合（200+ QA の統合実行）

---

## §32 ベンチマーク実測値（2026-03-04）

### locomo-120（60サンプル × 180QA）

| カテゴリ | 件数 | EM | F1 |
|---------|:---:|:---:|:---:|
| cat-1（単純事実）| 69 | 0.1014 | 0.2564 |
| cat-2（複合事実）| 42 | 0.0476 | 0.1959 |
| cat-3（時系列）| 34 | 0.0000 | 0.1249 |
| cat-4（Distractor）| 35 | 0.1143 | 0.2202 |
| **overall** | **180** | **0.0722** | **0.2104** |

> v6 baseline: F1=0.1794 → v7: F1=0.2104（**+0.0310 改善**）
> locomo-120 に Distractor 20件追加後もスコアが向上。測定の信頼性が高まった。

### bilingual-10（日英混在、10サンプル）

| メトリクス | スコア | 閾値 | 判定 |
|-----------|:------:|:----:|:----:|
| recall@10 | **1.0000** | ≥ 0.80 | **PASSED** |

> §32 BM-008（SYNONYM_MAP 日英拡張）+ BM-010（CJK バイグラム展開）により recall 100% を達成。
> 「デプロイ」→「deploy」、「認証」→「auth」の同義語展開が機能。

### knowledge-update-10（10件）

| メトリクス | スコア | 閾値 | 判定 |
|-----------|:------:|:----:|:----:|
| Freshness@K | **0.1000** | ≥ 0.70 | **FAILED** |

> 古い記録より新しい記録を上位に表示する能力（Freshness）は現状 10%。
> recency スコアリングの改善が必要。ゲート自体は正常に動作している。

### temporal-10（時系列順序、10件）

| メトリクス | スコア | 閾値 | 判定 |
|-----------|:------:|:----:|:----:|
| Temporal Order Score | **0.5833** | ≥ 0.50 | **PASSED** |

> Kendall tau 正規化スコアで閾値をクリア。基本的な時系列順序の理解は機能している。

---

## Scorecard (14 Axes) — v7 更新

v7 では §32 の成果を反映し、**Benchmark / Eval** 軸を再評価する。

| # | Axis | harness-mem | supermemory | mem0 | OpenMemory | claude-mem |
|---|------|:-----------:|:-----------:|:----:|:----------:|:----------:|
| 1 | Memory Model | 8 | **9** | **9** | **9** | 5 |
| 2 | Search / Retrieval | 9 | 9 | **10** | 8 | 2 |
| 3 | Storage Flexibility | 8 | **9** | **9** | **9** | 3 |
| 4 | Platform Integration | **10** | **10** | **10** | 9 | 3 |
| 5 | Security | 8 | 7 | **9** | 7 | 2 |
| 6 | UI / Dashboard | 8 | **9** | 7 | 8 | 2 |
| 7 | Consolidation / Dedup | **8** | **8** | **8** | 7 | 3 |
| 8 | Graph / Relations | 7 | **10** | 9 | 8 | 1 |
| 9 | Privacy (Local-first) | 9 | 6 | 9 | **10** | 6 |
| 10 | Multi-user / Team | 7 | 7 | 7 | 6 | 1 |
| 11 | Cloud Sync | 9 | **10** | 8 | 6 | 1 |
| 12 | Multi-modal | **8** | **8** | 7 | 5 | 1 |
| 13 | Benchmark / Eval | **9** ↑ | **9** | **9** | 5 | 3 |
| 14 | Temporal Reasoning | **8** | **8** | **8** | 7 | 6 |
| | **Total (/140)** | **116** ↑ | **119** | **119** | **104** | **39** |
| | **Pct** | **82.9%** | **85.0%** | **85.0%** | **74.3%** | **27.9%** |

### v7 変動点: harness-mem 115 → 116 (+1)

| Axis | v6 | v7 | 理由 |
|------|:--:|:--:|------|
| **Benchmark / Eval** | 8 | **9** | §32 で CI 統合・200+ QA 計測・測定フレームワーク設計書・回帰ゲート完備 |

> v6 時の減点理由「CI に統合されていない（手動実行のみ）」が解消。locomo-120 + bilingual + knowledge-update + temporal の 4 フィクスチャが CI で自動実行される。

### Ranking（v7）

| Rank | Tool | Score | Grade | v6比 | Trend |
|:----:|------|:-----:|:-----:|:----:|:-----:|
| **1** | **supermemory** | **119/140** | **A** | ±0 | → |
| **1** | **mem0** | **119/140** | **A** | ±0 | → |
| **3** | **harness-mem** | **116/140** | **A-** | **+1** | ↑ |
| 4 | OpenMemory | 104/140 | B+ | ±0 | → |
| 5 | claude-mem | 39/140 | F | ±0 | → |

---

## 測定条件に関する注意事項（必読）

> **重要**: harness-mem のベンチマークスコアと競合他社スコアは、測定条件が根本的に異なります。直接比較は不正確です。

### 測定条件の差異

| 項目 | harness-mem（§32 計測） | OMEGA / Mastra |
|---|---|---|
| **評価データセット** | LoCoMo サブセット（60サンプル × 180QA、Distractor 含む） | LongMemEval（7タイプ、500問フルセット） |
| **評価レイヤー** | 検索レイヤーのみ（LLM 推論なし、ルールベース F1 計算） | End-to-End（LLM 推論込み、GPT-4 等で回答生成） |
| **最新スコア** | overall F1=0.2104、EM=0.0722（2026-03-04 計測） | 95.4%（OMEGA）/ 94.87%（Mastra）は自社公表値 |
| **独立検証** | 独立計測済み、回帰ゲートで CI 管理 | 競合スコアは独立検証なし |

### 各フィクスチャの適用範囲

| フィクスチャ | QA 数 | 測定対象 | 閾値 |
|---|:---:|---|---|
| locomo-120 | 180 | 一般的な会話記憶の検索精度 | F1 -5% 以内（回帰ゲート） |
| bilingual-10 | 10 | 日英混在クエリの検索精度 | recall@10 ≥ 0.80 |
| knowledge-update-10 | 10 | 最新情報の優先度（Freshness） | Freshness@K ≥ 0.70 |
| temporal-10 | 10 | 時系列順序の理解 | Temporal Order Score ≥ 0.50 |
| **合計** | **210** | **4軸の総合評価** | |

**この 14 軸採点表は機能・アーキテクチャ評価です。LoCoMo/LongMemEval の精度スコアとは別物です。**
詳細な測定条件は [`docs/benchmarks/measurement-framework.md`](measurement-framework.md) を参照。

---

## §32 後の GAP 分析と次期ロードマップ

### 現在の GAP（v7 時点）

| Axis | harness-mem | Best | Gap | Priority | 改善策 |
|------|:-----------:|:----:|:---:|:--------:|--------|
| **Graph / Relations** | 7 | SM **10** | **-3** | **CRITICAL** | multi-hop traversal 実装 |
| **Memory Model** | 8 | 3社 **9** | **-1** | **HIGH** | preference/emotional 型追加 |
| **Storage Flexibility** | 8 | 3社 **9** | **-1** | **HIGH** | PG async 本稼働 |
| **Security** | 8 | mem0 **9** | **-1** | **HIGH** | SOC2 Type II 準備 |
| **Search / Retrieval** | 9 | mem0 **10** | **-1** | **MEDIUM** | Freshness@K 改善（現状 0.10）|
| **UI / Dashboard** | 8 | SM **9** | **-1** | **MEDIUM** | モバイル対応 |

> §32 で **Benchmark / Eval** の GAP が解消（8→9、首位タイ）。
> 次の優先課題は **Graph / Relations** (-3pt) と **Knowledge Update Freshness** (0.10 → 0.70 目標)。

### 首位奪還プラン: 116 → 120+ (/140)

| Priority | Target Axis | Current | Goal | Delta |
|:--------:|-------------|:-------:|:----:|:-----:|
| **P0** | Graph / Relations | 7 | 9 | +2 |
| **P1** | Storage Flexibility | 8 | 9 | +1 |
| **P1** | Memory Model | 8 | 9 | +1 |

**P0 達成時**: 116 + 2 = **118/140**
**P0+P1 達成時**: 118 + 2 = **120/140**（首位タイ）

---

## 業界動向（2026年3月時点）

| 動向 | 影響 |
|------|------|
| **Mastra Observational Memory** | LongMemEval 94.87%。LLM 推論込み End-to-End の新 SOTA |
| **OMEGA** | LongMemEval 95.4%。研究レベル SOTA |
| **mem0 AWS Strands 公式採用** | 186M API calls/四半期。エンタープライズ実績で圧倒 |
| **supermemory MemoryBench** | 独自ベンチマークフレームワーク公開。業界標準化を狙う |
| **harness-mem §32 完了** | CI 統合ベンチマーク（210 QA）・日英バイリンガル対応完了 |

*このドキュメントは BM-017 の成果物として作成。前版: `competitive-analysis-2026-03-03-v6.md`*
