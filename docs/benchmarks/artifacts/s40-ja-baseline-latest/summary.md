# Japanese Release Pack Summary

- generated_at: 20260312T161446Z
- label: s40-ja-baseline
- dataset: /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/benchmarks/fixtures/japanese-release-pack-32.json
- qa_count: 32
- runs: 3
- overall_f1_mean: 0.8020
- cross_lingual_f1_mean: 0.7563
- zero_f1_mean: 1.00
- overall_f1_span: 0
- search_p95_mean_ms: 13.589999999999998
- token_avg_mean: 357.4375
- current_claim_run: run3
- companion_verdict: pass

## Artifacts

- summary.json
- run1:
  - result.json
  - score-report.json
  - slice-report.json
  - failure-backlog.json / .md
  - risk-notes.md
- run2: same as run1
- run3: same as run1
- repro-report.json

## Notes

- This release pack is the README claim gate supplementary evidence, not a ship/no-ship replacement.
- Main gate remains `run-ci`.
- Current claim copy should reference `summary.json` plus `run3/companion-gate.json`.
