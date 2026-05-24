import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RELEASE_WORKFLOW_PATH = join(process.cwd(), ".github", "workflows", "release.yml");

describe("release workflow contract", () => {
  test("release workflow uses the same repository behavior gate as local maintainers", () => {
    const workflow = readFileSync(RELEASE_WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("package-install-smoke:");
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"');
    expect(workflow).toContain("actions/checkout@v5");
    expect(workflow).toContain("actions/setup-node@v5");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("actions/cache@v5");
    expect(workflow).toContain("actions/setup-go@v6");
    expect(workflow).toContain("cache-dependency-path: mcp-server-go/go.sum");
    expect(workflow).toContain("actions/upload-artifact@v6");
    expect(workflow).toContain("actions/download-artifact@v6");
    expect(workflow).toContain("softprops/action-gh-release@v3");
    expect(workflow).not.toContain("actions/checkout@v4");
    expect(workflow).not.toContain("actions/setup-node@v4");
    expect(workflow).not.toContain("actions/cache@v4");
    expect(workflow).not.toContain("actions/setup-go@v5");
    expect(workflow).not.toContain("actions/upload-artifact@v4");
    expect(workflow).not.toContain("actions/download-artifact@v4");
    expect(workflow).not.toContain("softprops/action-gh-release@v2");
    expect(workflow).toContain("os: macos-latest");
    expect(workflow).toContain("os: windows-latest");
    expect(workflow).toContain("npm exec -- harness-mem smoke --project");
    expect(workflow).toContain("needs: [package-install-smoke]");
    expect(workflow).toContain("name: Install release runner prerequisites");
    expect(workflow).toContain("sudo apt-get install -y jq ripgrep");
    expect(workflow).toContain("name: Install MCP server dependencies");
    expect(workflow).toContain("cd mcp-server");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run build --silent");
    expect(workflow).toContain("name: Restore multilingual-e5 cache");
    expect(workflow).toContain("actions/cache@v5");
    expect(workflow).toContain("name: Ensure release embedding model");
    expect(workflow).toContain("bash scripts/harness-mem model pull multilingual-e5 --yes");
    expect(workflow).toContain("name: Run repository behavior gate");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("name: Run memory server typecheck");
    expect(workflow).toContain("name: Recall Runtime release gate (§S128-013)");
    expect(workflow).toContain("npm run benchmark:recall-runtime");
    expect(workflow).toContain("go-native-smoke:");
    expect(workflow).toContain("name: Go MCP native smoke (${{ matrix.label }})");
    expect(workflow).toContain("needs: [publish-npm, go-build, go-native-smoke]");
    expect(workflow).not.toContain("name: Run memory server quality gates");
    expect(workflow).not.toContain("cd memory-server\n          bun run test");
  });
});
