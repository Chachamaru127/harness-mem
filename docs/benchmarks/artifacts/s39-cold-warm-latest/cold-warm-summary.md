# S39 Cold vs Warm Observation

- generated_at: 2026-03-06T03:22:38.872Z
- source_dataset: /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/benchmarks/fixtures/locomo-15x3.json
- selected_case_count: 12

## Method

- isolation: Each case runs in a fresh temp DB with exactly one QA, so first-query latency is measured without later-query cache dilution.
- cold_ready: Fresh core, readiness satisfied, prime_embedding_enabled=false. This captures first real query after startup readiness without question-specific priming.
- warm_ready: Fresh core, readiness satisfied, prime_embedding_enabled=true. This captures startup + question/corpus priming together on the same single-QA case.
- selection: Round-robin across categories from locomo-15x3.json with limit=12.

## Aggregate

| metric | cold | warm | delta(warm-cold) |
|---|---:|---:|---:|
| mean_f1 | 0.0000 | 0.6692 | 0.6692 |
| mean_latency_ms | 1.1342 | 5.5885 | 4.4543 |
| p95_latency_ms | 1.3400 | 7.4300 | 6.0900 |
| mean_token_total | 0.0000 | 394.3333 | 394.3333 |

- quality_regression_count: 0
- latency_improved_count: 0
- readiness_all_green: false
- gate_all_passed: true

## Cases

| case | category | cold_f1 | warm_f1 | delta_f1 | cold_ms | warm_ms | delta_ms |
|---|---|---:|---:|---:|---:|---:|---:|
| quick-001/q1 | cat-1 | 0.0000 | 0.6667 | 0.6667 | 1.09 | 5.47 | 4.38 |
| quick-006/q1 | cat-2 | 0.0000 | 1.0000 | 1.0000 | 0.98 | 5.22 | 4.24 |
| quick-011/q1 | cat-3 | 0.0000 | 1.0000 | 1.0000 | 1.34 | 5.25 | 3.91 |
| quick-014/q1 | cat-4 | 0.0000 | 1.0000 | 1.0000 | 1.21 | 5.32 | 4.11 |
| quick-001/q2 | cat-1 | 0.0000 | 1.0000 | 1.0000 | 1.15 | 4.31 | 3.16 |
| quick-006/q2 | cat-2 | 0.0000 | 1.0000 | 1.0000 | 0.98 | 5.48 | 4.50 |
| quick-011/q2 | cat-3 | 0.0000 | 1.0000 | 1.0000 | 1.07 | 6.01 | 4.94 |
| quick-014/q2 | cat-4 | 0.0000 | 0.0000 | 0.0000 | 1.19 | 5.95 | 4.76 |
| quick-001/q3 | cat-1 | 0.0000 | 0.0000 | 0.0000 | 1.16 | 4.53 | 3.37 |
| quick-006/q3 | cat-2 | 0.0000 | 0.3636 | 0.3636 | 1.04 | 5.45 | 4.41 |
| quick-011/q3 | cat-3 | 0.0000 | 0.0000 | 0.0000 | 1.09 | 6.64 | 5.55 |
| quick-014/q3 | cat-4 | 0.0000 | 1.0000 | 1.0000 | 1.31 | 7.43 | 6.12 |

