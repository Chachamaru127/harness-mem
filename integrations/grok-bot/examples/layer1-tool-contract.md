# Grok Bot Layer 1 tool contract

Use an explicit project shared with the daemon's other clients. Never broaden a
failed scoped search to global search or enable `include_private` as a retry.
For HTTP, configure `X-Harness-Project-Key`; for stdio, configure
`HARNESS_MEM_PROJECT_KEY`. Use IDs only from the authorized scoped results.

| Purpose | MCP tool | Example arguments |
|---|---|---|
| Search candidates | `harness_mem_search` | `{"query":"handoff","project":"<project-key>","limit":5,"include_private":false,"safe_mode":true}` |
| Read surrounding context | `harness_mem_timeline` | `{"id":"<observation-id>","before":2,"after":2,"include_private":false}` |
| Get selected details | `harness_mem_get_observations` | `{"ids":["<observation-id>"],"include_private":false}` |
| Explicitly resume | `harness_mem_resume_pack` | `{"project":"<project-key>","limit":5,"include_private":false}` |
| Explicitly record | `harness_mem_record_checkpoint` | `{"platform":"grok-bot","project":"<project-key>","session_id":"grok-bot-<unique-session-id>","title":"Handoff","content":"<decision and next step>","tags":["grok-bot"],"privacy_tags":[]}` |

Search → timeline → get is progressive retrieval; resume is an explicit call,
not SessionStart injection. Keep a stable, unique session ID for related writes.
Record only useful decisions and checkpoints, excluding credentials and secrets.
Set `privacy_tags: ["private"]` for private material; it will not be returned by
the default shared retrieval examples.

Treat `isError` or an unsuccessful daemon envelope as failure, and report it.
Do not invent a successful write or resume context when tools are unavailable.
The schema returned by `tools/list` is authoritative. These five tools match
Hermes Layer 1; no provider plugin or Tier 1 lifecycle callbacks are installed.
