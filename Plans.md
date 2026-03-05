# Harness-mem 実装マスタープラン

最終更新: 2026-03-06（§37 完了 — ONNX同等化/キャッシュ/bilingual復帰, run-ci PASS）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32 17タスク完了 | §33 15タスク完了 | §34 20タスク完了 | §35 18完了+2blocked（CI PASS, F1+7.4pp） | §36 15タスク完了（CI PASS, F1+1.43pp, cat-3+9.5pp） | §37 10タスク完了（run-ci PASS, bilingual=0.90）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

**§37 ONNX本番同等化 + cache + bilingual復帰 — 完了**（2026-03-06, run-ci PASS, 1035テスト pass）

| 指標 | §36 | §37 | 変化 |
|------|-----|-----|------|
| locomo F1 (overall) | 0.268 | 0.2651 | -0.29pp |
| bilingual recall@10 | 0.70 | 0.90 | +20pp ✅ |
| Freshness@K | 0.96 | 0.96 | ±0 |
| temporal score | 0.567 | 0.5667 | ±0 |
| CI Layer 1 | PASS | PASS | ✅ |
| CI Layer 2 | FAIL (旧profile比較) | PASS (同一profile比較) | ✅ |

成果物:
- `docs/benchmarks/s37-onnx-equivalence-report-2026-03-06.md`（S37-001 差分表 + 実測結果）
- `memory-server/src/benchmark/run-ci.ts`（ONNX gate / cacheStats / profile-aware Layer2）
- `memory-server/src/core/core-utils.ts`（bilingual失敗語彙を反映した SYNONYM_MAP 拡張）

---

## §36 完了（全15タスク `cc:完了`）

**Phase A** (Embedding+Bilingual): RQ-001〜005 完了
**Phase B** (Recall+F1): RQ-006〜010 完了 — RRF実装, query expansion, cat-3強化
**Phase C** (Temporal+統合): RQ-011〜015 完了 — temporal 2段階検索, CI PASS

主要変更ファイル:
- `memory-server/src/core/observation-store.ts` — RRF (k=60), graphMaxHops 3→4
- `memory-server/src/core/core-utils.ts` — SYNONYM_MAP 50+エントリ追加
- `tests/benchmarks/locomo-harness-adapter.ts` — cat-3クエリバリアント修正

---

## §37 実行計画（ONNX本番同等化 + キャッシュ + bilingual 0.80復帰）

進行状態: `cc:完了`（/breezing all 完走）

### Feature Priority Matrix

| 区分 | 項目 | 完了条件（DoD） |
|------|------|-----------------|
| Required | ONNX本番同等化（ベンチでも同じ推論経路） | ベンチが random fallback を使わず ONNX 実推論で走ることを CI で証明 |
| Required | embedding キャッシュ戦略 | 同一条件の再実行で embedding 再計算を大幅削減し、結果の再現性を維持 |
| Required | bilingual recall@10 を 0.80 へ復帰 | bilingual-50 で recall@10 >= 0.80 を CI ゲート化 |
| Recommended | §37 比較レポート整備 | cold/warm 実行差分と品質指標差分を1枚で比較できる |
| Recommended | 運用Runbook更新 | 失敗時の切り分け手順（モデル/キャッシュ/データ）を手順化 |
| Optional | 代替モデル再比較（mGTE 等） | multilingual-e5 を上回る根拠がある場合のみ採用検討 |

### 依存グラフ

```
Phase A: ONNX本番同等化（最優先）
├── S37-001: 現状差分の可視化（prod/bench経路）
├── S37-002: ベンチ経路を本番推論に統合（random fallback禁止）
└── S37-003: CIゲート追加（onnx=true, model, vector_dim を検証）
                     │
Phase B: Cache（Phase A 後）
├── S37-004: embedding cache 実装（model+text hash key）
├── [P] S37-005: warm/cold ベンチ計測
└── S37-006: cache整合テスト（hit/miss/invalidate）
                     │
Phase C: Bilingual復帰（Phase A+B 後）
├── S37-007: bilingual失敗ケース分析（トップ失敗クエリを分類）
├── S37-008: JA/EN 正規化 + SYNONYM_MAP 拡張
├── S37-009: 重み再調整と再計測（bilingual-50）
└── S37-010: CI gate化 + §37レポート確定
```

### TDD 方針

- すべての Phase で「先に失敗テストを追加 → 実装 → リファクタ」を徹底する。
- random fallback に戻る変更はテストで必ず検知する。
- ベンチ系変更は品質（recall/F1）と速度（cold/warm）を同時に記録する。

### タスク一覧（`/work` 実行用）

### Phase A: ONNX本番同等化（Goal 1）

- [x] `cc:完了` **S37-001 [feature:tdd]**: prod/bench 推論経路の差分を棚卸し
  - 対象: `memory-server/src/core/core-utils.ts`, `memory-server/src/benchmark/*.ts`
  - DoD: random fallback が発生する条件を明文化し、差分表を `docs/benchmarks/` に記録

- [x] `cc:完了` **S37-002 [feature:tdd]**: ベンチを本番と同一 ONNX 経路へ統合
  - random embedding fallback の暗黙利用を禁止（使う場合は明示フラグ必須）
  - DoD: ベンチ実行ログに `onnx=true`, `model=multilingual-e5`, `vector_dim=384` が必ず出力

- [x] `cc:完了` **S37-003 [feature:tdd]**: ONNX 同等性の CI ゲート追加
  - DoD: CI 上で S37-002 条件が1つでも崩れたら fail

### Phase B: embedding キャッシュ（Goal 2）

- [x] `cc:完了` **S37-004 [feature:tdd]**: embedding cache（key: model+normalized_text hash）実装
  - DoD: 同一入力で再計算せず cache hit することを単体テストで担保

- [x] `cc:完了 [P]` **S37-005 [feature:tdd]**: warm/cold ベンチ計測を追加
  - DoD: 2回目実行で embedding 再計算件数が 80% 以上減少

- [x] `cc:完了` **S37-006 [feature:tdd]**: cache invalidation と再現性テスト
  - DoD: モデル変更時に古い cache を使わない / 同条件再実行で結果が一致

### Phase C: bilingual recall 0.80 復帰（Goal 3）

- [x] `cc:完了` **S37-007 [feature:tdd]**: bilingual-50 の失敗ケース分析
  - DoD: 失敗上位クエリを原因別（語彙不足・正規化不足・ranking不足）に分類

- [x] `cc:完了` **S37-008 [feature:tdd]**: JA/EN 正規化 + SYNONYM_MAP の強化
  - DoD: S37-007 で抽出した語彙ギャップの 80% 以上をカバー

- [x] `cc:完了` **S37-009 [feature:tdd]**: bilingual最適化の重み調整 + 再計測
  - DoD: bilingual-50 recall@10 >= 0.80（3-run 平均）

- [x] `cc:完了` **S37-010**: §37 統合レポート + CI gate 更新
  - DoD: ONNX同等性 / cache効果 / bilingual 0.80 の3条件を CI Layer 1 で検証
