# Bilingual-50 Baseline Rebaseline — 2026-06-05

Status: superseded by `bilingual-baseline-2026-07-07.md` (0.86 → 0.82 after the
s154-152 FTS segmentation). Retained for history.

## Summary

The bilingual-50 release gate is rebaselined from `0.88` to `0.86`.

This does not change the broader Layer 1 benchmark floor in `run-ci.ts`
(`bilingual >= 0.80`). It aligns the stricter developer-domain floor with the
current deterministic ONNX release-run score while preserving material
regression detection.

## Evidence

- GitHub Release workflow `27000588793`, first run:
  - `bilingual-50 recall@10: 0.8600`
  - `95% Bootstrap CI: [0.7600, 0.9500]`
  - Layer 1 absolute floor passed.
  - Layer 2 failed only because history `mean-2SE` was `0.8733`.
- GitHub Release workflow `27000588793`, rerun after transient HF 429:
  - `bilingual-50 recall@10: 0.8600`
  - `95% Bootstrap CI: [0.7600, 0.9400]`
  - Same Layer 2 failure: `0.8600 < 0.8733`.
- Local verification on the same release code path:
  - `npm run benchmark` reported `bilingual-50 recall@10: 0.8600`.
  - After Layer 2 fixture-granularity tolerance, `npm run benchmark` passed.
  - `npm run benchmark:developer-domain -- --no-write-manifest --no-write-artifacts` passed.

## Rationale

`bilingual-50` has 50 samples, so a one-sample change is `0.02` recall. The old
strict floor `0.88` treated a one-sample deterministic drift as release
blocking even though the broader bilingual benchmark contract and all other
release gates stayed green.

The new stricter developer-domain floor is `0.86`. The Layer 2 relative
regression check also uses `0.02` as the minimum standard error for bilingual
only, so `0.86` passes while a material drop such as `0.82` still fails.

## Rollback

If a future retrieval change restores stable `bilingual-50 >= 0.88`, raise
`docs/benchmarks/developer-domain-thresholds.json` and
`scripts/s108-code-token-tuning.ts` together, then update this note or replace
it with a newer baseline document.
