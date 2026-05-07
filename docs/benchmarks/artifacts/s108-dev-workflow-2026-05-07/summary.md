# S108 Developer Workflow Fixture Expansion

- task_id: S108-002
- generated_at: 2026-05-07T01:48:13.247Z
- fixture: tests/benchmarks/fixtures/dev-workflow-60.json
- fixture_sha256: 12d2009057fb1c3e55364eb7c072e5041705ef9db456d6da372b6cc53ea196a1
- qa_count: 64
- base_subset: 20 cases from tests/benchmarks/fixtures/dev-workflow-20.json
- backward_comparison: 20/20 exact base cases preserved

## Category Distribution

| query_family | total_cases | new_cases |
|---|---:|---:|
| file | 6 | 4 |
| branch | 4 | 4 |
| pr | 6 | 4 |
| issue | 7 | 4 |
| migration | 6 | 4 |
| deploy | 4 | 4 |
| failing_test | 9 | 4 |
| release | 6 | 4 |
| setup | 8 | 4 |
| doctor | 4 | 4 |
| companion | 4 | 4 |

## Notes

- The first 20 cases are copied from dev-workflow-20 without object-level changes.
- New cases cover file, branch, PR, issue, migration, deploy, failing test, release, setup, doctor, and companion query families.
- This task writes only developer-workflow fixture and artifact surfaces; temporal fixtures, competitive audit docs, and Plans.md are intentionally untouched.
