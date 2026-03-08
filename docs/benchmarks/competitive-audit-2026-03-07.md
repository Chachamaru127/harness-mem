# Competitive Audit - 2026-03-07

Last updated: 2026-03-07

## Verdict

`unique / only / best for Japanese memory` は **blocked**。

2026-03-07 時点の公開一次情報だけを見ると、少なくとも競合側にも

- multilingual / any-language 系の主張
- MCP client 全般で使える memory layer / knowledge graph 系の訴求
- OpenMemory / workspace memory / local-first に近い positioning

が存在します。

したがって、現時点で harness-mem が

- `the only option`
- `唯一の日本語対応`
- `best in market`

を言い切れる根拠はありません。

## Matrix

| Project | Official source | Published claim relevant to multilingual / Japanese | Audit note | Claim status |
|---|---|---|---|---|
| Mem0 | https://docs.mem0.ai/components/rerankers/models/cohere | Docs expose a multilingual reranker option and describe `100+ languages`. | This does not prove end-to-end Japanese QA quality, but it is enough to block `others are not multilingual`. | `blocks unique claim` |
| OpenMemory (Mem0) | https://docs.mem0.ai/openmemory/openmemory-workspace | Official docs position OpenMemory Workspace as a team / workspace memory layer. | This overlaps with shared-memory positioning even if the Japanese evaluation story is different. | `blocks only-option claim` |
| Zep | https://help.getzep.com/faq | Official FAQ says multilingual support is on the roadmap, while also stating the product should work with any language today. | This is weaker than a benchmarked Japanese proof, but still blocks `Zep is non-Japanese`. | `blocks unique claim` |
| Graphiti / Zep MCP | https://www.getzep.com/product/knowledge-graph-mcp/ | Official product page says `local knowledge graph memory for any MCP client`. | This overlaps directly with local memory / MCP positioning. | `blocks only-option claim` |
| Claude-mem | https://claude-mem.ai/docs/introduction | Official docs position it as a local-first memory system for Claude workflows. | No strong public Japanese benchmark claim was found here, but it clearly occupies adjacent memory territory. | `adjacent competitor` |

## Safe interpretation

What we can safely say today:

- harness-mem has **artifact-backed Japanese short-answer evidence**.
- harness-mem has **artifact-backed EN<->JA retrieval evidence**.
- harness-mem has a stronger public proof story for Japanese than the audited pages above.

What we cannot safely say today:

- competitors do not support Japanese
- harness-mem is the only local-first memory runtime for Japanese workflows
- harness-mem is the best option in market

## Copy impact

### Safe now

- `Japanese short-answer quality is evaluated on a dedicated release pack.`
- `Cross-lingual EN<->JA retrieval is benchmarked.`
- `A local-first option designed for multi-tool workflows.`

### Safe only if separately proven later

- `strongest public Japanese proof among audited competitors`
  - Requires a more explicit dated comparison rubric and reproducible public evidence snapshot.

### Blocked

- `only option`
- `unique`
- `best in market`
- `native Japanese quality`

## Recheck trigger

Re-run this audit when any of the following changes:

1. Mem0 / OpenMemory publishes explicit Japanese benchmark claims
2. Zep ships official multilingual support docs beyond FAQ wording
3. Graphiti / MCP positioning changes materially
4. harness-mem wants to use `unique / only / best` in README / LP / X
