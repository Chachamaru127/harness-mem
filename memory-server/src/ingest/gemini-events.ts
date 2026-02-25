import { createHash } from "node:crypto";

export interface GeminiEventEntry {
  lineOffset: number;
  line: string;
  parsed: Record<string, unknown>;
  eventType: string;
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  dedupeHash: string;
}

/**
 * Parse a chunk of JSONL lines from the Gemini events spool file.
 *
 * Each line is expected to be a JSON object with fields:
 *   platform, project, session_id, event_type, payload, ts
 *
 * Invalid JSON and empty lines are gracefully skipped with a console.warn.
 */
export function parseGeminiEventsChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
}): {
  events: GeminiEventEntry[];
  consumedBytes: number;
} {
  const events: GeminiEventEntry[] = [];
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
        console.warn(`[gemini-events] Skipping non-object JSON at offset ${lineOffset}`);
        continue;
      }
      parsed = value as Record<string, unknown>;
    } catch {
      console.warn(`[gemini-events] Skipping invalid JSON at offset ${lineOffset}`);
      continue;
    }

    const normalized = normalizeGeminiEvent(parsed, params.fallbackNowIso);
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

function normalizeGeminiEvent(
  parsed: Record<string, unknown>,
  fallbackNowIso: () => string
): {
  eventType: string;
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
} | null {
  const eventType = normalizeString(parsed.event_type);
  if (!eventType) {
    return null;
  }

  const sessionId = normalizeString(parsed.session_id) || "gemini:unknown";
  const project = normalizeString(parsed.project) || "unknown";
  const timestamp = resolveTimestamp(parsed, fallbackNowIso);
  const payload = toRecord(parsed.payload);

  // Ensure source_type is set in payload
  if (!payload.source_type) {
    payload.source_type = "gemini_hook";
  }

  return {
    eventType,
    sessionId,
    project,
    timestamp,
    payload,
  };
}

function resolveTimestamp(parsed: Record<string, unknown>, fallbackNowIso: () => string): string {
  const candidates = [parsed.ts, parsed.timestamp, parsed.created_at, parsed.time];
  for (const value of candidates) {
    const result = parseIsoValue(value);
    if (result) {
      return result;
    }
  }
  return fallbackNowIso();
}

/** Max reasonable timestamp: year 3000 in ms */
const MAX_TIMESTAMP_MS = 32503680000000;

function safeToISOString(ms: number): string {
  if (ms < 0 || ms > MAX_TIMESTAMP_MS) {
    return "";
  }
  try {
    return new Date(ms).toISOString();
  } catch {
    return "";
  }
}

function parseIsoValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    return safeToISOString(ms);
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
    return safeToISOString(ms);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
