import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RELEASE_WORKFLOW_PATH = join(process.cwd(), ".github", "workflows", "release.yml");

describe("release workflow contract", () => {
  test("release workflow uses the same repository behavior gate as local maintainers", () => {
    const workflow = readFileSync(RELEASE_WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("name: Install release runner prerequisites");
    expect(workflow).toContain("sudo apt-get install -y jq ripgrep");
    expect(workflow).toContain("name: Install MCP server dependencies");
    expect(workflow).toContain("cd mcp-server");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run build --silent");
    expect(workflow).toContain("name: Restore multilingual-e5 cache");
    expect(workflow).toContain("actions/cache@v4");
    expect(workflow).toContain("name: Ensure release embedding model");
    expect(workflow).toContain("bash scripts/harness-mem model pull multilingual-e5 --yes");
    expect(workflow).toContain("name: Run repository behavior gate");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("name: Run memory server typecheck");
    expect(workflow).not.toContain("name: Run memory server quality gates");
    expect(workflow).not.toContain("cd memory-server\n          bun run test");
  });
});
