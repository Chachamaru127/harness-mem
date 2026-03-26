/**
 * Context Box MCP tools
 *
 * Bridges the Context Box API (business context DB on VPS) into the
 * Harness MCP server so that Claude Code sessions can query business
 * data (LINE messages, meeting notes, customer context, etc.) via
 * natural language.
 *
 * Environment variables:
 *   CONTEXT_BOX_URL        – Base URL of the Context Box API
 *                            (e.g. "https://claude-harness.com" or "http://localhost:3100")
 *   CONTEXT_BOX_API_TOKEN  – Bearer token for authentication (matches API_TOKEN on VPS)
 *   CONTEXT_BOX_WORKSPACE_ID – Default workspace ID (optional, can be overridden per-call)
 */

import { type Tool } from "@modelcontextprotocol/sdk/types.js";

// ─── Types ───

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface RecallResult {
  chunkId: string;
  documentId: string;
  text: string;
  score: number;
  provenance: {
    documentId: string;
    sourceType: string;
    originId: string | null;
    createdAt: string;
    chunkOffset?: { start: number; end: number };
  };
}

interface RecallResponse {
  results: RecallResult[];
  related: Array<{
    documentId: string;
    excerpt: string;
    score: number;
    provenance: Record<string, unknown>;
  }>;
}

interface SearchResponse {
  results: Array<{
    text: string;
    score: number;
    sourceType: string;
    documentId: string;
    createdAt: string;
  }>;
  query: string;
}

// ─── Configuration ───

const HEALTH_CACHE_MS = 10_000;
let lastHealthyAt = 0;

function getContextBoxUrl(): string {
  const url = (process.env.CONTEXT_BOX_URL || "").trim();
  if (!url) {
    throw new Error(
      "CONTEXT_BOX_URL is not set. Configure it in MCP server env " +
        '(e.g. CONTEXT_BOX_URL="https://claude-harness.com" or "http://localhost:3100")'
    );
  }
  return url.replace(/\/$/, "");
}

function getApiToken(): string | undefined {
  return (process.env.CONTEXT_BOX_API_TOKEN || "").trim() || undefined;
}

function getDefaultWorkspaceId(): string | undefined {
  return (process.env.CONTEXT_BOX_WORKSPACE_ID || "").trim() || undefined;
}

// ─── HTTP helpers ───

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = getApiToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function cbHealthCheck(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureContextBox(baseUrl: string): Promise<void> {
  if (Date.now() - lastHealthyAt < HEALTH_CACHE_MS) {
    return;
  }
  const healthy = await cbHealthCheck(baseUrl);
  if (healthy) {
    lastHealthyAt = Date.now();
    return;
  }
  throw new Error(
    `Context Box (${baseUrl}) is unreachable. ` +
      "Check that the VPS is running and CONTEXT_BOX_URL is correct."
  );
}

async function callContextBoxApi<T = unknown>(
  endpoint: string,
  payload: Record<string, unknown> | null,
  method: "GET" | "POST" = "POST"
): Promise<T> {
  const baseUrl = getContextBoxUrl();
  await ensureContextBox(baseUrl);

  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: buildHeaders(),
    body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Context Box API returned HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }

  return (await response.json()) as T;
}

// ─── Response helpers ───

function successResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// ─── Type helpers ───

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toBooleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

// ─── Tool definitions ───

export const contextBoxTools: Tool[] = [
  {
    name: "harness_cb_recall",
    description:
      "Search the Context Box (business context DB) using TEMPR hybrid retrieval. " +
      "Finds relevant context from LINE messages, meeting notes, customer data, emails, etc. " +
      "Supports 4 search strategies: hybrid (best), hybrid-lite, bm25, graph.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        strategy: {
          type: "string",
          enum: ["hybrid", "hybrid-lite", "bm25", "graph", "default"],
          description:
            "Search strategy. 'hybrid' uses all 4 TEMPR channels (best quality). Default: 'hybrid'",
        },
        limit: {
          type: "number",
          description: "Max results (1-50, default 10)",
        },
        workspace_id: {
          type: "string",
          description:
            "Workspace ID to scope the search (uses CONTEXT_BOX_WORKSPACE_ID env if omitted)",
        },
        source_type: {
          type: "string",
          enum: [
            "line",
            "slack",
            "chatwork",
            "kintone",
            "email",
            "file",
            "meeting",
            "plaud",
            "omi",
            "fieldy",
          ],
          description: "Filter by data source type",
        },
        group_id: {
          type: "string",
          description: "Filter by group ID (LINE group, Slack workspace, etc.)",
        },
        date_from: {
          type: "string",
          description: "Filter: earliest date (ISO 8601)",
        },
        date_to: {
          type: "string",
          description: "Filter: latest date (ISO 8601)",
        },
        customer: {
          type: "string",
          description: "Filter by customer name",
        },
        author: {
          type: "string",
          description: "Filter by author/speaker",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "harness_cb_search",
    description:
      "Simplified search for the Context Box (Web UI API). " +
      "Easier to use than cb_recall — just provide a query and workspace. " +
      "Returns text, score, sourceType, documentId, createdAt for each result.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        workspace_id: {
          type: "string",
          description:
            "Workspace ID (uses CONTEXT_BOX_WORKSPACE_ID env if omitted)",
        },
        strategy: {
          type: "string",
          enum: ["hybrid", "hybrid-lite", "bm25", "graph", "default"],
          description: "Search strategy (default: 'hybrid-lite')",
        },
        limit: {
          type: "number",
          description: "Max results (1-50, default 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "harness_cb_trace",
    description:
      "Retrieve the full raw text and source metadata for a specific document " +
      "from the Context Box. Use this after recall/search to get the complete original content.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Document ID (UUID) from recall/search results",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "harness_cb_status",
    description:
      "Check the health and connectivity of the Context Box API. " +
      "Returns server status, database availability, and feature flags.",
    inputSchema: {
      type: "object",
      properties: {
        detailed: {
          type: "boolean",
          description:
            "If true, use /health/detailed endpoint for full diagnostics",
        },
      },
      required: [],
    },
  },
];

// ─── Tool handlers ───

async function handleRecall(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const query = toStringOrUndefined(args.query);
  if (!query) {
    return errorResult("query is required");
  }

  const workspaceId =
    toStringOrUndefined(args.workspace_id) || getDefaultWorkspaceId();

  const filters: Record<string, unknown> = {};
  const groupId = toStringOrUndefined(args.group_id);
  if (groupId) filters.groupId = groupId;
  const sourceType = toStringOrUndefined(args.source_type);
  if (sourceType) filters.sourceType = sourceType;
  const dateFrom = toStringOrUndefined(args.date_from);
  if (dateFrom) filters.dateFrom = dateFrom;
  const dateTo = toStringOrUndefined(args.date_to);
  if (dateTo) filters.dateTo = dateTo;
  const customer = toStringOrUndefined(args.customer);
  if (customer) filters.customerId = customer;
  const author = toStringOrUndefined(args.author);
  if (author) filters.author = author;

  const payload: Record<string, unknown> = {
    query,
    strategy: toStringOrUndefined(args.strategy) || "hybrid",
    limit: toNumberOrUndefined(args.limit) || 10,
  };

  if (workspaceId) {
    payload.workspaceId = workspaceId;
  }

  if (Object.keys(filters).length > 0) {
    payload.filters = filters;
  }

  const response = await callContextBoxApi<RecallResponse>(
    "/context-bank/recall",
    payload
  );

  // Format for readability
  const summary = {
    query,
    strategy: payload.strategy,
    result_count: response.results?.length ?? 0,
    related_count: response.related?.length ?? 0,
    results: (response.results || []).map((r: RecallResult, i: number) => ({
      rank: i + 1,
      score: r.score,
      source_type: r.provenance?.sourceType,
      created_at: r.provenance?.createdAt,
      document_id: r.documentId,
      text: r.text,
    })),
    related: (response.related || []).map((r) => ({
      document_id: r.documentId,
      excerpt: r.excerpt,
      score: r.score,
    })),
  };

  return successResult(summary);
}

async function handleSearch(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const query = toStringOrUndefined(args.query);
  if (!query) {
    return errorResult("query is required");
  }

  const workspaceId =
    toStringOrUndefined(args.workspace_id) || getDefaultWorkspaceId();
  if (!workspaceId) {
    return errorResult(
      "workspace_id is required (set CONTEXT_BOX_WORKSPACE_ID env or pass workspace_id parameter)"
    );
  }

  const payload: Record<string, unknown> = {
    query,
    workspaceId,
    strategy: toStringOrUndefined(args.strategy) || "hybrid-lite",
    limit: toNumberOrUndefined(args.limit) || 10,
  };

  const response = await callContextBoxApi<SearchResponse>(
    "/api/search",
    payload
  );

  return successResult({
    query: response.query,
    result_count: response.results?.length ?? 0,
    results: response.results || [],
  });
}

async function handleTrace(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const documentId = toStringOrUndefined(args.document_id);
  if (!documentId) {
    return errorResult("document_id is required");
  }

  const response = await callContextBoxApi<{
    raw_text: string;
    source: {
      type: string;
      originId: string | null;
      groupId: string | null;
      ingestedAt: string;
    };
  }>("/context-bank/trace", { documentId });

  return successResult(response);
}

async function handleStatus(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const detailed = toBooleanOrUndefined(args.detailed);
  const baseUrl = getContextBoxUrl();

  const endpoint = detailed ? "/health/detailed" : "/health";

  try {
    const response = await callContextBoxApi<Record<string, unknown>>(
      endpoint,
      null,
      "GET"
    );
    return successResult({
      status: "connected",
      url: baseUrl,
      ...response,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return successResult({
      status: "unreachable",
      url: baseUrl,
      error: message,
      hint: "Check CONTEXT_BOX_URL and ensure the VPS is running",
    });
  }
}

// ─── Router ───

export async function handleContextBoxTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const input = args ?? {};

  try {
    switch (name) {
      case "harness_cb_recall":
        return await handleRecall(input);
      case "harness_cb_search":
        return await handleSearch(input);
      case "harness_cb_trace":
        return await handleTrace(input);
      case "harness_cb_status":
        return await handleStatus(input);
      default:
        return errorResult(`Unknown context-box tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Context Box error: ${message}`);
  }
}
