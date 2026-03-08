# LoCoMo Failure Backlog

- Generated at: 2026-03-06T05:17:56.645Z
- Source result: /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/docs/benchmarks/artifacts/s40-ja-release-latest/run1/result.json
- Selected failures: 14

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
| temporal_normalization | owner:TBD | 2026-03-13 | todo | pending |
| retrieval_depth | owner:TBD | 2026-03-16 | todo | pending |
| multi_hop_reasoning | owner:TBD | 2026-03-19 | todo | pending |
| multi_hop_fact_extraction | owner:TBD | 2026-03-22 | todo | pending |
| counterfactual_format | owner:TBD | 2026-03-25 | todo | pending |

## Top Failures

| Rank | Cat | QID | F1 | Judge | Strategy | Tags | Question |
| ---: | --- | --- | ---: | --- | --- | --- | --- |
| 1 | cat-2 | temporal-010 | 0.000 | UNKNOWN | extract:factual-organization-slot -> normalize -> final:factual-normalized-short | temporal_normalization, retrieval_alignment, retrieval_depth | headquarters を移した後も remote-first のままだったのはどのチームですか？ |
| 2 | cat-2 | temporal-015 | 0.000 | UNKNOWN | extract:factual-object-slot -> normalize -> final:factual-normalized-short | temporal_normalization, retrieval_alignment, retrieval_depth, evidence_coverage | 最初はどのツールだけを対象にしていましたか？ |
| 3 | cat-3 | why-006 | 0.706 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format | write latency を恒久的に下げたものは何ですか？ |
| 4 | cat-3 | why-001 | 0.800 | UNKNOWN | extract:factual-reason-slot -> normalize -> final:factual-normalized-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format, retrieval_depth | CircleCI から移行した理由は何ですか？ |
| 5 | cat-3 | why-005 | 0.800 | UNKNOWN | extract:factual-reason-slot -> normalize -> final:factual-normalized-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format, retrieval_depth | SSO が遅れた理由は何ですか？ |
| 6 | cat-2 | temporal-008 | 0.211 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization | launch playbook の次に localize したものは何ですか？ |
| 7 | cat-2 | temporal-006 | 0.211 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization, response_compression | alert の直後に最初にやったことは何ですか？ |
| 8 | cat-2 | temporal-005 | 0.800 | UNKNOWN | extract:temporal-order-slot -> normalize -> final:temporal-short | temporal_normalization, retrieval_depth | SSO と team workspaces では、どちらが先に出ましたか？ |
| 9 | cat-1 | current-014 | 0.333 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 今の primary incident channel は何ですか？ |
| 10 | cat-1 | exact-009 | 0.364 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short |  | 認証方式の変更時に削除したものは何ですか？ |
| 11 | cat-1 | current-013 | 0.400 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 今の default region はどこですか？ |
| 12 | cat-1 | current-010 | 0.500 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 今の headquarters はどこですか？ |
| 13 | cat-1 | current-004 | 0.571 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | Enterprise の今の retention はどれくらいですか？ |
| 14 | cat-4 | list-012 | 0.769 | UNKNOWN | extract:list-proper-nouns -> normalize -> final:list-compact | list_structuring | Q2 に出した admin 向け機能をすべて挙げてください。 |

