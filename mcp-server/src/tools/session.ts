/**
 * Session Communication Tools
 *
 * Enables inter-session messaging across different AI clients.
 * Works with Claude Code, Codex, and other MCP-compatible clients.
 */

import { type Tool } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import {
  SESSIONS_DIR,
  ACTIVE_SESSIONS_FILE,
  BROADCAST_FILE,
  STALE_THRESHOLD_SECONDS,
  MAX_BROADCAST_MESSAGES,
  ensureDir,
  safeReadJSON,
  safeWriteJSON,
  formatTimeAgo,
} from "../utils.js";

// Session state storage
interface Session {
  id: string;
  client: string;
  lastSeen: number;
  pid?: string;
}

interface BroadcastMessage {
  timestamp: string;
  sessionId: string;
  client: string;
  message: string;
}

// Type guard functions for safe argument handling
function isBroadcastArgs(args: unknown): args is { message: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "message" in args &&
    typeof (args as { message: unknown }).message === "string"
  );
}

function isInboxArgs(args: unknown): args is { since?: string } {
  if (args === undefined || args === null) return true;
  if (typeof args !== "object") return false;
  const obj = args as { since?: unknown };
  return obj.since === undefined || typeof obj.since === "string";
}

function isRegisterArgs(args: unknown): args is { client: string; sessionId: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "client" in args &&
    "sessionId" in args &&
    typeof (args as { client: unknown }).client === "string" &&
    typeof (args as { sessionId: unknown }).sessionId === "string"
  );
}

// Input validation patterns
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidSessionId(id: string): boolean {
  return SAFE_ID_PATTERN.test(id);
}

function isValidClientName(name: string): boolean {
  return SAFE_ID_PATTERN.test(name);
}

// Tool definitions
export const sessionTools: Tool[] = [
  {
    name: "harness_session_list",
    description:
      "List all active Harness sessions across different AI clients (Claude Code, Codex, etc.)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "harness_session_broadcast",
    description:
      "Broadcast a message to all active sessions. Use this to notify other sessions about important changes (API modifications, schema updates, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message to broadcast to all sessions",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "harness_session_inbox",
    description:
      "Check inbox for messages from other sessions. Returns unread messages since last check.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO timestamp to get messages since (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "harness_session_register",
    description:
      "Register current session with the Harness MCP server. Call this when starting a new session.",
    inputSchema: {
      type: "object",
      properties: {
        client: {
          type: "string",
          description: "Client name (e.g., 'claude-code', 'codex', 'cursor')",
        },
        sessionId: {
          type: "string",
          description: "Unique session identifier",
        },
      },
      required: ["client", "sessionId"],
    },
  },
];

// Initialize sessions directory once at module load
// This avoids repeated fs.existsSync/mkdirSync calls in every function
let sessionsInitialized = false;
function initSessionsDir(): void {
  if (!sessionsInitialized) {
    ensureDir(SESSIONS_DIR);
    sessionsInitialized = true;
  }
}

// Helper functions using shared utilities
function loadSessions(): Record<string, Session> {
  initSessionsDir();
  return safeReadJSON<Record<string, Session>>(ACTIVE_SESSIONS_FILE, {});
}

function saveSessions(sessions: Record<string, Session>): void {
  initSessionsDir();
  safeWriteJSON(ACTIVE_SESSIONS_FILE, sessions);
}

/**
 * Load broadcasts from Markdown file (CLI-compatible format).
 * Format: ## TIMESTAMP [SESSION_ID]\nMESSAGE
 */
function loadBroadcasts(): BroadcastMessage[] {
  initSessionsDir();

  if (!fs.existsSync(BROADCAST_FILE)) {
    return [];
  }

  try {
    const content = fs.readFileSync(BROADCAST_FILE, "utf-8");
    const messages: BroadcastMessage[] = [];

    // Parse Markdown format: ## 2026-01-25T06:08:12Z [session-1769]\nMessage content
    const regex = /^## (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) \[([^\]]+)\]\n(.+?)(?=\n## |\n*$)/gms;
    let match;

    // Note: regex.exec is JavaScript's RegExp method, not child_process
    while ((match = regex.exec(content)) !== null) {
      messages.push({
        timestamp: match[1],
        sessionId: match[2],
        client: "cli", // CLI messages don't have client info
        message: match[3].trim(),
      });
    }

    return messages;
  } catch {
    return [];
  }
}

/**
 * Append a broadcast message to Markdown file (CLI-compatible format).
 * Uses deferred trimming to avoid blocking on large message counts.
 */
function appendBroadcast(msg: BroadcastMessage): void {
  initSessionsDir();

  const entry = `## ${msg.timestamp} [${msg.sessionId}]\n${msg.message}\n\n`;

  try {
    fs.appendFileSync(BROADCAST_FILE, entry);

    // Defer trimming to avoid blocking the main operation
    // This prevents slowdowns when message count exceeds MAX_BROADCAST_MESSAGES
    setImmediate(() => {
      try {
        const messages = loadBroadcasts();
        if (messages.length > MAX_BROADCAST_MESSAGES) {
          const trimmed = messages.slice(-MAX_BROADCAST_MESSAGES);
          const content = trimmed
            .map((m) => `## ${m.timestamp} [${m.sessionId}]\n${m.message}\n`)
            .join("\n");
          fs.writeFileSync(BROADCAST_FILE, content);
        }
      } catch (trimError) {
        console.error(`[harness-mcp] Failed to trim broadcasts: ${trimError}`);
      }
    });
  } catch (error) {
    console.error(`[harness-mcp] Failed to append broadcast: ${error}`);
  }
}

// Tool handlers
export async function handleSessionTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  switch (name) {
    case "harness_session_list":
      return handleListSessions();

    case "harness_session_broadcast":
      if (!isBroadcastArgs(args)) {
        return {
          content: [{ type: "text", text: "Error: invalid arguments for broadcast" }],
          isError: true,
        };
      }
      return handleBroadcast(args);

    case "harness_session_inbox":
      if (!isInboxArgs(args)) {
        return {
          content: [{ type: "text", text: "Error: invalid arguments for inbox" }],
          isError: true,
        };
      }
      return handleInbox(args ?? {});

    case "harness_session_register":
      if (!isRegisterArgs(args)) {
        return {
          content: [{ type: "text", text: "Error: invalid arguments for register" }],
          isError: true,
        };
      }
      return handleRegister(args);

    default:
      return {
        content: [{ type: "text", text: `Unknown session tool: ${name}` }],
        isError: true,
      };
  }
}

function handleListSessions(): {
  content: Array<{ type: string; text: string }>;
} {
  const sessions = loadSessions();
  const now = Date.now() / 1000;

  const activeSessions = Object.entries(sessions)
    .filter(([_, session]) => now - session.lastSeen < STALE_THRESHOLD_SECONDS)
    .map(([_id, session]) => {
      const age = Math.floor(now - session.lastSeen);
      return `- ${session.id.slice(0, 12)} (${session.client}) - ${formatTimeAgo(age)}`;
    });

  const text =
    activeSessions.length > 0
      ? `📋 Active Sessions:\n${activeSessions.join("\n")}`
      : "📋 No active sessions found";

  return { content: [{ type: "text", text }] };
}

function handleBroadcast(args: { message: string }): {
  content: Array<{ type: string; text: string }>;
} {
  const { message } = args;

  if (!message) {
    return {
      content: [{ type: "text", text: "Error: message is required" }],
      isError: true,
    } as { content: Array<{ type: string; text: string }>; isError: boolean };
  }

  const newMessage: BroadcastMessage = {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), // Remove milliseconds for CLI compatibility
    sessionId: process.env.HARNESS_SESSION_ID || "mcp-session",
    client: process.env.HARNESS_CLIENT || "mcp",
    message,
  };

  // Use appendBroadcast for Markdown format (CLI-compatible)
  appendBroadcast(newMessage);

  return {
    content: [
      {
        type: "text",
        text: `📤 Broadcast sent: "${message}"`,
      },
    ],
  };
}

/** Default inbox window: 1 hour in milliseconds */
const DEFAULT_INBOX_WINDOW_MS = 3600000;

function handleInbox(args: { since?: string }): {
  content: Array<{ type: string; text: string }>;
} {
  const broadcasts = loadBroadcasts();
  const since = args.since
    ? new Date(args.since).getTime()
    : Date.now() - DEFAULT_INBOX_WINDOW_MS;

  const unread = broadcasts.filter(
    (msg) => new Date(msg.timestamp).getTime() > since
  );

  if (unread.length === 0) {
    return { content: [{ type: "text", text: "📨 No new messages" }] };
  }

  const formatted = unread
    .map((msg) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      return `[${time}] ${msg.client}: ${msg.message}`;
    })
    .join("\n");

  return {
    content: [
      {
        type: "text",
        text: `📨 ${unread.length} message(s):\n${formatted}`,
      },
    ],
  };
}

function handleRegister(args: { client: string; sessionId: string }): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  const { client, sessionId } = args;

  if (!client || !sessionId) {
    return {
      content: [
        { type: "text", text: "Error: client and sessionId are required" },
      ],
      isError: true,
    };
  }

  // Validate session ID format to prevent injection attacks
  if (!isValidSessionId(sessionId)) {
    return {
      content: [
        { type: "text", text: "Error: sessionId must be alphanumeric with dashes/underscores (1-128 chars)" },
      ],
      isError: true,
    };
  }

  // Validate client name format
  if (!isValidClientName(client)) {
    return {
      content: [
        { type: "text", text: "Error: client must be alphanumeric with dashes/underscores (1-128 chars)" },
      ],
      isError: true,
    };
  }

  const sessions = loadSessions();
  sessions[sessionId] = {
    id: sessionId,
    client,
    lastSeen: Date.now() / 1000,
    pid: process.pid.toString(),
  };
  saveSessions(sessions);

  // Set environment for this process
  process.env.HARNESS_SESSION_ID = sessionId;
  process.env.HARNESS_CLIENT = client;

  return {
    content: [
      {
        type: "text",
        text: `✅ Session registered: ${sessionId} (${client})`,
      },
    ],
  };
}
