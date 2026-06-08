# Reproducibility manifest
- run_id: internal-memory-eef4a13e-edfb-4eb8-b6df-4dccc4f14f9e
- generated_at: 2026-06-06T09:09:21.205Z
- git_sha: f70d9e4
- datasets: ai-hyz/MemoryAgentBench:Accurate_Retrieval+Test_Time_Learning+Long_Range_Understanding+Conflict_Resolution
- dataset_manifest: {"dataset":"memoryagentbench","dataset_id":"ai-hyz/MemoryAgentBench","source_url":"https://huggingface.co/datasets/ai-hyz/MemoryAgentBench","revision":"00d1946269e29b41eed74511997afa8171b91e08","splits":["Accurate_Retrieval","Test_Time_Learning","Long_Range_Understanding","Conflict_Resolution"],"gate_mode":"full","upstream_row_count":146,"memory_chunk_count":8928,"transform_version":"memoryagentbench-transform-v3","cache_dir":"/Users/tachibanashuuta/.cursor/worktrees/harness-mem-9f3a2c7b/harness-mem-fdb8d9303044/benchmarks/internal-memory/.cache/memoryagentbench","downloaded_at":"2026-06-06T08:25:10.305Z"}
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
- INTERNAL_BENCH_BUDGET_USD: 50
## OpenRouter budget
- cap_usd: 50
- spent_usd: 0.200169
- request_count: 871

## Env files loaded

- ~/LocalWork/Code/CC-harness/harness-mem/.env
