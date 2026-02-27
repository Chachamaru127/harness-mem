# @harness-mem/sdk

TypeScript SDK for the [harness-mem](https://github.com/claude-code-harness/harness-mem) memory server.

## Installation

```bash
npm install @harness-mem/sdk
# or
bun add @harness-mem/sdk
```

## Quick Start

```typescript
import { HarnessMemClient } from "@harness-mem/sdk";

const client = new HarnessMemClient({
  baseUrl: "http://localhost:37888", // default
});

// Record an observation
await client.record({
  session_id: "session-123",
  payload: { prompt: "TypeScript を採用することを決定した" },
  tags: ["decision"],
});

// Search memories
const results = await client.search({
  query: "TypeScript 採用",
  project: "/my/project",
  limit: 5,
  include_private: true,
});

for (const item of results.items) {
  console.log(item.id, item.content);
}
```

## API

### `new HarnessMemClient(options?)`

Creates a new client instance.

**Options:**
- `baseUrl` (string): Server URL. Defaults to `http://localhost:37888`.
- `timeout` (number): Request timeout in milliseconds. Defaults to `10000`.

### `client.record(input)`

Records an event to the memory server.

**Input:**
```typescript
{
  session_id: string;      // required
  payload: Record<string, unknown>;  // required
  platform?: string;       // default: "claude"
  project?: string;        // default: cwd
  event_type?: string;     // default: "user_prompt"
  ts?: string;             // ISO timestamp
  tags?: string[];
  privacy_tags?: string[]; // "block" | "private" | "redact"
  correlation_id?: string;
}
```

### `client.search(input)`

Searches observations using hybrid ranking (lexical + vector + graph).

**Input:**
```typescript
{
  query: string;           // required
  project?: string;
  session_id?: string;
  limit?: number;          // default: 20, max: 100
  include_private?: boolean;
  expand_links?: boolean;  // include linked observations
  exclude_updated?: boolean; // exclude observations superseded by updates
  strict_project?: boolean;  // default: true
}
```

### `client.resumePack(input)`

Gets a condensed context pack for AI context injection.

**Input:**
```typescript
{
  project: string;         // required
  session_id?: string;
  correlation_id?: string;
  limit?: number;
  include_private?: boolean;
  resume_pack_max_tokens?: number;  // default: 2000
}
```

### `client.timeline(input)`

Gets temporal context around a specific observation.

**Input:**
```typescript
{
  id: string;              // observation ID (required)
  before?: number;         // observations before (default: 3)
  after?: number;          // observations after (default: 3)
  include_private?: boolean;
}
```

### `client.getObservations(input)`

Gets full details of specific observations by ID.

**Input:**
```typescript
{
  ids: string[];           // observation IDs (required)
  include_private?: boolean;
  compact?: boolean;       // default: true (truncates content to 800 chars)
}
```

### `client.health()`

Checks server health status.

## Response Format

All methods return `ApiResponse<T>`:

```typescript
interface ApiResponse<T> {
  ok: boolean;
  source: string;
  items: T[];
  meta: Record<string, unknown>;
  error?: string;
}
```

## License

MIT
