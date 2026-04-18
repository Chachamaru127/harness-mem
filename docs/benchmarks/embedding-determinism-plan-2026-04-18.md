# Embedding Determinism Plan: Apple M1 vs Linux x64

**Task**: §77 S77-002 / §78-A03 | **Date**: 2026-04-18 | **Status**: Plan only (not yet scheduled)

## Objective

Measure whether `@huggingface/transformers@3.8.1` (ONNX runtime, multilingual-e5 model) produces
bit-identical embedding vectors on Apple M1 (darwin/arm64) and Linux x64 (ubuntu-latest). Any
difference would explain bilingual_recall drift and Alpha Recall@10 drop even under exact lockfile pinning.

## Background

- v0.9.0 CI (2026-04-04, ubuntu-latest): bilingual_recall = 0.90, Alpha Recall@10 = 1.0
- v0.11.0 local (2026-04-10, Apple M1): bilingual_recall = 0.88, Alpha Recall@10 = 0.40
- `memory-server/src/` confirmed zero diff between the two points
- After exact-pin (§78-A03 S77-001), local M1 run still shows Alpha=0.40, Beta=0.60
- Hypothesis: Apple M1 FPU non-determinism in ONNX float32 ops may produce different cosine
  similarity rankings, or the ONNX web/node runtime differs by platform

## What Would Need to Be Measured

### Test Fixture

Use the existing `tests/benchmarks/fixtures/bilingual-50.json` and `locomo-120.json` fixtures.

A minimal single-file script should:
1. Load multilingual-e5 ONNX model (passage encoder)
2. Embed a canonical set of 10–20 sentences (drawn from bilingual-50 fixture)
3. Print the raw float32 embedding vectors (first 8 dimensions) for each sentence
4. Print cosine similarity between pairs

### Comparison Method

Run the same script on both platforms and diff the output. Any non-identical float32 values
at full precision indicate platform-specific non-determinism.

Script path (to be created): `scripts/bench-embedding-determinism.ts`

### Proposed GitHub Actions Matrix Job

Name: `embedding-determinism-matrix`

```yaml
name: Embedding Determinism Matrix

on:
  workflow_dispatch:  # manual trigger only — not part of regular CI

jobs:
  embedding-determinism:
    name: embedding-determinism (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-14]  # macos-14 = Apple M1 (arm64)
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.10"

      - name: Install dependencies (frozen lockfile)
        run: bun install --frozen-lockfile

      - name: Run embedding determinism probe
        run: bun run scripts/bench-embedding-determinism.ts > embedding-probe-${{ matrix.os }}.txt

      - name: Upload probe output
        uses: actions/upload-artifact@v4
        with:
          name: embedding-probe-${{ matrix.os }}
          path: embedding-probe-${{ matrix.os }}.txt

  compare:
    name: diff-platforms
    needs: [embedding-determinism]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          pattern: embedding-probe-*
          merge-multiple: true

      - name: Diff outputs
        run: |
          if diff embedding-probe-ubuntu-latest.txt embedding-probe-macos-14.txt; then
            echo "RESULT: bit-identical outputs on both platforms"
          else
            echo "RESULT: platform-specific divergence detected"
            exit 1
          fi
```

### Decision Gate

| Result | Action |
|--------|--------|
| Bit-identical on both platforms | Root cause confirmed as lockfile drift only. §77 is resolved by S77-001. |
| Divergence in float32 values | Platform FPU non-determinism confirmed. Investigate ONNX determinism flags (`onnxruntime.SessionOptions.enableDeterministicCompute`) or model quantization to int8 to reduce sensitivity. |
| Divergence only in ranking (not raw vectors) | Borderline case — investigate cosine similarity precision cutoff. |

## Resources

- `@huggingface/transformers` ONNX backend: `node_modules/@huggingface/transformers/src/backends/onnx.js`
- ONNX Runtime determinism docs: https://onnxruntime.ai/docs/performance/model-optimizations/float16.html
- Related: `memory-server/src/embed/local-embed.ts` (pipeline setup)

## Lead Decision Required

This plan describes what would need to be done. Lead should decide whether to:
1. Schedule `embedding-determinism-matrix` job immediately (before v0.12.0)
2. Defer until §77 recall regressions re-appear after S77-001 lockfile pin stabilizes
3. Treat bilingual_recall = 0.88 as the new baseline (Option B, see S77-004 doc)
