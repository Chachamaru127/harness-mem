# S108-006 Temporal Fixture Expansion

- generated_at: 2026-05-07T00:00:00.000Z
- fixture: tests/benchmarks/fixtures/temporal-s108-expanded.json
- cases: 66
- Plans.md edited: no

## Required Focus Counts

| Focus | Count |
| --- | ---: |
| current | 6 |
| previous | 6 |
| after | 6 |
| before | 6 |
| first | 6 |
| latest | 6 |
| still | 6 |
| no_longer | 6 |
| 直後 | 6 |
| 今も | 6 |
| 以前 | 6 |

## Rollup Slices

| Slice | Count | Initial F1 | Zero-F1 | Anchor hit |
| --- | ---: | ---: | ---: | ---: |
| current | 12 | 1.0000 | 0 | 1.0000 |
| ordinal | 6 | 1.0000 | 0 | 1.0000 |
| previous | 12 | 0.9333 | 0 | 0.9167 |
| relative | 18 | 0.9047 | 0 | 0.8889 |
| yes_no | 18 | 0.9444 | 1 | 0.9444 |

## S108-007 Follow-up Gaps

- Persist event_time / observed_at on observations so current and latest do not depend on query-time recency heuristics.
- Add valid_from / valid_to or invalidated_at for no_longer and still so retired facts can be answered without mixing stale and current evidence.
- Represent supersedes links between previous and current values; previous should mean immediate predecessor, while first should stay earliest.
- Store a right_after anchor relation for adjacent events so after and Japanese 直後 do not collapse into generic latest status.
- Keep unknown temporal anchors explicit; S108-007 should avoid silently treating missing timestamps as current.
