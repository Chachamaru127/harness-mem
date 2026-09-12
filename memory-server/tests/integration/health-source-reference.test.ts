import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A FIFO is an actual blocking filesystem input, not a mocked health method.
// Run the daemon in a child so a regression cannot block the test runner itself.
test.skipIf(process.platform === "win32")("health does not open an unresponsive Antigravity workspace metadata file", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-health-source-"));
  const storage = join(root, "workspace-storage");
  mkdirSync(join(storage, "entry"), { recursive: true });
  const fifo = Bun.spawnSync(["mkfifo", join(storage, "entry/workspace.json")]);
  expect(fifo.exitCode).toBe(0);
  const script = join(root, "runtime.ts");
  const config = {
    dbPath: join(root, "memory.db"), bindHost: "127.0.0.1", bindPort: 0,
    vectorDimension: 64, embeddingProvider: "fallback", captureEnabled: true,
    retrievalEnabled: true, injectionEnabled: true, codexHistoryEnabled: false,
    codexProjectRoot: root, codexSessionsRoot: root, codexIngestIntervalMs: 5000,
    codexBackfillHours: 24, opencodeIngestEnabled: false, cursorIngestEnabled: false,
    antigravityIngestEnabled: false, antigravityWorkspaceStorageRoot: storage,
    geminiIngestEnabled: false, claudeCodeIngestEnabled: false,
    backgroundWorkersEnabled: false, consolidationEnabled: false,
  };
  writeFileSync(script, `
import { HarnessMemCore } from ${JSON.stringify(new URL("../../src/core/harness-mem-core.ts", import.meta.url).pathname)};
import { startHarnessMemServer } from ${JSON.stringify(new URL("../../src/server.ts", import.meta.url).pathname)};
const config = ${JSON.stringify(config)};
const core = new HarnessMemCore(config);
const server = startHarnessMemServer(core, config);
console.log(JSON.stringify({ port: server.port }));
`);
  const proc = Bun.spawn([process.execPath, "run", script], {
    stdin: "ignore", stdout: "pipe", stderr: "ignore", env: {
      ...process.env, NODE_ENV: "test", HARNESS_MEM_HOME: root,
      HARNESS_MEM_CONFIG_PATH: join(root, "no-user-config.json"),
      HARNESS_MEM_EMBEDDING_PROVIDER: "fallback", HARNESS_MEM_BACKGROUND_WORKERS_ENABLED: "false",
    },
  });
  const reader = proc.stdout.getReader();
  try {
    const startup = await Promise.race([
      reader.read(),
      Bun.sleep(5000).then(() => { throw new Error("test daemon startup deadline exceeded"); }),
    ]);
    expect(startup.done).toBe(false);
    const { port } = JSON.parse(new TextDecoder().decode(startup.value));
    const baseUrl = `http://127.0.0.1:${port}`;
    for (const endpoint of ["/health", "/health/ready"]) {
      const response = await fetch(baseUrl + endpoint, { signal: AbortSignal.timeout(1000) });
      expect(response.status).toBe(200);
      expect((await response.json()).ok).toBe(true);
    }
    const record = await fetch(baseUrl + "/v1/events/record", {
      method: "POST", headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(1000), body: JSON.stringify({ event: {
        event_id: "health-fifo-record", platform: "codex", project: "health-fifo-project",
        session_id: "health-fifo-session", event_type: "user_prompt",
        ts: new Date().toISOString(), payload: { content: "healthfifosurvivor" }, tags: [], privacy_tags: [],
      } }),
    });
    expect(record.status).toBe(200);
    expect((await record.json()).ok).toBe(true);
    const search = await fetch(baseUrl + "/v1/search", {
      method: "POST", headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(1000), body: JSON.stringify({
        query: "healthfifosurvivor", project: "health-fifo-project", strict_project: true,
        include_private: true, vector_search: false,
      }),
    });
    const result = await search.json();
    expect(search.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item: { project: string }) => item.project === "health-fifo-project")).toBe(true);
  } finally {
    proc.kill("SIGKILL");
    await Promise.race([proc.exited, Bun.sleep(2000).then(() => { throw new Error("test daemon did not exit"); })]);
    await reader.cancel();
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
