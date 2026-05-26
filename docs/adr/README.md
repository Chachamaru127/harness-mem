# ADR Index

New shareable architecture decisions live in this directory as
`ADR-NNN-*.md`.

| ADR | Status | Path | Notes |
| --- | --- | --- | --- |
| ADR-001 | Accepted | `docs/adr-001-auto-memory-coexistence.md` | Legacy location; index target and migration candidate. |
| ADR-002 | Accepted | `docs/adr/ADR-002-commercial-packaging.md` | Current indexed ADR. |
| ADR-003 | Proposed | `docs/adr/ADR-003-recall-runtime-architecture.md` | Current indexed ADR. |
| ADR-004 | Accepted | `docs/adr/ADR-004-local-streamable-http-mcp-default.md` | Local HTTP MCP default for new Tier 1 setup. |

Use `harness-mem adr new` to render the template. The command is dry-run by
default; pass `--write` to create a new `docs/adr/ADR-NNN-*.md` file.
