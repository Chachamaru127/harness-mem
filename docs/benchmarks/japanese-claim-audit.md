# Japanese Claim Audit v2

Last updated: 2026-03-13

## Approved wording

- `Cross-lingual EN<->JA retrieval is benchmarked.`
- `Japanese short-answer quality is evaluated on dedicated release packs.`
- `Primary release gate remains run-ci; the latest current run is failing and the Japanese proof is supplementary.`
- `Japanese current / exact / why / list / temporal slices are tracked in a dedicated companion gate.`
- `Historical 32-QA baseline and current 96-QA companion are separated on purpose.`

## Rewrite before publishing

- `six platforms`
  - Use: `five supported toolchains plus experimental Antigravity`
- `the only option`
  - Use: `a local-first option designed for multi-tool workflows`
- `Japanese-native`
  - Use: `Japanese short-answer quality is benchmarked`
- `perfect in Japanese`
  - Use: `measured on dedicated Japanese release packs`
- `fully solved in Japanese`
  - Use: `measured slices are current / exact / why / list / temporal, with watch slices still visible`
- `current run passes`
  - Use: `current Japanese companion passes, while the main release gate is currently failing`

## Disallowed claims

- `native Japanese quality`
- `works perfectly in Japanese`
- `every Japanese question is accurate`
- `only option`
- `best in market`
- `fully supports six platforms`
- `the historical 32-QA baseline is the current claim source`

## Deprecated references

- `docs/benchmarks/artifacts/s40-ja-release-latest/`
  - Treat as deprecated alias only. Use `s40-ja-baseline-latest` for historical proof and `s43-ja-release-v2-latest` for the current companion.

See also:
- `docs/benchmarks/japanese-release-proof-bar.md`
- `docs/benchmarks/competitive-analysis-2026-03-13-v10.md`

## Residual-risk wording that must stay visible

- `The latest current main gate is failing on temporal relative regression.`
- `current_vs_previous / relative_temporal / yes_no / entity / location remain watch slices.`
- `Japanese proof remains a companion to run-ci, not a replacement for it.`
