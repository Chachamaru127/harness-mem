# `τ³-bench` retail multi-task paired compare — v2

Date: 2026-04-17
Task: `85.3`
Domain: `retail`
Task split: `base`
Models:

- agent: `gpt-5-mini`
- user simulator: `gemini/gemini-2.5-flash-lite`

This report supersedes the 4-run v1 (§84.4) with a 10-run sample (5 tasks × 2 trials).

## Run setup

- `off` raw artifact: `.tmp/tau3/harness-mem-off-retail-base-5tasks-2trials-85_3_20260417/results.json`
- `on (+scrub)` raw artifact: `.tmp/tau3/harness-mem-on-scrub-retail-base-5tasks-2trials-85_3_20260417/results.json`
- task count: `5`
- trials per task: `2`
- total paired runs: `10`
- `on` mode flag: `--scrub-recall-identity`

Runner invocation was executed from the sibling `tau2-bench` checkout, but `--save-to` was pointed back into this repository's `.tmp/` tree so the benchmark artifacts stay local to `harness-mem`.

## Headline

| Metric | `off` | `on (+scrub)` | Δ |
|---|---:|---:|---:|
| pass rate | 0.70 (7/10) | 0.70 (7/10) | 0 |
| avg total turns | 9.6 | 10.0 | +0.4 |
| avg confirm turns | 2.9 | 2.8 | -0.1 |
| avg clarification turns | 2.3 | 2.3 | 0 |
| total cost (USD) | 0.1556 | 0.1636 | +0.008 |
| recall items used | 0 | 14 | +14 |

`on` did **not** improve pass rate over `off` in this 10-run sample. Memory was injected (14 recall items), but the injection produced no net quality gain and a slight turn overhead (+0.4 avg total turns).

## Paired row view

| task | trial | `off` reward | `on` reward | `off` turns | `on` turns | `off` confirm | `on` confirm | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | 1 | 1.0 | 1.0 | 10 | 10 | 3 | 2 | tie + 確認 -1 ✅ |
| 1 | 1 | 0.0 | 0.0 | 8 | 10 | 3 | 4 | 両方失敗 |
| 2 | 1 | 1.0 | 0.0 | 8 | 6 | 2 | 2 | **on 退行 ❌** |
| 3 | 1 | 1.0 | 1.0 | 10 | 10 | 2 | 1 | tie + 確認 -1 ✅ |
| 4 | 1 | 1.0 | 1.0 | 10 | 10 | 3 | 3 | tie |
| 0 | 2 | 0.0 | 1.0 | 10 | 12 | 4 | 4 | **on 救出 ✅** |
| 1 | 2 | 0.0 | 1.0 | 10 | 8 | 4 | 2 | **on 救出+短縮 ✅** |
| 2 | 2 | 1.0 | 1.0 | 10 | 12 | 3 | 4 | tie だが膨張 |
| 3 | 2 | 1.0 | 0.0 | 10 | 10 | 2 | 2 | **on 退行 ❌** |
| 4 | 2 | 1.0 | 1.0 | 10 | 12 | 3 | 4 | tie だが膨張 |

Summary: `on` rescued 2 runs (`task 0/trial 2`, `task 1/trial 2`) and regressed 2 runs (`task 2/trial 1`, `task 3/trial 2`). Net effect: zero pass-rate delta.

## §85.1 scrub — no-op result

`scrub_recall_identity_replacements` は全 10 run の `on` タスクで **合計 0** だった。

§85.1 が実装したマスク対象 (`user_id` / labeled name / labeled address / 5-digit zip) は、実際の recall payload には **1 つも含まれていなかった**。recall content の実体は `make_checkpoint_content` が生成する compact summary (`Task ID: ... / Customer scenario: ... / Agent note: ...`) であり、§85.1 の scrub regex が想定した `Name: ...` / `Address: ...` 形式のフィールドラベルはそこに存在しない。

つまり §85.1 の実装ロジック自体は正しく動いた (replacement count が正確に計測されている) が、対象がそこに無かったため、機能的には no-op だった。仮説 A (「identity フィールドが recall に混入しており、それが確認ターン増加の原因」) は今回の証拠では支持されない。

## §85.2 prime-retry — checkpoint warning ゼロ達成

`prime_retry_count = 1 / task` が全 10 `on` タスクで記録された。§84.4 では全 4 run で `write embedding is unavailable: local ONNX model multilingual-e5 requires async prime before sync embed` という checkpoint warning が出ていたが、今回は **0 件**。§85.2 の fix が正しく機能し、prime を事前に確立することで警告パスを完全に排除できた。

## DoD 判定

| # | 条件 | 結果 |
|---|------|------|
| DoD #1 | `on` の avg total turns が `off` 以下 | **未達** (10.0 > 9.6) |
| DoD #2 | `pass_rate ≥ §84 水準 (0.50)` | **達成** (0.70 = 0.70) |
| DoD #3 | `scrub フィールド差分の記録` | **達成** (replacements=0 が記録された) |

DoD #1 は未達。`on` は `off` より平均 0.4 ターン多く使っており、turn compression は確認できなかった。

## §84.4 (v1) との比較

§84.4 は 4 run (2 tasks × 2 trials) で `off=0.50`, `on=0.75`, delta=`+0.25` という結果だった。今回 sample を 10 run (5 tasks × 2 trials) に拡大すると delta は `0` になった。

§84.4 の `+0.25` は sample 分散の範囲内だった可能性が高い。4 run という小 sample では 1 run の pass/fail が pass rate を 0.25 動かすため、観測された正の delta がノイズか真のシグナルかを区別できない。今回の 10 run でも delta=0 かつ両方向の退行/救出が同数 (2:2) 確認されたことから、memory injection の効果は現時点では統計的に有意とは言えない。

## 次にやるべきこと (§85 retrospective 用)

1. **recall content の文体を調べる** — scrub の対象フィールドは存在しなかった。次の仮説は「`Agent note:` の動詞・主語の書き方 (recall content の文体) が会話の確認ターン増減に影響している」かどうかを確認すること。フィールド名ではなく assistant note の内容を変えた ablation を設計する。

2. **sample をさらに拡大すべきか検討する** — 10 run でも 2 退行 / 2 救出という分散が残っている。効果サイズの信頼区間を絞るには、さらに task 数または trial 数を増やして最低 20〜30 run を確保する必要があるかどうかを判断する。

3. **別の hypothesis を試す** — 仮説 A (identity scrub) が no-op だったため、仮説 B を立て直す。候補: (a) recall を注入するタイミング (task 開始直後 vs 確認フェーズ前) を変える、(b) recall content の長さを短くする (compact summary をさらに圧縮)、(c) recall を注入しない条件を用意し pure no-recall baseline と比較する。
