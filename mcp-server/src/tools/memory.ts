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

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const execFileAsync = promisify(execFile);
const HEALTH_CACHE_MS = 5000;
let lastHealthyAt = 0;

function getBaseUrl(): string {
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

async function callMemoryApi(
  endpoint: string,
  payload: Record<string, unknown> | null,
  method: "GET" | "POST" = "POST"
): Promise<MemoryApiResponse> {
  const baseUrl = getBaseUrl();

  await ensureDaemon(baseUrl);

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: { "content-type": "application/json" },
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
    const message = parsed.error || `memory server returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return parsed;
}

function successResult(payload: MemoryApiResponse): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    isError: true,
  };
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
      "Get cross-platform resume context pack for a project/session.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        session_id: { type: "string" },
        limit: { type: "number" },
        include_private: { type: "boolean" },
      },
      required: ["project"],
    },
  },
  {
    name: "harness_mem_search",
    description: "Hybrid lexical + vector search on unified harness memory.",
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
      },
      required: ["query"],
    },
  },
  {
    name: "harness_mem_timeline",
    description: "Expand an observation into before/after timeline context.",
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
  },
  {
    name: "harness_mem_get_observations",
    description: "Get observation details by id list.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        include_private: { type: "boolean" },
        compact: { type: "boolean" },
      },
      required: ["ids"],
    },
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
  },
  {
    name: "harness_mem_finalize_session",
    description: "Finalize session and generate summary.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string" },
        project: { type: "string" },
        session_id: { type: "string" },
        summary_mode: {
          type: "string",
          enum: ["standard", "short", "detailed"],
        },
      },
      required: ["session_id"],
    },
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
          },
          required: ["platform", "project", "session_id", "event_type"],
        },
      },
      required: ["event"],
    },
  },
  {
    name: "harness_mem_health",
    description: "Get unified harness memory daemon health.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
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
  },
  {
    name: "harness_mem_admin_metrics",
    description: "Get memory metrics and vector/fts coverage.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export async function handleMemoryTool(
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

        const response = await callMemoryApi("/v1/resume-pack", {
          project,
          session_id: toStringOrUndefined(input.session_id),
          limit: toNumberOrUndefined(input.limit),
          include_private: toBoolean(input.include_private, false),
        });
        return successResult(response);
      }

      case "harness_mem_search": {
        const query = toStringOrUndefined(input.query);
        if (!query) {
          return errorResult("query is required");
        }

        const response = await callMemoryApi("/v1/search", {
          query,
          project: toStringOrUndefined(input.project),
          session_id: toStringOrUndefined(input.session_id),
          since: toStringOrUndefined(input.since),
          until: toStringOrUndefined(input.until),
          limit: toNumberOrUndefined(input.limit),
          include_private: toBoolean(input.include_private, false),
        });
        return successResult(response);
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
        const content = toStringOrUndefined(input.content);

        if (!sessionId || !title || !content) {
          return errorResult("session_id, title, content are required");
        }

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
          summary_mode: toStringOrUndefined(input.summary_mode),
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
