# S39 Final Score Report

- generated_at: 2026-03-06T03:26:36.078Z
- primary_manifest: `memory-server/src/benchmark/results/ci-run-manifest-latest.json`
- status: GO

## Primary Gates

| metric | value | gate | verdict |
|---|---:|---:|---|
| locomo F1 | 0.4602 | >= 0.33 stretch | PASS |
| cat-1 F1 | 0.4303 | >= 0.3245 | PASS |
| cat-2 F1 | 0.4967 | >= 0.20 | PASS |
| cat-3 F1 | 0.4189 | >= 0.24 | PASS |
| bilingual recall | 0.9000 | >= 0.88 | PASS |
| freshness | 1.0000 | >= 0.95 | PASS |
| temporal | 0.6889 | >= 0.56 | PASS |
| paired improvement | mean delta 0.3100 | gate enabled | PASS |
| search p95 | 8.06ms | <= 25ms | PASS |
| token avg | 386.06 | <= 450 | PASS |

## Supporting Artifacts

- cold/warm observation: `docs/benchmarks/artifacts/s39-cold-warm-latest-v2/cold-warm-summary.md`
- shadow pack score: `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/score-report.json`
- shadow backlog: `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/failure-backlog.md`
- risk notes: `docs/benchmarks/artifacts/s39-final-go-2026-03-06/risk-notes.md`
