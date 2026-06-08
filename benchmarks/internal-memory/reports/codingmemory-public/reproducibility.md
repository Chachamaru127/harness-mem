# Reproducibility manifest
- run_id: internal-memory-5c9a8b52-95d2-47ca-a927-7210e2f036d7
- generated_at: 2026-06-06T11:38:13.745Z
- git_sha: f70d9e4
- datasets: datasets/coding-memory-real-ja-mixed-v3.jsonl
- dataset_manifest: {"dataset":"codingmemory","dataset_id":"coding-memory-real-ja-mixed-v3","source_url":"benchmarks/internal-memory/datasets/coding-memory-real-ja-mixed-v3.jsonl","gate_mode":"smoke","sample_limit":20,"embedding_profile":"production_onnx","language_profile":{"en":6,"mixed":14},"competency":{"AR":20},"source_platform":{"unknown":18,"claude":2},"transform_version":"codingmemory-v3-platform-metadata"}
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
- ~/LocalWork/Code/CC-harness/harness-mem/.env
