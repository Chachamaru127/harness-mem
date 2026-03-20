# Truth Freeze — 2026-03-20

## Gate Definitions (Fixed)

| Gate | Name | DoD | Status | Date |
|------|------|-----|--------|------|
| A | engineering-complete | run-ci 3連PASS + no benchmark hacks + live no-regression | PASSED | 2026-03-20 |
| B | proof-complete | Tier 1 parity + artifact/README aligned | PASSED | 2026-03-20 |
| C | packaging-complete | ADR + license FAQ + README buyer language | PASSED | 2026-03-20 |
| D | market-ready | competitive snapshot + traction proxy measurable | PASSED | 2026-03-20 |

## Current Truth (Dated Artifacts)

### Primary Release Gate
- Source: `ci-run-manifest-latest.json`
- Generated: 2026-03-20T11:39:22.199Z
- F1: 0.5861, Bilingual: 0.90, Freshness: 1.00, Temporal: 0.6403
- Verdict: PASS (3 consecutive runs)

### Japanese Companion Gate
- Source: `docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json`
- Verdict: PASS

### Differentiator Benchmarks
- Cross-Tool Transfer: Recall@10 = 0.60 (floor 0.60)
- Session Resume: Recall@5 = 0.57 (floor 0.50)
- Long-term Memory: Recall@10 = 0.65 (floor 0.50)
- Consolidation Retention: 1.00 (floor 0.80)
- Multi-Project Isolation: Leakage 0.00 (ceiling 0.05)

## Guardrails (Immutable)
- No benchmark-specific code branches or hardcodes
- Japanese companion PASS does not offset main gate FAIL
- No "best/leader/unique/perfect" claims before all gates pass
- BUSL-1.1 changes require stakeholder approval, not engineering-only
