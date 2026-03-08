# S39 Cold vs Warm Observation

- generated_at: 2026-03-06T03:23:43.054Z
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
| mean_latency_ms | 1.1317 | 5.5042 | 4.3726 |
| p95_latency_ms | 1.6000 | 6.9310 | 5.3310 |
| mean_token_total | 0.0000 | 394.3333 | 394.3333 |

- quality_regression_count: 0
- latency_improved_count: 0
- run_success_count: 12
- runtime_health_snapshot_statuses: degraded
- runtime_health_snapshot_note: runtime_health_status is read from run-locomo-benchmark's startup snapshot. Successful run completion is the stronger readiness signal here.
- gate_all_passed: true

## Cases

| case | category | cold_f1 | warm_f1 | delta_f1 | cold_ms | warm_ms | delta_ms |
|---|---|---:|---:|---:|---:|---:|---:|
| quick-001/q1 | cat-1 | 0.0000 | 0.6667 | 0.6667 | 1.07 | 6.19 | 5.12 |
| quick-006/q1 | cat-2 | 0.0000 | 1.0000 | 1.0000 | 0.98 | 5.12 | 4.14 |
| quick-011/q1 | cat-3 | 0.0000 | 1.0000 | 1.0000 | 0.99 | 4.93 | 3.94 |
| quick-014/q1 | cat-4 | 0.0000 | 1.0000 | 1.0000 | 1.16 | 5.08 | 3.92 |
| quick-001/q2 | cat-1 | 0.0000 | 1.0000 | 1.0000 | 1.00 | 4.87 | 3.87 |
| quick-006/q2 | cat-2 | 0.0000 | 1.0000 | 1.0000 | 1.06 | 6.29 | 5.23 |
| quick-011/q2 | cat-3 | 0.0000 | 1.0000 | 1.0000 | 1.23 | 4.69 | 3.46 |
| quick-014/q2 | cat-4 | 0.0000 | 0.0000 | 0.0000 | 1.31 | 6.00 | 4.69 |
| quick-001/q3 | cat-1 | 0.0000 | 0.0000 | 0.0000 | 0.97 | 5.07 | 4.10 |
| quick-006/q3 | cat-2 | 0.0000 | 0.3636 | 0.3636 | 1.10 | 5.24 | 4.14 |
| quick-011/q3 | cat-3 | 0.0000 | 0.0000 | 0.0000 | 1.60 | 6.93 | 5.33 |
| quick-014/q3 | cat-4 | 0.0000 | 1.0000 | 1.0000 | 1.11 | 5.64 | 4.53 |

