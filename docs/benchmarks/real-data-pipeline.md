# Real-Data JA/EN Memory Benchmark Pipeline

Convert harness-mem conversation history into PII-masked, MemoryAgentBench-aligned
benchmark datasets (pilot v1 and scale v2).

## Overview

1. **Export** (read-only): `~/.harness-mem/harness-mem.db` → session rounds
2. **PII mask** (irreversible): consistent token replacement, no mapping persisted
3. **Generate**: LLM-diversified queries (§141) or deterministic seeds (§140 pilot)
4. **Filter**: LLM leakage N=3, shortcut, dedup, answerability, PII scan
5. **Judge**: LLM-as-judge jury k=5 (OpenRouter opt-in) or heuristic fallback
6. **Review queue**: CR/TTL full flag; AR/LRU 25-30% spot-check (non-blocking)
7. **Gold**: `coding-memory-real-ja-mixed-v2.jsonl` (350/competency scale) or v1 pilot

## Commands

```bash
# Unit tests
bun run benchmark:internal-memory:test
cd benchmarks/internal-memory/pii && pytest

# Pilot v1 (50-100 cases, deterministic)
bun run benchmark:internal-memory:real-data-pipeline -- --pilot

# Scale v2 (350/competency, ~1400 cases, seed-based; no OpenRouter)
bun run benchmark:internal-memory:real-data-pipeline -- \
  --corpus-limit 50000 --target-per-competency 350 --overgen-factor 2

# Scale v2 with LLM generation + judge (budget cap $30 default)
INTERNAL_BENCH_BUDGET_USD=30 \
INTERNAL_BENCH_GENERATOR_MODEL=openai/gpt-4o-mini \
INTERNAL_BENCH_JUDGE_MODEL=google/gemini-2.5-flash-lite \
bun run benchmark:internal-memory:real-data-pipeline -- \
  --use-openrouter --use-llm-generate \
  --corpus-limit 50000 --target-per-competency 350 \
  --env-file /path/to/.env

# Resume after interruption
bun run benchmark:internal-memory:real-data-pipeline -- --resume \
  --checkpoint benchmarks/internal-memory/datasets/real-data-pilot/pipeline-checkpoint.json

# Run benchmark (prefers v2 when present)
bun run benchmark:internal-memory -- --competitors harness-mem
```

## PII policy

- Mask **before** Q&A generation and LLM calls
- Use consistent tokens (`[PERSON_1]`, `[EMAIL_1]`, …); destroy mapping after each run
- Never commit mapping tables, checkpoints, or raw masked corpus (gitignored)
- Regression gate: PII scan on dataset + reports must be clean

## Pilot vs scale

| Phase | Dataset | Cases | Purpose |
|-------|---------|-------|---------|
| Pilot (§140) | `coding-memory-real-ja-mixed-v1.jsonl` | 50-100 | Pipeline validation |
| Scale (§141) | `coding-memory-real-ja-mixed-v2.jsonl` | ~1400 (350/competency) | Statistical readiness |

## Scale-up criteria (§141 → future)

- Each competency ≥300 gold cases with golden judge agreement ≥75%
- OpenRouter spend within cap; manifest records models and spend
- PII scan 0 on dataset and reports
- Competitor live measurement on same masked v2 before superiority claims

## Claim safety

Real-data self-seeded results confirm retrieval on JA/EN mixed logs but do **not**
prove superiority over competitors unless the same masked dataset is used for live
competitor measurement.

## References

- [memory-benchmark-references.md](./memory-benchmark-references.md)
- [MemoryAgentBench](https://arxiv.org/abs/2507.05257)
- [LongMemEval](https://arxiv.org/abs/2410.10813)
- [Presidio](https://github.com/microsoft/presidio)
