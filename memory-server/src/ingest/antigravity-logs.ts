import { createHash } from "node:crypto";

export interface AntigravityLogIngestEvent {
  lineOffset: number;
  line: string;
  eventType: "checkpoint";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  dedupeHash: string;
}

export function parseAntigravityLogChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
  project: string;
  sessionSeed: string;
  filePath: string;
}): {
  events: AntigravityLogIngestEvent[];
  consumedBytes: number;
} {
  const events: AntigravityLogIngestEvent[] = [];
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

    const plannerMatch = line.match(
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?).*Requesting planner with (\d+) chat messages\b/i
    );
    if (!plannerMatch) {
      continue;
    }

    const timestamp =
      normalizeTimestamp(plannerMatch[1] || "", params.fallbackNowIso) ||
      params.fallbackNowIso();
    const chatMessageCount = Number(plannerMatch[2] || 0);
    const project = params.project || "unknown";
    const sessionId = `antigravity:${project}:${params.sessionSeed || "planner"}`;
    const content = `Planner requested with ${chatMessageCount} chat messages`;
    const dedupeHash = createHash("sha256")
      .update(`${params.sourceKey}:${lineOffset}:${rawLine}`)
      .digest("hex");

    events.push({
      lineOffset,
      line: rawLine,
      eventType: "checkpoint",
      sessionId,
      project,
      timestamp,
      payload: {
        source_type: "antigravity_log",
        title: "Antigravity planner activity",
        content: `${content} (prompt body unavailable)`,
        chat_message_count: chatMessageCount,
        file_path: params.filePath,
      },
      dedupeHash,
    });
  }

  return {
    events,
    consumedBytes: cursor,
  };
}

function normalizeTimestamp(value: string, fallbackNowIso: () => string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallbackNowIso();
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  const localCandidate = trimmed.replace(" ", "T");
  const localParsed = new Date(localCandidate);
  if (!Number.isNaN(localParsed.getTime())) {
    return localParsed.toISOString();
  }

  return fallbackNowIso();
}
