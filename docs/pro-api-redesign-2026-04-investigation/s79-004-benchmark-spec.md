# S79-004: Free vs Pro Benchmark Spec

**Status**: design | **Date**: 2026-04-11 | **Branch**: `feature/pro-japanese-differentiation`

## 1. Current benchmark (Free baseline)

The single entrypoint is `memory-server/src/benchmark/run-ci.ts` (1772 LOC), invoked by the npm script `"benchmark"` defined at `package.json:61` (`cd memory-server && bun run src/benchmark/run-ci.ts`). It runs LoCoMo-120, bilingual-50, knowledge-update-100, temporal-100-v2, dev-workflow-20 through `HarnessMemCore` using one shared `BenchEmbeddingProfile` (`run-ci.ts:538-549`) and writes `memory-server/src/benchmark/results/ci-run-manifest-latest.json` — schema defined at `run-ci.ts:219-261`.

Latest Free numbers (`ci-run-manifest-latest.json:5-54`):

```json
{ "embedding": { "mode": "onnx", "provider": "local", "model": "multilingual-e5", "vector_dimension": 384 },
  "results": { "locomo_f1": 0.5917, "bilingual_recall": 0.88, "temporal": 0.6458, "cat1_f1": 0.5898 },
  "performance": { "locomo_search_p95_ms": 13.28, "locomo_token_avg": 427.75 } }
```

Gates live in `run-ci.ts:264-319`: Layer 1 absolute floors (f1≥0.20, bilingual≥0.80, temporal≥0.50, freshness≥0.90, cat1≥0.3244), Layer 2 relative regression (mean − 2·SE over last 3 same-profile runs, `run-ci.ts:294`), Layer 3 Wilcoxon (opt-in via `HARNESS_BENCH_ASSERT_IMPROVEMENT=1`, `run-ci.ts:400`). Profile-scoped history is enforced by `selectComparableHistoryEntries` (`run-ci.ts:334`) so Pro and Free histories stay separate.

## 2. Proposed Pro manifest schema

New file: `memory-server/src/benchmark/results/ci-run-manifest-pro-latest.json`. Same top-level shape as `CIRunManifest` (`run-ci.ts:219`) plus Pro-specific blocks:

```yaml
generated_at: 2026-04-11T12:00:00Z
git_sha: <sha>
strict_mode: true
embedding:
  mode: pro-adaptive            # new BenchEmbeddingMode
  provider: canai-api           # extended union
  model: ruri-v3-310m           # model-catalog.ts:26
  vector_dimension: 1024
  pro:
    endpoint: https://embed.canai.example/v1/embed
    model_id: ruri-v3-310m
    client_version: 0.1.0
    auth_mode: bearer
    local_fallback_model: multilingual-e5   # used only when pro reachable=false and fallback allowed
fixtures: { ... }                # unchanged (same 5 fixtures, same sha256)
results:                         # SAME metric keys as Free for side-by-side diffing
  all_passed: true
  locomo_f1: 0.6150
  bilingual_recall: 0.92
  temporal: 0.67
  cat1_f1: 0.61
  cat2_f1: 0.70
  cat3_f1: 0.52
pro_runtime:
  reachable: true
  queries_total: 370
  cache:
    hits: 214
    misses: 156
    hit_rate: 0.578
  latency_ms:
    network_p50: 42
    network_p95: 118
    network_p99: 180
    local_p50: 1.9
    local_p95: 4.2
    total_p50: 44
    total_p95: 122
  bytes_sent: 182340
  bytes_recv: 1512480
  error_count: 0
performance:                     # kept for gate compatibility
  locomo_search_p95_ms: 122
  locomo_token_avg: 427.75
comparisons:
  free_manifest_path: ci-run-manifest-latest.json
  free_git_sha: 512f0273...
  delta:
    locomo_f1: +0.0233
    bilingual_recall: +0.0400
    temporal: +0.0242
    cat1_f1: +0.0202
    search_p95_ms: +108.72     # latency penalty
```

Implementation note: add `"pro-adaptive"` to `BenchEmbeddingMode` (`run-ci.ts:536`) and `"canai-api"` to the provider union (`run-ci.ts:225`). The profile-scoped history gate (`run-ci.ts:321-337`) already isolates Pro from Free automatically.

## 3. Invocation story

Add a second npm script rather than flag-overloading `benchmark`:

```
"benchmark":      "cd memory-server && bun run src/benchmark/run-ci.ts"
"benchmark:pro":  "cd memory-server && HARNESS_BENCH_PROFILE=pro-adaptive HARNESS_BENCH_PRO_ENDPOINT=$CANAI_EMBED_URL bun run src/benchmark/run-ci.ts --manifest=pro"
```

`run-ci.ts` reads `HARNESS_BENCH_PROFILE` → selects `BenchEmbeddingProfile` → `--manifest=pro` redirects writes to `ci-run-manifest-pro-latest.json` + `ci-run-manifest-pro-history.jsonl`. Both files coexist; CI runs Free on every PR and Pro nightly. Rationale: separate scripts keep Free fast and make the Pro path a loud, intentional opt-in that requires a live API secret.

## 4. Acceptance gates

| # | Metric                 | Gate (Pro vs Free)          | Severity | Source of floor                          |
|---|------------------------|-----------------------------|----------|------------------------------------------|
| 1 | LoCoMo F1              | `pro ≥ free` (no regression)| fail     | Free baseline (`latest.json:37`)         |
| 2 | LoCoMo F1 target       | `pro ≥ free + 0.02`         | warn     | S79 uplift expectation                   |
| 3 | Bilingual recall       | `pro ≥ free` AND `≥ 0.88`   | fail     | Layer 1 + Free baseline (`:38`)          |
| 4 | Bilingual target       | `pro ≥ 0.92`                | warn     | Japanese differentiation goal            |
| 5 | Temporal               | `pro ≥ free - 0.02`         | fail     | Protects §32 work                        |
| 6 | cat1 F1                | `pro ≥ 0.3244`              | fail     | `HARNESS_BENCH_CAT1_F1_GATE` (`:276`)    |
| 7 | Search p95             | `pro ≤ 500 ms`              | fail     | S79 latency budget                       |
| 8 | Search p95 target      | `pro ≤ 250 ms`              | warn     | UX comfort zone                          |
| 9 | Pro network error rate | `< 1 %` of queries          | fail     | Reliability floor                        |

Gate 7 replaces the implicit Free `locomo_search_p95_ms ≈ 13 ms` floor. Layer 2 relative regression still applies inside the Pro-only history track.

## 5. Failure handling (Pro unreachable)

Default policy: **fail loud**. If the first `canai-api` embed call returns non-2xx, times out (>5 s), or fails TLS, `run-ci.ts` must:

1. Write a minimal manifest with `pro_runtime.reachable=false`, `error_count`, `results=null`.
2. Exit code `2` (distinct from gate-fail `1`, matching the three-layer pattern at `run-ci.ts:264+`).
3. Emit a single-line diagnostic `PRO_BENCHMARK_UNREACHABLE endpoint=… reason=…`.

Fallback to the local ONNX model is **only** allowed when `HARNESS_BENCH_PRO_FALLBACK=1` is set explicitly; the resulting manifest then has `embedding.mode=pro-adaptive-degraded` and gates 1–4 are skipped (warn only). This prevents a silent Free re-run from being published as a Pro result, which would falsely close an uplift claim.
