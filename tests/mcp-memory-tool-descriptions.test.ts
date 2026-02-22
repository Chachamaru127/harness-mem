import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOOL_FILE = join(process.cwd(), "mcp-server", "src", "tools", "memory.ts");

describe("MCP memory tool descriptions", () => {
  test("documents 3-layer workflow guidance in tool descriptions", () => {
    const source = readFileSync(TOOL_FILE, "utf8");

    expect(source).toContain("3-layer workflow");
    expect(source).toContain("search");
    expect(source).toContain("timeline");
    expect(source).toContain("get_observations");
    expect(source).toContain("token_estimate");
  });
});
