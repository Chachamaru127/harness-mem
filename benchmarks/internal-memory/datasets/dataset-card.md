# Dataset Card: CodingMemory Bench v3

## Dataset Description

- **Dataset ID**: `coding-memory-real-ja-mixed-v3`
- **Task**: Retrieval memory benchmark for Japanese and JA/EN mixed AI coding sessions
- **Competencies**: AR, TTL, LRU, CR (MemoryAgentBench compatible)
- **Languages**: Japanese, English, mixed
- **Sources**: Claude Code, Codex, Cursor session logs (PII irreversibly masked)

## Schema (JSONL)

Each line is one benchmark case:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `case_id` | string | yes | Unique case identifier |
| `layer` | string | yes | Benchmark layer (`public_compatible`, etc.) |
| `category` | string | yes | Case category |
| `competency` | string | no | AR / TTL / LRU / CR |
| `language_profile` | string | yes | `ja` / `en` / `mixed` |
| `project` | string | yes | Scoped project id (masked) |
| `memories` | array | yes | `{ id, content, timestamp?, metadata? }` |
| `query` | string | yes | Retrieval query |
| `relevant_ids` | string[] | yes | Gold memory ids (primary metric) |
| `source_platform` | string | no | `claude` / `codex` / `cursor` / `mixed` / `unknown` |
| `source_dataset` | string | no | `coding-memory-real-ja-mixed-v3` |

## Statistics (v3)

See `codingmemory-v3-corpus-manifest.json` for current counts.

Typical v3 profile:

- Cases: 1400+
- Per competency: ≥350
- Mixed language: ≥90%
- Pure English: ≥5%

## Generation pipeline

1. Read-only export from local `harness-mem.db`
2. Irreversible PII masking (Presidio gate)
3. Q&A generation + leakage filter + judge gate
4. Optional platform metadata enrichment

Pipeline version: `real-data-pipeline-v2` / `codingmemory-v3-platform-metadata`

## Intended use

- Reproduced retrieval benchmark for developer-domain coding memory
- Research on JA/mixed coding session continuity
- **Not** for re-identification, surveillance, or training on raw operator logs

## Out of scope

- Raw unmasked logs
- General-lifelog (LoCoMo full) primary KPI
- Using MemoryAgentBench English scores as a proxy for this dataset

## License

See `LICENSE` in this directory (CC-BY-4.0 with irreversible PII masking note).

Repository code remains BUSL-1.1; this dataset is separately licensed for redistribution.
