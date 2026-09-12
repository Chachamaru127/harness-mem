# File reference isolation

Project folders and conversation logs are optional inputs to the memory runtime.
While the memory database and required runtime assets remain accessible, a blocked
workspace lookup or source read does not stop scoped search or direct event recording.
A database or storage failure is outside this guarantee; an unconfirmed save is never
reported as successful.

## Project identity and migration

Existing stored project identifiers remain unchanged. Search, feed filters, statistics,
and UI selections use the complete `project` identifier. `display_name` is a label only.
Project statistics also return the complete identifier in `canonical_project`; legacy
feed and session responses still use `canonical_project` as a display label, so clients
must select by `project`. Clients that used a folder basename as a substitute for a
returned project identifier must use the identifier returned by the project list or
facets instead.

A logical name and an absolute path are distinct identifiers unless an explicit,
confirmed mapping exists. Restart does not merge historical records. This prevents
two unrelated folders with the same name from becoming one searchable project.
Existing records remain accessible under their original identifiers.

Healthy asynchronous project preparation can confirm symlinks, nested repositories,
and Git worktrees using a database-free resolver process. Confirmed mappings persist
in the memory database. Synchronous core calls use the information already known;
callers requiring fresh filesystem identity can await `prepareProject()` before the
operation. The wait has a deadline and an unresolved result remains usable as its
own identity.

Responses include `meta.project_resolution` when an input is unresolved or conflicts
with its saved identity. `unresolved` means historical aliases have not been verified;
an empty result in that scope does not establish that no related history exists.
`conflict` preserves the established project and reports the proposed replacement as
`candidate`. A changed symlink never silently relocates existing memory. Reconciliation
requires an explicit decision; this change does not provide an automatic merge command.

## Source reads and acknowledged progress

Codex, Cursor, OpenCode, Antigravity, Gemini, and Claude Code use database-free reader
children for discovery and reading. OpenCode's own source SQLite database can be opened
read-only; the memory database is excluded by file identity.

The default reader pool has two slots. A stalled operation is quarantined so another
known file or source can progress in an available slot. Discovery from an unreadable
directory remains pending. If every reader slot is occupied by an unconfirmed process,
ingest pauses while scoped search and direct records remain available.

The database owner acknowledges persisted events. Offsets and parser context advance
only after that acknowledgement; failed or lost acknowledgements replay the same dedupe
identity. Compare-and-set checks prevent a late reader from rewinding another reader's
progress. Privacy filtering applies to content before IPC while preserving identifiers.
Messages and queues have finite size limits. Oversized input stays pending rather than
being silently truncated or skipped.

## Restart and diagnostics

Both resolver and reader process slots have durable reservations. A reservation is made
before spawn and released after confirmed process exit. Restart counts outstanding
reservations against the same limit; it does not create a fresh set of slots over living
old processes. Dead PIDs are reclaimed only when absence is confirmed. A live or reused
PID, an unknown PID, or a failed inspection retains its reservation.

`GET /health` exposes `reference_io.project_resolver` and `reference_io.source_reader`.
`reserved` includes outstanding reservations across owner restarts. A positive reservation
count with no local active child can indicate retained work from an earlier owner.
Do not delete reservations merely because a timeout elapsed: the process may still exist.

Health reports configured Antigravity roots without opening workspace storage.
`antigravity_workspace_roots_status: not_observed` means discovery was not performed by
health, not that the configured source has no workspaces.

## Acceptance coverage

- Permanent resolver stalls: HTTP search, record readback, cold restart, and persisted aliases.
- One thousand requests: bounded resolver/reader queues and process counts.
- Permanent stat/open/read/directory operations: another source and known file still progress.
- All reader slots unavailable: HTTP recording/search continue across owner restart without child multiplication.
- Lost save acknowledgements: unchanged offset and deduplicated replay.
- Real FIFO workspace metadata: health never waits for the source file.
- Project facet/statistics/UI round trips: same-name folders retain separate selectable identities.

Run focused suites with the repository's Bun test runner. `health-source-reference.test.ts`
uses POSIX FIFOs and is skipped on Windows; the portable resolver, ledger, and reader
fault tests still apply. Tests use isolated temporary databases. They do not deliberately
stall production filesystem access.
