# §34 完了レポート: 測定信頼性 + Temporal 構造改善

> **完了日**: 2026-03-05
> **テスト数**: 1355 tests across 173 files（全 pass）
> **フェーズ**: Phase 0（測定修正）+ Phase A（Temporal 改善）+ Phase B（統計基盤）+ Phase C（実データ検証）

---

## エグゼクティブサマリー

§34 の主眼は「壊れた物差しを直す」ことだった。
§33 で報告した指標（Freshness=0.88、Temporal=0.617、Bilingual=1.0）は
いずれも測定上の欠陥を含んでいた。§34 ではその欠陥を修正した上で
**正直な評価フレームを構築**した。

### 「測定できるようになったこと」（Phase 0-B の主成果）

| 能力 | §33 まで | §34 以降 |
|------|---------|---------|
| Freshness バイアス検出 | 検出不可（train=test） | 5-fold CV で除去済み |
| temporal fixture 難易度 | 全件 Easy（昇順で自明）| Easy/Medium/Hard 分布あり |
| 多重比較補正 | なし | Holm-Bonferroni 4指標同時検定 |
| Bootstrap 95% CI | なし | 全指標で報告 |
| 3層 CI ゲート | なし | 絶対下限/相対回帰/Wilcoxon 実装 |

### 「改善したこと」（統計的に有意なもののみ）

| 指標 | §33 | §34 | Holm補正後 |
|------|:---:|:---:|:----------:|
| Freshness@K | 0.88 [biased] | 1.00 [CV後] | **有意** |
| locomo F1 | 0.212 | 0.287 | 非有意（p=0.026 > 0.017） |
| Temporal | 0.617 [temporal-30] | 0.572 [temporal-100] | 比較不可 |
| Bilingual | 1.0 [N=10] | 1.0 [N=50] | 比較不可 |

---

## Phase 別成果

### Phase 0: 測定の修正（FD-001〜004）

**FD-001: temporal フィクスチャ再設計**
- temporal-50.json 作成（逆順15件 + 同日5件）
- DoD「ASC-only score < 0.7」達成（理論値 0.68）

**FD-002: Freshness Jaccard 閾値の 5-fold CV**
- 最適閾値: 0.1（CV後 avg_freshness = 1.0）
- train=test バイアスを交差検証で除去

**FD-003: bilingual フィクスチャ 10→30→50件**
- Hard cases（クロスドメイン干渉）追加
- Wilson CI 下限 = 0.929

**FD-004: Weighted Kendall tau + nDCG@5**
- runner.ts に2指標追加
- §34 current: tau=0.572, nDCG@5=0.581

### Phase A: Temporal 2-Stage Retrieval（FD-005〜008）

**FD-005: TemporalAnchor 抽出器**
- "after X"→{type, ref, direction} の抽出
- 日英20件のアンカー抽出テスト全 pass

**FD-006: Anchor-Pivoted Search**
- observation-store.ts にアンカー基点検索を実装
- temporal-50 での Weighted Kendall tau = 0.572（目標 0.70 に未到達）

**FD-007: temporal-100 フィクスチャ**
- 4ドメイン（dev-workflow/project-mgmt/personal/bilingual）×25件
- 35 Hard cases、ASC-only score = 0.65 < 0.7 ✓

**FD-008: Temporal 再計測 + before/after**
- 3回再現実行で完全安定（variance = 0）
- §33(temporal-30): 0.617 → §34(temporal-100): 0.572
- スコア低下は**fixture 難化による意図的な変化**

### Phase B: 統計基盤（FD-009〜013）

**FD-009: knowledge-update 50→100件**
- Easy 30 / Medium 50 / Hard 20 の分布
- 全必須フィールド存在確認済み

**FD-011: Bootstrap CI + Holm-Bonferroni**
- runner.ts に bootstrapCI(10k) 実装
- 全ベンチマークで 95% CI 報告

**FD-012: 3層 CI ゲート**
- Layer 1 絶対下限、Layer 2 相対回帰 2SE、Layer 3 Wilcoxon
- ci-score-history.json に最大30件の履歴蓄積

**FD-013: 統計レポート**
- results/fd-013-statistical-report.json に Holm-Bonferroni 補正済み結果

### Phase C: 実データ検証基盤（FD-014〜019）

**FD-014: クエリログ収集**
- HARNESS_MEM_QUERY_LOG 環境変数で JSONL ログ有効化
- プライバシー: クエリ全文は記録しない（カテゴリ・長さのみ）

**FD-015: dev-workflow-20 フィクスチャ**
- 実際の Claude Code 使用シナリオ 20件
- Easy/Medium/Hard 混在、recall@10 評価対応

**FD-016: Self-eval クエリ生成器**
- self-eval-generator.ts: 実 DB から 50件の temporal クエリ自動生成
- 6テンプレート（first-task/latest-task/after-anchor/sequence/日英）

**FD-017: Retrospective A/B 評価フレーム**
- retrospective-eval.ts: mem_audit_log の search_hit を ground truth として活用
- v33 vs v34 の並列比較（Recall@5, @10, Delta）

**FD-018: 競合分析 v9**
- docs/benchmarks/competitive-analysis-2026-03-05-v9.md
- LLM 有無を明示的に分離（harness-mem = LLM-free カテゴリ）
- レイテンシ・コスト指標追加

**FD-019: 全指標 before/after 最終比較**
- results/fd-019-final-comparison.json（Bootstrap CI + Holm-Bonferroni）
- 正直な結論: 4指標中 1指標（freshness）のみ統計的有意

---

## §34 完了判定

### 測定信頼性（4条件: 全て達成）

| 条件 | 達成 |
|------|:----:|
| 全フィクスチャに Easy/Medium/Hard 分布あり | ✓ |
| temporal フィクスチャに逆順・同日シナリオあり | ✓ |
| 全メトリクスで Bootstrap 95% CI 報告 | ✓ |
| 4メトリクス同時検定で Holm-Bonferroni 補正済み | ✓ |

### 性能目標（5条件: 3条件達成）

| 条件 | 目標 | 達成値 | 達成 |
|------|:----:|:------:|:----:|
| Temporal Weighted Kendall tau (CI下限) | >= 0.70 | 0.572 | **未達** |
| locomo-120 F1 (CI下限) | >= 0.27 | 0.221 | **未達** |
| Freshness@K (5-fold CV後) | >= 0.70 | 1.000 | ✓ |
| bilingual recall (Wilson CI下限) | >= 0.85 | 0.929 | ✓ |
| bun test 全 pass + 3層 CI ゲート | — | 1355 tests ✓ | ✓ |

### 実データ基盤（1条件: 達成）

| 条件 | 達成 |
|------|:----:|
| クエリログ収集が動作し dev-workflow-20 で評価可能 | ✓ |

**総合判定**: §34 の「測定信頼性」部分は完了。
性能目標の temporal tau >= 0.70 と F1 CI下限 >= 0.27 は未達であり §35 継続課題。

---

## §35 への提言

### 優先度 High

**1. Temporal Anchor-Pivoted Search のチューニング**
- FD-006 で実装済みだが tau=0.572（目標 0.70 に未到達）
- アンカー抽出精度の向上（`extractTemporalAnchors` の日本語対応強化）
- temporal-100 の by-domain 結果を参考にドメイン別調整
- bilingual ドメインが特に低い（tau=0.478）→ 日英クロス検索改善

**2. locomo F1 の統計的有意な改善**
- 現状: p=0.026（Holm 補正後非有意）
- SE=±3.4pp（N=180 QA）→ 有意化には delta > 6.7pp が必要
- LoCoMo 200サンプルへの拡充でSEを ±2.4pp 程度に縮小

### 優先度 Medium

**3. Multi-hop 推論（Graph traversal）**
- §34 スコープ外として意図的に除外
- obs-link グラフを使った2-hop クエリの実装
- 前提: graph traversal の実装基盤が必要

**4. 384次元 embedding**
- 現在 64次元（速度優先）
- 384次元への切り替えで recall 改善の可能性あり
- F1 への寄与を実測してから判断

### 優先度 Low（§36 以降）

**5. LLM Judge 評価**
- コスト高（~$50/実行）・再現性低下（モデル更新の影響）
- 実データ評価（dev-workflow、retrospective A/B）が安定してから導入

**6. Retrospective A/B の本格運用**
- FD-017 で基盤実装済み
- 十分な audit_log（search_hit）蓄積後に本格評価

---

## 生成されたファイル一覧（§34 Phase 0-C）

### フィクスチャ
- `tests/benchmarks/fixtures/temporal-50.json` (50件)
- `tests/benchmarks/fixtures/temporal-100.json` (100件, 4 domains)
- `tests/benchmarks/fixtures/bilingual-50.json` (50件)
- `tests/benchmarks/fixtures/knowledge-update-100.json` (100件)
- `tests/benchmarks/fixtures/dev-workflow-20.json` (20件)

### ベンチマーク実装
- `memory-server/src/benchmark/self-eval-generator.ts`
- `memory-server/src/benchmark/retrospective-eval.ts`

### 結果レポート
- `memory-server/src/benchmark/results/fd-008-temporal-before-after.json`
- `memory-server/src/benchmark/results/fd-013-statistical-report.json`
- `memory-server/src/benchmark/results/fd-019-final-comparison.json`

### ドキュメント
- `docs/benchmarks/competitive-analysis-2026-03-05-v9.md`
- `docs/retrospective-eval-guide.md`

### テスト
- `tests/unit/self-eval-generator.test.ts` (12件)
