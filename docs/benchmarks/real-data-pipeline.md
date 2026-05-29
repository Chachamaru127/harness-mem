# Real-Data JA/EN Memory Benchmark Pipeline

Pilot pipeline to convert harness-mem conversation history into a PII-masked,
MemoryAgentBench-aligned benchmark dataset.

## Overview

1. **Export** (read-only): `~/.harness-mem/harness-mem.db` → session rounds
2. **PII mask** (irreversible): consistent token replacement, no mapping persisted
3. **Generate**: AR / TTL / LRU / CR candidates from masked corpus
4. **Filter**: leakage, shortcut, dedup, answerability, PII scan
5. **Judge**: LLM-as-judge (OpenRouter opt-in) or heuristic fallback
6. **Human review**: CR/TTL full review; AR/LRU 25-30% spot-check
7. **Gold**: `coding-memory-real-ja-mixed-v1.jsonl` (50-100 pilot cases)

## Commands

```bash
# Unit tests
bun run benchmark:internal-memory:test
cd benchmarks/internal-memory/pii && pytest

# Generate pilot dataset (no OpenRouter)
bun run benchmark:internal-memory:real-data-pipeline

# With LLM judge (budget cap via INTERNAL_BENCH_BUDGET_USD)
bun run benchmark:internal-memory:real-data-pipeline -- --use-openrouter --env-file /path/to/.env

# Run benchmark including real-data layer
bun run benchmark:internal-memory -- --competitors harness-mem
```

## PII policy

- Mask **before** Q&A generation and LLM calls
- Use consistent tokens (`[PERSON_1]`, `[EMAIL_1]`, …); destroy mapping after each run
- Never commit mapping tables or raw `/Users/...` paths
- Regression gate: PII scan on dataset + reports must be clean

## Pilot vs full scale

| Phase | Cases | Purpose |
|-------|-------|---------|
| Pilot (§140) | 50-100 | Pipeline validation, yield/cost calibration |
| Full (future) | 200-500/competency | Statistical competitor comparison |

## Claim safety

Real-data self-seeded results confirm retrieval on JA/EN mixed logs but do **not**
prove superiority over competitors unless the same masked dataset is used for live
competitor measurement.

## References

- [memory-benchmark-references.md](./memory-benchmark-references.md)
- [MemoryAgentBench](https://arxiv.org/abs/2507.05257)
- [LongMemEval](https://arxiv.org/abs/2410.10813)
- [Presidio](https://github.com/microsoft/presidio)
