# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harnes-mem/official/harness-mem-logo-official.jpg" alt="Harness-mem official logo" width="560" />
</p>

<p align="center"><strong>One memory runtime for Codex, OpenCode, Cursor, and Claude workflows.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/v/@chachamaru127/harness-mem" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@chachamaru127/harness-mem"><img src="https://img.shields.io/npm/dm/@chachamaru127/harness-mem" alt="npm downloads" /></a>
  <a href="https://github.com/Chachamaru127/harness-mem/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Chachamaru127/harness-mem/release.yml?label=release" alt="release workflow" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Chachamaru127/harness-mem" alt="license" /></a>
</p>

Harness-mem helps teams keep memory behavior consistent across multiple coding tools without wiring each tool by hand.

## Quick Start

### Option A: run with npx (no global install)

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform codex,cursor
```

### Option B: global install

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup
harness-mem doctor --platform codex,cursor
```

If you omit `--platform`, `setup` runs an interactive flow:

1. Language selection
2. Target tool selection (multi-select)
3. Optional Claude-mem import
4. Optional Claude-mem stop after verified import

## Why Harness-mem

1. One setup entrypoint for multi-tool memory wiring.
2. Safe migration path from Claude-mem with verify-before-cutover.
3. Built-in guardrails for privacy filtering and retrieval quality.

## What You Get

| Capability | What it gives you |
|---|---|
| `setup` | Automated wiring for Codex, OpenCode, Cursor, and runtime startup |
| `doctor` | Deterministic health and wiring checks with optional repair |
| `smoke` | End-to-end privacy and retrieval sanity check |
| `import-claude-mem` + `verify-import` + `cutover-claude-mem` | Controlled migration that blocks unsafe cutover |
| Memory feed + search APIs | Shared memory view across supported tools |

## Supported Tools

| Tool | Status | Notes |
|---|---|---|
| Codex | Supported | Config wiring, ingestion, doctor checks |
| OpenCode | Supported | Global wiring + schema-safe config repair |
| Cursor | Supported | Hook-based ingestion + doctor checks |
| Claude workflows | Supported | Compatibility checks and migration/cutover path |
| Antigravity | Experimental | Hidden by default, opt-in via environment flags |

## Common Use Cases

1. Standardize memory behavior across mixed local toolchains.
2. Migrate from Claude-mem while preserving privacy tags.
3. Diagnose broken wiring quickly with one doctor command.
4. Keep local memory runtime stable when using npm/npx setup paths.

## Migration from Claude-mem

```bash
harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
harness-mem verify-import --job <job_id>
harness-mem cutover-claude-mem --job <job_id> --stop-now
```

Migration behavior:

- Imports by schema introspection (`observations`, `session_summaries`, `sdk_sessions`).
- Preserves privacy tags (`private`, `sensitive`) with default-hidden search behavior.
- Blocks cutover unless verification passes.

## Troubleshooting

### 1) `harness-mem: command not found`

Use the npx path directly:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### 2) `doctor` reports missing dependencies

Install required tools (`bun`, `node`, `curl`, `jq`) and run:

```bash
harness-mem doctor
```

### 3) OpenCode fails after config drift

Repair OpenCode wiring:

```bash
harness-mem doctor --fix --platform opencode
```

### 4) npx-based setup breaks after cache cleanup

Re-run setup to refresh stable runtime wiring:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor
```

### 5) Need full local removal

```bash
harness-mem uninstall --purge-db
```

## FAQ

### Is this a hosted service?

No. Harness-mem is a local runtime and wiring CLI.

### Does it support private memory filtering?

Yes. Default retrieval hides private/sensitive data unless explicitly requested.

### Can I run setup without changing files first?

Yes. Use command-level dry runs where available (for example import planning with `--dry-run`).

### Where are advanced options and environment variables?

See `docs/harness-mem-setup.md`.

## Advanced Setup

For full command reference, environment variables, ingestion paths, and platform-specific notes:

- [Harness-mem Setup Guide](docs/harness-mem-setup.md)

## Release and Changelog

- Versioning follows SemVer.
- Automated release flow runs from Git tags via `.github/workflows/release.yml`.
- User-facing change history lives in [`CHANGELOG.md`](CHANGELOG.md).

## Contributing

Contributions are welcome through issues and pull requests.

- Issues: <https://github.com/Chachamaru127/harness-mem/issues>
- Repository: <https://github.com/Chachamaru127/harness-mem>

## License

MIT. See [`LICENSE`](LICENSE).

## Official Mascot

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harnes-mem/official/harness-mem-mascot-official.jpg" alt="Harness-mem official mascot" width="360" />
</p>

The mascot section is for brand continuity only and is intentionally separate from feature explanations.
