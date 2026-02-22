import { createHash } from "node:crypto";

export interface OpencodeStorageEvent {
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

export function parseOpencodeMessageChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
  fallbackProject?: string;
  resolveSessionDirectory: (sessionId: string) => string | undefined;
  resolveMessageText: (messageId: string) => string;
}): {
  events: OpencodeStorageEvent[];
  consumedBytes: number;
} {
  const rawLine = params.chunk.trim();
  if (!rawLine) {
    return { events: [], consumedBytes: Buffer.byteLength(params.chunk, "utf8") };
  }

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(rawLine) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { events: [], consumedBytes: Buffer.byteLength(params.chunk, "utf8") };
    }
    parsed = value as Record<string, unknown>;
  } catch {
    // In-progress write or malformed JSON: keep offset unchanged for safe retry.
    return { events: [], consumedBytes: 0 };
  }

  const role = normalizeString(parsed.role).toLowerCase();
  const messageId = normalizeString(parsed.id);
  const sessionId = normalizeString(parsed.sessionID) || normalizeString(parsed.session_id) || "opencode-message";
  const cwd =
    normalizePath((parsed.path as Record<string, unknown> | undefined)?.cwd) ||
    normalizePath(params.resolveSessionDirectory(sessionId));
  const project = cwd || normalizeString(params.fallbackProject) || "unknown";

  const summary = toRecord(parsed.summary);
  const summaryTitle = normalizeString(summary.title);
  const messageText = normalizeString(params.resolveMessageText(messageId));
  const finish = normalizeString(parsed.finish);

  if (role === "assistant" && !messageText && finish && finish !== "stop") {
    return { events: [], consumedBytes: Buffer.byteLength(params.chunk, "utf8") };
  }

  const eventType = role === "assistant" ? "checkpoint" : role === "user" ? "user_prompt" : null;
  if (!eventType) {
    return { events: [], consumedBytes: Buffer.byteLength(params.chunk, "utf8") };
  }

  const payload =
    eventType === "user_prompt"
      ? {
          source_type: "opencode_message",
          role: "user",
          prompt: messageText || summaryTitle || "(empty prompt)",
          content: messageText || summaryTitle || "(empty prompt)",
          message_id: messageId,
          cwd,
        }
      : {
          source_type: "opencode_message",
          role: "assistant",
          content: messageText || summaryTitle || "(assistant completed)",
          title: summaryTitle || "assistant_response",
          finish,
          message_id: messageId,
          cwd,
        };

  const timestamp =
    fromUnixMs((toRecord(parsed.time).completed as number | undefined) ?? (toRecord(parsed.time).created as number | undefined)) ||
    normalizeString((toRecord(parsed.time).iso as unknown) || parsed.timestamp) ||
    params.fallbackNowIso();

  const dedupeHash = createHash("sha256")
    .update(`${params.sourceKey}:${params.baseOffset}:${rawLine}`)
    .digest("hex");

  return {
    events: [
      {
        lineOffset: params.baseOffset,
        line: rawLine,
        parsed,
        eventType,
        sessionId,
        project,
        timestamp,
        payload,
        dedupeHash,
      },
    ],
    consumedBytes: Buffer.byteLength(params.chunk, "utf8"),
  };
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizePath(value: unknown): string {
  return normalizeString(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function fromUnixMs(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return new Date(value).toISOString();
}
