# Japanese Claim Audit v2

Last updated: 2026-03-07

## Approved wording

- `Cross-lingual EN<->JA retrieval is benchmarked.`
- `Japanese short-answer quality is evaluated on a dedicated release pack.`
- `Primary release gate remains run-ci; Japanese proof is supplementary.`
- `Temporal is currently the weakest Japanese slice.`
- `A larger v2 Japanese release pack tracks noisy, long-turn, and current-vs-previous regressions.`

## Approved only after v2 freeze passes

- `Japanese current / exact / why / list / temporal / yes-no slices are tracked in a dedicated companion gate.`
- `Japanese noisy and long-turn regressions are measured on a larger v2 release pack.`
- `Copy is tiered by measured / supplementary / blocked evidence.`

## Rewrite before publishing

- `six platforms`
  - Use: `five supported toolchains plus experimental Antigravity`
- `the only option`
  - Use: `a local-first option designed for multi-tool workflows`
- `Japanese-native`
  - Use: `Japanese short-answer quality is benchmarked`
- `perfect in Japanese`
  - Use: `measured on a dedicated Japanese release pack`
- `fully solved in Japanese`
  - Use: `measured slices are current / exact / why / list / temporal / yes-no`

## Disallowed claims

- `native Japanese quality`
- `works perfectly in Japanese`
- `every Japanese question is accurate`
- `only option`
- `best in market`
- `fully supports six platforms`

See also:
- `docs/benchmarks/competitive-audit-2026-03-07.md`

## Residual-risk wording that must stay visible

- `Temporal is still the weakest slice.`
- `Some current-value answers still need shorter spans.`
- `Japanese proof remains a companion to run-ci, not a replacement for it.`
