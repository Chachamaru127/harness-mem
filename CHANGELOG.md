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

## [0.1.22] - 2026-02-23

### What changed for users

- Mem UI design is now consistent across local repo runs and npm global installs.
- `harness-mem setup` users now get the same parity UI bundle by default (no unexpected fallback to the legacy look).

### Added

- npm package now ships `harness-mem-ui/src/static-parity/*` parity bundle assets.

### Changed

- Removed `harness-mem-ui/src/static-parity` from UI local ignore rules so release artifacts are included in source and package outputs.
- Rebuilt parity static assets from the current React UI build.

### Fixed

- Fixed distribution mismatch where npm installs served the legacy `src/static` UI while local dev served `src/static-parity`.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration is required.
- Existing users can update with: `npm install -g @chachamaru127/harness-mem@latest`.

### Verification

- `bun run --cwd harness-mem-ui build:web`
- `npm pack --dry-run`
- Verify tarball contains `harness-mem-ui/src/static-parity/index.html` and `harness-mem-ui/src/static-parity/assets/*`

## [0.1.21] - 2026-02-23

### What changed for users

- Restored Mem UI auto-start during `harness-mem setup` so `http://127.0.0.1:37901` is available again after successful setup.
- setup output now includes an explicit Mem UI startup line (`Mem UI started: ...`) for faster troubleshooting.

### Added

- Contract test: `tests/harness-memd-ui-autostart-contract.test.ts` to prevent future regressions where UI lifecycle wiring is accidentally removed.

### Changed

- `scripts/harness-memd` now reinstates full UI lifecycle management:
  - auto-start UI on daemon start (`start_ui`)
  - stop UI on daemon stop (`stop_ui`)
  - include UI endpoint checks in `doctor`
  - support explicit UI disable with `HARNESS_MEM_ENABLE_UI=false`
- Setup guide now documents `HARNESS_MEM_ENABLE_UI` in runtime environment variables.

### Fixed

- Fixed regression in `0.1.20` where setup completed successfully but Mem UI process was not launched.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration is required.
- If running headless intentionally, set `HARNESS_MEM_ENABLE_UI=false`.

### Verification

- `bun test tests/harness-memd-ui-autostart-contract.test.ts tests/mcp-runtime-bootstrap-contract.test.ts`
- `bun test tests/harness-memd-guardrails.test.ts`
- `HARNESS_MEM_PORT=<port> HARNESS_MEM_UI_PORT=<port> harness-mem setup --platform codex,cursor,claude --skip-smoke --skip-quality`

## [0.1.20] - 2026-02-23

### What changed for users

- `harness-mem doctor --fix` and setup now recover automatically when the npm package is missing `mcp-server/dist/index.js`.
- setup post-check no longer reports false failures when daemon doctor warns but `/health` is still reachable.

### Added

- Contract test: `tests/mcp-runtime-bootstrap-contract.test.ts` to keep MCP runtime bootstrap behavior stable.

### Changed

- `ensure_mcp_runtime` now bootstraps MCP runtime locally (`npm install --include=dev` + `npm run build`) when `mcp-server/dist/index.js` is absent.
- setup repair hint for MCP runtime now points to the full rebuild command.

### Fixed

- Prevented hard failure pattern on global installs: `MCP dist entry missing: .../mcp-server/dist/index.js`.
- Reduced false `doctor_post_check` failures caused by stale daemon PID warnings.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration is required.

### Verification

- `bun test tests/mcp-runtime-bootstrap-contract.test.ts`
- `npm pack --dry-run`

## [0.1.19] - 2026-02-22

### What changed for users

Project names in memory are now normalized to a single canonical value, so the same workspace no longer splits into separate entries like `harness-mem` and `/.../harness-mem`.

### Added

- Startup migration that rewrites legacy basename project rows to the canonical `codexProjectRoot` path for `mem_sessions`, `mem_events`, `mem_observations`, `mem_facts`, and `mem_consolidation_queue`.
- Regression tests for basename-to-path canonicalization and legacy project alias migration.

### Changed

- Project normalization now resolves basename-style project values to the configured workspace root when names match.
- API-side project filters (`search`, `feed`, `sessions`, `resume-pack`, and chain resolution) now use the same canonical project normalization path.

### Fixed

- Prevented feed/project sidebar fragmentation caused by mixed project identifiers (`basename` vs absolute path).
- Prevented confusion between `session_id` UUID values and project buckets by keeping project namespaces consistent.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration command is required. Existing legacy project aliases are normalized automatically on daemon startup.

### Verification

- `bun test memory-server/tests/unit/workspace-boundary.test.ts`
- `bun test memory-server/tests/unit/core.test.ts`
- `bun test` (cwd: `memory-server`)
- `bun run --cwd memory-server typecheck`
- `bun run --cwd harness-mem-ui typecheck`
- `bun run --cwd harness-mem-ui test:ui`
- `npm pack --dry-run`

## [0.1.18] - 2026-02-22

### What changed for users

Release documentation now clearly defines the upcoming System Inventory experience and the LLM query endpoint contract.

### Added

- README roadmap section for the planned System Inventory screen.
- Planned server inventory detail requirements: `port`, `protocol`, `pid`, and bind address.
- Planned LLM read-only endpoint contract: `GET /v1/admin/system/llm-context`.

### Changed

- Clarified EN/JA documentation coverage for release notes and planning visibility.

### Fixed

- Reduced ambiguity about whether System Inventory requirements are implemented vs planned.

### Removed

- None.

### Security

- Documented that LLM-facing system context is designed as read-only under `v1/admin/*` scope.

### Migration Notes

- No runtime migration is required.

### Verification

- Confirm README includes `Planned Next (EN / JA)` section.
- Confirm release notes include server-port visibility and `system/llm-context` endpoint contract.
## [0.1.17] - 2026-02-22

### What changed for users

`harness-mem setup` now installs and starts the Mem UI alongside the API daemon, so first-time setup immediately provides both endpoints.

### Added

- npm package now ships Mem UI runtime files (`harness-mem-ui/src/*`) required for standalone UI server startup.
- `harness-memd start` now launches Mem UI on `HARNESS_MEM_UI_PORT` (default `37901`) when `HARNESS_MEM_ENABLE_UI` is enabled.

### Changed

- setup success logs now show both API (`:37888`) and Mem UI (`:37901`) URLs.
- setup/docs now document that Mem UI is auto-started by default.

### Fixed

- Removed first-setup UX gap where users had to manually clone the repository and run `harness-mem-ui` separately.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.
- To disable auto UI startup explicitly: `HARNESS_MEM_ENABLE_UI=false`.

### Verification

- `bash -n scripts/harness-memd`
- `bash -n scripts/harness-mem`
- `bun test tests/harness-memd-guardrails.test.ts`
- `npm pack --dry-run`

## [0.1.16] - 2026-02-22

### What changed for users

`harness-mem doctor --fix` now recovers environments missing ripgrep (`rg`) by automatically installing it via Homebrew during setup repair.

### Added

- Automatic `ripgrep` install path in dependency bootstrap (`brew install ripgrep`) when `rg` is missing.

### Changed

- Setup dependency failure hint now includes `ripgrep`.
- Troubleshooting docs now include `ripgrep` in required dependency list.

### Fixed

- Prevented `doctor_post_check` false-failures caused by `rg: command not found` in hook/wiring checks.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `bash -n scripts/harness-mem`
- `bun test tests/doctor-json-contract.test.ts tests/readme-plans-rules.test.ts`
- `npm pack --dry-run`

## [0.1.15] - 2026-02-22

### What changed for users

Release pipeline reliability improved again by fixing CI-environment detection in the medium-corpus latency quality gate.

### Added

- None.

### Changed

- Latency benchmark gate now detects CI using both `CI` and `GITHUB_ACTIONS`.
- CI threshold for the medium corpus gate is now `p95 < 3000ms` (local/dev remains `p95 < 500ms`).

### Fixed

- Prevented false release failures when GitHub Actions did not present `process.env.CI` as expected in Bun tests.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `cd memory-server && bun test tests/integration/search-quality.test.ts`
- `cd memory-server && bun test && bun run typecheck`
- `npm pack --dry-run`

## [0.1.14] - 2026-02-22

### What changed for users

Release workflow now passes consistently on GitHub-hosted runners by using CI-aware latency guard thresholds.

### Added

- None.

### Changed

- Adjusted medium-corpus search latency gate in CI context:
  - local/dev threshold remains `p95 < 500ms`
  - CI threshold is now `p95 < 1500ms`

### Fixed

- Prevented false-negative release failures caused by slower shared CI runners while preserving a strict local benchmark target.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `cd memory-server && bun test tests/integration/search-quality.test.ts`
- `cd memory-server && bun test && bun run typecheck`
- `npm pack --dry-run`

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
