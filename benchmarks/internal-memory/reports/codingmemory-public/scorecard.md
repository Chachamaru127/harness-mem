# Internal Memory Benchmark Scorecard
Generated: 2026-06-06T11:38:13.745Z
Run ID: internal-memory-5c9a8b52-95d2-47ca-a927-7210e2f036d7
Git SHA: f70d9e4
## CodingMemory Bench dataset manifest
- dataset_id: coding-memory-real-ja-mixed-v3
- source_url: benchmarks/internal-memory/datasets/coding-memory-real-ja-mixed-v3.jsonl
- gate_mode: smoke
- sample_limit: 20
- embedding_profile: production_onnx
- hf_revision: not_published
- transform_version: codingmemory-v3-platform-metadata
- language_profile: {"en":6,"mixed":14}
- competency: {"AR":20}
- source_platform: {"unknown":18,"claude":2}
## Reproduced (locally measured — same dataset / scorer / manifest)
| Competitor | Status | JA+Mixed score | Public R@10 | JA R@10 | Mixed R@10 | P95 latency (ms) |
|---|---:|---:|---:|---:|---:|---:|
| harness-mem | completed | 0.500 | 0.333 | 0.000 | 0.500 | 4.7 |
| agentmemory | skipped | 0.000 | 0.000 | 0.000 | 0.000 | 0.0 |
| supermemory | skipped | 0.000 | 0.000 | 0.000 | 0.000 | 0.0 |
## Competency tiers (§139 two-tier scoring)
AR/CR use expected-keyword substring grounding; TTL/LRU use the OpenRouter LLM judge (opt-in). The two tiers stay in separate columns and are never collapsed into one grounding number.
| Competency | Tier | Cases | Substring grounding | LLM grounding |
|---|---|---:|---:|---:|
| AR | substring | 20 | 0.450 | — |
## Published (reference-only — NOT comparable, kept separate from the ranking above)
| Competitor | Domain | Published R@10 | Source / note |
|---|---|---:|---|
| claude-mem | developer-workflow | n/a | No published benchmark — community project. Reference only, not reproduced. Run --competitors claude-mem against a compatible /v1/search endpoint to live-measure. |
| mem0 | generic-agent | n/a | Mem0 LoCoMo / marketing claims. Reference only — no reproduced number recorded here. Domain (generic-agent) differs from developer-workflow. |
| mempalace | general-lifelog | 0.966 | LongMemEval paper claim (96.6%). Reference only, not reproduced. general-lifelog domain mismatch with developer-workflow; not comparable to harness-mem scores. |
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
- harness-mem / real-ar-0004 (real_mixed_ar): recall@10=0.00
- harness-mem / real-ar-0008 (real_ar): recall@10=0.00
- harness-mem / real-ar-0009 (real_ar): recall@10=0.00
- harness-mem / real-ar-0010 (real_mixed_ar): recall@10=0.00
- harness-mem / real-ar-0011 (real_mixed_ar): recall@10=0.00
- harness-mem / real-ar-0012 (real_mixed_ar): recall@10=0.00
- harness-mem / real-ar-0013 (real_mixed_ar): recall@10=0.00
- harness-mem / real-ar-0014 (real_mixed_ar): recall@10=0.00
- harness-mem / real-ar-0016 (real_ar): recall@10=0.00
- harness-mem / real-ar-0017 (real_ar): recall@10=0.00
