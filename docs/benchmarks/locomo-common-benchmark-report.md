# LoCoMo Common Benchmark Report (§143)

Generated: 2026-05-29  
Dataset: official `snap-research/locomo` → `.tmp/locomo/locomo10.json` (10 conversations, 1986 QA total)

## Reproduced results

| System | Scope | EM | F1 | cat-1..4 F1 | cat-5 F1 | Embedding | Notes |
|---|---|---:|---:|---:|---:|---|---|
| harness-mem | official sample-1, 100 QA (pre-§144) | 0.010 | 0.027 | 0.027 | 0.000 | fallback | artifact: `harness-mem-official-qa100.json` |
| harness-mem | official sample-1, 100 QA (pre-§144) | 0.010 | 0.024 | 0.024 | 0.000 | openai | artifact: `harness-mem-official-openai-qa100.json` |
| harness-mem | official sample-1, 100 QA (**post-§144**) | 0.010 | **0.044** | 0.044 | 0.000 | fallback | artifact: `harness-mem-s144-fallback-qa100.json` |
| harness-mem | official sample-1, 100 QA (**post-§144**) | 0.010 | **0.044** | 0.044 | 0.000 | openai | artifact: `harness-mem-s144-openai-qa100.json` (gate passed, provider=openai) |
| agentmemory | — | — | — | — | — | openai (expected) | **blocked**: local daemon not running on `127.0.0.1:3111` |

### §144 improvement note

§144 added (a) LoCoMo session-date capture + real-timestamp ingest, (b) relative-date
resolution ("yesterday"/"N days ago"/"last week" → absolute date anchored on the message
timestamp), (c) filler/question-token extraction guards.

- Overall F1 (fallback, 100 QA): 0.027 → **0.044** (+63% relative).
- Overall F1 (openai, 100 QA): 0.024 → **0.044** (+83% relative).
- cat-2 temporal F1: ~0 → **0.080** (fallback) / **0.089** (openai).
- embedding choice barely moves the score (post-§144 fallback≈openai=0.044), confirming the
  gap was extraction/normalization, not retrieval embeddings.
- Example: "When did Caroline go to the LGBTQ support group?" — pre: `"That's really cool."`
  (F1=0) → post: `"May 7, 2023"` (gold `7 May 2023`, F1=0.67).
- Remaining EM=0 on dates is mostly date-format ("May 7, 2023" vs "7 May 2023") and the
  exact-match scorer limit; per §78 we do not tune the product to win exact-match on this
  domain and instead rely on F1 / LLM-judge for semantic credit.

## Claim safety

- LoCoMo measures English general-lifelog memory; harness-mem primary domain is Japanese developer workflow (**domain mismatch**).
- Results above are **same-run reproduced** measurements only; not proof of external superiority.
- Answer synthesis is **shared** (`synthesizeLocomoAnswer`); only retrieval differs between systems.
- EM/F1 are self-scored on our pipeline; third-party execution would be needed for fully independent claims.
- Secrets (`OPENAI_API_KEY`, `AGENTMEMORY_SECRET`) are not recorded in artifacts (set/unset only).

## Next steps for full comparison

1. Start Agentmemory daemon with `EMBEDDING_PROVIDER=openai`.
2. Re-run harness-mem with `--embedding-mode openai` and full dataset (or staged `--max-qa`).
3. Run `--system agentmemory` on the same dataset path and scorer output.
4. Compare `metrics.overall.em/f1` from both JSON artifacts.

See [locomo-common-benchmark.md](./locomo-common-benchmark.md) for commands.
