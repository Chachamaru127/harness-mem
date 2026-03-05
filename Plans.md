# Harness-mem 実装マスタープラン

最終更新: 2026-03-06（§36 計画修正 — Plan Critic レビュー反映, 1358テスト）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32 17タスク完了 | §33 15タスク完了 | §34 20タスク完了 | §35 18完了+2blocked（CI PASS, F1+7.4pp）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

§36 Retrieval Quality Reform — 計画策定完了、実装待ち。（1358テスト）

§35 最終結果（ベースライン）:
- F1 = 0.253 | tau = 0.560 [CI: 0.507, 0.614] | Freshness@K = 0.97 | bilingual = 0.72
- 3層 CI ゲート Layer 1: 全 PASS

---

## §36 Retrieval Quality Reform（15タスク, 3フェーズ）

### 背景

§35 で CI 修正・answer 抽出改善を達成したが、3指標が目標未達:
- **bilingual recall = 0.72** — 現行 256 次元 embedding の cross-lingual 精度不足
- **F1 = 0.253** — 検索層 recall が律速。RRF 未導入で fusion が最適化されていない
- **tau = 0.560** — temporal-100 の 80% がアンカーなし。2段階検索が必要

WebSearch 調査結果:
- **RRF (Reciprocal Rank Fusion)** が hybrid search の最強ベースライン。recall +15-30% 期待
- **BGE-M3** (trilingual zh/en/ja) が bilingual 最有力。MRL で 384 次元に縮退可能
- **Dynamic Alpha Tuning** — クエリ種別で BM25/vector 比率を動的調整

### 依存グラフ（Plan Critic レビュー反映済み）

```
Phase A: Embedding + Bilingual（最優先）          Phase B: Recall + F1（Phase A と並列可だが内部順序あり）
├── [P] RQ-001: multilingual-e5 有効化              ├── [P] RQ-006: RRF fusion 実装
│       + ベンチマーク vectorDimension 修正          ├── [P] RQ-007: query expansion（SYNONYM_MAP 拡張）
├──     RQ-002: bilingual-50 再計測（RQ-001後）      ├──     RQ-008: Dynamic Alpha Tuning（RQ-006後）
├──     RQ-003: BGE-M3 比較評価（RQ-001後）          ├──     RQ-009: F1 再計測（RQ-006〜008後）
├──     RQ-004: embedding 選定 + デフォルト切替      └──     RQ-010: cat-3 multi-hop 強化
└──     RQ-005: bilingual floor 0.80 復帰
                │                                             │
Phase C: Temporal + 統合（Phase A + B 全完了後）
├──     RQ-011: temporal 2段階検索（top-3K → time rerank）
├──     RQ-012: temporal-100 フィクスチャ redesign
├──     RQ-013: 全ベンチマーク計測 + CI ゲート更新
├──     RQ-014: リグレッション確認 + 全テスト pass
└──     RQ-015: §36 完了レポート + §37 提言
```

### Phase A: Embedding + Bilingual（5タスク, 最優先）

- [ ] `cc:TODO [P]` **RQ-001**: multilingual-e5 (384次元) 有効化 + ベンチマーク CI 修正
  - DEFAULT_VECTOR_DIM を 256→384 に変更（core-utils.ts）
  - デフォルト embedding モデルを multilingual-e5 に切替
  - **[C-1 対応] ベンチマーク CI の vectorDimension を 64→384 に変更**
    - 対象: run-ci.ts, freshness-cv.ts, jaccard-cv.ts, retrospective-eval.ts
    - CI 環境で ONNX 推論が実行可能か検証（推論時間の増加を計測）
  - 既存ベクトルとの互換性: 新規 DB は 384 次元、既存 DB は reindex 必要
  - DoD: `bun test` pass、新規 DB で 384 次元 embedding が生成される、**ベンチマークが 384 次元で実行される**

- [ ] `cc:TODO` **RQ-002**: bilingual-50 再計測（RQ-001 完了後）
  - RQ-001 適用後に bilingual-50 ベンチマーク実行
  - **[W-1 対応] RQ-001 への依存を明示（`[P]` 除去）**
  - DoD: bilingual recall@10 の値が判明

- [ ] `cc:TODO` **RQ-003**: BGE-M3 比較評価（RQ-001 完了後）
  - BGE-M3 (trilingual zh/en/ja, 1024→384 MRL) を model-catalog に追加
  - **[W-3 対応] 前提条件チェック（サブタスク）:**
    - ONNX 版 BGE-M3 の入手可能性を確認
    - モデルサイズ（~2.2GB、現行最大 274MB の 8 倍）のダウンロード・推論時間を検証
    - 同期 `embed()` でのレイテンシが許容範囲（< 500ms/query）か確認
    - 不可の場合は BGE-M3 をスキップし RQ-004 で multilingual-e5 を確定
  - bilingual-50 で multilingual-e5 vs BGE-M3 を比較
  - DoD: 2モデルの recall@10 比較表が得られる（または BGE-M3 不採用の根拠）

- [ ] `cc:TODO` **RQ-004**: embedding モデル選定 + デフォルト切替
  - RQ-002/003 の結果から最適モデルを選択
  - DoD: デフォルト embedding が選定モデルに確定

- [ ] `cc:TODO` **RQ-005**: bilingual floor 0.80 復帰
  - bilingual recall が 0.80 を超えたら floor を 0.70→0.80 に戻す
  - 超えなければ floor 据え置き + §37 送り
  - DoD: CI ゲート Layer 1 PASS

### Phase B: Recall + F1（5タスク）

- [ ] `cc:TODO [P]` **RQ-006**: RRF (Reciprocal Rank Fusion) 実装
  - **[C-2 対応] アーキテクチャ明確化:**
    - Step 1: lexical ランキングと vector ランキングの 2 リストを RRF で融合（k=60）
    - Step 2: 残り 4 次元（recency, tag_boost, importance, graph）はポスト調整として適用
    - 具体的には: `rrf_score = 1/(k+rank_lex) + 1/(k+rank_vec)` → `final = rrf_score + w_recency*recency + w_tag*tag_boost + w_importance*importance + w_graph*graph`
  - observation-store.ts の `rawScore` 計算（L1152-1164）を上記に置換
  - DoD: `bun test` pass、**locomo-120 で recall@10 が現行以上**

- [ ] `cc:TODO [P]` **RQ-007**: query expansion（クエリ自動拡張）
  - **[W-2 対応] 既存 SYNONYM_MAP（core-utils.ts L144）の拡張として位置づけ**
    - 英語: embedding 近傍語ベースの同義語自動抽出（WordNet は不使用）
    - 日本語: SYNONYM_MAP に日本語同義語ペアを手動追加（bilingual 対応）
  - LLM 不使用
  - DoD: locomo-120 で recall@10 が +5% 以上（**RRF なしのベースラインから計測**）

- [ ] `cc:TODO` **RQ-008**: Dynamic Alpha Tuning（**RQ-006 完了後**）
  - **[W-1 対応] RQ-006 (RRF) 導入後のスコアリング体系で grid search を実施**
  - router.ts の question_kind に基づいて RRF ポスト調整の重みを動的調整
  - profile → BM25 重視、timeline → recency 重視、hybrid → 均等
  - DoD: question_kind ごとの最適重みが grid search で決定

- [ ] `cc:TODO` **RQ-009**: F1 再計測
  - RQ-006〜008 適用後に locomo-120 実行
  - DoD: F1 と Bootstrap CI が判明

- [ ] `cc:TODO` **RQ-010**: cat-3 multi-hop 強化
  - 現在 cat-3 F1=0.157 が全体 F1 を引き下げ
  - **[W-5 対応] 具体的な変更箇所:**
    - observation-store.ts L500-620 付近の graph 検索ロジック
    - `graphMaxHops` の増加（現行値 → +1）で候補拡大
    - graph 候補の fusion 重み（`weights.graph`）を question_kind=multi-hop 時に引き上げ
    - graph traversal 結果を RRF の追加ランキングリストとして組み込む検討
  - DoD: cat-3 F1 >= 0.20

### Phase C: Temporal + 統合（5タスク）

- [ ] `cc:TODO` **RQ-011**: temporal 2段階検索
  - Step 1: 関連性 top-3K で候補を取得（recall 確保）
  - Step 2: 候補内を created_at でソート（ordering 最適化）
  - §35 の教訓: top-K が小さいと recall 破壊。K=30 以上で安全
  - DoD: tau が改善し、recall@10 が低下しない

- [ ] `cc:TODO` **RQ-012**: temporal-100 フィクスチャ redesign
  - アンカー付きクエリ比率を現在 20%→60%+ に引き上げ
  - "after X", "before Y", "between A and B" 形式のクエリを追加
  - **[W-4 対応] 新旧フィクスチャ並行計測を実施**
    - 旧フィクスチャでの tau も計測し、検索品質の改善と fixture 難度変化を分離
    - DoD に「旧 fixture での tau が §35 ベースライン以上」を追加
  - DoD: temporal-100 の timeline 分類率 >= 60% + **旧 fixture tau >= 0.560（§35 ベースライン）**

- [ ] `cc:TODO` **RQ-013**: 全ベンチマーク計測 + CI ゲート更新（**Phase A + B 全完了後**）
  - **[依存グラフ対応] Phase A + Phase B の全タスク完了が前提**
  - DoD: 3層 CI ゲート Layer 1 全 PASS

- [ ] `cc:TODO` **RQ-014**: リグレッション確認 + 全テスト pass
  - DoD: 1358+ テスト pass

- [ ] `cc:TODO` **RQ-015**: §36 完了レポート + §37 提言

### §36 完了判定

**性能目標（Bootstrap CI 下限で判定）:**
1. bilingual recall@10 >= 0.80（multilingual embedding 効果）
2. locomo F1 >= 0.30（RRF + query expansion 効果）
3. Temporal tau >= 0.65（2段階検索 + fixture redesign）
   - **[W-4] 旧 fixture での tau >= 0.560（§35 ベースライン維持）も必須**
4. Freshness@K >= 0.95（**[W-6 対応] 現行 0.97 から 2pp 以内の regression のみ許容**）
5. `bun test` 全 pass + 3層 CI ゲート全 PASS

### Plan Critic レビュー対応サマリー

| ID | 種別 | 指摘 | 対応 |
|----|------|------|------|
| C-1 | Critical | ベンチマーク CI が vectorDimension=64 で embedding 効果測定不能 | RQ-001 に CI 修正を統合 |
| C-2 | Critical | RRF の技術仕様が曖昧（6次元線形結合の「置換」とは？） | RQ-006 に 2 リスト RRF + ポスト調整アーキテクチャを明記 |
| W-1 | Warning | Phase A/B 並列化の依存矛盾（RQ-008 は RQ-006 後でないと無意味） | RQ-008 に RQ-006 依存を明示、RQ-002 の `[P]` 除去 |
| W-2 | Warning | WordNet は日本語に無効、recall +5% 根拠不足 | RQ-007 を SYNONYM_MAP 拡張 + embedding 近傍語に再定義 |
| W-3 | Warning | BGE-M3 は 2.2GB、ONNX 版未確認、レイテンシリスク | RQ-003 に前提条件チェック（サブタスク）を追加 |
| W-4 | Warning | fixture redesign で §35 ベースラインとの比較不能 | RQ-012 に新旧フィクスチャ並行計測を追加 |
| W-5 | Warning | RQ-010 multi-hop の具体的変更箇所が未定義 | 変更箇所・パラメータ・ファイルを列挙 |
| W-6 | Warning | Freshness 目標 0.90 は現行 0.97 から 7pp regression 許容 | 目標を 0.95 に引き上げ |
