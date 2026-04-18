# τ³-bench Runbook

Last updated: 2026-04-16

この runbook は、`τ³-bench` を `harness-mem` の商用-safe 外部 benchmark として最初に回すときの最小手順をまとめたものです。  
ここでの狙いは、**text-only の再現性を先に固定し、後から `banking_knowledge` を足せる状態にすること**です。

## 1. 前提

1. 公式 repository は `sierra-research/tau2-bench` です。本文では更新後の呼び名として `τ³-bench` を使います。
2. 公式 repository は `uv` ベースのセットアップを案内しています。
3. 公式 repository は Python `>=3.12, <3.14` を要求しています。
4. API key は `.env` に分離し、`LiteLLM` 経由で provider を差し替えます。

## 2. 最小セット

まずは text-only だけを対象にします。

### 対象

- `airline`
- `retail`
- `telecom`

### 実行サイズ

- 各 domain 10 tasks
- `num_trials = 1`
- `task_split = base`

### 理由

`base` split は、元の τ-bench 構造に揃えた完全セットです。  
最初から全件を回すとコストと確認点が増えるため、`harness-mem` ではまず 3 domain の小さい固定 subset で比較条件を固めます。

## 3. 環境

### インストール

```bash
git clone https://github.com/sierra-research/tau2-bench
cd tau2-bench
uv sync
cp .env.example .env
```

### `.env` で固定するもの

- `agent` 側の API key
- `user simulator` 側の API key
- 使用する provider 名
- 追加の RAG / retrieval 設定があればその接続情報

### 実行時の固定値

- `agent-llm`
- `user-llm`
- `temperature`
- `max_concurrency`
- `timeout`
- `task_ids` または `task_split`

## 4. 実行条件

### 最初の比較

`memory off` と `memory on` の 2 条件だけを比べます。

### 重要な注意

`τ³-bench` の標準 CLI には、`memory off` / `memory on` を直接切り替える専用フラグはありません。  
そのため `harness-mem` 側では、wrapper が `HARNESS_MEM_BENCH_MODE=off|on` を子プロセスに渡し、**custom runner 側でその値を読んで memory injection の有無だけを切り替える**前提で運用します。

言いかえると、標準の `uv run tau2 run ...` をそのまま 2 回回すだけでは、比較としては不十分です。  
比較を成立させるには、以下のどちらかが必要です。

- `HARNESS_MEM_BENCH_MODE` を読む custom runner
- 同等の意味を持つ別の on/off hook

### 固定するもの

- model
- provider
- prompt
- domain
- task split
- task ids
- temperature
- retry policy
- max concurrency
- timeout

### 変えてよいもの

- `harness-mem` の memory injection の有無
- wake-up briefing の有無

この runbook では、それ以外を変えません。

## 5. 記録する指標

最低限、以下を残します。

- `pass^1`
- 平均 turn 数
- 平均 tool call 数
- confirmation / clarification が入った assistant turn 数
- 平均 task duration
- timeout 件数
- failure type の分類
- 1 task あたりの token / cost

`harness-mem` の custom runner では、各 task の `summary.json` に `conversation_metrics` を保存します。  
ここには `total_turn_count`, `assistant_confirmation_turn_count`, `assistant_clarification_turn_count`, `tool_call_count` などが入り、  
run 全体の `results.json` にはその平均値が `conversation_efficiency` としてまとまります。

`pass^4` など複数 trial 指標を後から足す場合も、まずは `pass^1` を基準にして比較します。

## 6. `banking_knowledge` を後段に置く理由

`banking_knowledge` は、text-only に比べて追加の構成要素が増えます。

- retrieval pipeline
- document search
- embeddings
- agentic shell search
- knowledge retrieval の評価軸

このため、先に text-only の再現性を固定しておかないと、memory の効果なのか retrieval の効果なのかが分かれにくくなります。  
したがって、`banking_knowledge` は **Phase 2 以降** に回します。

## 7. 実行の段階

### Phase 1: smoke

- 3 domain の 10 task ずつ
- 同じ task set を memory off / on の 2 条件で回す
- `pass^1` と failure type を確認

### Phase 2: stability

- 同じ task set を複数回実行
- turn 数と tool call 数の分散を見る
- wake-up briefing の有無を比較する

### Phase 3: extension

- `banking_knowledge` を追加
- retrieval pipeline を固定
- text-only との差分を確認する

## 8. 参考

- `τ³-bench` 公式紹介: https://sierra.ai/resources/research/tau-3-bench
- `τ³-bench` repository: https://github.com/sierra-research/tau2-bench
