import { basename } from "node:path";
import { createHash } from "node:crypto";

interface OpencodeDbMessageData {
  role: string;
  summaryTitle: string;
  finish: string;
  cwd: string;
}

export interface OpencodeDbMessageRow {
  rowid: number;
  messageId: string;
  sessionId: string;
  timeCreated: number;
  messageData: string;
  sessionDirectory: string;
}

export interface ParsedOpencodeDbMessage {
  eventType: "user_prompt" | "checkpoint";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  dedupeHash: string;
}

export function parseOpencodeDbMessageRow(params: {
  sourceKey: string;
  row: OpencodeDbMessageRow;
  fallbackNowIso: () => string;
  resolveMessageText: (messageId: string) => string;
}): ParsedOpencodeDbMessage | null {
  const data = parseMessageData(params.row.messageData);
  if (data.role !== "user" && data.role !== "assistant") {
    return null;
  }

  const cwd = normalize(params.row.sessionDirectory) || data.cwd;
  const project = basename(cwd || "unknown");
  const text = normalize(params.resolveMessageText(params.row.messageId));

  // Ignore intermediate assistant turns that only signal tool calls and
  // have no user-visible text. This prevents checkpoint noise spikes.
  if (data.role === "assistant" && !text && data.finish && data.finish !== "stop") {
    return null;
  }

  const eventType = data.role === "user" ? "user_prompt" : "checkpoint";
  const payload =
    eventType === "user_prompt"
      ? {
          source_type: "opencode_db",
          role: "user",
          prompt: text || data.summaryTitle || "(empty prompt)",
          content: text || data.summaryTitle || "(empty prompt)",
          message_id: params.row.messageId,
          rowid: params.row.rowid,
          cwd,
        }
      : {
          source_type: "opencode_db",
          role: "assistant",
          content: text || "(assistant completed)",
          title: data.summaryTitle || "assistant_response",
          finish: data.finish,
          message_id: params.row.messageId,
          rowid: params.row.rowid,
          cwd,
        };

  const dedupeHash = createHash("sha256")
    .update(`${params.sourceKey}:${params.row.rowid}:${params.row.messageData}`)
    .digest("hex");

  return {
    eventType,
    sessionId: normalize(params.row.sessionId) || "opencode-session",
    project,
    timestamp: fromUnixMs(params.row.timeCreated) || params.fallbackNowIso(),
    payload,
    dedupeHash,
  };
}

function parseMessageData(raw: string): OpencodeDbMessageData {
  const parsed = parseRecord(raw);
  const summary = toRecord(parsed.summary);
  const path = toRecord(parsed.path);
  return {
    role: normalize(parsed.role).toLowerCase(),
    summaryTitle: normalize(summary.title),
    finish: normalize(parsed.finish),
    cwd: normalize(path.cwd),
  };
}

function parseRecord(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return toRecord(parsed);
  } catch {
    return {};
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalize(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function fromUnixMs(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "";
  }
  return new Date(value).toISOString();
}
