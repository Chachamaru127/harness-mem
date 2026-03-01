# Competitive Analysis Benchmark: harness-mem v0.2.1

> **Snapshot date**: 2026-03-01
> **harness-mem version**: v0.2.1 (commit `4107857`)
> **Purpose**: Re-analysis 時の比較基準。改善前後のスコア変動を追跡する。

---

## Methodology

- 14 evaluation axes (1-10 each, max 140 points)
- "Community/Ecosystem" axis excluded (adoption metrics are not actionable)
- Each tool researched via GitHub, official docs, blog posts, and web search
- Scores reflect publicly available features as of 2026-03-01

---

## Scorecard (14 Axes)

| # | Axis | harness-mem | claude-mem | mem0 | OpenMemory | supermemory |
|---|------|:-----------:|:----------:|:----:|:----------:|:-----------:|
| 1 | Memory Model | 7 | 7 | **9** | **9** | 8 |
| 2 | Search / Retrieval | 7 | 7 | **9** | 8 | **9** |
| 3 | Storage Flexibility | 7 | 6 | **9** | 7 | 7 |
| 4 | Platform Integration | **8** | 5 | **9** | 7 | 7 |
| 5 | Security | **8** | 6 | 8 | 7 | **8** |
| 6 | UI / Dashboard | **7** | 6 | 6 | 6 | 6 |
| 7 | Consolidation / Dedup | 7 | 5 | **9** | 8 | 7 |
| 8 | Graph / Relations | 5 | 3 | **9** | 8 | 6 |
| 9 | Privacy (Local-first) | **9** | **9** | 6 | **9** | 5 |
| 10 | Multi-user / Team | 2 | 2 | **8** | 4 | 6 |
| 11 | Cloud Sync | 4 | 1 | **8** | 3 | **8** |
| 12 | Multi-modal | 3 | 3 | 5 | 7 | **9** |
| 13 | Benchmark / Eval | 4 | 3 | 7 | 5 | **9** |
| 14 | Temporal Reasoning | 6 | 3 | 7 | **8** | **8** |
| | **Total (/140)** | **84** | **66** | **119** | **96** | **103** |
| | **Pct** | **60.0%** | **47.1%** | **85.0%** | **68.6%** | **73.6%** |

### Ranking

| Rank | Tool | Score | Grade |
|:----:|------|:-----:|:-----:|
| 1 | mem0 | 119/140 | S |
| 2 | supermemory | 103/140 | A |
| 3 | OpenMemory (CaviraOSS) | 96/140 | B+ |
| 4 | **harness-mem** | **84/140** | **B-** |
| 5 | claude-mem | 66/140 | C+ |

---

## Per-Axis Breakdown

### 1. Memory Model (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 9 | Semantic/Episodic/Procedural types, LLM-based ADD/UPDATE/DELETE/NOOP, Dynamic Forgetting |
| OpenMemory | 9 | HMD v2: 5 cognitive sectors (episodic/semantic/procedural/emotional/reflective), cognitive router |
| supermemory | 8 | Brain-inspired design, intelligent decay, dual-layer timestamps (documentDate + eventDate) |
| harness-mem | 7 | Observations + links (5 types) + facts (temporal), but no memory type classification |
| claude-mem | 7 | Structured observations (title/narrative/facts), 3-layer progressive disclosure |

**Gap**: No cognitive sector classification. No memory type differentiation (episodic vs semantic vs procedural).

### 2. Search / Retrieval (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 9 | Relevance + importance + recency, p50=0.148s, cosine similarity + graph traversal |
| supermemory | 9 | LongMemEval #1, <300ms latency, semantic search + source chunk injection |
| OpenMemory | 8 | Composite scoring (0.6×sim + 0.2×salience + 0.1×recency + 0.1×link), activation spreading |
| harness-mem | 7 | 6-component hybrid_v3, recall trace, but reranker disabled by default, 1-hop only |
| claude-mem | 7 | Hybrid FTS5 + ChromaDB vector, Smart Explore (tree-sitter AST) |

**Gap**: Reranker disabled by default. Only 1-hop graph boost. No activation spreading.

### 3. Storage Flexibility (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 9 | Qdrant/Pinecone/Chroma/pgvector + Neo4j/Memgraph/Neptune + Redis/Valkey |
| harness-mem | 7 | SQLite (local) + PostgreSQL (managed/hybrid), sqlite-vec ANN |
| OpenMemory | 7 | SQLite (default) + PostgreSQL + Weaviate (config switch) |
| supermemory | 7 | Cloudflare Workers + pgvector |
| claude-mem | 6 | SQLite + ChromaDB (requires Python/uv) |

**Gap**: No dedicated vector DB option (Qdrant/Chroma). No graph DB option (Neo4j).

### 4. Platform Integration (harness-mem: 8)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 9 | Framework-agnostic: LangChain/LangGraph/CrewAI/AutoGen/LlamaIndex + AWS partnership |
| harness-mem | 8 | 6 platforms with deep hook-level integration (Claude/Codex/Cursor/OpenCode/Gemini/Antigravity) |
| OpenMemory | 7 | Claude/Copilot/Cursor/Windsurf/Codex/VS Code + LangChain/CrewAI/AutoGen |
| supermemory | 7 | MCP server + Claude Code/OpenCode plugins + browser extension + many frameworks |
| claude-mem | 5 | Claude Code (primary), Cursor, Codex, OpenClaw |

**Strength**: Deepest hook-level integration across 6 coding tools. Unique advantage.

### 5. Security (harness-mem: 8)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| harness-mem | 8 | Admin token (timing-safe), shell injection prevention, SQL injection prevention, SSRF guard, path traversal prevention. 4-expert review: A/A/A/B |
| mem0 | 8 | SOC 2 Type I, HIPAA, BYOK encryption, zero-trust ACL |
| supermemory | 8 | SOC 2, AES-256, TLS, GDPR/CCPA, confidential computing |
| OpenMemory | 7 | AES-GCM encryption, API key auth, rate limiting |
| claude-mem | 6 | Local-only, privacy tags, no admin auth mechanism |

**Strength**: Most thoroughly reviewed OSS memory tool (3 rounds, 4 experts).

### 6. UI / Dashboard (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| harness-mem | 7 | React+Vite, SSE real-time feed, search with facets, session threads, environment panel, WCAG AA |
| claude-mem | 6 | React Web Viewer, SSE stream, settings, beta channel toggle |
| mem0 | 6 | Cloud dashboard (good), OSS has no UI. OpenMemory MCP has Next.js UI |
| OpenMemory | 6 | Web UI + VS Code extension |
| supermemory | 6 | Web UI + Chrome extension + Raycast |

**Strength**: Only tool with accessibility hardening (WCAG AA, roving tabindex, focus-visible).

### 7. Consolidation / Dedup (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 9 | LLM-based ADD/UPDATE/DELETE/NOOP, dynamic forgetting, 60% storage reduction, cosine ≥0.85 merge |
| OpenMemory | 8 | Memory Compression Engine (5 algorithms), auto-reflection at intervals |
| harness-mem | 7 | Heuristic + LLM diff extraction (Ollama), Jaccard deduper, temporal facts |
| supermemory | 7 | Intelligent decay, contradiction resolution |
| claude-mem | 5 | SHA-256 content hash dedup only, no LLM consolidation |

**Gap**: Ollama-only LLM. No memory compression engine. No auto-reflection.

### 8. Graph / Relations (harness-mem: 5)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 9 | Neo4j/Memgraph graph, entity triples (source→relation→dest), temporal reasoning, multi-hop |
| OpenMemory | 8 | Temporal knowledge graph, waypoint trace, activation spreading |
| supermemory | 6 | Graph component for entity relationships |
| harness-mem | 5 | mem_links with 5 relation types, but 1-hop only, no multi-hop, no activation spreading |
| claude-mem | 3 | No explicit graph/relation support |

**Gap**: Biggest weakness. 1-hop only. No multi-hop reasoning. No activation spreading. No waypoint trace.

### 9. Privacy / Local-first (harness-mem: 9)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| harness-mem | 9 | Completely local SQLite, zero cloud, privacy tags (private/sensitive/redact/block) |
| claude-mem | 9 | Completely local (~/.claude-mem/), privacy `<private>` tags |
| OpenMemory | 9 | Local-first default (SQLite), optional cloud, AES-GCM encryption option |
| mem0 | 6 | OSS can be local, but cloud-first focus. OpenMemory MCP is local Docker |
| supermemory | 5 | Cloud-first (Cloudflare), self-hosting enterprise-only |

**Strength**: Top tier. No cloud dependency. Zero API keys required for core functionality.

### 10. Multi-user / Team (harness-mem: 2)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 8 | user_id / agent_id scoping, multi-agent shared memory, ACL |
| supermemory | 6 | User-scoped memories |
| OpenMemory | 4 | API key auth, basic scoping |
| harness-mem | 2 | Project-level isolation only. No user_id. No team features |
| claude-mem | 2 | No team features |

**Gap**: No user-level scoping. No team memory sharing.

### 11. Cloud Sync (harness-mem: 4)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 8 | Cloud platform, managed DB, global availability |
| supermemory | 8 | Cloudflare global distribution |
| harness-mem | 4 | PostgreSQL managed mode exists but no true cross-device sync |
| OpenMemory | 3 | PostgreSQL option theoretically enables it |
| claude-mem | 1 | None |

**Gap**: Managed mode exists but no seamless cross-device experience.

### 12. Multi-modal (harness-mem: 3)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| supermemory | 9 | Text, URL, PDF, CSV, images (OCR), video (transcription), email |
| OpenMemory | 7 | PDF, DOCX, web pages, audio/transcripts |
| mem0 | 5 | Primarily text, some document support |
| harness-mem | 3 | Text/code/markdown only |
| claude-mem | 3 | Text/code only |

**Gap**: No PDF/image/audio/video ingestion.

### 13. Benchmark / Eval (harness-mem: 4)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| supermemory | 9 | LongMemEval #1 (81.6%), LoCoMo #1, ConvoMem #1 |
| mem0 | 7 | LOCOMO benchmark, F1 scores published, research paper (arXiv) |
| OpenMemory | 5 | Performance tiers documented, no public benchmarks |
| harness-mem | 4 | Internal search quality tests, LOCOMO-style benchmark (IMP-006), but not public |
| claude-mem | 3 | Claims 10x efficiency, no independent verification |

**Gap**: IMP-006 benchmark exists but not in standard format (LongMemEval). Not published.

### 14. Temporal Reasoning (harness-mem: 6)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| OpenMemory | 8 | valid_from/valid_to, temporal knowledge graph, point-in-time queries |
| supermemory | 8 | Dual-layer timestamps (documentDate + eventDate), temporal prioritization |
| mem0 | 7 | Mem0g temporal reasoning, "invalid" flags for history preservation |
| harness-mem | 6 | valid_from/valid_to on facts, superseded_by, but no point-in-time queries |
| claude-mem | 3 | Timeline display but no temporal management |

**Gap**: Schema supports temporal facts but no point-in-time query API.

---

## harness-mem Strengths (to preserve)

| Strength | Score | Unique? |
|----------|:-----:|:-------:|
| 6-platform deep hook integration | 8 | Yes |
| Privacy / local-first / zero-API | 9 | Shared w/ claude-mem, OpenMemory |
| Security hardening (4-expert A/A/A/B) | 8 | Yes (most reviewed OSS) |
| UI accessibility (WCAG AA) | 7 | Yes |
| Prompt cache optimization (resume-pack) | - | Yes |
| Write Queue + 503 overflow protection | - | Yes |
| Low dependency (Bun + SQLite, no Python) | - | Shared w/ supermemory |

## harness-mem Critical Gaps (ordered by impact)

| # | Gap | Current | Target | Reference Tool | Plan Task |
|---|-----|:-------:|:------:|----------------|-----------|
| 1 | Graph traversal depth | 5 (1-hop) | 8 (multi-hop + waypoint) | mem0, OpenMemory | COMP-001 |
| 2 | Adaptive memory decay | 0 (none) | 8 (3-tier) | OpenMemory, supermemory | COMP-002 |
| 3 | LLM provider flexibility | Ollama only | 4 providers | mem0 (any LLM) | COMP-004 |
| 4 | Multi-modal ingestion | text only | PDF/MD/HTML/URL | supermemory, OpenMemory | COMP-007, COMP-008 |
| 5 | Public benchmarks | internal only | LongMemEval format | supermemory (#1) | COMP-009 |
| 6 | Embedding catalog | 3 models | 6+ models | OpenMemory (6+ providers) | COMP-005 |
| 7 | Multi-user/team | none | user_id scoping | mem0 | COMP-011 |
| 8 | MCP server exposure | REST only | MCP + REST | OpenMemory, mem0 | COMP-010 |
| 9 | Memory compression | none | merge/summarize/prune | OpenMemory (5 algos) | COMP-006 |
| 10 | Point-in-time queries | schema only | API support | OpenMemory | COMP-003 |
| 11 | Auto-reflection | none | interval-based | OpenMemory | COMP-013 |

## Projected Scores After §23 Implementation

| Phase | Tasks | Score Delta | Projected Total |
|-------|-------|:-----------:|:---------------:|
| Baseline (v0.2.1) | — | — | 84/140 (60.0%) |
| + Phase 1 (Graph + Decay) | COMP-001,002,003 | +12 | 96/140 (68.6%) |
| + Phase 2 (LLM + Embed) | COMP-004,005 | +8 | 104/140 (74.3%) |
| + Phase 3 (Compress + Modal) | COMP-006,007,008 | +10 | 114/140 (81.4%) |
| + Phase 4 (Bench + MCP) | COMP-009,010 | +8 | 122/140 (87.1%) |
| + Phase 5 (Team + Connectors) | COMP-011,012,013 | +7 | 129/140 (92.1%) |

**Phase 1-4 target**: 122/140 (87.1%) — surpassing supermemory (103) and approaching mem0 (119)

---

## Tool Profiles (Reference Data)

### claude-mem
- **Repo**: github.com/thedotmack/claude-mem (31,900 stars)
- **Author**: Alex Newman (@thedotmack)
- **License**: AGPL-3.0 (ragtime/ = PolyForm Noncommercial)
- **Stack**: TypeScript, Bun, SQLite + ChromaDB (Python/uv), port 37777
- **Hooks**: SessionStart, UserPromptSubmit, PostToolUse, Stop/Summary, SessionEnd
- **AI Providers**: Claude SDK, Gemini API, OpenRouter
- **Key Feature**: Smart Explore (tree-sitter AST analysis)
- **Known Issues**: ChromaDB Python dependency, Endless Mode 60-90s delay, Windows instability

### mem0
- **Repo**: github.com/mem0ai/mem0 (48,300 stars)
- **Company**: Mem0 Inc ($24M raised, YC S24)
- **License**: Apache 2.0
- **Stack**: Python, Qdrant/Pinecone/Chroma + Neo4j/Memgraph + Redis
- **Integrations**: LangChain, LangGraph, CrewAI, AutoGen, LlamaIndex, AWS Agent SDK (exclusive)
- **Key Feature**: Hybrid vector + graph memory, LLM-based ADD/UPDATE/DELETE/NOOP
- **Benchmark**: LOCOMO F1 published, p50=0.148s retrieval latency
- **Compliance**: SOC 2 Type I, HIPAA

### OpenMemory (CaviraOSS)
- **Repo**: github.com/CaviraOSS/OpenMemory (3,500 stars)
- **Author**: CaviraOSS (3 developers)
- **License**: Apache 2.0 / MIT (inconsistent in sources)
- **Stack**: Python, SQLite/PostgreSQL + Weaviate, HMD v2 architecture
- **Key Feature**: 5 cognitive sectors, adaptive decay (3-tier), waypoint trace
- **Embedding**: OpenAI/Gemini/AWS/Ollama/local/synthetic (6 providers)
- **Known Issues**: Small team, SDK breaking changes (v1.3.0), single-hop waypoint only

### supermemory
- **Repo**: github.com/supermemoryai/supermemory (16,700 stars)
- **Company**: Supermemory Inc ($3M raised)
- **License**: MIT
- **Stack**: TypeScript, Cloudflare Workers + pgvector
- **Key Feature**: LongMemEval #1 (81.6%), <300ms latency, dual-layer timestamps
- **Integrations**: Vercel AI SDK, LangChain, OpenAI Agents SDK, MCP, browser extension
- **Multi-modal**: PDF, CSV, images (OCR), video (transcription), email
- **Known Issues**: Self-hosting enterprise-only, proxy latency overhead

### harness-mem (this project)
- **Version**: v0.2.1 (2026-03-01)
- **License**: MIT
- **Stack**: TypeScript, Bun, SQLite + PostgreSQL (managed/hybrid)
- **Platforms**: Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Antigravity (6)
- **Key Feature**: Cross-tool memory, resume-pack prompt cache, 6-component hybrid search
- **Embedding**: Ruri V3-30M (JP) / GTE-small / E5-small-v2 (local ONNX)
- **Security**: 4-expert Harness review A/A/A/B (v0.2.1)
- **Tests**: 402 test cases (unit + integration)
