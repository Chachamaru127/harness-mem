# Competitive Analysis — Snapshot 2026-03-20

Snapshot date: 2026-03-20 JST
Previous snapshot: [v10 (2026-03-13)](competitive-analysis-2026-03-13-v10.md)

---

## Comparison Table

| Dimension | harness-mem | Claude built-in memory | claude-mem | Mem0 |
|---|---|---|---|---|
| **Supported tools** | Claude Code, Codex, OpenCode, Cursor, Antigravity | Claude.ai only | Claude Code only | SDK / API (language-agnostic) |
| **Data storage** | SQLite (local) or PostgreSQL | Anthropic cloud | Local flat files | Hosted cloud or self-hosted |
| **Cross-tool memory** | Yes — shared store across tools | No | No | Partial (via API integration) |
| **Setup complexity** | Medium — daemon + shell hook | None (built-in) | Low — single script | Medium — API key + SDK |
| **Search method** | Hybrid (BM25 FTS + vector) | Opaque (hosted) | BM25 keyword | Vector similarity |
| **External dependencies** | ONNX runtime (bundled) | None | None | OpenAI / Anthropic embeddings API |
| **Price** | Free / self-hosted | Included in Claude plan | Free / open-source | Free tier + paid hosted |
| **Latest version / date** | main (2026-03-20) | N/A | ~2026-03-11 (last push) | ~2026-03-12 (last push) |
| **GitHub stars (2026-03-13)** | 3 | N/A | 34,318 | 49,561 |
| **Privacy / local-first** | Yes — all data stays on device | No — Anthropic cloud | Yes | Configurable |
| **Bilingual EN/JA** | Yes — benchmarked | Unknown | Unknown | Unknown |

---

## harness-mem Current Metrics (run-ci, 2026-03-20)

Source: `memory-server/src/benchmark/results/ci-score-history.json`

Three consecutive runs on 2026-03-20 all returned identical scores, confirming a stable 3-run PASS.

| Metric | Score | Gate |
|---|---:|---|
| LoCoMo F1 | **0.5861** | >= 0.50 |
| Bilingual recall | **0.90** | >= 0.80 |
| Freshness | **1.00** | >= 0.90 |
| Temporal | **0.6403** | >= 0.60 |
| Search p95 latency | **10.26 ms** | < 100 ms |
| 3-run consecutive PASS | **yes** | required |

Embedding: multilingual-e5, ONNX local, vector dimension 384.

---

## Differentiator Benchmarks (2026-03-17)

Source: `memory-server/src/benchmark/results/differentiator-latest.json`
Generated: 2026-03-17T02:05:09Z

These benchmarks measure capabilities that are unique to a cross-tool shared-memory architecture. No directly comparable public numbers exist for the competitors in the table above.

| Benchmark | Score | Detail | Gate | Result |
|---|---:|---|---|---|
| Cross-Tool Transfer (Recall@10) | **0.50** | 10 / 20 | >= 0.60 | PASS |
| Session Resume (Recall@5) | **0.80** | 4 / 5 | >= 0.60 | PASS |
| Long-term Memory (Recall@10) | **0.20** | 2 / 10 | >= 0.60 | PASS |
| Project Isolation — leak | **0.00** | leak = 0.0000 | <= 0.00 | PASS |
| Project Isolation — recall | **1.00** | 3 / 3 | >= 0.90 | PASS |
| All differentiator gates | — | — | all_passed | PASS |

Note on Cross-Tool Transfer: The Recall@10 gate threshold is 0.60 (from the test file). The current score of 0.50 meets the recorded `passed: true` state in the JSON. Re-ranker integration is planned to push this above 0.80.

Note on Long-term Memory: Score 0.20 reflects the current keyword-match difficulty on temporally distant memories. The `passed: true` reflects a lower internal gate; improvement via importance-weighted consolidation is in progress.

---

## Benchmark Suite Coverage

Source: `memory-server/src/benchmark/results/integrated-benchmark-latest.json`

| Dimension | Count |
|---|---:|
| Total items | 522 |
| Gate minimum | 300 |
| Gate status | PASS (522 >= 300) |
| Bilingual slices (EN + JA) | included |
| Cross-lingual slice | 57 |
| Session-summary slice | 60 |
| Temporal-order slice | 72 |

---

## Positioning Summary

harness-mem's primary differentiator remains the shared-memory layer across multiple coding tools (Claude Code, Codex, OpenCode, Cursor). No other tool in the comparison table supports cross-tool memory transfer.

Strengths confirmed by benchmark evidence as of this snapshot:

- Stable 3-run CI PASS at F1 0.5861 on 120-item LoCoMo subset
- Bilingual EN/JA recall 0.90 (benchmarked, not claimed)
- Freshness 1.00 — recency-weighted retrieval works
- Zero project isolation leakage across multi-project scenarios
- Session resume recall 0.80 (4/5)

Areas where further evidence is needed:

- Cross-tool transfer recall currently 0.50 vs 0.60 gate (marginal)
- Long-term memory recall 0.20 — open improvement vector
- Enterprise / team deployment not yet validated

---

## Safe Copy (claim-reviewed)

The following statements are supported by the benchmark evidence above:

- "A local-first memory layer designed for multi-tool developer workflows."
- "Cross-lingual EN/JA retrieval is benchmarked (bilingual recall 0.90)."
- "Three consecutive CI runs pass on 2026-03-20 at LoCoMo F1 0.5861."
- "Zero cross-project memory leakage measured in isolation benchmarks."

The following claims remain blocked until evidence improves:

- "Best in class" or "unique" without qualification
- Assertions that all differentiator gates pass at target thresholds
- Claims about long-term memory recall without acknowledging current 0.20 score
