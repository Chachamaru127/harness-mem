# Harness-mem Onboarding Checklist

Use this checklist when you want to confirm that a new install is ready for real use.
Pass condition: every item below is `Yes`.

## 1. Choose the path

- [ ] I picked the `npx` path, or I intentionally chose `npm install -g`, or I am running from a repo checkout.
- [ ] I did not use `sudo` for setup or doctor.
- [ ] I know whether I am validating Claude Code, Codex, Cursor, or a combination of them.

## 2. Run setup

- [ ] I ran `harness-mem setup` with the intended client list.
- [ ] The command completed without path or permission errors.
- [ ] The setup wrote client wiring into my user-scoped config files.

## 3. Run doctor

- [ ] I ran `harness-mem doctor` for the same clients I set up.
- [ ] The output is green, or the remaining warnings are explained.
- [ ] If something failed, I can name the exact client and config file involved.

## 4. Confirm the first real session

- [ ] A fresh Claude Code session can recover recent project context on the first turn.
- [ ] A fresh Codex session can recover recent project context on the first turn.
- [ ] The recovered context matches the current project, not an older one.

## 4b. Confirm Cursor if selected

- [ ] I ran `harness-mem setup --platform cursor` or included `cursor` in the platform list.
- [ ] I ran `harness-mem doctor --platform cursor --read-only --strict-exit` and it is green.
- [ ] I reloaded/restarted Cursor or opened a new Cursor session if the MCP server list was cached.
- [ ] `~/.cursor/mcp.json` contains `mcpServers.harness-mem`, not a stale Cursor-only `harness` entry.
- [ ] After a real Cursor prompt and assistant response, project-scoped search can find both events.
- [ ] I understand Cursor is supported for hook ingest and MCP search, but this is not a Tier 1 continuity parity claim.

## 5. Confirm safety boundaries

- [ ] I understand where local data is stored.
- [ ] If I use Cursor, I understand hook JSONL is spooled locally under `~/.harness-mem/adapters/cursor/events.jsonl` unless overridden.
- [ ] I understand that unsupported or experimental clients may not have the same first-turn continuity UX.
- [ ] I can explain the difference between setup success and first-turn continuity success.

## 6. If anything is still `No`

- [ ] Run `harness-mem doctor --fix`.
- [ ] Re-run setup if the hooks point at an old checkout path.
- [ ] Stop and inspect the exact config file before trying a second repair.
