/**
 * Status Tools
 *
 * Project status and synchronization tools.
 */

import { type Tool } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import {
  ACTIVE_SESSIONS_FILE,
  BROADCAST_FILE,
  STALE_THRESHOLD_SECONDS,
  type PlansScopeArgs,
  resolvePlansTarget,
  safeReadJSON,
} from "../utils.js";

const PLANS_SCOPE_SCHEMA = {
  cwd: {
    type: "string",
    description:
      "Caller working directory used to locate the client project's Plans.md. Required unless project or plans_path is supplied.",
  },
  project: {
    type: "string",
    description:
      "Absolute filesystem project path for Plans.md operations. Required unless cwd or plans_path is supplied; short project keys are not accepted.",
  },
  plans_path: {
    type: "string",
    description:
      "Absolute path to a Plans.md file. Required unless cwd or project is supplied; must point to Plans.md.",
  },
} as const;

// Types for session and message data
interface SessionData {
  lastSeen: number;
  [key: string]: unknown;
}

interface BroadcastMessage {
  timestamp: string;
  [key: string]: unknown;
}

/** Default message window: 1 hour in milliseconds */
const MESSAGE_WINDOW_MS = 3600000;
const DONE_MARKER_PATTERN = /cc:(?:完了|[dD][oO][nN][eE])(?:\s|$|\[|\(|<|\|)/g;

// Tool definitions
export const statusTools: Tool[] = [
  {
    name: "harness_status",
    description:
      "Get current project status including Plans.md progress, active sessions, and recent activity",
    inputSchema: {
      type: "object",
      properties: {
        verbose: {
          type: "boolean",
          description: "Include detailed information",
        },
        ...PLANS_SCOPE_SCHEMA,
      },
      required: [],
    },
  },
];

// Helper functions using shared utilities
function getPlansStatus(plansPath: string): { todo: number; wip: number; done: number } | null {
  if (!fs.existsSync(plansPath)) {
    return null;
  }

  const content = fs.readFileSync(plansPath, "utf-8");
  return {
    todo: (content.match(/cc:TODO/g) || []).length,
    wip: (content.match(/cc:WIP/g) || []).length,
    done: (content.match(DONE_MARKER_PATTERN) || []).length,
  };
}

function getSessionCount(projectRoot: string): number {
  const sessions = safeReadJSON<Record<string, SessionData>>(
    path.join(projectRoot, ACTIVE_SESSIONS_FILE),
    {}
  );
  const now = Date.now() / 1000;

  return Object.values(sessions).filter(
    (s) => now - s.lastSeen < STALE_THRESHOLD_SECONDS
  ).length;
}

function getUnreadMessageCount(projectRoot: string): number {
  const messages = safeReadJSON<BroadcastMessage[]>(path.join(projectRoot, BROADCAST_FILE), []);
  const cutoff = Date.now() - MESSAGE_WINDOW_MS;

  return messages.filter(
    (m) => new Date(m.timestamp).getTime() > cutoff
  ).length;
}

function getHarnessVersion(projectRoot: string): string | null {
  const versionFile = path.join(projectRoot, ".claude-code-harness-version");
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, "utf-8").trim();
  }
  return null;
}

// SSOT files to check for project health
const SSOT_FILES = [
  ".claude/memory/decisions.md",
  ".claude/memory/patterns.md",
  "AGENTS.md",
  "CLAUDE.md",
] as const;

// Tool handlers
export async function handleStatusTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  switch (name) {
    case "harness_status":
      return handleStatus(args as ({ verbose?: boolean } & PlansScopeArgs) | undefined);

    default:
      return {
        content: [{ type: "text", text: `Unknown status tool: ${name}` }],
        isError: true,
      };
  }
}

function handleStatus(args: ({ verbose?: boolean } & PlansScopeArgs) | undefined): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  const { verbose = false } = args ?? {};

  const resolved = resolvePlansTarget(args);
  if (!resolved.ok) {
    return {
      content: [{ type: "text", text: resolved.message }],
      isError: true,
    };
  }

  const { projectRoot, plansPath } = resolved.target;
  const plansStatus = getPlansStatus(plansPath);
  const sessionCount = getSessionCount(projectRoot);
  const unreadCount = getUnreadMessageCount(projectRoot);
  const harnessVersion = getHarnessVersion(projectRoot);

  let status = `📊 **Harness Status**\n\n`;

  // Project info
  status += `📁 Project: ${path.basename(projectRoot)}\n`;
  if (harnessVersion) {
    status += `🔧 Harness: v${harnessVersion}\n`;
  }
  status += `\n`;

  // Plans status
  if (plansStatus) {
    const total = plansStatus.todo + plansStatus.wip + plansStatus.done;
    const progress =
      total > 0 ? Math.round((plansStatus.done / total) * 100) : 0;

    status += `📋 **Plans.md**\n`;
    status += `├─ TODO: ${plansStatus.todo}\n`;
    status += `├─ WIP: ${plansStatus.wip}\n`;
    status += `├─ Done: ${plansStatus.done}\n`;
    status += `└─ Progress: ${progress}%\n\n`;
  } else {
    status += `📋 Plans.md: Not found\n\n`;
  }

  // Session info
  status += `👥 **Sessions**\n`;
  status += `├─ Active: ${sessionCount}\n`;
  status += `└─ Unread messages: ${unreadCount}\n\n`;

  // Verbose info
  if (verbose) {
    status += `📍 **Project Root**: ${projectRoot}\n`;

    status += `\n📄 **SSOT Files**:\n`;
    for (const file of SSOT_FILES) {
      const exists = fs.existsSync(path.join(projectRoot, file));
      status += `${exists ? "✅" : "❌"} ${file}\n`;
    }
  }

  // Next action suggestion
  status += `\n💡 **Suggested Action**: `;
  if (!plansStatus) {
    status += `Use harness_workflow_plan with the same cwd/project/plans_path to create a plan`;
  } else if (plansStatus.todo > 0) {
    status += `Use harness_workflow_work with the same cwd/project/plans_path to implement ${plansStatus.todo} pending task(s)`;
  } else if (plansStatus.wip > 0) {
    status += `Continue working on ${plansStatus.wip} in-progress task(s)`;
  } else {
    status += `All tasks complete! Use harness_workflow_review to review changes`;
  }

  return {
    content: [{ type: "text", text: status }],
  };
}
