# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### What changed for users

- None.

### Added

- None.

### Changed

- None.

### Fixed

- None.

### Removed

- None.

### Security

- None.

### Migration Notes

- None.

### Verification

- None.

## [0.1.13] - 2026-02-22

### What changed for users

Release automation no longer fails due benchmark timeout defaults during memory-server quality gates.

### Added

- None.

### Changed

- None.

### Fixed

- Increased timeout budget for benchmark-heavy tests used by CI quality gates:
  - `memory-server/tests/integration/search-quality.test.ts`
  - `tests/benchmarks/rerank-quality-gate.test.ts`

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `cd memory-server && bun test tests/integration/search-quality.test.ts`
- `bun test tests/benchmarks/baseline-output.test.ts tests/benchmarks/rerank-quality-gate.test.ts`

## [0.1.12] - 2026-02-22

### What changed for users

Harness-mem now ships a larger retrieval/runtime toolkit (managed backend routing, embedding/rerank/router modules, and stronger daemon guardrails) together with updated release docs and benchmark workflows.

### Added

- Backend abstraction and adapters for SQLite/PostgreSQL (`storage-adapter`, adapter factory, managed-mode schema helpers).
- Retrieval/quality modules:
  - embedding provider registry (`fallback`, `openai`, `ollama`)
  - reranker registry
  - retrieval router
  - answer compiler
  - consolidation worker/extractor/deduper
  - token estimate utility
- New integration and contract coverage:
  - API contract / token-estimate / managed-mode / security hardening tests
  - 100k performance benchmark and LOCOMO workflow scaffolding
  - Python SDK and LangChain integration starter packages

### Changed

- `README.md` and setup docs were expanded with benchmark, guardrail, and proof-pack workflows.
- `mcp-server/README.md` npm package examples now point to `@claude-code-harness/mcp-server`.
- Hook and ingestion coverage was extended for Codex/Cursor/OpenCode/Antigravity paths.

### Fixed

- `harness-memd` now avoids false healthy states from non-JSON health responses.
- `harness-memd` now detects port conflicts/stale pid states earlier and self-heals UI pid drift.
- Added daemon/UI log rotation controls:
  - `HARNESS_MEM_LOG_MAX_BYTES`
  - `HARNESS_MEM_LOG_ROTATE_KEEP`
- Kept MCP runtime bootstrap safety for missing `mcp-server/dist` by retaining package source/build metadata in npm files.

### Removed

- None.

### Security

- Expanded test coverage for workspace boundary and security-hardening behaviors.

### Migration Notes

- No destructive migration is required.
- If you use managed/hybrid backend mode, verify your backend env wiring before production rollout.

### Verification

- `cd harness-mem-ui && bun run test:ui && bun run typecheck`
- `cd memory-server && bun test && bun run typecheck`
- `bun test tests/harness-memd-guardrails.test.ts`
- `bun test tests/doctor-json-contract.test.ts`
- `./tests/test-memory-daemon-chaos.sh 2`
- `./tests/test-memory-daemon.sh`
- `npm pack --dry-run`

## [0.1.11] - 2026-02-18

### What changed for users

`setup` no longer fails on global npm installs when `mcp-server/dist` is missing from the package.

### Added

- Included `mcp-server/src/` and `mcp-server/tsconfig.json` in npm package files for deterministic local MCP builds.

### Changed

- None.

### Fixed

- `ensure_mcp_runtime` now bootstraps and builds MCP locally if `mcp-server/dist/index.js` is absent.
- Prevented setup hard-failure pattern: `MCP dist entry missing: .../mcp-server/dist/index.js`.

### Removed

- None.

### Security

- None.

### Migration Notes

- Upgrade and run setup again:
  - `npm install -g @chachamaru127/harness-mem@0.1.11`
  - `harness-mem setup --platform codex,claude,cursor,opencode`

### Verification

- `npm pack --dry-run`
- `harness-mem setup --platform claude --skip-start --skip-smoke --skip-quality` from a fresh global install path.

## [0.1.10] - 2026-02-18

### What changed for users

Fresh installs now wire Claude and Cursor MCP entries automatically, reducing post-setup missing-server cases.

### Added

- Cursor setup now writes `~/.cursor/mcp.json` with `mcpServers.harness`.
- Cursor doctor now validates MCP wiring, not only hook wiring.

### Changed

- Setup prompts now describe Cursor as global hooks plus global MCP wiring.
- Cursor hook command is now written as an absolute path for stable execution.

### Fixed

- Claude setup now writes `mcpServers.harness` to `~/.claude.json` automatically.
- `doctor --fix --platform claude` now repairs missing Claude MCP wiring.

### Removed

- None.

### Security

- None.

### Migration Notes

- Run `harness-mem doctor --fix --platform claude,cursor` after upgrading to normalize existing global config files.

### Verification

- `./scripts/harness-mem doctor --platform claude --skip-smoke --skip-quality`
- `./scripts/harness-mem doctor --platform cursor --skip-smoke --skip-quality`

## [0.1.9] - 2026-02-18

### What changed for users

Search now returns more relevant results while preventing cross-project leakage.

| Before | After |
|--------|-------|
| Search scoring was simpler (`hybrid_v1`) and could not use graph/entity context safely. | Search uses `hybrid_v3` with richer scoring (`tag_boost`, `importance`, `graph`) and stricter filters. |
| Link expansion risked including unrelated project records. | `strict_project` keeps results isolated to the requested project. |
| Privacy filtering relied on string matching and could misclassify edge cases. | Privacy filtering now uses strict JSON tag evaluation for `private` / `sensitive`. |
| Vector search could mix incompatible model/dimension rows. | Vector candidates are restricted to current model + dimension, with coverage-aware fallback weighting. |

### Added

- `/v1/search` request fields: `expand_links`, `strict_project`, `debug`.
- `/v1/search` response fields: `scores.graph`, `meta.candidate_counts`, `meta.vector_coverage`.
- Entity extraction and observation linking (`follows`, `shared_entity`) as search signals.
- New integration coverage for project isolation, privacy strictness, vector compatibility, and coverage-based weighting.

### Changed

- Search ranking upgraded from `hybrid_v1` to `hybrid_v3`.
- Default vector dimension increased to `256`.
- Default vector model updated to `local-hash-v3`.
- Synonym expansion and bigram-aware hashing improve lexical/vector recall.

### Fixed

- Prevented cross-project result contamination during link expansion.
- Removed privacy false-positives from naive substring matching.
- Prevented ranking drift from mixed vector model/dimension datasets.

### Removed

- None.

### Security

- Stricter privacy filtering reduces accidental exposure of sensitive entries in default search.

### Migration Notes

- No destructive DB migration.
- Existing DBs are migrated safely (`observation_type`, entity tables, and new indices are created if missing).
- Optional: run vector reindex for best `vector_coverage` if old vectors dominate.

### Verification

- `cd memory-server && bun test && bun run typecheck`
- Confirm `/v1/search` returns `meta.ranking = "hybrid_v3"` and includes `candidate_counts`, `vector_coverage`.

## [0.1.8] - 2026-02-18

### What changed for users

`uninstall` now removes the npx runtime cache, so local cleanup is complete.

### Added

- None.

### Changed

- Uninstall lifecycle now includes package runtime cache cleanup.

### Fixed

- Removed leftover `~/.harness-mem/runtime/` artifacts after uninstall.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration required.
- If you previously uninstalled on `<=0.1.7`, run uninstall once more to clear old runtime cache.

### Verification

- Run `harness-mem uninstall`.
- Confirm `~/.harness-mem/runtime/` is removed.

## [0.1.7] - 2026-02-18

### What changed for users

npx setup now writes stable runtime paths so MCP wiring does not break after npm cache cleanup.

### Added

- None.

### Changed

- Setup and doctor flows now synchronize runtime files into `~/.harness-mem/runtime/harness-mem`.

### Fixed

- Removed dependency on ephemeral `~/.npm/_npx/...` paths in generated wiring.

### Removed

- None.

### Security

- None.

### Migration Notes

- Re-run `harness-mem setup` if you installed via npx before `0.1.7`.

### Verification

- Run `harness-mem doctor`.
- Confirm generated paths point to `~/.harness-mem/runtime/harness-mem`.

## [0.1.6] - 2026-02-18

### What changed for users

OpenCode setup and doctor no longer write unsupported keys that can block startup.

### Added

- None.

### Changed

- OpenCode repair flow now normalizes to `mcp.harness.environment`.

### Fixed

- Removed legacy `plugins` and `env` key patterns from OpenCode wiring.

### Removed

- Unsupported legacy OpenCode config key usage.

### Security

- None.

### Migration Notes

- Run `harness-mem doctor --fix --platform opencode` to normalize existing OpenCode config.

### Verification

- Run `harness-mem doctor --platform opencode`.
- Confirm OpenCode starts without config schema errors.

## [0.1.5] - 2026-02-17

### What changed for users

Release automation now blocks off-branch or mismatched-tag publishes and runs quality gates before npm publish.

### Added

- Mandatory pre-publish quality gates for UI and memory-server.

### Changed

- Release workflow now verifies tag commit ancestry against `origin/main`.
- Release workflow now verifies tag version matches `package.json`.

### Fixed

- Corrective release handling for earlier tag and commit mismatches.

### Removed

- None.

### Security

- Reduced accidental release risk by enforcing branch and version checks.

### Migration Notes

- Maintainers should use SemVer tags that match `package.json` exactly.

### Verification

- Trigger release with a SemVer tag.
- Confirm workflow runs: ancestry check, version check, quality gates, `npm pack --dry-run`, publish.

## [0.1.1] - 2026-02-17

### What changed for users

Setup and feed browsing became easier through an interactive setup flow and inline feed detail expansion.

### Added

- Interactive setup prompts for language, target tools, import choice, and post-import stop choice.
- UI design presets: `Bento Canvas`, `Liquid Glass`, `Night Signal`.
- Dedicated platform badge labels for `cursor` and `antigravity`.

### Changed

- Feed detail view now opens inline at the selected card (accordion behavior).
- UI language defaults and `document.lang` behavior were aligned for stable switching.

### Fixed

- Reduced scroll-position confusion caused by modal overlay detail behavior.

### Removed

- Previous overlay-first card detail behavior.

### Security

- None.

### Migration Notes

- No breaking migration required.
- Re-run `harness-mem setup` to use the new interactive onboarding path.

### Verification

- Run `harness-mem setup` and confirm interactive prompts appear in sequence.
- Open feed UI and confirm card details expand inline.
