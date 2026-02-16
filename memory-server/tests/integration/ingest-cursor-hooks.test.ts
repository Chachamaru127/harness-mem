import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  dir: string;
  cursorEventsPath: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-cursor-hooks-${name}-`));
  const cursorEventsPath = join(dir, "cursor", "events.jsonl");
  mkdirSync(join(dir, "cursor"), { recursive: true });

  const port = 39800 + Math.floor(Math.random() * 1000);
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
    cursorIngestEnabled: true,
    cursorEventsPath,
    cursorIngestIntervalMs: 3600000,
    cursorBackfillHours: 24,
    antigravityIngestEnabled: false,
  };

  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);

  return {
    dir,
    cursorEventsPath,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("cursor hooks ingest integration", () => {
  test("skips old backfill, ingests delta, and separates projects", async () => {
    const runtime = createRuntime("hooks");
    const { baseUrl, cursorEventsPath } = runtime;

    try {
      writeFileSync(
        cursorEventsPath,
        `${JSON.stringify({
          hook_event_name: "beforeSubmitPrompt",
          conversation_id: "cursor-old-1",
          workspace_roots: ["/Users/test/Desktop/Code/CC-harness/old-project"],
          prompt: "old prompt",
          timestamp: "2026-02-14T00:00:00.000Z",
        })}\n`,
        "utf8"
      );
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      utimesSync(cursorEventsPath, old, old);

      const firstIngestRes = await fetch(`${baseUrl}/v1/ingest/cursor-history`, { method: "POST" });
      expect(firstIngestRes.ok).toBe(true);
      const firstIngest = (await firstIngestRes.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number; files_scanned: number; files_skipped_backfill: number }>;
      };
      expect(firstIngest.ok).toBe(true);
      expect(firstIngest.items[0]?.events_imported).toBe(0);
      expect(firstIngest.items[0]?.files_scanned).toBe(1);
      expect(firstIngest.items[0]?.files_skipped_backfill).toBe(1);

      appendFileSync(
        cursorEventsPath,
        [
          JSON.stringify({
            hook_event_name: "beforeSubmitPrompt",
            conversation_id: "cursor-live-1",
            workspace_roots: ["/Users/test/Desktop/Code/CC-harness/harness-mem"],
            prompt: "今の手動テストです",
            timestamp: "2026-02-16T10:00:00.000Z",
          }),
          JSON.stringify({
            hook_event_name: "afterShellExecution",
            conversation_id: "cursor-live-2",
            workspace_roots: ["/Users/test/Desktop/Code/CC-harness/Context-Harness"],
            command: "rg -n TODO src",
            output: "src/a.ts:1: TODO",
            timestamp: "2026-02-16T10:00:01.000Z",
          }),
          JSON.stringify({
            hook_event_name: "stop",
            conversation_id: "cursor-live-2",
            workspace_roots: ["/Users/test/Desktop/Code/CC-harness/Context-Harness"],
            status: "completed",
            timestamp: "2026-02-16T10:00:02.000Z",
          }),
        ].join("\n") + "\n",
        "utf8"
      );

      const now = new Date();
      utimesSync(cursorEventsPath, now, now);

      const secondIngestRes = await fetch(`${baseUrl}/v1/ingest/cursor-events`, { method: "POST" });
      expect(secondIngestRes.ok).toBe(true);
      const secondIngest = (await secondIngestRes.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number }>;
      };
      expect(secondIngest.ok).toBe(true);
      expect(secondIngest.items[0]?.events_imported).toBe(3);

      const harnessFeedRes = await fetch(`${baseUrl}/v1/feed?project=harness-mem&limit=20&include_private=false`);
      expect(harnessFeedRes.ok).toBe(true);
      const harnessFeed = (await harnessFeedRes.json()) as { ok: boolean; items: Array<{ project: string }> };
      expect(harnessFeed.ok).toBe(true);
      expect(harnessFeed.items.length).toBe(1);
      expect(harnessFeed.items[0]?.project).toBe("harness-mem");

      const contextFeedRes = await fetch(`${baseUrl}/v1/feed?project=Context-Harness&limit=20&include_private=false`);
      expect(contextFeedRes.ok).toBe(true);
      const contextFeed = (await contextFeedRes.json()) as {
        ok: boolean;
        items: Array<{ event_type: string; project: string }>;
      };
      expect(contextFeed.ok).toBe(true);
      expect(contextFeed.items.length).toBe(2);
      expect(contextFeed.items.every((item) => item.project === "Context-Harness")).toBe(true);
      expect(contextFeed.items.some((item) => item.event_type === "tool_use")).toBe(true);
      expect(contextFeed.items.some((item) => item.event_type === "session_end")).toBe(true);
    } finally {
      runtime.stop();
    }
  });
});
