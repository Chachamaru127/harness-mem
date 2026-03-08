# S39 Risk Notes

## Decision

- Main benchmark gate: GO
- Supplementary shadow pack: not a blocker, but still weak and should drive any next iteration

## Residual Risks

1. Shadow factual questions still confuse `current` vs `previous` state.
2. Sequence/list questions can collapse to the first mentioned item.
3. Cause/why questions can return the actor/entity instead of the reason.
4. `run-locomo-benchmark` health snapshot is taken at startup, so `runtime_health_status=degraded` can appear even on successful warm runs.
5. `bun test` ends with a known Bun crash banner after all tests pass; this is runtime noise, not a detected product failure.

## Why GO is still reasonable

- Product-aligned primary gate is the strict `run-ci` suite, and it now passes all metrics.
- cold/warm observation confirms that silent cold degradation is visible and diagnosable.
- shadow pack is intentionally harder and is being used as a forward-looking backlog, not as the release gate.
