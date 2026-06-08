# Internal Memory Benchmark Scorecard
Generated: 2026-06-06T09:09:21.205Z
Run ID: internal-memory-eef4a13e-edfb-4eb8-b6df-4dccc4f14f9e
Git SHA: f70d9e4
## MemoryAgentBench dataset manifest
- dataset_id: ai-hyz/MemoryAgentBench
- source_url: https://huggingface.co/datasets/ai-hyz/MemoryAgentBench
- source_split: Accurate_Retrieval, Test_Time_Learning, Long_Range_Understanding, Conflict_Resolution
- dataset_revision: 00d1946269e29b41eed74511997afa8171b91e08
- sample_limit: all
- row_limit: all
- gate_mode: full
- memory_chunk_count: 8928
- transform_version: memoryagentbench-transform-v3
## Reproduced (locally measured — same dataset / scorer / manifest)
| Competitor | Status | JA+Mixed score | Public R@10 | JA R@10 | Mixed R@10 | P95 latency (ms) |
|---|---:|---:|---:|---:|---:|---:|
| harness-mem | completed | 0.000 | 0.147 | 0.000 | 0.372 | 1252.0 |
## Competency tiers (§139 two-tier scoring)
AR/CR use expected-keyword substring grounding; TTL/LRU use the OpenRouter LLM judge (opt-in). The two tiers stay in separate columns and are never collapsed into one grounding number.
| Competency | Tier | Cases | Substring grounding | LLM grounding |
|---|---|---:|---:|---:|
| AR | substring | 2000 | 0.281 | — |
| CR | substring | 800 | 0.263 | — |
| TTL | llm_judge | 700 | — | 0.232 |
| LRU | llm_judge | 171 | — | 0.119 |
## Official MemoryAgentBench metric proxy
Official metric proxy values stay separate from internal Recall@10/MRR/nDCG. They are retrieval-output checks over transformed official answers, not the official agent interaction scorer.
| Split | Metric | Family | Cases | Mean official_metric | Dataset revision | Sample limit |
|---|---|---|---:|---:|---|---:|
| Accurate_Retrieval | memoryagentbench_retrieval_proxy_substring_exact_match | substring_exact_match | 2000 | 0.281 | 00d1946269e29b41eed74511997afa8171b91e08 | all |
| Test_Time_Learning | memoryagentbench_retrieval_proxy_exact_match_llm_judge_opt_in | exact_match | 700 | 0.693 | 00d1946269e29b41eed74511997afa8171b91e08 | all |
| Long_Range_Understanding | memoryagentbench_retrieval_proxy_exact_match_llm_judge_opt_in | exact_match | 171 | 0.000 | 00d1946269e29b41eed74511997afa8171b91e08 | all |
| Conflict_Resolution | memoryagentbench_retrieval_proxy_substring_exact_match | substring_exact_match | 800 | 0.263 | 00d1946269e29b41eed74511997afa8171b91e08 | all |
## Published (reference-only — NOT comparable, kept separate from the ranking above)
| Competitor | Domain | Published R@10 | Source / note |
|---|---|---:|---|
| agentmemory | generic-agent | n/a | Vendor docs / marketing — no comparable published retrieval@10 benchmark. Reference only, not reproduced. Run --competitors agentmemory with credentials to live-measure. |
| supermemory | generic-agent | n/a | Vendor docs / marketing — no comparable published retrieval@10 benchmark. Reference only, not reproduced. Run --competitors supermemory with credentials to live-measure. |
| claude-mem | developer-workflow | n/a | No published benchmark — community project. Reference only, not reproduced. Run --competitors claude-mem against a compatible /v1/search endpoint to live-measure. |
| mem0 | generic-agent | n/a | Mem0 LoCoMo / marketing claims. Reference only — no reproduced number recorded here. Domain (generic-agent) differs from developer-workflow. |
| mempalace | general-lifelog | 0.966 | LongMemEval paper claim (96.6%). Reference only, not reproduced. general-lifelog domain mismatch with developer-workflow; not comparable to harness-mem scores. |
## OpenRouter spend
- cap_usd: 50
- spent_usd: 0.200169
- remaining_usd: 49.799831
- request_count: 871
## Real-data v2 pipeline (§141 scale)
- target_per_competency: 350
- golden_agreement_rate: 100.0%
- openrouter_spent_usd: 0 / cap n/a
| Competency | Gold cases |
|---|---:|
| AR | 350 |
| CR | 350 |
| TTL | 350 |
| LRU | 350 |
## Claim safety
- Internal benchmark only. Do not copy scores into README until reproduced on target hardware.
- Published competitor values are reference-only and stay in a separate table from reproduced local runs; never merge them into one ranking.
- Only harness-mem is reproduced by default. External competitors are published(reference-only) unless live-measured opt-in via --competitors.
- harness-mem seeds its own fixtures and retrieves them in-process, so high scores confirm the runner works end-to-end, NOT external competitive superiority.
- Scoring includes a content-substring recall fallback (score-case.ts) that can favor self-seeded adapters like harness-mem; treat reproduced harness-mem scores as implementation sanity, not competitive superiority.
- Real-data v2 cases (coding-memory-real-ja-mixed-v2.jsonl) are PII-masked and self-seeded; high scores confirm pipeline health on JA/EN mixed logs at scale, NOT external competitive superiority unless competitors are live-measured on the same masked dataset.
- Real-data pilot v1 (coding-memory-real-ja-mixed-v1.jsonl) is archived; runner prefers v2 when present.
- Agentmemory live measurement uses official local REST only (AGENTMEMORY_URL default http://127.0.0.1:3111, /agentmemory/remember + /agentmemory/smart-search). Remote URLs are blocked; AGENTMEMORY_SECRET is never logged.
- Agentmemory is promoted from published(reference-only) to reproduced only when explicitly passed to --competitors and health/seed/search smoke passes on the same masked dataset/scorer.
- LoCoMo full is not the primary gate; see Plans.md section 78 domain mismatch decision.
- Official MemoryAgentBench support is a dataset-compatible runner only. Keep official_metric separate from internal retrieval metrics and do not claim superiority until comparable reproduced runs share the same dataset, scorer, and manifest.
## Sample misses
- harness-mem / mab-Accurate_Retrieval-1-1 (memoryagentbench_accurate_retrieval): recall@10=0.03
- harness-mem / mab-Accurate_Retrieval-1-2 (memoryagentbench_accurate_retrieval): recall@10=0.00
- harness-mem / mab-Accurate_Retrieval-1-3 (memoryagentbench_accurate_retrieval): recall@10=0.00
- harness-mem / mab-Accurate_Retrieval-1-4 (memoryagentbench_accurate_retrieval): recall@10=0.00
- harness-mem / mab-Accurate_Retrieval-1-5 (memoryagentbench_accurate_retrieval): recall@10=0.00
- harness-mem / mab-Accurate_Retrieval-1-6 (memoryagentbench_accurate_retrieval): recall@10=0.50
- harness-mem / mab-Accurate_Retrieval-1-7 (memoryagentbench_accurate_retrieval): recall@10=0.50
- harness-mem / mab-Accurate_Retrieval-1-8 (memoryagentbench_accurate_retrieval): recall@10=0.03
- harness-mem / mab-Accurate_Retrieval-1-9 (memoryagentbench_accurate_retrieval): recall@10=0.00
- harness-mem / mab-Accurate_Retrieval-1-10 (memoryagentbench_accurate_retrieval): recall@10=0.00
