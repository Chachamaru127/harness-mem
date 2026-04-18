# Embedding Reproducibility — Lockfile Pinning Rationale

**Task**: §77 / §78-A03 | **Date**: 2026-04-18

## Background

During v0.11.0 release preparation, two retrieval quality regressions were detected:

- `multi-project-isolation.test.ts` (S56-005): Alpha own-content Recall@10 dropped 0.6 → 0.4 (−33%)
- `ci-run-manifest-latest.json`: `bilingual_recall` dropped 0.90 → 0.88 (−2%)

Both regressions occurred between 2026-03-20 and 2026-04-10. The `memory-server/src/` code and benchmark fixtures were confirmed to have zero diffs in this window. The leading hypothesis: `@huggingface/transformers` version drift between installs.

## Root Cause

`package.json` and `memory-server/package.json` specified `"^3.8.1"` (caret range). npm/bun honors the range by resolving to the latest compatible version at install time. If a 3.8.x or 3.9.x patch was published and pulled in, embedding model weights, tokenizer logic, or ONNX runtime bindings could produce subtly different vectors — causing score drift without any code change.

The `package-lock.json` was already resolving to `3.8.1.tgz` at the time of diagnosis, meaning drift likely occurred in a prior `bun install` cycle that predated the lockfile snapshot.

## Fix (S77-001)

Changed version specifier from `"^3.8.1"` to `"3.8.1"` (exact pin) in:

- `package.json` (root)
- `memory-server/package.json`
- `package-lock.json` (packages root entry)
- `bun.lock` (workspace root entry)

The resolved tarball `transformers-3.8.1.tgz` in `package-lock.json` was already correct and unchanged.

### Verification

```bash
bash scripts/check-transformers-version.sh
# Expected: [transformers-pin] OK: @huggingface/transformers@3.8.1 (pinned)

npm ci
bash scripts/check-transformers-version.sh

# or with bun:
bun install --frozen-lockfile
bash scripts/check-transformers-version.sh
```

Run twice to confirm identical embedding output. No rebuild of ONNX weights is required — the lockfile pins to the same tgz that was already installed.

## Ongoing Guard

`scripts/check-transformers-version.sh` can be wired as a `postinstall` script if a stricter enforcement policy is desired. Currently it is manual / CI-callable.

## Related

- S77-002: Apple M1 vs Linux x64 embedding determinism plan → `docs/benchmarks/embedding-determinism-plan-2026-04-18.md`
- S77-003: multi-project-isolation re-enable → `tests/benchmarks/multi-project-isolation.test.ts`
- S77-004: bilingual baseline decision → `docs/benchmarks/bilingual-baseline-2026-04-18.md`
