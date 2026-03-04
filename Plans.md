# Harness-mem 実装マスタープラン

最終更新: 2026-03-04（§32 全17タスク完了, 956テスト）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-28 → [`docs/archive/`](docs/archive/) | §29 128/140首位 | §30 アーキテクチャ908テスト | §31 Graph/PG/Team/LoCoMo 941+テスト

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

§32 ベンチマーク信頼性改革 — 全17タスク完了。956テスト pass。

---

## §32 ベンチマーク信頼性改革（17タスク, 4フェーズ）

### Phase 0-2 完了サマリー（2026-03-04）

| タスク | 結果 |
|--------|------|
| BM-001 | unicode61 tokenizer 検証完了 → `docs/benchmarks/unicode61-tokenizer-analysis.md` |
| BM-002 | 測定フレームワーク設計書 → `docs/benchmarks/measurement-framework.md` |
| BM-003 | locomo-120 baseline 計測 → `results/locomo-120-baseline.json`（overall F1=0.179） |
| BM-004 | Distractor 20件追加 → locomo-120.json が 60サンプル×180QA に拡張 |
| BM-005 | CI runner を locomo-120 に切り替え → `run-ci.ts` 更新済み |
| BM-006 | 回帰ゲート実装済み → threshold=-5pp で CI fail |
| BM-007 | 競合比較表フッター追加 → `competitive-analysis-2026-03-03-v6.md` |
| BM-008 | SYNONYM_MAP に日英 31件追加 → `core-utils.ts` |
| BM-009 | 日英混在テストデータ → `fixtures/bilingual-10.json`（10件） |
| BM-010 | CJK バイグラム展開を `tokenize()` に追加 → 8/10 recall@10=1.0 達成 |

### Phase 3: Knowledge Update + Temporal（6タスク）

前提: Phase 1 完了（達成済み）

目的: コーディングメモリの最頻出パターンを評価可能にする。

- [x] `cc:完了 [P]` **BM-012**: Knowledge Update フィクスチャ作成（10件）
  - DoD: `tests/benchmarks/fixtures/knowledge-update-10.json` 作成
  - 結果: React/GraphQL/JWT/DB/Cloud/pkg 等 10件の知識更新テストケース作成済み

- [x] `cc:完了 [P]` **BM-013**: Temporal クエリフィクスチャ作成（10件）
  - DoD: `tests/benchmarks/fixtures/temporal-10.json` 作成
  - 結果: デプロイ/バグ修正/スプリント/インシデント等 10件の時系列テストケース作成済み

- [x] `cc:完了` **BM-011**: バイリンガル回帰テスト追加
  - `bun:test` に日英混在検索の回帰テスト 5件追加
  - 結果: bilingual-search.test.ts 作成済み。テスト pass

- [x] `cc:完了` **BM-014**: Knowledge Update 評価メトリクス実装
  - DoD: runner.ts に Freshness@K 計算を追加
  - 結果: `calculateFreshnessAtK()` 実装済み（新ID vs 旧ID のランク比較）

- [x] `cc:完了` **BM-015**: Temporal 評価メトリクス実装
  - DoD: runner.ts に temporal Order Score 計算を追加
  - 結果: `calculateTemporalOrderScore()` 実装済み（Kendall tau を [0,1] 正規化）

- [x] `cc:完了` **BM-016**: CI 統合（全フィクスチャ統合実行）
  - locomo-120 + bilingual-10 + knowledge-update-10 + temporal-10 を統合実行
  - DoD: run-ci.ts が全フィクスチャを順次実行
  - 結果: `run-ci.ts` に bilingual/KU/temporal の評価関数を追加。各回帰ゲートを設定

- [x] `cc:完了` **BM-017**: 競合分析ドキュメント更新
  - 結果: `docs/benchmarks/competitive-analysis-2026-03-04-v7.md` 作成。Benchmark/Eval 軸 +1pt（115→116/140）

### §32 完了判定

1. CI で 200+ QA が自動計測される（現状 180問 → 200問以上）
2. Distractor ありのデータセットで MRR < 1.0 の現実的なスコアが出る
3. 日英混在検索で recall@10 >= 0.8
4. Knowledge Update で Freshness@K が測定可能
5. 競合比較表に測定条件が明記されている
6. `bun test` 全 pass

### スコープ外（§33 以降で検討）

- Multi-hop 推論（Graph traversal 実装が前提）
- 多言語 embedding モデルへの差し替え（64次元 → 384次元、DB マイグレーション必要）
- LLM Judge による Answer F1 評価（LLM 依存を最小化する設計方針との整合）
