import { createHash } from "node:crypto";
import type { PlatformIngester, IngesterDeps } from "./types";

export interface CodexSessionsContext {
  sessionId?: string;
  project?: string;
  lastUserPrompt?: string;
  lastAssistantContent?: string;
}

export interface CodexSessionsEvent {
  lineOffset: number;
  nextOffset: number;
  line: string;
  parsed: Record<string, unknown>;
  eventType: "user_prompt" | "checkpoint";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  dedupeHash: string;
}

interface NormalizedCodexEvent {
  eventType: "user_prompt" | "checkpoint";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  dedupeSuffix?: string;
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
    lastUserPrompt: normalizeString(params.context?.lastUserPrompt),
    lastAssistantContent: normalizeString(params.context?.lastAssistantContent),
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

    const normalizedEvents = normalizeEvents({
      parsed,
      payload,
      context,
      fallbackNowIso: params.fallbackNowIso,
      defaultSessionId: normalizeString(params.defaultSessionId),
      defaultProject: normalizeString(params.defaultProject),
    });

    if (normalizedEvents.length === 0) {
      continue;
    }

    for (const normalized of normalizedEvents) {
      const normalizedPrompt = normalizeString(normalized.payload.prompt) || normalizeString(normalized.payload.content);
      if (normalized.eventType === "user_prompt" && normalizedPrompt) {
        context.lastUserPrompt = normalizedPrompt;
      }
      if (normalized.eventType === "checkpoint") {
        const assistantContent = normalizeString(normalized.payload.content);
        if (assistantContent) {
          context.lastAssistantContent = assistantContent;
        }
      }

      const dedupeMaterial = normalized.dedupeSuffix
        ? `${params.sourceKey}:${lineOffset}:${normalized.dedupeSuffix}:${rawLine}`
        : `${params.sourceKey}:${lineOffset}:${rawLine}`;
      const dedupeHash = createHash("sha256").update(dedupeMaterial).digest("hex");

      events.push({
        lineOffset,
        nextOffset: params.baseOffset + cursor,
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
  }

  return {
    events,
    consumedBytes: cursor,
    context,
  };
}

function normalizeEvents(params: {
  parsed: Record<string, unknown>;
  payload: Record<string, unknown>;
  context: CodexSessionsContext;
  fallbackNowIso: () => string;
  defaultSessionId?: string;
  defaultProject?: string;
}): NormalizedCodexEvent[] {
  const type = normalizeString(params.parsed.type);
  if (type === "compacted") {
    return normalizeCompactedEvents(params);
  }

  if (type === "thread/turns/list") {
    return normalizeThreadTurnsListEvents(params);
  }

  const normalized = normalizeEvent(params);
  return normalized ? [normalized] : [];
}

function normalizeEvent(params: {
  parsed: Record<string, unknown>;
  payload: Record<string, unknown>;
  context: CodexSessionsContext;
  fallbackNowIso: () => string;
  defaultSessionId?: string;
  defaultProject?: string;
}): NormalizedCodexEvent | null {
  const type = normalizeString(params.parsed.type);

  if (type === "response_item") {
    const payloadType = normalizeString(params.payload.type);
    const role = normalizeString(params.payload.role);
    if (payloadType !== "message") {
      return null;
    }

    if (role === "user") {
      const prompt = extractMessageText(params.payload.content, ["input_text", "text"]);
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

    if (role !== "assistant") {
      return null;
    }

    const assistantContent = extractMessageText(params.payload.content, ["output_text", "text", "input_text"]);
    if (!assistantContent || assistantContent === normalizeString(params.context.lastAssistantContent)) {
      return null;
    }

    return createAssistantCheckpoint(params, {
      sourceType: "response_item",
      assistantContent,
      title: "assistant_response",
    });
  }

  if (type === "event_msg") {
    const payloadType = normalizeString(params.payload.type);
    if (payloadType === "agent_message") {
      const assistantContent = normalizeString(params.payload.message) || normalizeString(params.payload.text);
      if (!assistantContent || assistantContent === normalizeString(params.context.lastAssistantContent)) {
        return null;
      }

      return createAssistantCheckpoint(params, {
        sourceType: "event_msg",
        assistantContent,
        title: "assistant_response",
        eventSubtype: "agent_message",
      });
    }

    if (payloadType !== "task_complete") {
      return null;
    }

    const lastAgentMessage = normalizeString(params.payload.last_agent_message);
    if (!lastAgentMessage || lastAgentMessage === normalizeString(params.context.lastAssistantContent)) {
      return null;
    }

    return {
      eventType: "checkpoint",
      sessionId: resolveSessionId(params),
      project: resolveProject(params),
      timestamp: resolveTimestamp(params.parsed, params.fallbackNowIso),
      payload: {
        source_type: "event_msg",
        role: "assistant",
        type: "task_complete",
        title: "task_complete",
        content: lastAgentMessage,
        last_agent_message: lastAgentMessage,
        prompt: normalizeString(params.context.lastUserPrompt),
        turn_id: normalizeString(params.payload.turn_id),
      },
    };
  }

  return null;
}

function normalizeCompactedEvents(params: {
  parsed: Record<string, unknown>;
  payload: Record<string, unknown>;
  context: CodexSessionsContext;
  fallbackNowIso: () => string;
  defaultSessionId?: string;
  defaultProject?: string;
}): NormalizedCodexEvent[] {
  const replacementHistory = toArray(params.payload.replacement_history);
  if (replacementHistory.length === 0) {
    return [];
  }

  const recovered: NormalizedCodexEvent[] = [];
  const localContext: CodexSessionsContext = {
    sessionId: normalizeString(params.context.sessionId),
    project: normalizeString(params.context.project),
    lastUserPrompt: normalizeString(params.context.lastUserPrompt),
    lastAssistantContent: normalizeString(params.context.lastAssistantContent),
  };

  for (let index = 0; index < replacementHistory.length; index += 1) {
    const replacement = toRecord(replacementHistory[index]);
    if (normalizeString(replacement.type) !== "message") {
      continue;
    }

    const role = normalizeString(replacement.role);
    if (role === "user") {
      const prompt = extractMessageText(replacement.content, ["input_text", "text"]);
      if (!prompt) {
        continue;
      }
      recovered.push({
        eventType: "user_prompt",
        sessionId: resolveSessionId({
          parsed: params.parsed,
          payload: params.payload,
          context: localContext,
          defaultSessionId: params.defaultSessionId,
        }),
        project: resolveProject({
          parsed: params.parsed,
          payload: params.payload,
          context: localContext,
          defaultProject: params.defaultProject,
        }),
        timestamp: resolveTimestamp(params.parsed, params.fallbackNowIso),
        payload: {
          source_type: "compacted",
          role: "user",
          prompt,
          content: prompt,
        },
        dedupeSuffix: `compacted-user-${index}`,
      });
      localContext.lastUserPrompt = prompt;
      continue;
    }

    if (role !== "assistant") {
      continue;
    }

    const assistantContent = extractMessageText(replacement.content, ["output_text", "text", "input_text"]);
    if (!assistantContent) {
      continue;
    }
    recovered.push({
      eventType: "checkpoint",
      sessionId: resolveSessionId({
        parsed: params.parsed,
        payload: params.payload,
        context: localContext,
        defaultSessionId: params.defaultSessionId,
      }),
      project: resolveProject({
        parsed: params.parsed,
        payload: params.payload,
        context: localContext,
        defaultProject: params.defaultProject,
      }),
      timestamp: resolveTimestamp(params.parsed, params.fallbackNowIso),
      payload: {
        source_type: "compacted",
        role: "assistant",
        type: "assistant_message",
        title: "assistant_response",
        content: assistantContent,
        last_agent_message: assistantContent,
        prompt: normalizeString(localContext.lastUserPrompt),
        turn_id: "",
      },
      dedupeSuffix: `compacted-assistant-${index}`,
    });
    localContext.lastAssistantContent = assistantContent;
  }

  if (recovered.length === 0) {
    return [];
  }

  const lastKnownUserPrompt = normalizeString(params.context.lastUserPrompt);
  const lastKnownAssistantContent = normalizeString(params.context.lastAssistantContent);
  let startIndex = 0;
  for (let index = recovered.length - 1; index >= 0; index -= 1) {
    const item = recovered[index];
    const prompt = normalizeString(item.payload.prompt) || normalizeString(item.payload.content);
    const content = normalizeString(item.payload.content);
    if (item.eventType === "checkpoint" && lastKnownAssistantContent && content === lastKnownAssistantContent) {
      startIndex = index + 1;
      break;
    }
    if (item.eventType === "user_prompt" && lastKnownUserPrompt && prompt === lastKnownUserPrompt) {
      startIndex = index + 1;
      break;
    }
  }
  return recovered.slice(startIndex);
}

function normalizeThreadTurnsListEvents(params: {
  parsed: Record<string, unknown>;
  payload: Record<string, unknown>;
  context: CodexSessionsContext;
  fallbackNowIso: () => string;
  defaultSessionId?: string;
  defaultProject?: string;
}): NormalizedCodexEvent[] {
  const itemsView = normalizeItemsView(params.payload.itemsView) || normalizeItemsView(params.payload.items_view);
  const items = toArray(params.payload.items);

  if (itemsView === "not_loaded" || items.length === 0) {
    return [];
  }

  if (itemsView !== "summary" && itemsView !== "full") {
    return [];
  }

  const recovered: NormalizedCodexEvent[] = [];
  const localContext: CodexSessionsContext = {
    sessionId: normalizeString(params.context.sessionId),
    project: normalizeString(params.context.project),
    lastUserPrompt: normalizeString(params.context.lastUserPrompt),
    lastAssistantContent: normalizeString(params.context.lastAssistantContent),
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = unwrapThreadTurnItem(items[index]);
    if (normalizeString(item.type) !== "message") {
      continue;
    }

    const role = normalizeString(item.role);
    if (role === "user") {
      const prompt = extractMessageText(item.content, ["input_text", "text"]);
      if (!prompt) {
        continue;
      }

      recovered.push({
        eventType: "user_prompt",
        sessionId: resolveSessionId({
          parsed: params.parsed,
          payload: params.payload,
          context: localContext,
          defaultSessionId: params.defaultSessionId,
        }),
        project: resolveProject({
          parsed: params.parsed,
          payload: params.payload,
          context: localContext,
          defaultProject: params.defaultProject,
        }),
        timestamp: resolveTimestamp(params.parsed, params.fallbackNowIso),
        payload: {
          source_type: "thread_turns_list",
          items_view: itemsView,
          role: "user",
          prompt,
          content: prompt,
        },
        dedupeSuffix: `thread-${itemsView}-user-${index}`,
      });
      localContext.lastUserPrompt = prompt;
      continue;
    }

    if (role !== "assistant") {
      continue;
    }

    const assistantContent = extractMessageText(item.content, ["output_text", "text", "input_text"]);
    if (!assistantContent || assistantContent === normalizeString(localContext.lastAssistantContent)) {
      continue;
    }

    recovered.push({
      eventType: "checkpoint",
      sessionId: resolveSessionId({
        parsed: params.parsed,
        payload: params.payload,
        context: localContext,
        defaultSessionId: params.defaultSessionId,
      }),
      project: resolveProject({
        parsed: params.parsed,
        payload: params.payload,
        context: localContext,
        defaultProject: params.defaultProject,
      }),
      timestamp: resolveTimestamp(params.parsed, params.fallbackNowIso),
      payload: {
        source_type: "thread_turns_list",
        items_view: itemsView,
        role: "assistant",
        type: "assistant_message",
        title: "assistant_response",
        content: assistantContent,
        last_agent_message: assistantContent,
        prompt: normalizeString(localContext.lastUserPrompt),
        turn_id: normalizeString(item.turn_id) || normalizeString(params.payload.turn_id),
      },
      dedupeSuffix: `thread-${itemsView}-assistant-${index}`,
    });
    localContext.lastAssistantContent = assistantContent;
  }

  return recovered;
}

function unwrapThreadTurnItem(value: unknown): Record<string, unknown> {
  const item = toRecord(value);
  if (normalizeString(item.type) === "message") {
    return item;
  }

  const nestedItem = toRecord(item.item);
  if (normalizeString(nestedItem.type) === "message") {
    return nestedItem;
  }

  const nestedMessage = toRecord(item.message);
  if (normalizeString(nestedMessage.type) === "message") {
    return nestedMessage;
  }

  return item;
}

function normalizeItemsView(value: unknown): string {
  const normalized = normalizeString(value);
  if (normalized === "notLoaded" || normalized === "not-loaded") {
    return "not_loaded";
  }
  return normalized;
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

function createAssistantCheckpoint(
  params: {
    parsed: Record<string, unknown>;
    payload: Record<string, unknown>;
    context: CodexSessionsContext;
    fallbackNowIso: () => string;
    defaultSessionId?: string;
    defaultProject?: string;
  },
  options: {
    sourceType: "event_msg" | "response_item" | "thread_turns_list";
    assistantContent: string;
    title: string;
    eventSubtype?: string;
  }
): {
  eventType: "checkpoint";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
} {
  return {
    eventType: "checkpoint",
    sessionId: resolveSessionId(params),
    project: resolveProject(params),
    timestamp: resolveTimestamp(params.parsed, params.fallbackNowIso),
    payload: {
      source_type: options.sourceType,
      role: "assistant",
      type: options.eventSubtype || "assistant_message",
      title: options.title,
      content: options.assistantContent,
      last_agent_message: options.assistantContent,
      prompt: normalizeString(params.context.lastUserPrompt),
      turn_id: normalizeString(params.payload.turn_id),
    },
  };
}

function extractMessageText(content: unknown, allowedTypes: string[]): string {
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
    if (!allowedTypes.includes(itemType)) {
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
  return normalizeString(value);
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

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export class CodexSessionsIngester implements PlatformIngester {
  readonly name = "codex-sessions";
  readonly description = "Codex セッションの JSONL イベントを取り込む";
  readonly pollIntervalMs = 30_000;

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
