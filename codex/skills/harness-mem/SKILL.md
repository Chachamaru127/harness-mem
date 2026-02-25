---
name: harness-mem
description: Cross-platform persistent memory for coding agents. Provides session continuity, progressive retrieval, and unified memory across Claude Code, Codex, OpenCode, and Cursor.
---

# harness-mem Skill

## Mission

Provide persistent, cross-platform memory that keeps coding agent sessions continuous and retrieval-efficient.

## Trigger Conditions

Use this skill when work needs:
- Cross-session continuity (resume context from previous sessions)
- Natural-language memory search across all past sessions
- Progressive retrieval (search → timeline → observations) instead of full-history stuffing
- Unified memory across multiple coding tools (Claude Code, Codex, OpenCode, Cursor)

## MCP Setup

The harness-mem MCP server is configured automatically by `harness-mem setup --platform codex`.

Manual registration:

```bash
codex mcp add harness -- node /path/to/harness-mem/mcp-server/dist/index.js
```

## Recommended Retrieval Sequence

1. `harness_mem_search` — Find relevant memories by natural language query
2. `harness_mem_timeline` — Expand temporal context around search results
3. `harness_mem_get_observations` — Get full observation text for specific entries
4. `harness_mem_resume_pack` — Get cross-platform resume context at session start

## Recommended Lifecycle Sequence

1. Session start: call `harness_mem_resume_pack(project, session_id)` to load context
2. During work: call `harness_mem_record_checkpoint(...)` at important milestones
3. Session end: call `harness_mem_finalize_session(session_id)` for summary generation

## Available MCP Tools

### Core Memory
- `harness_mem_search` — 3-layer progressive search (Step 1: candidate IDs)
- `harness_mem_timeline` — Temporal context expansion (Step 2)
- `harness_mem_get_observations` — Full text retrieval (Step 3)
- `harness_mem_resume_pack` — Cross-platform session resume context
- `harness_mem_record_event` — Record arbitrary memory events
- `harness_mem_record_checkpoint` — Record milestone checkpoints

### Session Management
- `harness_mem_sessions_list` — List active sessions
- `harness_mem_session_thread` — Get events within a session
- `harness_mem_finalize_session` — End session with summary
- `harness_mem_search_facets` — Get search facets

### Administration
- `harness_mem_health` — Daemon health check
- `harness_mem_admin_metrics` — Usage metrics
- `harness_mem_admin_consolidation_run` — Trigger memory consolidation
- `harness_mem_admin_consolidation_status` — Check consolidation queue

## Privacy Policy

- Semantic labels: `tags` (categorization)
- Policy labels: `privacy_tags` (access control)
- Block write: `no_mem`, `block`, `skip`, `secret_block`
- Private visibility: `private`, `sensitive`, `secret`
- Default retrieval excludes private records unless explicitly requested.
