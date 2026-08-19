import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalDatabaseIdentity } from "../memory-server/src/core/search-worker-lifecycle";

const ROOT = resolve(import.meta.dir, "..");
const DAEMON = resolve(ROOT, "memory-server/src/index.ts");
const WORKER = resolve(ROOT, "memory-server/src/tools/search-worker.ts");
const REAL_WORKER = realpathSync(WORKER);
const cleanupPids = new Set<number>();
const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const pid of cleanupPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  cleanupPids.clear();
  await Bun.sleep(25);
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(label: string, probe: () => T | null, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== null) return value;
    await Bun.sleep(25);
  }
  throw new Error(`${label} not met within ${timeoutMs}ms`);
}

function workerRows(dbPath: string): Array<{ pid: number; ppid: number; command: string }> {
  const id = canonicalDatabaseIdentity(dbPath);
  const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,command="], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) return [];
  return result.stdout.toString().split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return [];
    const command = match[3];
    if ((!command.includes(WORKER) && !command.includes(REAL_WORKER)) ||
        !command.includes("--harness-mem-search-worker") ||
        !command.includes(`--harness-mem-db-id=${id}`)) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), command }];
  });
}

function spawnDaemon(home: string, dbPath: string, port: number): ReturnType<typeof Bun.spawn> {
  const proc = Bun.spawn([process.execPath, "run", DAEMON], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HARNESS_MEM_BACKGROUND_WORKERS_ENABLED: "true",
      HARNESS_MEM_SEARCH_WORKER: "true",
      HARNESS_MEM_SEARCH_OFFLOAD: "true",
      HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS: "5000",
      HARNESS_MEM_TEST_SEARCH_WORKER_SHUTDOWN_DELAY_MS: "300",
      HARNESS_MEM_SHUTDOWN_TIMEOUT_MS: "50",
      HOME: home,
      HARNESS_MEM_HOME: home,
      HARNESS_MEM_DB_PATH: dbPath,
      HARNESS_MEM_HOST: "127.0.0.1",
      HARNESS_MEM_PORT: String(port),
      HARNESS_MEM_ENABLE_CLAUDE_CODE_INGEST: "false",
      HARNESS_MEM_ENABLE_CODEX_INGEST: "false",
      HARNESS_MEM_ENABLE_CURSOR_INGEST: "false",
      HARNESS_MEM_ENABLE_OPENCODE_INGEST: "false",
      HARNESS_MEM_ENABLE_GEMINI_INGEST: "false",
      HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST: "false",
      HARNESS_MEM_OTEL_ENABLED: "false",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  cleanupPids.add(proc.pid);
  return proc;
}

describe("daemon search-worker lifecycle", () => {
  test("SIGKILL orphan is reaped by the next same-DB daemon, whose shutdown awaits its worker", async () => {
    if (process.platform === "win32") return;
    const home = mkdtempSync(join(tmpdir(), "harness-mem-daemon-lifecycle-"));
    cleanupPaths.push(home);
    const dbPath = join(home, "memory.db");
    const firstPort = 46_000 + Math.floor(Math.random() * 1_000);
    const first = spawnDaemon(home, dbPath, firstPort);
    const firstWorker = await waitFor("first worker start", () =>
      workerRows(dbPath).find((row) => row.ppid === first.pid) ?? null,
    );
    cleanupPids.add(firstWorker.pid);

    void fetch(`http://127.0.0.1:${firstPort}/v1/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "lifecycle fixture", safe_mode: true }),
    }).catch(() => null);
    await Bun.sleep(100);

    first.kill("SIGKILL");
    await first.exited;
    cleanupPids.delete(first.pid);
    await waitFor("first worker orphan", () => workerRows(dbPath).find((row) => row.pid === firstWorker.pid && row.ppid <= 1) ?? null);

    const second = spawnDaemon(home, dbPath, 47_000 + Math.floor(Math.random() * 1_000));
    const secondWorker = await waitFor("replacement cleanup and start", () => {
      if (running(firstWorker.pid)) return null;
      return workerRows(dbPath).find((row) => row.ppid === second.pid) ?? null;
    });
    cleanupPids.delete(firstWorker.pid);
    cleanupPids.add(secondWorker.pid);

    const shutdownStartedAt = Date.now();
    second.kill("SIGTERM");
    expect(await second.exited).toBe(0);
    expect(Date.now() - shutdownStartedAt).toBeGreaterThanOrEqual(250);
    cleanupPids.delete(second.pid);
    expect(running(secondWorker.pid)).toBe(false);
    cleanupPids.delete(secondWorker.pid);
  }, 30_000);
});
