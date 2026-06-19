# S154-512 Flip Evidence Checklist

Copy this checklist into Plans.md §154-512 completion notes and record matching
observations in harness-mem when executing the flip (not during P4 prep).

## A. Backfill (154-511) — before flip

- [ ] `verification.json` path: `docs/benchmarks/artifacts/s154-granite-backfill/verification.json`
- [ ] Preflight exit 0: `bun run scripts/s154-granite-flip-preflight.ts`
- [ ] `verification.passed`: true
- [ ] `verification.sqlite_vec_available`: true
- [ ] `verification.sidecar_rows == verification.granite_rows`: ______ / ______
- [ ] `target_observations` (active rows at completion): ______
- [ ] `granite_rows`: ______
- [ ] `embedded_this_run` (final run): ______
- [ ] `elapsed_seconds` / wall-clock (operator): ______ min
- [ ] `throughput_per_s` (from artifact): ______ /s
- [ ] `generated_at` (artifact): ____________________

## B. Pre-flip baseline (D29)

- [ ] Baseline capture path: ____________________
- [ ] Probe fixture version: `s154-512-rollback-probes.v1`
- [ ] Probe count: ______
- [ ] Flag before flip (`embedding_default_model`): ____________________
- [ ] Daemon restart after capture: N/A (read-only)

## C. Flag flip

- [ ] Flip started (ISO 8601): ____________________
- [ ] Operator: ____________________
- [ ] Maintenance window / concurrent writer note: ____________________
- [ ] `s154-granite-flag-set.ts --execute --to granite-embedding-311m-r2@384`
  - [ ] `previous`: ____________________
  - [ ] `next`: `granite-embedding-311m-r2@384`
- [ ] `scripts/harness-memd restart` completed: ____________________
- [ ] Post-flip health vector model: ____________________ (expect `local:granite-embedding-311m-r2`)
- [ ] Registry warnings (if any): ____________________

## D. Non-regression gates (post-flip)

- [ ] `npm run benchmark:developer-domain`
  - [ ] `overall_passed`: true / false
  - [ ] `gates.dev_workflow`: ______
  - [ ] `gates.temporal_order`: ______
  - [ ] `gates.cjk_discrimination`: ______
  - [ ] `gates.flagship_freshness`: ______
- [ ] `bun run scripts/s154-cjk-discrimination-gate.ts --no-write` (optional standalone)
  - [ ] `overall_passed`: true / false
  - [ ] regressed slices: ______ (expect none)

## E. Rollback drill (D29)

- [ ] Rollback executed (ISO 8601): ____________________
- [ ] `s154-granite-flag-set.ts --execute --to multilingual-e5`
  - [ ] `previous`: ____________________
- [ ] `scripts/harness-memd restart` completed: ____________________
- [ ] `s154-embedding-rollback-drill.ts compare` exit code: ______
- [ ] `passed`: true / false
- [ ] `mismatches` count: ______ (expect 0)
- [ ] Compare artifact saved: ____________________

## F. Production restore

- [ ] Re-flip to granite (if drill passed): yes / no
- [ ] Final flag value: ____________________
- [ ] Final flip confirmed (ISO 8601): ____________________

## G. Plans.md / harness-mem record (required text)

When marking 154-512 `cc:完了`, include at minimum:

1. Flip datetime + operator
2. Backfill counts + duration (from verification.json)
3. Preflight authorized: yes/no + artifact `generated_at`
4. `npm run benchmark:developer-domain` → `overall_passed`
5. 154-152 CJK gate → `overall_passed` (or manifest `cjk_discrimination` gate)
6. Rollback drill → `passed: true` + baseline path
7. Residual risks / follow-ups (if any)

### harness-mem checkpoint template

```
Title: S154-512 granite flip + rollback drill
Tags: s154, embedding, granite, rollback-drill, d29

Content:
- Backfill verification: passed=<bool>, granite_rows=<n>, sidecar parity=<bool>, artifact_at=<iso>
- Flip: <iso>, flag granite-embedding-311m-r2@384, restart OK, health model=<str>
- Gates: developer-domain overall_passed=<bool>, cjk overall_passed=<bool>
- Rollback drill: passed=<bool>, baseline=<path>, mismatches=<n>
- Production restored to granite: <yes/no>, final_at=<iso>
```

## H. P4 prep scope (this session)

- [x] Runbook: `docs/benchmarks/s154-512-granite-flip-runbook.md`
- [x] Rollback drill doc: `docs/benchmarks/s154-512-rollback-drill.md`
- [x] Read-only preflight: `scripts/s154-granite-flip-preflight.ts`
- [x] Rollback compare template: `scripts/s154-embedding-rollback-drill.ts`
- [x] Flag setter template: `scripts/s154-granite-flag-set.ts`
- [ ] Live DB touched: **NO** (by design)
- [ ] Flip executed: **NO**
- [ ] Benchmark / rollback drill executed: **NO**
