# harness-mem Integration

This project uses harness-mem for persistent cross-tool memory.

## Quick Reference

- Use `harness_mem_resume_pack` at session start to load prior context
- Use `harness_mem_search` to find relevant past information
- Use `harness_mem_record_event` to save important decisions
- Use `harness_mem_finalize_session` when finishing work

## Gemini CLI Hook Events

The following Gemini CLI hook events are captured by `memory-gemini-event.sh`:

| Gemini Event | harness-mem event_type | Description |
|---|---|---|
| SessionStart | session_start | Session begins |
| SessionEnd | session_end | Session ends (triggers finalize) |
| AfterTool | tool_use | After a tool call completes |
| PreCompress | checkpoint | Before context compression |
| BeforeAgent | user_prompt | Before agent processes user input |
| AfterAgent | assistant_response | After agent produces a response |
| BeforeModel | model_request | Before model inference call |
| BeforeToolSelection | tool_selection | Before model selects which tool to use |

## Memory Search Pattern

1. `harness_mem_search` — Get matching IDs (lightweight)
2. `harness_mem_timeline` — Expand context around results
3. `harness_mem_get_observations` — Get full details for specific IDs

Always start with search, only drill down when needed. This saves context tokens.
