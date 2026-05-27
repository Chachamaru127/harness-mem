# S108-008 Temporal Query Planner Gate

- generated_at: 2026-05-27T09:39:15.558Z
- fixture: tests/benchmarks/fixtures/temporal-s108-expanded.json
- evaluated_cases: 69/69
- overall_passed: yes

| metric | threshold | value | pass |
|---|---:|---:|---|
| temporal order score | 0.70 | 0.8140 | yes |
| Japanese temporal slice hit@10 | 0.72 | 1.0000 | yes |
| current stale answer regressions | 0 | 0 | yes |
| p95 latency ms | n/a | 7.1268 | n/a |

- answer_top1_rate: 0.8986
- answer_hit_at_10: 0.9855
