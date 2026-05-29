# Internal Memory Benchmark Scorecard
Generated: 2026-05-29T04:29:04.177Z
Run ID: internal-memory-17a62e5c-168d-477a-ba32-9deba0a4b4ac
Git SHA: 0baf60f
## Reproduced (locally measured — same dataset / scorer / manifest)
| Competitor | Status | JA+Mixed score | Public R@10 | JA R@10 | Mixed R@10 | P95 latency (ms) |
|---|---:|---:|---:|---:|---:|---:|
| harness-mem | completed | 1.000 | 1.000 | 1.000 | 1.000 | 6.8 |
## Competency tiers (§139 two-tier scoring)
AR/CR use expected-keyword substring grounding; TTL/LRU use the OpenRouter LLM judge (opt-in). The two tiers stay in separate columns and are never collapsed into one grounding number.
| Competency | Tier | Cases | Substring grounding | LLM grounding |
|---|---|---:|---:|---:|
| AR | substring | 12 | 1.000 | — |
| CR | substring | 4 | 1.000 | — |
| TTL | llm_judge | 2 | — | 1.000 |
| LRU | llm_judge | 2 | — | 1.000 |
## Published (reference-only — NOT comparable, kept separate from the ranking above)
| Competitor | Domain | Published R@10 | Source / note |
|---|---|---:|---|
| agentmemory | generic-agent | n/a | Vendor docs / marketing — no comparable published retrieval@10 benchmark. Reference only, not reproduced. Run --competitors agentmemory with credentials to live-measure. |
| supermemory | generic-agent | n/a | Vendor docs / marketing — no comparable published retrieval@10 benchmark. Reference only, not reproduced. Run --competitors supermemory with credentials to live-measure. |
| claude-mem | developer-workflow | n/a | No published benchmark — community project. Reference only, not reproduced. Run --competitors claude-mem against a compatible /v1/search endpoint to live-measure. |
| mem0 | generic-agent | n/a | Mem0 LoCoMo / marketing claims. Reference only — no reproduced number recorded here. Domain (generic-agent) differs from developer-workflow. |
| mempalace | general-lifelog | 0.966 | LongMemEval paper claim (96.6%). Reference only, not reproduced. general-lifelog domain mismatch with developer-workflow; not comparable to harness-mem scores. |
## OpenRouter spend
- cap_usd: 20
- spent_usd: 0.000037
- remaining_usd: 19.999963
- request_count: 4
## Claim safety
- Internal benchmark only. Do not copy scores into README until reproduced on target hardware.
- Published competitor values are reference-only and stay in a separate table from reproduced local runs; never merge them into one ranking.
- Only harness-mem is reproduced by default. External competitors are published(reference-only) unless live-measured opt-in via --competitors.
- harness-mem seeds its own fixtures and retrieves them in-process, so high scores confirm the runner works end-to-end, NOT external competitive superiority.
- Scoring includes a content-substring recall fallback (score-case.ts) that can favor self-seeded adapters like harness-mem; treat reproduced harness-mem scores as implementation sanity, not competitive superiority.
- LoCoMo full is not the primary gate; see Plans.md section 78 domain mismatch decision.
