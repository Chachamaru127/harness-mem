import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-mem");

function randomPort(base = 43000, span = 2000): number {
  return base + Math.floor(Math.random() * span);
}

async function runHarnessMem(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // このファイルは MCP gateway lifecycle の契約テストで model pull は対象外。
      // 156-003 の setup granite pull step がローカル (非 CI) 実行で実 1.2GB DL に
      // 入りタイムアウトするため offline mock で決定論化する (codex-hooks と同じ)。
      HARNESS_MEM_SETUP_MODEL_PULL_MOCK: "offline",
      ...env,
    },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function startFakeGateway(port: number, token: string) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/mcp") {
        return new Response("not found", { status: 404 });
      }
      if (req.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("missing or invalid gateway token", { status: 401 });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "fake-harness-mcp", version: "test" },
          capabilities: {},
        },
      });
    },
  });
}

function startFakeMemoryDaemon(port: number) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health/ready" || url.pathname === "/health") {
        return Response.json({ ok: true, items: [{ status: "ok" }] });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

function writeHealthyReadOnlyConfig(home: string): string {
  const harnessHome = join(home, ".harness-mem");
  mkdirSync(harnessHome, { recursive: true });
  writeFileSync(
    join(harnessHome, "config.json"),
    JSON.stringify(
      {
        backend_mode: "local",
        recall: { mode: "quiet" },
        embedding_provider: "auto",
        embedding_model: "multilingual-e5",
        managed: { endpoint: "", api_key: "" },
      },
      null,
      2
    )
  );
  return harnessHome;
}

describe("mcp-gateway lifecycle CLI", () => {
  test("fresh Claude/Codex setup defaults to HTTP config and creates a managed token file", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-http-default-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const gatewayPort = randomPort();
    const memoryPort = randomPort(46000, 1000);

    try {
      const result = await runHarnessMem(
        [
          "setup",
          "--platform",
          "codex,claude",
          "--skip-start",
          "--skip-smoke",
          "--skip-quality",
          "--skip-version-check",
        ],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: harnessHome,
          HARNESS_MEM_MCP_ADDR: `127.0.0.1:${gatewayPort}`,
          HARNESS_MEM_PORT: String(memoryPort),
          HARNESS_MEM_NON_INTERACTIVE: "1",
          HARNESS_MEM_SKIP_AUTO_UPDATE: "1",
          HARNESS_MEM_MCP_TOKEN: "",
          HARNESS_MEM_REMOTE_TOKEN: "",
        }
      );

      expect(result.code).toBe(0);

      const codexConfig = readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8");
      const claudeConfig = JSON.parse(readFileSync(join(tmpHome, ".claude.json"), "utf8")) as {
        mcpServers: {
          harness: {
            type: string;
            url: string;
            headers: { Authorization: string };
            command?: string;
            env?: Record<string, string>;
          };
        };
      };
      const tokenPath = join(harnessHome, "mcp-gateway.token");
      const envPath = join(harnessHome, "mcp-gateway.env");
      const token = readFileSync(tokenPath, "utf8").trim();

      expect(codexConfig).toContain(`url = "http://127.0.0.1:${gatewayPort}/mcp"`);
      expect(codexConfig).toContain('bearer_token_env_var = "HARNESS_MEM_MCP_TOKEN"');
      expect(codexConfig).not.toContain("command =");
      expect(claudeConfig.mcpServers.harness.type).toBe("http");
      expect(claudeConfig.mcpServers.harness.url).toBe(`http://127.0.0.1:${gatewayPort}/mcp`);
      expect(claudeConfig.mcpServers.harness.headers.Authorization).toBe(
        "Bearer ${HARNESS_MEM_MCP_TOKEN}"
      );
      expect(claudeConfig.mcpServers.harness.command).toBeUndefined();
      expect(JSON.stringify(claudeConfig)).not.toContain(token);
      expect(readFileSync(envPath, "utf8")).toContain("export HARNESS_MEM_MCP_TOKEN=");
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("default HTTP setup preserves existing stdio Claude wiring unless transport is explicit", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-preserve-stdio-"));
    const harnessHome = join(tmpHome, ".harness-mem");

    try {
      mkdirSync(join(tmpHome, ".claude"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".claude.json"),
        JSON.stringify(
          {
            mcpServers: {
              harness: {
                command: join(ROOT, "bin", "harness-mcp-server"),
                enabled: true,
                env: {
                  HARNESS_MEM_HOST: "127.0.0.1",
                  HARNESS_MEM_PORT: "37888",
                  HARNESS_MEM_DB_PATH: join(harnessHome, "harness-mem.db"),
                },
              },
            },
          },
          null,
          2
        )
      );

      const result = await runHarnessMem(
        [
          "setup",
          "--platform",
          "claude",
          "--skip-start",
          "--skip-smoke",
          "--skip-quality",
          "--skip-version-check",
        ],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: harnessHome,
          HARNESS_MEM_NON_INTERACTIVE: "1",
          HARNESS_MEM_SKIP_AUTO_UPDATE: "1",
        }
      );

      expect(result.code).toBe(0);
      const claudeConfig = JSON.parse(readFileSync(join(tmpHome, ".claude.json"), "utf8")) as {
        mcpServers: {
          harness: {
            command?: string;
            type?: string;
            url?: string;
            env?: Record<string, string>;
          };
        };
      };
      expect(claudeConfig.mcpServers.harness.command).toBe(join(ROOT, "bin", "harness-mcp-server"));
      expect(claudeConfig.mcpServers.harness.url).toBeUndefined();
      expect(claudeConfig.mcpServers.harness.type).toBeUndefined();
      expect(claudeConfig.mcpServers.harness.env?.HARNESS_MEM_HOST).toBe("127.0.0.1");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("default HTTP setup preserves existing Codex stdio wiring unless transport is explicit", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-preserve-codex-stdio-"));
    const harnessHome = join(tmpHome, ".harness-mem");

    try {
      mkdirSync(join(tmpHome, ".codex"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".codex", "config.toml"),
        `
[mcp_servers.harness]
command = "node"
args = ["C:\\\\Harness\\\\mcp-server\\\\dist\\\\index.js"]
enabled = true

[mcp_servers.harness.env]
HARNESS_MEM_HOST = "127.0.0.1"
HARNESS_MEM_PORT = "37888"
HARNESS_MEM_DB_PATH = "C:\\\\Harness\\\\harness-mem.db"
`.trimStart()
      );

      const result = await runHarnessMem(
        [
          "setup",
          "--platform",
          "codex",
          "--skip-start",
          "--skip-smoke",
          "--skip-quality",
          "--skip-version-check",
        ],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: harnessHome,
          HARNESS_MEM_NON_INTERACTIVE: "1",
          HARNESS_MEM_SKIP_AUTO_UPDATE: "1",
          OS: "Windows_NT",
        }
      );

      expect(result.code).toBe(0);
      const codexConfig = readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8");
      expect(codexConfig).toContain('command = "node"');
      expect(codexConfig).toContain('args = ["C:\\\\Harness\\\\mcp-server\\\\dist\\\\index.js"]');
      expect(codexConfig).not.toContain("url = ");
      expect(codexConfig).not.toContain("bearer_token_env_var");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("status --json reports endpoint, token auth, gateway probe, and memory daemon health", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-status-"));
    const gatewayPort = randomPort();
    const memoryPort = randomPort(46000, 1000);
    const token = "gateway-secret";
    const gateway = startFakeGateway(gatewayPort, token);
    const memory = startFakeMemoryDaemon(memoryPort);

    try {
      const result = await runHarnessMem(["mcp-gateway", "status", "--json", "--skip-version-check"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: join(tmpHome, ".harness-mem"),
        HARNESS_MEM_MCP_ADDR: `127.0.0.1:${gatewayPort}`,
        HARNESS_MEM_MCP_TOKEN: token,
        HARNESS_MEM_PORT: String(memoryPort),
        HARNESS_MEM_NON_INTERACTIVE: "1",
      });

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schema: string;
        status: string;
        endpoint: string;
        auth_mode: string;
        gateway: { ok: boolean; status: string; http_status: number };
        memory_daemon: { ok: boolean; status: string; http_status: number };
      };

      expect(parsed.schema).toBe("mcp-gateway.status.v1");
      expect(parsed.status).toBe("running");
      expect(parsed.endpoint).toBe(`http://127.0.0.1:${gatewayPort}/mcp`);
      expect(parsed.auth_mode).toBe("token");
      expect(parsed.gateway).toMatchObject({ ok: true, status: "healthy", http_status: 200 });
      expect(parsed.memory_daemon).toMatchObject({ ok: true, status: "healthy", http_status: 200 });
    } finally {
      gateway.stop(true);
      memory.stop(true);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("doctor --mcp-transport http includes an opt-in gateway health check", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-doctor-"));
    const gatewayPort = randomPort();
    const memoryPort = randomPort(46000, 1000);
    const token = "gateway-secret";
    const gateway = startFakeGateway(gatewayPort, token);
    const memory = startFakeMemoryDaemon(memoryPort);

    try {
      const harnessHome = writeHealthyReadOnlyConfig(tmpHome);
      const result = await runHarnessMem(
        ["doctor", "--mcp-transport", "http", "--json", "--read-only", "--skip-version-check"],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: harnessHome,
          HARNESS_MEM_MCP_ADDR: `127.0.0.1:${gatewayPort}`,
          HARNESS_MEM_MCP_TOKEN: token,
          HARNESS_MEM_PORT: String(memoryPort),
          HARNESS_MEM_NON_INTERACTIVE: "1",
        }
      );

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        all_green: boolean;
        checks: Array<{ name: string; status: string; result: string }>;
      };
      const gatewayCheck = parsed.checks.find((check) => check.name === "mcp_gateway");
      expect(gatewayCheck).toMatchObject({ status: "ok:http", result: "pass" });
      expect(typeof parsed.all_green).toBe("boolean");
    } finally {
      gateway.stop(true);
      memory.stop(true);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("doctor --mcp-transport http fails the opt-in check when the probe has no token", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-doctor-token-"));
    try {
      const harnessHome = writeHealthyReadOnlyConfig(tmpHome);
      const result = await runHarnessMem(
        ["doctor", "--mcp-transport", "http", "--json", "--read-only", "--skip-version-check"],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: harnessHome,
          HARNESS_MEM_MCP_ADDR: `127.0.0.1:${randomPort()}`,
          HARNESS_MEM_MCP_TOKEN: "",
          HARNESS_MEM_REMOTE_TOKEN: "",
          HARNESS_MEM_PORT: String(randomPort(46000, 1000)),
          HARNESS_MEM_NON_INTERACTIVE: "1",
        }
      );

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        all_green: boolean;
        checks: Array<{ name: string; status: string; result: string; fix: string | null }>;
      };
      const gatewayCheck = parsed.checks.find((check) => check.name === "mcp_gateway");
      expect(gatewayCheck).toMatchObject({ status: "missing_token", result: "fail" });
      expect(gatewayCheck?.fix).toContain("harness-mem mcp-gateway start");
      expect(parsed.all_green).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("script exposes foreground, pidfile, and HTTP transport start contract", () => {
    const script = readFileSync(SCRIPT, "utf8");

    expect(script).toContain("mcp-gateway start|stop|status");
    expect(script).toContain("MCP_GATEWAY_PID_FILE");
    expect(script).toContain("MCP_GATEWAY_LOG_FILE");
    expect(script).toContain('HARNESS_MEM_MCP_TRANSPORT="http"');
    expect(script).toContain('HARNESS_MEM_MCP_ADDR="$MCP_GATEWAY_ADDR"');
    expect(script).toContain('HARNESS_MEM_ENABLE_UI="${HARNESS_MEM_ENABLE_UI:-false}" start_daemon');
    expect(script).toContain('if [ "$MCP_GATEWAY_FOREGROUND" -eq 1 ]; then');
    expect(script).toContain("nohup env");
    expect(script).toContain('disown "$gateway_pid"');
  });

  test("gateway health probe does not expose the bearer token in curl argv", () => {
    const script = readFileSync(SCRIPT, "utf8");
    const start = script.indexOf("_mcp_gateway_probe_json() {");
    const end = script.indexOf("_mcp_gateway_launchd_loaded_json() {");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const probeFunction = script.slice(start, end);

    expect(probeFunction).toContain("--config -");
    expect(probeFunction).toContain('header = "Authorization: Bearer %s"');
    expect(probeFunction).not.toContain('-H "Authorization: Bearer ${token}"');
    expect(probeFunction).not.toContain('-H "x-harness-mem-token: ${token}"');
  });
});
