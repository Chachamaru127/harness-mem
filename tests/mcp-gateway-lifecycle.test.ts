import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-mem");

async function runHarnessMem(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const code = await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { code, stdout, stderr };
}

function randomPort(base = 43000, span = 2000): number {
  return base + Math.floor(Math.random() * span);
}

function writeHealthyConfig(harnessHome: string): void {
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
}

function writeFakeGateway(tmpHome: string): string {
  const serverTs = join(tmpHome, "fake-gateway.ts");
  writeFileSync(
    serverTs,
    `
const addr = process.env.HARNESS_MEM_MCP_ADDR ?? "127.0.0.1:37889";
const token = process.env.HARNESS_MEM_MCP_TOKEN ?? "";
const [host, portValue] = addr.split(":");
const server = Bun.serve({
  hostname: host,
  port: Number(portValue),
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/mcp") {
      return new Response("not found", { status: 404 });
    }
    if (req.headers.get("authorization") !== \`Bearer \${token}\`) {
      return new Response("unauthorized", { status: 401 });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: "harness-mem-cli-health",
      result: { ok: true },
    });
  },
});
process.on("SIGTERM", () => {
  server.stop(true);
  process.exit(0);
});
await new Promise(() => {});
`.trimStart()
  );

  const entry = join(tmpHome, "fake-harness-mcp-server");
  writeFileSync(
    entry,
    `#!/usr/bin/env bash
set -euo pipefail
bun run "$FAKE_GATEWAY_TS" &
child="$!"
trap 'kill -TERM "$child" >/dev/null 2>&1 || true; wait "$child" 2>/dev/null || true; exit 0' TERM INT
wait "$child"
`
  );
  chmodSync(entry, 0o755);
  return entry;
}

async function waitForGateway(endpoint: string, token: string, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "test",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // retry until timeout
    }
    await Bun.sleep(50);
  }
  throw new Error(`gateway did not become reachable at ${endpoint}`);
}

describe("mcp-gateway lifecycle", () => {
  test("start, status, and stop manage a local HTTP MCP gateway process", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const port = randomPort();
    const fakeEntry = writeFakeGateway(tmpHome);
    const fakeServer = join(tmpHome, "fake-gateway.ts");
    writeHealthyConfig(harnessHome);

    const env = {
      ...process.env,
      HOME: tmpHome,
      HARNESS_MEM_HOME: harnessHome,
      HARNESS_MEM_NON_INTERACTIVE: "1",
      HARNESS_MEM_MCP_ADDR: `127.0.0.1:${port}`,
      HARNESS_MEM_MCP_TOKEN: "gateway-secret",
      HARNESS_MEM_MCP_GATEWAY_ENTRY: fakeEntry,
      HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
      HARNESS_MEM_MCP_GATEWAY_START_TIMEOUT_SEC: "5",
      HARNESS_MEM_PORT: String(randomPort(47000, 1000)),
      FAKE_GATEWAY_TS: fakeServer,
    };

    try {
      const started = await runHarnessMem(["mcp-gateway", "start", "--json"], env);
      expect(started.code).toBe(0);
      const startJson = JSON.parse(started.stdout) as {
        state: string;
        running: boolean;
        pid: number;
        endpoint: string;
        auth_mode: string;
        memory_daemon: { reachable: boolean };
      };
      expect(startJson.state).toBe("running");
      expect(startJson.running).toBe(true);
      expect(startJson.endpoint).toBe(`http://127.0.0.1:${port}/mcp`);
      expect(startJson.auth_mode).toBe("bearer_token");
      expect(startJson.memory_daemon.reachable).toBe(false);
      expect(existsSync(join(harnessHome, "mcp-gateway.pid"))).toBe(true);

      const status = await runHarnessMem(["mcp-gateway", "status", "--json"], env);
      expect(status.code).toBe(0);
      const statusJson = JSON.parse(status.stdout) as { state: string; pid: number };
      expect(statusJson.state).toBe("running");
      expect(statusJson.pid).toBe(startJson.pid);

      const stopped = await runHarnessMem(["mcp-gateway", "stop", "--json"], env);
      expect(stopped.code).toBe(0);
      const stopJson = JSON.parse(stopped.stdout) as { state: string; running: boolean };
      expect(stopJson.state).toBe("stopped");
      expect(stopJson.running).toBe(false);
    } finally {
      await runHarnessMem(["mcp-gateway", "stop", "--json"], env).catch(() => undefined);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);

  test("start refuses to run without an HTTP gateway token", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-token-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const fakeEntry = writeFakeGateway(tmpHome);
    writeHealthyConfig(harnessHome);

    try {
      const result = await runHarnessMem(["mcp-gateway", "start", "--json"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_MCP_ADDR: `127.0.0.1:${randomPort()}`,
        HARNESS_MEM_MCP_TOKEN: "",
        HARNESS_MEM_REMOTE_TOKEN: "",
        HARNESS_MEM_MCP_GATEWAY_ENTRY: fakeEntry,
        HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
        FAKE_GATEWAY_TS: join(tmpHome, "fake-gateway.ts"),
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("HARNESS_MEM_MCP_TOKEN");
      expect(existsSync(join(harnessHome, "mcp-gateway.pid"))).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("start ignores stale live pid file when the gateway port is free", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-stale-pid-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const port = randomPort();
    const fakeEntry = writeFakeGateway(tmpHome);
    const fakeServer = join(tmpHome, "fake-gateway.ts");
    writeHealthyConfig(harnessHome);
    writeFileSync(join(harnessHome, "mcp-gateway.pid"), `${process.pid}`);

    const env = {
      ...process.env,
      HOME: tmpHome,
      HARNESS_MEM_HOME: harnessHome,
      HARNESS_MEM_NON_INTERACTIVE: "1",
      HARNESS_MEM_MCP_ADDR: `127.0.0.1:${port}`,
      HARNESS_MEM_MCP_TOKEN: "gateway-secret",
      HARNESS_MEM_MCP_GATEWAY_ENTRY: fakeEntry,
      HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
      HARNESS_MEM_MCP_GATEWAY_START_TIMEOUT_SEC: "5",
      HARNESS_MEM_PORT: String(randomPort(49000, 1000)),
      FAKE_GATEWAY_TS: fakeServer,
    };

    try {
      const started = await runHarnessMem(["mcp-gateway", "start", "--json"], env);
      expect(started.code).toBe(0);
      const parsed = JSON.parse(started.stdout) as { state: string; pid: number };
      expect(parsed.state).toBe("running");
      expect(parsed.pid).not.toBe(process.pid);
      expect(readFileSync(join(harnessHome, "mcp-gateway.pid"), "utf8").trim()).toBe(String(parsed.pid));
    } finally {
      await runHarnessMem(["mcp-gateway", "stop", "--json"], env).catch(() => undefined);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);

  test("start ignores stale live harness-mcp pid file when it is not listening on the gateway port", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-stale-harness-pid-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const port = randomPort();
    const fakeEntry = writeFakeGateway(tmpHome);
    const fakeServer = join(tmpHome, "fake-gateway.ts");
    writeHealthyConfig(harnessHome);

    const fakeStdio = join(tmpHome, "harness-mcp-darwin-arm64");
    writeFileSync(
      fakeStdio,
      `#!/usr/bin/env bash
trap 'exit 0' TERM INT
while true; do sleep 1; done
`
    );
    chmodSync(fakeStdio, 0o755);
    const unrelated = Bun.spawn([fakeStdio], { stdout: "pipe", stderr: "pipe" });
    writeFileSync(join(harnessHome, "mcp-gateway.pid"), `${unrelated.pid}`);

    const env = {
      ...process.env,
      HOME: tmpHome,
      HARNESS_MEM_HOME: harnessHome,
      HARNESS_MEM_NON_INTERACTIVE: "1",
      HARNESS_MEM_MCP_ADDR: `127.0.0.1:${port}`,
      HARNESS_MEM_MCP_TOKEN: "gateway-secret",
      HARNESS_MEM_MCP_GATEWAY_ENTRY: fakeEntry,
      HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
      HARNESS_MEM_MCP_GATEWAY_START_TIMEOUT_SEC: "5",
      HARNESS_MEM_PORT: String(randomPort(49500, 500)),
      FAKE_GATEWAY_TS: fakeServer,
    };

    try {
      const started = await runHarnessMem(["mcp-gateway", "start", "--json"], env);
      expect(started.code).toBe(0);
      const parsed = JSON.parse(started.stdout) as { state: string; pid: number };
      expect(parsed.state).toBe("running");
      expect(parsed.pid).not.toBe(unrelated.pid);
      expect(readFileSync(join(harnessHome, "mcp-gateway.pid"), "utf8").trim()).toBe(String(parsed.pid));
    } finally {
      await runHarnessMem(["mcp-gateway", "stop", "--json"], env).catch(() => undefined);
      unrelated.kill();
      await unrelated.exited.catch(() => undefined);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);

  test("stop fails closed when lsof is unavailable for a live harness-mcp pid", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-no-lsof-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    writeHealthyConfig(harnessHome);

    const fakeStdio = join(tmpHome, "harness-mcp-darwin-arm64");
    writeFileSync(
      fakeStdio,
      `#!/usr/bin/env bash
trap 'exit 0' TERM INT
while true; do sleep 1; done
`
    );
    chmodSync(fakeStdio, 0o755);
    const unrelated = Bun.spawn([fakeStdio], { stdout: "pipe", stderr: "pipe" });
    writeFileSync(join(harnessHome, "mcp-gateway.pid"), `${unrelated.pid}`);

    try {
      const stopped = await runHarnessMem(["mcp-gateway", "stop", "--json"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_MCP_ADDR: `127.0.0.1:${randomPort()}`,
        HARNESS_MEM_MCP_TOKEN: "gateway-secret",
        HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
        PATH: "/usr/bin:/bin",
      });

      expect(stopped.code).toBe(1);
      expect(stopped.stderr).toContain("Refusing to stop pid");
      expect(unrelated.killed).toBe(false);
      expect(Bun.spawnSync(["kill", "-0", String(unrelated.pid)]).exitCode).toBe(0);
    } finally {
      unrelated.kill();
      await unrelated.exited.catch(() => undefined);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);

  test("stop ignores malformed pid files instead of normalizing them", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-bad-pid-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    writeHealthyConfig(harnessHome);
    writeFileSync(join(harnessHome, "mcp-gateway.pid"), "12x34");

    try {
      const stopped = await runHarnessMem(["mcp-gateway", "stop", "--json"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_MCP_ADDR: `127.0.0.1:${randomPort()}`,
      });
      expect(stopped.code).toBe(0);
      const parsed = JSON.parse(stopped.stdout) as { state: string; pid: number | null };
      expect(parsed.state).toBe("stopped");
      expect(parsed.pid).toBeNull();
      expect(existsSync(join(harnessHome, "mcp-gateway.pid"))).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("status does not rewrite malformed pid file even when a gateway listener exists", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-malformed-status-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const port = randomPort();
    const fakeEntry = writeFakeGateway(tmpHome);
    const fakeServer = join(tmpHome, "fake-gateway.ts");
    const token = "gateway-secret";
    writeHealthyConfig(harnessHome);
    writeFileSync(join(harnessHome, "mcp-gateway.pid"), "12x34");

    const env = {
      ...process.env,
      HOME: tmpHome,
      HARNESS_MEM_HOME: harnessHome,
      HARNESS_MEM_NON_INTERACTIVE: "1",
      HARNESS_MEM_MCP_ADDR: `127.0.0.1:${port}`,
      HARNESS_MEM_MCP_TOKEN: token,
      HARNESS_MEM_MCP_GATEWAY_ENTRY: fakeEntry,
      HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
      HARNESS_MEM_PORT: String(randomPort(50000, 500)),
      FAKE_GATEWAY_TS: fakeServer,
    };
    const proc = Bun.spawn(["bash", fakeEntry], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    try {
      await waitForGateway(`http://127.0.0.1:${port}/mcp`, token);
      const status = await runHarnessMem(["mcp-gateway", "status", "--json"], env);
      expect(status.code).toBe(0);
      const parsed = JSON.parse(status.stdout) as { state: string; pid_file_status: string };
      expect(parsed.state).toBe("running");
      expect(parsed.pid_file_status).toBe("malformed");
      expect(readFileSync(join(harnessHome, "mcp-gateway.pid"), "utf8")).toBe("12x34");
    } finally {
      proc.kill();
      await proc.exited.catch(() => undefined);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);

  test("start rejects non-loopback bind addresses before spawning", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-bind-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const fakeEntry = writeFakeGateway(tmpHome);
    writeHealthyConfig(harnessHome);

    try {
      const result = await runHarnessMem(["mcp-gateway", "start", "--json"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_MCP_ADDR: "0.0.0.0:37889",
        HARNESS_MEM_MCP_TOKEN: "gateway-secret",
        HARNESS_MEM_MCP_GATEWAY_ENTRY: fakeEntry,
        HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
        FAKE_GATEWAY_TS: join(tmpHome, "fake-gateway.ts"),
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("loopback");
      expect(existsSync(join(harnessHome, "mcp-gateway.pid"))).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("start without token fails before building the default gateway binary", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-token-first-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const defaultGatewayBin = join(ROOT, "mcp-server-go/bin/harness-mcp-server");
    const beforeMtime = existsSync(defaultGatewayBin) ? statSync(defaultGatewayBin).mtimeMs : null;
    writeHealthyConfig(harnessHome);

    try {
      const result = await runHarnessMem(["mcp-gateway", "start", "--json"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_MCP_ADDR: `127.0.0.1:${randomPort()}`,
        HARNESS_MEM_MCP_TOKEN: "",
        HARNESS_MEM_REMOTE_TOKEN: "",
        HARNESS_MEM_MCP_GATEWAY_ENTRY: "",
        PATH: "/usr/bin:/bin",
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("HARNESS_MEM_MCP_TOKEN");
      expect(result.stderr).not.toContain("go:");
      const afterMtime = existsSync(defaultGatewayBin) ? statSync(defaultGatewayBin).mtimeMs : null;
      expect(afterMtime).toBe(beforeMtime);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("doctor --mcp-transport http includes gateway health in JSON", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-doctor-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const port = randomPort();
    const fakeEntry = writeFakeGateway(tmpHome);
    const fakeServer = join(tmpHome, "fake-gateway.ts");
    writeHealthyConfig(harnessHome);

    const env = {
      ...process.env,
      HOME: tmpHome,
      HARNESS_MEM_HOME: harnessHome,
      HARNESS_MEM_NON_INTERACTIVE: "1",
      HARNESS_MEM_MCP_ADDR: `127.0.0.1:${port}`,
      HARNESS_MEM_MCP_TOKEN: "gateway-secret",
      HARNESS_MEM_MCP_GATEWAY_ENTRY: fakeEntry,
      HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
      HARNESS_MEM_MCP_GATEWAY_START_TIMEOUT_SEC: "5",
      HARNESS_MEM_PORT: String(randomPort(48000, 1000)),
      FAKE_GATEWAY_TS: fakeServer,
    };

    try {
      const started = await runHarnessMem(["mcp-gateway", "start", "--json"], env);
      expect(started.code).toBe(0);

      const doctor = await runHarnessMem(
        ["doctor", "--mcp-transport", "http", "--json", "--read-only", "--skip-version-check"],
        env
      );
      expect(doctor.code).toBe(0);
      const parsed = JSON.parse(doctor.stdout) as {
        mcp_gateway: { state: string; endpoint: string; gateway_health: { status: string } };
        checks: Array<{ name: string; status: string }>;
      };
      expect(parsed.mcp_gateway.state).toBe("running");
      expect(parsed.mcp_gateway.endpoint).toBe(`http://127.0.0.1:${port}/mcp`);
      expect(parsed.mcp_gateway.gateway_health.status).toBe("ok");
      expect(parsed.checks.some((check) => check.name === "mcp_gateway" && check.status === "ok:running")).toBe(true);
    } finally {
      await runHarnessMem(["mcp-gateway", "stop", "--json"], env).catch(() => undefined);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);

  test("doctor --mcp-transport http --read-only does not create a pid file", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-mcp-gateway-readonly-"));
    const harnessHome = join(tmpHome, ".harness-mem");
    const port = randomPort();
    const fakeEntry = writeFakeGateway(tmpHome);
    const fakeServer = join(tmpHome, "fake-gateway.ts");
    const token = "gateway-secret";
    writeHealthyConfig(harnessHome);

    const env = {
      ...process.env,
      HOME: tmpHome,
      HARNESS_MEM_HOME: harnessHome,
      HARNESS_MEM_NON_INTERACTIVE: "1",
      HARNESS_MEM_MCP_ADDR: `127.0.0.1:${port}`,
      HARNESS_MEM_MCP_TOKEN: token,
      HARNESS_MEM_MCP_GATEWAY_ENTRY: fakeEntry,
      HARNESS_MEM_MCP_GATEWAY_SKIP_DAEMON_START: "1",
      HARNESS_MEM_PORT: String(randomPort(50000, 1000)),
      FAKE_GATEWAY_TS: fakeServer,
    };
    const proc = Bun.spawn(["bash", fakeEntry], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    try {
      await waitForGateway(`http://127.0.0.1:${port}/mcp`, token);
      expect(existsSync(join(harnessHome, "mcp-gateway.pid"))).toBe(false);

      const doctor = await runHarnessMem(
        ["doctor", "--mcp-transport", "http", "--json", "--read-only", "--skip-version-check"],
        env
      );
      expect(doctor.code).toBe(0);
      const parsed = JSON.parse(doctor.stdout) as { mcp_gateway: { state: string } };
      expect(parsed.mcp_gateway.state).toBe("running");
      expect(existsSync(join(harnessHome, "mcp-gateway.pid"))).toBe(false);
    } finally {
      proc.kill();
      await proc.exited.catch(() => undefined);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);
});
