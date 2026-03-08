# S39 Cold vs Warm Observation

## 目的

`S39-003` では、`run-ci` の平均値では埋もれやすい「起動直後の最初の実クエリ」と「prime 後の warm 状態」の差を、同じ評価経路で観測できるようにする。

ここで見たいのは 2 点です。

- 品質差: warm にしたことで `F1` が改善するか、逆に cold が不当に落ちていないか
- 遅延差: warm にしたことで最初の 1 問の検索時間がどれだけ短くなるか

## 手法

`scripts/bench-cold-warm-locomo.ts` は、LoCoMo 互換データセットから単一 QA ケースを複数選び、各ケースを次の 2 条件で別々に実行する。

1. cold-ready
- fresh core
- embedding readiness は満たす
- `prime_embedding_enabled=false`
- つまり「起動は完了しているが、質問ごとの事前 prime はしない」

2. warm-ready
- fresh core
- embedding readiness は満たす
- `prime_embedding_enabled=true`
- つまり「起動完了 + corpus/query prime 済み」

両者とも **1 ケース = 1 QA = fresh temp DB** で測るため、後続クエリの cache 効果で平均が薄まらない。

## 実行コマンド

```bash
bun test memory-server/tests/benchmark/bench-cold-warm-locomo.test.ts

bun run scripts/bench-cold-warm-locomo.ts \
  --dataset tests/benchmarks/fixtures/locomo-15x3.json \
  --limit 12 \
  --output-dir docs/benchmarks/artifacts/s39-cold-warm-latest
```

## 出力物

- `cold-warm-summary.json`
  - 集計値とケース別比較
- `cold-warm-summary.md`
  - レビュー向けの読みやすい表形式サマリ
- `cases/*/cold.result.json`, `cases/*/warm.result.json`
  - 各 single-QA 実行の生結果
- `cases/*/cold.log`, `cases/*/warm.log`
  - 再現用ログ

## 読み方

- `aggregate.delta.mean_latency_ms` が負なら、warm の方が平均で速い
- `aggregate.delta.mean_f1` が正なら、warm の方が平均で精度が高い
- `quality_regression_count > 0` なら、warm/cold で品質差の掘り下げが必要
- `runtime_health_snapshot_statuses` は `run-locomo-benchmark` の起動直後スナップショットなので、単独では ready 判定に使わない
- `gate_all_passed=false` なら ONNX/gate 前提が崩れているので再測定する

## 非目標

- `run-ci` や freeze の最終合否をこのスクリプト単体で置き換えない
- 全件ベンチの代わりにしない
- cold/warm の差を「本番全体の UX 差」と断定しない
