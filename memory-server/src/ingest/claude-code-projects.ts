/**
 * claude-code-projects.ts
 *
 * Claude Code のセッション JSONL ファイルを解析し、トークン使用量・モデル情報を抽出する。
 *
 * ファイル形式:
 *   場所: ~/.claude/projects/<project-key>/<session-id>.jsonl
 *   各行は Claude Code API メッセージの JSON オブジェクト。
 *   assistant メッセージに message.model と message.usage が含まれる。
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCodeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ClaudeCodeProjectEvent {
  lineOffset: number;
  line: string;
  parsed: Record<string, unknown>;
  eventType: "assistant_message" | "user_prompt" | "tool_use";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  dedupeHash: string;
  /** Model name extracted from assistant messages */
  model: string | null;
  /** Actual token usage from the API (not estimated) */
  usage: ClaudeCodeUsage | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a chunk of JSONL from a Claude Code session file.
 *
 * Each line is expected to be one of:
 *   - { type: "human", ... }          → user_prompt
 *   - { type: "assistant", message: { model, usage, content, ... } } → assistant_message
 *   - { type: "tool_result", ... }    → tool_use
 */
export function parseClaudeCodeProjectsChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
  sessionId: string;
  project: string;
}): {
  events: ClaudeCodeProjectEvent[];
  consumedBytes: number;
} {
  const events: ClaudeCodeProjectEvent[] = [];
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

    const normalized = normalizeClaudeCodeEvent(
      parsed,
      params.fallbackNowIso,
      params.sessionId,
      params.project,
    );
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
      sessionId: params.sessionId,
      project: params.project,
      timestamp: normalized.timestamp,
      payload: normalized.payload,
      dedupeHash,
      model: normalized.model,
      usage: normalized.usage,
    });
  }

  return {
    events,
    consumedBytes: cursor,
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeClaudeCodeEvent(
  parsed: Record<string, unknown>,
  fallbackNowIso: () => string,
  sessionId: string,
  project: string,
): {
  eventType: "assistant_message" | "user_prompt" | "tool_use";
  timestamp: string;
  payload: Record<string, unknown>;
  model: string | null;
  usage: ClaudeCodeUsage | null;
} | null {
  const type = normalizeString(parsed.type);

  if (type === "human") {
    return {
      eventType: "user_prompt",
      timestamp: resolveTimestamp(parsed, fallbackNowIso),
      payload: {
        source_type: "claude_code_project",
        role: "user",
        prompt: extractHumanText(parsed),
        content: extractHumanText(parsed),
      },
      model: null,
      usage: null,
    };
  }

  if (type === "assistant") {
    const message = toRecord(parsed.message);
    const model = normalizeString(message.model) || null;
    const usage = extractUsage(message);

    // Extract text content from assistant message
    const content = extractAssistantText(message);
    if (!content && !usage) {
      return null;
    }

    return {
      eventType: "assistant_message",
      timestamp: resolveTimestamp(parsed, fallbackNowIso),
      payload: {
        source_type: "claude_code_project",
        role: "assistant",
        content: content || "",
        model: model || undefined,
        ...(usage ? {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
        } : {}),
      },
      model,
      usage,
    };
  }

  if (type === "tool_result" || type === "tool_use") {
    return {
      eventType: "tool_use",
      timestamp: resolveTimestamp(parsed, fallbackNowIso),
      payload: {
        source_type: "claude_code_project",
        role: "tool",
        tool_name: normalizeString(parsed.name) || normalizeString((toRecord(parsed.tool_use)).name) || "unknown",
      },
      model: null,
      usage: null,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

function extractHumanText(parsed: Record<string, unknown>): string {
  // Claude Code stores human messages as { type: "human", message: { content: "..." } }
  // or { type: "human", message: { content: [{type: "text", text: "..."}] } }
  const message = toRecord(parsed.message);
  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "object" && block !== null && !Array.isArray(block)) {
        const rec = block as Record<string, unknown>;
        if (rec.type === "text" && typeof rec.text === "string") {
          parts.push(rec.text);
        }
      }
    }
    return parts.join("\n");
  }

  return "";
}

function extractAssistantText(message: Record<string, unknown>): string {
  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "object" && block !== null && !Array.isArray(block)) {
        const rec = block as Record<string, unknown>;
        if (rec.type === "text" && typeof rec.text === "string") {
          parts.push(rec.text);
        }
      }
    }
    return parts.join("\n");
  }

  return "";
}

// ---------------------------------------------------------------------------
// Usage extraction
// ---------------------------------------------------------------------------

function extractUsage(message: Record<string, unknown>): ClaudeCodeUsage | null {
  const usage = toRecord(message.usage);
  if (!usage.input_tokens && !usage.output_tokens) {
    return null;
  }

  return {
    input_tokens: safeNumber(usage.input_tokens),
    output_tokens: safeNumber(usage.output_tokens),
    cache_creation_input_tokens: safeNumber(usage.cache_creation_input_tokens),
    cache_read_input_tokens: safeNumber(usage.cache_read_input_tokens),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTimestamp(parsed: Record<string, unknown>, fallbackNowIso: () => string): string {
  const candidates = [parsed.timestamp, parsed.ts, parsed.created_at];
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

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
}
