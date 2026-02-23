# Environment Tab V1 API Contract (2026-02-23)

## 1. Endpoint

- Method: `GET /v1/admin/environment`
- Auth: admin token required (`x-harness-mem-token` or `Authorization: Bearer ...`)
- UI Proxy: `GET /api/environment`
- Mode: read-only

## 2. Response Shape

`ApiResponse.items[0]` must include all required keys below:

```json
{
  "snapshot_id": "env_...",
  "generated_at": "2026-02-23T12:00:00.000Z",
  "summary": {
    "total": 0,
    "ok": 0,
    "warning": 0,
    "missing": 0,
    "servers": 0,
    "languages": 0,
    "cli_tools": 0,
    "ai_tools": 0
  },
  "servers": [],
  "languages": [],
  "cli_tools": [],
  "ai_tools": [],
  "errors": []
}
```

## 3. Item Rules

- `servers[*]` required fields:
  - `id`, `name`, `description`, `status`, `last_checked_at`
  - `pid`, `port`, `protocol`, `bind_address`, `process_name`
- `languages[*]` / `cli_tools[*]` / `ai_tools[*]` required fields:
  - `id`, `name`, `description`, `status`, `last_checked_at`
  - `installed`, `version`, `message`
- `status` enum:
  - `ok` (正常)
  - `warning` (注意)
  - `missing` (未検出)

## 4. Masking Rules (Required)

The API must mask sensitive values before returning payloads.

- Key-based masking:
  - keys including `api_key`, `token`, `secret`, `password`, `authorization`
  - output as `[REDACTED_SECRET]`
- Value-pattern masking:
  - tokens such as `sk-...`, `sk_...`, `rk-...`, `pk-...`
  - long bearer-like strings
  - output as `[REDACTED_SECRET]`
- Local home path masking:
  - absolute home path prefix replaced with `~`

## 5. Caching

- Server-side TTL cache: `20s`
- UI polling: `60s`
- Manual refresh bypasses UI wait and immediately re-fetches the endpoint

## 6. Error Handling

- Category-level failures must not collapse the entire response.
- Failed collectors are represented in `errors[]` and degraded section items (`warning` or `missing`).
