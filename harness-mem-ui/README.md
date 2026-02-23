# harness-mem-ui

`harness-mem-ui` is the dedicated UI for Unified Harness Memory.
It stays fully separate from any `harness-ui` app and only talks to `harness-memd`.

## Features

- Live feed via SSE (`/api/stream`)
- Cursor-based infinite feed (`/api/feed`)
- Project sidebar with stats (`/api/projects/stats`)
- Search facets (`/api/search/facets`)
- Session list/thread (`/api/sessions/list`, `/api/sessions/thread`)
- Search / Timeline / Observation / Session tabs
- Local settings persistence (`include_private`, project, page size, auto-scroll, theme, active tab)
- Private data hidden by default (`include_private=false`)

## Runtime

- UI host: `http://127.0.0.1:37901`
- Daemon host/port defaults:
  - `HARNESS_MEM_HOST=127.0.0.1`
  - `HARNESS_MEM_PORT=37888`

## Setup

```bash
cd /Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui
bun install
```

## Commands

```bash
# build UI static bundle
bun run build:web

# bundled mode (build assets, then run BFF/static server)
bun run dev

# run only server (expects static assets already built)
bun run dev:server

# run only Vite dev server
bun run dev:web

# type check
bun run typecheck

# unit tests (Vitest)
bun run test:ui

# e2e tests (Playwright)
bun run test:e2e
```

## API Forwarding (BFF)

The UI server proxies to daemon:

- `GET /api/health` -> `GET /health`
- `GET /api/metrics` -> `GET /v1/admin/metrics`
- `GET /api/feed` -> `GET /v1/feed`
- `GET /api/projects/stats` -> `GET /v1/projects/stats`
- `GET /api/stream` -> `GET /v1/stream` (SSE passthrough)
- `GET /api/sessions/list` -> `GET /v1/sessions/list`
- `GET /api/sessions/thread` -> `GET /v1/sessions/thread`
- `GET /api/search/facets` -> `GET /v1/search/facets`
- `POST /api/search` -> `POST /v1/search`
- `POST /api/timeline` -> `POST /v1/timeline`
- `POST /api/observations` -> `POST /v1/observations/get`
- `POST /api/resume` -> `POST /v1/resume-pack`

## Import/Cutover Ops

UI operates on the unified DB only. Import/cutover is executed from the root CLI:

```bash
scripts/harness-mem import-claude-mem --source /absolute/path/to/claude-mem.db
scripts/harness-mem verify-import --job <job_id>
scripts/harness-mem cutover-claude-mem --job <job_id> --stop-now
```
