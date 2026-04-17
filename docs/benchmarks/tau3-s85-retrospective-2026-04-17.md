# `τ³-bench` §85 retrospective — 2026-04-17

Task: `85.5`
Domain: `retail` / split `base`
Models: agent `gpt-5-mini` / user `gemini/gemini-2.5-flash-lite`
Sample: `5 tasks × 2 trials = 10 paired runs`
Source artifacts:

- `.tmp/tau3/harness-mem-off-retail-base-5tasks-2trials-85_3_20260417/results.json`
- `.tmp/tau3/harness-mem-on-scrub-retail-base-5tasks-2trials-85_3_20260417/results.json`
- `docs/benchmarks/tau3-retail-multitask-paired-compare-2026-04-17-v2.md`
- `docs/benchmarks/tau3-improvement-research-brief-2026-04.md`

## ひとことで

§85 の主目標（`on` の avg total turns を `off` 以下にする）は達成できなかった。
しかし「recall payload の identity field を抑制しても scrub 対象が存在しなかった (no-op)」という事実と、
「embedding prime-retry fix は確実に効く」という 2 つの学びを得て閉じる。
次の改善方向 (recall の文体 ablation) が明確になったため、§86 として継続する。

## 事実整理

### Headline

| Metric | `off` | `on (+scrub)` | Δ |
|---|---:|---:|---:|
| pass rate | 0.70 (7/10) | 0.70 (7/10) | 0 |
| avg total turns | 9.6 | 10.0 | +0.4 |
| avg confirm turns | 2.9 | 2.8 | -0.1 |
| avg clarification turns | 2.3 | 2.3 | 0 |
| total cost (USD) | 0.1556 | 0.1636 | +0.008 |
| recall items used | 0 | 14 | +14 |
| scrub replacements | — | 0 | — |
| prime_retry_count / task | — | 1 | — |
| checkpoint warnings | — | 0 | — |

### Paired rows

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

`on` が 2 run を救出し、2 run で退行した。ネット effect は pass_rate delta = 0。

## §85.1 の no-op 解釈

§85.1 は recall payload から `user_id` / `name` / `zip` / `address` を除外または mask する scrub option を実装した。しかし全 10 run で `scrub_recall_identity_replacements = 0` だった。

これは実装ロジックが誤っていたのではなく、**対象フィールドが recall payload に最初から存在しなかった** ためである。recall content の実体は `make_checkpoint_content` が生成する compact summary (`Task ID: ... / Customer scenario: ... / Agent note: ...`) であり、§85.1 の scrub regex が想定した `Name: ...` / `Address: ...` 形式のフィールドラベルはそのフォーマットに含まれていない。

つまり §84 の row 分析で観察された「recall が `get_user_details` 再呼び出しを誘発する」という挙動の原因は、identity フィールドの混入ではなく、**recall note の文体や記述内容そのもの** にある可能性が高い。仮説 A の前提 (「identity フィールドが recall に含まれている」) が間違っていた。

## §85.2 の win 解釈

§85.2 は `bench-tau3-runner.py` の checkpoint write 前に ONNX multilingual-e5 を 1 回 prime する warm-up 呼び出しを追加した。§84.4 では全 4 run で `write embedding is unavailable: local ONNX model multilingual-e5 requires async prime before sync embed` が出ていたが、今回の 10 run では **0 件**。

この修正は benchmark 品質 (pass_rate / turns) には直接影響しないが、**runner の安定性** の改善として確実な価値を持つ。checkpoint warning が消えたことで、後続 benchmark での embedding write degraded が noise 源として混入しなくなった。`prime_retry_count = 1 / task` が全 on タスクで記録されており、fix の動作確認も取れている。

## 判定

| # | 条件 | 結果 |
|---|------|------|
| DoD #1 | `on` の avg total turns が `off` 以下 | **未達** (10.0 > 9.6, Δ = +0.4) |
| DoD #2 | pass_rate ≥ §84 水準 (`on ≥ off`) | **達成** (0.70 = 0.70、§84 の 0.50 水準を維持) |
| DoD #3 | scrub フィールド差分の記録 | **達成** (replacements=0 が全 10 run で記録された) |

§85 は **DoD #1 未達** のため完全達成ではない。ただし仮説 A の反証と次の改善方向 (文体 ablation) が確定したため、学びを記録してクローズする判断が適切である。

## 敗因 / 学び (top 3)

1. **仮説 A が対象を間違えていた**
   §84 の膨張 row 分析から「identity フィールドが recall に混入 → agent が再確認」という仮説を立てたが、recall payload の実体は compact summary であり identity フィールドは最初から存在しなかった。recall の中身を調べる前に「何が入っている」という前提を確認すべきだった。

2. **84.4 の +0.25 は noise だった可能性が高い**
   §84.4 は 4 run (2 tasks × 2 trials) で delta = +0.25 を観測した。今回 10 run に拡大すると delta = 0 になり、2 救出 / 2 退行が対称的に出た。4 run では 1 run の pass/fail が pass_rate を 0.25 動かすため、観測された正の delta がノイズか真のシグナルかを区別できない。小 sample での仮説採択は慎重にすべき。

3. **prime-retry fix はベンチマーク品質ではなく runner 安定性の改善として価値があった**
   §85.2 は turn 数や pass_rate を動かさなかったが、checkpoint warning を完全に消した。benchmark の noise 源を減らすことは「より正確な次回の測定」を可能にするため、間接的に高い価値がある。fix の種類をあらかじめ「品質改善」と「安定性改善」に分けて期待値を設定しておけば、結果の解釈が明確になる。

## 次の最有力仮説 (§86 候補)

### 仮説 B — recall 文体 ablation

**変更点**: `make_checkpoint_content` が生成する `Agent note:` 部分を 3 つの文体パターンに変える:
- `active voice` — 「The agent confirmed product X and applied discount Y」
- `passive voice` — 「Product X was confirmed. Discount Y was applied.」
- `label-only` — 「Selection: X. Discount: Y.」

**期待効果**: 文体によって agent の confirmation pressure (再確認を引き出す度合い) が変わるかを測定する。

**コスト**: runner 側の note template 分岐 1 つ。低リスク。

### 仮説 C — pure no-recall baseline

**変更点**: `off` は現在「recall ON + recall content が空」という状態で動いており、recall 検索そのものは行っている。`recall を完全に無効化した pure no-recall baseline` を計測する。

**期待効果**: `off` の turn 数の floor を測ることで、memory injection のオーバーヘッドを純粋に切り出せる。

**コスト**: runner に `--no-recall` フラグ追加。低リスク。

### 仮説 D — sample 拡大

**変更点**: 10 run でも 2 退行 / 2 救出という分散が残っている。`5 tasks × 3 trials = 15 runs` または `10 tasks × 2 trials = 20 runs` に拡大する。

**期待効果**: 効果サイズの信頼区間が狭まり、delta が noise か真のシグナルかを区別できる。

**コスト**: 1 run 約 100 sec → 追加 ~15〜20 min。中コスト。

## 優先順位

| 順位 | 仮説 | 理由 |
|------|------|------|
| 1 | **仮説 B (文体 ablation)** | §85.1 の反証から「フィールドの有無ではなく文体」が次の最有力な変数として浮上した。実装コストが低く、効果がゼロなら即却下できる |
| 2 | **仮説 C (pure no-recall baseline)** | `off` の baseline 定義が曖昧なままだと比較の基準軸がブレる。floor の計測は一度やれば再利用できる |
| 3 | **仮説 D (sample 拡大)** | 分散を絞るには重要だが、仮説 B の ablation と組み合わせることで効率よく実行できる。単独ではコスト対効果が低い |

## 結論

- §85 Global DoD の主条件 (turn 圧縮) は未達。ただし「次に何を試すか」が明確になったため **§85 はクローズする**
- 副次的な学びとして: identity scrub は対象不在で no-op、§84.4 の +0.25 は noise 圏内、prime-retry fix は runner 安定性として確実な改善
- §86 として **仮説 B (recall 文体 ablation)** を最優先に切る
