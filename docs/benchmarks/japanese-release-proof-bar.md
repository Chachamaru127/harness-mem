# Japanese Release Proof Bar

Last updated: 2026-04-10

This document defines what harness-mem can safely claim about Japanese capability after the §49 SSOT remediation.

## 1. SSOT Map

| Role | Source | Status | Notes |
|---|---|---|---|
| Main ship / no-ship gate | `memory-server/src/benchmark/results/ci-run-manifest-latest.json` | current truth | `generated_at=2026-04-10T08:10:51.561Z`, `git_sha=512f027`, verdict `PASS` |
| Current Japanese companion | `docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json` | current truth | `96 QA`, run family is canonicalized to `run1/run2/run3` only |
| Historical Japanese baseline | `docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json` | historical snapshot | `32 QA`, kept only as baseline context |
| Deprecated alias | `docs/benchmarks/artifacts/s40-ja-release-latest/` | deprecated | do not cite this path in README / proof / Plans |

## 2. Main Gate vs Companion Gate

### Main release gate (`run-ci`, ship / no-ship)

Source:
- `memory-server/src/benchmark/results/ci-run-manifest-latest.json`

Current latest run (`onnx`, `git_sha=512f027`):

| Metric | Value | Meaning |
|---|---:|---|
| LoCoMo F1 | 0.5917 | Main retrieval + answer quality gate |
| Bilingual recall@10 | 0.8800 | EN<->JA retrieval companion metric |
| Freshness | 1.0000 | Current-state questions stay correct |
| Temporal | 0.6458 | Ordering / time reasoning gate |
| Search p95 | 13.28ms | Latency envelope |
| Token avg | 427.75 | Cost / verbosity envelope |

Verdict: `PASS`

### Current Japanese companion (`96 QA`, README-safe current claim source)

Source:
- `docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json`
- `docs/benchmarks/artifacts/s43-ja-release-v2-latest/run3/companion-gate.json`

| Metric | Value | Meaning |
|---|---:|---|
| Overall F1 mean | 0.6580 | Dedicated Japanese companion pack |
| Cross-lingual F1 mean | 0.6850 | Japanese query -> English / mixed evidence |
| Zero-F1 count | 16 / 96 | Total misses in the current claim run |
| 3-run span | 0.0000 | No run-to-run drift |
| Current slice F1 | 0.8171 | Current-value answers |
| Exact slice F1 | 0.5628 | Exact values / short spans |
| Why slice F1 | 0.9008 | Short causal answers |
| List slice F1 | 0.7564 | Compact multi-item answers |
| Temporal slice F1 | 0.6776 | Temporal companion slice |

Verdict: `PASS as companion gate`

### Historical baseline (`32 QA`, not current claim source)

Source:
- `docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json`
- `docs/benchmarks/artifacts/s40-ja-baseline-latest/repro-report.json`

| Metric | Value | Meaning |
|---|---:|---|
| Overall F1 mean | 0.8020 | Earlier compact proof bar baseline |
| Cross-lingual F1 mean | 0.7563 | Mixed evidence retrieval baseline |
| Zero-F1 count | 1 / 32 | Remaining misses in the baseline pack |
| 3-run span | 0.0000 | No run-to-run drift |

This baseline is historical context only. It must not be quoted as the current Japanese companion result.

## 3. README Claim Contract

### Safe now

- `Cross-lingual EN<->JA retrieval is benchmarked.`
- `Japanese short-answer quality is evaluated on dedicated release packs.`
- `Primary release gate remains run-ci; the latest current run is passing and the companion proof is separate.`
- `Japanese current / exact / why / list / temporal slices are tracked in the current companion gate.`

### Safe only when paired with this proof bar

- `README sample Japanese queries are artifact-backed.`
- `Current Japanese companion uses the 96-QA pack, while the 32-QA pack is historical baseline only.`
- `Current-vs-previous and relative temporal questions are tracked as watch slices, not hidden.`

### Not guaranteed

- Native-level Japanese quality
- Perfect Japanese understanding
- Every temporal question is solved
- Universal best / only option
- Six fully supported platforms

## 4. README-safe sample queries

| Slice | Query | Expected style |
|---|---|---|
| current | `今、使っている CI は何ですか？` | short exact value |
| why | `email だけの運用をやめた理由は何ですか？` | one short reason |
| list | `Q2 に出した admin 向け機能をすべて挙げてください。` | compact comma-separated list |
| temporal | `最後に出た機能は何ですか？` | single ordered item |

## 5. Residual Risks

- The current main gate is passing, but the adaptive bilingual score still sits below the older `multilingual-e5` baseline and should continue to be tracked.
- `current_vs_previous`, `relative_temporal`, `yes_no`, `entity`, and `location` remain watch slices in the companion artifact.
- The Japanese companion gate is a release-readiness supplement, not a replacement for `run-ci`.
