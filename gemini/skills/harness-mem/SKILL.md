---
name: harness-mem
description: |
  Persistent cross-tool memory for AI coding agents. Use when the user
  asks about previous sessions, past decisions, earlier work context,
  or wants to search/recall information across tools. Also use when
  starting a new session to load relevant context via resume_pack.
---

# harness-mem — Gemini CLI Agent Skill

## Overview

harness-mem provides persistent memory that works across Gemini CLI, Claude Code, Codex, OpenCode, and Cursor. Your conversations and decisions are automatically captured and can be recalled in future sessions.

## Available MCP Tools

Use these tools via the `harness` MCP server:

### Session Start (Every Session)
- `harness_mem_resume_pack` — Load context from previous sessions. Call this at the start of every session.

### Search (3-Layer Progressive Retrieval)
1. `harness_mem_search` — Layer 1: Lightweight index search. Returns IDs and summaries only.
2. `harness_mem_timeline` — Layer 2: Expand context around search results with before/after events.
3. `harness_mem_get_observations` — Layer 3: Full details for specific observation IDs. Use sparingly.

### Recording
- `harness_mem_record_event` — Record important events (decisions, discoveries, blockers).
- `harness_mem_record_checkpoint` — Save a checkpoint at key milestones.
- `harness_mem_finalize_session` — Call at session end to generate summary.

### Session Management
- `harness_mem_sessions_list` — List recent sessions across all tools.
- `harness_mem_session_thread` — View the full thread of a specific session.

### Health
- `harness_mem_health` — Check daemon health and connection status.

## Best Practices

1. **Start with `resume_pack`** — Always call this first in a new session.
2. **Search before asking** — Check memory before asking the user to repeat context.
3. **Use 3-layer retrieval** — Start with `search` (cheap), drill down with `timeline`, only use `get_observations` for specific IDs.
4. **Record decisions** — When important decisions are made, record them with `record_event`.
5. **Finalize sessions** — Call `finalize_session` when work is complete.

## Setup

```bash
# Automatic setup
harness-mem setup --platform gemini

# Manual MCP registration
gemini mcp add harness node /path/to/harness-mem/mcp-server/dist/index.js

# Verify
harness-mem doctor --platform gemini
```
