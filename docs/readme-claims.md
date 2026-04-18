# README Claim Map

This document maps user-facing README claims to the source of truth that supports them.
Use it before changing public copy. The companion SSOT matrix is
[`benchmark-claim-ssot-matrix-2026-03-13.md`](./benchmarks/benchmark-claim-ssot-matrix-2026-03-13.md).

## Rules

- Public README copy should point at evidence, not memory.
- If a claim is measured, cite the artifact path and scope.
- If a claim is bounded, state the bound in the note column.
- If a claim is historical or deprecated, do not present it as current.

## English README claim map

| README claim | Source of truth | Status | Notes |
|---|---|---|---|
| One project. One memory. Every AI coding agent. | `README.md`, architecture docs, supported tools list | bounded | True for the supported local runtime surface, not a promise about every possible future client. |
| Stop re-explaining yesterday's work. | session continuity docs and hook behavior in `docs/harness-mem-setup.md` | bounded | Supported when the hook path is healthy and the daemon is running. |
| ~5ms cold start. | `memory-server/src/benchmark/results/ci-run-manifest-latest.json` and Go MCP bench artifacts | measured | Scope is the Go MCP layer cold start, not the whole app stack. |
| Zero cloud, zero API keys. | local SQLite architecture and setup guide | stable | Core runtime stays local; do not widen this into a claim about optional external integrations. |
| Claude Code and Codex share the same local memory runtime. | setup guide and architecture docs | bounded | Applies to the supported Claude Code / Codex path, not unsupported clients. |
| Cursor is supported at a lower tier. | README supported tools section | descriptive | This is a support tier statement, not a quality parity claim. |
| Japanese / English / code adaptive routing exists. | adaptive retrieval docs and benchmark docs | measured | Keep language-routing claims tied to the benchmark or design docs that define them. |
| Main gate, Japanese companion, and historical baseline are separate. | SSOT matrix | strict | Never mix the historical Japanese baseline with the current companion source. |

## Update rule

If any row here changes, update the supporting evidence first, then change public copy.
