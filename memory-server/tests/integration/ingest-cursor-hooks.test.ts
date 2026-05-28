import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { IngestCoordinator } from "../../src/core/ingest-coordinator";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import type { ApiResponse, EventEnvelope } from "../../src/core/types";
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
  test("stops offset at failed recordEvent line and retries it on next ingest", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-cursor-hooks-retry-"));
    const cursorEventsPath = join(dir, "cursor", "events.jsonl");
    mkdirSync(join(dir, "cursor"), { recursive: true });

    const firstLine = JSON.stringify({
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: "cursor-retry-1",
      workspace_roots: [join(dir, "project")],
      prompt: "cursor hook retry first prompt",
      timestamp: "2026-02-16T10:00:00.000Z",
    });
    const secondPrompt = "cursor hook retry second prompt";
    const secondLine = JSON.stringify({
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: "cursor-retry-1",
      workspace_roots: [join(dir, "project")],
      prompt: secondPrompt,
      timestamp: "2026-02-16T10:00:01.000Z",
    });
    const fileContent = `${firstLine}\n${secondLine}\n`;
    writeFileSync(cursorEventsPath, fileContent, "utf8");

    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE mem_ingest_offsets(
        source_key TEXT PRIMARY KEY,
        offset INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

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
      cursorIngestEnabled: true,
      cursorEventsPath,
      cursorBackfillHours: 24,
    };

    const okResponse = (): ApiResponse => ({
      ok: true,
      source: "core",
      items: [],
      meta: {
        count: 0,
        latency_ms: 0,
        sla_latency_ms: 200,
        filters: {},
        ranking: "test",
      },
    });
    const failResponse = (): ApiResponse => ({
      ok: false,
      source: "core",
      items: [],
      meta: {
        count: 0,
        latency_ms: 0,
        sla_latency_ms: 200,
        filters: {},
        ranking: "test",
      },
      error: "write embedding is unavailable: local ONNX model is still warming up",
    });

    const recorded: EventEnvelope[] = [];
    let failSecondPrompt = true;
    const coordinator = new IngestCoordinator({
      db,
      config,
      recordEvent: (event) => {
        recorded.push(event);
        if (failSecondPrompt && event.payload?.prompt === secondPrompt) {
          return failResponse();
        }
        return okResponse();
      },
      recordEventQueued: async () => okResponse(),
      upsertSessionSummary: () => {},
      heartbeatPath: join(dir, "heartbeat.json"),
      isShuttingDown: () => false,
      processRetryQueue: () => {},
      runConsolidation: async () => {},
    });

    try {
      const failedLineOffset = Buffer.byteLength(`${firstLine}\n`, "utf8");
      const firstIngest = coordinator.ingestCursorHistory();
      expect(firstIngest.ok).toBe(true);
      expect(firstIngest.items[0]).toMatchObject({
        events_imported: 1,
        hooks_events_imported: 1,
        hooks_events_failed: 1,
        retry_offset: failedLineOffset,
      });
      expect((firstIngest.items[0] as { last_record_error?: string }).last_record_error).toContain(
        "write embedding is unavailable"
      );
      expect(recorded.map((event) => event.payload?.prompt)).toEqual([
        "cursor hook retry first prompt",
        secondPrompt,
      ]);

      const offsetAfterFailure = db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(`cursor_hooks:${cursorEventsPath}`) as { offset: number } | null;
      expect(offsetAfterFailure?.offset).toBe(failedLineOffset);

      recorded.length = 0;
      failSecondPrompt = false;
      const secondIngest = coordinator.ingestCursorHistory();
      expect(secondIngest.ok).toBe(true);
      expect(secondIngest.items[0]).toMatchObject({
        events_imported: 1,
        hooks_events_imported: 1,
        hooks_events_failed: 0,
      });
      expect(recorded.map((event) => event.payload?.prompt)).toEqual([secondPrompt]);

      const offsetAfterRetry = db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(`cursor_hooks:${cursorEventsPath}`) as { offset: number } | null;
      expect(offsetAfterRetry?.offset).toBe(Buffer.byteLength(fileContent, "utf8"));
    } finally {
      db.close(false);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bounds cursor hook ingest work per run and resumes from deferred offset", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-cursor-hooks-bounded-"));
    const cursorEventsPath = join(dir, "cursor", "events.jsonl");
    mkdirSync(join(dir, "cursor"), { recursive: true });

    const lines = Array.from({ length: 55 }, (_, index) =>
      JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: "cursor-bounded-1",
        workspace_roots: [join(dir, "project")],
        prompt: `cursor bounded prompt ${index}`,
        timestamp: `2026-02-16T10:00:${String(index).padStart(2, "0")}.000Z`,
      })
    );
    const fileContent = `${lines.join("\n")}\n`;
    writeFileSync(cursorEventsPath, fileContent, "utf8");

    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE mem_ingest_offsets(
        source_key TEXT PRIMARY KEY,
        offset INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

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
      cursorIngestEnabled: true,
      cursorEventsPath,
      cursorBackfillHours: 24,
    };

    const okResponse = (): ApiResponse => ({
      ok: true,
      source: "core",
      items: [],
      meta: {
        count: 0,
        latency_ms: 0,
        sla_latency_ms: 200,
        filters: {},
        ranking: "test",
      },
    });

    const recorded: EventEnvelope[] = [];
    const coordinator = new IngestCoordinator({
      db,
      config,
      recordEvent: (event) => {
        recorded.push(event);
        return okResponse();
      },
      recordEventQueued: async () => okResponse(),
      upsertSessionSummary: () => {},
      heartbeatPath: join(dir, "heartbeat.json"),
      isShuttingDown: () => false,
      processRetryQueue: () => {},
      runConsolidation: async () => {},
    });

    try {
      const deferredOffset = Buffer.byteLength(`${lines.slice(0, 50).join("\n")}\n`, "utf8");
      const firstIngest = coordinator.ingestCursorHistory();
      expect(firstIngest.ok).toBe(true);
      expect(firstIngest.items[0]).toMatchObject({
        events_imported: 50,
        hooks_events_imported: 50,
        hooks_events_failed: 0,
        hooks_events_deferred: 5,
        retry_offset: deferredOffset,
      });
      expect(recorded).toHaveLength(50);

      const offsetAfterFirst = db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(`cursor_hooks:${cursorEventsPath}`) as { offset: number } | null;
      expect(offsetAfterFirst?.offset).toBe(deferredOffset);

      recorded.length = 0;
      const secondIngest = coordinator.ingestCursorHistory();
      expect(secondIngest.ok).toBe(true);
      expect(secondIngest.items[0]).toMatchObject({
        events_imported: 5,
        hooks_events_imported: 5,
        hooks_events_failed: 0,
        hooks_events_deferred: 0,
      });
      expect(recorded).toHaveLength(5);

      const offsetAfterSecond = db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(`cursor_hooks:${cursorEventsPath}`) as { offset: number } | null;
      expect(offsetAfterSecond?.offset).toBe(Buffer.byteLength(fileContent, "utf8"));
    } finally {
      db.close(false);
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
