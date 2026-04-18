/**
 * Unified Harness Memory tools
 *
 * Proxies MCP requests to harness-memd (Bun daemon) over localhost HTTP.
 */

import { type Tool } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getProjectRoot } from "../utils.js";
import { applyPiiFilter, getActivePiiRules } from "../pii/pii-filter.js";
import { createJsonToolResult, type ToolResult } from "../tool-result.js";
import { applyDetailLevel, type SearchDetailLevel } from "../search-detail-level.js";

interface MemoryApiResponse {
  ok: boolean;
  source: "core" | "merged";
  items: unknown[];
  meta: {
    count: number;
    latency_ms: number;
    filters: Record<string, unknown>;
    ranking: string;
    [key: string]: unknown;
  };
  error?: string;
}

const execFileAsync = promisify(execFile);
const HEALTH_CACHE_MS = 5000;
let lastHealthyAt = 0;

export function isRemoteMode(): boolean {
  return !!(process.env.HARNESS_MEM_REMOTE_URL || "").trim();
}

export function getBaseUrl(): string {
  const remoteUrl = (process.env.HARNESS_MEM_REMOTE_URL || "").trim();
  if (remoteUrl) {
    return remoteUrl.replace(/\/$/, "");
  }
  const host = process.env.HARNESS_MEM_HOST || "127.0.0.1";
  const port = process.env.HARNESS_MEM_PORT || "37888";
  return `http://${host}:${port}`;
}

async function tryHealthCheck(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isWithinPath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateImportSourcePath(sourceDbPath: string): { ok: true; resolvedPath: string } | { ok: false; reason: string } {
  const trimmed = sourceDbPath.trim();
  if (!trimmed) {
    return { ok: false, reason: "source_db_path is required" };
  }

  if (trimmed.includes("\0")) {
    return { ok: false, reason: "source_db_path contains invalid characters" };
  }

  const resolvedPath = path.resolve(trimmed);
  const ext = path.extname(resolvedPath).toLowerCase();
  if (![".db", ".sqlite", ".sqlite3"].includes(ext)) {
    return { ok: false, reason: "source_db_path must use .db/.sqlite/.sqlite3 extension" };
  }

  const homeDir = process.env.HOME ? path.resolve(process.env.HOME) : "";
  const projectRoot = path.resolve(getProjectRoot());
  const allowed = (homeDir && isWithinPath(homeDir, resolvedPath)) || isWithinPath(projectRoot, resolvedPath);
  if (!allowed) {
    return { ok: false, reason: "source_db_path must be under HOME or project root" };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, reason: `source_db_path not found: ${resolvedPath}` };
  }

  return { ok: true, resolvedPath };
}

async function tryStartDaemon(): Promise<void> {
  const projectRoot = getProjectRoot();
  const scriptPath = path.join(projectRoot, "scripts", "harness-memd");
  if (!fs.existsSync(scriptPath)) {
    return;
  }

  try {
    const resolvedProjectRoot = fs.realpathSync(projectRoot);
    const resolvedScriptPath = fs.realpathSync(scriptPath);
    if (!isWithinPath(resolvedProjectRoot, resolvedScriptPath)) {
      return;
    }
    await execFileAsync(resolvedScriptPath, ["start", "--quiet"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HARNESS_MEM_CODEX_PROJECT_ROOT:
          process.env.HARNESS_MEM_CODEX_PROJECT_ROOT || projectRoot,
      },
    });
  } catch {
    // best effort start only
  }
}

async function ensureDaemon(baseUrl: string): Promise<void> {
  if (Date.now() - lastHealthyAt < HEALTH_CACHE_MS) {
    return;
  }

  // リモートモードではローカルデーモン起動をスキップし、リモートの /v1/health を確認する
  if (isRemoteMode()) {
    const healthy = await tryHealthCheck(baseUrl);
    if (healthy) {
      lastHealthyAt = Date.now();
      return;
    }
    throw new Error(`リモート memory server (${baseUrl}) へのヘルスチェックに失敗しました。VPS が起動しているか確認してください。`);
  }

  const healthy = await tryHealthCheck(baseUrl);
  if (healthy) {
    lastHealthyAt = Date.now();
    return;
  }

  await tryStartDaemon();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const started = await tryHealthCheck(baseUrl);
    if (started) {
      lastHealthyAt = Date.now();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("harness-memd health check failed after 10 retries");
}

export function buildApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  // リモートモードでは HARNESS_MEM_REMOTE_TOKEN を優先使用
  const remoteToken = isRemoteMode()
    ? (process.env.HARNESS_MEM_REMOTE_TOKEN || "").trim()
    : "";
  const localToken = (process.env.HARNESS_MEM_ADMIN_TOKEN || "").trim();
  const token = remoteToken || localToken;
  if (token) {
    headers["x-harness-mem-token"] = token;
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function callMemoryApi(
  endpoint: string,
  payload: Record<string, unknown> | null,
  method: "GET" | "POST" | "DELETE" = "POST"
): Promise<MemoryApiResponse> {
  const baseUrl = getBaseUrl();

  await ensureDaemon(baseUrl);

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: buildApiHeaders(),
    body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
  });

  const clone = response.clone();
  let parsed: MemoryApiResponse | null = null;
  try {
    parsed = (await response.json()) as MemoryApiResponse;
  } catch {
    const text = await clone.text();
    throw new Error(`Unexpected response from memory server: ${text.slice(0, 200)}`);
  }

  if (!parsed || !response.ok || parsed.ok === false) {
    const message = parsed?.error || `memory server returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return parsed;
}

function successResult(payload: MemoryApiResponse, options?: { citations?: boolean }): ToolResult {
  const citations =
    options?.citations && payload.items?.length
      ? (payload.items as Array<Record<string, unknown>>).map((item) => ({
          id: item.id ?? null,
          source: item.platform ?? item.source ?? "harness-mem",
          session_id: item.session_id ?? null,
          timestamp: item.created_at ?? item.timestamp ?? null,
          type: item.type ?? item.event_type ?? "observation",
        }))
      : undefined;

  return createJsonToolResult(payload, { citations });
}

function errorResult(message: string): ToolResult {
  return createJsonToolResult(
    {
      ok: false,
      error: message,
    },
    {
      isError: true,
      text: message,
    }
  );
}

function toObject(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") {
    return {};
  }
  return args as Record<string, unknown>;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export const memoryTools: Tool[] = [
  {
    name: "harness_mem_resume_pack",
    description:
      "Get cross-platform resume context pack for a project/session. Supports correlation_id to fetch context across all related sessions. Use detail_level='L0' for minimal token usage (~170 tokens), 'L1' (default) for recent context (~500-1000 tokens), or 'full' for complete backward-compat output.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        session_id: { type: "string" },
        correlation_id: { type: "string" },
        limit: { type: "number" },
        include_private: { type: "boolean" },
        detail_level: {
          type: "string",
          enum: ["L0", "L1", "full"],
          description: "§78-B03: Wake-up context detail level. L0=critical facts only (~170 tokens), L1=L0+recent context (default), full=backward-compat complete output.",
        },
      },
      required: ["project"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_search",
    description:
      "Step 1 of 3-layer workflow (search -> timeline -> get_observations). Returns candidate IDs with meta.token_estimate.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string" },
        session_id: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "number" },
        include_private: { type: "boolean" },
        sort_by: { type: "string", enum: ["relevance", "date_desc", "date_asc"], description: "Sort order: relevance (default), date_desc (newest first), date_asc (oldest first)" },
        scope: {
          type: "object",
          description: "Hierarchical metadata scope (S78-B02). Narrows search progressively: project > session > thread > topic. When provided, scope fields override the top-level project/session_id.",
          properties: {
            project: { type: "string" },
            session_id: { type: "string" },
            thread_id: { type: "string" },
            topic: { type: "string" },
          },
        },
        include_expired: { type: "boolean", description: "S78-D01: When true, include expired observations (TTL past). Default false. Use for admin/audit access." },
        branch: { type: "string", description: "S78-E02: Filter by git branch. When provided, returns observations with matching branch OR branch=null (legacy rows). Omit to return all observations regardless of branch (backward compatible)." },
        graph_depth: { type: "number", description: "S78-C03: Multi-hop reasoning depth. 0 (default) = disabled (backward compatible). 1-3 = traverse entity graph via mem_relations to surface observations reachable within N hops. Useful for temporal queries where the answer is entity-linked but not lexically similar." },
        detail_level: {
          type: "string",
          enum: ["index", "context", "full"],
          description: "§78-E03: Progressive disclosure level. index=id+title+score only (lightest). context=+snippet(120 chars)+meta (default, preserves existing behavior). full=+complete content+raw_text+score breakdown. meta.token_estimate shows approximate token cost.",
        },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_timeline",
    description:
      "Step 2 of 3-layer workflow. Expands one observation into before/after context with meta.token_estimate.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        before: { type: "number" },
        after: { type: "number" },
        include_private: { type: "boolean" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_get_observations",
    description:
      "Step 3 of 3-layer workflow. Fetch full details only for filtered IDs. Returns meta.token_estimate and warnings for large batches.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        include_private: { type: "boolean" },
        compact: { type: "boolean" },
      },
      required: ["ids"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_sessions_list",
    description: "List sessions with summary/count metadata for a project.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        limit: { type: "number" },
        include_private: { type: "boolean" },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_session_thread",
    description: "Get ordered thread events for a session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        project: { type: "string" },
        limit: { type: "number" },
        include_private: { type: "boolean" },
      },
      required: ["session_id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_search_facets",
    description: "Get project/type/tag/time facets for a query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string" },
        include_private: { type: "boolean" },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_record_checkpoint",
    description: "Record a checkpoint observation for a session.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string" },
        project: { type: "string" },
        session_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        privacy_tags: { type: "array", items: { type: "string" } },
      },
      required: ["session_id", "title", "content"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "harness_mem_finalize_session",
    description: "Finalize session and generate summary. When the session has 5+ steps and ends with a completion signal, a skill_suggestion is returned. Pass persist_skill: true to also save it as a reusable procedural skill observation.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string" },
        project: { type: "string" },
        session_id: { type: "string" },
        correlation_id: { type: "string" },
        summary_mode: {
          type: "string",
          enum: ["standard", "short", "detailed"],
        },
        persist_skill: {
          type: "boolean",
          description: "If true, persist detected skill as an observation with tags [skill, procedural]. Defaults to false.",
        },
      },
      required: ["session_id"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "harness_mem_record_event",
    description: "Record normalized event envelope (adapter-internal use).",
    inputSchema: {
      type: "object",
      properties: {
        event: {
          type: "object",
          properties: {
            event_id: { type: "string" },
            platform: { type: "string" },
            project: { type: "string" },
            session_id: { type: "string" },
            event_type: { type: "string" },
            ts: { type: "string" },
            payload: { type: "object" },
            tags: { type: "array", items: { type: "string" } },
            privacy_tags: { type: "array", items: { type: "string" } },
            dedupe_hash: { type: "string" },
            correlation_id: { type: "string" },
          },
          required: ["platform", "project", "session_id", "event_type"],
        },
      },
      required: ["event"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "harness_mem_health",
    description: "Get unified harness memory daemon health.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_delete_observation",
    description: "Soft-delete (archive) a specific observation by ID. The observation is marked as deleted and excluded from search results.",
    inputSchema: {
      type: "object",
      properties: {
        observation_id: {
          type: "string",
          description: "The ID of the observation to delete",
        },
      },
      required: ["observation_id"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "harness_mem_admin_import_claude_mem",
    description: "Run one-shot import from Claude-mem SQLite.",
    inputSchema: {
      type: "object",
      properties: {
        source_db_path: { type: "string" },
        project: { type: "string" },
        dry_run: { type: "boolean" },
      },
      required: ["source_db_path"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "harness_mem_admin_import_status",
    description: "Get status/result for an import job.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
      },
      required: ["job_id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_admin_verify_import",
    description: "Verify import job integrity/privacy checks.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
      },
      required: ["job_id"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "harness_mem_admin_reindex_vectors",
    description: "Rebuild vector index from stored observations.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
      required: [],
    },
    annotations: { idempotentHint: true, readOnlyHint: false },
  },
  {
    name: "harness_mem_admin_metrics",
    description: "Get memory metrics and vector/fts coverage.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_admin_consolidation_run",
    description: "Run consolidation worker (extract + dedupe) immediately.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        project: { type: "string" },
        session_id: { type: "string" },
        limit: { type: "number" },
      },
      required: [],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "harness_mem_admin_consolidation_status",
    description: "Get consolidation queue/facts status.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_admin_audit_log",
    description: "Get audit log entries for retrieval/admin actions.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        action: { type: "string" },
        target_type: { type: "string" },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_add_relation",
    description: "Add a directed relation (link) between two observations.",
    inputSchema: {
      type: "object",
      properties: {
        from_observation_id: { type: "string", description: "Source observation ID" },
        to_observation_id: { type: "string", description: "Target observation ID" },
        // S78-D02: "supersedes" added — (A, B, 'supersedes') = "A supersedes B" (B is made stale)
        relation: { type: "string", enum: ["updates", "extends", "derives", "follows", "shared_entity", "contradicts", "causes", "part_of", "supersedes"], description: "Relation type" },
        weight: { type: "number", description: "Link weight (default: 1.0)" },
      },
      required: ["from_observation_id", "to_observation_id", "relation"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "harness_mem_bulk_add",
    description: "Record multiple observations in a single batch operation.",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform: { type: "string" },
              project: { type: "string" },
              session_id: { type: "string" },
              event_type: { type: "string" },
              title: { type: "string" },
              content: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["platform", "project", "session_id", "event_type"],
          },
          description: "Array of events to record",
        },
      },
      required: ["events"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "harness_mem_bulk_delete",
    description: "Soft-delete multiple observations by ID in a single batch operation.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Array of observation IDs to delete" },
      },
      required: ["ids"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "harness_mem_export",
    description: "Export observations as JSON for backup or analysis.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Filter by project (optional)" },
        limit: { type: "number", description: "Maximum number of observations to export (default: 1000)" },
        include_private: { type: "boolean", description: "Include deleted/private observations" },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_compress",
    description: "Run consolidation (compress/dedupe) worker immediately to extract facts and reduce redundancy.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        project: { type: "string" },
        session_id: { type: "string" },
        limit: { type: "number" },
      },
      required: [],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "harness_mem_stats",
    description: "Get per-project memory statistics including observation counts and session summaries.",
    inputSchema: {
      type: "object",
      properties: {
        include_private: { type: "boolean" },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_ingest",
    description: "Ingest a document (knowledge file, ADR, decisions.md) into memory.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path identifier for the document" },
        content: { type: "string", description: "Text content of the document" },
        kind: { type: "string", enum: ["decisions_md", "adr"], description: "Document kind (auto-detected if omitted)" },
        project: { type: "string" },
        platform: { type: "string" },
        session_id: { type: "string" },
        expires_at: { type: "string", description: "S78-D01: TTL for this observation as ISO-8601 string or Unix seconds. Null/omitted = no expiration. Past values accepted (observation stored as already-expired)." },
        branch: { type: "string", description: "S78-E02: Git branch to scope this observation to. When set, observation is tagged with this branch name. Omit for no branch scope (visible from all branches)." },
      },
      required: ["file_path", "content"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "harness_mem_graph",
    description: "Explore graph neighbors of an observation (linked observations by relation). Supports BFS traversal up to depth 5.",
    inputSchema: {
      type: "object",
      properties: {
        observation_id: { type: "string", description: "Source observation ID to explore neighbors from" },
        relation: { type: "string", enum: ["updates", "extends", "derives", "follows", "shared_entity", "contradicts", "causes", "part_of"], description: "Filter by relation type" },
        depth: { type: "integer", minimum: 1, maximum: 5, default: 1, description: "BFS traversal depth (1-5, default 1)" },
      },
      required: ["observation_id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "harness_mem_share_to_team",
    description: "Share a personal memory observation with your team. Sets team_id on the observation so team members can access it.",
    inputSchema: {
      type: "object",
      properties: {
        observation_id: { type: "string", description: "ID of the observation to share" },
        team_id: { type: "string", description: "Team ID to share with" },
      },
      required: ["observation_id", "team_id"],
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
];

/**
 * Detect the calling platform from environment.
 * OpenCode sets HARNESS_MEM_MCP_PLATFORM=opencode when launching this MCP server.
 */
function getMcpPlatform(): string | undefined {
  return (process.env.HARNESS_MEM_MCP_PLATFORM || "").trim() || undefined;
}

/**
 * Fire-and-forget tool_use event recording for platforms where
 * tool.execute hooks do not fire for MCP tool calls (OpenCode #2319).
 */
function recordToolUseEvent(
  toolName: string,
  phase: "before" | "after",
  platform: string,
  extra?: Record<string, unknown>
): void {
  const baseUrl = getBaseUrl();
  try {
    fetch(`${baseUrl}/v1/events/record`, {
      method: "POST",
      headers: buildApiHeaders(),
      body: JSON.stringify({
        event: {
          platform,
          project: process.env.HARNESS_MEM_OPENCODE_PROJECT_ROOT || process.cwd(),
          session_id: `mcp-${platform}-${process.pid}`,
          event_type: "tool_use",
          ts: new Date().toISOString(),
          payload: {
            tool_name: toolName,
            phase,
            source: "mcp_server_hook_supplement",
            ...extra,
          },
          tags: [`${platform}_mcp_tool_use`, `tool.execute.${phase}`],
        },
      }),
    }).catch(() => {});
  } catch {
    // non-blocking: best-effort recording
  }
}

/** Tools that should NOT trigger self-tracking to avoid recursion or noise. */
const SELF_TRACK_SKIP = new Set([
  "harness_mem_health",
  "harness_mem_record_event",
  "harness_mem_record_checkpoint",
  "harness_mem_finalize_session",
  "harness_mem_bulk_add",
]);

/**
 * Wrapper that records tool_use events for platforms where
 * tool.execute hooks do not fire for MCP tool calls (OpenCode #2319).
 */
export async function handleMemoryTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const platform = getMcpPlatform();
  const shouldTrack = !!platform && !SELF_TRACK_SKIP.has(name);
  const startMs = Date.now();

  if (shouldTrack) {
    recordToolUseEvent(name, "before", platform!);
  }

  const result = await handleMemoryToolInner(name, args);

  if (shouldTrack) {
    const durationMs = Date.now() - startMs;
    recordToolUseEvent(name, "after", platform!, {
      success: !result.isError,
      duration_ms: durationMs,
    });
  }

  return result;
}

async function runConsolidation(input: Record<string, unknown>): Promise<ToolResult> {
  const response = await callMemoryApi("/v1/admin/consolidation/run", {
    reason: toStringOrUndefined(input.reason),
    project: toStringOrUndefined(input.project),
    session_id: toStringOrUndefined(input.session_id),
    limit: toNumberOrUndefined(input.limit),
  });
  return successResult(response);
}

async function handleMemoryToolInner(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const input = toObject(args);

  try {
    switch (name) {
      case "harness_mem_resume_pack": {
        const project = toStringOrUndefined(input.project);
        if (!project) {
          return errorResult("project is required");
        }

        const rawDetailLevel = toStringOrUndefined(input.detail_level);
        const validDetailLevels = ["L0", "L1", "full"];
        const detailLevel = rawDetailLevel && validDetailLevels.includes(rawDetailLevel)
          ? (rawDetailLevel as "L0" | "L1" | "full")
          : undefined;
        const response = await callMemoryApi("/v1/resume-pack", {
          project,
          session_id: toStringOrUndefined(input.session_id),
          correlation_id: toStringOrUndefined(input.correlation_id),
          limit: toNumberOrUndefined(input.limit),
          include_private: toBoolean(input.include_private, false),
          ...(detailLevel !== undefined ? { detail_level: detailLevel } : {}),
        });
        return successResult(response);
      }

      case "harness_mem_search": {
        const query = toStringOrUndefined(input.query);
        if (!query) {
          return errorResult("query is required");
        }

        const sortBy = toStringOrUndefined(input.sort_by);
        const validSortValues = ["relevance", "date_desc", "date_asc"];
        // S78-B02: scope パラメータの処理
        const rawScope = input.scope;
        const scope = rawScope && typeof rawScope === "object" && !Array.isArray(rawScope)
          ? {
              project: toStringOrUndefined((rawScope as Record<string, unknown>).project),
              session_id: toStringOrUndefined((rawScope as Record<string, unknown>).session_id),
              thread_id: toStringOrUndefined((rawScope as Record<string, unknown>).thread_id),
              topic: toStringOrUndefined((rawScope as Record<string, unknown>).topic),
            }
          : undefined;
        // §78-E03: detail_level — consumed by MCP layer, not forwarded to API
        const rawDetailLevel = toStringOrUndefined(input.detail_level);
        const validDetailLevels = ["index", "context", "full"];
        const detailLevel: SearchDetailLevel =
          rawDetailLevel && validDetailLevels.includes(rawDetailLevel)
            ? (rawDetailLevel as SearchDetailLevel)
            : "context";

        const response = await callMemoryApi("/v1/search", {
          query,
          project: toStringOrUndefined(input.project),
          session_id: toStringOrUndefined(input.session_id),
          since: toStringOrUndefined(input.since),
          until: toStringOrUndefined(input.until),
          limit: toNumberOrUndefined(input.limit),
          include_private: toBoolean(input.include_private, false),
          sort_by: sortBy && validSortValues.includes(sortBy) ? sortBy : undefined,
          scope,
          // S78-D01: 期限切れ観察を含むか
          include_expired: toBoolean(input.include_expired, false),
          // S78-E02: Branch-scoped memory フィルタ
          branch: toStringOrUndefined(input.branch),
          // S78-C03: Multi-hop reasoning depth (0 = disabled, backward compatible)
          graph_depth: toNumberOrUndefined(input.graph_depth),
        });

        // §78-E03: apply progressive disclosure + inject token_estimate into meta
        const { items: disclosedItems, meta: disclosedMeta } = applyDetailLevel(
          Array.isArray(response.items) ? response.items : [],
          response.meta as Record<string, unknown>,
          detailLevel
        );
        const disclosedResponse = { ...response, items: disclosedItems, meta: disclosedMeta };

        const result = successResult(disclosedResponse as MemoryApiResponse, { citations: true });
        // Proactively notify via channels when search returns results (lazy import to avoid circular dep)
        const disclosedCount = typeof disclosedMeta?.count === "number" ? disclosedMeta.count : 0;
        if (disclosedCount > 0) {
          import("../index.js").then(m => m.pushMemoryNotification(`Memory search: ${disclosedCount} results for "${query}"`)).catch(() => {});
        }
        return result;
      }

      case "harness_mem_sessions_list": {
        const query = new URLSearchParams();
        const project = toStringOrUndefined(input.project);
        if (project) query.set("project", project);
        const limit = toNumberOrUndefined(input.limit);
        if (typeof limit === "number") query.set("limit", String(limit));
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");

        const response = await callMemoryApi(`/v1/sessions/list?${query.toString()}`, null, "GET");
        return successResult(response);
      }

      case "harness_mem_session_thread": {
        const sessionId = toStringOrUndefined(input.session_id);
        if (!sessionId) {
          return errorResult("session_id is required");
        }
        const query = new URLSearchParams();
        query.set("session_id", sessionId);
        const project = toStringOrUndefined(input.project);
        if (project) query.set("project", project);
        const limit = toNumberOrUndefined(input.limit);
        if (typeof limit === "number") query.set("limit", String(limit));
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");

        const response = await callMemoryApi(`/v1/sessions/thread?${query.toString()}`, null, "GET");
        return successResult(response);
      }

      case "harness_mem_search_facets": {
        const query = new URLSearchParams();
        const rawQuery = toStringOrUndefined(input.query);
        if (rawQuery) query.set("query", rawQuery);
        const project = toStringOrUndefined(input.project);
        if (project) query.set("project", project);
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");

        const response = await callMemoryApi(`/v1/search/facets?${query.toString()}`, null, "GET");
        return successResult(response);
      }

      case "harness_mem_timeline": {
        const id = toStringOrUndefined(input.id);
        if (!id) {
          return errorResult("id is required");
        }

        const response = await callMemoryApi("/v1/timeline", {
          id,
          before: toNumberOrUndefined(input.before),
          after: toNumberOrUndefined(input.after),
          include_private: toBoolean(input.include_private, false),
        });
        return successResult(response);
      }

      case "harness_mem_get_observations": {
        const ids = toStringArray(input.ids);
        if (ids.length === 0) {
          return errorResult("ids is required");
        }

        const response = await callMemoryApi("/v1/observations/get", {
          ids,
          include_private: toBoolean(input.include_private, false),
          compact: toBoolean(input.compact, true),
        });
        return successResult(response);
      }

      case "harness_mem_record_checkpoint": {
        const sessionId = toStringOrUndefined(input.session_id);
        const title = toStringOrUndefined(input.title);
        const rawContent = toStringOrUndefined(input.content);

        if (!sessionId || !title || !rawContent) {
          return errorResult("session_id, title, content are required");
        }

        // PII フィルタ適用（HARNESS_MEM_PII_FILTER=true の場合のみ有効）
        const piiRules = getActivePiiRules();
        const content = piiRules ? applyPiiFilter(rawContent, piiRules) : rawContent;

        const response = await callMemoryApi("/v1/checkpoints/record", {
          platform: toStringOrUndefined(input.platform),
          project: toStringOrUndefined(input.project),
          session_id: sessionId,
          title,
          content,
          tags: toStringArray(input.tags),
          privacy_tags: toStringArray(input.privacy_tags),
        });
        return successResult(response);
      }

      case "harness_mem_finalize_session": {
        const sessionId = toStringOrUndefined(input.session_id);
        if (!sessionId) {
          return errorResult("session_id is required");
        }

        const response = await callMemoryApi("/v1/sessions/finalize", {
          platform: toStringOrUndefined(input.platform),
          project: toStringOrUndefined(input.project),
          session_id: sessionId,
          correlation_id: toStringOrUndefined(input.correlation_id),
          summary_mode: toStringOrUndefined(input.summary_mode),
          persist_skill: input.persist_skill === true,
        });
        return successResult(response);
      }

      case "harness_mem_record_event": {
        const event = toObject(input.event);
        if (Object.keys(event).length === 0) {
          return errorResult("event is required");
        }

        const response = await callMemoryApi("/v1/events/record", {
          event,
        });
        return successResult(response);
      }

      case "harness_mem_health": {
        const response = await callMemoryApi("/health", null, "GET");
        return successResult(response);
      }

      case "harness_mem_delete_observation": {
        const observationId = toStringOrUndefined(input.observation_id);
        if (!observationId) {
          return errorResult("observation_id is required");
        }
        const response = await callMemoryApi(`/v1/observations/${encodeURIComponent(observationId)}`, null, "DELETE");
        return successResult(response);
      }

      case "harness_mem_admin_reindex_vectors": {
        const response = await callMemoryApi("/v1/admin/reindex-vectors", {
          limit: toNumberOrUndefined(input.limit),
        });
        return successResult(response);
      }

      case "harness_mem_admin_import_claude_mem": {
        const sourceDbPath = toStringOrUndefined(input.source_db_path);
        if (!sourceDbPath) {
          return errorResult("source_db_path is required");
        }
        const validated = validateImportSourcePath(sourceDbPath);
        if (!validated.ok) {
          return errorResult(validated.reason);
        }
        const response = await callMemoryApi("/v1/admin/imports/claude-mem", {
          source_db_path: validated.resolvedPath,
          project: toStringOrUndefined(input.project),
          dry_run: toBoolean(input.dry_run, false),
        });
        return successResult(response);
      }

      case "harness_mem_admin_import_status": {
        const jobId = toStringOrUndefined(input.job_id);
        if (!jobId) {
          return errorResult("job_id is required");
        }
        const response = await callMemoryApi(`/v1/admin/imports/${encodeURIComponent(jobId)}`, null, "GET");
        return successResult(response);
      }

      case "harness_mem_admin_verify_import": {
        const jobId = toStringOrUndefined(input.job_id);
        if (!jobId) {
          return errorResult("job_id is required");
        }
        const response = await callMemoryApi(`/v1/admin/imports/${encodeURIComponent(jobId)}/verify`, {});
        return successResult(response);
      }

      case "harness_mem_admin_metrics": {
        const response = await callMemoryApi("/v1/admin/metrics", null, "GET");
        return successResult(response);
      }

      case "harness_mem_admin_consolidation_run": {
        return runConsolidation(input);
      }

      case "harness_mem_admin_consolidation_status": {
        const response = await callMemoryApi("/v1/admin/consolidation/status", null, "GET");
        return successResult(response);
      }

      case "harness_mem_admin_audit_log": {
        const query = new URLSearchParams();
        const limit = toNumberOrUndefined(input.limit);
        if (typeof limit === "number") query.set("limit", String(limit));
        const action = toStringOrUndefined(input.action);
        if (action) query.set("action", action);
        const targetType = toStringOrUndefined(input.target_type);
        if (targetType) query.set("target_type", targetType);
        const response = await callMemoryApi(`/v1/admin/audit-log?${query.toString()}`, null, "GET");
        return successResult(response);
      }

      case "harness_mem_add_relation": {
        const fromId = toStringOrUndefined(input.from_observation_id);
        const toId = toStringOrUndefined(input.to_observation_id);
        const relation = toStringOrUndefined(input.relation);
        if (!fromId || !toId || !relation) {
          return errorResult("from_observation_id, to_observation_id, relation are required");
        }
        const response = await callMemoryApi("/v1/links/create", {
          from_observation_id: fromId,
          to_observation_id: toId,
          relation,
          weight: toNumberOrUndefined(input.weight),
        });
        return successResult(response);
      }

      case "harness_mem_bulk_add": {
        const events = Array.isArray(input.events) ? (input.events as Record<string, unknown>[]) : [];
        if (events.length === 0) {
          return errorResult("events is required and must not be empty");
        }
        const results = await Promise.all(
          events.map((event) => callMemoryApi("/v1/events/record", { event }))
        );
        const combinedResponse = {
          ok: true,
          source: "core" as const,
          items: results,
          meta: { count: results.length, latency_ms: 0, filters: {}, ranking: "bulk_add_v1" },
        };
        return successResult(combinedResponse);
      }

      case "harness_mem_bulk_delete": {
        const ids = toStringArray(input.ids);
        if (ids.length === 0) {
          return errorResult("ids is required and must not be empty");
        }
        const response = await callMemoryApi("/v1/observations/bulk-delete", { ids });
        return successResult(response);
      }

      case "harness_mem_export": {
        const query = new URLSearchParams();
        const project = toStringOrUndefined(input.project);
        if (project) query.set("project", project);
        const limit = toNumberOrUndefined(input.limit);
        if (typeof limit === "number") query.set("limit", String(limit));
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");
        const response = await callMemoryApi(`/v1/export?${query.toString()}`, null, "GET");
        return successResult(response);
      }

      case "harness_mem_compress": {
        return runConsolidation(input);
      }

      case "harness_mem_stats": {
        const query = new URLSearchParams();
        query.set("include_private", toBoolean(input.include_private, false) ? "true" : "false");
        const response = await callMemoryApi(`/v1/projects/stats?${query.toString()}`, null, "GET");
        return successResult(response);
      }

      case "harness_mem_ingest": {
        const filePath = toStringOrUndefined(input.file_path);
        const content = toStringOrUndefined(input.content);
        if (!filePath || !content) {
          return errorResult("file_path and content are required");
        }
        const expiresAt = toStringOrUndefined(input.expires_at);
        const branch = toStringOrUndefined(input.branch);
        const response = await callMemoryApi("/v1/ingest/document", {
          file_path: filePath,
          content,
          kind: toStringOrUndefined(input.kind),
          project: toStringOrUndefined(input.project),
          platform: toStringOrUndefined(input.platform),
          session_id: toStringOrUndefined(input.session_id),
          // S78-D01: TTL パススルー
          ...(expiresAt !== undefined && { expires_at: expiresAt }),
          // S78-E02: Branch パススルー
          ...(branch !== undefined && { branch }),
        });
        return successResult(response);
      }

      case "harness_mem_graph": {
        const observationId = toStringOrUndefined(input.observation_id);
        if (!observationId) {
          return errorResult("observation_id is required");
        }
        const query = new URLSearchParams();
        query.set("observation_id", observationId);
        const relation = toStringOrUndefined(input.relation);
        if (relation) query.set("relation", relation);
        const depth = toNumberOrUndefined(input.depth);
        if (depth !== undefined) query.set("depth", String(Math.min(Math.max(depth, 1), 5)));
        const response = await callMemoryApi(`/v1/graph/neighbors?${query.toString()}`, null, "GET");
        return successResult(response);
      }

      case "harness_mem_share_to_team": {
        const observationId = toStringOrUndefined(input.observation_id);
        const teamId = toStringOrUndefined(input.team_id);
        if (!observationId) {
          return errorResult("observation_id is required");
        }
        if (!teamId) {
          return errorResult("team_id is required");
        }
        const response = await callMemoryApi("/v1/observations/share", {
          observation_id: observationId,
          team_id: teamId,
        });
        return successResult(response);
      }

      default:
        return errorResult(`Unknown memory tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = /ECONNREFUSED|health check failed|failed/i.test(message)
      ? "daemon_unavailable"
      : /timeout|timed out/i.test(message)
        ? "timeout"
        : "request_failed";
    return errorResult(`Memory tool failed [${kind}]: ${message}`);
  }
}
