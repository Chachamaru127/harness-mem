# Grok Bot — Tier 3 / experimental

Optional **Layer 1 MCP** participation in the same harness-mem daemon used by
Claude Code, Codex, Cursor, and Hermes. Grok Bot explicitly calls search,
timeline, get observations, resume pack, and record checkpoint. This integration
installs **no SessionStart / UserPromptSubmit / Stop hooks**, performs no automatic
transcript ingest, and makes no Tier 1 first-turn continuity claim. There is no
Hermes-style Layer 2 provider here.

## Managed config and local setup

Prerequisites: harness-mem installed, a running memory daemon, and a Grok Bot host
that supports stdio MCP or Streamable HTTP MCP with custom bearer headers.
The native Grok Bot config path and environment interpolation syntax are not
verified. The JSON here is a **managed export for manual import**, not a claim
that Grok Bot automatically discovers a particular file.

```bash
harness-mem setup --platform grok-bot --skip-model-pull
harness-mem doctor --platform grok-bot
# Or generate only the config, without provisioning a local daemon:
harness-mem mcp-config --client grok-bot --transport stdio --write
```

The managed export is `~/.harness-mem/integrations/grok-bot/mcp.json`, with server
ID `mcpServers.harness-mem`. Import that entry into your client's MCP settings and
reload the client. Setup defaults to stdio for Grok Bot alone. `--mcp-transport
http` without a remote URL uses the default local endpoint, creates the shared
gateway token, and starts the local gateway. An explicit remote `--url` /
`HARNESS_MEM_MCP_URL` writes the export only and does not start a local gateway.
`mcp-config --write` still generates config only.
`--client grokbot` is an alias for `--client grok-bot`.
`--platform grok-bot` is the canonical platform spelling. Grok Bot is excluded
from both default `all` selections and must be explicitly selected.

Doctor's `grok_bot_wiring: ok:config_only` checks the export's structure. It does
not prove client import, token resolution, remote reachability, or live tool
execution. Other doctor checks still inspect the local harness-mem runtime.

For local HTTP, `setup --platform grok-bot --mcp-transport http` provisions the
shared token and starts the gateway. Config-only generation still needs a
running gateway on the daemon host:

```bash
# Supply HARNESS_MEM_MCP_TOKEN through your private runtime environment.
harness-mem mcp-gateway start
harness-mem mcp-config --client grok-bot --transport http --write
```

Generated HTTP JSON contains `Bearer ${HARNESS_MEM_MCP_TOKEN}`, never the token
value from the environment. This is a placeholder: configure the actual header
through the client's secret mechanism, or adapt to its documented interpolation
syntax. Do not send the literal placeholder. Examples:
[local HTTP](examples/mcp-local.json), [local stdio](examples/mcp-stdio.json).
In the exported config, set `HARNESS_MEM_PROJECT_KEY` for stdio or
`X-Harness-Project-Key` for HTTP to the
same project key used on the daemon host; pass the matching `project` on tools
that accept it. Existing workspace and privacy checks remain in force.

## Remote VPS → Tailscale → Mac daemon

```text
Grok Bot VPS → https://<mac-node>.<tailnet>.ts.net/mcp
            → Tailscale Serve (Mac)
            → loopback Host-rewrite proxy :37890
            → HTTP MCP gateway 127.0.0.1:37889/mcp
            → memory daemon 127.0.0.1:37888
```

The gateway deliberately validates loopback Host + port, Origin, and bearer auth.
A proxy must set upstream `Host: 127.0.0.1:37889`. Do not weaken gateway checks or
bind the gateway publicly. The example preserves Authorization and Origin;
non-loopback browser Origins remain rejected. It targets native MCP clients that
do not send browser Origin, not browser CORS integration.

On the Mac, run the gateway and install the example
[nginx server block](examples/host-rewrite.nginx.conf) in your nginx `http` context.
Validate your completed configuration with `nginx -t` and start/reload your proxy.
Then expose that loopback proxy to your tailnet:

```bash
tailscale serve --bg http://127.0.0.1:37890
tailscale serve status
```

Use Tailscale Serve with tailnet access controls; do not enable public Funnel.
On the VPS, substitute the private Serve URL from your own environment:

```bash
harness-mem mcp-config --client grok-bot --transport http \
  --url 'https://<mac-node>.<tailnet>.ts.net/mcp' --write
```

Import the generated export and configure the bearer credential privately.
[Tailscale JSON](examples/mcp-tailscale.json) contains placeholders only.
The proxy disables response buffering for streaming and forwards MCP session
headers with the request. References: [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve),
[nginx proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

## Tool contract and verification

Use the five tools in [the Layer 1 contract](examples/layer1-tool-contract.md).
Where the client supports an allowlist, expose only those tools. The JSON does
not invent an unverified client-specific allowlist key. The allowlist is a client
configuration choice, not server-side authorization.

A live acceptance check is: initialize MCP, list those tools, record a disposable
checkpoint with `platform: "grok-bot"` and an isolated project/session, then search
→ timeline → get its ID and request a resume pack for that project. Check that
an unrelated project is not returned and private records stay excluded. Record
checkpoint is explicit model/operator activity, not a lifecycle hook.

The existing checkpoint `platform` argument supplies provenance on both
transports. No `X-Harness-MCP-Platform` gateway header is implemented or required.
Stdio also sets `HARNESS_MEM_MCP_PLATFORM=grok-bot` for existing best-effort tool
usage tracking; that is not automatic conversation capture.

Repository tests cover config lifecycle and MCP proxy contracts. Live Grok Bot
client import and the VPS-to-Mac path remain **unverified by this change**; a green
config doctor must not be described as live E2E evidence.

## Removal

```bash
harness-mem uninstall --platform grok-bot
```

Removes only the managed `harness-mem` entry, preserving other MCP servers and
settings. Grok Bot-only uninstall without `--purge-db` leaves the shared daemon,
runtime, and database running/intact. Remove any manually imported client copy
separately. Multi-platform uninstall and explicit `--purge-db` retain the existing
CLI teardown semantics.
