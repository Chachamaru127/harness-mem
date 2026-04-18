# 商用-safe benchmark portfolio

Last updated: 2026-04-16

この文書は、`harness-mem` で商用利用の可能性がある場合に、最初にどの benchmark をどの区分で扱うかを固定するための方針メモです。  
ここでの目的は「強い benchmark を増やすこと」ではなく、**商用可否・公開可否・実行頻度・役割を分けて、評価条件のブレを防ぐこと**です。

## 1. 区分

| 区分 | 候補 | 商用可否 | 公開可否 | 実行頻度 | 役割 |
|---|---|---|---|---|---|
| Internal | 既存の developer-workflow / bilingual / freshness / temporal gate | 可 | 可 | 毎 PR / nightly | `harness-mem` の主ゲート。製品の中心価値を直接測る |
| External | `τ³-bench` text-only base split (`airline` / `retail` / `telecom`) | 可 | 可 | 週次 / release candidate | 会話型 agent と tool use、状態遷移、policy 順守の補助検証 |
| External | `τ³-bench` `banking_knowledge` | 可 | 可 | 月次 / 重要変更時 | retrieval を含む knowledge work の補助検証。text-only が安定してから後段で使う |
| External | `SWE-bench Pro` public subset の memory on/off 比較 | 可 | 可 | 週次 / 重要変更時 | memory が repo-level coding 成果に効くかを確認する出口評価 |
| Research-only | `NoLiMa` | 不可 | 研究文脈のみ可 | 内部研究のみ | 長文・言い換え耐性の参考値。ただし商用 benchmark の外側に置く |

## 2. ここでの基本方針

1. **Internal が主ゲート** です。外部 benchmark は主ゲートを置き換えません。
2. **External は commercial-safe のみ** を採用します。商用可否が曖昧なものは release claim に使いません。
3. **Research-only は分離** します。研究価値があっても、商用ラインと同列に置きません。
4. **比較条件は固定** します。モデル、プロンプト、task split、temperature、tool policy、timeout、retry policy は run ごとに揺らさない前提です。

## 3. NoLiMa を research-only に置く理由

NoLiMa の公式 repository では、evaluation code と needle set data が Adobe Research License の下にあり、**commercial use が禁止**されています。  
そのため、`harness-mem` では NoLiMa を「参考になるが、商用-safe portfolio には入れない benchmark」として扱います。

この扱いにすると、次の2点を避けられます。

1. ライセンス境界の取り違え
2. 研究向けの比較値を、商用向けの README や release claim に混ぜること

## 4. 推奨の最初の並び

1. `τ³-bench` text-only base split を先に固定する
2. `SWE-bench Pro` public subset の on/off 比較を次に置く
3. `banking_knowledge` は text-only が安定してから追加する
4. `NoLiMa` は別レーンの research benchmark として保持する

## 5. 運用メモ

- 外部 benchmark の結果は、**商用-safe であること**と、**どの runbook に基づくか**をセットで記録します。
- `τ³-bench` と `SWE-bench Pro` は、同じ「外部」でも役割が違います。前者は対話・状態遷移・tool use、後者は最終成果としての patch 作成です。
- `NoLiMa` は有用でも、商用向けの最初の benchmark ポートフォリオに入れないほうが安全です。
- 30 USD の単発立ち上げをしたい場合は、[`pilot-30usd-direct-api.md`](./pilot-30usd-direct-api.md) を実行パックとして使います。

## 6. 参考

- `τ³-bench` 公式紹介: https://sierra.ai/resources/research/tau-3-bench
- `τ³-bench` repository: https://github.com/sierra-research/tau2-bench
- `NoLiMa` repository: https://github.com/adobe-research/NoLiMa
- `SWE-bench Pro` repository: https://github.com/scaleapi/SWE-bench_Pro-os
- `SWE-bench Pro` public leaderboard: https://scaleapi.github.io/SWE-bench_Pro-os/
