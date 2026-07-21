# README Claim Map

This document maps user-facing README claims to the source of truth that supports them.
Use it before changing public copy. The companion SSOT matrix is
[`benchmark-claim-ssot-matrix-2026-03-13.md`](./benchmarks/benchmark-claim-ssot-matrix-2026-03-13.md).
Project-level product boundaries live in [`Spec.md`](../Spec.md); public copy
must not exceed that product spec or the measured evidence below.

## Rules

- Public README copy should point at evidence, not memory.
- If a claim is measured, cite the artifact path and scope.
- If a claim is bounded, state the bound in the note column.
- If a claim is historical or deprecated, do not present it as current.

## English README claim map

| README claim | Source of truth | Status | Notes |
|---|---|---|---|
| Local project memory for AI coding sessions — a continuity runtime for Claude Code, Codex, Cursor, and Hermes. | `README.md`, `docs/integrations/hermes.md`, architecture docs, supported tools list | bounded | Scope = Claude Code + Codex Tier 1 continuity, Cursor Tier 2 hooks/MCP, and Hermes Tier 3 opt-in MCP/MemoryProvider. It is not an "every agent" or parity claim. |
| Stop re-explaining yesterday's work. | session continuity docs and hook behavior in `docs/harness-mem-setup.md` | bounded | Supported when the hook path is healthy and the daemon is running. |
| ~5ms cold start. | `memory-server/src/benchmark/results/ci-run-manifest-latest.json` and Go MCP bench artifacts | measured | Scope is the Go MCP layer cold start, not the whole app stack. |
| Zero cloud, zero API keys. | local SQLite architecture and setup guide | stable | Core runtime stays local; do not widen this into a claim about optional external integrations. |
| Claude Code and Codex share the same local memory runtime. | setup guide and architecture docs | bounded | Applies to the supported Claude Code / Codex path, not unsupported clients. |
| New Claude Code and Codex setup defaults to the local Streamable HTTP MCP gateway. | `Spec.md` MCP Transport Defaults, `docs/adr/ADR-004-local-streamable-http-mcp-default.md`, `CHANGELOG.md` v0.25.0 | stable | Scope = new managed Tier 1 setup. Existing stdio installs remain valid, stdio rollback stays documented, and Hermes remains explicit opt-in. |
| Codex App is local-dogfood green in this maintainer setup. | `docs/codex-app-dogfood-2026-05-26.md`, README supported tools note | dogfood | This is not a general Tier 1 App claim until a reproducible App-specific smoke exists. Codex CLI remains the Tier 1 Codex target. |
| Cursor is supported as a Tier 2 supported local client. | `Spec.md` Cursor Conversation Capture + MCP Transport Defaults, `Plans.md` §131/§132, `docs/harness-mem-setup.md`, README supported tools section | bounded | Cursor support means user-scoped `~/.cursor/hooks.json`, `~/.cursor/mcp.json` with `mcpServers.harness-mem`, hook spool ingest, MCP search, and `harness-mem setup --platform cursor` / `harness-mem doctor --platform cursor` checks. It is not a Tier 1 continuity parity claim. Cursor may require MCP reload/restart or a new session after setup. |
| Hermes can join through Layer 1 MCP tools and an optional Layer 2 MemoryProvider plugin. | `integrations/hermes/README.md`, `docs/integrations/hermes.md`, `CHANGELOG.md` v0.29.0 | bounded | Hermes remains Tier 3 and explicit opt-in. The bridge complements rather than replaces Hermes built-in `MEMORY.md`, `USER.md`, and skills. |
| Fact extraction defaults to heuristic; explicit LLM mode defaults to loopback Ollama and cloud providers require allow + credentials. | `docs/environment-variables.md`, `docs/integrations/hermes.md`, `CHANGELOG.md` v0.29.0 | stable | This is the daemon egress contract. Non-loopback Ollama is rejected; live cloud E2E is not claimed. |
| Japanese / English / code adaptive routing exists. | adaptive retrieval docs and benchmark docs | measured | Keep language-routing claims tied to the benchmark or design docs that define them. |
| Main gate, Japanese companion, and historical baseline are separate. | SSOT matrix | strict | Never mix the historical Japanese baseline with the current companion source. |

## Update rule

If any row here changes, update the supporting evidence first, then change public copy.
