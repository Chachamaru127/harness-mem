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

  test("builds HTTP MCP config without expanding token secrets", () => {
    const spec = resolveServerSpec({
      transport: "http",
      env: {
        HARNESS_MEM_MCP_TOKEN: "super-secret-token",
      },
      addr: "127.0.0.1:37889",
    });

    const serializedSpec = JSON.stringify(spec);
    const codexBlock = buildCodexManagedBlock(spec);

    expect(spec.transport).toBe("http");
    expect(spec.url).toBe("http://127.0.0.1:37889/mcp");
    expect(spec.bearerTokenEnvVar).toBe("HARNESS_MEM_MCP_TOKEN");
    expect(serializedSpec).toContain("Bearer ${HARNESS_MEM_MCP_TOKEN}");
    expect(serializedSpec).not.toContain("super-secret-token");
    expect(codexBlock).toContain('url = "http://127.0.0.1:37889/mcp"');
    expect(codexBlock).toContain('bearer_token_env_var = "HARNESS_MEM_MCP_TOKEN"');
    expect(codexBlock).not.toContain("command =");
  });

  test("writes HTTP Claude, Codex, and Hermes config files when explicitly requested", () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-config-http-"));

    try {
      const chunks: string[] = [];
      const code = runMcpConfigCli({
        argv: [
          "--write",
          "--client",
          "claude,codex,hermes",
          "--transport",
          "http",
          "--home",
          tmpHome,
        ],
        env: {
          ...process.env,
          HARNESS_MEM_MCP_TOKEN: "super-secret-token",
        },
        stdout: { write: (chunk: string) => void chunks.push(chunk) },
      });

      expect(code).toBe(0);

      const codexConfig = readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8");
      const claudeConfig = JSON.parse(readFileSync(join(tmpHome, ".claude.json"), "utf8")) as {
        mcpServers: {
          harness: {
            type: string;
            url: string;
            headers: { Authorization: string };
            command?: string;
            args?: string[];
            env?: Record<string, string>;
          };
        };
      };
      const hermesConfig = readFileSync(join(tmpHome, ".hermes", "config.yaml"), "utf8");
      const combined = [codexConfig, JSON.stringify(claudeConfig), hermesConfig].join("\n");

      expect(codexConfig).toContain('url = "http://127.0.0.1:37889/mcp"');
      expect(codexConfig).toContain('bearer_token_env_var = "HARNESS_MEM_MCP_TOKEN"');
      expect(codexConfig).not.toContain("command =");

      expect(claudeConfig.mcpServers.harness.type).toBe("http");
      expect(claudeConfig.mcpServers.harness.url).toBe("http://127.0.0.1:37889/mcp");
      expect(claudeConfig.mcpServers.harness.headers.Authorization).toBe(
        "Bearer ${HARNESS_MEM_MCP_TOKEN}"
      );
      expect(claudeConfig.mcpServers.harness.command).toBeUndefined();
      expect(claudeConfig.mcpServers.harness.args).toBeUndefined();
      expect(claudeConfig.mcpServers.harness.env).toBeUndefined();

      expect(hermesConfig).toContain('url: "http://127.0.0.1:37889/mcp"');
      expect(hermesConfig).toContain('Authorization: "Bearer ${HARNESS_MEM_MCP_TOKEN}"');
      expect(hermesConfig).toContain("- harness_mem_search");
      expect(hermesConfig).toContain("- harness_mem_record_checkpoint");
      expect(combined).not.toContain("super-secret-token");
      expect(chunks.join("")).toContain("[ok] hermes:");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("--client all keeps Hermes as an explicit opt-in target", () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-config-all-"));

    try {
      const chunks: string[] = [];
      const code = runMcpConfigCli({
        argv: ["--client", "all", "--transport", "http", "--home", tmpHome, "--json"],
        env: process.env,
        stdout: { write: (chunk: string) => void chunks.push(chunk) },
      });

      expect(code).toBe(0);
      const payload = JSON.parse(chunks.join("")) as {
        results: Array<{ client: string }>;
      };
      expect(payload.results.map((result) => result.client)).toEqual(["claude", "codex"]);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
