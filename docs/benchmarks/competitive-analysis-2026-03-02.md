# Competitive Analysis Benchmark: harness-mem v0.2.1+23tasks

> **Snapshot date**: 2026-03-02
> **harness-mem version**: v0.2.1 + §23/§24 (commit `e30aa0d`)
> **Previous snapshot**: [`competitive-analysis-2026-03-01.md`](competitive-analysis-2026-03-01.md) (v0.2.1, 84/140)
> **Purpose**: 23タスク実装後の再評価。改善効果と残存ギャップを定量化する。

---

## Methodology

- 14 evaluation axes (1-10 each, max 140 points)
- Each tool researched via GitHub, official docs, blog posts, and web search (2026-03 latest)
- 5 parallel research agents deployed for concurrent evaluation
- Scores reflect publicly available features as of 2026-03-02
- Competitor scores updated from v0.2.1 snapshot based on new evidence

---

## Scorecard (14 Axes)

| # | Axis | harness-mem | mem0 | OpenMemory | supermemory | claude-mem |
|---|------|:-----------:|:----:|:----------:|:-----------:|:----------:|
| 1 | Memory Model | 7 | 8 | **9** | 8 | 8 |
| 2 | Search / Retrieval | 8 | 8 | 8 | **9** | **9** |
| 3 | Storage Flexibility | 7 | **9** | 8 | 7 | 8 |
| 4 | Platform Integration | 8 | **9** | **9** | **9** | 7 |
| 5 | Security | **9** | 8 | 8 | 6 | 7 |
| 6 | UI / Dashboard | 7 | 5 | 7 | **8** | **8** |
| 7 | Consolidation / Dedup | **8** | 7 | 7 | 7 | 7 |
| 8 | Graph / Relations | **8** | **8** | **8** | **8** | 3 |
| 9 | Privacy (Local-first) | 9 | 8 | **10** | 4 | 9 |
| 10 | Multi-user / Team | **7** | **7** | **7** | 6 | 2 |
| 11 | Cloud Sync | 6 | 6 | 6 | **8** | 1 |
| 12 | Multi-modal | 5 | 5 | 6 | 5 | 2 |
| 13 | Benchmark / Eval | 7 | 7 | 4 | **8** | 3 |
| 14 | Temporal Reasoning | 7 | **8** | **8** | 7 | 6 |
| | **Total (/140)** | **103** | **108** | **105** | **100** | **80** |
| | **Pct** | **73.6%** | **77.1%** | **75.0%** | **71.4%** | **57.1%** |

### Ranking

| Rank | Tool | Score | Grade | vs v0.2.1 |
|:----:|------|:-----:|:-----:|:---------:|
| 1 | mem0 | 108/140 | A- | -11 (was 119) |
| 2 | OpenMemory | 105/140 | A- | +9 (was 96) |
| 3 | **harness-mem** | **103/140** | **B+** | **+19 (was 84)** |
| 4 | supermemory | 100/140 | B+ | -3 (was 103) |
| 5 | claude-mem | 80/140 | B- | +14 (was 66) |

---

## Score Change Summary (harness-mem)

| Axis | v0.2.1 | v0.2.1+23tasks | Delta | Improvement Source |
|------|:------:|:--------------:|:-----:|---|
| Search / Retrieval | 7 | **8** | +1 | COMP-001 (3-hop graph) + COMP-002 (adaptive decay) |
| Security | 8 | **9** | +1 | TEAM-004/005/006 (multi-token, access control, PII filter) + review fixes |
| Consolidation | 7 | **8** | +1 | COMP-004 (4 LLM providers) + COMP-006 (compression) + COMP-013 (auto-reflection) |
| Graph / Relations | 5 | **8** | +3 | COMP-001 (3-hop BFS, 5 relation types, weighted scoring) |
| Multi-user / Team | 2 | **7** | +5 | TEAM-003/004/005/009 (user_id/team_id all tables, auth, access control, team feed) |
| Cloud Sync | 4 | **6** | +2 | TEAM-001/002/007/008 (VPS remote bind, Docker, hybrid failover) |
| Multi-modal | 3 | **5** | +2 | COMP-007/008/012 (MD/HTML/text, URL connector, Notion/GDrive) |
| Benchmark / Eval | 4 | **7** | +3 | COMP-009 (LoCoMo framework, multi-adapter, drift report) |
| Temporal Reasoning | 6 | **7** | +1 | COMP-003 (as_of point-in-time queries) |
| **Total** | **84** | **103** | **+19** | |

---

## Competitor Score Changes (vs v0.2.1 snapshot)

### mem0: 119 → 108 (-11)

| Axis | Old | New | Reason |
|------|:---:|:---:|--------|
| Memory Model | 9 | 8 | No cognitive sectors (4-layer hierarchy but flat types) |
| Search | 9 | 8 | Competitors (MemMachine, LiCoMemory) catching up; no longer sole leader |
| UI / Dashboard | 6 | 5 | Cloud UI only; no local dashboard confirmed |
| Consolidation | 9 | 7 | Complex cases accumulate; stale memory management weak |
| Graph | 9 | 8 | Mem0g mature but Pro paywall ($249/mo) limits accessibility |
| Privacy | 6 | 8 | OpenMemory MCP launched (fully local), significantly improved |
| Multi-user | 8 | 7 | Cross-user sharing weak; ACL details not public |
| Cloud Sync | 8 | 6 | Cloud-or-local binary choice; no hybrid sync |

### supermemory: 103 → 100 (-3)

| Axis | Old | New | Reason |
|------|:---:|:---:|--------|
| Privacy | 5 | 4 | Self-hosting now enterprise-only (regression) |
| Multi-modal | 9 | 5 | GitHub Issue #156 unresolved; image support broken |
| Benchmark | 9 | 8 | Surpassed by Mastra (94.87%) and Hindsight (91.4%) |
| UI | 6 | 8 | Embeddable Memory Graph React component (improvement) |

### OpenMemory: 96 → 105 (+9)

| Axis | Old | New | Reason |
|------|:---:|:---:|--------|
| Storage | 7 | 8 | Weaviate integration confirmed stable |
| Platform | 7 | 9 | MCP v2.1.0 with Claude/Cursor/Copilot/Windsurf/Codex |
| Security | 7 | 8 | Bearer auth + AES-GCM + PII scrubbing + tenant isolation |
| Privacy | 9 | 10 | Best-in-class: zero vendor exposure, full audit, Apache 2.0 |
| Multi-user | 4 | 7 | user_id scoping + tenant isolation in BackendMode |
| Cloud Sync | 3 | 6 | Remote mode via Python SDK |

### claude-mem: 66 → 80 (+14)

| Axis | Old | New | Reason |
|------|:---:|:---:|--------|
| Memory Model | 7 | 8 | AI compression matured; lifecycle hooks well-designed |
| Search | 7 | 9 | ChromaDB + FTS5 hybrid proven fast (<200ms); 3-layer efficiency |
| Storage | 6 | 8 | ChromaDB now optional (CLAUDE_MEM_CHROMA_ENABLED flag) |
| Platform | 5 | 7 | Claude Code native plugin; Cursor/Desktop; OpenCode/Copilot PRs |
| Security | 6 | 7 | Private tags + SHA-256 dedup + local-only |
| UI | 6 | 8 | React Web Viewer matured; session registry PR |
| Consolidation | 5 | 7 | SHA-256 dedup + PendingMessageStore |
| Temporal | 3 | 6 | Date context injection + 90-day recency filter |

---

## Per-Axis Breakdown

### 1. Memory Model (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| OpenMemory | 9 | HMD v2: 5 cognitive sectors (episodic/semantic/procedural/emotional/reflective), cognitive router |
| mem0 | 8 | 4-layer hierarchy (User/Session/Agent/Organization), LLM-based ADD/UPDATE/DELETE/NOOP |
| supermemory | 8 | Brain-inspired design, intelligent decay, relation types (updates/extends/derives) |
| claude-mem | 8 | 5 lifecycle hooks, AI compression, structured observations |
| harness-mem | 7 | Observations + links (5 types) + facts (temporal), but no memory type classification |

**Gap**: No cognitive sector classification. No memory type differentiation (episodic vs semantic vs procedural).

### 2. Search / Retrieval (harness-mem: 8)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| supermemory | 9 | <300ms, AST-aware code chunking (+28pt recall), dual vector+graph index |
| claude-mem | 9 | ChromaDB + FTS5 hybrid, <200ms, 3-layer progressive disclosure (2,250 tokens saved) |
| harness-mem | 8 | 6-component hybrid_v3, 3-hop graph boost, adaptive decay scoring, recall trace |
| mem0 | 8 | LoCoMo +26% vs OpenAI, p95 91% reduction, but competitors catching up |
| OpenMemory | 8 | Composite scoring (0.6×sim + 0.2×salience + 0.1×recency + 0.1×link), 110-130ms |

**Improvement**: COMP-001 (multi-hop) and COMP-002 (adaptive decay) moved from 7→8.
**Remaining gap**: Reranker disabled by default. No AST-aware chunking.

### 3. Storage Flexibility (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 9 | 24+ vector DBs (Qdrant/Pinecone/Chroma/pgvector/Milvus...) + 4 graph DBs (Neo4j/Memgraph/Neptune/Kuzu) |
| OpenMemory | 8 | SQLite/PostgreSQL/Weaviate (env var switch) |
| claude-mem | 8 | SQLite + ChromaDB (optional via flag) |
| harness-mem | 7 | SQLite (local) + PostgreSQL (managed/hybrid), sqlite-vec ANN |
| supermemory | 7 | PostgreSQL + pgvector + Cloudflare Workers |

**Gap**: No dedicated vector DB option (Qdrant/Chroma). No pgvector backend for managed mode.

### 4. Platform Integration (harness-mem: 8)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 9 | 20+ integrations, AWS Strands exclusive, MCP server, LangChain/CrewAI/AutoGen/LlamaIndex |
| OpenMemory | 9 | MCP v2.1.0 zero-config, Claude/Cursor/Copilot/Windsurf/Codex, VS Code extension |
| supermemory | 9 | Claude Code/Cursor/OpenCode plugins, Universal MCP, Vercel AI SDK, GitHub/S3/Notion connectors |
| harness-mem | 8 | 6 platforms with deep hook-level integration (Claude/Codex/Cursor/OpenCode/Gemini/Antigravity) |
| claude-mem | 7 | Claude Code native, Cursor, Desktop MCP, OpenCode/Copilot PRs |

**Strength**: Deepest hook-level integration. **Gap**: No framework SDK (LangChain/CrewAI).

### 5. Security (harness-mem: 9)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| harness-mem | 9 | Multi-token auth (timing-safe), PII filter, access control (admin/member), SSRF guard, Docker non-root, 4-expert A/A/A/B review + review fixes |
| mem0 | 8 | SOC 2 Type II + HIPAA, BYOK encryption, on-prem deployment |
| OpenMemory | 8 | Bearer auth, AES-GCM optional, PII scrubbing, tenant isolation, zero vendor exposure |
| claude-mem | 7 | Private tags, SHA-256 dedup, local-only |
| supermemory | 6 | Encrypted at rest/transit, access control, but no SOC2 confirmation |

**Strength**: Most thoroughly reviewed OSS memory tool. TEAM-004/005/006 added enterprise-grade auth.

### 6. UI / Dashboard (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| supermemory | 8 | Embeddable Memory Graph React component, console UI |
| claude-mem | 8 | React Web Viewer, SSE stream, session registry, settings |
| harness-mem | 7 | React+Vite, SSE real-time feed, search with facets, WCAG AA, team feed filter |
| OpenMemory | 7 | Dashboard (localhost:3000), VS Code extension, metrics in progress |
| mem0 | 5 | Cloud dashboard only, no local UI for OSS |

**Gap**: No graph visualization. No embeddable components.

### 7. Consolidation / Dedup (harness-mem: 8)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| harness-mem | 8 | 4 LLM providers, prune/merge/dry_run compression, auto-reflection (conflict detection), Jaccard deduper |
| mem0 | 7 | LLM-based ADD/UPDATE/DELETE/NOOP, but complex case accumulation; no compression engine |
| OpenMemory | 7 | Compression REST API, HMD node-level dedup |
| supermemory | 7 | Knowledge conflict resolution (88.5-89.7%), intelligent decay |
| claude-mem | 7 | SHA-256 content hash, PendingMessageStore dedup |

**Strength**: Only tool with compression engine + auto-reflection + multi-provider LLM.

### 8. Graph / Relations (harness-mem: 8)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| harness-mem | 8 | 3-hop BFS, 5 relation types (updates/extends/derives/follows/shared_entity), weighted scoring (0.10) |
| mem0 | 8 | Mem0g directed labeled graph, multi-hop, but Pro paywall ($249/mo) |
| OpenMemory | 8 | Temporal KG, waypoint trace, single-hop limit |
| supermemory | 8 | Dual vector+graph index, relation types, embeddable graph |
| claude-mem | 3 | No graph support |

**Improvement**: From 5→8. COMP-001 was the biggest single improvement (+3 points).

### 9. Privacy / Local-first (harness-mem: 9)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| OpenMemory | 10 | Zero vendor exposure, full audit, Apache 2.0, complete local control |
| harness-mem | 9 | Completely local SQLite, zero cloud, privacy tags, PII filter |
| claude-mem | 9 | Completely local (~/.claude-mem/), private tags |
| mem0 | 8 | OpenMemory MCP fully local, OSS can be local, but cloud-first focus |
| supermemory | 4 | Cloud-first (Cloudflare), self-hosting enterprise-only |

**Strength**: Top tier. Zero API keys required for core functionality.

### 10. Multi-user / Team (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| harness-mem | 7 | user_id/team_id on all tables, multi-token auth (timing-safe), access control (admin/member/facts), team feed |
| mem0 | 7 | 4-layer separation (User/Session/Agent/Org), but cross-user sharing weak |
| OpenMemory | 7 | user_id scoping, tenant isolation, BackendMode multi-user |
| supermemory | 6 | User-scoped memories, team KB, but RBAC details unclear |
| claude-mem | 2 | No team features |

**Improvement**: From 2→7 (+5). TEAM-003/004/005/009 were transformative.

### 11. Cloud Sync (harness-mem: 6)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| supermemory | 8 | Cloudflare global, connectors (GitHub/S3/Notion/GDrive), Infinite Chat API |
| harness-mem | 6 | PostgreSQL managed mode, Docker compose, VPS hybrid failover |
| mem0 | 6 | Cloud platform OR local (binary choice), no hybrid |
| OpenMemory | 6 | Remote mode via SDK, no managed SaaS |
| claude-mem | 1 | None |

**Gap**: No seamless cross-device sync with conflict resolution.

### 12. Multi-modal (harness-mem: 5)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| OpenMemory | 6 | Connectors (Notion/GDrive/web), URL ingest |
| harness-mem | 5 | MD/HTML/text ingest, URL connector (SSRF-safe), Notion/GDrive connectors |
| mem0 | 5 | Images only (enable_vision), no PDF/audio/video |
| supermemory | 5 | Images/videos listed but Issue #156 unresolved |
| claude-mem | 2 | Text/code only |

**Gap**: No PDF parsing. No image OCR. No audio transcription.

### 13. Benchmark / Eval (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| supermemory | 8 | LongMemEval 81.6-85.2% (surpassed by Mastra 94.87%), open-source MemoryBench |
| harness-mem | 7 | LoCoMo framework (20+ files), multi-adapter (harness/mem0/claude-mem), drift report, EM/F1 |
| mem0 | 7 | LoCoMo arXiv paper, +26% vs OpenAI, but evaluation controversy with Zep |
| OpenMemory | 4 | Internal metrics only (~110-130ms), no standardized benchmarks |
| claude-mem | 3 | No public benchmarks |

**Improvement**: From 4→7. COMP-009 built comprehensive evaluation infrastructure.

### 14. Temporal Reasoning (harness-mem: 7)

| Tool | Score | Key Features |
|------|:-----:|-------------|
| mem0 | 8 | Mem0g temporal reasoning, invalid flags (soft delete), F1 51.55 on temporal tasks |
| OpenMemory | 8 | valid_from/valid_to, time-based decay (3 rates), startTime/endTime query filter |
| harness-mem | 7 | Point-in-time (as_of), valid_from/valid_to on facts, superseded_by, adaptive decay |
| supermemory | 7 | Dual-layer timestamps, 76.7-82% temporal score |
| claude-mem | 6 | Date context injection, 90-day recency filter |

**Gap**: as_of not exposed in MCP tools. No temporal KG visualization.

---

## harness-mem Strengths (to preserve)

| Strength | Score | Unique? |
|----------|:-----:|:-------:|
| 6-platform deep hook integration | 8 | Yes |
| Security hardening (4-expert + review fixes) | 9 | Yes (most reviewed OSS) |
| Privacy / local-first / zero-API | 9 | Shared w/ claude-mem, OpenMemory |
| Consolidation engine (compression + reflection) | 8 | Yes (only tool with all 3) |
| Graph traversal (3-hop BFS) | 8 | Competitive (no paywall unlike mem0) |
| UI accessibility (WCAG AA) | 7 | Yes |
| Multi-user auth (timing-safe, access control) | 7 | Competitive |
| Prompt cache optimization (resume-pack) | - | Yes |
| Low dependency (Bun + SQLite, no Python) | - | Shared w/ supermemory |

## harness-mem Critical Gaps (ordered by impact)

| # | Gap | Current | Target | Delta | Reference Tool |
|---|-----|:-------:|:------:|:-----:|----------------|
| 1 | Cognitive sector classification | 7 | 9 | +2 | OpenMemory (HMD v2) |
| 2 | Cross-device sync + conflict resolution | 6 | 8 | +2 | supermemory |
| 3 | Reranker + AST-aware chunking | 8 | 9 | +1 | supermemory (+28pt recall) |
| 4 | Public benchmark results (LoCoMo/LongMemEval) | 7 | 9 | +2 | supermemory, mem0 |
| 5 | PDF/image ingest | 5 | 8 | +3 | OpenMemory, supermemory |
| 6 | pgvector backend for managed mode | 7 | 8 | +1 | mem0 (24+ DBs) |
| 7 | Framework SDK (LangChain/Vercel AI) | 8 | 9 | +1 | mem0, supermemory |
| 8 | Graph visualization API + component | 7 | 8 | +1 | supermemory (embeddable) |
| 9 | MCP API completeness (as_of, facets, stats) | - | - | - | - |
| 10 | Temporal KG visualization | 7 | 8 | +1 | OpenMemory |
| 11 | Auth context auto-injection | 7 | 8 | +1 | - |

---

## Projected Scores: v0.3.0 Roadmap

| Phase | Tasks | Score Delta | Projected Total |
|-------|-------|:-----------:|:---------------:|
| Current (v0.2.1+23tasks) | — | — | 103/140 (73.6%) |
| + Phase 1 (Cognitive + Search) | NEXT-001~005 | +6 | 109/140 (77.9%) |
| + Phase 2 (Multi-modal + Storage) | NEXT-006~009 | +5 | 114/140 (81.4%) |
| + Phase 3 (Sync + Benchmark) | NEXT-010~014 | +6 | 120/140 (85.7%) |

**Phase 1-3 target**: 120/140 (85.7%) — surpassing mem0 (108) for #1 position.

---

## Tool Profiles (Updated Reference Data)

### mem0
- **GitHub Stars**: ~48,300
- **Funding**: $24M Series A (Oct 2025, Basis Set Ventures)
- **License**: Apache 2.0
- **Stack**: Python, 24+ vector DBs + 4 graph DBs (Neo4j/Memgraph/Neptune/Kuzu)
- **Key Update (2026)**: OpenMemory MCP Server (fully local), AWS Strands exclusive partnership
- **Pricing**: Free (10K/mo), $19/mo (50K), Pro $249/mo (graph memory)
- **Weakness**: Graph memory paywalled, no local UI, complex case memory accumulation

### supermemory
- **GitHub Stars**: ~16,700
- **Funding**: $3M raised
- **License**: MIT
- **Stack**: TypeScript, Cloudflare Workers + pgvector
- **Key Update (2026)**: Embeddable Memory Graph, Cursor/OpenCode plugins, AST-aware code chunking
- **LongMemEval**: GPT-4o 81.6%, GPT-5 84.6%, Gemini-3 85.2% (surpassed by Mastra 94.87%)
- **Weakness**: Self-hosting enterprise-only, multimodal issues (#156)

### OpenMemory (CaviraOSS)
- **GitHub Stars**: ~3,100 (3.4× growth in 3 months)
- **License**: Apache 2.0
- **Stack**: Python, SQLite/PostgreSQL/Weaviate, HMD v2
- **Key Update (2026)**: MCP v2.1.0, Compression REST API, JS SDK standalone, time range queries
- **Strength**: Best privacy (10/10), cognitive architecture (HMD v2)
- **Weakness**: No public benchmarks, small team, SDK breaking changes

### claude-mem
- **GitHub Stars**: ~27,200 (2× growth in 2 months)
- **Version**: v10.4.1
- **License**: AGPL-3.0
- **Stack**: TypeScript, Bun, SQLite + ChromaDB (optional)
- **Key Update (2026)**: Chroma optional flag, branch-scoped memory PR, session registry
- **Strength**: Search quality (9/10), mature lifecycle hooks
- **Weakness**: No graph, no team features, no cloud sync

### harness-mem (this project)
- **Version**: v0.2.1 + §23/§24 (23 tasks)
- **License**: MIT
- **Stack**: TypeScript, Bun, SQLite + PostgreSQL (managed/hybrid)
- **Tests**: 695 pass (unit + integration + benchmark)
- **Key Update (2026-03)**: 3-hop graph, adaptive decay, 4 LLM providers, multi-user auth, Docker deploy, LoCoMo benchmark framework
- **Strength**: Security (9/10), consolidation (8/10), 6-platform deep hooks
- **Weakness**: No cognitive sectors, no PDF, no cross-device sync
