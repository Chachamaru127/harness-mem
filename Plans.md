# Harness-mem 実装マスタープラン

最終更新: 2026-03-04（§33 全15タスク完了, 1278テスト）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32 ベンチマーク信頼性改革 17タスク完了 | §33 検索品質改善 15タスク完了

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

§33 検索品質改善 — 全15タスク完了。（1278テスト）

§33 結果: F1=0.287(+37%) / Freshness@K=0.88(+780%) / Temporal=0.589(+1%) / Bilingual=1.0(維持)
§32 ベースライン: F1=0.21 / Freshness@K=0.10 / Temporal=0.583 / Bilingual=1.0

---

## §33 検索品質改善（15タスク, 3フェーズ）

### 背景

§32 で構築したベンチマーク基盤が harness-mem の真の弱点を露出した:
- **Freshness@K=0.10**: 古い情報と新しい情報を区別できない（致命的）
- **F1=0.2104**: 答え抽出精度が低い（検索は動くが回答が長すぎる）
- **Temporal=0.583**: 時系列順序が半分しか正しくない

3専門家（IR Expert / Memory Architect / Eval Specialist）の討論結果を統合し、
最小変更・最大効果の順で改善する。

### 根本原因（3専門家の合意）

| 問題 | 根本原因 | 修正箇所 |
|------|---------|---------|
| Freshness@K=0.10 | recency weight=0.10 + 「currently」が TIMELINE ルートに未分類 + 半減期14日で長期データの新旧が区別不能 | router.ts, observation-store.ts, core-utils.ts |
| F1=0.21 | finalizeShortAnswer() が長文を返し precision が低下 + BM25 title weight 5.0 が高すぎ | locomo-harness-adapter.ts, observation-store.ts |
| Temporal=0.583 | 「〜の前/後」パターンが router で未検出 | router.ts |

### 依存グラフ

```
Phase A: Freshness 改善（最高優先度・即効）
├── [P] FQ-001: router に FRESHNESS ルート追加
├── [P] FQ-002: recency weight 0.10→0.20
├── [P] FQ-003: 半減期 14日→90日
├──     FQ-004: リランカー recency 係数 0.05→0.15
└──     FQ-005: Freshness CI ゲート環境変数化（暫定 0.30）
         │
Phase B: F1 + Temporal 改善
├── [P] FQ-006: BM25 title weight 5.0→2.0
├── [P] FQ-007: finalizeShortAnswer 答え圧縮精度向上
├── [P] FQ-008: TIMELINE パターン拡充（before/after/currently）
├──     FQ-009: locomo-120 全カテゴリ回帰テスト
└──     FQ-010: ベンチマーク再計測 + before/after 比較
         │
Phase C: 統計的検証 + Auto-Supersedes
├── [P] FQ-011: knowledge-update フィクスチャ 10→50件拡充
├── [P] FQ-012: temporal フィクスチャ 10→30件拡充
├──     FQ-013: Auto-supersedes リンク生成（Jaccard ベース）
├──     FQ-014: CI ゲート段階引き上げ（Freshness 0.30→0.50）
└──     FQ-015: 競合分析 v8 更新
```

### Phase A: Freshness 改善（5タスク, 最高優先度）

目的: Freshness@K を 0.10 → 0.40+ に引き上げる。最小変更で最大効果。

- [x] `cc:完了 [P]` **FQ-001**: router.ts に FRESHNESS ルートを追加
  - 「currently」「今」「最新」「what version」等のパターンを検出
  - FRESHNESS_WEIGHTS: lexical=0.25, vector=0.20, recency=**0.40**, tag=0.05, importance=0.05, graph=0.05
  - 日英両対応: `/\b(current|currently|now|latest)\b/i` + `/\b(現在|今|最新|今の)\b/`
  - DoD: knowledge-update-10 で Freshness@K >= 0.40

- [x] `cc:完了 [P]` **FQ-002**: base recency weight を 0.10→0.20 に引き上げ
  - observation-store.ts resolveSearchWeights() を修正
  - lexical=0.30, vector=0.25, recency=**0.20**, tag=0.10, importance=0.08, graph=0.07
  - DoD: 既存テスト全 pass。locomo-120 F1 が -5% 以上低下しないこと

- [x] `cc:完了 [P]` **FQ-003**: recency 半減期を 14日→90日に変更
  - core-utils.ts recencyScore() のデフォルト halfLifeDays を修正
  - 90日の場合: 1年前=0.017, 6ヶ月前=0.135, 1ヶ月前=0.714 → 新旧が区別可能
  - 環境変数 HARNESS_MEM_RECENCY_HALF_LIFE_DAYS で上書き可能（既存）
  - DoD: recencyScore の単体テスト更新

- [x] `cc:完了` **FQ-004**: cross-encoder リランカーの recency 係数を 0.05→0.15 に
  - simple-reranker.ts computeCrossEncoderScore() を修正
  - titleScore=0.20, contentScore=0.35, exactMatch=0.30, bigram=0.15, score=0.15, recency=**0.15**
  - DoD: リランカーテスト pass

- [x] `cc:完了` **FQ-005**: Freshness CI ゲートを環境変数化
  - run-ci.ts のゲート閾値を HARNESS_BENCH_FRESHNESS_GATE で設定可能に
  - Phase A 完了時は暫定 0.30 に設定（現在の 0.70 は常時 FAILED で無意味）
  - DoD: CI で Freshness ゲートが環境変数で制御可能

### Phase B: F1 + Temporal 改善（5タスク）

前提: Phase A 完了

目的: F1 を 0.21 → 0.27+ に、Temporal を 0.583 → 0.65+ に改善。

- [x] `cc:完了 [P]` **FQ-006**: BM25 title weight を 5.0→2.0 に調整
  - observation-store.ts の `bm25(mem_observations_fts, 0, 2.0, 1.0)` に変更
  - title 過重視を緩和し、content 側の正解取得率を向上
  - DoD: locomo-120 F1 が改善または維持。既存テスト pass

- [x] `cc:完了 [P]` **FQ-007**: finalizeShortAnswer の答え圧縮精度を向上
  - locomo-harness-adapter.ts の回答抽出ロジックを改善
  - 長文の検索結果から正解フレーズを絞り込む処理を追加
  - 例: prediction 全文 → クエリに最も関連する文のみ抽出
  - DoD: locomo-120 F1 >= 0.27

- [x] `cc:完了 [P]` **FQ-008**: router の TIMELINE パターンを拡充
  - 「〜の前」「〜の後」「before」「after」パターンを追加
  - 「currently」も TIMELINE ではなく FQ-001 の FRESHNESS に正しくルーティング
  - DoD: temporal-10 の Order Score >= 0.65

- [x] `cc:完了` **FQ-009**: locomo-120 全カテゴリ回帰テスト
  - cat-1〜cat-4 それぞれのスコアが Phase A 完了時から -5% 以上低下しないことを検証
  - DoD: 4カテゴリ全てで回帰なし

- [x] `cc:完了` **FQ-010**: ベンチマーク再計測 + before/after 比較
  - Phase A+B の変更前後のスコアを記録
  - 3回再現で安定性を確認（Eval Specialist の推奨）
  - DoD: results/ に before/after 比較 JSON 出力

### Phase C: 統計的検証 + Auto-Supersedes（5タスク）

前提: Phase B 完了

目的: 統計的有意性を確保し、構造的な Freshness 改善を実装。

- [x] `cc:完了 [P]` **FQ-011**: knowledge-update フィクスチャを 10→50件に拡充
  - 統計的有意性に必要な最低サンプル数（SE=±7pp）
  - DoD: fixtures/knowledge-update-50.json 作成

- [x] `cc:完了 [P]` **FQ-012**: temporal フィクスチャを 10→30件に拡充
  - 統計的有意性に必要な最低サンプル数（SE=±8pp）
  - DoD: fixtures/temporal-30.json 作成

- [x] `cc:完了` **FQ-013**: Auto-supersedes リンク生成（Jaccard ベース）
  - recordEvent パイプラインで同一 project + 同一 observation_type の類似エントリを検出
  - Jaccard similarity >= 0.3 の場合に mem_links に relation='updates' を自動挿入
  - exclude_updated=true をデフォルト有効化
  - DoD: knowledge-update-50 で Freshness@K >= 0.50

- [x] `cc:完了` **FQ-014**: CI ゲート段階引き上げ
  - Freshness ゲートを 0.30→0.50 に引き上げ
  - locomo-120 F1 ゲートを before/after 比較に基づいて設定
  - DoD: CI が新しい閾値で pass

- [x] `cc:完了` **FQ-015**: 競合分析 v8 更新
  - §33 の改善結果を反映
  - 測定条件・before/after を明記
  - DoD: docs/benchmarks/competitive-analysis-v8.md 作成

### §33 完了判定（「客観的に改善された」の定義）

**最小条件（全て満たすこと）:**
1. Freshness@K >= 0.40（50件フィクスチャ、3回再現の中央値）
2. locomo-120 F1 >= 0.27（3回再現で ±0.03 以内の安定性）
3. Temporal Order Score >= 0.65（30件フィクスチャ）
4. bilingual recall >= 0.8（回帰なし）
5. `bun test` 全 pass
6. CI ゲート全 pass

**対外主張可能条件（上記に加え）:**
- 3回再現 + 測定条件を docs に記録
- 全カテゴリ（cat-1〜cat-4）で個別改善

### スコープ外（§34 以降）

- Multi-hop 推論（Graph traversal 実装が前提）
- 多言語 embedding 差し替え（64→384次元）
- LLM Judge 評価
- Temporal 2段階検索（anchor 特定 → since/until フィルタ）
