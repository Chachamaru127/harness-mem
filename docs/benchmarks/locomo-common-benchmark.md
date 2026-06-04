# LoCoMo Common Benchmark (§143)

Cross-system LoCoMo comparison: harness-mem vs Agentmemory on the official
`snap-research/locomo` dataset with shared answer synthesis and aligned OpenAI
embedding backbone.

## Prerequisites

- Official dataset: see [locomo-dataset.md](./locomo-dataset.md)
- harness-mem: `HARNESS_MEM_EMBEDDING_PROVIDER=openai` + `HARNESS_MEM_OPENAI_API_KEY`
  (or `OPENAI_API_KEY` via `.env` guard)
- Agentmemory daemon (localhost): `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY`
- Agentmemory REST: `AGENTMEMORY_URL=http://127.0.0.1:3111`, optional `AGENTMEMORY_SECRET`

## Commands

```bash
# 1) harness-mem baseline (OpenAI embedding)
bun --env-file=.env run tests/benchmarks/run-locomo-benchmark.ts \
  --system harness-mem \
  --dataset .tmp/locomo/locomo10.json \
  --output .tmp/locomo/reports/harness-mem-openai.json \
  --embedding-mode openai

# 2) Agentmemory live (requires local daemon)
bun --env-file=.env run tests/benchmarks/run-locomo-benchmark.ts \
  --system agentmemory \
  --dataset .tmp/locomo/locomo10.json \
  --output .tmp/locomo/reports/agentmemory-openai.json

# 3) Staged smoke (fallback embedding, cap QA count)
bun run tests/benchmarks/run-locomo-benchmark.ts \
  --system harness-mem \
  --dataset .tmp/locomo/locomo10.json \
  --output .tmp/locomo/reports/harness-mem-smoke.json \
  --max-samples 1 --max-qa 30 \
  --embedding-mode fallback --onnx-gate false
```

## Claim safety (must include in reports)

- LoCoMo = English general-lifelog; harness-mem primary domain = Japanese developer workflow.
- Same-run reproduced measurement only; not external superiority proof.
- Shared `synthesizeLocomoAnswer` isolates retrieval; EM/F1 still self-scored on our pipeline.
- Agentmemory live runs are localhost-only; secrets recorded as set/unset only.

## Verification

```bash
bun test tests/benchmarks/locomo-*.test.ts
git diff --check
```
