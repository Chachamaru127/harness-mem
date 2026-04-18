# Harness-mem Onboarding Checklist

Use this checklist when you want to confirm that a new install is ready for real use.
Pass condition: every item below is `Yes`.

## 1. Choose the path

- [ ] I picked the `npx` path, or I intentionally chose `npm install -g`, or I am running from a repo checkout.
- [ ] I did not use `sudo` for setup or doctor.
- [ ] I know whether I am validating Claude Code, Codex, or both.

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

## 5. Confirm safety boundaries

- [ ] I understand where local data is stored.
- [ ] I understand that unsupported or experimental clients may not have the same first-turn continuity UX.
- [ ] I can explain the difference between setup success and first-turn continuity success.

## 6. If anything is still `No`

- [ ] Run `harness-mem doctor --fix`.
- [ ] Re-run setup if the hooks point at an old checkout path.
- [ ] Stop and inspect the exact config file before trying a second repair.
