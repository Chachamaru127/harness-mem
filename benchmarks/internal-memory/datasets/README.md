# CodingMemory Bench Datasets

Public masked JSONL datasets for the CodingMemory Bench (§153).

## Files

| File | Description |
|------|-------------|
| `coding-memory-real-ja-mixed-v3.jsonl` | Primary public dataset (1400+ cases, platform metadata) |
| `coding-memory-real-ja-mixed-v2.jsonl` | Previous real-data release (archived baseline) |
| `coding-memory-real-ja-mixed-v1.jsonl` | Pilot dataset (do not double-count with v2/v3) |
| `codingmemory-v3-corpus-manifest.json` | Language / competency / platform statistics |
| `dataset-card.md` | Hugging Face dataset card source |
| `LICENSE` | Dataset license (CC-BY-4.0 + PII note) |

## Loader priority

`dataset-loader.ts` resolves real-data in order: **v3 → v2 → v1**.

## Generation

```bash
# Full pipeline from harness-mem.db
npm run benchmark:internal-memory:real-data-pipeline -- \
  --corpus-limit 50000 --target-per-competency 350 --dataset-version v3

# Fast v3 refresh from v2 (+ platform metadata)
npm run benchmark:codingmemory:build-v3
```

## Prohibited

- Committing raw conversation logs
- Committing PII mapping tables or checkpoints with reversible tokens
- Publishing unmasked exports
