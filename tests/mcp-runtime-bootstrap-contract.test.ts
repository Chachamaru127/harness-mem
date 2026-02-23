import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("MCP runtime bootstrap contract", () => {
  test("ensure_mcp_runtime bootstraps dist when missing", () => {
    const script = readFileSync(join(process.cwd(), "scripts/harness-mem"), "utf8");

    expect(script).toContain("ensure_mcp_runtime()");
    expect(script).toContain("MCP dist entry missing. Bootstrapping local MCP build.");
    expect(script).toContain("npm install --silent --include=dev");
    expect(script).toContain("npm run build --silent");
    expect(script).toContain("MCP dist build failed:");
  });
});
