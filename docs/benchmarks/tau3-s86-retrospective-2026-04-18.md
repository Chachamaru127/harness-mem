# `τ³-bench` §86 retrospective — 2026-04-18

Task: `86.5`
Domain: `retail` / split `base`
Models: agent `gpt-4o-mini` / user `gemini/gemini-2.5-flash-lite`
Sample: `5 tasks × 2 trials × 3 styles = 30 runs`
Source artifacts:

- `tau2-bench/data/simulations/ablation-s86-active-5x2/results.json`
- `tau2-bench/data/simulations/ablation-s86-passive-5x2/results.json`
- `tau2-bench/data/simulations/ablation-s86-label-5x2/results.json`
- `docs/benchmarks/tau3-s86-ablation-2026-04-18.md`
- `docs/benchmarks/tau3-improvement-research-brief-2026-04.md`

## ひとことで

§86 の主目標（note style ablation で confirmation pressure の差を検出する）は不支持。
3 style すべてで confirm_pressure の差は ≤ 0.025（ノイズ範囲）であり、文体は圧力の決定因子ではなかった。
加えて §84.4 比での pass_rate 退行（on=0.75→0.30 以下）という新たな問題が顕在化した。
「recall の注入タイミング / ゲート設計」を次の最優先仮説として §87 に渡す。

## 事実整理 (§86 setup recap)

§85 で仮説 A（identity scrub）が no-op と判明した後、次の改善候補として「recall payload に含まれる `Agent note:` の文体が confirmation pressure を左右するか」を検証するために §86 を設計した。
`bench-tau3-runner.py` に `--note-style {active|passive|label}` オプションを追加し（§86.1+86.2）、3 style × 10 runs = 30 runs を実行して比較した（§86.3）。

### Headline results

| style | pass_rate | avg_total_turns | avg_confirm_turns | confirm_pressure | total_cost |
|-------|----------:|----------------:|------------------:|----------------:|-----------:|
| `active` | 0.30 (3/10) | 11.9 | 2.2 | 0.338 | $0.0604 |
| `passive` | 0.10 (1/10) | 12.3 | 2.1 | 0.313 | $0.0554 |
| `label` | 0.10 (1/10) | 11.5 | 2.1 | 0.339 | $0.0514 |
| off baseline (§85.3) | 0.70 (7/10) | 9.6 | 2.9 | — | $0.156 |

### Comparison vs §84.4 (regression flag)

| measurement | §84.4 on | §86.3 active (best on) | §85.3 off |
|-------------|--------:|----------------------:|----------:|
| pass_rate | 0.75 | 0.30 | 0.70 |
| avg_total_turns | — | 11.9 | 9.6 |

**Verdict**: Hypothesis B not supported. Within-on style variation is within noise. All on-modes significantly underperform off baseline.

## 判定

| # | 条件 | 結果 |
|---|------|------|
| DoD #1 | `on` の avg total turns が `off` 以下、または style 間で有意差 | **未達** (最良 active: 11.9 > 9.6; style 間差は ≤ 0.8 turns / ≤ 0.025 confirm_pressure) |
| DoD #2 | pass_rate ≥ §85 水準 (0.70) | **未達** (best active: 0.30 < 0.70) |
| DoD #3 | 各 note style の avg confirm/turn 比率が記録される | **達成** (全 3 style の比率を記録し比較可能な形で保存) |

§86 は **DoD #1/#2 未達** だが、仮説 B の明確な反証と次の調査優先度（gate/timing）が確定したため、学びを記録してクローズする。

## 敗因 / 学び (top 3)

1. **Note format は confirm pressure の決定因子ではなかった**
   3 style 間の confirm_pressure 差は最大 0.026（active 0.338 vs passive 0.313）。これはノイズ範囲であり、文体の変更は confirmation behavior を統計的に動かさなかった。§85 の反証（identity field の不在）と合わせて、「recall の書き方」ではなく「recall の注入タイミングと存在そのもの」がボトルネックである可能性が強まった。

2. **§84.4 から §86.3 への pass_rate 退行が顕在化した**
   §84.4 では on=0.75 / off=0.50（4 runs、seed 未固定）だったが、§86.3 では on∈{0.10, 0.30} / off=0.70（10 runs per condition）という逆転が観測された。同一 fixture / 同一 harness にもかかわらず on-mode が大幅に悪化しており、§85.1 の `--scrub-recall-identity` 実装、§86.1 の `--note-style` 追加、または §86.3 preflight で投入された `audioop` stub のいずれかが recall 注入フローに副作用を持ち込んでいる可能性がある。この退行原因の特定が §87 の第一優先事項となる。

3. **`audioop` stdlib 削除（Python 3.13）は繰り返すインフラ障壁**
   §86.3 preflight で `audioop` が Python 3.13 で削除されており tau2-bench 起動が失敗した。stub を `scripts/bench-tau3-runner.py` に埋め込むことで対処した（commit `b141684`）。今後の runner は自動的にこのスタブを継承するため、同一エラーは再発しない。同種のケース（stdlib 削除系の互換問題）が発生した場合も同じパターン（runner 先頭での条件付き stub 注入）で対応できる。

## §87 seed

§86 の結果は、recall 注入のゲートタイミングと `--scrub-recall-identity` との相互作用を次の調査対象として明確に指示している。§87 は「recall が何回目のターンで、どのトリガー条件で発火するか」を可変にし、first-turn 抑制（タスク 1〜2 では recall を出さない）と mid-task 投入のみのパターンを比較する実験として設計することを提案する。note format の ablation には戻らず、注入ゲート設計の仮説検証に集中する。
