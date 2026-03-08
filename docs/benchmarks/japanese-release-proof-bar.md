# Japanese Release Proof Bar

Last updated: 2026-03-06

This document defines what harness-mem can safely claim about Japanese capability before release.

## 1. Main Gate vs Claim Gate

### Main release gate (ship / no-ship)

Source:
- `memory-server/src/benchmark/results/ci-run-manifest-latest.json`

Measured on 2026-03-06:

| Metric | Value | Meaning |
|---|---:|---|
| LoCoMo F1 | 0.4723 | Main retrieval + answer quality gate |
| Bilingual recall@10 | 0.9000 | EN<->JA retrieval companion metric |
| Freshness | 1.0000 | Current-state questions stay correct |
| Temporal | 0.6889 | Ordering / time reasoning gate |
| Search p95 | 10.29ms | Latency envelope |
| Token avg | 428.93 | Cost / verbosity envelope |

Verdict: `PASS`

### Japanese claim gate (README-safe supplementary evidence)

Source:
- `docs/benchmarks/artifacts/s40-ja-release-latest/summary.md`
- `docs/benchmarks/artifacts/s40-ja-release-latest/repro-report.json`
- `docs/benchmarks/artifacts/s40-ja-release-latest/run1/slice-report.json`

Measured on 2026-03-06 with `japanese-release-pack-32.json`:

| Metric | Value | Meaning |
|---|---:|---|
| Overall F1 mean | 0.7645 | Dedicated Japanese short-answer pack |
| Cross-lingual F1 mean | 0.7563 | Japanese query -> English / mixed evidence |
| Zero-F1 mean | 2 / 32 | Total misses remaining |
| 3-run span | 0.0000 | No run-to-run drift |
| Current slice F1 | 0.8171 | Current vs previous answers |
| Exact slice F1 | 0.7879 | Exact values / short spans |
| Why slice F1 | 0.9008 | Short causal answers |
| List slice F1 | 0.8846 | Compact multi-item answers |
| Temporal slice F1 | 0.5276 | Weakest remaining slice |

Verdict: `PASS as supplementary claim evidence`

## 2. README Claim Contract

### Measured

These are safe to say directly in README / README_ja.

- harness-mem uses a local ONNX retrieval pipeline and passes the primary `run-ci` gate.
- Cross-lingual EN<->JA retrieval is benchmarked.
- Japanese short-answer quality is evaluated on a dedicated 32-QA release pack.
- The dedicated Japanese pack was run 3 times with zero run-to-run drift.
- The strongest Japanese slices today are `why`, `list`, `current`, and `exact`.

### Supplementary

These are safe only when paired with the proof-bar links.

- Japanese current-vs-previous and exact-value questions are substantially improved.
- Japanese queries can retrieve answers from English or mixed evidence.
- README sample answers come from measured artifacts, not hand-picked anecdotes.

### Not guaranteed

Do not claim these.

- Native-level Japanese quality
- Perfect Japanese understanding
- Every temporal question is solved
- Universal best / only option
- Six fully supported platforms

## 3. README-safe sample queries

Use these as examples with artifact links.

| Slice | Query | Expected style |
|---|---|---|
| current | `今、使っている CI は何ですか？` | short exact value |
| why | `email だけの運用をやめた理由は何ですか？` | one short reason |
| list | `Q2 に出した admin 向け機能をすべて挙げてください。` | compact comma-separated list |
| temporal | `最後に出た機能は何ですか？` | single ordered item |

## 4. Residual Risks

Current risks that must remain visible in the copy:

- Temporal is still the weakest Japanese slice.
- A few current-value answers still include extra context instead of the shortest possible span.
- The Japanese proof pack is a release-readiness supplement, not a replacement for `run-ci`.
