# CodingMemory Bench Charter (English)

Effective: 2026-06-06  
Companion: `Spec.md` Public CodingMemory Benchmark / `Plans.md` §153

## Name and purpose

**CodingMemory Bench** measures memory for Japanese and JA/EN mixed AI coding sessions in the developer domain.

- A **complement** to MemoryAgentBench (English encyclopedic), not a replacement
- Primary sources: Claude Code / Codex / Cursor hook JSON, decision notes, PR/issue context, mixed queries
- Public claims are capped at numbers **reproduced on the same dataset, scorer, and manifest**

## Audience

- Product owners and engineers shipping JA/mixed coding memory
- Evaluators who need third-party reproducibility for developer-workflow retrieval
- Researchers applying MemoryAgentBench's four-capability vocabulary to coding domains

## Four capabilities (MemoryAgentBench compatible)

| Capability | Code | What CodingMemory measures |
|------------|------|------------------------------|
| Accurate Retrieval | AR | Find the correct fact or memory fragment |
| Test-Time Learning | TTL | Apply recent corrections in later queries |
| Long-Range Understanding | LRU | Connect facts across distant turns/sessions |
| Conflict Resolution | CR | Prefer newer facts over superseded ones |

## Non-goals

- LoCoMo full / general-lifelog as the primary gate
- Using MemoryAgentBench English encyclopedic scores as a proxy KPI for CodingMemory
- Committing raw logs or PII mapping tables
- Superiority claims from harness-mem self-seed perfect scores alone
- Mixing published (reference-only) and reproduced rows in one ranking table

## Dataset

- Dataset id: `coding-memory-real-ja-mixed-v3`
- 1400+ masked Q&A cases, ≥350 per competency, irreversible PII masking
- Recommended stats: mixed ≥ 90%, pure en ≥ 5%, optional `source_platform` metadata
- Hugging Face release uses a separate dataset LICENSE (CC-BY-4.0 + irreversible PII note)

## Scoring transparency

Public tables treat **ID recall@10 as primary**:

- **ID recall**: any `relevant_ids` entry appears in top-10 hits (primary)
- **Content fallback (AR substring)**: answer substring appears in hit content (secondary; self-seed bias risk)

TTL/LRU may use LLM judge as a separate field; do not conflate with substring recall.

## Reproduced competitors (public minimum)

Live measurement on the same v3 dataset / scorer / manifest:

1. harness-mem (production profile: `HARNESS_MEM_INTERNAL_BENCH_EMBEDDING=1`)
2. Agentmemory (localhost REST, seed + smart-search)
3. Supermemory (API credentials required, ingest + search)

Mem0 live is optional stretch. Record skip reasons when credentials are missing.

## Claim ceiling (claim_safety)

**Allowed**

- Reproduced 3-system table and per-competency breakdown
- Reproducibility manifest (secrets as set/unset only)
- Bounded advocacy: "we propose a JA/mixed coding-memory benchmark"

**Not allowed**

- "Industry best" or "beats MemoryAgentBench" (domain mismatch)
- Superiority from harness-mem self-seed perfect scores only
- Presenting hash-fallback embedding profile as the public baseline

## Reproduction

```bash
bun test benchmarks/internal-memory/tests/
cd benchmarks/internal-memory/pii && python3 -m pytest
npm run benchmark:codingmemory:smoke
npm run benchmark:codingmemory:public
```

Artifacts: `benchmarks/internal-memory/reports/codingmemory-public/`
