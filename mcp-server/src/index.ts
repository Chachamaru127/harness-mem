/**
 * Harness MCP Server
 *
 * Enables cross-client session communication for harness-mem.
 * Supports Claude Code, Codex, and other MCP-compatible clients.
 *
 * Usage:
 *   npx harness-mcp-server
 *   node dist/index.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { sessionTools, handleSessionTool } from "./tools/session.js";
import { workflowTools, handleWorkflowTool } from "./tools/workflow.js";
import { statusTools, handleStatusTool } from "./tools/status.js";
import {
  codeIntelligenceTools,
  handleCodeIntelligenceTool,
} from "./tools/code-intelligence.js";
import { memoryTools, handleMemoryTool } from "./tools/memory.js";
import {
  contextBoxTools,
  handleContextBoxTool,
} from "./tools/context-box.js";
import { injectAuthFromEnvironment } from "./auth-inject.js";

// Channel push support (CC v2.1.80+ --channels flag, research preview)
const channelsEnabled = process.env.HARNESS_MEM_ENABLE_CHANNELS === "true";

// Server instance
const server = new Server(
  {
    name: "harness-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      ...(channelsEnabled ? { logging: {} } : {}),
    },
  }
);

/**
 * Send a proactive memory notification via MCP channels.
 * Only active when HARNESS_MEM_ENABLE_CHANNELS=true and --channels flag is used.
 * This is a research preview feature (CC v2.1.80+).
 */
export async function pushMemoryNotification(message: string): Promise<void> {
  if (!channelsEnabled) return;
  try {
    await server.notification({
      method: "notifications/message",
      params: { level: "info", data: message },
    });
  } catch {
    // Silently ignore — channels may not be active on client side
  }
}

// Combine all tools
const allTools: Tool[] = [
  ...sessionTools,
  ...workflowTools,
  ...statusTools,
  ...codeIntelligenceTools,
  ...memoryTools,
  ...contextBoxTools,
];

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allTools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Route to appropriate handler
    if (name.startsWith("harness_session_")) {
      return await handleSessionTool(name, args);
    }

    if (name.startsWith("harness_workflow_")) {
      return await handleWorkflowTool(name, args);
    }

    if (name.startsWith("harness_status")) {
      return await handleStatusTool(name, args);
    }

    if (name.startsWith("harness_ast_") || name.startsWith("harness_lsp_")) {
      return await handleCodeIntelligenceTool(name, args);
    }

    if (name.startsWith("harness_mem_")) {
      return await handleMemoryTool(name, args);
    }

    if (name.startsWith("harness_cb_")) {
      return await handleContextBoxTool(name, args);
    }

    return {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}`,
        },
      ],
      isError: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  // 認証情報を自動注入（HARNESS_MEM_USER_ID / HARNESS_MEM_TEAM_ID）
  const identity = injectAuthFromEnvironment();
  console.error(`Harness MCP Server started (user_id=${identity.user_id}, team_id=${identity.team_id})`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
