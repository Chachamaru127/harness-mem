# LOCOMO Comparison Scope

## 目的

LoCoMo評価を `harness-mem / mem0 / claude-mem / memos` で比較する際の、APIとデータモデル適合条件を固定する。

## memos 判定

- 比較対象: `memos`
- 判定: **条件付きで比較不可（現時点）**
- 理由:
1. API: LoCoMoのQA評価で必要な「会話投入 -> 質問検索 -> 予測文生成」の同一インターフェースが標準で揃っていない。
2. データモデル: memosはノート中心モデルのため、会話ターン単位リプレイとQA評価を直接マッピングしにくい。

## 比較可否の基準

1. API要件: ingest / search / retrieval を同一入力で実行できること。
2. データモデル要件: 会話ターン順序とQAペアを欠落なく保持できること。
3. 評価要件: 同一評価器（EM/F1 + category）に入力可能な出力を返せること。

## 今後の更新条件

以下を満たした時点で「比較可」に更新する。

1. memosにLoCoMo用アダプタを実装し、同一入力/同一評価器で結果JSONを生成できる。
2. `tests/benchmarks/locomo-memos-feasibility.test.ts` が継続的にGreen。
