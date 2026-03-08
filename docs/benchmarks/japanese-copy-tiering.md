# Japanese Copy Tiering

Last updated: 2026-03-07

## Tier 1: Safe now

Use freely in README / LP / X.

- `Cross-lingual EN<->JA retrieval is benchmarked.`
- `Japanese short-answer quality is evaluated on a dedicated release pack.`
- `Primary release gate remains run-ci; Japanese proof is supplementary.`

## Tier 2: Safe after v2 freeze

Use only after `japanese-release-pack-96.json` freeze artifacts exist.

- `Japanese noisy / long-turn / current-vs-previous regressions are tracked in a larger v2 pack.`
- `Japanese current / exact / why / list / temporal / yes-no slices are monitored in a companion gate.`
- `Temporal remains the weakest slice, but it is explicitly tracked as a residual risk.`

## Tier 3: Blocked until competitor audit

- `only option`
- `unique`
- `best in market`
- `native Japanese quality`
- `perfect in Japanese`
