# Adaptive Retrieval Engine

Adaptive Retrieval Engine は、harness-mem の `adaptive` 埋め込みモードの設計メモです。

この機能が解決したい問題は単純です。現場の検索クエリは、きれいな日本語だけでも、きれいな英語だけでもありません。実際には、次のようなものが混ざります。

- 日本語の相談文
- 英語の API 名やエラーメッセージ
- コード断片やファイル名
- 日本語と英語が同じ 1 行に混ざったメモ

そのため、1 つの埋め込みモデルだけに全部を任せると、どこかで取りこぼしが出ます。Adaptive Retrieval Engine は、その取りこぼしを減らすための仕組みです。

## 1. どう動くか

検索文を見て、まず `query-analyzer.ts` が次のような特徴を計算します。

- `jaRatio`
  日本語の比率です。
- `codeRatio`
  コードらしさの比率です。記号、camelCase、snake_case、コードブロックなどを見ます。
- `queryType`
  自然文なのか、コード寄りなのか、混在なのかの分類です。

その結果をもとに、3 つの route のどれを使うか決めます。

- Route A (`ruri`)
  日本語が強いクエリ向けです。
- Route B (`openai`)
  英語またはコード寄りのクエリ向けです。
- Route C (`ensemble`)
  日英混在クエリ向けです。両方の経路で検索して、最後にスコアを合成します。

## 2. 保存時の仕組み

観察情報を保存するときも、adaptive provider は route を見ます。

- Route A / B
  1 本のベクトルだけ保存します。
- Route C
  2 本のベクトルを保存します。
  つまり、日本語側と汎用側の両方を保存します。

このため `mem_vectors` は `(observation_id, model)` の複合キーになっていて、1 つの observation に複数モデルのベクトルを持てます。

## 3. 検索時の仕組み

検索時は route ごとに次のように動きます。

- Route A
  日本語側のベクトルだけ検索します。
- Route B
  汎用側のベクトルだけ検索します。
- Route C
  両方のベクトル検索を実行し、あとで score fusion（複数スコアの合成）します。

score fusion では、日本語比率に応じて日本語側の重みを変えます。重みはコードに固定せず、`data/ensemble-weights.json` から読み込みます。

これで何がよいかというと、日英混在クエリのときに「日本語のニュアンス」と「英語の識別子」の両方を拾いやすくなります。

## 4. Query Expansion

Query Expansion は、検索語の言い換えを少数だけ自動で追加する仕組みです。

たとえば:

- `本番反映` → `デプロイ`, `リリース`, `deploy`
- `rollback` → `切り戻し`

ここで大事なのは、無制限に展開しないことです。Adaptive Retrieval Engine では、レイテンシを守るために次の制限をかけています。

- 展開数は最大 3 variant
- 展開後トークン数は元の 3 倍以内
- adaptive provider のときだけ実行

## 5. Free 経路と Pro 経路

Adaptive Retrieval Engine には 2 つの実行経路があります。

### Free 経路

- 日本語側: ローカル日本語モデル
- 汎用側: ローカル汎用モデル、または fallback hash embedding

これは完全ローカルで動きます。

### Pro 経路

- 汎用側を Pro API へ切り替えます
- `HARNESS_MEM_PRO_API_KEY`
- `HARNESS_MEM_PRO_API_URL`

を両方設定すると有効になります。

Pro API provider は次の性質を持ちます。

- POST で埋め込みを取得
- 5 秒タイムアウト
- 256 エントリの LRU キャッシュ
- health が落ちたら `degraded`

## 6. フォールバック

フォールバックは「壊れたら止まる」のではなく、「精度を少し落としてでも検索を続ける」ための保険です。

Adaptive provider は、Pro API 側が `degraded` になると Free 経路へ切り替えます。再試行の間隔は exponential backoff（失敗ごとに待ち時間を伸ばす方式）です。

- 10 秒
- 30 秒
- 60 秒
- 300 秒

復旧したら自動で Pro 経路に戻ります。

## 7. チューニング

Adaptive Retrieval Engine は、しきい値を勘で固定し続けるのではなく、benchmark で調整できるようにしています。

使うコマンド:

```bash
npm run benchmark
npm run benchmark:tune-adaptive
```

`benchmark:tune-adaptive` は、次をグリッドサーチします。

- `HARNESS_MEM_ADAPTIVE_JA_THRESHOLD`
- `HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD`

出力は JSON で返り、`--save` を付けると `data/adaptive-thresholds.json` に保存できます。

例:

```bash
cd memory-server
bun run src/benchmark/adaptive-tuning.ts --save
```

## 8. 関連ファイル

- `memory-server/src/embedding/query-analyzer.ts`
- `memory-server/src/embedding/adaptive-provider.ts`
- `memory-server/src/embedding/pro-api-provider.ts`
- `memory-server/src/embedding/query-expander.ts`
- `memory-server/src/core/observation-store.ts`
- `memory-server/src/benchmark/run-ci.ts`
- `memory-server/src/benchmark/adaptive-tuning.ts`
- `data/adaptive-thresholds.json`
- `data/ensemble-weights.json`
- `data/synonyms-ja.json`
- `data/synonyms-en.json`

## 9. 注意点

- `adaptive` は検索品質を底上げするための仕組みで、すべての query で必ず改善することを保証するものではありません。
- Free 経路では、ローカル汎用モデルが未導入だと fallback embedding に落ちます。
- Pro 経路は可用性を上げるためにフォールバックを持ちますが、外部 API 契約自体は `docs/pro-api-data-policy.md` の前提を満たす必要があります。
