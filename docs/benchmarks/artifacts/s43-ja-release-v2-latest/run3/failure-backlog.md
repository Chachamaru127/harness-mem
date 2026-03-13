# LoCoMo Failure Backlog

- Generated at: 2026-03-12T16:15:14.933Z
- Source result: /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/docs/benchmarks/artifacts/s43-ja-release-v2-latest/run3/result.json
- Selected failures: 47

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
  - benchmark.runX.score-report.full.json
  - benchmark.repro-report.json
  - benchmark.failure-backlog.judged.json
  - benchmark.failure-backlog.judged.md
  - benchmark.runX.risk-notes.md
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
| temporal_normalization | owner:TBD | 2026-03-19 | todo | pending |
| retrieval_alignment | owner:TBD | 2026-03-22 | todo | pending |
| retrieval_depth | owner:TBD | 2026-03-25 | todo | pending |
| yes_no_decision | owner:TBD | 2026-03-28 | todo | pending |
| list_structuring | owner:TBD | 2026-03-31 | todo | pending |

## Top Failures

| Rank | Cat | QID | F1 | Judge | Strategy | Tags | Question |
| ---: | --- | --- | ---: | --- | --- | --- | --- |
| 1 | cat-2 | long-002 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | temporal_normalization, yes_no_decision, retrieval_alignment, retrieval_depth | ticket heatmap を見たあと、最終的に今のサポート時間はどうなりましたか？ |
| 2 | cat-2 | relative-005 | 0.000 | UNKNOWN | extract:temporal-order-slot -> normalize -> final:temporal-short | temporal_normalization, retrieval_alignment, retrieval_depth | 先に出たあと、遅れたのはどれですか？ |
| 3 | cat-2 | temporal-010 | 0.000 | UNKNOWN | extract:factual-organization-slot -> normalize -> final:factual-normalized-short | temporal_normalization, retrieval_alignment, retrieval_depth | headquarters を移した後も remote-first のままだったのはどのチームですか？ |
| 4 | cat-2 | yesno-002 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | temporal_normalization, yes_no_decision, retrieval_alignment, retrieval_depth | 今もサポートは 24 時間体制ですか？ |
| 5 | cat-2 | yesno-003 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | temporal_normalization, yes_no_decision, retrieval_alignment, retrieval_depth | Starter は今も 29 dollars a month ですか？ |
| 6 | cat-2 | yesno-005 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | temporal_normalization, yes_no_decision, retrieval_alignment, retrieval_depth | SSO のほうが先に出ましたか？ |
| 7 | cat-2 | yesno-007 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | temporal_normalization, yes_no_decision, retrieval_alignment, retrieval_depth | recency は fusion の前にかけていますか？ |
| 8 | cat-2 | yesno-010 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | temporal_normalization, yes_no_decision, retrieval_alignment, retrieval_depth | engineering も headquarters 移転後に remote-first をやめましたか？ |
| 9 | cat-2 | yesno-011 | 0.000 | UNKNOWN | extract:factual-reason-slot -> normalize -> final:factual-normalized-short | temporal_normalization, retrieval_alignment | same-day funnel drops を見逃していたことが変更理由でしたか？ |
| 10 | cat-2 | yesno-012 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | temporal_normalization, yes_no_decision, retrieval_alignment | SAML が最初に出た機能ですか？ |
| 11 | cat-2 | yesno-013 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | temporal_normalization, yes_no_decision, retrieval_alignment, retrieval_depth | default region は今も us-west-2 ですか？ |
| 12 | cat-1 | exact-014 | 0.000 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short | retrieval_alignment | 今も補助通知として残しているものは何ですか？ |
| 13 | cat-1 | prev-007 | 0.000 | UNKNOWN | extract:yes-no-candidates -> normalize -> final:yes-no-binary | yes_no_decision, retrieval_alignment | RRF に変える前はどんな混ぜ方でしたか？ |
| 14 | cat-1 | prev-009 | 0.000 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short | retrieval_alignment | 今の方式に変える前の認証フローは何でしたか？ |
| 15 | cat-1 | prev-013 | 0.000 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short | retrieval_alignment | 以前の default region は何でしたか？ |
| 16 | cat-1 | prev-014 | 0.000 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short | retrieval_alignment | primary channel を見直す前は何だけで送っていましたか？ |
| 17 | cat-3 | why-006 | 0.706 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format | write latency を恒久的に下げたものは何ですか？ |
| 18 | cat-3 | why-001 | 0.800 | UNKNOWN | extract:factual-reason-slot -> normalize -> final:factual-normalized-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format, retrieval_depth | CircleCI から移行した理由は何ですか？ |
| 19 | cat-3 | why-005 | 0.800 | UNKNOWN | extract:factual-reason-slot -> normalize -> final:factual-normalized-short | multi_hop_reasoning, multi_hop_fact_extraction, counterfactual_format, retrieval_depth | SSO が遅れた理由は何ですか？ |
| 20 | cat-2 | relative-012 | 0.080 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization | audit logs の次に出たものは何ですか？ |
| 21 | cat-2 | noisy-008 | 0.211 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization | launch playbook の次に何を localize した？ |
| 22 | cat-2 | temporal-008 | 0.211 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization | launch playbook の次に localize したものは何ですか？ |
| 23 | cat-2 | noisy-006 | 0.211 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization, response_compression | アラートのあと最初にやったこと何？ |
| 24 | cat-2 | temporal-006 | 0.211 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization, response_compression | alert の直後に最初にやったことは何ですか？ |
| 25 | cat-2 | long-006 | 0.667 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short | temporal_normalization | 原因調査を進める前に、alert 直後にまずやったことを一文で言うと何ですか？ |
| 26 | cat-1 | long-013 | 0.133 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization | 最初のリージョンの話は置いて、今の default region だけ短く答えると何ですか？ |
| 27 | cat-1 | prev-015 | 0.154 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization | 最初の setup コマンドが対象にしていたのは何だけでしたか？ |
| 28 | cat-1 | exact-008 | 0.211 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization | 最初に翻訳した docs は何ですか？ |
| 29 | cat-1 | exact-012 | 0.222 | UNKNOWN | extract:temporal-candidates -> normalize -> final:temporal-short | temporal_normalization | Q2 の admin 向け機能で最初に出たのは何ですか？ |
| 30 | cat-1 | current-014 | 0.333 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 今の primary incident channel は何ですか？ |
| 31 | cat-1 | noisy-014 | 0.333 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 今の primary incident channel は？ |
| 32 | cat-1 | exact-009 | 0.364 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short |  | 認証方式の変更時に削除したものは何ですか？ |
| 33 | cat-1 | current-013 | 0.400 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 今の default region はどこですか？ |
| 34 | cat-1 | noisy-013 | 0.400 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | いまの default region どこ？ |
| 35 | cat-1 | current-010 | 0.500 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 今の headquarters はどこですか？ |
| 36 | cat-4 | list-005b | 0.500 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short | list_structuring | 同じ四半期に出す予定だった 2 つは何でしたか？ |
| 37 | cat-1 | long-010 | 0.500 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 昔の所在地の話は置いて、今の headquarters だけ短く答えるとどこですか？ |
| 38 | cat-1 | noisy-010 | 0.500 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | 今の headquarters どこ？ |
| 39 | cat-1 | current-004 | 0.571 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | Enterprise の今の retention はどれくらいですか？ |
| 40 | cat-1 | long-004 | 0.571 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | Free の話はいったん置いて、Enterprise retention の今の値だけ短く答えると何日ですか？ |
| 41 | cat-1 | noisy-004 | 0.571 | UNKNOWN | extract:factual-current-slot -> normalize -> final:factual-normalized-short |  | Enterprise の retention いま何日？ |
| 42 | cat-4 | long-015 | 0.600 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short | list_structuring | 最小検証の話は置いて、今まとめて指定する推奨 setup だけ答えると何ですか？ |
| 43 | cat-4 | noisy-015 | 0.600 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short | list_structuring | 今の推奨 setup の組み合わせは？ |
| 44 | cat-1 | prev-008 | 0.667 | UNKNOWN | extract:factual-previous-slot -> normalize -> final:factual-normalized-short |  | 以前の docs は何語だけでしたか？ |
| 45 | cat-1 | prev-010 | 0.667 | UNKNOWN | extract:factual-previous-slot -> normalize -> final:factual-normalized-short |  | headquarters を移す前はどこでしたか？ |
| 46 | cat-1 | exact-006 | 0.706 | UNKNOWN | extract:factual-top-candidate -> normalize -> final:factual-normalized-short |  | write latency を恒久的に下げたのは何ですか？ |
| 47 | cat-4 | list-012 | 0.769 | UNKNOWN | extract:list-proper-nouns -> normalize -> final:list-compact | list_structuring | Q2 に出した admin 向け機能をすべて挙げてください。 |

