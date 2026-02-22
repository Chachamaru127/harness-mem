import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-memd");
const UI_SERVER = resolve(ROOT, "harness-mem-ui/src/server.ts");

function randomPort(base = 41000, span = 2000): number {
  return base + Math.floor(Math.random() * span);
}

function makeEnv(tmpHome: string, daemonPort: number, uiPort?: number): NodeJS.ProcessEnv {
  const resolvedUiPort = typeof uiPort === "number" ? uiPort : randomPort(45000, 1000);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HARNESS_MEM_HOME: tmpHome,
    HARNESS_MEM_DB_PATH: join(tmpHome, "harness-mem.db"),
    HARNESS_MEM_HOST: "127.0.0.1",
    HARNESS_MEM_PORT: String(daemonPort),
    HARNESS_MEM_UI_PORT: String(resolvedUiPort),
    HARNESS_MEM_ENABLE_UI: "true",
    HARNESS_MEM_CODEX_PROJECT_ROOT: ROOT,
    HARNESS_MEM_ENABLE_OPENCODE_INGEST: "false",
    HARNESS_MEM_ENABLE_CURSOR_INGEST: "false",
    HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST: "false",
  };
  return env;
}

async function runHarnessMemd(
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

async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 10_000, intervalMs = 100): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) {
      return;
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

describe("harness-memd guardrails", () => {
  test("status does not treat non-JSON health endpoint as healthy", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-status-"));
    const port = randomPort();
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("ok", { status: 200 }),
    });

    try {
      const result = await runHarnessMemd(["status"], makeEnv(tmpHome, port));
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("stopped");
    } finally {
      fake.stop(true);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("start fails fast when target port is occupied by another process", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-conflict-"));
    const port = randomPort();
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("not-harness", { status: 200 }),
    });

    try {
      const result = await runHarnessMemd(["start"], makeEnv(tmpHome, port));
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`Port ${port} is already in use`);
      expect(existsSync(join(tmpHome, "daemon.pid"))).toBe(false);
    } finally {
      fake.stop(true);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("status rotates oversized logs using configured threshold", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-rotate-"));
    const daemonLog = join(tmpHome, "daemon.log");
    const uiLog = join(tmpHome, "harness-mem-ui.log");
    const big = "x".repeat(4096);
    writeFileSync(daemonLog, big);
    writeFileSync(uiLog, big);

    try {
      const env = makeEnv(tmpHome, randomPort(), randomPort());
      env.HARNESS_MEM_LOG_MAX_BYTES = "1024";
      env.HARNESS_MEM_LOG_ROTATE_KEEP = "2";

      const result = await runHarnessMemd(["status"], env);
      expect(result.code).toBe(1);

      expect(existsSync(`${daemonLog}.1`)).toBe(true);
      expect(existsSync(`${uiLog}.1`)).toBe(true);
      expect(statSync(daemonLog).size).toBeLessThan(1024);
      expect(statSync(uiLog).size).toBeLessThan(1024);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("status auto-syncs harness-mem-ui.pid from running UI listener", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-ui-pid-"));
    const daemonPort = randomPort();
    const uiPort = randomPort(45000, 1000);

    const uiProc = Bun.spawn([process.execPath, "run", UI_SERVER], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HARNESS_MEM_HOST: "127.0.0.1",
        HARNESS_MEM_PORT: String(daemonPort),
        HARNESS_MEM_UI_PORT: String(uiPort),
      },
    });

    try {
      await waitUntil(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${uiPort}/api/context`);
          return response.ok;
        } catch {
          return false;
        }
      });

      const uiPidFile = join(tmpHome, "harness-mem-ui.pid");
      writeFileSync(uiPidFile, "999999");

      const result = await runHarnessMemd(["status"], makeEnv(tmpHome, daemonPort, uiPort));
      expect(result.code).toBe(1);

      const synced = readFileSync(uiPidFile, "utf8").trim();
      expect(synced).toBe(String(uiProc.pid));
    } finally {
      uiProc.kill();
      await uiProc.exited;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("start launches Mem UI and stop tears it down", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-ui-start-"));
    const daemonPort = randomPort();
    const uiPort = randomPort(46000, 1000);
    const env = makeEnv(tmpHome, daemonPort, uiPort);

    try {
      const start = await runHarnessMemd(["start"], env);
      expect(start.code).toBe(0);

      await waitUntil(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${uiPort}/api/context`);
          return response.ok;
        } catch {
          return false;
        }
      });

      const stop = await runHarnessMemd(["stop"], env);
      expect(stop.code).toBe(0);

      await waitUntil(async () => {
        try {
          await fetch(`http://127.0.0.1:${uiPort}/api/context`);
          return false;
        } catch {
          return true;
        }
      });
    } finally {
      await runHarnessMemd(["stop"], env);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
