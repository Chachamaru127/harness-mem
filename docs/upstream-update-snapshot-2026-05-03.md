# Claude/Codex Upstream Update Snapshot — 2026-05-03

作成日: 2026-05-03 JST
対象 repo: `harness-mem`
目的: official release / changelog を根拠に、「Claude/Codex がこう変わったので、harness-mem 側はどう受けるか」を次回再開しやすい形で残す。

## 1. Executive Summary

- Claude Code latest stable は **`v2.1.126`**
  - 確認元: official docs changelog / raw GitHub changelog
  - local verification: `claude --version` = `2.1.126 (Claude Code)`
- Codex latest stable は **`rust-v0.128.0`**
  - published: **2026-04-30 16:40:28 UTC**
  - JST: **2026-05-01 01:40:28 JST**
  - local verification: `codex --version` = `codex-cli 0.128.0`
- Codex pre-release の `rust-v0.129.0-alpha.*` は存在するが、今回の user request に従い対象外。
- 今回の `A` は 3 点:
  1. Codex 0.125+ / 0.128 stable の permission profile / goal / external session / app-server transport 系 metadata を hook payload から落とさない
  2. Claude Code 2.1.120+ / 2.1.126 の PostToolUse trace metadata を安全に保持し、tool output replacement は使わない
  3. Claude Code 2.1.120 の Windows PowerShell-first 変更に合わせ、Windows で Bash が無い hook 環境は non-blocking skip する

## 2. Review Baseline

前回 upstream review の基準点:

- Claude Code: `v2.1.119`
- Codex: `rust-v0.124.0`
- snapshot: `docs/upstream-update-snapshot-2026-04-25.md`

今回の確認は、その後に stable 化した項目を `A / C / P` へ再分類する。

## 3. Official Sources

### Claude Code

- Official changelog docs: <https://code.claude.com/docs/en/changelog>
- Raw changelog: <https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md>
- Releases index: <https://github.com/anthropics/claude-code/releases>

### Codex

- Releases index: <https://github.com/openai/codex/releases>
- `rust-v0.125.0`: <https://github.com/openai/codex/releases/tag/rust-v0.125.0>
- `rust-v0.128.0`: <https://github.com/openai/codex/releases/tag/rust-v0.128.0>
- Compare API (`0.124.0 -> 0.125.0`): <https://api.github.com/repos/openai/codex/compare/rust-v0.124.0...rust-v0.125.0>
- Compare API (`0.125.0 -> 0.128.0`): <https://api.github.com/repos/openai/codex/compare/rust-v0.125.0...rust-v0.128.0>
- Product update anchor: <https://openai.com/index/codex-for-almost-everything/>

## 4. Version-by-version Action Table

| Version | Upstream item | Category | Harness surface | Action |
|---------|---------------|----------|-----------------|--------|
| Claude Code `2.1.120` | Windows: Git Bash is no longer required; Claude Code can use PowerShell as shell tool | A | `scripts/run-script.js`, `tests/windows-cli-entry-contract.test.ts` | Windows で Bash が無い hook execution を session-breaking error にせず、shared Bash detector 経由で actionable message + exit 0 にする |
| Claude Code `2.1.120` | `claude ultrareview`, `AI_AGENT`, plugin validate schema relaxation, telemetry fixes | C / P | Plans | harness-mem runtime は直接変えない。`ultrareview` 連携は review workflow 側の将来候補 |
| Claude Code `2.1.121` | PostToolUse hooks can replace tool output for all tools via `hookSpecificOutput.updatedToolOutput` | A | `scripts/hook-handlers/memory-post-tool-use.sh`, `tests/memory-post-tool-use-contract.test.ts` | memory hook は tool output rewrite を使わず、stdout empty を contract 化。safe metadata only を保持する |
| Claude Code `2.1.121` | `--resume` large/corrupt session fixes, MCP retry, memory leak fixes, plugin prune | C | docs snapshot | Claude Code 本体改善を自動継承。harness-mem の resume-pack contract 変更は不要 |
| Claude Code `2.1.122` | OpenTelemetry `claude_code.at_mention`, numeric attributes, PR URL `/resume` search | P / C | Plans | OTel ingest は将来候補。PR URL resume search は upstream UX を自動継承 |
| Claude Code `2.1.123` | OAuth 401 retry loop fix | C | none | harness-mem 変更不要 |
| Claude Code `2.1.126` | `claude project purge [path]` deletes Claude Code project state | P | Plans | Claude transcript purge と harness-mem local DB の境界説明は将来 docs / doctor 候補。今回の hook hardening とは分離 |
| Claude Code `2.1.126` | `claude_code.skill_activated` OTel has `invocation_trigger` | P | Plans | Skill activation analytics / procedural skill synthesis の将来候補。現 hook path は Skill PostToolUse で維持 |
| Claude Code `2.1.126` | `--dangerously-skip-permissions` bypasses more protected writes; sandbox managed-source bug fixed | C | none | Claude 本体の safety/runtime correction を自動継承。harness-mem は dangerous write approval を肩代わりしない |
| Claude Code `2.1.126` | OAuth fallback code paste, gateway `/v1/models`, deferred tools first-turn availability, remote/stream timeout fixes | C | none | Claude 本体の UX / provider / runtime 改善を自動継承 |
| Codex `0.125.0` | App-server supports Unix socket transport, pagination-friendly resume/fork, sticky environments, remote thread config/store | A / P | `hook-common.sh`, `tests/codex-future-session-contract.test.ts`, Plans | `thread_store` / `app_server_transport` metadata を保持。deep remote thread ingestion は将来候補 |
| Codex `0.125.0` | Permission profiles round-trip across TUI sessions, user turns, MCP sandbox state, shell escalation, app-server APIs | A | `hook-common.sh`, `tests/codex-future-session-contract.test.ts` | `permission_profile` / `permission_profile_id` を event meta に保持 |
| Codex `0.125.0` | `codex exec --json` reports reasoning-token usage; rollout tracing records tool/code/session/multi-agent relationships | P | Plans | token/trace ingestion は将来候補。現 hook event contract は壊さない |
| Codex `0.125.0` | App-server plugin management and remote marketplace upgrade | C | none | Codex 本体の plugin UX を自動継承。harness-mem skill bundle 変更なし |
| Codex `0.128.0` | Persisted `/goal` workflows with APIs, model tools, runtime continuation, TUI controls | A / P | `hook-common.sh`, `tests/codex-future-session-contract.test.ts`, Plans | `goal_id` / `goal_status` を保存。goal-aware resume-pack は将来候補 |
| Codex `0.128.0` | Expanded permission profiles with built-in defaults, sandbox CLI selection, cwd controls, active-profile metadata | A | `hook-common.sh`, `tests/codex-future-session-contract.test.ts` | `active_profile` / `active_profile_id` / `cwd` を保存 |
| Codex `0.128.0` | External agent session import, including background imports and imported-session title handling | A / P | `hook-common.sh`, `tests/codex-future-session-contract.test.ts`, Plans | `external_agent` / `external_session_id` を保存。full imported-session ingestion は将来候補 |
| Codex `0.128.0` | Resume/interruption, terminal/TUI, managed network, Windows sandbox, Bedrock/MCP/plugin fixes | C | none | Codex 本体の runtime 改善を自動継承 |
| Codex `0.128.0` | `--full-auto` deprecated in favor of explicit permission profiles and trust flows | P | Plans | setup docs / doctor wording の将来候補。今回の metadata capture で前提を受ける |

## 5. Implemented Receiving Surfaces

### Codex hook metadata

`hook_extract_codex_hook_meta` now preserves stable 0.125+ / 0.128-style additive metadata when present:

- `permission_profile`, `permission_profile_id`
- `active_profile`, `active_profile_id`
- `cwd`
- `goal_id`, `goal_status`
- `external_agent`, `external_session_id`
- `model_provider`
- `thread_store`
- `app_server_transport`

これにより、Codex 側の app-server / goal / permission profile が成長しても、harness-mem の observation は「どの thread / environment / profile / goal から来たか」を失いにくい。

### Claude PostToolUse metadata

`memory-post-tool-use.sh` now preserves safe trace metadata when present:

- `tool_use_id`
- `cwd`
- `permission_mode`
- `permission_profile`, `permission_profile_id`
- `transcript_path`

`hookSpecificOutput.updatedToolOutput` は使わない。memory hook は記録係であり、tool output を書き換える責務を持たない。

### Windows hook runner

`scripts/run-script.js` now uses the shared Windows Bash detector from `scripts/lib/bash-entry.js`.

Claude Code `2.1.120` 以降、Windows で Git Bash なしの PowerShell-first 環境が増えるため、Bash が無い場合は hook を non-blocking skip し、セッション本体を壊さない。

## 6. Future Candidates

- `claude project purge` と harness-mem local DB の境界 docs / doctor warning
- Claude OTel `skill_activated.invocation_trigger` の skill usage analytics
- Codex `/goal` workflow と resume-pack の goal-aware continuation
- Codex external agent session import の harness-mem ingest path
- Codex reasoning-token usage / rollout trace の memory event ingestion
- Codex `--full-auto` deprecation に合わせた setup docs / doctor wording

## 7. Local Verification

- `claude --version` = `2.1.126 (Claude Code)`
- `codex --version` = `codex-cli 0.128.0`

対象 test:

- `bun test tests/codex-future-session-contract.test.ts`
- `bun test tests/memory-post-tool-use-contract.test.ts`
- `bun test tests/windows-cli-entry-contract.test.ts`
