# `τ³-bench` retail multi-task paired compare

Date: 2026-04-17
Task: `84.4`
Domain: `retail`
Task split: `base`
Models:

- agent: `gpt-5-mini`
- user simulator: `gemini/gemini-2.5-flash-lite`

## Run setup

- `off` raw artifact: `.tmp/tau3/harness-mem-off-retail-base-2tasks-2trials-84_4_20260417/results.json`
- `on` raw artifact: `.tmp/tau3/harness-mem-on-retail-base-2tasks-2trials-84_4_20260417/results.json`
- task count: `2`
- trials per task: `2`
- total paired runs: `4`

Runner invocation was executed from the sibling `tau2-bench` checkout, but `--save-to` was pointed back into this repository's `.tmp/` tree so the benchmark artifacts stay local to `harness-mem`.

## Headline

`on` beat `off` on the primary task outcome:

- `off pass_rate = 0.50` (`2 / 4`)
- `on pass_rate = 0.75` (`3 / 4`)
- delta: `+0.25`

This is enough to satisfy the `84.4` DoD as an `on > off` result.

## Efficiency summary

Primary quality improved, but average conversational efficiency did **not** improve in this sample.

| Metric | `off` | `on` | Delta (`on-off`) |
|---|---:|---:|---:|
| pass rate | 0.50 | 0.75 | +0.25 |
| avg total turns | 10.00 | 10.50 | +0.50 |
| avg confirmation turns | 3.00 | 3.25 | +0.25 |
| avg clarification turns | 2.25 | 2.50 | +0.25 |
| total cost (USD) | 0.0621568 | 0.0733134 | +0.0111566 |
| recall items used | 0 | 7 | +7 |

Interpretation:

- `on` improved success rate by rescuing one previously failing run.
- `on` did not reduce average turn count or confirmation pressure across the full 4-run sample.
- this means the memory injection is now helping quality, but not yet compressing the retail conversation consistently.

## Paired row view

| Task | Trial | `off` reward | `on` reward | `off` turns | `on` turns | `off` confirm | `on` confirm | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `0` | 1 | 1.0 | 1.0 | 10 | 8 | 2 | 2 | `on` tied on reward and saved 2 turns |
| `1` | 1 | 0.0 | 1.0 | 10 | 12 | 4 | 4 | `on` converted a fail into a pass |
| `0` | 2 | 1.0 | 1.0 | 8 | 10 | 2 | 3 | `on` tied on reward but got heavier |
| `1` | 2 | 0.0 | 0.0 | 12 | 12 | 4 | 4 | still unresolved in both modes |

## Notes that matter for `84.5`

1. `task 1 / trial 1` is the clear positive example.
   `on` turned a failure into a success, which is why the overall pass rate moved from `0.50` to `0.75`.

2. `task 1 / trial 2` is the main remaining failure.
   This is the best next inspection target if we want another pass-rate gain.

3. `task 0` is now mixed on efficiency.
   One trial got shorter with `on`, another got longer, so the current recall/guidance behavior is not yet stable enough to claim turn compression.

4. `on` runs recorded checkpoint warnings like:
   `write embedding is unavailable: local ONNX model multilingual-e5 requires async prime before sync embed`
   Recall still fired in these runs, so this warning is not a blocker for `84.4`, but it is worth keeping in mind when judging how reliable the write path is between tasks.

## Judgment

For `84.4`, the evidence is now sufficient:

- primary outcome: `on > off`
- efficiency outcome: not yet better overall
- next action: inspect the losing `task 1 / trial 2` path and the mixed `task 0` efficiency regression in `84.5`
