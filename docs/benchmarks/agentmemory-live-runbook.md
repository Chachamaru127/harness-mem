# Agentmemory Live Comparison Runbook

Official Agentmemory is **self-hosted/local-first**. Internal benchmark live
measurement uses the official REST API on localhost only.

## Prerequisites

- Agentmemory daemon listening on `http://127.0.0.1:3111`
- Optional: `AGENTMEMORY_SECRET` when the daemon is protected
- harness-mem internal benchmark v2 dataset present

## Official API contract (pinned)

| Operation | Method | Path | Body |
|-----------|--------|------|------|
| Preflight | GET | `/agentmemory/health` | — |
| Ingest | POST | `/agentmemory/remember` | `{ project, title, content, agentId?, metadata? }` |
| Search | POST | `/agentmemory/smart-search` | `{ project, query, limit }` |

Auth: `Authorization: Bearer <AGENTMEMORY_SECRET>` when secret is configured.

Search response: `results[]` entries with `id`/`memory_id`, `content`/`text`/`summary`, `score`.

References:

- https://www.agent-memory.dev/
- https://github.com/aiagentmemory/agentmemory
- Official `.env.example`: no API auth on loopback by default; `AGENTMEMORY_SECRET` for protected REST

## Environment

```bash
export AGENTMEMORY_URL=http://127.0.0.1:3111   # default if unset
export AGENTMEMORY_SECRET=...                  # only when daemon is protected
```

Remote URLs are **rejected** by the benchmark adapter (localhost-only guard).

## Smoke (required before full run)

```bash
# Terminal 1
npx @agentmemory/agentmemory

# Terminal 2
curl -sf http://127.0.0.1:3111/agentmemory/health
bun run benchmark:internal-memory -- --competitors harness-mem,agentmemory --limit 20
```

DoD: `raw-results.jsonl` contains `competitor_id=agentmemory` rows with `status=ok`.

## Full v2 comparison

```bash
bun run benchmark:internal-memory -- --competitors harness-mem,agentmemory
```

Outputs: `benchmarks/internal-memory/reports/latest/*`

## Claim safety

- Same dataset/scorer/manifest as harness-mem in one run
- Reproduced vs published tables stay separate
- Results are internal same-run measurements, not broad market superiority claims
- Domain note: Agentmemory manifest domain is `generic-agent`; harness-mem is `developer-workflow`

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `health check failed` | daemon not running | start `npx @agentmemory/agentmemory` |
| HTTP 401 | wrong/missing secret | set `AGENTMEMORY_SECRET` |
| `localhost-only` error | remote URL in env | use `127.0.0.1` or `localhost` |
| all agentmemory errors | old `/v1/*` adapter | ensure §142 adapter is present |
