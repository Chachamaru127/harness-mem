# Phase B Capabilities Summary (landed 2026-04-18)

This document records what §78 Phase B delivered, what was measured, and what remains deferred per the §78 pivot decision.

---

## What Each Task Landed

### §78-B01 — Verbatim Raw Storage Mode (`HARNESS_MEM_RAW_MODE`)

Commits: `9fc09b9`, `df0f7b2`, `6d55cfb`, `be81182`

- Added `raw_text` column to the observations schema (migration in `9fc09b9`).
- When `HARNESS_MEM_RAW_MODE=1`, the full verbatim conversation text is stored alongside the structured observation. Embeddings are generated from the raw text rather than the processed observation.
- `HARNESS_MEM_RAW_MODE=0` (default) preserves the existing structured-observation path. Both modes coexist in the same schema.
- RAW=0 baseline on the 120Q subset: **F1=0.5861, EM=0.5333** (committed in `be81182`).
- RAW=1 formal delta measurement: deferred — see "What is NOT Measured" below.

### §78-B02 — Hierarchical Metadata Scoping

Commits: `c8cdbe2`, `77ac3bb`, `31fce2c`

- Added `thread_id` and `topic` columns to the observations schema alongside the existing `project` and `session_id` columns.
- `harness_mem_search` now accepts a `scope` parameter: `project | session | thread | topic`.
- Scoped queries restrict the candidate set to the specified layer. A missing scope falls back to full-project search (no behavior change for existing callers).
- MCP tool definition and OpenAPI spec updated in `31fce2c`.
- Tests and benchmark signal were deferred to §78-B04 (this document).

### §78-B03 — Token-Budget-Aware Wake-Up Context (L0/L1 Split)

Commits: `ec030de`, `9b41d22`

- SessionStart artifact split into two layers:
  - **L0** ("critical facts"): at most ~170 tokens. Always-on, contains the minimum required for first-turn continuity.
  - **L1** ("recent context"): fuller context appended when token budget allows.
- `harness_mem_search` accepts `detail_level: index | context | full` to control the amount returned.
- Test in `9b41d22` asserts L0 ≤ 180 tokens and that first-turn continuity is preserved at L0.
- Target: 50% reduction in SessionStart token consumption while maintaining continuity signal.

---

## Measured Deltas

### 120Q Subset Run Status

**Status: deferred.** The `locomo-120.json` fixture exists at `tests/benchmarks/fixtures/locomo-120.json`, but running the full benchmark pipeline requires an ONNX embedding runtime that would exceed the budget for this task.

### Prior Baselines (from §78-B01 `be81182`)

These are the committed reference points for Phase B comparisons:

| Configuration | Subset | F1 | EM | Source |
|---|---|---:|---:|---|
| `RAW=0` (structured observations, default) | LoCoMo 120Q | 0.5861 | 0.5333 | commit `be81182` |
| `RAW=1` (verbatim raw text) | LoCoMo 120Q | — | — | deferred |

The `RAW=1` delta is the main open measurement from Phase B. It should be run as a standalone invocation once an embedding runtime is available:

```bash
# RAW=0 baseline (reproduce)
HARNESS_MEM_RAW_MODE=0 npx ts-node tests/benchmarks/run-locomo-benchmark.ts \
  --fixture tests/benchmarks/fixtures/locomo-120.json --output docs/benchmarks/artifacts/

# RAW=1 delta
HARNESS_MEM_RAW_MODE=1 npx ts-node tests/benchmarks/run-locomo-benchmark.ts \
  --fixture tests/benchmarks/fixtures/locomo-120.json --output docs/benchmarks/artifacts/
```

### §78-B02 Scope Filter Signal

No benchmark delta was collected for §78-B02. The scoped-search feature reduces noise in multi-session projects but the 120Q LoCoMo fixture does not have multi-session structure that exercises the scope parameter. A developer-workflow fixture with thread/topic diversity would be the right harness for this feature.

### §78-B03 Token Budget Signal

Test `9b41d22` verifies L0 ≤ 180 tokens. A production token-consumption comparison (L0 vs. full SessionStart on a real multi-session project) remains to be run.

---

## What is NOT Measured (Deferred per §78 Pivot)

Per §78 Global DoD (Plans.md line 113):

> **LoCoMo is removed from the release gate entirely. The full 1,986Q score will not be published.**

The following are explicitly out of scope for this document:

| Benchmark | Reason deferred |
|---|---|
| **LoCoMo Full (1,986Q)** | Off-gate per §78 pivot. harness-mem's target domain is developer workflow, not general lifelog. Running LoCoMo Full would produce a number that does not reflect intended use. |
| **LongMemEval** | No committed fixture in this repo. Would require external dataset acquisition. Off-gate per §78 pivot. |
| **RAW=1 delta vs. RAW=0** | Live run requires ONNX embedding runtime; deferred to a standalone invocation. |
| **§78-B02 scope-filter recall delta** | LoCoMo 120Q fixture lacks multi-session thread/topic structure needed to exercise the scope parameter meaningfully. |

---

## Production Configuration Recommendation

| Setting | Recommended value | Notes |
|---|---|---|
| `HARNESS_MEM_RAW_MODE` | `0` (default) | Structured observation path. Lower storage overhead; proven on the 120Q baseline. |
| `HARNESS_MEM_RAW_MODE=1` | opt-in | Use when verbatim recall of exact user phrasing matters more than observation compression. Storage cost increases proportionally with conversation length. RAW=1 delta not yet measured. |
| `scope` parameter | omit (full-project default) | Scoped search is useful for large multi-session projects; safe to leave unset for single-session or small projects. |
| `detail_level` | `context` (default) | L0 for absolute minimum token budget; `full` for detailed retrieval when token budget is not constrained. |

The primary release gate remains the developer-domain metrics in `ci-run-manifest-latest.json`:

| Metric | Current | Gate |
|---|---:|---:|
| `dev-workflow` recall@10 | 0.59 | ≥ 0.70 (warn) |
| `bilingual` recall@10 | 0.88 | ≥ 0.90 |
| `knowledge-update` freshness@K | 1.00 | ≥ 0.95 |
| `temporal` ordering score | 0.65 | ≥ 0.70 (warn) |

Phase B improvements (raw storage, hierarchical scoping, L0/L1 wake-up) are expected to contribute positively to `dev-workflow` and `temporal` recall, but a formal delta run against the developer-domain fixture is a follow-on task.
