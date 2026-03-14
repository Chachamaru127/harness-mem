import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  dir: string;
  sessionsRoot: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-codex-sessions-${name}-`));
  const sessionsRoot = join(dir, "codex-sessions");
  mkdirSync(sessionsRoot, { recursive: true });

  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: true,
    codexProjectRoot: dir,
    codexSessionsRoot: sessionsRoot,
    codexIngestIntervalMs: 3600000,
    codexBackfillHours: 24,
  };

  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  const port = server.port;

  return {
    dir,
    sessionsRoot,
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("codex sessions ingest integration", () => {
  test("ingests rollout files, skips old backfill, and only imports appended delta", async () => {
    const runtime = createRuntime("hybrid");
    const { baseUrl, sessionsRoot } = runtime;

    try {
      const dayDir = join(sessionsRoot, "2026", "02", "15");
      mkdirSync(dayDir, { recursive: true });

      const activePath = join(
        dayDir,
        "rollout-2026-02-15T15-00-00-11111111-1111-1111-1111-111111111111.jsonl"
      );
      const activeLines = [
        JSON.stringify({
          timestamp: "2026-02-15T15:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "11111111-1111-1111-1111-111111111111",
            cwd: "/Users/example/Desktop/Code/CC-harness/harness-mem",
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-15T15:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "初回の日本語メッセージ" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-15T15:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "task_complete",
            last_agent_message: "初回完了",
            turn_id: "turn-1",
          },
        }),
      ];
      writeFileSync(activePath, `${activeLines.join("\n")}\n`, "utf8");

      const oldPath = join(
        dayDir,
        "rollout-2026-02-14T09-00-00-22222222-2222-2222-2222-222222222222.jsonl"
      );
      const oldLines = [
        JSON.stringify({
          timestamp: "2026-02-14T09:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "22222222-2222-2222-2222-222222222222",
            cwd: "/Users/example/Desktop/Code/CC-harness/other-project",
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-14T09:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "old message" }],
          },
        }),
      ];
      writeFileSync(oldPath, `${oldLines.join("\n")}\n`, "utf8");

      const now = Date.now();
      const old = new Date(now - 48 * 60 * 60 * 1000);
      utimesSync(oldPath, old, old);

      const firstIngestRes = await fetch(`${baseUrl}/v1/ingest/codex-history`, {
        method: "POST",
      });
      expect(firstIngestRes.ok).toBe(true);
      const firstIngest = (await firstIngestRes.json()) as {
        ok: boolean;
        items: Array<{
          events_imported: number;
          files_scanned: number;
          files_skipped_backfill: number;
          sessions_events_imported: number;
        }>;
      };
      expect(firstIngest.ok).toBe(true);
      expect(firstIngest.items[0]?.events_imported).toBe(2);
      expect(firstIngest.items[0]?.sessions_events_imported).toBe(2);
      expect(firstIngest.items[0]?.files_scanned).toBeGreaterThanOrEqual(2);
      expect(firstIngest.items[0]?.files_skipped_backfill).toBeGreaterThanOrEqual(1);

      const harnessProject = "/Users/example/Desktop/Code/CC-harness/harness-mem";
      const harnessFeedRes = await fetch(
        `${baseUrl}/v1/feed?project=${encodeURIComponent(harnessProject)}&limit=10&include_private=false`
      );
      expect(harnessFeedRes.ok).toBe(true);
      const harnessFeed = (await harnessFeedRes.json()) as {
        ok: boolean;
        items: Array<{ event_type: string }>;
      };
      expect(harnessFeed.ok).toBe(true);
      expect(harnessFeed.items.length).toBe(2);
      expect(harnessFeed.items.some((item) => item.event_type === "user_prompt")).toBe(true);
      expect(harnessFeed.items.some((item) => item.event_type === "checkpoint")).toBe(true);

      const otherProject = "/Users/example/Desktop/Code/CC-harness/other-project";
      const oldFeedRes = await fetch(
        `${baseUrl}/v1/feed?project=${encodeURIComponent(otherProject)}&limit=10&include_private=false`
      );
      expect(oldFeedRes.ok).toBe(true);
      const oldFeed = (await oldFeedRes.json()) as { ok: boolean; items: Array<unknown> };
      expect(oldFeed.ok).toBe(true);
      expect(oldFeed.items.length).toBe(0);

      appendFileSync(
        activePath,
        `${JSON.stringify({
          timestamp: "2026-02-15T15:00:03.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "追記メッセージ" }],
          },
        })}\n`,
        "utf8"
      );

      const secondIngestRes = await fetch(`${baseUrl}/v1/ingest/codex-sessions`, {
        method: "POST",
      });
      expect(secondIngestRes.ok).toBe(true);
      const secondIngest = (await secondIngestRes.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number }>;
      };
      expect(secondIngest.ok).toBe(true);
      expect(secondIngest.items[0]?.events_imported).toBe(1);

      const harnessFeedAfterRes = await fetch(
        `${baseUrl}/v1/feed?project=${encodeURIComponent(harnessProject)}&limit=10&include_private=false`
      );
      const harnessFeedAfter = (await harnessFeedAfterRes.json()) as {
        ok: boolean;
        items: Array<unknown>;
      };
      expect(harnessFeedAfter.ok).toBe(true);
      expect(harnessFeedAfter.items.length).toBe(3);
    } finally {
      runtime.stop();
    }
  });

  test("persists last user prompt across incremental rollout ingests", async () => {
    const runtime = createRuntime("prompt-link");
    const { baseUrl, sessionsRoot, dir } = runtime;

    try {
      const dayDir = join(sessionsRoot, "2026", "03", "07");
      mkdirSync(dayDir, { recursive: true });

      const rolloutPath = join(
        dayDir,
        "rollout-2026-03-07T12-00-00-33333333-3333-3333-3333-333333333333.jsonl"
      );
      writeFileSync(
        rolloutPath,
        [
          JSON.stringify({
            timestamp: "2026-03-07T12:00:00.000Z",
            type: "session_meta",
            payload: {
              id: "33333333-3333-3333-3333-333333333333",
              cwd: "/Users/example/Desktop/Code/CC-harness/harness-mem",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-07T12:00:01.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "この回答を prompt と紐づけたい" }],
            },
          }),
        ].join("\n") + "\n",
        "utf8"
      );

      const firstIngestRes = await fetch(`${baseUrl}/v1/ingest/codex-sessions`, {
        method: "POST",
      });
      expect(firstIngestRes.ok).toBe(true);
      const firstIngest = (await firstIngestRes.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number }>;
      };
      expect(firstIngest.ok).toBe(true);
      expect(firstIngest.items[0]?.events_imported).toBe(1);

      appendFileSync(
        rolloutPath,
        `${JSON.stringify({
          timestamp: "2026-03-07T12:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "はい、この回答を prompt と一緒に記録します。",
          },
        })}\n`,
        "utf8"
      );

      const secondIngestRes = await fetch(`${baseUrl}/v1/ingest/codex-sessions`, {
        method: "POST",
      });
      expect(secondIngestRes.ok).toBe(true);
      const secondIngest = (await secondIngestRes.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number }>;
      };
      expect(secondIngest.ok).toBe(true);
      expect(secondIngest.items[0]?.events_imported).toBe(1);

      const db = new Database(join(dir, "harness-mem.db"), { readonly: true });
      try {
        const row = db
          .query(
            `SELECT payload_json
             FROM mem_events
             WHERE session_id = '33333333-3333-3333-3333-333333333333'
               AND event_type = 'checkpoint'
             ORDER BY ts DESC
             LIMIT 1`
          )
          .get() as { payload_json?: string } | null;

        expect(row?.payload_json).toBeDefined();
        const payload = JSON.parse(row?.payload_json || "{}") as Record<string, string>;
        expect(payload.content).toBe("はい、この回答を prompt と一緒に記録します。");
        expect(payload.prompt).toBe("この回答を prompt と紐づけたい");
      } finally {
        db.close(false);
      }
    } finally {
      runtime.stop();
    }
  });

  test("recovers latest compacted conversation tail into feed", async () => {
    const runtime = createRuntime("compacted-tail");
    const { baseUrl, sessionsRoot } = runtime;

    try {
      const dayDir = join(sessionsRoot, "2026", "03", "14");
      mkdirSync(dayDir, { recursive: true });

      const rolloutPath = join(
        dayDir,
        "rollout-2026-03-14T18-00-00-44444444-4444-4444-4444-444444444444.jsonl"
      );
      writeFileSync(
        rolloutPath,
        [
          JSON.stringify({
            timestamp: "2026-03-14T18:00:00.000Z",
            type: "session_meta",
            payload: {
              id: "44444444-4444-4444-4444-444444444444",
              cwd: "/Users/example/Desktop/Code/CC-harness/harness-mem",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-14T18:00:10.000Z",
            type: "compacted",
            payload: {
              replacement_history: [
                {
                  type: "message",
                  role: "user",
                  content: [{ type: "input_text", text: "前の依頼" }],
                },
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "前の回答" }],
                },
                {
                  type: "message",
                  role: "user",
                  content: [{ type: "input_text", text: "今の依頼" }],
                },
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "今の回答" }],
                },
              ],
            },
          }),
        ].join("\n") + "\n",
        "utf8"
      );

      const ingestRes = await fetch(`${baseUrl}/v1/ingest/codex-sessions`, {
        method: "POST",
      });
      expect(ingestRes.ok).toBe(true);
      const ingest = (await ingestRes.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number }>;
      };
      expect(ingest.ok).toBe(true);
      expect(ingest.items[0]?.events_imported).toBe(4);

      const project = "/Users/example/Desktop/Code/CC-harness/harness-mem";
      const feedRes = await fetch(
        `${baseUrl}/v1/feed?project=${encodeURIComponent(project)}&limit=10&include_private=false`
      );
      expect(feedRes.ok).toBe(true);
      const feed = (await feedRes.json()) as {
        ok: boolean;
        items: Array<{ event_type: string; title?: string; content?: string }>;
      };
      expect(feed.ok).toBe(true);
      expect(feed.items.some((item) => item.event_type === "user_prompt" && item.content === "今の依頼")).toBe(true);
      expect(feed.items.some((item) => item.event_type === "checkpoint" && item.content === "今の回答")).toBe(true);
    } finally {
      runtime.stop();
    }
  });
});
