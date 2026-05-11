# harness-mem-hermes-bridge

A [Hermes Agent](https://github.com/nousresearch/hermes-agent) plugin that forwards session lifecycle events to a running [harness-mem](https://github.com/Chachamaru127/harness-mem) daemon. Built so that Claude Code / Codex / Cursor and Hermes can share the same cross-tool memory space.

> **Tier 3 (experimental).** See [`Plans.md` §111](../../../Plans.md) for the support tier and promotion criteria.

## What this plugin does

| Hermes hook | harness-mem action |
|---|---|
| `on_session_start(session_id, model, platform, **kwargs)` | `record_event(event_type="session_start")` |
| `on_session_end(session_id, completed, interrupted, model, platform, **kwargs)` | `record_event(event_type="session_end")` + `finalize_session()` if cleanly completed |

Every event is tagged with `platform="hermes"` so it can be filtered or correlated against Claude Code / Codex events in the shared memory space.

**Not in scope** (see Plans.md §111 Non-Goals):

- Replacing Hermes built-in memory (`~/.hermes/MEMORY.md`, `USER.md`, `skills/`).
- Per-turn / per-message event capture — Hermes does not expose a `UserPromptSubmit`-equivalent hook. Use the JSONL ingest helper (planned in S111-006) for turn-level fidelity.

## Requirements

- Python 3.10+
- Hermes Agent **v0.13.0+** (plugin API stabilized release)
- A reachable harness-mem daemon (default: `http://127.0.0.1:37888`)

## Install

```bash
# from a checkout of this repository
pip install -e integrations/hermes/plugin

# or, once published
pip install harness-mem-hermes-bridge
```

Enable the plugin in `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - harness-mem-bridge
```

The plugin is discovered through the `hermes_agent.plugins` entry-point group declared in `pyproject.toml`.

## Configuration

All settings are read from environment variables at plugin load time.

| Variable | Default | Purpose |
|---|---|---|
| `HARNESS_MEM_URL` | `http://127.0.0.1:37888` | Daemon base URL |
| `HARNESS_MEM_TOKEN` | _(unset)_ | Bearer token forwarded as `x-harness-mem-token` |
| `HARNESS_MEM_PROJECT_KEY` | `default` | Project namespace passed to `finalize_session` |

Match `HARNESS_MEM_PROJECT_KEY` with the value used by Claude Code / Codex setups to share the same memory space.

## Development

```bash
cd integrations/hermes/plugin

# install test deps
pip install -e .[test]

# run tests
pytest
```

The test suite mocks `HarnessMemClient` so no daemon is required. End-to-end verification against a live Hermes installation lives in Plans.md §111 S111-005.

## Architecture

```
Hermes Agent (v0.13+)
        │  plugin hook
        ▼
harness_mem_hermes_bridge.plugin
        │  HarnessMemClient (harness-mem python SDK)
        │  POST /v1/events/record
        │  POST /v1/sessions/finalize
        ▼
harness-mem daemon (localhost:37888)
        │
        ▼
~/.harness-mem/harness-mem.db (shared with Claude Code / Codex / Cursor)
```

## See also

- [`integrations/hermes/README.md`](../README.md) — overall positioning and config examples
- [`docs/integrations/hermes.md`](../../../docs/integrations/hermes.md) — detailed setup, troubleshooting, tier criteria
- [Hermes Event Hooks docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks)
- [Hermes Plugins docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)

## License

MIT — same as harness-mem.
