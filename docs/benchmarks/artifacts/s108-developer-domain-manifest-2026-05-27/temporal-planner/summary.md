# S108-008 Temporal Query Planner Gate

- generated_at: 2026-05-27T07:20:32.810Z
- fixture: tests/benchmarks/fixtures/temporal-s108-expanded.json
- evaluated_cases: 66/66
- overall_passed: yes

| metric | threshold | value | pass |
|---|---:|---:|---|
| temporal order score | 0.70 | 0.7500 | yes |
| Japanese temporal slice hit@10 | 0.72 | 0.7778 | yes |
| current stale answer regressions | 0 | 0 | yes |
| p95 latency ms | n/a | 7.3805 | n/a |

- answer_top1_rate: 0.6970
- answer_hit_at_10: 0.8182
