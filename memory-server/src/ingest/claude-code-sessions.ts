/**
 * claude-code-sessions.ts
 *
 * Claude Code セッション JSONL を harness-mem に取り込むパーサー + Ingester。
 *
 * Claude Code は ~/.claude/projects/<encoded-path>/<uuid>.jsonl に会話ログを記録する。
 * 各行は JSON オブジェクトで、主要な type は:
 *   - "user"      — ユーザープロンプト (message.role="user", message.content=string)
 *   - "assistant"  — アシスタント応答   (message.role="assistant", message.content=ContentBlock[])
 *   - "progress"   — ツール実行進捗（スキップ）
 *   - "system"     — システムメッセージ（スキップ）
 *
 * ディレクトリ名からプロジェクトパスを復元し、ファイル名から sessionId を取得する。
 */

import { createHash } from "node:crypto";
import type { PlatformIngester, IngesterDeps } from "./types";
import { isIgnoredVisiblePromptText } from "../core/interaction-visibility";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface ClaudeCodeContext {
  sessionId?: string;
  project?: string;
  lastUserPrompt?: string;
  lastAssistantContent?: string;
}

export interface ClaudeCodeEvent {
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

// ---------------------------------------------------------------------------
// ディレクトリ名 → プロジェクトパス復元
// ---------------------------------------------------------------------------

/**
 * Claude Code のプロジェクトディレクトリ名からファイルパスを復元する。
 * 例: "-Users-tachibanashuuta-Desktop-Code-CC-harness-harness-mem"
 *   → "/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem"
 */
export function decodeClaudeProjectDir(dirName: string): string {
  if (!dirName.startsWith("-")) return dirName;
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

// ---------------------------------------------------------------------------
// JSONL パーサー
// ---------------------------------------------------------------------------

export function parseClaudeCodeChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
  context?: ClaudeCodeContext;
  defaultSessionId?: string;
  defaultProject?: string;
}): {
  events: ClaudeCodeEvent[];
  consumedBytes: number;
  context: ClaudeCodeContext;
} {
  const context: ClaudeCodeContext = {
    sessionId: str(params.context?.sessionId),
    project: str(params.context?.project),
    lastUserPrompt: str(params.context?.lastUserPrompt),
    lastAssistantContent: str(params.context?.lastAssistantContent),
  };

  const events: ClaudeCodeEvent[] = [];
  const buffer = Buffer.from(params.chunk, "utf8");
  let cursor = 0;

  while (cursor < buffer.length) {
    const newline = buffer.indexOf(0x0a, cursor);
    if (newline === -1) break;

    const rawLine = buffer.subarray(cursor, newline).toString("utf8").replace(/\r$/, "");
    const line = rawLine.trim();
    const lineOffset = params.baseOffset + cursor;
    cursor = newline + 1;

    if (!line) continue;

    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(line) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      parsed = value as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = str(parsed.type);

    // sessionId / cwd の更新
    const parsedSessionId = str(parsed.sessionId);
    if (parsedSessionId) context.sessionId = parsedSessionId;
    const cwd = str(parsed.cwd);
    if (cwd) context.project = cwd;

    const timestamp = str(parsed.timestamp) || params.fallbackNowIso();
    const sessionId = context.sessionId || str(params.defaultSessionId) || "claude-code-unknown";
    const project = context.project || str(params.defaultProject) || "unknown";

    const message = toRecord(parsed.message);

    if (type === "user") {
      // message.content は string | ContentBlock[] の両方がありうる
      const content = extractUserText(message.content);
      if (!content) continue;
      if (isIgnoredVisiblePromptText(content)) continue;

      context.lastUserPrompt = content;

      const dedupeHash = createHash("sha256")
        .update(`${params.sourceKey}:${lineOffset}:${rawLine}`)
        .digest("hex");

      events.push({
        lineOffset,
        line: rawLine,
        parsed,
        eventType: "user_prompt",
        sessionId,
        project,
        timestamp,
        payload: {
          source_type: "claude_code_user",
          role: "user",
          prompt: content,
          content,
        },
        dedupeHash,
      });
      continue;
    }

    if (type === "assistant") {
      const assistantText = extractAssistantText(message.content);
      if (!assistantText) continue;
      // 重複防止
      if (assistantText === context.lastAssistantContent) continue;

      context.lastAssistantContent = assistantText;

      const dedupeHash = createHash("sha256")
        .update(`${params.sourceKey}:${lineOffset}:${rawLine}`)
        .digest("hex");

      events.push({
        lineOffset,
        line: rawLine,
        parsed,
        eventType: "checkpoint",
        sessionId,
        project,
        timestamp,
        payload: {
          source_type: "claude_code_assistant",
          role: "assistant",
          type: "assistant_message",
          title: "assistant_response",
          content: assistantText,
          last_agent_message: assistantText,
          prompt: context.lastUserPrompt || "",
          model: str(message.model),
        },
        dedupeHash,
      });
      continue;
    }

    if (type === "summary") {
      const summaryText = str(parsed.summary);
      if (!summaryText) continue;

      const dedupeHash = createHash("sha256")
        .update(`${params.sourceKey}:${lineOffset}:summary:${summaryText}`)
        .digest("hex");

      events.push({
        lineOffset,
        line: rawLine,
        parsed,
        eventType: "checkpoint",
        sessionId,
        project,
        timestamp: timestamp || params.fallbackNowIso(),
        payload: {
          source_type: "claude_code_summary",
          role: "system",
          type: "session_summary",
          title: "session_summary",
          content: summaryText,
        },
        dedupeHash,
      });
      continue;
    }

    if (type === "pr-link") {
      const prUrl = str(parsed.prUrl);
      const prNumber = typeof parsed.prNumber === "number" ? parsed.prNumber : 0;
      const prRepo = str(parsed.prRepository);
      if (!prUrl) continue;

      const dedupeHash = createHash("sha256")
        .update(`${params.sourceKey}:${lineOffset}:pr-link:${prUrl}`)
        .digest("hex");

      events.push({
        lineOffset,
        line: rawLine,
        parsed,
        eventType: "checkpoint",
        sessionId,
        project,
        timestamp: str(parsed.timestamp) || params.fallbackNowIso(),
        payload: {
          source_type: "claude_code_pr_link",
          role: "system",
          type: "pr_link",
          title: `PR #${prNumber}`,
          content: `PR #${prNumber}: ${prUrl}`,
          pr_url: prUrl,
          pr_number: prNumber,
          pr_repository: prRepo,
        },
        dedupeHash,
      });
      continue;
    }

    // progress, system, file-history-snapshot, queue-operation, etc. はスキップ
  }

  return { events, consumedBytes: cursor, context };
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/**
 * user の message.content から plain text を抽出する。
 * string の場合はそのまま、ContentBlock[] の場合は text ブロックのみを結合する。
 * tool_result ブロックはスキップ（ツール実行結果はノイズになるため）。
 */
function extractUserText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const fragments: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const itemType = str(entry.type);
    if (itemType === "tool_result") continue;
    if (itemType !== "text") continue;
    const text = str(entry.text);
    if (text) fragments.push(text);
  }

  return fragments.join("\n\n").trim();
}

/**
 * assistant の message.content 配列からテキストを抽出する。
 * thinking ブロックはスキップし、text ブロックのみを結合する。
 */
function extractAssistantText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const fragments: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const itemType = str(entry.type);
    // thinking, signature はスキップ
    if (itemType !== "text") continue;
    const text = str(entry.text);
    if (text) fragments.push(text);
  }

  return fragments.join("\n\n").trim();
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Ingester クラス（PlatformIngester 準拠、実際の polling は IngestCoordinator が担当）
// ---------------------------------------------------------------------------

export class ClaudeCodeSessionsIngester implements PlatformIngester {
  readonly name = "claude-code-sessions";
  readonly description = "Claude Code セッションの JSONL イベントを取り込む";
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
