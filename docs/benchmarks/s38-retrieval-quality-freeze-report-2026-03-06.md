# §38 Retrieval Quality Freeze Report (2026-03-06)

## Scope
- Goal: complete §38 trust-lock + retrieval quality improvements with 3-run freeze validation.
- Method: `/breezing all` with multi-agent implementation (benchmark trust lock, adapter extraction, temporal safety).

## Implemented
1. Trust Lock
- ONNX-only enforced across benchmark runners (`run-ci`, `run-locomo-benchmark`, `freshness-cv`, `jaccard-cv`, `retrospective-eval`).
- Baseline/fixture strict checks hardened (missing/parse error => fail-fast).
- Panic marker invalidation and run manifest history output.
- `scripts/bench-freeze-locomo.sh` added for 3-run freeze + panic/fallback detection + summary JSON.

2. Retrieval / Answering
- Removed hard category forcing (`cat-2=>temporal`, `cat-3=>multi-hop`) in LoCoMo adapter.
- Added slot-first extraction heuristics (numeric/entity/language cues).
- Added question-aware rerank signals for intent-bearing questions.

3. Temporal / Safety
- Temporal two-stage rerank now guarded by explicit temporal intent + confidence.
- Boundary/leak assertions strengthened in integration and contract tests.

## Validation Results
- Targeted tests: 115 pass / 0 fail.
- `run-ci`: PASS.
- 3-run freeze: PASS (all runs identical, no panic/fallback).

### Freeze Summary
Source: `memory-server/src/benchmark/results/freeze-summary-20260305T182615Z.json`

- locomo F1 mean/min/max: `0.3147 / 0.3147 / 0.3147`
- cat-2 F1 mean: `0.2859`
- cat-3 F1 mean: `0.3189`
- bilingual mean: `0.9000`
- freshness mean: `0.9600`
- temporal mean: `0.5667`
- panic_or_fallback_detected: `false`

## GO / No-GO Evaluation
- GO checks:
  - overall F1 >= 0.30: PASS (`0.3147`)
  - bilingual >= 0.88: PASS (`0.9000`)
  - Freshness >= 0.95: PASS (`0.9600`)
  - temporal tau/order >= 0.56: PASS (`0.5667`)
  - panic/fallback/leak_count: PASS (detected 0 in freeze + boundary tests)

- No-GO triggers: none observed in this freeze run.

## Notes
- `Layer 3 Wilcoxon` remains skipped unless `HARNESS_BENCH_ASSERT_IMPROVEMENT=1` is set.
- Freeze artifacts are generated under `memory-server/src/benchmark/results/`.
