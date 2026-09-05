# Grok Bot / desktop assistant agents ↔ harness-mem integration

This package documents how Cursor Grok Bot (and similar desktop assistant MCP clients) can join the same local project memory lane used by Claude Code, Codex, Cursor, and Hermes.

> **Tier 3 (experimental, MCP-only).** This integration provides MCP Layer-1 participation and does **not** claim Claude/Codex-style Tier-1 lifecycle hook continuity.

## Positioning

| Capability | Status |
|---|---|
| MCP read/write tools (`harness_mem_search`, `harness_mem_timeline`, `harness_mem_get_observations`, `harness_mem_resume_pack`, record tools) | Supported |
| `setup` / `doctor` / `mcp-config` wiring (`--platform grok-bot`, `--client grok-bot`) | Supported |
| Platform-labeled tool provenance (`X-Harness-MCP-Platform: grok-bot`) | Supported |
| SessionStart / UserPromptSubmit / Stop hooks | **Not available** (client product limitation) |

## Architecture

```text
Grok Bot / desktop assistant MCP client
  └─ HTTPS MCP request (Bearer token + headers)
      └─ harness-mem Streamable HTTP gateway (:37889/mcp)
          └─ harness-mem daemon (:37888)
              └─ ~/.harness-mem/harness-mem.db
```

For remote operation (for example, Tailscale Serve), keep the daemon bound to loopback and forward through the HTTP MCP gateway.

## Quick start

### 1) Local-only wiring (same machine)

```bash
export HARNESS_MEM_MCP_TOKEN="<set-local-secret>"
harness-mem setup --platform grok-bot
harness-mem doctor --platform grok-bot
```

`setup --platform grok-bot` writes `~/.cursor/mcp.json` with server id `harness-mem-grok-bot` and HTTP MCP headers that reference env placeholders only (no secret token values written).

### 2) Explicit config generation (no setup wizard)

```bash
export HARNESS_MEM_MCP_TOKEN="<set-local-secret>"
harness-mem mcp-config --transport http --client grok-bot --write
```

## Remote path (Tailscale Serve) and Host rewrite requirement

When Grok Bot reaches a machine through a public Tailscale Serve hostname, the inbound `Host` value is that public name. The local harness-mem gateway expects loopback host semantics (`127.0.0.1:37889` / `localhost:37889`) on secured local routing, so you must provide a host rewrite layer.

Use:

- `HARNESS_MEM_GROK_BOT_MCP_URL` for the externally reachable MCP URL
- `HARNESS_MEM_GROK_BOT_HOST_HEADER` for the rewritten upstream host (usually `127.0.0.1:37889`)
- `HARNESS_MEM_MCP_TOKEN` for bearer auth

Example:

```bash
export HARNESS_MEM_MCP_TOKEN="<set-remote-secret>"
export HARNESS_MEM_GROK_BOT_MCP_URL="https://<tailnet-node>.ts.net/mcp"
export HARNESS_MEM_GROK_BOT_HOST_HEADER="127.0.0.1:37889"
harness-mem mcp-config --transport http --client grok-bot --write
harness-mem doctor --platform grok-bot
```

Reference proxy: [`examples/host-rewrite-proxy.mjs`](examples/host-rewrite-proxy.mjs)

## Example MCP entries

- Local: [`examples/cursor-mcp-grok-bot-local.json`](examples/cursor-mcp-grok-bot-local.json)
- Remote Tailscale: [`examples/cursor-mcp-grok-bot-tailscale.json`](examples/cursor-mcp-grok-bot-tailscale.json)

Both examples keep secrets as environment placeholders.

## Agent prompt/skill contract (Layer-1 explicit tool use)

Use [`examples/layer1-tool-contract.md`](examples/layer1-tool-contract.md) as a system prompt or policy snippet for Grok Bot style agents. It defines when to call:

- `search` first (candidate discovery)
- `timeline` / `get_observations` next (context expansion)
- `resume_pack` for restart handoff
- record/checkpoint tools for durable progress

## Smoke checklist

1. `harness-mem doctor --platform grok-bot` returns green for Grok Bot wiring.
2. Grok Bot can run `harness_mem_search` against a project key shared with Claude/Codex/Cursor.
3. `harness_mem_record_checkpoint` writes a marker observation.
4. A follow-up `harness_mem_search` in the same project can retrieve that marker.
5. Tool-use provenance for MCP calls records `platform: grok-bot`.

## Non-goals / limits

- No fake Tier-1 lifecycle continuity (no SessionStart/UserPromptSubmit/Stop hooks).
- No automatic import of Grok Bot private internal state outside exposed MCP calls.
- No machine-specific Tailscale hostname or real token value committed in this repository.

## Related docs

- [`../../docs/harness-mem-setup.md`](../../docs/harness-mem-setup.md)
- [`../../README.md`](../../README.md)
- [`../hermes/README.md`](../hermes/README.md)
