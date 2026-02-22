# Harness MCP Server

MCP (Model Context Protocol) server for Claude Code Harness.
Enables cross-client session communication between Claude Code, Codex, Cursor, and other MCP-compatible AI tools.

## Features

- **Session Communication**: Broadcast messages across different AI client sessions
- **Workflow Tools**: Plan → Work → Review cycle accessible from any MCP client
- **Status Sync**: Unified project status across all clients
- **Unified Memory**: Cross-platform record/search/injection via `harness-memd`

## Installation

```bash
# From npm (when published)
npm install -g @anthropic-ai/harness-mcp-server

# From source
cd mcp-server
npm install
npm run build
```

## Usage

### With Claude Code

```json
// .claude/settings.json
{
  "mcpServers": {
    "harness": {
      "command": "npx",
      "args": ["@anthropic-ai/harness-mcp-server"]
    }
  }
}
```

### With Codex

```json
// ~/.codex/mcp.json
{
  "servers": {
    "harness": {
      "command": "npx",
      "args": ["@anthropic-ai/harness-mcp-server"]
    }
  }
}
```

### With Cursor

```json
// .cursor/mcp.json
{
  "harness": {
    "command": "npx",
    "args": ["@anthropic-ai/harness-mcp-server"]
  }
}
```

## Available Tools

### Session Communication

| Tool | Description |
|------|-------------|
| `harness_session_list` | List all active sessions |
| `harness_session_broadcast` | Send message to all sessions |
| `harness_session_inbox` | Check for new messages |
| `harness_session_register` | Register current session |

### Workflow

| Tool | Description |
|------|-------------|
| `harness_workflow_plan` | Create implementation plan |
| `harness_workflow_work` | Execute tasks from Plans.md |
| `harness_workflow_review` | Multi-perspective code review |

### Status

| Tool | Description |
|------|-------------|
| `harness_status` | Get project status |

### Unified Memory

| Tool | Description |
|------|-------------|
| `harness_mem_resume_pack` | Get resume context pack |
| `harness_mem_search` | 3-layer Step1: candidate ID search (`meta.token_estimate`) |
| `harness_mem_timeline` | 3-layer Step2: context expansion (`meta.token_estimate`) |
| `harness_mem_get_observations` | 3-layer Step3: detail fetch for filtered IDs (`meta.token_estimate`, large-batch warning) |
| `harness_mem_record_checkpoint` | Record checkpoint memory |
| `harness_mem_finalize_session` | Finalize session summary |
| `harness_mem_record_event` | Record normalized event envelope (`platform` supports `claude`, `codex`, `opencode`, `cursor`, `antigravity`) |
| `harness_mem_health` | Check memory daemon health |
| `harness_mem_admin_reindex_vectors` | Rebuild vector index from observations |
| `harness_mem_admin_metrics` | Get memory coverage and queue metrics |
| `harness_mem_admin_consolidation_run` | Trigger consolidation worker immediately |
| `harness_mem_admin_consolidation_status` | Check consolidation queue/facts status |
| `harness_mem_admin_audit_log` | Inspect memory audit log |

## Example: Cross-Client Workflow

```
[Claude Code]                         [Codex]
     │                                   │
     ▼                                   │
harness_session_register               │
     │                                   │
     ▼                                   │
harness_workflow_plan                  │
  "Add user authentication"            │
     │                                   │
     ▼                                   ▼
harness_session_broadcast ─────► harness_session_inbox
  "Started auth implementation"    📨 "Started auth implementation"
     │                                   │
     ▼                                   ▼
harness_workflow_work            harness_workflow_work
  (implements login)               (implements logout)
     │                                   │
     └──────────────┬────────────────────┘
                    ▼
            harness_workflow_review
              (reviews all changes)
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck
```

## Architecture

```
mcp-server/
├── src/
│   ├── index.ts           # Server entry point
│   └── tools/
│       ├── session.ts     # Session communication tools
│       ├── workflow.ts    # Workflow tools
│       ├── status.ts      # Status tools
│       └── memory.ts      # Unified memory tools
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT - Same as Claude Code Harness
