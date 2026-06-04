# Reproducibility manifest
- run_id: internal-memory-11e74600-b40a-4076-802e-aa8dbca3802a
- generated_at: 2026-05-29T17:24:29.673Z
- git_sha: 82d457c
- datasets: public-retrieval-v1.jsonl, coding-memory-ja-mixed-v1.jsonl, coding-memory-real-ja-mixed-v2.jsonl
- competitors: harness-mem, agentmemory, supermemory, claude-mem, mem0, mempalace
- node: v24.3.0
- platform: darwin
## Environment flags observed
- AGENTMEMORY_URL: unset (default http://127.0.0.1:3111)
- AGENTMEMORY_SECRET: unset
- agentmemory_endpoints: /agentmemory/health, /agentmemory/remember, /agentmemory/smart-search
- SUPERMEMORY_API_KEY: unset
- CLAUDE_MEM_BASE_URL: unset
- HARNESS_MEM_BASE_URL: unset
- OPENROUTER_API_KEY: set
- INTERNAL_BENCH_BUDGET_USD: 20 (default)
## OpenRouter budget
- cap_usd: n/a (OpenRouter judge disabled)
- spent_usd: 0
- request_count: 0

## Env files loaded

- ~/LocalWork/Code/CC-harness/harness-mem/.env
