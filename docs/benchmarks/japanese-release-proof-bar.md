# Japanese Release Proof Bar

Last updated: 2026-03-13

This document defines what harness-mem can safely claim about Japanese capability after the §49 SSOT remediation.

## 1. SSOT Map

| Role | Source | Status | Notes |
|---|---|---|---|
| Main ship / no-ship gate | `memory-server/src/benchmark/results/ci-run-manifest-latest.json` | current truth | `generated_at=2026-03-12T17:02:35.532Z`, `git_sha=5c009a9`, verdict `FAIL` |
| Current Japanese companion | `docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json` | current truth | `96 QA`, run family is canonicalized to `run1/run2/run3` only |
| Historical Japanese baseline | `docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json` | historical snapshot | `32 QA`, kept only as baseline context |
| Deprecated alias | `docs/benchmarks/artifacts/s40-ja-release-latest/` | deprecated | do not cite this path in README / proof / Plans |

## 2. Main Gate vs Companion Gate

### Main release gate (`run-ci`, ship / no-ship)

Source:
- `memory-server/src/benchmark/results/ci-run-manifest-latest.json`

Current latest run (`multilingual-e5`, `git_sha=5c009a9`):

| Metric | Value | Meaning |
|---|---:|---|
| LoCoMo F1 | 0.5333 | Main retrieval + answer quality gate |
| Bilingual recall@10 | 0.9000 | EN<->JA retrieval companion metric |
| Freshness | 1.0000 | Current-state questions stay correct |
| Temporal | 0.6403 | Ordering / time reasoning gate |
| Search p95 | 16.99ms | Latency envelope |
| Token avg | 428.93 | Cost / verbosity envelope |

Verdict: `FAIL`

Reason kept visible:
- The latest current run missed the relative temporal regression guard.

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
- `Primary release gate remains run-ci; the latest current run is failing and the companion proof is separate.`
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

- The current main gate is still failing on temporal relative regression.
- `current_vs_previous`, `relative_temporal`, `yes_no`, `entity`, and `location` remain watch slices in the companion artifact.
- The Japanese companion gate is a release-readiness supplement, not a replacement for `run-ci`.
