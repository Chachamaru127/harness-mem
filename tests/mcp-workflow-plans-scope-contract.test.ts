import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleStatusTool } from "../mcp-server/src/tools/status";
import { handleWorkflowTool } from "../mcp-server/src/tools/workflow";

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, ".claude"), { recursive: true });
  return root;
}

describe("MCP workflow Plans.md scope contract", () => {
  test("harness_workflow_plan requires explicit scope and does not write server cwd", async () => {
    const serverRoot = makeRoot("hmem-server-root-");
    const serverPlans = join(serverRoot, "Plans.md");
    const original = "# Server Plans\n\n";
    writeFileSync(serverPlans, original);

    const previousCwd = process.cwd();
    try {
      process.chdir(serverRoot);
      const result = await handleWorkflowTool("harness_workflow_plan", {
        task: "must-not-write",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("scope_required");
      expect(readFileSync(serverPlans, "utf8")).toBe(original);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("harness_workflow_plan writes to explicit client cwd", async () => {
    const serverRoot = makeRoot("hmem-server-root-");
    const clientRoot = makeRoot("hmem-client-root-");
    const serverPlans = join(serverRoot, "Plans.md");
    writeFileSync(serverPlans, "# Server Plans\n\n");

    const previousCwd = process.cwd();
    try {
      process.chdir(serverRoot);
      const result = await handleWorkflowTool("harness_workflow_plan", {
        task: "client-task",
        cwd: clientRoot,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toContain(join(clientRoot, "Plans.md"));
      expect(readFileSync(join(clientRoot, "Plans.md"), "utf8")).toContain("client-task");
      expect(readFileSync(serverPlans, "utf8")).not.toContain("client-task");
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("harness_workflow_work and harness_status read explicit client cwd", async () => {
    const serverRoot = makeRoot("hmem-server-root-");
    const clientRoot = makeRoot("hmem-client-root-");
    writeFileSync(join(serverRoot, "Plans.md"), "# Server Plans\n\n");
    writeFileSync(join(clientRoot, "Plans.md"), "# Plans\n\n- client task <!-- cc:TODO -->\n");

    const previousCwd = process.cwd();
    try {
      process.chdir(serverRoot);
      const work = await handleWorkflowTool("harness_workflow_work", { cwd: clientRoot });
      const status = await handleStatusTool("harness_status", { cwd: clientRoot });

      expect(work.isError).toBeFalsy();
      expect(work.content[0]?.text).toContain("TODO: 1");
      expect(work.content[0]?.text).toContain(join(clientRoot, "Plans.md"));
      expect(status.isError).toBeFalsy();
      expect(status.content[0]?.text).toContain("TODO: 1");
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("short project keys are rejected for file-backed Plans.md operations", async () => {
    const result = await handleWorkflowTool("harness_workflow_plan", {
      task: "x",
      project: "harness-mem",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("project must be an absolute filesystem path");
  });

  test("plans_path cannot escape explicit cwd root", async () => {
    const root = makeRoot("hmem-client-root-");
    const outside = makeRoot("hmem-outside-root-");
    const result = await handleWorkflowTool("harness_workflow_plan", {
      task: "x",
      cwd: root,
      plans_path: join(outside, "Plans.md"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("plans_path must stay within");
    expect(existsSync(join(outside, "Plans.md"))).toBe(false);
  });

  test("Plans.md symlink cannot escape explicit cwd root", async () => {
    const root = makeRoot("hmem-client-root-");
    const outside = makeRoot("hmem-outside-root-");
    const outsidePlans = join(outside, "Plans.md");
    writeFileSync(outsidePlans, "# Outside Plans\n\n");
    symlinkSync(outsidePlans, join(root, "Plans.md"));

    const result = await handleWorkflowTool("harness_workflow_plan", {
      task: "x",
      cwd: root,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Plans.md realpath must stay within");
    expect(readFileSync(outsidePlans, "utf8")).not.toContain("x");
  });
});
