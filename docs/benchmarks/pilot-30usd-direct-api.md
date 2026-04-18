# 30 USD Direct-API Pilot Runbook

Last updated: 2026-04-16

この runbook は、`harness-mem` の commercial-safe external benchmark を **30 USD 上限の単発パイロット**として始めるための実行パックです。  
ここでの目的は、`τ³-bench` と `SWE-bench Pro` を **直API** で最小比較し、次の予算投下先を決めることです。

この runbook では、次を固定します。

- **direct API** を使う
- **OpenRouter は使わない**
- **OpenCode は使わない**
- `NoLiMa` は使わない
- internal benchmark は既存の主ゲートとして維持する

## 1. 前提

### 接続

- OpenAI: direct API
- Gemini: direct API

### 使う環境変数

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

### 使わないもの

- `OpenRouter`
- `OpenCode`
- `NoLiMa`

### なぜこの前提か

最初のパイロットでは、memory の効果以外の変数をできるだけ減らしたいです。  
OpenRouter を混ぜると routing や provider 層の差分が入りやすく、OpenCode を混ぜると shell / agent layer の差が入りやすくなります。  
今回は **比較条件の分かりやすさ** を優先します。

## 2. モデル構成

### `τ³-bench`

- agent: `gpt-5-mini`
- user simulator: `gemini/gemini-2.5-flash-lite`

### `SWE-bench Pro`

- agent: `gpt-5-mini`

### この構成を採る理由

- `τ³-bench` は agent と simulator の両方にモデル費用が乗るため、simulator 側は安く抑える
- `SWE-bench Pro` は repo 文脈と patch 生成で重くなりやすいため、最初は `gpt-5-mini` で smoke と比較を通す
- 今回の目的は leaderboard ではなく、**memory on/off の差が見えるか**の確認

## 3. 予算配分

| Phase | 内容 | 上限 |
|---|---|---:|
| Phase 0 | dry-run / 環境確認 | 0 USD |
| Phase 1 | `τ³-bench` smoke | 3 USD |
| Phase 2 | `SWE-bench Pro` smoke | 7 USD |
| Phase 3 | `τ³-bench` compare | 8 USD |
| Phase 4 | `SWE-bench Pro` compare | 10 USD |
| Reserve | 再試行 / 失敗 task の最小再確認 | 2 USD |

### ルール

- 合計上限は **30 USD**
- 予備費を使い切ったらその場で打ち切る
- phase をまたいで予算を前借りしない

## 4. 実行順

## Phase 0: Preflight

### 目的

- お金を使う前に設定不備を潰す

### 実行

- `npm run benchmark:tau3:dry-run`
- `npm run benchmark:swebench-pro:dry-run`
- `npm run benchmark:pilot30:dry-run`

### 成功条件

- repo path, provider, runner, mode が想定どおりに表示される
- 使う task set と固定条件を 1 枚のメモにまとめられる

## Phase 1: `τ³-bench` smoke

### 目的

- 一番安く memory on/off の兆候を見る

### 固定条件

- domain: `retail`
- tasks: 5
- trials: 1
- mode: `off` → `on`

### 実行前の注意

`τ³-bench` の公式 CLI 自体には memory on/off の専用フラグがありません。  
したがって、この phase を有料実行する前に、**`HARNESS_MEM_BENCH_MODE=off|on` の値を読んで memory injection の有無だけを切り替える custom runner** か、同等の hook が必要です。

ここが未接続のまま実行すると、`off` と `on` が実質同じ run になり、比較の意味がなくなります。

### 記録するもの

- `pass^1`
- 平均 turn 数
- 平均 tool call 数
- 平均 task duration
- token / cost
- failure type

### 停止条件

- 3 USD を超えそうなら停止
- `off` と `on` で比較条件が揃わないなら停止

## Phase 2: `SWE-bench Pro` smoke

### 目的

- repo-level coding で on/off 比較が成立するか確認する

### 固定条件

- subset: 5 tasks
- mode: `off` → `on`
- runner: `local-docker`
- model: `gpt-5-mini`

### 記録するもの

- pass@1
- patch apply success
- test pass rate
- wall-clock
- token / cost
- failure type

### 停止条件

- 7 USD を超えそうなら停止
- Docker / scaffold 不整合で比較条件が崩れるなら停止

## Phase 3: `τ³-bench` compare

### 目的

- smoke で回った構成を少し広げて再現性を見る

### 固定条件

- domains: `retail`, `airline`, `telecom`
- 各 5 tasks
- trials: 1
- mode: `off` → `on`
- models は Phase 1 と同じ

### 成功条件

- 3 domain で完走
- `on` が `off` より明確に悪化しない
- 8 USD 以内

## Phase 4: `SWE-bench Pro` compare

### 目的

- patch 成果で memory 差分が出るか確認する

### 固定条件

- subset: 8 tasks を基本とする
- 5 task smoke が軽かった場合のみ 10 tasks に拡張してよい
- mode: `off` → `on`
- model: `gpt-5-mini`
- runner は Phase 2 と同じ

### なぜ 8〜10 tasks か

20 tasks は 30 USD 単発パイロットには重すぎます。  
今回は「統計的に固める」より「差分が見えるか」を優先します。

### 成功条件

- on/off の比較表が作れる
- patch apply success と test pass rate が mode ごとに出る
- 10 USD 以内

## 5. 受け入れ基準

このパイロットの完了条件は次です。

1. 合計 30 USD 以内で終わっている
2. `τ³-bench` の smoke と compare の結果がある
3. `SWE-bench Pro` の smoke と compare の結果がある
4. それぞれで `off` / `on` の比較表がある
5. 各比較表に以下が含まれる
   - model
   - provider
   - task set
   - total cost
   - token
   - wall-clock
   - pass 指標

## 6. 次回判断ルール

### `τ³-bench` に増額する条件

- `on` で `pass^1` または効率指標が改善した
- cost が軽く、再実行しやすい
- failure type が memory 改善に寄っている

### `SWE-bench Pro` に増額する条件

- `on` で patch apply または test pass が改善した
- smoke と compare の挙動が安定している

### 保留にする条件

- 差が出ない
- 比較条件が不安定
- 1 task あたりの cost が高すぎる

## 7. 実行メモ

- provider は direct API で固定する
- `OpenRouter` の利用検討は、この 30 USD パイロット完了後に回す
- `OpenCode` の統合比較も、このパイロット完了後に別レーンで行う
