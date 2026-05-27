import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { PlatformIngester, IngesterDeps } from "./types";

export type CursorHookIngestEventType =
  | "user_prompt"
  | "tool_use"
  | "session_start"
  | "session_end"
  | "checkpoint";

export interface CursorHookIngestEvent {
  lineOffset: number;
  line: string;
  parsed: Record<string, unknown>;
  eventType: CursorHookIngestEventType;
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  dedupeHash: string;
}

export function parseCursorHooksChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
}): {
  events: CursorHookIngestEvent[];
  consumedBytes: number;
} {
  const events: CursorHookIngestEvent[] = [];
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

    const normalized = normalizeCursorHookEvent(parsed, params.fallbackNowIso);
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
  };
}

function normalizeCursorHookEvent(
  parsed: Record<string, unknown>,
  fallbackNowIso: () => string
): {
  eventType: CursorHookIngestEventType;
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
} | null {
  const hookEventName = resolveHookEventName(parsed);
  if (!hookEventName) {
    return null;
  }

  if (hookEventName === "afteragentthought") {
    return null;
  }

  const timestamp = resolveTimestamp(parsed, fallbackNowIso);
  const project = resolveProject(parsed) || "unknown";
  const sessionId = resolveSessionId(parsed, project, timestamp, fallbackNowIso);
  const metadata = buildCursorHookMetadata(parsed);

  if (hookEventName === "sessionstart") {
    const composerMode = normalizeString(parsed.composer_mode);
    const isBackground = parsed.is_background_agent === true;
    return {
      eventType: "session_start",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "cursor_hook",
        hook_event_name: "sessionStart",
        title: "Cursor session start",
        content: composerMode
          ? `Cursor session started (${composerMode})`
          : "Cursor session started",
        composer_mode: composerMode || undefined,
        is_background_agent: isBackground,
        ...metadata,
      },
    };
  }

  if (hookEventName === "beforesubmitprompt") {
    const prompt = extractPrompt(parsed);
    if (!prompt) {
      return null;
    }

    return {
      eventType: "user_prompt",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "cursor_hook",
        hook_event_name: "beforeSubmitPrompt",
        title: "Cursor prompt",
        prompt,
        content: prompt,
        attachments: extractAttachments(parsed),
        ...metadata,
      },
    };
  }

  if (hookEventName === "afteragentresponse") {
    const assistantContent = extractAssistantResponse(parsed);
    if (!assistantContent) {
      return null;
    }

    return {
      eventType: "checkpoint",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "cursor_hook",
        hook_event_name: "afterAgentResponse",
        role: "assistant",
        title: "assistant_response",
        content: assistantContent,
        last_assistant_message: assistantContent,
        ...metadata,
      },
    };
  }

  if (hookEventName === "aftermcpexecution") {
    const toolName =
      normalizeString(parsed.tool_name) ||
      normalizeString((toRecord(parsed.payload).tool_name as unknown)) ||
      "mcp_tool";
    const title = `MCP: ${toolName}`;
    const content = `MCP tool executed: ${toolName}`;
    return {
      eventType: "tool_use",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "cursor_hook",
        hook_event_name: "afterMCPExecution",
        title,
        content,
        tool_name: toolName,
        tool_input: toRecord(parsed.tool_input),
        tool_response: toRecord(parsed.result_json),
        ...metadata,
      },
    };
  }

  if (hookEventName === "aftershellexecution") {
    const command = normalizeString(parsed.command);
    const summary = command ? command.slice(0, 160) : "shell command";
    const output = normalizeString(parsed.output);
    const title = `Shell: ${summary}`;
    return {
      eventType: "tool_use",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "cursor_hook",
        hook_event_name: "afterShellExecution",
        title,
        content: command || "Shell command executed",
        command,
        output,
        exit_code: toNumber(parsed.exit_code),
        ...metadata,
      },
    };
  }

  if (hookEventName === "afterfileedit") {
    const filePath = normalizeString(parsed.file_path);
    const shortName = filePath ? basename(filePath) : "file";
    return {
      eventType: "tool_use",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "cursor_hook",
        hook_event_name: "afterFileEdit",
        title: `Edit: ${shortName}`,
        content: filePath ? `Edited ${filePath}` : "File edit event",
        file_path: filePath,
        edits: Array.isArray(parsed.edits) ? parsed.edits : [],
        ...metadata,
      },
    };
  }

  if (hookEventName === "sessionend") {
    const reason = normalizeString(parsed.reason) || normalizeString(parsed.final_status) || "completed";
    const durationMs = toNumber(parsed.duration_ms);
    return {
      eventType: "session_end",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "cursor_hook",
        hook_event_name: "sessionEnd",
        title: "Cursor session end",
        content: `Cursor session ended (${reason})`,
        status: reason,
        duration_ms: durationMs ?? undefined,
        is_background_agent: parsed.is_background_agent === true ? true : undefined,
        error_message: normalizeString(parsed.error_message) || undefined,
        ...metadata,
      },
    };
  }

  if (hookEventName === "stop") {
    const status = normalizeString(parsed.status) || "completed";
    const loopCount = toNumber(parsed.loop_count);
    return {
      eventType: "session_end",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "cursor_hook",
        hook_event_name: "stop",
        title: "Cursor session end",
        content: `Cursor session ended (${status})`,
        status,
        loop_count: loopCount ?? undefined,
        ...metadata,
      },
    };
  }

  return null;
}

function buildCursorHookMetadata(parsed: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const generationId = normalizeString(parsed.generation_id);
  if (generationId) {
    metadata.generation_id = generationId;
  }
  const transcriptPath = normalizeString(parsed.transcript_path);
  if (transcriptPath) {
    metadata.transcript_path = transcriptPath;
  }
  const model = normalizeString(parsed.model);
  if (model) {
    metadata.model = model;
  }
  const cursorVersion = normalizeString(parsed.cursor_version);
  if (cursorVersion) {
    metadata.cursor_version = cursorVersion;
  }
  return metadata;
}

function resolveHookEventName(parsed: Record<string, unknown>): string {
  const raw =
    normalizeString(parsed.hook_event_name) ||
    normalizeString(parsed.hook_event) ||
    normalizeString(parsed.event_name) ||
    normalizeString(parsed.event) ||
    normalizeString(toRecord(parsed.meta).hook_event);
  return raw.toLowerCase();
}

function resolveProject(parsed: Record<string, unknown>): string {
  const workspaceRoots = parsed.workspace_roots;
  if (Array.isArray(workspaceRoots)) {
    for (const value of workspaceRoots) {
      const candidate = normalizeString(value);
      if (!candidate) {
        continue;
      }
      return candidate;
    }
  }

  const direct =
    normalizeString(parsed.workspace_root) ||
    normalizeString(parsed.cwd) ||
    normalizeString(toRecord(parsed.path).cwd) ||
    normalizeString(parsed.project);

  return direct;
}

function resolveSessionId(
  parsed: Record<string, unknown>,
  project: string,
  timestamp: string,
  fallbackNowIso: () => string
): string {
  const direct =
    normalizeString(parsed.conversation_id) ||
    normalizeString(parsed.session_id) ||
    normalizeString(parsed.thread_id);
  if (direct) {
    return direct;
  }

  const dateSource = timestamp || fallbackNowIso();
  const datePart = /^\d{4}-\d{2}-\d{2}/.test(dateSource) ? dateSource.slice(0, 10) : fallbackNowIso().slice(0, 10);
  return `cursor:${project || "unknown"}:${datePart}`;
}

function resolveTimestamp(parsed: Record<string, unknown>, fallbackNowIso: () => string): string {
  const stringCandidates = [
    parsed.ts,
    parsed.timestamp,
    parsed.created_at,
    parsed.time,
    toRecord(parsed.time).iso,
  ];
  for (const value of stringCandidates) {
    const parsedIso = parseIsoValue(value);
    if (parsedIso) {
      return parsedIso;
    }
  }

  const numberCandidates = [
    parsed.time_created,
    parsed.timeCreated,
    parsed.created,
    toRecord(parsed.time).created,
    toRecord(parsed.time).completed,
  ];
  for (const value of numberCandidates) {
    const parsedIso = parseIsoValue(value);
    if (parsedIso) {
      return parsedIso;
    }
  }

  return fallbackNowIso();
}

function extractPrompt(parsed: Record<string, unknown>): string {
  const directCandidates = [
    parsed.prompt,
    parsed.user_prompt,
    parsed.userPrompt,
    parsed.message,
    parsed.input,
    parsed.text,
    toRecord(parsed.payload).prompt,
    toRecord(parsed.payload).message,
    toRecord(parsed.payload).text,
  ];
  for (const candidate of directCandidates) {
    const text = normalizeString(candidate);
    if (text) {
      return text;
    }
  }

  const messages = toRecord(parsed.payload).messages;
  if (Array.isArray(messages)) {
    const fragments: string[] = [];
    for (const entry of messages) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const role = normalizeString(row.role).toLowerCase();
      if (role && role !== "user") {
        continue;
      }
      const text = normalizeString(row.content) || normalizeString(row.text);
      if (!text) {
        continue;
      }
      fragments.push(text);
    }
    if (fragments.length > 0) {
      return fragments.join("\n\n").trim();
    }
  }

  return "";
}

function extractAssistantResponse(parsed: Record<string, unknown>): string {
  const directCandidates = [
    parsed.text,
    parsed.response,
    parsed.message,
    parsed.output,
    parsed.content,
    toRecord(parsed.payload).text,
    toRecord(parsed.payload).message,
    toRecord(parsed.payload).content,
  ];
  for (const candidate of directCandidates) {
    const text = normalizeString(candidate);
    if (text) {
      return text;
    }
  }
  return "";
}

function extractAttachments(parsed: Record<string, unknown>): string[] {
  const attachments = parsed.attachments;
  if (!Array.isArray(attachments)) {
    return [];
  }

  const values: string[] = [];
  for (const value of attachments) {
    if (typeof value === "string" && value.trim()) {
      values.push(value.trim());
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const record = value as Record<string, unknown>;
    const path = normalizeString(record.path) || normalizeString(record.file_path) || normalizeString(record.name);
    if (!path) {
      continue;
    }
    values.push(path);
  }
  return values;
}

function parseIsoValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }

  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d+$/.test(trimmed)) {
    const raw = Number(trimmed);
    if (!Number.isFinite(raw) || raw <= 0) {
      return "";
    }
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

export class CursorHooksIngester implements PlatformIngester {
  readonly name = "cursor";
  readonly description =
    "Cursor フックイベント（プロンプト・応答・ツール・セッション開始/終了）を取り込む";
  readonly pollIntervalMs = 0;

  private deps?: IngesterDeps;

  async initialize(deps: IngesterDeps): Promise<boolean> {
    this.deps = deps;
    return true;
  }

  async poll(): Promise<number> {
    return 0;
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}
