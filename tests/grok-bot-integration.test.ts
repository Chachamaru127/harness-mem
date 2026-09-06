import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..");
const {
  grokBotConfigPath, checkGrokBotConfig, removeGrokBotConfig, runMcpConfigCli,
  resolveServerSpec, writeGrokBotConfig, buildGrokBotHarnessConfig,
} = require("../scripts/lib/mcp-config");

function withHome(fn: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), "hmem-grok-bot-"));
  try { fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

function cli(home: string, args: string[]) {
  let output = "";
  const code = runMcpConfigCli({
    argv: ["--home", home, ...args],
    env: { HARNESS_MEM_MCP_TOKEN: "test-secret-not-for-config" },
    stdout: { write: (s: string) => { output += s; } },
    stderr: { write: (s: string) => { output += s; } },
  });
  return { code, output };
}

// Load real shell functions without invoking main or provisioning a runtime.
function shell(home: string, commands: string) {
  const library = join(home, "harness-mem-functions.sh");
  writeFileSync(library, readFileSync(join(ROOT, "scripts/harness-mem"), "utf8").replace(/main "\$@"\s*$/, ""));
  return spawnSync("bash", ["-c", `
    source "$2"
    HARNESS_ROOT="$1"
    ${commands}
  `, "grok-test", ROOT, library], {
    cwd: home, env: { PATH: process.env.PATH, HOME: home, HARNESS_MEM_LANG: "en" },
    encoding: "utf8", timeout: 20000,
  });
}

describe("Grok Bot Tier 3 MCP", () => {
  test("preview and all do not install the optional client", () => withHome((home) => {
    expect(cli(home, ["--client", "grok-bot"]).output).toContain("Grok Bot snippet");
    expect(existsSync(grokBotConfigPath({ homeDir: home }))).toBe(false);
    expect(cli(home, ["--client", "all", "--write"]).code).toBe(0);
    expect(existsSync(grokBotConfigPath({ homeDir: home }))).toBe(false);
  }));

  test("public CLI routes Grok Bot config generation", () => withHome((home) => {
    const result = spawnSync("node", [join(ROOT, "scripts/harness-mem.js"),
      "mcp-config", "--client", "grok-bot", "--transport", "http", "--write", "--home", home, "--json"],
      { cwd: home, env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8", timeout: 20000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).results[0].client).toBe("grok-bot");
    expect(checkGrokBotConfig({ homeDir: home })).toBe(true);
  }));

  test("stdio → HTTP → stdio is idempotent, secret-free, and preserves unrelated settings", () => withHome((home) => {
    const file = grokBotConfigPath({ homeDir: home });
    mkdirSync(join(file, ".."), { recursive: true });
    const foreign = { command: "other-tool", args: ["serve"] };
    writeFileSync(file, JSON.stringify({ theme: "dark", mcpServers: { foreign } }));
    for (const transport of ["stdio", "http", "http", "stdio"]) {
      const result = cli(home, ["--client", "grokbot", "--transport", transport, "--write", "--url", "https://example.ts.net/mcp"]);
      expect(result.code).toBe(0);
      const text = readFileSync(file, "utf8");
      const parsed = JSON.parse(text);
      expect(parsed.theme).toBe("dark");
      expect(parsed.mcpServers.foreign).toEqual(foreign);
      expect(text + result.output).not.toContain("test-secret-not-for-config");
      expect(checkGrokBotConfig({ homeDir: home })).toBe(true);
      const config = parsed.mcpServers["harness-mem"];
      if (transport === "http") {
        expect(config.url).toBe("https://example.ts.net/mcp");
        expect(config.headers.Authorization).toBe("Bearer ${HARNESS_MEM_MCP_TOKEN}");
        expect(config.command).toBeUndefined();
      } else {
        expect(config.env.HARNESS_MEM_MCP_PLATFORM).toBe("grok-bot");
        expect(config.args[0]).toMatch(/^\//);
        expect(config.url).toBeUndefined();
      }
    }
    removeGrokBotConfig({ homeDir: home });
    removeGrokBotConfig({ homeDir: home });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark", mcpServers: { foreign } });
    expect(checkGrokBotConfig({ homeDir: home })).toBe(false);
  }));

  test("malformed config is reported and never overwritten", () => withHome((home) => {
    const file = grokBotConfigPath({ homeDir: home });
    mkdirSync(join(file, ".."), { recursive: true });
    for (const text of ["{broken", '{"mcpServers":[]}', 'null']) {
      writeFileSync(file, text);
      expect(cli(home, ["--client", "grok-bot", "--write"]).code).toBe(1);
      expect(readFileSync(file, "utf8")).toBe(text);
      expect(checkGrokBotConfig({ homeDir: home })).toBe(false);
    }
  }));

  test("doctor rejects missing auth, invalid endpoint, and mixed transports", () => withHome((home) => {
    const file = grokBotConfigPath({ homeDir: home });
    mkdirSync(join(file, ".."), { recursive: true });
    for (const config of [
      { type: "http", url: "https://example.ts.net/mcp" },
      { type: "http", url: "file:///tmp/mcp", headers: { Authorization: "Bearer test" } },
      { type: "http", url: "https://example.ts.net/mcp", headers: { Authorization: "Bearer test" }, command: "node" },
      { type: "http", url: "http://example.ts.net/mcp", headers: { Authorization: "Bearer test" } },
      { type: "http", url: "http://10.0.0.8:37889/mcp", headers: { Authorization: "Bearer test" } },
    ]) {
      writeFileSync(file, JSON.stringify({ mcpServers: { "harness-mem": config } }));
      expect(checkGrokBotConfig({ homeDir: home })).toBe(false);
    }
  }));

  test("HTTP bearer URLs allow loopback http and require https elsewhere", () => withHome((home) => {
    for (const url of ["http://127.0.0.1:37889/mcp", "http://localhost:37889/mcp", "http://[::1]:37889/mcp"]) {
      const spec = resolveServerSpec({ transport: "http", url, env: {} });
      expect(spec.url).toBe(url);
      expect(spec.headers.Authorization).toBe("Bearer ${HARNESS_MEM_MCP_TOKEN}");
      expect(buildGrokBotHarnessConfig(spec).url).toBe(url);
      expect(writeGrokBotConfig({ homeDir: home, serverSpec: spec }).status).toBe("updated");
      expect(checkGrokBotConfig({ homeDir: home })).toBe(true);
    }

    const remote = resolveServerSpec({ transport: "http", url: "https://example.ts.net/mcp", env: {} });
    expect(remote.url).toBe("https://example.ts.net/mcp");
    expect(writeGrokBotConfig({ homeDir: home, serverSpec: remote }).status).toBe("updated");
    expect(checkGrokBotConfig({ homeDir: home })).toBe(true);

    for (const url of ["http://example.ts.net/mcp", "http://192.168.1.9:37889/mcp", "http://10.0.0.8/mcp"]) {
      expect(() => resolveServerSpec({ transport: "http", url, env: {} })).toThrow(/https|loopback/i);
      expect(() => writeGrokBotConfig({
        homeDir: home,
        serverSpec: { transport: "http", url, headers: { Authorization: "Bearer ${HARNESS_MEM_MCP_TOKEN}" } },
      })).toThrow(/https|loopback/i);
      expect(cli(home, ["--client", "grok-bot", "--transport", "http", "--write", "--url", url]).code).toBe(1);
      expect(checkGrokBotConfig({ homeDir: home })).toBe(true);
    }
  }));

  test("removeGrokBotConfig leaves a null mcp.json untouched", () => withHome((home) => {
    const file = grokBotConfigPath({ homeDir: home });
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "null");
    expect(() => removeGrokBotConfig({ homeDir: home })).not.toThrow();
    expect(readFileSync(file, "utf8")).toBe("null");
    expect(checkGrokBotConfig({ homeDir: home })).toBe(false);
  }));

  test("real shell wiring supports explicit and comma-list selection without hooks", () => withHome((home) => {
    const result = shell(home, `
      PLATFORM=all
      ! is_platform_enabled grok-bot
      is_platform_enabled cursor
      PLATFORM=cursor,grok-bot
      validate_platform_selection
      is_platform_enabled grok-bot
      test "$(normalize_managed_platform_csv "$PLATFORM")" = cursor,grok-bot
      PLATFORM=grok-bot
      ! is_platform_enabled claude
      ! is_platform_enabled codex
      setup_grok_bot_wiring
      check_grok_bot_wiring
      MCP_CONFIG_TRANSPORT=http
      HARNESS_MEM_MCP_URL=https://example.ts.net/mcp
      export HARNESS_MEM_MCP_URL
      setup_grok_bot_wiring
      check_grok_bot_wiring
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("config only");
    for (const dir of [".claude", ".codex", ".cursor", ".grok-bot"]) {
      expect(existsSync(join(home, dir))).toBe(false);
    }
    const config = JSON.parse(readFileSync(grokBotConfigPath({ homeDir: home }), "utf8"));
    expect(config.mcpServers["harness-mem"].url).toBe("https://example.ts.net/mcp");
  }));

  test("local HTTP grok-bot setup provisions the shared gateway; remote URL does not", () => withHome((home) => {
    const result = shell(home, `
      PLATFORM=grok-bot
      MCP_CONFIG_TRANSPORT=http
      unset HARNESS_MEM_MCP_URL
      setup_grok_bot_wiring
      _grok_bot_uses_default_local_http
      setup_has_http_tier1_config
      MCP_HTTP_CONFIG_DETECTED=0
      check_grok_bot_wiring
      test "$MCP_HTTP_CONFIG_DETECTED" = 1

      HARNESS_MEM_MCP_URL=https://example.ts.net/mcp
      export HARNESS_MEM_MCP_URL
      setup_grok_bot_wiring
      ! _grok_bot_uses_default_local_http
      ! setup_has_http_tier1_config
      MCP_HTTP_CONFIG_DETECTED=0
      check_grok_bot_wiring
      test "$MCP_HTTP_CONFIG_DETECTED" = 0
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(grokBotConfigPath({ homeDir: home }), "utf8")).mcpServers["harness-mem"].url)
      .toBe("https://example.ts.net/mcp");
  }));

  test("real Grok Bot-only uninstall leaves shared runtime and database intact", () => withHome((home) => {
    expect(cli(home, ["--client", "grok-bot", "--write"]).code).toBe(0);
    mkdirSync(join(home, ".harness-mem", "runtime"), { recursive: true });
    const sentinel = join(home, ".harness-mem", "runtime", "sentinel");
    const database = join(home, ".harness-mem", "harness-mem.db");
    writeFileSync(sentinel, "keep");
    writeFileSync(database, "keep");
    const result = shell(home, `PLATFORM=" grok-bot , grok-bot "; uninstall_impl`);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("keep");
    expect(readFileSync(database, "utf8")).toBe("keep");
    expect(checkGrokBotConfig({ homeDir: home })).toBe(false);
  }));

  test("docs and packaged examples keep the experimental Layer 1 ceiling", () => {
    for (const file of ["README.md", "README_ja.md", "docs/readme-claims.md", "docs/readme-claims-ja.md", "docs/harness-mem-setup.md", "docs/harness-mem-setup-ja.md"]) {
      const body = readFileSync(join(ROOT, file), "utf8");
      expect(body).toContain("Grok Bot");
      expect(body).toContain("Tier 3");
    }
    for (const file of ["mcp-local.json", "mcp-tailscale.json", "mcp-stdio.json"]) {
      const config = JSON.parse(readFileSync(join(ROOT, "integrations/grok-bot/examples", file), "utf8"));
      expect(config.mcpServers["harness-mem"]).toBeDefined();
      expect(config.hooks).toBeUndefined();
    }
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.files).toContain("integrations/grok-bot/");
  });
});
