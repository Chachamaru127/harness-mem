# ADR-004: Local Streamable HTTP MCP Default

Date: 2026-05-24
Status: Accepted
Source Plans Section: Plans.md §130

---

## Status

Accepted

Accepted for the v0.25.0 line after the local HTTP setup, package smoke,
rollback, and token-redaction gates landed. Later README and release-note edits
must still respect the signals below: loopback-only, token-gated, reversible,
Hermes opt-in, and no token values in docs or config previews.

## Source Plans Section

Plans.md §130

## Context

Harness-mem already has a local memory daemon on `127.0.0.1:37888`, a stdio MCP
frontend, and a loopback Streamable HTTP MCP gateway on `127.0.0.1:37889/mcp`.
Stdio remains the broad compatibility path, but it creates one frontend process
per client session. That makes multi-session diagnosis noisier and leaves more
room for stale config conflicts.

The product direction is to make new Claude Code and Codex setup use the local
Streamable HTTP gateway by default, while keeping stdio as a rollback and legacy
compatibility path.

## Boundary

- Owner repo: harness-mem.
- Affected surfaces: setup, doctor, MCP gateway lifecycle, Codex config, Claude
  config, release package smoke, setup docs, Codex skills.
- Tier 1 default target: Claude Code and Codex only.
- Explicit opt-in target: Hermes remains explicit and is not included in
  `--client all`.
- Non-goals: remote MCP default, managed backend default, tokenless HTTP,
  HTTP-only mode, stdio deprecation, DB rewrite, memory deletion, or sibling
  repo ownership changes.

## Evidence

- `Plans.md` §122 records the local HTTP gateway, security gate, lifecycle
  manager, and config generation as implemented.
- `Plans.md` §130 records the default migration gates and rollback line.
- `Spec.md` `MCP Transport Defaults` defines HTTP default as local-first,
  loopback-only, token-gated, and reversible.
- `mcp-server-go/internal/server/gateway_security_test.go` covers loopback bind,
  token requirement, Host/Origin validation, and project key handling.
- `tests/mcp-config-cli.test.ts` covers HTTP config generation without writing
  token values to client config.
- `tests/mcp-gateway-lifecycle.test.ts` covers gateway status, doctor checks,
  managed token bootstrap, fresh HTTP setup, and stdio preservation.
- `.github/workflows/release.yml` package smoke covers macOS and Windows
  install surfaces before publish.

## Alternatives

### A. Keep stdio as the default

This is safest for old clients, but it preserves per-session frontend process
fan-out and does not make the already-built gateway the normal runtime path.

### B. Make local HTTP the default for new Tier 1 setup

Adopted, gated. It improves multi-session shape and diagnosis while preserving
local-first operation. The safety condition is that token, doctor, package
smoke, and rollback stay green.

### C. Make HTTP mandatory and remove stdio

Rejected. It would break older or constrained client environments and would turn
a default migration into a deprecation decision.

### D. Include Hermes in the default

Rejected for this ADR. Hermes can use HTTP explicitly, but it has its own
support tier and config lifecycle.

### E. Use a remote MCP endpoint

Rejected. It conflicts with local-first memory ownership and introduces a
network service boundary this product does not need by default.

## Decision

New setup for Claude Code and Codex should default to the local Streamable HTTP
MCP gateway when the setup command is responsible for creating or repairing the
Tier 1 wiring.

Rules:

1. The gateway must bind to loopback by default.
2. The gateway must require a local token.
3. Setup must create or reuse a local token file with owner-only permissions.
4. Client config must reference token environment variables or placeholders; it
   must not write token values.
5. Existing stdio wiring must remain valid unless the user explicitly asks for
   HTTP migration or repair chooses a managed rewrite path.
6. `--mcp-transport stdio` must remain the documented rollback.
7. Doctor must separate daemon health, gateway health, client config shape, and
   token availability.
8. Release claims require macOS and Windows package-install smoke for setup,
   doctor, rollback, and token redaction.

## Signals

Proceed when:

- Fresh Claude/Codex setup writes HTTP config and creates the local token state.
- Existing stdio Claude/Codex wiring is not rewritten by an implicit default
  setup.
- Doctor reports HTTP gateway status when HTTP config is present.
- Package smoke on macOS and Windows covers install, HTTP setup, gateway status,
  doctor, stdio rollback, and token redaction.

Review or roll back if:

- Claude or Codex cannot receive the token in normal launch paths.
- HTTP setup causes first-turn MCP failure more often than stdio.
- Token values appear in config previews, logs, telemetry, docs, or client
  config files.
- Windows Git Bash package smoke becomes flaky because of gateway lifecycle.
- Stdio fallback stops passing.

## Consequences

Positive:

- New Tier 1 installs have one shared local MCP gateway instead of one stdio
  frontend per client session.
- Transport conflicts become easier to diagnose because HTTP config has a single
  URL/header shape.
- Rollback remains simple and does not touch the memory DB.

Costs:

- Setup now owns token bootstrap and gateway lifecycle, so doctor and release CI
  must keep those paths covered.
- Client token propagation is a real product risk and must stay visible in
  release gates.
- Hermes needs a separate default decision later if its support tier changes.

## Supersedes

- None
