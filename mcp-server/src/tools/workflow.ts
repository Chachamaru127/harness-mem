/**
 * Workflow Tools
 *
 * Core Harness workflow operations accessible via MCP.
 * Enables Plan → Work → Review cycle from any MCP client.
 */

import { type Tool } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import {
  getRecentChangesAsync,
  type PlansScopeArgs,
  resolvePlansTarget,
} from "../utils.js";

type WorkflowResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

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

// Tool definitions
export const workflowTools: Tool[] = [
  {
    name: "harness_workflow_plan",
    description:
      "Create an implementation plan for a task. Generates structured tasks in Plans.md",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Description of what you want to build or implement",
        },
        mode: {
          type: "string",
          enum: ["quick", "detailed"],
          description: "Planning mode: quick (minimal) or detailed (comprehensive)",
        },
        ...PLANS_SCOPE_SCHEMA,
      },
      required: ["task"],
    },
  },
  {
    name: "harness_workflow_work",
    description:
      "Execute tasks from Plans.md. Implements tasks marked as cc:TODO",
    inputSchema: {
      type: "object",
      properties: {
        parallel: {
          type: "number",
          description: "Number of parallel workers (1-5)",
        },
        full: {
          type: "boolean",
          description: "Run full cycle: implement → self-review → fix → commit",
        },
        taskId: {
          type: "string",
          description: "Specific task ID to work on (optional)",
        },
        ...PLANS_SCOPE_SCHEMA,
      },
      required: [],
    },
  },
  {
    name: "harness_workflow_review",
    description:
      "Run multi-perspective code review. 8 expert reviewers analyze your code in parallel",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description: "Specific files to review (optional, defaults to recent changes)",
        },
        focus: {
          type: "array",
          items: { type: "string" },
          description: "Review focus areas: security, performance, accessibility, etc.",
        },
        ci: {
          type: "boolean",
          description: "CI mode: output machine-readable results",
        },
      },
      required: [],
    },
  },
];

// Helper functions using shared utilities
function readPlans(args: PlansScopeArgs | undefined): { content: string | null; plansPath: string } | WorkflowResult {
  const resolved = resolvePlansTarget(args);
  if (!resolved.ok) {
    return {
      content: [{ type: "text", text: resolved.message }],
      isError: true,
    };
  }
  const { plansPath } = resolved.target;
  if (fs.existsSync(plansPath)) {
    return { content: fs.readFileSync(plansPath, "utf-8"), plansPath };
  }
  return { content: null, plansPath };
}

/**
 * Generate a plan template for the given task
 */
function generatePlanTemplate(task: string, mode: string): string {
  return `
## Plan: ${task}

### Tasks

- [ ] **Task 1**: Analyze requirements <!-- cc:TODO -->
- [ ] **Task 2**: Implement core functionality <!-- cc:TODO -->
- [ ] **Task 3**: Add tests <!-- cc:TODO -->
- [ ] **Task 4**: Documentation <!-- cc:TODO -->

### Notes

- Created via MCP: harness_workflow_plan
- Mode: ${mode}
- Created at: ${new Date().toISOString()}

---

💡 **Next Step**: Use \`harness_workflow_work\` to start implementation
`;
}

// Review perspectives configuration
const REVIEW_PERSPECTIVES = [
  { name: "Security", emoji: "🔒", focus: "vulnerabilities, auth, injection" },
  { name: "Performance", emoji: "⚡", focus: "bottlenecks, memory, complexity" },
  { name: "Accessibility", emoji: "♿", focus: "WCAG, screen readers, keyboard" },
  { name: "Maintainability", emoji: "🧹", focus: "readability, coupling, DRY" },
  { name: "Testing", emoji: "🧪", focus: "coverage, edge cases, mocking" },
  { name: "Error Handling", emoji: "⚠️", focus: "exceptions, validation, recovery" },
  { name: "Documentation", emoji: "📚", focus: "comments, README, API docs" },
  { name: "Best Practices", emoji: "✨", focus: "patterns, conventions, idioms" },
] as const;

// Tool handlers
export async function handleWorkflowTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<WorkflowResult> {
  switch (name) {
    case "harness_workflow_plan":
      return handlePlan(args as unknown as ({ task?: string; mode?: string } & PlansScopeArgs) | undefined);

    case "harness_workflow_work":
      return handleWork(
        args as ({ parallel?: number; full?: boolean; taskId?: string } & PlansScopeArgs) | undefined
      );

    case "harness_workflow_review":
      return await handleReview(
        args as { files?: string[]; focus?: string[]; ci?: boolean }
      );

    default:
      return {
        content: [{ type: "text", text: `Unknown workflow tool: ${name}` }],
        isError: true,
      };
  }
}

function handlePlan(args: ({ task?: string; mode?: string } & PlansScopeArgs) | undefined): WorkflowResult {
  const resolved = resolvePlansTarget(args);
  if (!resolved.ok) {
    return {
      content: [{ type: "text", text: resolved.message }],
      isError: true,
    };
  }

  const task = args?.task ?? "";
  const mode = args?.mode ?? "quick";

  if (!task) {
    return {
      content: [{ type: "text", text: "Error: task description is required" }],
      isError: true,
    } as { content: Array<{ type: string; text: string }>; isError: boolean };
  }

  // Generate plan using template function
  const planTemplate = generatePlanTemplate(task, mode);

  // Append to Plans.md
  const { plansPath } = resolved.target;
  const existingContent = fs.existsSync(plansPath)
    ? fs.readFileSync(plansPath, "utf-8")
    : "# Plans\n\n";

  fs.writeFileSync(plansPath, existingContent + planTemplate);

  return {
    content: [
      {
        type: "text",
        text: `📋 Plan created for: "${task}"\n\nPlans.md: ${plansPath}\n\nTasks added to Plans.md:\n- Task 1: Analyze requirements\n- Task 2: Implement core functionality\n- Task 3: Add tests\n- Task 4: Documentation\n\n💡 Run harness_workflow_work with the same cwd/project/plans_path to start implementation`,
      },
    ],
  };
}

function handleWork(args: ({
  parallel?: number;
  full?: boolean;
  taskId?: string;
} & PlansScopeArgs) | undefined): WorkflowResult {
  const { parallel = 1, full = false, taskId } = args ?? {};

  const plansResult = readPlans(args);
  if ("isError" in plansResult && plansResult.isError) {
    return plansResult;
  }
  const { content: plans, plansPath } = plansResult as { content: string | null; plansPath: string };
  if (!plans) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Plans.md not found at ${plansPath}. Use harness_workflow_plan with the same cwd/project/plans_path to create a plan first.`,
        },
      ],
    };
  }

  // Count TODO tasks
  const todoCount = (plans.match(/cc:TODO/g) || []).length;
  const wipCount = (plans.match(/cc:WIP/g) || []).length;

  if (todoCount === 0 && wipCount === 0) {
    return {
      content: [
        {
          type: "text",
          text: "✅ No pending tasks in Plans.md. All done!",
        },
      ],
    };
  }

  // Return work instructions
  const workMode = full ? "full cycle (implement → review → fix → commit)" : "implementation only";
  const parallelInfo = parallel > 1 ? `with ${parallel} parallel workers` : "sequentially";

  return {
    content: [
      {
        type: "text",
        text: `🔧 Work Mode: ${workMode} ${parallelInfo}

📁 Plans.md: ${plansPath}

📊 Task Status:
- TODO: ${todoCount}
- WIP: ${wipCount}

${taskId ? `🎯 Targeting task: ${taskId}` : "🎯 Will process next available task"}

⚡ To execute, the AI client should:
1. Read Plans.md to find cc:TODO tasks
2. Mark task as cc:WIP
3. Implement the task
4. ${full ? "Self-review and fix issues" : "Mark as cc:完了"}
5. ${full ? "Commit changes" : ""}

💡 This tool provides work instructions. The actual implementation
   should be performed by the AI client using its native capabilities.`,
      },
    ],
  };
}

async function handleReview(args: {
  files?: string[];
  focus?: string[];
  ci?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { files, focus = [], ci = false } = args;

  // Get files to review (now async)
  const targetFiles = files || (await getRecentChangesAsync());

  if (targetFiles.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "❌ No files to review. Specify files or make some changes first.",
        },
      ],
    };
  }

  const activePerps =
    focus.length > 0
      ? REVIEW_PERSPECTIVES.filter((p) =>
          focus.some((f) => p.name.toLowerCase().includes(f.toLowerCase()))
        )
      : REVIEW_PERSPECTIVES;

  const reviewInstructions = activePerps
    .map((p) => `${p.emoji} **${p.name}**: Check for ${p.focus}`)
    .join("\n");

  const output = ci
    ? JSON.stringify({
        files: targetFiles,
        perspectives: activePerps.map((p) => p.name),
        status: "pending",
      })
    : `🔍 **Harness Code Review**

📁 Files to review (${targetFiles.length}):
${targetFiles.map((f) => `- ${f}`).join("\n")}

👥 Review Perspectives (${activePerps.length}):
${reviewInstructions}

⚡ To execute review, the AI client should:
1. Read each file listed above
2. Analyze from each perspective
3. Generate findings with severity (critical/warning/info)
4. Provide actionable recommendations

💡 This tool provides review instructions. The actual review
   should be performed by the AI client using its native capabilities.`;

  return {
    content: [{ type: "text", text: output }],
  };
}
