import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOOL_FILE = join(process.cwd(), "mcp-server", "src", "tools", "memory.ts");
const GO_TOOL_FILE = join(process.cwd(), "mcp-server-go", "internal", "tools", "memory.go");
const DIST_FILE = join(process.cwd(), "mcp-server", "dist", "index.js");

describe("MCP memory tool descriptions", () => {
  test("documents 3-layer workflow guidance in tool descriptions", () => {
    const source = readFileSync(TOOL_FILE, "utf8");

    expect(source).toContain("3-layer workflow");
    expect(source).toContain("search");
    expect(source).toContain("timeline");
    expect(source).toContain("get_observations");
    expect(source).toContain("token_estimate");
  });

  test("keeps destructive memory lifecycle admin actions off the MCP tool surface", () => {
    const source = readFileSync(TOOL_FILE, "utf8");

    expect(source).toContain("harness_mem_admin_forget_plan");
    expect(source).not.toContain("harness_mem_admin_hard_purge");
    expect(source).not.toContain("harness_mem_admin_backup_evidence");
    expect(source).not.toContain("/v1/admin/forget/hard-purge");
    expect(source).not.toContain("/v1/admin/forget/backup-evidence");
  });

  test("keeps hard purge and backup evidence off Go and dist MCP surfaces", () => {
    for (const file of [GO_TOOL_FILE, DIST_FILE]) {
      const source = readFileSync(file, "utf8");

      expect(source).not.toContain("harness_mem_admin_hard_purge");
      expect(source).not.toContain("harness_mem_admin_backup_evidence");
      expect(source).not.toContain("/v1/admin/forget/hard-purge");
      expect(source).not.toContain("/v1/admin/forget/backup-evidence");
    }
  });
});
