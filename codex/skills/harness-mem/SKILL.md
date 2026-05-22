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

1. `harness_mem_resume_pack(project, session_id)` — Get cross-platform resume context at session start
2. `harness_mem_search({ query, project })` — Find relevant memories by natural language query, scoped to the current project
3. `harness_mem_timeline` — Expand temporal context around scoped search results
4. `harness_mem_get_observations` — Get full observation text for specific entries

Before any search-like call, resolve `project` from the current cwd/repo or from the project name the user mentioned. Do not use unscoped search when a project can be inferred. In parallel Claude / Codex projects, search the current project first and only broaden after the scoped result is insufficient.

## S127 Bounded Search Rules

S127 makes search safer by keeping heavy retrieval off the daemon main loop. Treat these responses as normal control signals:

- `harness_mem_search_facets` is a scoped refinement tool. Do not call it with no arguments. Pass at least `query`, `project`, or tenant/access scope. An unscoped call returns `400` with `search_facets_unbounded`; narrow the request instead of retrying globally.
- Heavy `harness_mem_search` can return `503` (`search_offload_queue_full`, `search_offload_unavailable`, or similar). This means the daemon is applying backpressure so it does not freeze; it is not proof that memory is absent.
- On `503`, retry once with a narrower `query`, the current `project`, and a smaller `limit`. If lexical evidence is enough, use `vector_search=false`. If it still returns `503`, say memory search is temporarily busy and continue from SSOT/current files.
- Cross-project or unscoped search is only for explicit user requests, forensic/admin investigation, or after a scoped miss is reported.
- When reporting results, include the search scope in the answer (for example, `project=/path/to/repo`, `project=unknown`, `hits=3`, or `503 backpressure`) so the user can tell whether the answer came from the right project.

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
- `harness_mem_search_facets` — Get scoped search facets; never call without `query`, `project`, or tenant/access scope

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
