import { createHash } from "node:crypto";

export interface CodexHistoryEvent {
  lineIndex: number;
  line: string;
  parsed: Record<string, unknown>;
  role: string;
  eventType: "tool_use" | "user_prompt";
  sessionId: string;
  timestamp: string;
  dedupeHash: string;
}

export function parseCodexHistoryChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
}): {
  events: CodexHistoryEvent[];
  consumedLength: number;
} {
  const lines = params.chunk.split("\n");
  const consumedLength = lines.length > 0 ? params.chunk.length - (lines[lines.length - 1]?.length ?? 0) : 0;

  const events: CodexHistoryEvent[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const role = typeof parsed.role === "string" ? parsed.role : "";
    const eventType: "tool_use" | "user_prompt" = role === "assistant" || role === "tool" ? "tool_use" : "user_prompt";
    const sessionId =
      (typeof parsed.session_id === "string" && parsed.session_id) ||
      (typeof parsed.thread_id === "string" && parsed.thread_id) ||
      "codex-history";

    const timestamp =
      (typeof parsed.ts === "string" && parsed.ts) ||
      (typeof parsed.timestamp === "string" && parsed.timestamp) ||
      params.fallbackNowIso();

    const dedupeHash = createHash("sha256")
      .update(`${params.sourceKey}:${params.baseOffset + index}:${line}`)
      .digest("hex");

    events.push({
      lineIndex: index,
      line,
      parsed,
      role,
      eventType,
      sessionId,
      timestamp,
      dedupeHash,
    });
  }

  return {
    events,
    consumedLength,
  };
}
