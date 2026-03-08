# LoCoMo Failure Backlog

- Generated at: 2026-03-06T03:27:33.079Z
- Source result: /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/docs/benchmarks/artifacts/s39-shadow-query-pack-latest/result.json
- Selected failures: 20

## Action Buckets

- temporal_normalization: Normalize and canonicalize time expressions before final answer generation.
- temporal_reference_anchor: Resolve relative temporal words against conversation timestamp and persist the anchor.
- multi_hop_reasoning: Combine top evidence from multiple observations and output causal summary.
- multi_hop_fact_extraction: Stage multi-hop answers through fact JSON extraction before final one-sentence output.
- counterfactual_format: Force counterfactual output to 'Conclusion. Reason: ...' format.
- yes_no_decision: Add contradiction/negation detection for yes/no responses.
- location_extraction: Extract location entities from top evidence and prefer shortest answer phrase.
- entity_extraction: Add entity-focused extraction rule for identity/relationship questions.
- list_structuring: Return comma-separated compact lists instead of conversational prose.
- retrieval_alignment: Increase candidate depth and query variants for zero-overlap failures.
- retrieval_depth: Increase search depth and keep at least top-3 quality candidates for cat-2/cat-3.
- evidence_coverage: Expand evidence merge to include multiple observation IDs before synthesis.
- response_compression: Trim filler text and keep one concise evidence-backed sentence.

## Reviewer Evidence Spec

- Required Artifacts:
  - locomo10.runX.score-report.full.json
  - locomo10.repro-report.json
  - locomo10.failure-backlog.judged.json
  - locomo10.failure-backlog.judged.md
  - locomo10.runX.risk-notes.md
- Rejection Conditions:
  - same dataset / judge / category constraints are not met
  - missing required artifacts
  - 3-run stats (mean/stddev/min/max) are incomplete
  - gate thresholds (Judge mean/stddev/p95/token avg) are unmet
- Comparison Requirements:
  - same dataset path
  - same judge model/temperature/prompt
  - same category scope (cat-1..cat-4 for Judge)

## Improvement Tickets

| Tag | Owner | Due | Status | Re-evaluation |
| --- | --- | --- | --- | --- |
| retrieval_alignment | owner:TBD | 2026-03-13 | todo | pending |
| temporal_normalization | owner:TBD | 2026-03-16 | todo | pending |
| multi_hop_reasoning | owner:TBD | 2026-03-19 | todo | pending |
| multi_hop_fact_extraction | owner:TBD | 2026-03-22 | todo | pending |
| counterfactual_format | owner:TBD | 2026-03-25 | todo | pending |

## Top Failures

| Rank | Cat | QID | F1 | Judge | Strategy | Tags | Question |
| ---: | --- | --- | ---: | --- | --- | --- | --- |
| 1 | cat-3 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format, retrieval_alignment | What made me switch away from CircleCI? |
| 2 | cat-3 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format, retrieval_alignment | What request triggered the enterprise retention change? |
| 3 | cat-3 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format, retrieval_alignment | Why was SSO delayed? |
| 4 | cat-3 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format, retrieval_alignment | What problem made me replace the nightly refresh? |
| 5 | cat-2 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-short | temporal_normalization, retrieval_alignment | Which report did I review before narrowing support hours? |
| 6 | cat-2 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | temporal_normalization, retrieval_alignment | What was my first response after the alert fired? |
| 7 | cat-2 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | temporal_normalization, retrieval_alignment | What did I localize after the launch playbook? |
| 8 | cat-2 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short | temporal_normalization, retrieval_alignment | Which team stayed remote-first after the headquarters move? |
| 9 | cat-2 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | temporal_normalization, retrieval_alignment | Which feature shipped last? |
| 10 | cat-1 | q1 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | retrieval_alignment | What CI system do I use now? |
| 11 | cat-1 | q1 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-short | retrieval_alignment | What support window do I use now? |
| 12 | cat-1 | q1 | 0.000 | UNKNOWN | extract:factual-numeric-slot -> normalize -> final:factual-numeric-slot | retrieval_alignment | What does Starter cost now? |
| 13 | cat-1 | q1 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-short | retrieval_alignment | What is the current dashboard refresh cadence? |
| 14 | cat-4 | q1 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | list_structuring, retrieval_alignment | Which admin features shipped in Q2? |
| 15 | cat-1 | q2 | 0.000 | UNKNOWN | extract:factual-numeric-slot -> normalize -> final:factual-numeric-slot | retrieval_alignment | Which feature was added to Starter with the price change? |
| 16 | cat-1 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | retrieval_alignment | What signal do I apply after fusion? |
| 17 | cat-1 | q2 | 0.000 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase | retrieval_alignment | What did I remove during the auth migration? |
| 18 | cat-3 | q1 | 0.778 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format | What permanently reduced write latency? |
| 19 | cat-2 | q1 | 0.667 | UNKNOWN | extract:factual-organization-slot -> normalize -> final:factual-normalized-short | temporal_normalization | Which shipped before the other, SSO or team workspaces? |
| 20 | cat-1 | q1 | 0.333 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-core-phrase |  | What authentication flow do I use now? |

