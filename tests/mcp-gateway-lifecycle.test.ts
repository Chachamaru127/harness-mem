import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    env,
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
    expect(script).toContain('if [ "$MCP_GATEWAY_FOREGROUND" -eq 1 ]; then');
    expect(script).toContain("nohup env");
    expect(script).toContain('disown "$gateway_pid"');
  });
});
