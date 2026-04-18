# SWE-bench Pro Memory Ablation Runbook

Last updated: 2026-04-16

この文書は、`SWE-bench Pro` を使って `harness-mem` の memory on/off 比較を行うための最小 runbook です。  
ここでの目的は、**memory を入れたことで patch 作成と最終評価が本当に改善するか**を、同一条件で確認することです。

## 1. 前提

1. 公式 repository は `scaleapi/SWE-bench_Pro-os` です。
2. 公式 repository は Docker ベースの再現実行を案内しています。
3. Modal が推奨で、local Docker は beta として使えます。
4. local モデルを使う場合は `vllm` もサポートされています。

## 2. 最小セット

まずは public subset を小さく固定します。

### 実行サイズ

- public subset 20 tasks
- 同じ 20 tasks を memory off / on の 2 条件で回す

### ねらい

最初から全件比較にすると、patch 生成・Docker 起動・評価のいずれが効いたのか分かりにくくなります。  
20 tasks の固定 subset で、memory の有無だけを見るほうが比較しやすいです。

## 3. 環境

### 公式前提

```bash
pip install -r requirements.txt
docker --version
modal setup
```

### 実行形態

- **Modal**: 公式推奨。最初の比較に向く
- **local Docker beta**: 追加セットアップを減らしたいときの代替
- **local vLLM**: ローカルモデルを使うときの選択肢

### Docker image

各 instance の `dockerhub_tag` を使います。  
同じ instance には同じ image を使い、memory on/off で image を変えません。

## 4. 固定する条件

memory 以外は固定します。

- model
- scaffold
- system prompt
- tools
- max steps
- timeout
- Docker image
- retry policy
- evaluation script version
- patch gather 方法

`memory on/off` で変えるのは、`harness-mem` 由来の briefing と検索注入だけです。

## 5. 記録する指標

最低限、以下を残します。

- pass@1
- patch apply success
- test pass rate
- 1 task あたりの wall-clock time
- 1 task あたりの token / cost
- failure type の分類

必要なら、`repo` ごとの集計と、`memory on/off` の差分を別表で残します。

## 6. 実行段階

### Phase 1: smoke

- 5 tasks
- Modal か local Docker beta のどちらか 1 つ
- 同じ task set を memory off / on の 2 条件で回す

### Phase 2: comparison

- public subset 20 tasks
- 同一条件で memory on/off を回す
- patch 成功率と test pass rate を比較する

### Phase 3: stabilization

- 同じ subset を再実行
- 変動が大きい task を抽出する
- release candidate で再確認する

## 7. 公式 leaderboard との関係

この runbook は、公式 leaderboard に提出するためのものではありません。  
`harness-mem` の memory が **最終的な patch 成果に効くか**を確認するための、内部比較用です。

## 8. 参考

- `SWE-bench Pro` repository: https://github.com/scaleapi/SWE-bench_Pro-os
- `SWE-bench Pro` public leaderboard: https://scaleapi.github.io/SWE-bench_Pro-os/
