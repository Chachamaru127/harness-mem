# Codex App Local Dogfood Note - 2026-05-26

This note records a scoped maintainer dogfood signal for README wording.

## Scope

- Codex CLI remains the Tier 1 Codex support target.
- Codex App is currently working in the maintainer's local setup when it uses
  the same user-scoped Codex configuration path as Codex CLI.
- This is not a general Tier 1 support claim for every Codex App environment.

## Evidence Shape

- Current Codex App sessions receive harness-mem continuity context through the
  same local project runtime.
- The support claim must stay scoped as local dogfood until a reproducible
  App-specific smoke test exists.

## README Wording Rule

README may say that Codex App is local-dogfood green in this setup.
README must not say Codex App has full Tier 1 parity unless an App-specific
smoke test is added and promoted.
