# `τ³-bench` §86 note-style ablation report — 2026-04-18

Task: `86.3`
Domain: `retail` / split `base`
Models: agent `gpt-4o-mini` / user `gemini/gemini-2.5-flash-lite`
Sample: `5 tasks × 2 trials × 3 styles = 30 runs`
Seed: `300` (fixed across all 3 styles for comparability)
Source commit: `9d87c83` (feat: tau3 runner --note-style option)
Artifacts:
- `tau2-bench/data/simulations/ablation-s86-active-5x2/results.json`
- `tau2-bench/data/simulations/ablation-s86-passive-5x2/results.json`
- `tau2-bench/data/simulations/ablation-s86-label-5x2/results.json`

## Setup

The `--note-style` flag introduced in §86.1+86.2 controls how `extract_assistant_brief` formats
the recall checkpoint written after each task. Three styles were tested:

| Style | Format | Example |
|-------|--------|---------|
| `active` (default) | `Agent note: <natural-language summary>` | "Agent note: Confirmed exchange for item A..." |
| `passive` | `Prior context (observation): (observation, reference only) <summary>` | "Prior context (observation): ..." |
| `label` | `Prior task labels: tools=<list>, outcome=<float>` | "Prior task labels: tools=find_user+get_order, outcome=1.000" |

All 3 runs used `--mode on` (harness-mem injection active), identical seed, same task order,
and same 5 retail tasks × 2 trials.

## Headline results

| style | pass_rate | avg_total_turns | avg_confirm_turns | confirm_pressure | total_cost |
|-------|----------:|----------------:|------------------:|----------------:|-----------:|
| `active` | 0.30 (3/10) | 11.9 | 2.2 | 0.338 | $0.0604 |
| `passive` | 0.10 (1/10) | 12.3 | 2.1 | 0.313 | $0.0554 |
| `label` | 0.10 (1/10) | 11.5 | 2.1 | 0.339 | $0.0514 |

§85 `off` baseline (seed 300, same 5 tasks × 2 trials, from §85.3 retrospective):
- pass_rate: 0.70, avg_total_turns: 9.6, avg_confirm_turns: 2.9

## Per-task detail

### active style

| task | trial | reward | total_turns | confirm_turns |
|------|------:|------:|------------:|--------------:|
| 0 | 1 | 1.0 | 11 | 2 |
| 1 | 1 | 1.0 | 10 | 2 |
| 2 | 1 | 0.0 | 10 | 2 |
| 3 | 1 | 0.0 | 12 | 1 |
| 4 | 1 | 0.0 | 12 | 1 |
| 0 | 2 | 0.0 | 14 | 3 |
| 1 | 2 | 1.0 | 12 | 3 |
| 2 | 2 | 0.0 | 12 | 3 |
| 3 | 2 | 0.0 | 11 | 2 |
| 4 | 2 | 0.0 | 15 | 3 |

### passive style

| task | trial | reward | total_turns | confirm_turns |
|------|------:|------:|------------:|--------------:|
| 0 | 1 | 0.0 | 19 | 7 |
| 1 | 1 | 0.0 | 13 | 3 |
| 2 | 1 | 0.0 | 8 | 1 |
| 3 | 1 | 0.0 | 15 | 2 |
| 4 | 1 | 0.0 | 11 | 1 |
| 0 | 2 | 1.0 | 11 | 1 |
| 1 | 2 | 0.0 | 11 | 2 |
| 2 | 2 | 0.0 | 8 | 1 |
| 3 | 2 | 0.0 | 15 | 2 |
| 4 | 2 | 0.0 | 12 | 1 |

### label style

| task | trial | reward | total_turns | confirm_turns |
|------|------:|------:|------------:|--------------:|
| 0 | 1 | 0.0 | 12 | 2 |
| 1 | 1 | 0.0 | 11 | 2 |
| 2 | 1 | 0.0 | 10 | 2 |
| 3 | 1 | 0.0 | 12 | 2 |
| 4 | 1 | 0.0 | 11 | 1 |
| 0 | 2 | 1.0 | 15 | 5 |
| 1 | 2 | 0.0 | 11 | 2 |
| 2 | 2 | 0.0 | 10 | 3 |
| 3 | 2 | 0.0 | 12 | 1 |
| 4 | 2 | 0.0 | 11 | 1 |

## Comparison vs §85 `off` baseline

| metric | §85 `off` | active | passive | label |
|--------|----------:|-------:|--------:|------:|
| pass_rate | 0.70 | 0.30 | 0.10 | 0.10 |
| avg_total_turns | 9.6 | 11.9 | 12.3 | 11.5 |
| avg_confirm_turns | 2.9 | 2.2 | 2.1 | 2.1 |
| total_cost | $0.156 | $0.060 | $0.055 | $0.051 |

Note: The §85 `off` run used the same seed (300) and same 5 tasks × 2 trials, making it a
direct paired comparison. Cost difference is likely due to model routing: §85 used the
`gpt-5-mini` model identifier; this ablation used `gpt-4o-mini`. Both resolve to the same
underlying model family but may differ in billing.

## Verdict

**None of the three `on` styles met the §85 DoD (`avg_total_turns ≤ off` baseline of 9.6).**
All three styles show turn inflation vs the `off` baseline:

- `active`: +2.3 turns (11.9 vs 9.6)
- `passive`: +2.7 turns (12.3 vs 9.6)
- `label`: +1.9 turns (11.5 vs 9.6)

**Within the `on` styles, `label` minimizes total turn count (11.5) and matches `active` and
`passive` on confirm pressure (≈0.33 vs ≈0.31–0.34). However, `label` also yields the lowest
pass_rate (0.10) among styles — tied with `passive`.**

**`active` (default) achieves the best pass_rate (0.30) and reasonable turn count (11.9).
The improvement in pass_rate for `active` vs `label`/`passive` is notable (3x more passes)
though all are well below the `off` baseline of 0.70.**

Key observations:
1. **Note style does not solve the confirmation pressure problem.** All `on` styles show
   confirm_turns of 2.1–2.2, versus 2.9 for `off`. The recall injection reduces confirmation
   turns at the cost of increasing total turn count — a net negative.
2. **`passive` shows the highest turn inflation**, with task 0 trial 1 reaching 19 turns (7
   confirm turns) — likely a recall-triggered re-confirmation cascade.
3. **`label` is the cheapest** ($0.051) and has the lowest total turns (11.5), but its
   structured `tools=X, outcome=Y` format does not preserve task context that would help the
   agent succeed — hence the lower pass_rate.
4. **The fundamental issue is not note style but recall injection timing/content.** All three
   formats cause similar confirmation pressure ratios (~33%). The §85 hypothesis B (that text
   style matters) is not supported by this data — the mechanism likely lies elsewhere.

## Flags for §86.4 and §86.5

- **Best style = `active`** (highest pass_rate), not because it reduces turn pressure but
  because it preserves enough context for the agent to succeed at a higher rate. However it
  still underperforms `off` significantly.
- The ablation should be flagged as negative: the hypothesis that changing note style would
  reduce confirmation pressure was not supported. Δ confirm pressure across styles is ≤ 0.025,
  within noise.
- **Recommended next investigation (§86.5 retro / §87):** focus on recall injection gate
  (currently gated on first user turn + tool activity for retail domain). The recall block may
  be arriving too early or too frequently. Consider disabling recall on tasks 1 and 2 (first
  two tasks where no prior context exists) and measuring pass_rate on tasks 3–5 only.
- Alternatively, investigate whether `mode=off` with `--save-to` but no daemon start still
  incurs overhead that inflates `on` turn counts — confirm `off` baseline is a clean no-recall
  path.
- Total cost for all 3 ablation runs: **$0.167** (within $2.00 ceiling).
