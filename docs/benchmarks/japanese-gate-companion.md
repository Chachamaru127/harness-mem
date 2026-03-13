# Japanese Companion Gate

Last updated: 2026-03-13

This document defines the docs/eval side of `S43-010/011`.

## Scope

- dataset: `tests/benchmarks/fixtures/japanese-release-pack-96.json`
- artifact dir: `docs/benchmarks/artifacts/s43-ja-release-v2-latest/`
- summary JSON: `docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json`
- companion only: main ship gate remains `run-ci`

## Companion checks

1. `summary.json` exists
2. `score-report.json` exists
3. `repro-report.json` exists
4. `failure-backlog.json/.md` exists
5. `risk-notes.md` exists
6. current alias and historical baseline are not mixed
7. copy does not exceed the approved ladder in `japanese-claim-audit.md`

## Rejection signals

- missing artifact
- deprecated alias (`s40-ja-release-latest`) is cited as current source
- missing slice metadata
- overlong answer risk hidden from copy
- `only / unique / native / perfect` used before competitor audit
