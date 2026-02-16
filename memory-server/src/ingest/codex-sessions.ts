import { createHash } from "node:crypto";
import { basename } from "node:path";

export interface CodexSessionsContext {
  sessionId?: string;
  project?: string;
}

export interface CodexSessionsEvent {
  lineOffset: number;
  line: string;
  parsed: Record<string, unknown>;
  eventType: "user_prompt" | "checkpoint";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  dedupeHash: string;
}

export function parseCodexSessionsChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
  context?: CodexSessionsContext;
  defaultSessionId?: string;
  defaultProject?: string;
}): {
  events: CodexSessionsEvent[];
  consumedBytes: number;
  context: CodexSessionsContext;
} {
  const context: CodexSessionsContext = {
    sessionId: normalizeString(params.context?.sessionId),
    project: normalizeString(params.context?.project),
  };

  const events: CodexSessionsEvent[] = [];
  const buffer = Buffer.from(params.chunk, "utf8");
  let cursor = 0;

  while (cursor < buffer.length) {
    const newline = buffer.indexOf(0x0a, cursor);
    if (newline === -1) {
      break;
    }

    const rawLineBuffer = buffer.subarray(cursor, newline);
    const rawLine = rawLineBuffer.toString("utf8").replace(/\r$/, "");
    const line = rawLine.trim();
    const lineOffset = params.baseOffset + cursor;
    cursor = newline + 1;

    if (!line) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(line) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        continue;
      }
      parsed = value as Record<string, unknown>;
    } catch {
      continue;
    }

    const payload = toRecord(parsed.payload);
    const type = normalizeString(parsed.type);
    if (type === "session_meta") {
      const nextSessionId = normalizeString(payload.id);
      const nextProject = normalizeProjectFromCwd(payload.cwd);
      if (nextSessionId) {
        context.sessionId = nextSessionId;
      }
      if (nextProject) {
        context.project = nextProject;
      }
      continue;
    }

    const normalized = normalizeEvent({
      parsed,
      payload,
      context,
      fallbackNowIso: params.fallbackNowIso,
      defaultSessionId: normalizeString(params.defaultSessionId),
      defaultProject: normalizeString(params.defaultProject),
    });

    if (!normalized) {
      continue;
    }

    const dedupeHash = createHash("sha256")
      .update(`${params.sourceKey}:${lineOffset}:${rawLine}`)
      .digest("hex");

    events.push({
      lineOffset,
      line: rawLine,
      parsed,
      eventType: normalized.eventType,
      sessionId: normalized.sessionId,
      project: normalized.project,
      timestamp: normalized.timestamp,
      payload: normalized.payload,
      dedupeHash,
    });
  }

  return {
    events,
    consumedBytes: cursor,
    context,
  };
}

function normalizeEvent(params: {
  parsed: Record<string, unknown>;
  payload: Record<string, unknown>;
  context: CodexSessionsContext;
  fallbackNowIso: () => string;
  defaultSessionId?: string;
  defaultProject?: string;
}): {
  eventType: "user_prompt" | "checkpoint";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
} | null {
  const type = normalizeString(params.parsed.type);

  if (type === "response_item") {
    const payloadType = normalizeString(params.payload.type);
    const role = normalizeString(params.payload.role);
    if (payloadType !== "message" || role !== "user") {
      return null;
    }

    const prompt = extractInputText(params.payload.content);
    if (!prompt) {
      return null;
    }

    return {
      eventType: "user_prompt",
      sessionId: resolveSessionId(params),
      project: resolveProject(params),
      timestamp: resolveTimestamp(params.parsed, params.fallbackNowIso),
      payload: {
        source_type: "response_item",
        role: "user",
        prompt,
        content: prompt,
      },
    };
  }

  if (type === "event_msg") {
    const payloadType = normalizeString(params.payload.type);
    if (payloadType !== "task_complete") {
      return null;
    }

    const lastAgentMessage = normalizeString(params.payload.last_agent_message);
    if (!lastAgentMessage) {
      return null;
    }

    return {
      eventType: "checkpoint",
      sessionId: resolveSessionId(params),
      project: resolveProject(params),
      timestamp: resolveTimestamp(params.parsed, params.fallbackNowIso),
      payload: {
        source_type: "event_msg",
        type: "task_complete",
        title: "task_complete",
        content: lastAgentMessage,
        last_agent_message: lastAgentMessage,
        turn_id: normalizeString(params.payload.turn_id),
      },
    };
  }

  return null;
}

function resolveSessionId(params: {
  parsed: Record<string, unknown>;
  payload: Record<string, unknown>;
  context: CodexSessionsContext;
  defaultSessionId?: string;
}): string {
  return (
    normalizeString(params.context.sessionId) ||
    normalizeString(params.payload.session_id) ||
    normalizeString(params.parsed.session_id) ||
    normalizeString(params.payload.thread_id) ||
    normalizeString(params.parsed.thread_id) ||
    normalizeString(params.defaultSessionId) ||
    "codex-rollout"
  );
}

function resolveProject(params: {
  parsed: Record<string, unknown>;
  payload: Record<string, unknown>;
  context: CodexSessionsContext;
  defaultProject?: string;
}): string {
  return (
    normalizeString(params.context.project) ||
    normalizeProjectFromCwd(params.payload.cwd) ||
    normalizeProjectFromCwd(params.parsed.cwd) ||
    normalizeString(params.payload.project) ||
    normalizeString(params.parsed.project) ||
    normalizeString(params.defaultProject) ||
    "unknown"
  );
}

function resolveTimestamp(parsed: Record<string, unknown>, fallbackNowIso: () => string): string {
  return normalizeString(parsed.timestamp) || normalizeString(parsed.ts) || fallbackNowIso();
}

function extractInputText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const fragments: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const itemType = normalizeString(entry.type);
    if (itemType !== "input_text" && itemType !== "text") {
      continue;
    }
    const text = normalizeString(entry.text);
    if (!text) {
      continue;
    }
    fragments.push(text);
  }

  return fragments.join("\n\n").trim();
}

function normalizeProjectFromCwd(value: unknown): string {
  const cwd = normalizeString(value);
  if (!cwd) {
    return "";
  }
  return basename(cwd);
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
