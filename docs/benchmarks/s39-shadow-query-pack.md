# S39 Shadow Query Pack

## 目的

`shadow-query-pack-24.json` は、LoCoMo だけに最適化していないことを確かめるための補助評価セットです。

- 匿名化した実運用寄りの記憶問い合わせを想定する
- exact value, current state, timeline, causal why, list を混ぜる
- product aligned を優先し、fixture の言い回しだけに刺さる問題は入れない

## 構成

- ファイル: `tests/benchmarks/fixtures/shadow-query-pack-24.json`
- 形式: LoCoMo 互換
- サンプル数: 12
- QA 数: 24
- 1サンプルあたり: 4〜6発話 + 2問
- 主な質問タイプ:
  - `cat-1`: current value / exact fact
  - `cat-2`: before/after / sequence
  - `cat-3`: causal explanation / dependency
  - `cat-4`: compact list extraction
- 題材:
  - pricing / retention / auth / CI / support ops / dashboard refresh / admin features
  - いずれも匿名化済みで、特定の顧客名・社名・内部コードは含めない

## 設計ルール

1. 固有名詞は匿名化済みの業務文脈に寄せる
2. 答えは conversation 内の evidence だけで復元できる
3. benchmark 専用のトリックは入れない
4. LoCoMo と違う題材でも、同じ retrieval + extraction 経路で評価できる形にする
5. わざと難読化しない。実運用で自然に出る「今の設定」「なぜ変えたか」「何が先だったか」を優先する

## Anti-Goals

- 固有のベンチ用キーワードを埋め込まない
- question に answer をそのまま含めない
- product が本来想定しないパズル問題や読解クイズにしない
- 特定1回の run だけ通るような言い回し最適化をしない

## 実行方法

### 単発ベンチ

```bash
bun run tests/benchmarks/run-locomo-benchmark.ts \
  --system harness-mem \
  --dataset tests/benchmarks/fixtures/shadow-query-pack-24.json \
  --output .tmp/shadow-query-pack.result.json
```

### スコアレポート生成

```bash
bun run tests/benchmarks/locomo-score-report.ts \
  --result .tmp/shadow-query-pack.result.json \
  --output .tmp/shadow-query-pack.score-report.json
```

### 失敗バックログ生成

```bash
bun run tests/benchmarks/locomo-failure-backlog.ts \
  --result .tmp/shadow-query-pack.result.json \
  --limit 50 \
  --output .tmp/shadow-query-pack.failure-backlog.json \
  --markdown-output .tmp/shadow-query-pack.failure-backlog.md
```

## 読み方

- これ単体で product quality を断定しない
- `run-ci` の主評価を補強し、LoCoMo 過学習の疑いを下げるために使う
- 改善前後で `F1`, `search p95`, `token avg`, 失敗タグ上位 を並べて判断する
- 特に `current vs previous` の取り違え、理由抽出、短答圧縮の崩れを確認する

## 推奨の使い方

1. まず `run-ci` を通して主評価を確認する
2. 次にこの shadow pack を回し、LoCoMo 以外でも改善が再現するかを見る
3. 失敗時は fixture をいじる前に、failure backlog で retrieval / extraction / normalization のどこが崩れているかを確認する
4. shadow pack の設問をスコア都合で書き換え続けない。変更するなら「実問い合わせに近づいた理由」を残す

## 現時点の注意

- この pack は補助評価であり、単独の pass / fail gate ではない
- 現在の実装では `current state` と `previous state` の取り違えや、`why` 質問で旧事実を返す失敗が出やすい
- そのため、shadow pack の低スコアは fixture 不備だけでなく product 側の弱点検知として扱う
