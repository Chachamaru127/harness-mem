import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleStatusTool } from "../mcp-server/src/tools/status";

const root = process.cwd();
const doneMarkerPatternSource = "cc:(?:完了|[dD][oO][nN][eE])(?:\\s|$|\\[|\\(|<|\\|)";

describe("harness_status completion marker contract", () => {
  test("Go and TypeScript status tools count the canonical cc:完了 marker", () => {
    const goStatus = readFileSync(
      join(root, "mcp-server-go", "internal", "tools", "status.go"),
      "utf8"
    );
    const tsStatus = readFileSync(
      join(root, "mcp-server", "src", "tools", "status.ts"),
      "utf8"
    );
    const bundledStatus = readFileSync(
      join(root, "mcp-server", "dist", "index.js"),
      "utf8"
    );

    for (const source of [goStatus, tsStatus, bundledStatus]) {
      expect(source).toContain(doneMarkerPatternSource);
      expect(source).not.toContain("cc:DONE`)");
      expect(source).not.toContain("/cc:DONE/g");
    }
  });

  test("workflow guidance tells agents to close Plans rows with cc:完了", () => {
    const goWorkflow = readFileSync(
      join(root, "mcp-server-go", "internal", "tools", "workflow.go"),
      "utf8"
    );
    const tsWorkflow = readFileSync(
      join(root, "mcp-server", "src", "tools", "workflow.ts"),
      "utf8"
    );

    for (const source of [goWorkflow, tsWorkflow]) {
      expect(source).toContain("Mark as cc:完了");
      expect(source).not.toContain("Mark as cc:DONE");
    }
  });

  test("bundled MCP workflow/status tools include explicit Plans scope guard", () => {
    const bundled = readFileSync(join(root, "mcp-server", "dist", "index.js"), "utf8");

    expect(bundled).toContain("scope_required: pass cwd");
    expect(bundled).toContain("project must be an absolute filesystem path");
    expect(bundled).toContain("Plans.md file operations do not use the MCP server cwd");
  });

  test("TypeScript harness_status reports canonical and legacy done markers", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hmem-status-marker-"));
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    writeFileSync(
      join(tmp, "Plans.md"),
      [
        "| Task | Status |",
        "|------|--------|",
        "| A | cc:TODO |",
        "| B | cc:WIP |",
        "| C | cc:完了 [abc1234] |",
        "| D | cc:DONE |",
        "| E | cc:done |",
        "| F | cc:DONEFUL |",
      ].join("\n")
    );

    const previousCwd = process.cwd();
    try {
      process.chdir(tmp);
      const result = await handleStatusTool("harness_status", { cwd: tmp });
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("TODO: 1");
      expect(text).toContain("WIP: 1");
      expect(text).toContain("Done: 3");
      expect(text).toContain("Progress: 60%");
    } finally {
      process.chdir(previousCwd);
    }
  });
});
