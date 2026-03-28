# Session Continuity Hybrid Local Comparison

Date: 2026-03-28

## Goal

Verify that hybrid continuity context improves `recent project awareness` without regressing chain-first continuity.

## Command

```bash
bun run scripts/bench-session-continuity.ts
```

## Result

| Client | chain_recall | false_carryover | recent_project_hits | recent_project_recall | parity |
|---|---:|---:|---:|---:|---:|
| Claude | 1.00 | 0 | 1 | 1.00 | true |
| Codex | 1.00 | 0 | 1 | 1.00 | true |

## Interpreting the result

- The primary chain facts remained intact for both Claude and Codex.
- `false_carryover` stayed at `0`, so the new recent-project section did not pollute the chain-first portion.
- Both clients surfaced one valid recent-project hint from a parallel thread.
- SessionStart artifact parity remained `true`.

## Example artifact shape

```md
# Continuity Briefing

## Current Focus
- Resume scope: chain
- Source session: continuity-previous-session

## Latest Exchange
- User: Users say that opening a new Claude or Codex session forgets what we were talking about.
- Assistant: We agreed to ship a continuity briefing first and then fix adapter delivery for both Claude and Codex.

## Also Recently in This Project
- 2026-03-24 [codex] User: Regenerate the OpenAPI 3.1 docs and tweak the Swagger dark mode. Assistant: Next step is to polish dark mode styles and database index notes.
```

## Verdict

Hybrid continuity passes the current local acceptance bar for default rollout:

- chain recall did not regress
- false carryover did not regress
- recent project awareness improved
- Claude/Codex parity held
