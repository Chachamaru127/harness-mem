import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  dir: string;
  workspaceRoot: string;
  project: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-antigravity-${name}-`));
  const workspaceRoot = join(dir, "antigravity-project");
  mkdirSync(workspaceRoot, { recursive: true });
  const project = "antigravity-project";

  const port = 39900 + Math.floor(Math.random() * 1000);
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
    antigravityWorkspaceRoots: [workspaceRoot],
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

describe("antigravity files ingest integration", () => {
  test("ingests checkpoints/codex-responses with delta and backfill control", async () => {
    const runtime = createRuntime("files");
    const { baseUrl, workspaceRoot, project } = runtime;

    try {
      const checkpointsDir = join(workspaceRoot, "docs", "checkpoints");
      const responsesDir = join(workspaceRoot, "logs", "codex-responses");
      mkdirSync(checkpointsDir, { recursive: true });
      mkdirSync(responsesDir, { recursive: true });

      const oldCheckpointPath = join(checkpointsDir, "old-checkpoint.md");
      writeFileSync(oldCheckpointPath, "# Checkpoint old\n\n- old", "utf8");
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      utimesSync(oldCheckpointPath, old, old);

      const newCheckpointPath = join(checkpointsDir, "2026-02-16.md");
      writeFileSync(newCheckpointPath, "# Checkpoint: 2026-02-16\n\n## 完了した作業\n- A", "utf8");

      const designResponsePath = join(responsesDir, "design-20260216_010101.md");
      writeFileSync(designResponsePath, "## Design proposal\nUse layered architecture.", "utf8");

      const ingest1Res = await fetch(`${baseUrl}/v1/ingest/antigravity-history`, { method: "POST" });
      expect(ingest1Res.ok).toBe(true);
      const ingest1 = (await ingest1Res.json()) as {
        ok: boolean;
        items: Array<{
          events_imported: number;
          files_scanned: number;
          files_skipped_backfill: number;
          checkpoint_events_imported: number;
          tool_events_imported: number;
        }>;
      };
      expect(ingest1.ok).toBe(true);
      expect(ingest1.items[0]?.events_imported).toBe(2);
      expect(ingest1.items[0]?.files_scanned).toBeGreaterThanOrEqual(3);
      expect(ingest1.items[0]?.files_skipped_backfill).toBeGreaterThanOrEqual(1);
      expect(ingest1.items[0]?.checkpoint_events_imported).toBe(1);
      expect(ingest1.items[0]?.tool_events_imported).toBe(1);

      const feedRes = await fetch(`${baseUrl}/v1/feed?project=${project}&limit=20&include_private=false`);
      expect(feedRes.ok).toBe(true);
      const feed = (await feedRes.json()) as {
        ok: boolean;
        items: Array<{ platform: string; event_type: string; project: string }>;
      };
      expect(feed.ok).toBe(true);
      expect(feed.items.length).toBe(2);
      expect(feed.items.every((item) => item.platform === "antigravity")).toBe(true);
      expect(feed.items.every((item) => item.project === project)).toBe(true);

      appendFileSync(designResponsePath, "\n\n## Refined\nHandle edge cases.", "utf8");
      const now = new Date();
      utimesSync(designResponsePath, now, now);

      const ingest2Res = await fetch(`${baseUrl}/v1/ingest/antigravity-files`, { method: "POST" });
      expect(ingest2Res.ok).toBe(true);
      const ingest2 = (await ingest2Res.json()) as { ok: boolean; items: Array<{ events_imported: number }> };
      expect(ingest2.ok).toBe(true);
      expect(ingest2.items[0]?.events_imported).toBe(1);
    } finally {
      runtime.stop();
    }
  });
});
