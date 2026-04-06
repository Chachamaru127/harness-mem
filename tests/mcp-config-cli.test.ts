import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  buildCodexManagedBlock,
  resolveServerSpec,
  runMcpConfigCli,
} = require("../scripts/lib/mcp-config");

describe("mcp-config CLI", () => {
  test("builds Codex config with absolute MCP entry path (no cwd)", () => {
    const spec = resolveServerSpec({
      platform: "win32",
      homeDir: "C:\\Users\\alice",
      harnessRoot: "C:\\repo\\harness-mem",
      env: {},
    });

    const block = buildCodexManagedBlock(spec);

    // Args should be absolute path, no cwd field
    expect(block).toContain('args = ["C:\\\\repo\\\\harness-mem\\\\mcp-server\\\\dist\\\\index.js"]');
    expect(block).not.toContain("cwd =");
    expect(block).toContain("NODE_PATH =");
  });

  test("writes Claude and Codex config files when --write is passed", () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-config-"));

    try {
      const chunks: string[] = [];
      const code = runMcpConfigCli({
        argv: ["--write", "--client", "claude,codex", "--home", tmpHome],
        env: {
          ...process.env,
          HARNESS_MEM_HOST: "127.0.0.1",
          HARNESS_MEM_PORT: "37888",
        },
        stdout: { write: (chunk: string) => void chunks.push(chunk) },
      });

      expect(code).toBe(0);

      const codexConfig = readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8");
      const claudeConfig = JSON.parse(
        readFileSync(join(tmpHome, ".claude.json"), "utf8")
      ) as {
        mcpServers: { harness: { args: string[]; cwd: string } };
      };

      // Args should contain absolute path to mcp-server/dist/index.js
      expect(codexConfig).toContain("mcp-server/dist/index.js");
      expect(codexConfig).not.toContain('cwd = "');
      expect(claudeConfig.mcpServers.harness.args[0]).toContain("mcp-server/dist/index.js");
      expect(claudeConfig.mcpServers.harness.args[0]).toMatch(/^\//); // absolute path
      expect(claudeConfig.mcpServers.harness.cwd).toBeUndefined();
      expect(chunks.join("")).toContain("[ok] codex:");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
