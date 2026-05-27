# Onboarding Dry Run Notes

These notes help you choose the right install flow before you make changes to your user config.
They are decision notes, not an execution transcript.

## 1. Repo checkout flow

Best for:

- contributors who are already inside this repo
- repeatable local validation
- people who want a known checkout path for Codex-specific bootstrap work

What it changes:

- user-scoped config files for the selected clients
- local memory data and hook wiring

Typical commands:

```bash
bash scripts/setup-codex-memory.sh
npm run codex:doctor
```

Dry-run expectations:

- the commands still touch user config
- the checkout path should be the current repo, not an older clone
- follow-up `doctor` should confirm the hook path and daemon health

## 2. npm global install flow

Best for:

- users who want a persistent `harness-mem` command on PATH
- normal user shells that can install globals without `sudo`

What it changes:

- the global npm package
- then the same user-scoped client wiring as the other flows

Typical commands:

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup --platform codex,claude
```

Add Cursor only when you want the same local runtime available from Cursor:

```bash
harness-mem setup --platform codex,claude,cursor
harness-mem doctor --platform codex,claude,cursor
```

Dry-run expectations:

- this is more convenient than repo checkout for day-to-day use
- it is not safer than the `npx` path if your environment has global install friction

## 3. npx flow

Best for:

- first-time evaluation
- environments where you do not want a permanent global install
- setup paths that should avoid `sudo`

What it changes:

- nothing persistent in npm global state
- the same user-scoped wiring as the other flows

Typical commands:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude
```

Cursor-only evaluation:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform cursor
npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform cursor
```

Dry-run expectations:

- best default for a clean start
- good when you only want to prove the setup path once

## 4. Choosing between them

- Choose `npx` if you want the safest first run.
- Choose global install if you want a persistent CLI and your user can install globals cleanly.
- Choose repo checkout if you are contributing to harness-mem itself.
- Avoid `sudo` unless you are debugging a broken environment and understand the ownership impact.

## 5. Cursor-specific expectations

Best for:

- users who want Cursor MCP search against the same local harness-mem DB
- users who want Cursor prompt / assistant / tool events captured through official Cursor hooks

What it changes:

- `~/.cursor/hooks.json`
- `~/.cursor/hooks/memory-cursor-event.sh`
- `~/.cursor/mcp.json` with `mcpServers.harness-mem`
- local Cursor hook spool under `~/.harness-mem/adapters/cursor/events.jsonl`

Dry-run expectations:

- setup is user-scoped and does not depend on whether the current checkout is a git worktree
- setup merges harness-mem hook entries without deleting unrelated Cursor hooks
- Cursor may need reload/restart or a new session before MCP discovery sees `harness-mem`
- doctor green proves wiring; a real Cursor prompt followed by project-scoped search proves ingest
