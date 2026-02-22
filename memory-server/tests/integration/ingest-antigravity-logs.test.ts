import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function fileUriFromPath(pathValue: string): string {
  return `file://${pathValue}`;
}

function createRuntime(name: string): {
  dir: string;
  workspaceRoot: string;
  project: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-antigravity-logs-${name}-`));
  const workspaceRoot = join(dir, "harness-mem");
  mkdirSync(workspaceRoot, { recursive: true });
  const project = realpathSync(workspaceRoot);

  const logsRoot = join(dir, "Library", "Application Support", "Antigravity", "logs");
  const storageRoot = join(dir, "Library", "Application Support", "Antigravity", "User", "workspaceStorage");
  const workspaceId = "946865c1007fef2348e2f68ec04c0884";
  const workspaceStorageDir = join(storageRoot, workspaceId);
  mkdirSync(workspaceStorageDir, { recursive: true });
  writeFileSync(
    join(workspaceStorageDir, "workspace.json"),
    JSON.stringify({ folder: fileUriFromPath(workspaceRoot) }, null, 2),
    "utf8"
  );

  const windowDir = join(logsRoot, "20260216T183635", "window1", "exthost");
  const extHostLogPath = join(windowDir, "exthost.log");
  const antigravityLogPath = join(windowDir, "google.antigravity", "Antigravity.log");
  mkdirSync(join(windowDir, "google.antigravity"), { recursive: true });
  writeFileSync(
    extHostLogPath,
    `2026-02-16 18:37:31.514 [info] Skipping acquiring lock for ${storageRoot}/${workspaceId}.\n`,
    "utf8"
  );
  writeFileSync(
    antigravityLogPath,
    [
      "2026-02-16 18:37:32.368 [info] language server ready",
      "2026-02-16 18:38:24.369 [info] I0216 18:38:24.369166 91838 planner_generator.go:275] Requesting planner with 5 chat messages at model retry attempt 1 and API retry attempt 1",
      "",
    ].join("\n"),
    "utf8"
  );

  const port = 41000 + Math.floor(Math.random() * 1000);
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: port,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: dir,
    codexSessionsRoot: join(dir, "codex-sessions"),
    codexIngestIntervalMs: 3600000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: true,
    antigravityWorkspaceRoots: [],
    antigravityLogsRoot: logsRoot,
    antigravityWorkspaceStorageRoot: storageRoot,
    antigravityIngestIntervalMs: 3600000,
    antigravityBackfillHours: 24,
  };

  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);

  return {
    dir,
    workspaceRoot,
    project,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("antigravity logs ingest integration", () => {
  test("ingests planner activity logs as antigravity checkpoint events", async () => {
    const runtime = createRuntime("planner");
    const { baseUrl, project } = runtime;

    try {
      const ingestRes = await fetch(`${baseUrl}/v1/ingest/antigravity-history`, { method: "POST" });
      expect(ingestRes.ok).toBe(true);
      const ingest = (await ingestRes.json()) as {
        ok: boolean;
        items: Array<{
          events_imported: number;
          log_events_imported: number;
          log_files_scanned: number;
        }>;
        meta: Record<string, unknown>;
      };
      expect(ingest.ok).toBe(true);
      expect(ingest.items[0]?.events_imported).toBe(1);
      expect(ingest.items[0]?.log_events_imported).toBe(1);
      expect(ingest.items[0]?.log_files_scanned).toBeGreaterThanOrEqual(1);
      expect(ingest.meta.ingest_mode).toBe("antigravity_hybrid_v1");

      const feedRes = await fetch(`${baseUrl}/v1/feed?project=${encodeURIComponent(project)}&limit=10&include_private=false`);
      expect(feedRes.ok).toBe(true);
      const feed = (await feedRes.json()) as {
        ok: boolean;
        items: Array<{ platform: string; event_type: string; project: string; title: string; content: string }>;
      };
      expect(feed.ok).toBe(true);
      expect(feed.items.length).toBe(1);
      expect(feed.items[0]?.platform).toBe("antigravity");
      expect(feed.items[0]?.event_type).toBe("checkpoint");
      expect(feed.items[0]?.project).toBe(project);
      expect(feed.items[0]?.title).toBe("Antigravity planner activity");
      expect(feed.items[0]?.content.includes("prompt body unavailable")).toBe(true);

      const ingestAgainRes = await fetch(`${baseUrl}/v1/ingest/antigravity-history`, { method: "POST" });
      expect(ingestAgainRes.ok).toBe(true);
      const ingestAgain = (await ingestAgainRes.json()) as { ok: boolean; items: Array<{ events_imported: number }> };
      expect(ingestAgain.ok).toBe(true);
      expect(ingestAgain.items[0]?.events_imported).toBe(0);
    } finally {
      runtime.stop();
    }
  });
});
