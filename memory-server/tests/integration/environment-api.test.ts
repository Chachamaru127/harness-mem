import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  core: HarnessMemCore;
  dir: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-environment-api-${name}-`));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };

  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  const port = server.port;
  return {
    core,
    dir,
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("environment API integration", () => {
  test("requires admin token and points to the RouteCLI dashboard", async () => {
    const prevToken = process.env.HARNESS_MEM_ADMIN_TOKEN;
    process.env.HARNESS_MEM_ADMIN_TOKEN = "test-admin-token";

    const runtime = createRuntime("moved");
    try {
      const withoutToken = await fetch(`${runtime.baseUrl}/v1/admin/environment`);
      expect(withoutToken.status).toBe(401);

      const withToken = await fetch(`${runtime.baseUrl}/v1/admin/environment`, {
        headers: { "x-harness-mem-token": "test-admin-token" },
      });
      expect(withToken.status).toBe(410);
      const payload = (await withToken.json()) as Record<string, unknown>;
      expect(payload.ok).toBe(false);
      expect(payload.error).toBe("environment_moved");
      expect(payload.moved_to).toBe("http://127.0.0.1:8765/");
    } finally {
      runtime.stop();
      if (prevToken === undefined) delete process.env.HARNESS_MEM_ADMIN_TOKEN;
      else process.env.HARNESS_MEM_ADMIN_TOKEN = prevToken;
    }
  });
});
