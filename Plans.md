# Harness-mem 実装マスタープラン

最終更新: 2026-03-05（§36 計画策定完了, 1358テスト）
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

### 依存グラフ

```
Phase A: Embedding + Bilingual（最優先）     ──並列──   Phase B: Recall + F1
├── [P] RQ-001: multilingual-e5 有効化                  ├── [P] RQ-006: RRF fusion 実装
├── [P] RQ-002: bilingual-50 再計測                     ├── [P] RQ-007: query expansion
├──     RQ-003: BGE-M3 比較評価（RQ-001後）             ├──     RQ-008: Dynamic Alpha Tuning
├──     RQ-004: embedding 選定 + デフォルト切替          ├──     RQ-009: F1 再計測
└──     RQ-005: bilingual floor 0.80 復帰               └──     RQ-010: cat-3 multi-hop 強化
                │                                                 │
Phase C: Temporal + 統合
├──     RQ-011: temporal 2段階検索（top-K → time rerank）
├──     RQ-012: temporal-100 フィクスチャ redesign
├──     RQ-013: 全ベンチマーク計測 + CI ゲート更新
├──     RQ-014: リグレッション確認 + 全テスト pass
└──     RQ-015: §36 完了レポート + §37 提言
```

### Phase A: Embedding + Bilingual（5タスク, 最優先）

- [ ] `cc:TODO [P]` **RQ-001**: multilingual-e5 (384次元) 有効化
  - DEFAULT_VECTOR_DIM を 256→384 に変更（core-utils.ts）
  - デフォルト embedding モデルを multilingual-e5 に切替
  - 既存ベクトルとの互換性: 新規 DB は 384 次元、既存 DB は reindex 必要
  - DoD: `bun test` pass、新規 DB で 384 次元 embedding が生成される

- [ ] `cc:TODO [P]` **RQ-002**: bilingual-50 再計測
  - RQ-001 適用後に bilingual-50 ベンチマーク実行
  - DoD: bilingual recall@10 の値が判明

- [ ] `cc:TODO` **RQ-003**: BGE-M3 比較評価（RQ-001 完了後）
  - BGE-M3 (trilingual zh/en/ja, 1024→384 MRL) を model-catalog に追加
  - bilingual-50 で multilingual-e5 vs BGE-M3 を比較
  - DoD: 2モデルの recall@10 比較表が得られる

- [ ] `cc:TODO` **RQ-004**: embedding モデル選定 + デフォルト切替
  - RQ-002/003 の結果から最適モデルを選択
  - DoD: デフォルト embedding が選定モデルに確定

- [ ] `cc:TODO` **RQ-005**: bilingual floor 0.80 復帰
  - bilingual recall が 0.80 を超えたら floor を 0.70→0.80 に戻す
  - 超えなければ floor 据え置き + §37 送り
  - DoD: CI ゲート Layer 1 PASS

### Phase B: Recall + F1（5タスク）

- [ ] `cc:TODO [P]` **RQ-006**: RRF (Reciprocal Rank Fusion) 実装
  - 現在の線形結合 (weighted sum) を RRF に置換
  - observation-store.ts の ranked scoring を変更
  - RRF パラメータ k=60（業界標準）
  - DoD: `bun test` pass、既存ベンチマークで recall が低下しない

- [ ] `cc:TODO [P]` **RQ-007**: query expansion（クエリ自動拡張）
  - 同義語・パラフレーズでクエリを拡張し BM25 recall を向上
  - LLM 不使用（WordNet/同義語辞書ベース or embedding 近傍語）
  - DoD: locomo-120 で recall@10 が +5% 以上

- [ ] `cc:TODO` **RQ-008**: Dynamic Alpha Tuning
  - router.ts の question_kind に基づいて fusion 重みを動的調整
  - profile → BM25 重視(α=0.7)、timeline → recency 重視、hybrid → 均等
  - DoD: question_kind ごとの最適 α が grid search で決定

- [ ] `cc:TODO` **RQ-009**: F1 再計測
  - RQ-006〜008 適用後に locomo-120 実行
  - DoD: F1 と Bootstrap CI が判明

- [ ] `cc:TODO` **RQ-010**: cat-3 multi-hop 強化
  - 現在 cat-3 F1=0.157 が全体 F1 を引き下げ
  - graph traversal を活用して multi-hop 推論の candidate を増やす
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
  - DoD: temporal-100 の timeline 分類率 >= 60%

- [ ] `cc:TODO` **RQ-013**: 全ベンチマーク計測 + CI ゲート更新
  - DoD: 3層 CI ゲート Layer 1 全 PASS

- [ ] `cc:TODO` **RQ-014**: リグレッション確認 + 全テスト pass
  - DoD: 1358+ テスト pass

- [ ] `cc:TODO` **RQ-015**: §36 完了レポート + §37 提言

### §36 完了判定

**性能目標（Bootstrap CI 下限で判定）:**
1. bilingual recall@10 >= 0.80（multilingual embedding 効果）
2. locomo F1 >= 0.30（RRF + query expansion 効果）
3. Temporal tau >= 0.65（2段階検索 + fixture redesign）
4. Freshness@K >= 0.90（維持）
5. `bun test` 全 pass + 3層 CI ゲート全 PASS
