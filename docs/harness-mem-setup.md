# Harness-mem Setup Guide

This guide is the detailed reference for setup, diagnostics, migration, and environment tuning.
If you only need a quick start, read `README.md` first.

For a first-time Claude Code + Codex setup, use this path first:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude
npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform codex,claude
```

Success means:

- `doctor` is green for both clients
- `~/.codex/hooks.json` and `~/.claude.json` point at the current harness-mem checkout
- the first prompt in each supported client can recover recent project context

Related onboarding docs:

- [`onboarding-checklist.md`](./onboarding-checklist.md)
- [`onboarding-dry-run.md`](./onboarding-dry-run.md)
- [`readme-claims.md`](./readme-claims.md)
- [`doctor-ux-scope.md`](./doctor-ux-scope.md)

## 1. Installation Paths

### Recommended clean install flow for Claude Code + Codex

Think of setup in three separate stages:

1. Package delivery
   Use the `npx` command above first. If you need a persistent shell command, `npm install -g` is the alternative.
2. Client wiring
   Run `harness-mem setup` so harness-mem can write the required hooks and MCP wiring into each client config under your home directory.
3. Verification
   Run `harness-mem doctor` to confirm the daemon, hooks, and MCP wiring are actually healthy.

`npm install` alone is not the full setup. It only makes the CLI available. The Claude/Codex/Cursor connection work happens in `harness-mem setup`.

The default recommendation for this guide is:

- `npx` for the first run
- `npm install -g` only when you want a persistent command and your normal user can install globally without `sudo`
- repo checkout scripts only for contributors
- Windows Git Bash or WSL2 only when you cannot use the standard Unix-like path

### Important: do not run setup with sudo

`harness-mem setup` writes to user-scoped paths such as:

- `~/.harness-mem/`
- `~/.codex/`
- `~/.claude.json`
- `~/.claude/settings.json`
- `~/.cursor/`

If you run `sudo harness-mem setup`, `HOME` usually becomes root's home directory, so the wiring may be written to the wrong place and the created files may become root-owned. In practice, that makes later updates and self-repair harder.

Recommended rule:

- `npx ... harness-mem setup`: safe, no global install required
- `npm install -g ...`: only if your normal user can do global installs without `sudo`
- `sudo npm install -g ...`: avoid if possible
- `sudo harness-mem setup`: do not use

### Windows note

Native Windows PowerShell / CMD by itself is still not the strongest support path for full setup.

Reason:

- the published CLI still relies on POSIX shell scripts for setup and hook wiring
- runtime wiring writes Unix-oriented hook commands and paths
- harness-mem now tries to detect Git Bash on Windows and can launch the existing shell scripts through it
- the Git Bash route is the practical native Windows path for Codex / Claude manual setup and doctor; keep WSL2 as the fallback when your shell/toolchain is inconsistent
- exception: MCP-only config updates for Claude / Codex can be done natively with `harness-mem mcp-config --write --client claude,codex`

Recommended path on Windows:

1. If you use Claude Code, prefer the plugin route first
2. If you want manual native Windows setup, install Git for Windows and use Git Bash
3. If you only need MCP config updates for Claude / Codex, `harness-mem mcp-config --write --client claude,codex` works natively on Windows
4. Keep WSL2 as the most reliable fallback for the full setup / doctor lifecycle
5. For native Windows, prefer global install over `npx`

If you try to run the published CLI from native PowerShell / CMD, the command now fails fast with an explicit guidance message instead of an opaque `/bin/bash.exe` style error.

The `mcp-config` route updates only MCP wiring. It does not install the POSIX hook path, so first-turn continuity and hook-based Codex behavior still need the Git Bash / WSL2 full setup path.

If you want to try the Git Bash route for full setup on Windows, treat these as required:

- `node`
- `npm`
- `curl`
- `jq`
- `bun`
- `rg` (`ripgrep`)

If your environment requires elevated privileges for global npm installs, prefer the `npx` path instead of forcing the whole setup flow through `sudo`.

### npx (no global install)

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

On native Windows, prefer the global install path instead of `npx`.

### global install

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup
```

On Windows, run this from Git Bash when using the native compatibility path.

Use the global install path only when your normal shell user can run `npm install -g` without `sudo`, or when your npm prefix is already configured to a user-writable directory.

### update existing install

```bash
harness-mem update
```

`harness-mem update` asks whether to enable auto-update opt-in only when auto-update is currently disabled, then runs:

```bash
npm install -g @chachamaru127/harness-mem@latest
```

After a successful package update, harness-mem also runs a quiet post-update repair (`doctor --fix`) for the client platforms remembered from prior `setup` runs so broken hook/config wiring can self-heal.

## 2. Setup Flow

`harness-mem setup` performs:

1. Dependency checks (`bun`, `node`, `curl`, `jq`, `ripgrep`)
2. Tool wiring (Codex, OpenCode, Cursor, Claude, Antigravity)
3. Daemon start (`harness-memd`)
4. Mem UI start (`http://127.0.0.1:37901` by default)
5. Smoke test (unless `--skip-smoke`)
6. Search quality checks (unless `--skip-quality`)
7. Optional Claude-mem import + optional stop after verified cutover
8. Version snapshot (local vs upstream)

When `--platform` is omitted, setup is interactive:

1. Language
2. Target tools (multi-select)
3. Import from Claude-mem (yes/no)
4. Stop Claude-mem after verified import (yes/no)
5. Enable auto-update opt-in (yes/no)

### What "one command setup" means in practice

The intended first-run flow is:

1. Choose one install path
   `npx` is the safest default because it avoids global npm permission problems.
2. Run `harness-mem setup`
   This is the actual wiring step. It configures hooks and MCP for the selected clients, starts the local runtime, and runs checks.
3. Run `harness-mem doctor`
   This confirms the installation really works.

Examples:

For Codex + Claude without global install:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude
npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform codex,claude
```

If you are running from a repository checkout and want a repeatable Codex-only bootstrap:

```bash
bash scripts/setup-codex-memory.sh
npm run codex:doctor
```

On native Windows, use Git Bash + global install instead. `npx` is less reliable there.

For Claude Plugin Marketplace only:

- Install the plugin inside Claude Code.
- Claude-side hooks and MCP are wired automatically.
- If you also want Codex or Cursor wired, run `harness-mem setup --platform codex,cursor` separately.

That is why some users see an extra plugin command for Claude: the plugin route is a Claude-specific install surface, while `setup` is the general cross-client wiring command.

If auto-update opt-in is enabled, `harness-mem` checks npm for newer versions periodically (default: every 24 hours) before command execution and runs:

```bash
npm install -g @chachamaru127/harness-mem@latest
```

That post-update flow also attempts a quiet wiring repair for remembered client platforms. It does not blanket-wire every supported tool.

Notes:
- Config is stored in `~/.harness-mem/config.json` (`auto_update.enabled`).
- Auto-update checks are skipped in repo checkout mode and npx runtime mode.
- Temporarily disable auto-update checks per command with `HARNESS_MEM_SKIP_AUTO_UPDATE=1`.

### Continuity UX contract today

- Claude Code and Codex can show first-turn continuity when the client hook path is active, the daemon is healthy, and `harness-mem doctor` is green.
- On those supported hook paths, SessionStart is hybrid by default: the top of the artifact remains chain-first continuity, and a short `Also Recently in This Project` teaser may be appended when there is distinct nearby project activity.
- This is a runtime contract, not a blanket guarantee for every client: unsupported or experimental clients may still ingest/search without matching the Claude/Codex continuity UX.
- If hooks or the local runtime are stale, search and manual recall can still work while the "open a new session and it already remembers" UX degrades.

## 3. Command Reference

### `setup`

Configure wiring, start daemon/UI, and run verification checks.

```bash
harness-mem setup
harness-mem setup --platform codex,cursor
harness-mem setup --platform opencode,cursor --skip-quality
```

Options:

- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`
- `--skip-start`
- `--skip-smoke`
- `--skip-quality`
- `--skip-version-check`
- `--project <path>`
- `--quiet`

### `doctor`

Validate wiring and daemon/UI health.

```bash
harness-mem doctor
harness-mem doctor --platform codex,cursor
harness-mem doctor --fix --platform opencode
harness-mem doctor --json --read-only
harness-mem doctor --json --strict-exit
harness-mem doctor --fix --plan
```

Options:

- `--fix`
- `--json`
- `--read-only`
- `--strict-exit`
- `--plan` (with `--fix`, prints repair intent without applying changes)
- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`
- `--skip-version-check`
- `--project <path>`
- `--quiet`

### `update`

Update the global package and set auto-update opt-in when currently disabled.

```bash
harness-mem update
```

Notes:

- On interactive TTY, it prompts `Enable opt-in automatic updates for harness-mem?` (`y/N`) only when auto-update is currently disabled.
- The selected value is stored in `~/.harness-mem/config.json` (`auto_update.enabled`).

### `versions`

Snapshot local and upstream versions for supported tools.

```bash
harness-mem versions
```

Outputs:

- `~/.harness-mem/versions/tool-versions.json`
- `~/.harness-mem/versions/tool-versions-history.jsonl`

### `smoke`

Run isolated end-to-end validation for record/search + privacy behavior.

```bash
harness-mem smoke
```

### `uninstall`

Remove wiring and optionally purge local DB.

```bash
harness-mem uninstall
harness-mem uninstall --purge-db
```

Options:

- `--purge-db`
- `--platform <all|codex|opencode|claude|cursor|antigravity|comma-list>`

### `import-claude-mem`

Import from an existing Claude-mem SQLite DB.

```bash
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db --dry-run
```

Options:

- `--source <path>`
- `--import-project <name>`
- `--dry-run`
- `--quiet`

### `verify-import`

Verify an import job before cutover.

```bash
harness-mem verify-import --job <job_id>
```

Options:

- `--job <job_id>`
- `--quiet`

### `cutover-claude-mem`

Stop Claude-mem only after verification passes.

```bash
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

Options:

- `--job <job_id>`
- `--stop-now`
- `--quiet`

## 4. Platform Wiring Details

### Codex

- Maintains `~/.codex/hooks.json` entries for `SessionStart`, `UserPromptSubmit`, and `Stop`
- Ensures `~/.codex/config.toml` enables the experimental hooks engine (`features.codex_hooks = true` or `[features] codex_hooks = true`)
- Verifies memory bridge entries in `~/.codex/config.toml`
- Verifies that `~/.codex/config.toml` and `~/.codex/hooks.json` still point at the current harness-mem checkout instead of a stale absolute path
- Installs and checks both Codex skills: `~/.codex/skills/harness-mem/SKILL.md` and `~/.codex/skills/harness-recall/SKILL.md`
- Reports `codex_skill_drift` and `codex_post_doctor_liveness` in `doctor.v2` JSON output
- Checks ingest path from Codex session logs
- First-turn continuity on Codex depends on the hook path above plus a healthy daemon/runtime

Manual MCP check:

Run from the harness-mem repo root when using the local checkout binary. For a global install, use `harness-mcp-server`; for one-off package verification, use `npx -y --package @chachamaru127/harness-mem harness-mcp-server`.

```bash
./bin/harness-mcp-server <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-check","version":"1"}}}'
codex mcp list
codex mcp get harness
```

### OpenCode

- Uses `~/.config/opencode/opencode.json`
- Uses `~/.config/opencode/plugins/harness-memory/index.ts`
- `doctor --fix --platform opencode` can normalize config schema

### Cursor

- Uses `~/.cursor/hooks.json`
- Uses `~/.cursor/hooks/memory-cursor-event.sh`
- Uses `~/.cursor/mcp.json` (`mcpServers.harness`)

### Claude workflows

- Claude Code Plugin Marketplace wiring configures the Claude-side hooks and MCP automatically
- `harness-mem setup --platform claude` configures the same Claude-side runtime path without the marketplace flow
- Configures `mcpServers.harness` in `~/.claude.json`
- Updates `~/.claude/settings.json` if an MCP block already exists
- Claude Code `v2.1.119` persists `/config` changes to `~/.claude/settings.json`, so practical precedence is now `project/local/policy` across both `~/.claude.json` and `~/.claude/settings.json`
- If both files exist, higher-precedence Claude settings can override older MCP wiring; use `harness-mem doctor` after `/config` changes to confirm the active path still points at the current harness-mem checkout
- First-turn continuity on Claude depends on the `SessionStart` / `UserPromptSubmit` / `Stop` hook path and a healthy daemon/runtime
- If you also use Codex or Cursor, run `harness-mem setup --platform codex,cursor` so those clients are wired separately
- Supports import/verify/cutover migration flow

### Antigravity

- Experimental and hidden by default
- Requires explicit opt-in flags

## 5. Environment Variables

### Core runtime

- `HARNESS_MEM_HOST` (default: `127.0.0.1`)
- `HARNESS_MEM_PORT` (default: `37888`)
- `HARNESS_MEM_UI_PORT` (default: `37901`)
- `HARNESS_MEM_ENABLE_UI` (default: `true`)
- `HARNESS_MEM_LOG_MAX_BYTES` (default: `5242880`, 5MB)
- `HARNESS_MEM_LOG_ROTATE_KEEP` (default: `5`)

### Codex ingest

- `HARNESS_MEM_CODEX_SESSIONS_ROOT` (default: `~/.codex/sessions`)
- `HARNESS_MEM_CODEX_INGEST_INTERVAL_MS` (default: `60000`)
- `HARNESS_MEM_CODEX_BACKFILL_HOURS` (default: `24`)

### OpenCode ingest

- `HARNESS_MEM_ENABLE_OPENCODE_INGEST` (default: `true`)
- `HARNESS_MEM_OPENCODE_DB_PATH` (default: `~/.local/share/opencode/opencode.db`)
- `HARNESS_MEM_OPENCODE_STORAGE_ROOT` (default: `~/.local/share/opencode/storage`)
- `HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS` (default: `60000`)
- `HARNESS_MEM_OPENCODE_BACKFILL_HOURS` (default: `24`)

## 6. Environment Tab (read-only)

Mem UI now includes an `Environment` tab for non-specialists.

- Purpose:
  - Show current internal servers
  - Show installed languages/runtimes
  - Show installed CLI tools
  - Show AI/MCP tool status
- API:
  - daemon: `GET /v1/admin/environment` (admin token required)
  - UI proxy: `GET /api/environment`
- Safety:
  - V1 is read-only
  - API masks sensitive values (`token`, `api_key`, `secret`, etc.)

Contract details: `plans/environment-tab-v1-contract.md`

## 7. Troubleshooting

### Command not found

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### Doctor reports missing dependencies

Install required dependencies and repair:

```bash
harness-mem doctor --fix
```

### UI does not open

```bash
harness-memd doctor
curl -sS http://127.0.0.1:37901/api/health | jq '.ok'
```

### Need full cleanup

```bash
harness-mem uninstall --purge-db
```

### npm asked for sudo

That means your global npm location is not writable by your current user.

Best workaround:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude
```

This avoids global installation entirely.

If you really want global install, first fix npm itself so global packages are user-writable, then reinstall without `sudo`.

### I already used sudo and files became root-owned

Typical symptoms:

- `harness-mem doctor --fix` fails unless you add `sudo`
- files under `~/.harness-mem`, `~/.codex`, `~/.claude*`, or `~/.cursor` are owned by `root`

Recovery approach:

1. Stop using `sudo` for `harness-mem setup` and `harness-mem doctor`
2. Change ownership of the affected user-scoped files back to your user
3. Re-run setup and doctor as your normal user

Example:

```bash
sudo chown -R "$USER":staff ~/.harness-mem ~/.codex ~/.cursor ~/.claude ~/.claude.json 2>/dev/null || true
harness-mem setup --platform codex,claude
harness-mem doctor --fix --platform codex,claude
```

Adjust the group name if your machine does not use `staff`.

## 8. Related Docs

- `README.md`
- `README_ja.md`
- `docs/release-process.md`
- `plans/environment-tab-v1-contract.md`
- `CHANGELOG.md`
- `CHANGELOG_ja.md`
- `docs/benchmarks/`
