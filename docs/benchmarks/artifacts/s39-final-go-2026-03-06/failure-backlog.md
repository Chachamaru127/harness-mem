# S39 Failure Backlog Summary

Primary GO is achieved, but shadow-query supplementary evaluation still exposes unresolved weaknesses.

## Hot Spots

- retrieval_alignment: 17 cases
- temporal_normalization: 6 cases
- multi_hop_reasoning: 5 cases
- multi_hop_fact_extraction: 5 cases
- counterfactual_format: 5 cases
- list_structuring: 1 case

## Representative Failures

- `What CI system do I use now?` predicted old state `CircleCI` instead of current state `GitHub Actions`
- `What support window do I use now?` predicted old 24/7 state instead of narrowed weekday window
- `Which feature shipped last?` collapsed a sequence answer to first item `CSV`
- `What made me switch away from CircleCI?` returned entity instead of cause

See the full judged backlog in:
- `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/failure-backlog.md`
- `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/failure-backlog.json`
