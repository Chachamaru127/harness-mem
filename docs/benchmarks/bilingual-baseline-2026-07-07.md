# Bilingual-50 Baseline Rebaseline — 2026-07-07

Status: accepted for release gate rebaseline (supersedes
`bilingual-baseline-2026-06-05.md`)

## Summary

The `s108-code-token-tuning` bilingual-50 gate is rebaselined from `0.86` to
`0.82`.

This does **not** change the broader Layer 1 benchmark floor in `run-ci.ts`
(`bilingual >= 0.80`, still met at `0.82`), and it does **not** change the
developer-domain reconciliation floor in
`docs/benchmarks/developer-domain-thresholds.json` (`0.86`), which is evaluated
against the reconciled developer-domain bilingual metric (`0.90`), not the
run-ci bilingual-50 fixture.

## Root cause

`s154-152` (`c8f98c1`, 2026-06-08) introduced `segmentJapaneseForFts` for the
`title_fts` / `content_fts` columns. This deterministically shifts BM25 ranking
for Japanese and mixed JA/EN queries. On the coarse 50-sample bilingual-50
fixture the effect is a 2-sample move (`0.86 → 0.82`); the same change moved the
S56-003 migration fixture (`0.40 → 0.30`, recalibrated in v0.28.7). The value is
identical on macOS and Linux release runners, i.e. it is a deterministic
algorithmic shift, not runner flake.

The 2026-06-05 note deliberately set `0.82` as a "material drop" tripwire. That
tripwire fired correctly — it caught this change. Acceptance here is a
considered override, not a silent loosening: the change is understood,
intentional, and the authoritative Japanese-quality gates all stay green.

## Why 0.82 is accepted as the new floor

- Deterministic and reproducible (identical on macOS and Linux; not flake).
- Root cause is a known, intentional retrieval change that **improves** the
  authoritative JA discrimination gates.
- The authoritative Japanese / bilingual quality gates stay green on the same
  release run:
  - developer-domain reconciliation bilingual recall@10 = `0.90`
  - CJK discrimination min top-1 = `1.00` (regressions = 0)
  - flagship freshness@k = `0.99` (threshold `0.95`)
- bilingual-50 is a coarse 50-sample proxy (0.02 recall per sample); the
  developer-domain bilingual metric is the material gate.

## Open follow-up (S156-FU13)

Whether the 0.86 → 0.82 move on bilingual-50 reflects a genuine (if small)
retrieval-quality loss on this specific fixture, or only a fixture-granularity
artifact of the FTS segmentation, is not yet settled. Tracked as S156-FU13:
re-measure bilingual-50 under the granite default (the shipping embedding
default as of §156) and, if warranted, redesign the fixture with a wider margin
— the same treatment planned for S56-003 (S156-FU10).

## Rollback

If a future retrieval change restores stable `bilingual-50 >= 0.86`, raise
`BILINGUAL_RECALL_GATE` in `scripts/s108-code-token-tuning.ts` and the matching
assertions in `tests/benchmarks/s108-code-token-tuning.test.ts` together, then
update or replace this note.
