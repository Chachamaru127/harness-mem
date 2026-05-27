# S108-008 Temporal Query Planner Gate

- generated_at: 2026-05-27T09:02:37.395Z
- fixture: tests/benchmarks/fixtures/temporal-s108-expanded.json
- evaluated_cases: 69/69
- overall_passed: yes

| metric | threshold | value | pass |
|---|---:|---:|---|
| temporal order score | 0.70 | 0.7995 | yes |
| Japanese temporal slice hit@10 | 0.72 | 0.8889 | yes |
| current stale answer regressions | 0 | 0 | yes |
| p95 latency ms | n/a | 6.5115 | n/a |

- answer_top1_rate: 0.8116
- answer_hit_at_10: 0.9130
