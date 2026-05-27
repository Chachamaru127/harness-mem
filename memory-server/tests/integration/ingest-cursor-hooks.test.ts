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

  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
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
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("cursor hooks ingest integration", () => {
  test("skips old backfill, ingests delta, separates projects, and search finds prompt + assistant", async () => {
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

      const harnessProject = join(runtime.dir, "cursor-ingest-harness-project");
      const contextProject = join(runtime.dir, "cursor-ingest-context-project");
      const userPromptPhrase = "cursor hooks ingest user prompt proof";
      const assistantPhrase = "cursor hooks ingest assistant response proof";

      appendFileSync(
        cursorEventsPath,
        [
          JSON.stringify({
            hook_event_name: "sessionStart",
            conversation_id: "cursor-live-1",
            workspace_roots: [harnessProject],
            composer_mode: "agent",
            timestamp: "2026-02-16T09:59:00.000Z",
          }),
          JSON.stringify({
            hook_event_name: "beforeSubmitPrompt",
            conversation_id: "cursor-live-1",
            generation_id: "gen-user-1",
            transcript_path: "/tmp/transcripts/cursor-live-1.jsonl",
            workspace_roots: [harnessProject],
            prompt: userPromptPhrase,
            timestamp: "2026-02-16T10:00:00.000Z",
          }),
          JSON.stringify({
            hook_event_name: "afterAgentResponse",
            conversation_id: "cursor-live-1",
            generation_id: "gen-assistant-1",
            transcript_path: "/tmp/transcripts/cursor-live-1.jsonl",
            workspace_roots: [harnessProject],
            text: assistantPhrase,
            timestamp: "2026-02-16T10:00:00.500Z",
          }),
          JSON.stringify({
            hook_event_name: "afterShellExecution",
            conversation_id: "cursor-live-2",
            workspace_roots: [contextProject],
            command: "rg -n TODO src",
            output: "src/a.ts:1: TODO",
            timestamp: "2026-02-16T10:00:01.000Z",
          }),
          JSON.stringify({
            hook_event_name: "sessionEnd",
            conversation_id: "cursor-live-2",
            workspace_roots: [contextProject],
            reason: "completed",
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
      expect(secondIngest.items[0]?.events_imported).toBe(5);

      const harnessFeedRes = await fetch(
        `${baseUrl}/v1/feed?project=${encodeURIComponent(harnessProject)}&limit=20&include_private=false`
      );
      expect(harnessFeedRes.ok).toBe(true);
      const harnessFeed = (await harnessFeedRes.json()) as {
        ok: boolean;
        items: Array<{ project: string; event_type: string }>;
      };
      expect(harnessFeed.ok).toBe(true);
      expect(harnessFeed.items.length).toBeGreaterThanOrEqual(3);
      expect(harnessFeed.items.every((item) => item.project === harnessProject)).toBe(true);
      expect(harnessFeed.items.some((item) => item.event_type === "user_prompt")).toBe(true);
      expect(harnessFeed.items.some((item) => item.event_type === "checkpoint")).toBe(true);
      expect(harnessFeed.items.some((item) => item.event_type === "session_start")).toBe(true);

      const contextFeedRes = await fetch(
        `${baseUrl}/v1/feed?project=${encodeURIComponent(contextProject)}&limit=20&include_private=false`
      );
      expect(contextFeedRes.ok).toBe(true);
      const contextFeed = (await contextFeedRes.json()) as {
        ok: boolean;
        items: Array<{ event_type: string; project: string }>;
      };
      expect(contextFeed.ok).toBe(true);
      expect(contextFeed.items.length).toBe(2);
      expect(contextFeed.items.every((item) => item.project === contextProject)).toBe(true);
      expect(contextFeed.items.some((item) => item.event_type === "tool_use")).toBe(true);
      expect(contextFeed.items.some((item) => item.event_type === "session_end")).toBe(true);

      const promptSearchRes = await fetch(`${baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: userPromptPhrase,
          project: harnessProject,
          limit: 10,
          vector_search: false,
        }),
      });
      expect(promptSearchRes.ok).toBe(true);
      const promptSearch = (await promptSearchRes.json()) as {
        ok: boolean;
        items: Array<{ title?: string; content?: string }>;
        meta?: {
          latest_interaction?: {
            prompt?: { content?: string };
            response?: { content?: string };
          };
        };
      };
      expect(promptSearch.ok).toBe(true);
      expect(
        (promptSearch.items || []).some(
          (row) =>
            (row.title || "").includes("Cursor prompt") || (row.content || "").includes(userPromptPhrase)
        )
      ).toBe(true);
      expect(promptSearch.meta?.latest_interaction?.prompt?.content).toContain(userPromptPhrase);
      expect(promptSearch.meta?.latest_interaction?.response?.content).toContain(assistantPhrase);

      const assistantSearchRes = await fetch(`${baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: assistantPhrase,
          project: harnessProject,
          limit: 10,
          vector_search: false,
        }),
      });
      expect(assistantSearchRes.ok).toBe(true);
      const assistantSearch = (await assistantSearchRes.json()) as {
        ok: boolean;
        items: Array<{ title?: string; content?: string }>;
      };
      expect(assistantSearch.ok).toBe(true);
      expect(
        (assistantSearch.items || []).some(
          (row) =>
            (row.title || "").includes("assistant_response") ||
            (row.content || "").includes(assistantPhrase)
        )
      ).toBe(true);
    } finally {
      runtime.stop();
    }
  });
});
