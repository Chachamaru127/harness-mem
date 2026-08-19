import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildSearchWorkerIdentityArgs,
  canonicalDatabaseIdentity,
  recoverOrphanedSearchWorkers,
  stopOwnedSearchWorkerProcess,
  stopSearchWorkerProcess,
  type SearchWorkerProcessOps,
  type SearchWorkerProcessSnapshot,
} from "../../src/core/search-worker-lifecycle";
import {
  PersistentSearchWorkerClient,
  resolveBackgroundWorkersEnabled,
} from "../../src/core/harness-mem-core";

const tempPaths: string[] = [];
const spawnedPids = new Set<number>();

afterEach(async () => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  spawnedPids.clear();
  await Bun.sleep(25);
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function makeFixture(): { root: string; script: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "harness-mem-worker-lifecycle-"));
  tempPaths.push(root);
  const script = join(root, "search-worker.ts");
  const dbPath = join(root, "memory.db");
  writeFileSync(dbPath, "fixture");
  writeFileSync(
    script,
    `process.on("SIGTERM", () => {});\nsetInterval(() => {}, 1_000);\n`,
  );
  return { root, script, dbPath };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(25);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnOwnedBash(script: string, dbPath: string, token: string): ReturnType<typeof Bun.spawn> {
  const proc = Bun.spawn(
    ["bash", script, ...buildSearchWorkerIdentityArgs(dbPath, process.pid, token)],
    { stdout: "ignore", stderr: "ignore" },
  );
  spawnedPids.add(proc.pid);
  return proc;
}

function spawnMarkedBunWorker(script: string, dbPath: string, token: string): ReturnType<typeof Bun.spawn> {
  const proc = Bun.spawn(
    [process.execPath, "run", script, ...buildSearchWorkerIdentityArgs(dbPath, process.pid, token)],
    { stdout: "ignore", stderr: "ignore" },
  );
  spawnedPids.add(proc.pid);
  return proc;
}

describe("search worker lifecycle", () => {
  test("explicit lightweight-child disable wins over inherited worker env", () => {
    expect(resolveBackgroundWorkersEnabled(false, {
      NODE_ENV: "test",
      HARNESS_MEM_BACKGROUND_WORKERS_ENABLED: "true",
    })).toBe(false);
  });

  test("canonical DB identity resolves symlink aliases without exposing a path", () => {
    const fixture = makeFixture();
    const alias = join(fixture.root, "alias.db");
    symlinkSync(fixture.dbPath, alias);

    const identity = canonicalDatabaseIdentity(alias);
    expect(identity).toBe(canonicalDatabaseIdentity(realpathSync(fixture.dbPath)));
    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    expect(identity).not.toContain(fixture.root);
  });

  test("core shutdown retains the stopped client and gates replacement creation", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../src/core/harness-mem-core.ts"), "utf8");
    const getWorker = source.slice(source.indexOf("private getOrCreateSearchWorker"), source.indexOf("private searchWorkerTimeoutMs"));
    const shutdown = source.slice(source.indexOf("shutdown(signal: string)"), source.indexOf("compressMemory(request"));
    expect(getWorker).toContain("if (this.shuttingDown)");
    expect(getWorker).toContain('"core shutting down"');
    expect(shutdown).not.toContain("this.searchWorker = null");
  });

  test("busy owned child gets SIGTERM, then SIGKILL, and disappearance is confirmed", async () => {
    if (process.platform === "win32") return;
    const fixture = makeFixture();
    writeFileSync(fixture.script, `trap '' TERM\nwhile :; do sleep 1; done\n`);
    const token = `busy-${crypto.randomUUID()}`;
    const proc = spawnOwnedBash(fixture.script, fixture.dbPath, token);
    await waitFor(() => isAlive(proc.pid));
    await Bun.sleep(150);

    const startedAt = Date.now();
    const result = await stopOwnedSearchWorkerProcess({
      proc,
      disappearanceTimeoutMs: 500,
    });

    expect(result.status).toBe("killed");
    expect(result.forced).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    await proc.exited;
    spawnedPids.delete(proc.pid);
    expect(isAlive(proc.pid)).toBe(false);
  });

  test("graceful child exits on SIGTERM and repeated stop is idempotent", async () => {
    if (process.platform === "win32") return;
    const fixture = makeFixture();
    writeFileSync(fixture.script, `trap 'exit 0' TERM\nwhile :; do sleep 1; done\n`);
    const token = `graceful-${crypto.randomUUID()}`;
    const proc = spawnOwnedBash(fixture.script, fixture.dbPath, token);
    await Bun.sleep(100);
    const options = {
      proc,
      termTimeoutMs: 1_000,
      disappearanceTimeoutMs: 500,
    } as const;

    const first = await stopOwnedSearchWorkerProcess(options);
    expect(first.status).toBe("terminated");
    expect(first.forced).toBe(false);
    expect((await stopOwnedSearchWorkerProcess(options)).status).toBe("terminated");
    spawnedPids.delete(proc.pid);
  });

  test("orphan recovery removes only same-DB workers and preserves guarded candidates", async () => {
    if (process.platform === "win32") return;
    const fixture = makeFixture();
    const other = makeFixture();
    const orphanToken = `orphan-${crypto.randomUUID()}`;
    const otherToken = `other-${crypto.randomUUID()}`;

    const parentScript = join(fixture.root, "spawn-parent.ts");
    writeFileSync(
      parentScript,
      `import { spawn } from "node:child_process";\nconst command = ${JSON.stringify([
        process.execPath,
        "run",
        fixture.script,
      ])}.concat(JSON.parse(process.env.WORKER_ARGS!));\nconst child = spawn(command[0], command.slice(1), { detached: true, stdio: "ignore" });\nchild.unref();\nconsole.log(child.pid);\n`,
    );
    const parent = Bun.spawn([process.execPath, "run", parentScript], {
      env: {
        ...process.env,
        WORKER_ARGS: JSON.stringify(buildSearchWorkerIdentityArgs(fixture.dbPath, 999_999, orphanToken)),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const orphanPid = Number((await new Response(parent.stdout).text()).trim());
    expect(await parent.exited).toBe(0);
    spawnedPids.add(orphanPid);
    await waitFor(() => isAlive(orphanPid));

    const differentDb = spawnMarkedBunWorker(fixture.script, other.dbPath, otherToken);
    const liveParentWorker = spawnMarkedBunWorker(fixture.script, fixture.dbPath, `live-${crypto.randomUUID()}`);
    const unrelated = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    spawnedPids.add(unrelated.pid);
    const lookalikeScript = join(fixture.root, "search-worker-lookalike.ts");
    writeFileSync(lookalikeScript, `setInterval(() => {}, 1_000);\n`);
    const lookalike = Bun.spawn(
      [process.execPath, "run", lookalikeScript, ...buildSearchWorkerIdentityArgs(fixture.dbPath, process.pid, `lookalike-${crypto.randomUUID()}`)],
      { stdout: "ignore", stderr: "ignore" },
    );
    spawnedPids.add(lookalike.pid);

    const result = await recoverOrphanedSearchWorkers({
      dbPath: fixture.dbPath,
      scriptPath: fixture.script,
      termTimeoutMs: 100,
      disappearanceTimeoutMs: 500,
    });

    expect(result.killed).toEqual([orphanPid]);
    await waitFor(() => !isAlive(orphanPid));
    spawnedPids.delete(orphanPid);
    expect(isAlive(differentDb.pid)).toBe(true);
    expect(isAlive(liveParentWorker.pid)).toBe(true);
    expect(isAlive(unrelated.pid)).toBe(true);
    expect(isAlive(lookalike.pid)).toBe(true);
  });

  test("pre-marker orphan is recovered only when lsof proves the same canonical DB handle", async () => {
    if (process.platform === "win32" || Bun.spawnSync(["sh", "-c", "command -v lsof"]).exitCode !== 0) return;
    const fixture = makeFixture();
    writeFileSync(fixture.dbPath, "");
    writeFileSync(
      fixture.script,
      `import { Database } from "bun:sqlite";\nconst db = new Database(process.env.FIXTURE_DB!);\ndb.exec("CREATE TABLE IF NOT EXISTS keep_open (id INTEGER)");\nsetInterval(() => void db.query("SELECT 1").get(), 1_000);\n`,
    );
    const parentScript = join(fixture.root, "spawn-legacy-parent.ts");
    writeFileSync(
      parentScript,
      `import { spawn } from "node:child_process";\nconst child = spawn(process.execPath, ["run", process.env.FIXTURE_SCRIPT!], { detached: true, stdio: "ignore", env: process.env });\nchild.unref();\nconsole.log(child.pid);\n`,
    );
    const parent = Bun.spawn([process.execPath, "run", parentScript], {
      env: { ...process.env, FIXTURE_DB: fixture.dbPath, FIXTURE_SCRIPT: fixture.script },
      stdout: "pipe",
      stderr: "pipe",
    });
    const orphanPid = Number((await new Response(parent.stdout).text()).trim());
    expect(await parent.exited).toBe(0);
    spawnedPids.add(orphanPid);
    await waitFor(() => {
      const lsof = Bun.spawnSync(["lsof", "-nP", "-t", "--", realpathSync(fixture.dbPath)]);
      return lsof.stdout.toString().split(/\s+/).includes(String(orphanPid));
    });
    const result = await recoverOrphanedSearchWorkers({
      dbPath: fixture.dbPath,
      scriptPath: fixture.script,
      termTimeoutMs: 100,
      disappearanceTimeoutMs: 500,
    });

    expect(result.killed).toEqual([orphanPid]);
    spawnedPids.delete(orphanPid);
    expect(isAlive(orphanPid)).toBe(false);
  }, 15_000);

  test("PID reuse evidence change fails open before any signal", async () => {
    const dbPath = "/tmp/reused.db";
    const dbIdentity = canonicalDatabaseIdentity(dbPath);
    const first: SearchWorkerProcessSnapshot = {
      pid: 4242,
      ppid: process.pid,
      startedAt: "Mon Aug 18 10:00:00 2026",
      command: `bun run /tmp/search-worker.ts --harness-mem-search-worker --harness-mem-db-id=${dbIdentity} --harness-mem-parent-pid=${process.pid} --harness-mem-worker-token=token`,
    };
    const reused = { ...first, startedAt: "Mon Aug 18 10:00:01 2026" };
    let reads = 0;
    const signals: string[] = [];
    const warnings: string[] = [];
    const ops: SearchWorkerProcessOps = {
      platform: "darwin",
      list: () => [first],
      inspect: () => (reads++ === 0 ? first : reused),
      signal: (_pid, signal) => signals.push(signal),
      sleep: async () => {},
    };

    const result = await stopSearchWorkerProcess({
      pid: first.pid,
      dbPath,
      workerToken: "token",
      scriptPath: "/tmp/search-worker.ts",
      expectedParentPid: process.pid,
      ops,
      warn: (message) => warnings.push(message),
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("identity_changed");
    expect(signals).toEqual([]);
    expect(warnings.join("\n")).not.toContain(dbPath);
  });

  test("marked orphan recovery remains available when optional lsof is missing", async () => {
    const dbPath = "/tmp/marked-without-lsof.db";
    const scriptPath = "/tmp/search-worker.ts";
    const token = "marked-token";
    const pid = 6101;
    const parentPid = 6100;
    const snapshot: SearchWorkerProcessSnapshot = {
      pid,
      ppid: 1,
      startedAt: "Wed Aug 19 11:00:00 2026",
      command: `bun run ${scriptPath} ${buildSearchWorkerIdentityArgs(dbPath, parentPid, token).join(" ")}`,
    };
    let childInspections = 0;
    const signals: string[] = [];
    const ops: SearchWorkerProcessOps = {
      platform: "linux",
      list: () => [snapshot],
      inspect: (inspectedPid) => {
        if (inspectedPid !== pid) return null;
        childInspections += 1;
        return childInspections === 1 ? snapshot : null;
      },
      signal: (_pid, signal) => signals.push(signal),
      sleep: async () => {},
      dbHolders: () => { throw new Error("lsof unavailable"); },
    };
    const warnings: string[] = [];

    const result = await recoverOrphanedSearchWorkers({
      dbPath,
      scriptPath,
      ops,
      warn: (message) => warnings.push(message),
    });

    expect(result.killed).toEqual([pid]);
    expect(signals).toEqual(["SIGTERM"]);
    expect(warnings.join("\n")).toContain("legacy_db_handle_inspection_unavailable");
  });

  test("owned handle failures never report a successful shutdown", async () => {
    const never = new Promise<number>(() => {});
    const termFailure = await stopOwnedSearchWorkerProcess({
      proc: {
        pid: 5001,
        exited: never,
        kill: () => { throw new Error("fixture signal failure"); },
      },
      termTimeoutMs: 1,
      disappearanceTimeoutMs: 1,
      warn: () => {},
    });
    expect(termFailure.status).toBe("still_running");
    expect(termFailure.reason).toBe("owned_term_failed");

    const signals: string[] = [];
    const unconfirmed = await stopOwnedSearchWorkerProcess({
      proc: {
        pid: 5002,
        exited: never,
        kill: (signal) => signals.push(String(signal)),
      },
      termTimeoutMs: 1,
      disappearanceTimeoutMs: 1,
      warn: () => {},
    });
    expect(unconfirmed.status).toBe("still_running");
    expect(unconfirmed.reason).toBe("owned_disappearance_unconfirmed");
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("client retains a failed owned handle, retries, and cannot respawn before exit", async () => {
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => { resolveExit = resolve; });
    const signals: string[] = [];
    const fakeProc = {
      pid: 6201,
      exited,
      kill: (signal: NodeJS.Signals) => {
        signals.push(signal);
        if (signals.length === 1) throw new Error("fixture TERM failure");
        if (signals.length === 3) resolveExit(0);
      },
    };
    const client = new PersistentSearchWorkerClient({
      scriptPath: "/tmp/search-worker.ts",
      cwd: "/tmp",
      env: {},
      maxPending: 1,
      dbPath: "/tmp/owned-retry.db",
    });
    const state = client as unknown as {
      proc: typeof fakeProc | null;
      stdinWriter: { end(): void } | null;
      workerToken: string | null;
    };
    state.proc = fakeProc;
    state.stdinWriter = { end() {} };
    state.workerToken = "owned-retry-token";

    let settled = false;
    const stopping = client.stop("fixture").finally(() => { settled = true; });
    await Bun.sleep(100);
    expect(settled).toBe(false);
    expect(state.proc).toBe(fakeProc);
    expect(() => client.ensureStarted()).toThrow("stopping");
    await stopping;
    expect(state.proc).toBeNull();
    expect(signals).toEqual(["SIGTERM", "SIGKILL", "SIGKILL"]);
    expect(() => client.ensureStarted()).toThrow("stopping");
  });

  test("win32 recovery is explicitly fail-open and never signals", async () => {
    const signals: string[] = [];
    const ops: SearchWorkerProcessOps = {
      platform: "win32",
      list: () => { throw new Error("must not inspect"); },
      inspect: () => { throw new Error("must not inspect"); },
      signal: (_pid, signal) => signals.push(signal),
      sleep: async () => {},
    };
    const warnings: string[] = [];
    const result = await recoverOrphanedSearchWorkers({
      dbPath: "C:\\fixture\\memory.db",
      scriptPath: "C:\\fixture\\search-worker.ts",
      ops,
      warn: (message) => warnings.push(message),
    });

    expect(result.unsupported).toBe(true);
    expect(signals).toEqual([]);
    expect(warnings.join("\n")).toContain("unsupported_platform");
    expect(warnings.join("\n")).not.toContain("memory.db");
  });
});
