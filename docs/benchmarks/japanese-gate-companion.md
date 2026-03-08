# Japanese Companion Gate

Last updated: 2026-03-07

This document defines the docs/eval side of `S43-010/011`.

## Scope

- dataset: `tests/benchmarks/fixtures/japanese-release-pack-96.json`
- artifact dir: `docs/benchmarks/artifacts/s43-ja-release-v2-latest/`
- companion only: main ship gate remains `run-ci`

## Companion checks

1. `score-report.json` exists
2. `repro-report.json` exists
3. `failure-backlog.json/.md` exists
4. `risk-notes.md` exists
5. `response_compression` and `temporal_normalization` remain visible in backlog/risk notes
6. copy does not exceed the approved ladder in `japanese-claim-audit.md`

## Rejection signals

- missing artifact
- missing slice metadata
- overlong answer risk hidden from copy
- `only / unique / native / perfect` used before competitor audit
