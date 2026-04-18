# Doctor UX Scope

This note defines the current confusion points in `harness-mem doctor` and the next-phase CLI improvements we want.
It is a scope note, not an implementation plan.

## What doctor is for

`doctor` should answer three questions quickly:

1. Is the daemon healthy?
2. Is the client wiring current?
3. What should I do next if something is wrong?

## Current confusion points

- The output can mix diagnosis and repair hints without a clear top-line verdict.
- The user may not immediately see which client failed when multiple clients are checked at once.
- The difference between setup success, hook success, and first-turn continuity success is not always obvious.
- `--fix` can feel opaque if the user cannot see which files changed or why.
- Platform-specific guidance is present, but the user may have to read too much before finding the one relevant action.

## Next-phase CLI improvements

- Add a short summary line at the top: `healthy`, `degraded`, or `broken`.
- Group output by concern: daemon, hook wiring, client config, version drift.
- Show the exact next action for the first failing item.
- Make repair output explicit enough that users can tell what `--fix` changed.
- Keep English and Japanese wording aligned so the same failure means the same thing in both surfaces.

## Out of scope for this note

- Changing the actual repair logic
- Redesigning setup flow
- Expanding support to new clients
- Replacing `doctor` with a different command
