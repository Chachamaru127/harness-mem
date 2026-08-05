# Bilingual-50 — S156-FU13 determination (2026-08-05)

Status: closes S156-FU13. Corrects the reasoning in
`bilingual-baseline-2026-07-07.md`; does not change the gate value.

## Question

Whether `bilingual-50 recall@10 = 0.82` (down from `0.86` after the
`segmentJapaneseForFts` change in `s154-152`) reflects a genuine retrieval-quality
loss, or only the granularity of a 50-sample fixture.

## Determination

**The fixture cannot distinguish the two values.** A fresh run reports:

```
[CI] bilingual-50 recall@10: 0.8200 (threshold: 0.8)
[CI] bilingual-50 95% Bootstrap CI: [0.7100, 0.9200] (method: bootstrap)
```

The 95% confidence interval spans 0.21 recall. The entire 0.86 → 0.82 move sits
well inside it. At n=50 each sample is worth 0.02, so the observed change is two
samples against a measurement whose own uncertainty is roughly ±0.10.

This does not mean the change was noise — the report from 2026-07-07 correctly
established that the shift is deterministic and reproduces identically on macOS
and Linux. Both facts hold at once: the ranking change is real and repeatable,
and the fixture lacks the resolution to say whether it made retrieval worse.

Treating 0.82 as the floor is therefore the right call, but "0.86 → 0.82 is a
small quality loss" is not a claim this fixture supports in either direction.

## Correction to the 2026-07-07 rationale

That report justified accepting 0.82 partly on this basis:

> the authoritative Japanese / bilingual quality gates stay green on the same
> release run: developer-domain reconciliation bilingual recall@10 = `0.90`

and stated that the developer-domain floor is

> evaluated against the reconciled developer-domain bilingual metric (`0.90`),
> not the run-ci bilingual-50 fixture.

**Both statements are incorrect.** There is no independent developer-domain
bilingual measurement. `scripts/s108-developer-domain-manifest.ts` sets both
manifest fields from the same value:

- line 290 — `bilingual_recall_at_10: codeToken.gates.bilingual_recall_at_10.value`
- line 333 — `bilingual_recall: report.metrics.bilingual_recall_at_10`

and `scripts/s108-code-token-tuning.ts` sources that value from the run-ci
bilingual-50 measurement. The threshold file's own comment says so directly:
"the reconciliation reads run-ci's bilingual-50, so this floor must match
s108-code-token-tuning's BILINGUAL_RECALL_GATE".

The `0.90` cited as the independent guard was the value sitting in
`ci-run-manifest-latest.json`, which had not been regenerated since 2026-05-27 —
before the change under discussion. It was the stale figure, not a second
opinion. The same stale figure was published in the README until v0.29.6.

The reasoning was circular: 0.82 was accepted because a separate metric read
0.90, but that metric is derived from the 0.82.

## What still supports the acceptance

Removing the phantom guard does not overturn the decision. Two genuinely
independent gates were green on the same run and remain so:

- CJK discrimination min top-1 = `1.00`, stale-answer regressions = `0`
- flagship freshness@k = `0.99` (threshold `0.95`)

Neither derives from bilingual-50. The Layer 1 floor (`>= 0.80`) is also still met.

## Follow-up

If a sharper answer is wanted, the fixture needs enough samples for its
confidence interval to be narrower than the effects being judged — the same
treatment planned for S56-003 under S156-FU10. Until then, bilingual-50 should
be read as a coarse tripwire, not as a quality measurement precise enough to
adjudicate two-sample moves.

## Reproduction

```bash
cd memory-server && bun run src/benchmark/run-ci.ts --verbose
```

Note that this run overwrites `ci-run-manifest-latest.json`,
`ci-score-history.json` and `locomo-120-latest.json` as a side effect, including
rewriting fixture paths to the local checkout and replacing the reconciled
`temporal` value with run-ci's own (different) temporal metric. Revert those
three files after a diagnostic run.
