import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  core: HarnessMemCore;
  dir: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-consolidation-api-${name}-`));
  const port = 41100 + Math.floor(Math.random() * 1000);
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: port,
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
  return {
    core,
    dir,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("consolidation admin API", () => {
  test("run/status/audit endpoints are available", async () => {
    const runtime = createRuntime("admin");
    try {
      await postJson(runtime.baseUrl, "/v1/events/record", {
        event: {
          event_id: "consolidation-api-1",
          platform: "codex",
          project: "consolidation-api",
          session_id: "consolidation-api-session",
          event_type: "user_prompt",
          payload: { content: "We decided to standardize on sqlite." },
          tags: ["decision"],
          privacy_tags: [],
        },
      });

      const runResponse = await postJson(runtime.baseUrl, "/v1/admin/consolidation/run", { reason: "api-test" });
      expect(runResponse.status).toBe(200);

      const statusResponse = await fetch(`${runtime.baseUrl}/v1/admin/consolidation/status`);
      expect(statusResponse.status).toBe(200);

      const auditResponse = await fetch(`${runtime.baseUrl}/v1/admin/audit-log?limit=10`);
      expect(auditResponse.status).toBe(200);

      const runPayload = (await runResponse.json()) as Record<string, unknown>;
      const statusPayload = (await statusResponse.json()) as Record<string, unknown>;
      const auditPayload = (await auditResponse.json()) as Record<string, unknown>;
      expect(runPayload.ok).toBe(true);
      expect(statusPayload.ok).toBe(true);
      expect(auditPayload.ok).toBe(true);
    } finally {
      runtime.stop();
    }
  });
});
