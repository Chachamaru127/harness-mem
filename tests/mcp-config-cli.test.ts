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
  test("builds Codex config with cwd + relative MCP entry", () => {
    const spec = resolveServerSpec({
      platform: "win32",
      homeDir: "C:\\Users\\alice",
      harnessRoot: "C:\\repo\\harness-mem",
      env: {},
    });

    const block = buildCodexManagedBlock(spec);

    expect(block).toContain('args = ["mcp-server\\\\dist\\\\index.js"]');
    expect(block).toContain('cwd = "C:\\\\repo\\\\harness-mem"');
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

      expect(codexConfig).toContain('args = ["mcp-server/dist/index.js"]');
      expect(codexConfig).toContain('cwd = "');
      expect(claudeConfig.mcpServers.harness.args).toEqual(["mcp-server/dist/index.js"]);
      expect(claudeConfig.mcpServers.harness.cwd).toContain("harness-mem");
      expect(chunks.join("")).toContain("[ok] codex:");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
