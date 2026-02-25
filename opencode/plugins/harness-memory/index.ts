type HookPayload = Record<string, unknown>;

const HOST = process.env.HARNESS_MEM_HOST || "127.0.0.1";
const PORT = process.env.HARNESS_MEM_PORT || "37888";
const BASE_URL = `http://${HOST}:${PORT}`;
const ENABLED = (process.env.HARNESS_MEM_ENABLE_OPENCODE_HOOKS || "true").toLowerCase() !== "false";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function projectNameFromPath(value: string): string {
  const normalized = normalizePath(value);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function getMeta(payload: HookPayload): HookPayload {
  const meta = payload.meta;
  return typeof meta === "object" && meta ? (meta as HookPayload) : {};
}

function resolveProject(payload: HookPayload): { name: string; root: string } {
  const meta = getMeta(payload);
  const rootCandidate =
    toString(payload.cwd) ||
    toString(payload.workdir) ||
    toString(payload.workspace) ||
    toString(payload.workspace_path) ||
    toString(payload.project_root) ||
    toString(payload.project_path) ||
    toString(payload.directory) ||
    toString(meta.cwd) ||
    toString(meta.workdir) ||
    toString(meta.workspace) ||
    toString(meta.project_root) ||
    toString(process.env.HARNESS_MEM_OPENCODE_PROJECT_ROOT) ||
    process.cwd();

  const root = normalizePath(rootCandidate);
  const name = projectNameFromPath(root) || "unknown-project";
  return { name, root };
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function safeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

async function post(path: string, payload: Record<string, unknown>): Promise<void> {
  if (!ENABLED) {
    return;
  }
  try {
    await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // non-blocking hook
  }
}

function buildSessionId(payload: HookPayload): string {
  return (
    toString(payload.session_id) ||
    toString(payload.sessionId) ||
    toString(payload.sessionID) ||
    toString(payload.conversation_id) ||
    toString(payload.conversationId) ||
    toString(payload.thread_id) ||
    toString(payload.threadId) ||
    `opencode-${Date.now()}`
  );
}

function buildCorrelationId(payload: HookPayload): string | undefined {
  const id =
    toString(payload.correlation_id) ||
    toString(payload.correlationId) ||
    toString(payload.trace_id) ||
    toString(payload.traceId);
  return id || undefined;
}

const MAX_TOOL_INPUT_LENGTH = 2000;

function sanitizeToolInput(raw: unknown): unknown {
  if (raw == null) return undefined;
  const str = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (!str) return undefined;
  const redacted = str.replace(
    /("(?:[^"]*(?:secret|token|password|api_key|apikey|auth|credential|private_key|access_key)[^"]*)":\s*)"[^"]*"/gi,
    '$1"[REDACTED]"'
  );
  return redacted.length > MAX_TOOL_INPUT_LENGTH
    ? redacted.slice(0, MAX_TOOL_INPUT_LENGTH) + "...[truncated]"
    : redacted;
}

function extractMcpMeta(payload: HookPayload): { messageId?: string; attachmentId?: string } {
  const messageId =
    toString(payload.messageID) ||
    toString(payload.messageId) ||
    toString(payload.message_id);
  const attachmentId =
    toString(payload.attachmentID) ||
    toString(payload.attachmentId) ||
    toString(payload.attachment_id);
  return {
    ...(messageId ? { messageId } : {}),
    ...(attachmentId ? { attachmentId } : {}),
  };
}

export default {
  name: "harness-memory",
  version: "0.2.0",
  hooks: {
    async "tool.definition"(payload: HookPayload) {
      const sessionId = buildSessionId(payload);
      const project = resolveProject(payload);
      const correlationId = buildCorrelationId(payload);
      const mcpMeta = extractMcpMeta(payload);

      await post("/v1/events/record", {
        event: {
          platform: "opencode",
          project: project.root,
          session_id: sessionId,
          event_type: "tool_definition",
          ts: new Date().toISOString(),
          payload: {
            ...payload,
            project_root: project.root,
          },
          tags: ["opencode_hook", "tool.definition"],
          privacy_tags: safeArray(payload.privacy_tags),
          ...(correlationId ? { correlation_id: correlationId } : {}),
          ...(Object.keys(mcpMeta).length > 0 ? { mcp_meta: mcpMeta } : {}),
        },
      });
    },

    async "chat.message"(payload: HookPayload) {
      const role = toString(payload.role, "user");
      const eventType = role === "assistant" || role === "tool" ? "tool_use" : "user_prompt";
      const sessionId = buildSessionId(payload);
      const project = resolveProject(payload);
      const correlationId = buildCorrelationId(payload);
      const mcpMeta = extractMcpMeta(payload);

      await post("/v1/events/record", {
        event: {
          platform: "opencode",
          project: project.root,
          session_id: sessionId,
          event_type: eventType,
          ts: new Date().toISOString(),
          payload: {
            ...payload,
            project_root: project.root,
          },
          tags: ["opencode_hook", "chat.message"],
          privacy_tags: safeArray(payload.privacy_tags),
          ...(correlationId ? { correlation_id: correlationId } : {}),
          ...(Object.keys(mcpMeta).length > 0 ? { mcp_meta: mcpMeta } : {}),
        },
      });
    },

    async "session.idle"(payload: HookPayload) {
      const sessionId = buildSessionId(payload);
      const project = resolveProject(payload);
      const correlationId = buildCorrelationId(payload);
      const mcpMeta = extractMcpMeta(payload);
      await post("/v1/checkpoints/record", {
        platform: "opencode",
        project: project.root,
        session_id: sessionId,
        title: "OpenCode idle checkpoint",
        content: toString(payload.summary, "session became idle"),
        tags: ["opencode_hook", "session.idle"],
        privacy_tags: safeArray(payload.privacy_tags),
        ...(correlationId ? { correlation_id: correlationId } : {}),
        ...(Object.keys(mcpMeta).length > 0 ? { mcp_meta: mcpMeta } : {}),
      });
    },

    async "session.compacted"(payload: HookPayload) {
      const sessionId = buildSessionId(payload);
      const project = resolveProject(payload);
      const correlationId = buildCorrelationId(payload);
      const mcpMeta = extractMcpMeta(payload);
      await post("/v1/sessions/finalize", {
        platform: "opencode",
        project: project.root,
        session_id: sessionId,
        summary_mode: "standard",
        ...(correlationId ? { correlation_id: correlationId } : {}),
        ...(Object.keys(mcpMeta).length > 0 ? { mcp_meta: mcpMeta } : {}),
      });
    },

    async "tool.execute.before"(payload: HookPayload) {
      const sessionId = buildSessionId(payload);
      const project = resolveProject(payload);
      const correlationId = buildCorrelationId(payload);
      const mcpMeta = extractMcpMeta(payload);

      await post("/v1/events/record", {
        event: {
          platform: "opencode",
          project: project.root,
          session_id: sessionId,
          event_type: "tool_execute_before",
          ts: new Date().toISOString(),
          payload: {
            tool_name: toString(payload.tool_name) || toString(payload.toolName) || toString(payload.name),
            tool_input: sanitizeToolInput(payload.input || payload.args || payload.parameters),
            project_root: project.root,
          },
          tags: ["opencode_hook", "tool.execute.before"],
          privacy_tags: safeArray(payload.privacy_tags),
          ...(correlationId ? { correlation_id: correlationId } : {}),
          ...(Object.keys(mcpMeta).length > 0 ? { mcp_meta: mcpMeta } : {}),
        },
      });
    },

    async "tool.execute.after"(payload: HookPayload) {
      const sessionId = buildSessionId(payload);
      const project = resolveProject(payload);
      const correlationId = buildCorrelationId(payload);
      const mcpMeta = extractMcpMeta(payload);

      await post("/v1/events/record", {
        event: {
          platform: "opencode",
          project: project.root,
          session_id: sessionId,
          event_type: "tool_execute_after",
          ts: new Date().toISOString(),
          payload: {
            tool_name: toString(payload.tool_name) || toString(payload.toolName) || toString(payload.name),
            success: payload.success ?? payload.ok ?? undefined,
            duration_ms: payload.duration_ms ?? payload.durationMs ?? payload.duration,
            project_root: project.root,
          },
          tags: ["opencode_hook", "tool.execute.after"],
          privacy_tags: safeArray(payload.privacy_tags),
          ...(correlationId ? { correlation_id: correlationId } : {}),
          ...(Object.keys(mcpMeta).length > 0 ? { mcp_meta: mcpMeta } : {}),
        },
      });
    },
  },
};
