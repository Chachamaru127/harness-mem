import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  core: HarnessMemCore;
  dir: string;
  port: number;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-feed-${name}-`));
  const port = 39200 + Math.floor(Math.random() * 1000);
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
  };
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return {
    core,
    dir,
    port,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

interface SseEvent {
  id?: number;
  event: string;
  data: Record<string, unknown>;
}

function parseSseBlock(block: string): SseEvent | null {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  let event = "message";
  let id: number | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("id:")) {
      const parsed = Number(line.slice(3).trim());
      if (Number.isFinite(parsed)) {
        id = parsed;
      }
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
      continue;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return {
      id,
      event,
      data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

async function waitForSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  matcher: (event: SseEvent) => boolean,
  timeoutMs = 7000
): Promise<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const read = reader.read();
    const chunk = await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout waiting for SSE event")), remaining);
      }),
    ]);

    if (chunk.done) {
      throw new Error("SSE stream closed before expected event");
    }

    buffer += decoder.decode(chunk.value, { stream: true });

    while (true) {
      const splitIndex = buffer.indexOf("\n\n");
      if (splitIndex === -1) {
        break;
      }
      const block = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);
      const parsed = parseSseBlock(block);
      if (!parsed) {
        continue;
      }
      if (matcher(parsed)) {
        return parsed;
      }
    }
  }

  throw new Error("timeout waiting for matched SSE event");
}

describe("feed/stream integration", () => {
  test("feed pagination + project stats + stream events", async () => {
    const runtime = createRuntime("api");
    const { core, port } = runtime;
    const base = `http://127.0.0.1:${port}`;

    try {
      core.recordEvent({
        platform: "claude",
        project: "feed-project",
        session_id: "session-1",
        event_type: "user_prompt",
        ts: "2026-02-14T00:00:01.000Z",
        payload: { content: "feed content a" },
        tags: ["feed"],
        privacy_tags: [],
      });

      core.recordEvent({
        platform: "claude",
        project: "feed-project",
        session_id: "session-1",
        event_type: "tool_use",
        ts: "2026-02-14T00:00:02.000Z",
        payload: { content: "feed content b" },
        tags: ["feed"],
        privacy_tags: [],
      });

      core.recordEvent({
        platform: "claude",
        project: "feed-project",
        session_id: "session-1",
        event_type: "checkpoint",
        ts: "2026-02-14T00:00:03.000Z",
        payload: { content: "feed content c" },
        tags: ["feed"],
        privacy_tags: [],
      });

      const page1Res = await fetch(`${base}/v1/feed?project=feed-project&limit=2`);
      expect(page1Res.ok).toBe(true);
      const page1 = (await page1Res.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
        meta: Record<string, unknown>;
      };
      expect(page1.ok).toBe(true);
      expect(page1.items.length).toBe(2);
      expect(typeof page1.meta.next_cursor).toBe("string");

      const cursor = String(page1.meta.next_cursor);
      const page2Res = await fetch(`${base}/v1/feed?project=feed-project&limit=2&cursor=${encodeURIComponent(cursor)}`);
      expect(page2Res.ok).toBe(true);
      const page2 = (await page2Res.json()) as { ok: boolean; items: Array<Record<string, unknown>> };
      expect(page2.ok).toBe(true);
      expect(page2.items.length).toBeGreaterThanOrEqual(1);

      const statsRes = await fetch(`${base}/v1/projects/stats`);
      expect(statsRes.ok).toBe(true);
      const stats = (await statsRes.json()) as { ok: boolean; items: Array<Record<string, unknown>> };
      expect(stats.ok).toBe(true);
      const feedProject = stats.items.find((item) => item.project === "feed-project");
      expect(feedProject).toBeDefined();
      expect(Number(feedProject?.observations ?? 0)).toBeGreaterThanOrEqual(3);

      const streamRes = await fetch(`${base}/v1/stream?project=feed-project`);
      expect(streamRes.ok).toBe(true);
      expect(streamRes.body).not.toBeNull();
      const reader = streamRes.body!.getReader();

      const newRecord = core.recordEvent({
        platform: "claude",
        project: "feed-project",
        session_id: "session-1",
        event_type: "user_prompt",
        ts: "2026-02-14T00:00:04.000Z",
        payload: { content: "stream content d" },
        tags: ["feed"],
        privacy_tags: [],
      });
      expect(newRecord.ok).toBe(true);

      const created = await waitForSseEvent(
        reader,
        (event) => event.event === "observation.created" && event.data.project === "feed-project"
      );
      expect(created.event).toBe("observation.created");

      const finalize = core.finalizeSession({
        platform: "claude",
        project: "feed-project",
        session_id: "session-1",
        summary_mode: "standard",
      });
      expect(finalize.ok).toBe(true);

      const finalized = await waitForSseEvent(
        reader,
        (event) => event.event === "session.finalized" && event.data.session_id === "session-1"
      );
      expect(finalized.event).toBe("session.finalized");

      await reader.cancel();
    } finally {
      runtime.stop();
    }
  });
});
