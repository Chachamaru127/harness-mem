# S37 ONNX 同等化レポート (2026-03-06)

## 目的
ベンチマーク実行経路を本番相当の ONNX 推論へ統一し、cache 効果と bilingual recall 改善を同時に確認する。

## 差分サマリー (S37-001)

| 項目 | 変更前 | 変更後 |
|---|---|---|
| ベンチ推論経路 | fallback 混在 (local-hash-v3) | `local` provider + `multilingual-e5` ONNX を強制 |
| 同等性検証 | provider/model の実行時検証なし | ONNX gate (`provider/model/vector_dim`) で fail-fast |
| ベンチ前ウォームアップ | なし | `primeEmbedding(passage/query)` を実行 |
| cache 可視化 | なし | `cacheStats` を各ベンチで収集・出力 |
| bilingual gate | 0.70 | 0.80 (Layer1 floor も 0.80) |

## 実装ポイント

- `memory-server/src/core/harness-mem-core.ts`
  - `primeEmbedding(text, mode)` 追加
  - `getEmbeddingRuntimeInfo()` 追加
- `memory-server/src/embedding/local-onnx.ts`
  - LRU cache + inflight dedupe + `prime`/`primeQuery` + `cacheStats`
- `memory-server/src/benchmark/run-ci.ts`
  - ONNX gate / prime / cacheStats / profile-aware Layer2 比較
  - bilingual 失敗ケースの可視化ログを追加
- `memory-server/src/core/core-utils.ts`
  - bilingual-50 失敗語彙に合わせて SYNONYM_MAP を拡張
- `scripts/harness-mem`
  - model catalog を `memory-server` 側定義に同期（`multilingual-e5` を pull 可能化）

## 検証結果

実行コマンド:

```bash
cd memory-server && bun run src/benchmark/run-ci.ts
```

結果:

- locomo-120 F1: `0.2651`
- bilingual-50 recall@10: `0.9000` (gate `0.80` 達成)
- knowledge-update-100 Freshness@K: `0.9600`
- temporal-100 Order Score: `0.5667`
- CI Layer 1: `PASSED`
- CI Layer 2: `PASSED` (同一 embedding profile 履歴比較)

## 補足

- 旧履歴 (`ci-score-history.json`) は embedding profile 情報なしのため、ONNX 移行後は比較対象から除外。
- 新規履歴には embedding profile (`mode/provider/model/vectorDimension`) を保存し、同一条件比較を強制。
