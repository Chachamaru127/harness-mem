# Competitive Audit - 2026-05-07

Task: S108-010 competitive evidence snapshot refresh

Checked at: 2026-05-07T01:41:15Z

Scope: mem0, supermemory, claude-mem, Basic Memory, mcp-memory-service, Graphiti/Zep, Letta, Pieces.

Method:

- GitHub stars, license, repo status, and update timestamps were fetched live with the GitHub API.
- Positioning was checked against official README, docs, or product pages only.
- This is a positioning and claim-risk audit, not a benchmark rerun.
- `Plans.md` is intentionally not edited in this worker pass; parent integration should update it.

## Evidence Matrix

| Project | GitHub API repo | Stars | License | Official positioning | Claim risk for harness-mem README | Source URL / checked_at |
|---|---:|---:|---|---|---|---|
| mem0 | `mem0ai/mem0` | 54,944 | Apache-2.0 | Universal memory layer for AI agents; user/session/agent memory, library, self-hosted server, cloud platform, CLI, skills for coding assistants; README reports April 2026 algorithm update with semantic + BM25 + entity fusion. | High: blocks `best memory`, `SOTA retrieval`, and "Mem0 requires cloud only" style claims. Still not the same as a one-command local Claude Code + Codex continuity runtime. | Official: https://github.com/mem0ai/mem0<br>API: https://api.github.com/repos/mem0ai/mem0<br>checked_at: 2026-05-07T01:41:15Z |
| supermemory | `supermemoryai/supermemory` | 22,425 | MIT | Memory/context layer for AI; app, browser extension, plugins, MCP server, API, user profiles, connectors, file processing, project/container tag scoping; README lists Claude Code and OpenCode plugins. | High: blocks `only cross-tool memory`, `only project-scoped memory`, and broad MCP uniqueness. Safer to position harness-mem as local coding-session continuity, not general memory platform. | Official: https://github.com/supermemoryai/supermemory<br>API: https://api.github.com/repos/supermemoryai/supermemory<br>checked_at: 2026-05-07T01:41:15Z |
| claude-mem | `thedotmack/claude-mem` | 72,972 | NOASSERTION | Persistent memory compression system for Claude Code; auto-captures tool observations, summarizes, and reinjects context. README now also documents Gemini CLI and OpenCode install paths, plus worker service, SQLite, Chroma, and MCP search tools. | High: closest direct coding-session competitor. Current harness-mem README wording that claude-mem is "still locked to Claude Code" is stale and should be removed or narrowed. | Official: https://github.com/thedotmack/claude-mem<br>API: https://api.github.com/repos/thedotmack/claude-mem<br>checked_at: 2026-05-07T01:41:15Z |
| Basic Memory | `basicmachines-co/basic-memory` | 2,982 | AGPL-3.0 | Local-first Markdown knowledge system built on MCP; notes are stored locally, assistants can load context in new conversations, and routing supports local/cloud project modes. README includes VS Code and Claude Desktop setup. | High: blocks `only local project memory` and `only MCP memory for AI assistants`. It is less specialized for Claude Code + Codex hook continuity than harness-mem. | Official: https://github.com/basicmachines-co/basic-memory<br>API: https://api.github.com/repos/basicmachines-co/basic-memory<br>checked_at: 2026-05-07T01:41:15Z |
| mcp-memory-service | `doobidoo/mcp-memory-service` | 1,794 | Apache-2.0 | Self-hosted persistent shared memory backend for AI agent pipelines; REST API, MCP, OAuth, CLI, dashboard, knowledge graph, autonomous consolidation, Claude/OpenCode/LangGraph/CrewAI/AutoGen support. | Medium-high: blocks `only self-hosted MCP memory` and broad team/agent-pipeline memory claims. It does not appear to target first-turn continuity across Claude Code + Codex specifically. | Official: https://github.com/doobidoo/mcp-memory-service<br>API: https://api.github.com/repos/doobidoo/mcp-memory-service<br>checked_at: 2026-05-07T01:41:15Z |
| Graphiti / Zep | `getzep/graphiti` | 25,766 | Apache-2.0 | Open-source temporal context graph engine at the core of Zep's context infrastructure; hybrid semantic + keyword + graph retrieval, temporal validity windows, point-in-time graph memory, MCP server. Zep is managed context graph infrastructure. | High for graph/temporal claims: blocks saying harness-mem leads graph memory or that temporal graph ideas are absent elsewhere. Low as a direct replacement because Graphiti/Zep is graph infrastructure, not a drop-in local Claude Code + Codex continuity layer. | Official: https://github.com/getzep/graphiti<br>Docs: https://help.getzep.com/graphiti/getting-started/welcome<br>API: https://api.github.com/repos/getzep/graphiti<br>checked_at: 2026-05-07T01:41:15Z |
| Letta | `letta-ai/letta` | 22,477 | Apache-2.0 | Platform for stateful agents with advanced memory; Letta Code runs locally in terminal, resumes agents/conversations, and uses git-backed MemFS/context repositories. Letta API targets stateful agent applications. | Medium-high: blocks broad `only coding agent memory` and `only local agent memory` claims. It is an agent platform, not harness-mem's narrow shared-memory sidecar for existing Claude Code + Codex workflows. | Official: https://github.com/letta-ai/letta<br>Docs: https://docs.letta.com/letta-code/memory/<br>API: https://api.github.com/repos/letta-ai/letta<br>checked_at: 2026-05-07T01:41:15Z |
| Pieces | `pieces-app/documentation` | 646 | null | Official product pages position Pieces as OS-level/local developer workflow memory with LTM-2, MCP access, GitHub Copilot/Cursor/Goose integrations, source/time-based recall, and local privacy. Core product repo/license was not found; GitHub stats here are for the official docs repo, with org metadata also checked. | High for developer-workflow memory claims: blocks `only local developer workflow memory` and `only MCP access to personal work history`. Lower as open-source comparison because the core product is not represented by the audited docs repo license. | Official: https://pieces.app/features/mcp<br>GitHub org: https://github.com/pieces-app<br>API: https://api.github.com/repos/pieces-app/documentation<br>checked_at: 2026-05-07T01:41:15Z |

## README Rewrite Guidance

### Claims harness-mem can say

- `harness-mem is a local-first coding-session continuity runtime for supported Claude Code and Codex hook paths.`
- `Claude Code and Codex can share one local daemon and one local SQLite database when setup and doctor are green.`
- `harness-mem is intentionally narrower than general memory APIs: it focuses on project-scoped coding-session recall, first-turn continuity, and local operation.`
- `Compared with general memory platforms, harness-mem avoids cloud dependency on its supported path and keeps the operator-facing runtime in local files/SQLite.`
- `harness-mem has committed benchmark artifacts for its own release gates; competitor benchmark numbers should be described as self-reported unless we rerun them under identical conditions.`

### Claims that are too strong or stale

- Do not say `only`, `unique`, `best`, or `SOTA` for memory, MCP memory, project-scoped memory, or graph memory.
- Do not say claude-mem is "still locked to Claude Code"; its current README documents Gemini CLI and OpenCode installation paths.
- Do not say Mem0 requires cloud infrastructure only; its README documents library, self-hosted server, cloud platform, CLI, and skills.
- Do not imply supermemory lacks project scoping or coding-tool integrations; it documents container tags plus Claude Code/OpenCode plugins.
- Do not imply local-first memory is unique; Basic Memory and Pieces both make local-first/local-device claims, and mcp-memory-service is self-hostable.
- Do not imply temporal graph memory is a harness-mem invention; Graphiti/Zep explicitly centers temporal validity windows and hybrid graph retrieval.
- Do not compare harness-mem's LoCoMo subset result directly against external benchmark leaderboards without restating scope, metric, and self-reported status.

## Positioning Synthesis

The strongest safe position is not "harness-mem beats every memory system." The evidence supports a narrower claim:

> harness-mem is a local-first, project-scoped continuity sidecar for AI coding agents, currently strongest where the user wants Claude Code and Codex to share the same local project memory without adopting a cloud memory platform or switching to a new agent platform.

That framing avoids overstating uniqueness while preserving the real differentiator: supported hook-path continuity across the user's existing coding agents.

## Recheck Triggers

Re-run this audit before public README changes if:

1. Any row's official README/docs publish a new Claude Code, Codex, OpenCode, Cursor, or MCP integration claim.
2. harness-mem wants to use `only`, `unique`, `best`, `SOTA`, or benchmark-leader language.
3. S108-011 changes the comparison table or the first-viewport product claim.
4. Graphiti/Zep selective-import work changes harness-mem's graph/temporal positioning.
