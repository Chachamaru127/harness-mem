# Harness-mem 実装マスタープラン

最終更新: 2026-03-05（§34 全20タスク完了, 1355テスト）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32 17タスク完了 | §33 15タスク完了（F1:0.21→0.287, Freshness:0.10→0.88, Temporal:0.583→0.589）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

§34 測定信頼性 + Temporal 構造改善 — **全20タスク完了**。（1355テスト）

§34 結果:
- 測定信頼性4条件: 全達成（難易度分布/逆順・同日/Bootstrap CI/Holm-Bonferroni）
- 性能目標5条件中3条件達成（temporal tau < 0.70, F1 CI下限 < 0.27 は§35継続課題）
- 実データ基盤: クエリログ収集 + dev-workflow-20 + self-eval + retrospective A/B

---

## §34 測定信頼性 + Temporal 構造改善（20タスク, 4フェーズ）

### 背景

§33 で検索品質を改善したが、3専門家（IR研究者/プロダクトエンジニア/評価専門家）の
討論で「測定自体が壊れている」ことが判明:
- temporal-30 が**全件昇順タイムスタンプ**で難易度ゼロ
- Freshness@K=0.88 は Jaccard 閾値を同一データで tuning（train=test 問題）
- bilingual-10 は全件が完全セマンティック対応で自明に recall=1.0

**方針**: 壊れた物差しを先に直す → 構造を直す → 実データで検証（Goodhart's Law 回避）

### 依存グラフ

```
Phase 0: 測定の修正（最優先・他の全てに先行）
├── [P] FD-001: temporal フィクスチャ再設計（逆順+同日シナリオ追加）
├── [P] FD-002: Freshness Jaccard 閾値の交差検証
├── [P] FD-003: bilingual フィクスチャ難易度追加
└──     FD-004: Weighted Kendall tau + nDCG@5 導入
         │
Phase A: Temporal 2-Stage Retrieval（構造改善）
├── [P] FD-005: TemporalAnchor 抽出器（router.ts）
├── [P] FD-006: Anchor-Pivoted Search（observation-store.ts）
├──     FD-007: temporal-100 フィクスチャ（多ドメイン）
└──     FD-008: Temporal 再計測 + before/after
         │
Phase B: 統計基盤（サンプル拡充 + CI 改善）
├── [P] FD-009: knowledge-update 50→100 件拡充（難易度分布付き）
├── [P] FD-010: bilingual 10→50 件拡充（干渉パターン付き）
├── [P] FD-011: Bootstrap CI + Holm-Bonferroni 多重比較
├──     FD-012: 3層 CI ゲート（絶対下限 + 相対回帰 + Wilcoxon 改善検証）
└──     FD-013: 全ベンチマーク再計測 + 統計レポート
         │
Phase C: 実データ検証基盤
├── [P] FD-014: クエリログ収集（routeQuery → local file）
├── [P] FD-015: dev-workflow-20 フィクスチャ（実使用パターン準拠）
├──     FD-016: Self-eval クエリ生成器（実 DB から temporal クエリ自動生成）
├──     FD-017: Retrospective A/B 評価フレーム
├──     FD-018: 競合分析 v9（正直な報告 + LLM有無分離）
├──     FD-019: 全指標 before/after 最終比較
└──     FD-020: §34 完了レポート
```

### Phase 0: 測定の修正（4タスク） — 全完了

- [x] `cc:完了` **FD-001**: temporal-50.json（逆順16+同日9, ASCのみ=0.68）
- [x] `cc:完了` **FD-002**: Jaccard 5-fold CV（最適閾値0.1）
- [x] `cc:完了` **FD-003**: bilingual-30.json（E10/M10/H10, 干渉パターン含む）
- [x] `cc:完了` **FD-004**: Weighted Kendall tau + nDCG@5（runner.ts に3指標並行報告）

### Phase A: Temporal 2-Stage Retrieval（4タスク） — 全完了

- [x] `cc:完了` **FD-005**: extractTemporalAnchors()（24テスト pass, 日英両対応）
- [x] `cc:完了` **FD-006**: temporalAnchorSearch()（anchor-pivoted 時間順ソート）
- [x] `cc:完了` **FD-007**: temporal-100.json（4ドメイン×25件, 逆順35件）
- [x] `cc:完了` **FD-008**: Temporal before/after（0.572, Bootstrap CI [0.572, 0.572]）

### Phase B: 統計基盤（5タスク）

- [x] `cc:完了` **FD-009**: knowledge-update 50→100件（難易度 E30/M50/H20）
- [x] `cc:完了` **FD-010**: bilingual 30→50件（ja→en/en→ja/混在 均等）
- [x] `cc:完了` **FD-011**: Bootstrap CI(10k) + Holm-Bonferroni 多重比較
  - DoD: 全ベンチマークで 95% CI 報告
- [x] `cc:完了` **FD-012**: 3層 CI ゲート（絶対下限 + 相対回帰2SE + Wilcoxon）
- [x] `cc:完了` **FD-013**: 全ベンチマーク再計測 + Holm-Bonferroni 補正済み統計レポート

### Phase C: 実データ検証基盤（7タスク）

- [x] `cc:完了` **FD-014**: クエリログ収集（HARNESS_MEM_QUERY_LOG 環境変数）
- [x] `cc:完了` **FD-015**: dev-workflow-20 フィクスチャ（実 Claude Code 使用パターン）
- [x] `cc:完了` **FD-016**: Self-eval クエリ生成器（実 DB → temporal クエリ自動生成）
- [x] `cc:完了` **FD-017**: Retrospective A/B 評価（mem_audit_log 活用オフライン再評価）
- [x] `cc:完了` **FD-018**: 競合分析 v9（LLM有無分離 + レイテンシ/コスト指標）
- [x] `cc:完了` **FD-019**: 全指標 before/after 最終比較（Bootstrap CI 付き）
- [x] `cc:完了` **FD-020**: §34 完了レポート + §35 提言

### §34 完了判定

**測定信頼性（全て満たすこと）:**
1. 全フィクスチャに Easy/Medium/Hard の難易度分布が存在
2. temporal フィクスチャに逆順・同日シナリオが含まれる
3. 全メトリクスで Bootstrap 95% CI が報告される
4. 4メトリクス同時検定で Holm-Bonferroni 補正済み

**性能目標（Bootstrap CI の下限で判定）:**
1. Temporal Weighted Kendall tau >= 0.70（100件、CI 下限）
2. locomo-120 F1 >= 0.27（維持、CI 下限）
3. Freshness@K >= 0.70（5-fold CV 後の交差検証値）
4. bilingual recall >= 0.85（50件、Wilson CI 下限）
5. `bun test` 全 pass + 3層 CI ゲート全 pass

**実データ基盤:**
- クエリログ収集が動作し、dev-workflow-20 で評価可能

### スコープ外（§35 以降）

- Multi-hop 推論（Graph traversal 実装が前提）
- LLM Judge 評価（コスト高・再現性低下。実データ評価で優先度再判断）
- 384次元 embedding（F1 への寄与が未検証）
- LoCoMo 200サンプル拡充（§34 で十分な SE が得られた場合は不要）
