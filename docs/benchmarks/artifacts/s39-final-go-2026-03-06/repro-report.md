# S39 Repro Report

## Commands

```bash
HARNESS_BENCH_ASSERT_IMPROVEMENT=1 bun run memory-server/src/benchmark/run-ci.ts

bun test memory-server/tests/benchmark/bench-cold-warm-locomo.test.ts
bun run scripts/bench-cold-warm-locomo.ts \
  --dataset tests/benchmarks/fixtures/locomo-15x3.json \
  --limit 12 \
  --output-dir docs/benchmarks/artifacts/s39-cold-warm-latest-v2

bun run tests/benchmarks/run-locomo-benchmark.ts \
  --system harness-mem \
  --dataset tests/benchmarks/fixtures/shadow-query-pack-24.json \
  --output docs/benchmarks/artifacts/s39-shadow-query-pack-latest/result.json

bun run tests/benchmarks/locomo-score-report.ts \
  --result docs/benchmarks/artifacts/s39-shadow-query-pack-latest/result.json \
  --output docs/benchmarks/artifacts/s39-shadow-query-pack-latest/score-report.json

bun run tests/benchmarks/locomo-failure-backlog.ts \
  --result docs/benchmarks/artifacts/s39-shadow-query-pack-latest/result.json \
  --limit 50 \
  --output docs/benchmarks/artifacts/s39-shadow-query-pack-latest/failure-backlog.json \
  --markdown-output docs/benchmarks/artifacts/s39-shadow-query-pack-latest/failure-backlog.md
```

## Expected Outputs

- `memory-server/src/benchmark/results/ci-run-manifest-latest.json`
- `docs/benchmarks/artifacts/s39-cold-warm-latest-v2/cold-warm-summary.json`
- `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/result.json`
- `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/score-report.json`
- `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/failure-backlog.md`
