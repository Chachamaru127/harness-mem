# Harness-mem 実装マスタープラン

最終更新: 2026-03-04（§32 計画策定完了, 941+テスト）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-28 → [`docs/archive/`](docs/archive/) | §29 128/140首位 | §30 アーキテクチャ908テスト | §31 Graph/PG/Team/LoCoMo 941+テスト

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

§32 ベンチマーク信頼性改革 — 計画策定完了、実装待ち。（§31まで完了, 941+テスト）

---

## §32 ベンチマーク信頼性改革（17タスク, 4フェーズ）

### 背景

MRR=1.0 が出たが、10サンプルのキーワード一致テストでは当然の結果。
3つの異なる視点（プラグマティスト / ベンチマーク・ピュリスト / プロダクトエンジニア）による討論の結果、
以下の構造的問題が特定された:

| 問題 | 現状 | 影響 |
|------|------|------|
| データセットが自明 | 10サンプル、query=content のキーワード | MRR=1.0 は測定として無意味 |
| Distractor なし | 各サンプルが完全に独立 | precision/MRR が差別化されない |
| 日英混在未対応 | SYNONYM_MAP に日本語エントリなし | 「デプロイ」→「deploy」検索が空振り |
| Knowledge Update 未評価 | 「事実の上書き」テストなし | コーディングメモリの最頻出パターンが未検証 |
| 競合比較の非等価性 | locomo-mini ≠ LongMemEval 500問 | スコアを並べると虚偽の比較になる |

**方針**: 測定設計を先行定義し、段階的にデータセット品質を向上させる。
コアのコード変更は最小限に抑え、データとテストの信頼性に集中する。

### 依存グラフ

```
Phase 0: 基盤調査（並列実行可）
├── [P] BM-001: unicode61 tokenizer 動作検証
├── [P] BM-002: 測定フレームワーク設計
└── [P] BM-003: locomo-120 現状スコア baseline 計測
         │
Phase 1: Distractor + CI 統合（最高ROI）
├── [P] BM-004: Distractor サンプル 20件作成
├── [P] BM-005: locomo-120 CI runner 統合
├──     BM-006: 回帰ゲート baseline 設定
└──     BM-007: 競合比較表に測定条件フッター追加
         │
Phase 2: 日英バイリンガル対応（Phase 0 結果に依存）
├── [P] BM-008: SYNONYM_MAP 日英エントリ追加
├── [P] BM-009: 日英混在テストデータ 10件作成
├──     BM-010: buildFtsQuery の日本語トークン処理改善
└──     BM-011: バイリンガル回帰テスト追加
         │
Phase 3: Knowledge Update + Temporal（Stage C 優先サブセット）
├── [P] BM-012: Knowledge Update フィクスチャ作成（10件）
├── [P] BM-013: Temporal クエリフィクスチャ作成（10件）
├──     BM-014: Knowledge Update 評価メトリクス実装
├──     BM-015: Temporal 評価メトリクス実装
├──     BM-016: CI 統合（全フィクスチャ統合実行）
└──     BM-017: 競合分析ドキュメント更新
```

### Phase 0: 基盤調査（3タスク, 並列実行可）

目的: Phase 1〜3 の設計判断に必要な事実を確認する。

- [ ] `cc:TODO [P]` **BM-001**: unicode61 tokenizer の日本語分割動作を検証
  - FTS5 で「デプロイ」「認証バグ」「データベース」がどうトークン化されるか確認
  - `tokenize` 関数（core-utils.ts）の CJK 正規表現との整合性を検証
  - DoD: 検証結果ドキュメント作成。Phase 2 の実現可否を判定

- [ ] `cc:TODO [P]` **BM-002**: 測定フレームワーク設計書を作成
  - 何のメトリクスで何を測るかを事前定義（ピュリストの要件）
  - IR メトリクス（recall@10, MRR, NDCG）と Answer F1 の使い分け
  - 競合スコア（OMEGA 95.4%, Mastra 94.87%）との比較条件を明示
  - 各質問タイプ（single-hop / knowledge-update / temporal）に対応するメトリクス
  - DoD: `docs/benchmarks/measurement-framework.md` 作成

- [ ] `cc:TODO [P]` **BM-003**: locomo-120.json の現状スコアを baseline として計測
  - 40サンプル × 120QA を runner で実行し、cat-1〜cat-4 別のスコアを記録
  - DoD: `memory-server/src/benchmark/results/locomo-120-baseline.json` 出力

### Phase 1: Distractor + CI 統合（4タスク, 最高ROI）

前提: Phase 0 完了

目的: コード変更なしでベンチマーク品質を根本改善する。

- [ ] `cc:TODO [P]` **BM-004**: locomo-120 に Distractor サンプル 20件追加
  - 同一属性・異なる値パターン（「MIT で Python」vs「Stanford で Python」）
  - 同一技術・異なるプロジェクト（「Project A の PostgreSQL」vs「Project B の PostgreSQL」）
  - 時系列混乱パターン（古い事実と新しい事実が共存）
  - DoD: locomo-120.json が 60サンプル × 180QA に拡張

- [ ] `cc:TODO [P]` **BM-005**: CI runner を locomo-120 に切り替え
  - `run-ci.ts` のデータセット参照を locomo-120 に変更
  - cat-1〜cat-4 別スコアの出力対応
  - DoD: CI で 120+ QA が計測される

- [ ] `cc:TODO` **BM-006**: 回帰ゲート baseline を locomo-120 のスコアで再設定
  - BM-003 の baseline を基準に、-5% で CI fail する閾値を設定
  - DoD: regression-gate が locomo-120 baseline で動作

- [ ] `cc:TODO` **BM-007**: 競合比較表に測定条件フッターを追加
  - 「harness-mem の LoCoMo スコアは cat-1〜4 の X 問サブセットによる。
    OMEGA/Mastra の LongMemEval スコアは 7タイプ 500問。直接比較不可」
  - DoD: `docs/benchmarks/competitive-analysis-*.md` にフッター追記

### Phase 2: 日英バイリンガル対応（4タスク）

前提: Phase 0 BM-001（tokenizer 検証）完了

目的: 日本の開発者の実使用パターンでの検索品質を保証する。

- [ ] `cc:TODO [P]` **BM-008**: SYNONYM_MAP に日英エントリ 30件追加
  - カタカナ技術用語: デプロイ↔deploy, テスト↔test, バグ↔bug 等
  - 漢字技術用語: 認証↔auth, 修正↔fix, 設定↔config 等
  - 混合パターン: データベース↔database, サーバー↔server 等
  - DoD: SYNONYM_MAP に日英双方向エントリ 30件追加

- [ ] `cc:TODO [P]` **BM-009**: 日英混在テストデータ 10件作成
  - パターン1: 日本語コンテンツ + 英語クエリ（「デプロイ設定を更新」→ "deploy config"）
  - パターン2: 英語コンテンツ + 日本語クエリ（"Fixed auth bug" → 「認証のバグ」）
  - パターン3: 混在コンテンツ + 混在クエリ（「AWS Tokyo にデプロイ」→ "AWS deploy"）
  - DoD: `tests/benchmarks/fixtures/bilingual-10.json` 作成

- [ ] `cc:TODO` **BM-010**: buildFtsQuery の日本語トークン処理改善
  - BM-001 の検証結果に基づき、必要に応じて tokenize 関数を修正
  - unicode61 の分割結果と SYNONYM_MAP のキーが一致するよう調整
  - DoD: 日英混在テスト 10件中 8件以上で recall@10 = 1.0

- [ ] `cc:TODO` **BM-011**: バイリンガル回帰テスト追加
  - `bun:test` に日英混在検索の回帰テスト 5件追加
  - DoD: テスト pass。CI に組み込み

### Phase 3: Knowledge Update + Temporal（6タスク）

前提: Phase 1 完了

目的: コーディングメモリの最頻出パターンを評価可能にする。

- [ ] `cc:TODO [P]` **BM-012**: Knowledge Update フィクスチャ作成（10件）
  - パターン: 古い記録 → 新しい記録 → 「現在の状態は？」クエリ
  - 例: 「React 16 → React 18 移行」「REST → GraphQL 変更」
  - 各ケースで少なくとも2つの observation を ingest し、最新を問う
  - DoD: `tests/benchmarks/fixtures/knowledge-update-10.json` 作成

- [ ] `cc:TODO [P]` **BM-013**: Temporal クエリフィクスチャ作成（10件）
  - パターン: 時系列イベント → 「〜の前/後に何をしたか」クエリ
  - 例: 「デプロイ前の確認事項」「マイグレーション後の検証手順」
  - タイムスタンプを活用した時系列検索の精度を評価
  - DoD: `tests/benchmarks/fixtures/temporal-10.json` 作成

- [ ] `cc:TODO` **BM-014**: Knowledge Update 評価メトリクス実装
  - 「最新の情報が上位に来るか」を測定する Freshness@K メトリクス
  - 古い情報のランクが新しい情報より低いことを検証
  - DoD: runner.ts に Freshness@K 計算を追加

- [ ] `cc:TODO` **BM-015**: Temporal 評価メトリクス実装
  - 時系列順序の正しさを測定する Order-sensitive MRR
  - タイムスタンプフィルタの効果を定量化
  - DoD: runner.ts に temporal MRR 計算を追加

- [ ] `cc:TODO` **BM-016**: CI 統合（全フィクスチャ統合実行）
  - locomo-120 + bilingual-10 + knowledge-update-10 + temporal-10 を統合実行
  - 各フィクスチャの回帰ゲートを設定
  - DoD: run-ci.ts が全フィクスチャを順次実行

- [ ] `cc:TODO` **BM-017**: 競合分析ドキュメント更新
  - 新しいベンチマーク結果を反映した competitive-analysis を更新
  - 測定条件の差異を明記（BM-002 のフレームワークに基づく）
  - DoD: `docs/benchmarks/competitive-analysis-v7.md` 作成

### §32 完了判定

1. CI で 200+ QA が自動計測される（現状 10問 → 200問以上）
2. Distractor ありのデータセットで MRR < 1.0 の現実的なスコアが出る
3. 日英混在検索で recall@10 >= 0.8
4. Knowledge Update で Freshness@K が測定可能
5. 競合比較表に測定条件が明記されている
6. `bun test` 全 pass

### スコープ外（§33 以降で検討）

- Multi-hop 推論（Graph traversal 実装が前提）
- Negation クエリ（アーキテクチャ変更が前提）
- 多言語 embedding モデルへの差し替え（64次元 → 384次元、DB マイグレーション必要）
- LLM Judge による Answer F1 評価（LLM 依存を最小化する設計方針との整合）
