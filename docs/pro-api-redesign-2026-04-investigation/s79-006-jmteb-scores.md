# S79-006: JMTEB Scores for Japanese Embedding Models

**Task**: Authoritative JMTEB scores for the Free (`ruri-v3-30m`) → Pro (`ruri-v3-310m`) JA-route upgrade, plus multilingual alternatives. Every cell source-linked, fetched 2026-04-11.

## Headline table — JMTEB v1 (5 tasks, higher is better)

| Model | #Params | Dim | Avg. | Retrieval | Classification | STS | Clustering | Reranking | PairClf |
|---|---|---|---|---|---|---|---|---|---|
| cl-nagoya/ruri-v3-30m (Free today) | 37M | 256 | **74.51** | **78.08** | 74.80 | 82.48 | 52.12 | 93.00 | 62.40 |
| cl-nagoya/ruri-v3-130m | 132M | 512 | 76.55 | 81.89 | 77.16 | 79.25 | 55.36 | 93.31 | 62.26 |
| cl-nagoya/ruri-v3-310m (Pro candidate) | 315M | 768 | **77.24** | **81.89** | 78.66 | 81.22 | 55.69 | 93.43 | 62.60 |
| cl-nagoya/ruri-large (v1, older flagship) | 337M | 1024 | 73.31 | 73.02 | 77.43 | 83.13 | 51.82 | 92.99 | 62.29 |
| cl-nagoya/ruri-large-v2 | 337M | 1024 | 74.55 | 76.34 | 77.18 | 83.17 | 52.14 | 93.21 | 62.27 |
| intfloat/multilingual-e5-small (today's general route) | 118M | 384 | 69.52 | 67.27 | 67.62 | 80.07 | 46.91 | 93.03 | 62.19 |
| intfloat/multilingual-e5-large | 560M | 1024 | 71.65 | 70.98 | 72.89 | 79.70 | 51.24 | 92.96 | 62.15 |
| OpenAI text-embedding-3-small | — | 1536 | 70.86 | 66.39 | 73.06 | 79.46 | 51.06 | 92.92 | 62.27 |
| OpenAI text-embedding-3-large | — | 3072 | 73.97 | 74.48 | 77.58 | 82.52 | 53.32 | 93.58 | 62.35 |
| BAAI/bge-m3 | 568M | 1024 | (not in Ruri-v3 card; omitted) | ~71.4* | (not found; omitted) | (not found; omitted) | (not found; omitted) | (not found; omitted) | (not found; omitted) |
| intfloat/multilingual-e5-large-instruct | 560M | 1024 | (not found on authoritative JMTEB leaderboard; omitted) | — | — | — | — | — | — |

\* BGE-M3 retrieval-only figure 0.714 (≈71.4) is from the JaColBERTv2.5 paper — JMTEB retrieval average in BGE-M3's "all" (dense+sparse+multi-vec) fusion mode, not pure dense. Treat as approximate.

All Ruri / mE5 / OpenAI rows come from the authoritative table on the `cl-nagoya/ruri-v3-310m` card. The JMTEB repo README redirects to the MTEB leaderboard (Japanese section) and no longer maintains a standalone results page.

## The number that matters most: retrieval delta 30m → 310m

- ruri-v3-30m retrieval: **78.08** → ruri-v3-310m retrieval: **81.89**
- **Absolute delta: +3.81 points (+4.88% relative)**. Average: +2.73 (74.51 → 77.24). Classification: +3.86. Clustering: +3.57.

Retrieval ceiling: ruri-v3-130m *also* hits 81.89 — the 310m gives **zero additional retrieval headroom over the 130m**. The 310m's gain over 130m is almost entirely STS (+1.97), Classification (+1.50), Clustering (+0.33). For a pure retrieval workload, **130m is Pareto-competitive with 310m on retrieval** at ~42% of the params.

## The single most relevant comparison model

`intfloat/multilingual-e5-large` is the honest competitor — the model most teams reach for when they don't want to ship a JA-specific route. Retrieval: **70.98** — **10.91 below ruri-v3-310m** and 7.10 below ruri-v3-30m. Ruri v3-310m is unambiguously a retrieval upgrade over harness-mem's current multilingual baseline.

## What this means for the Pro tier pitch

1. **Defensible claim**: "Pro JA retrieval ~5% higher than Free on JMTEB (81.89 vs 78.08), ~15% higher than the multilingual baseline (70.98)." Avoid leading with classification/clustering — retrieval is what harness-mem does.
2. **Product risk**: ruri-v3-130m matches 310m on retrieval at ~42% of the params. If disk/RAM matters for self-hosted Pro, 130m may be the better default; reserve 310m as an explicit "max quality" opt-in. S79-001 should re-examine the 310m choice.
3. **Free is already good**: ruri-v3-30m's 78.08 retrieval beats multilingual-e5-large (70.98) and text-embedding-3-large (74.48) *at 37M params*. Don't cannibalize it in marketing.
4. **OpenAI gap**: ruri-v3-310m beats text-embedding-3-large by +7.41 retrieval / +3.27 average on Japanese — the most quotable number for OpenAI-comparative copy.

## Caveats

- JMTEB v1 has 5 tasks / 15 (now 28) datasets; numbers shift between versions. The Ruri-v3 card uses v1 conventions; the LREC 2026 paper formalizes v2.
- The Ruri team re-ran competitors themselves for their v3 card, which is why those rows are internally consistent.
- BGE-M3 and multilingual-e5-large-instruct are omitted from Ruri's card. The 0.714 BGE-M3 datapoint is from JaColBERTv2.5's paper, using BGE-M3's "all" fusion mode — not directly comparable to single-dense numbers.
- None of these include reranker-stage scores; harness-mem's pipeline is dense-only today.

## Sources (fetched 2026-04-11)

- Ruri v3-310m card (primary JMTEB table): https://huggingface.co/cl-nagoya/ruri-v3-310m
- Ruri v3-30m / v3-130m / ruri-large cards: https://huggingface.co/cl-nagoya/ruri-v3-30m · https://huggingface.co/cl-nagoya/ruri-v3-130m · https://huggingface.co/cl-nagoya/ruri-large
- Ruri v1 paper (Tsukagoshi & Sasano 2024), Table 10 cross-check: https://arxiv.org/html/2409.07737v1
- JMTEB repo (confirms leaderboard moved to MTEB): https://github.com/sbintuitions/JMTEB
- BGE-M3 0.714 retrieval datapoint (JaColBERTv2.5): https://arxiv.org/pdf/2407.20750
- BAAI/bge-m3 card (no JMTEB numbers published): https://huggingface.co/BAAI/bge-m3
