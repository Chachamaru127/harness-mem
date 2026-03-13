# Japanese Release Pack Summary

- generated_at: 20260312T161446Z
- label: s43-ja-release-v2
- dataset: /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/benchmarks/fixtures/japanese-release-pack-96.json
- qa_count: 96
- runs: 3
- overall_f1_mean: 0.6580
- cross_lingual_f1_mean: 0.6850
- zero_f1_mean: 16.00
- overall_f1_span: 0
- search_p95_mean_ms: 16.7821530000001
- token_avg_mean: 345.7881944444444
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
