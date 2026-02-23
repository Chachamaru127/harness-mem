import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  const port = 42200 + Math.floor(Math.random() * 1000);
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

describe("environment API integration", () => {
  test("requires admin token and returns masked environment payload", async () => {
    const runtime = createRuntime("auth");
    const prevToken = process.env.HARNESS_MEM_ADMIN_TOKEN;
    const prevHome = process.env.HARNESS_MEM_HOME;
    const stateDir = mkdtempSync(join(tmpdir(), "harness-mem-env-state-"));

    try {
      mkdirSync(join(stateDir, "versions"), { recursive: true });
      mkdirSync(join(stateDir, "runtime"), { recursive: true });

      writeFileSync(
        join(stateDir, "versions", "tool-versions.json"),
        JSON.stringify(
          {
            local: {
              codex: { installed: "codex-cli token=sk-abcdefghijklmnopqrstuvwxyz123456" },
            },
            upstream: {
              codex: { latest_stable: "rust-v0.104.0" },
            },
            status: {
              codex: "up_to_date",
            },
          },
          null,
          2
        )
      );

      writeFileSync(
        join(stateDir, "runtime", "doctor-last.json"),
        JSON.stringify(
          {
            all_green: true,
            checks: [{ name: "codex_wiring", status: "ok", fix: null }],
          },
          null,
          2
        )
      );

      process.env.HARNESS_MEM_ADMIN_TOKEN = "test-admin-token";
      process.env.HARNESS_MEM_HOME = stateDir;

      const withoutToken = await fetch(`${runtime.baseUrl}/v1/admin/environment`);
      expect(withoutToken.status).toBe(401);

      const withToken = await fetch(`${runtime.baseUrl}/v1/admin/environment`, {
        headers: {
          "x-harness-mem-token": "test-admin-token",
        },
      });
      expect(withToken.status).toBe(200);

      const payload = (await withToken.json()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      const item = ((payload.items as Array<Record<string, unknown>>) || [])[0] || {};
      expect(item.summary).toBeDefined();
      expect(item.servers).toBeDefined();
      expect(item.languages).toBeDefined();
      expect(item.cli_tools).toBeDefined();
      expect(item.ai_tools).toBeDefined();

      const serialized = JSON.stringify(item);
      expect(serialized.includes("sk-abcdefghijklmnopqrstuvwxyz123456")).toBe(false);
      expect(serialized.includes("[REDACTED_SECRET]")).toBe(true);
    } finally {
      if (prevToken === undefined) {
        delete process.env.HARNESS_MEM_ADMIN_TOKEN;
      } else {
        process.env.HARNESS_MEM_ADMIN_TOKEN = prevToken;
      }
      if (prevHome === undefined) {
        delete process.env.HARNESS_MEM_HOME;
      } else {
        process.env.HARNESS_MEM_HOME = prevHome;
      }
      runtime.stop();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("returns degraded ai_tools data when snapshots are missing", async () => {
    const runtime = createRuntime("degraded");
    const prevToken = process.env.HARNESS_MEM_ADMIN_TOKEN;
    const prevHome = process.env.HARNESS_MEM_HOME;
    const stateDir = mkdtempSync(join(tmpdir(), "harness-mem-env-empty-"));

    try {
      process.env.HARNESS_MEM_ADMIN_TOKEN = "test-admin-token";
      process.env.HARNESS_MEM_HOME = stateDir;

      const response = await fetch(`${runtime.baseUrl}/v1/admin/environment`, {
        headers: {
          authorization: "Bearer test-admin-token",
        },
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);

      const item = ((payload.items as Array<Record<string, unknown>>) || [])[0] || {};
      const aiTools = (item.ai_tools || []) as Array<Record<string, unknown>>;
      const errors = (item.errors || []) as Array<Record<string, unknown>>;

      expect(aiTools.length).toBeGreaterThan(0);
      expect(aiTools.some((entry) => entry.status === "missing" || entry.status === "warning")).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      if (prevToken === undefined) {
        delete process.env.HARNESS_MEM_ADMIN_TOKEN;
      } else {
        process.env.HARNESS_MEM_ADMIN_TOKEN = prevToken;
      }
      if (prevHome === undefined) {
        delete process.env.HARNESS_MEM_HOME;
      } else {
        process.env.HARNESS_MEM_HOME = prevHome;
      }
      runtime.stop();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
