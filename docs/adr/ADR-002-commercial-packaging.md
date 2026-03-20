# ADR-002: Commercial Packaging Boundary

Date: 2026-03-20
Status: Accepted
Related: Plans.md S51-008, LICENSE, docs/adr-001-auto-memory-coexistence.md

---

## Context

harness-mem is licensed under BUSL-1.1 (Business Source License 1.1), which permits
free use for internal, personal, non-commercial, and development purposes. Commercial
use as a managed memory service requires a separate license until the Change Date
(2029-03-08), after which the code converts to Apache 2.0.

The project's core value proposition is "local-first, zero-cost" — Claude Code and
Codex users get persistent cross-session memory without any cloud dependency, signup,
or fees. This is captured in the §55 positioning: "Claude Code と Codex のメモリを
橋渡し。ローカル完結、ゼロコスト。"

As the project matures, a clear boundary between the free offering and any potential
commercial offering is needed to:

1. Build user trust (no hidden paywalls for the local experience)
2. Define the scope of BUSL-1.1's Additional Use Grant
3. Guide future feature decisions (what belongs in the free tier vs. a managed tier)

---

## Decision

The commercial boundary is drawn at **managed backend services**.

### Free tier (local-first, always)

Everything that runs on the user's own machine is free and covered by the
BUSL-1.1 Additional Use Grant:

- SQLite-backed memory server (local daemon)
- MCP tool integration for Claude Code, Codex, Cursor
- CLI (`harness-mem` script) — setup, doctor, versions, uninstall
- All benchmark and evaluation tooling
- Vector search and full-text search against local DB
- Session timeline, entity graph, checkpoint features
- Self-hosted PostgreSQL sync (user-operated infrastructure)

### Commercial boundary (managed service)

The following capabilities, if offered by the Licensor as a hosted service, fall
outside the free tier and require a commercial agreement:

- **Managed PostgreSQL backend** — cloud-hosted DB with automatic sync, backups,
  and high availability operated by the Licensor
- **Team memory sharing** — multi-user workspaces where multiple developers share
  a memory namespace via a Licensor-operated service
- **Enterprise support** — SLA-backed support, private deployment assistance,
  custom integrations

Third parties operating the above as a service for their own customers are also
subject to the BUSL-1.1 "Memory Service" restriction in the LICENSE.

### Why this boundary

The local SQLite path has zero marginal cost for the Licensor. The managed backend
path has real infrastructure costs (compute, storage, uptime). The boundary
therefore aligns user value with Licensor cost, making it a natural and defensible
split.

---

## Consequences

- **User communication**: README and landing pages must clearly state that the
  local experience is permanently free, not a free trial.
- **Feature placement**: New features that can run locally should be placed in
  the free tier by default. Features that require centralized infrastructure
  belong in the managed tier.
- **License enforcement**: The BUSL-1.1 Additional Use Grant (see LICENSE) already
  encodes the "Memory Service" restriction. This ADR documents the intent behind
  that grant so future contributors can apply it consistently.
- **Change Date 2029-03-08**: On this date the code converts to Apache 2.0,
  removing all commercial restrictions. Any managed-tier business model must
  therefore be built on service value (reliability, support, convenience), not
  on code access restrictions.
