# Internal Memory Benchmark Scorecard
Generated: 2026-05-29T01:48:23.061Z
Run ID: internal-memory-f6c923c0-b0f6-4113-af56-5dfc87056414
Git SHA: 6121b08
## Reproduced (locally measured — same dataset / scorer / manifest)
| Competitor | Status | JA+Mixed score | Public R@10 | JA R@10 | Mixed R@10 | P95 latency (ms) |
|---|---:|---:|---:|---:|---:|---:|
| harness-mem | completed | 1.000 | 1.000 | 1.000 | 1.000 | 6.2 |
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
- spent_usd: 0.000154
- remaining_usd: 19.999846
- request_count: 16
## Claim safety
- Internal benchmark only. Do not copy scores into README until reproduced on target hardware.
- Published competitor values are reference-only and stay in a separate table from reproduced local runs; never merge them into one ranking.
- Only harness-mem is reproduced by default. External competitors are published(reference-only) unless live-measured opt-in via --competitors.
- harness-mem seeds its own fixtures and retrieves them in-process, so high scores confirm the runner works end-to-end, NOT external competitive superiority.
- Scoring includes a content-substring recall fallback (score-case.ts) that can favor self-seeded adapters like harness-mem; treat reproduced harness-mem scores as implementation sanity, not competitive superiority.
- LoCoMo full is not the primary gate; see Plans.md section 78 domain mismatch decision.
