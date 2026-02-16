import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  dir: string;
  opencodeStorageRoot: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-opencode-storage-${name}-`));
  const opencodeStorageRoot = join(dir, "opencode-storage");
  mkdirSync(opencodeStorageRoot, { recursive: true });

  const port = 39700 + Math.floor(Math.random() * 1000);
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
    opencodeIngestEnabled: true,
    opencodeStorageRoot,
    opencodeIngestIntervalMs: 3600000,
    opencodeBackfillHours: 24,
  };

  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);

  return {
    dir,
    opencodeStorageRoot,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("opencode storage ingest integration", () => {
  test("ingests user+assistant events with project isolation and delta", async () => {
    const runtime = createRuntime("storage");
    const { baseUrl, opencodeStorageRoot } = runtime;

    try {
      const messageRoot = join(opencodeStorageRoot, "message", "ses_live");
      const partUserRoot = join(opencodeStorageRoot, "part", "msg_user_1");
      const partAssistantRoot = join(opencodeStorageRoot, "part", "msg_assistant_1");
      const sessionRoot = join(opencodeStorageRoot, "session", "project-1");
      mkdirSync(messageRoot, { recursive: true });
      mkdirSync(partUserRoot, { recursive: true });
      mkdirSync(partAssistantRoot, { recursive: true });
      mkdirSync(sessionRoot, { recursive: true });

      writeFileSync(
        join(sessionRoot, "ses_live.json"),
        JSON.stringify(
          {
            id: "ses_live",
            directory: "/Users/test/Desktop/Code/CC-harness/Context-Harness",
          },
          null,
          2
        ),
        "utf8"
      );

      writeFileSync(
        join(messageRoot, "msg_user_1.json"),
        JSON.stringify(
          {
            id: "msg_user_1",
            sessionID: "ses_live",
            role: "user",
            time: { created: 1771209000000 },
          },
          null,
          2
        ),
        "utf8"
      );
      writeFileSync(
        join(partUserRoot, "prt_text_1.json"),
        JSON.stringify(
          {
            id: "prt_text_1",
            type: "text",
            text: "opencode non-interactive ingest test",
          },
          null,
          2
        ),
        "utf8"
      );

      writeFileSync(
        join(messageRoot, "msg_assistant_1.json"),
        JSON.stringify(
          {
            id: "msg_assistant_1",
            sessionID: "ses_live",
            role: "assistant",
            finish: "stop",
            time: { created: 1771209001000, completed: 1771209002000 },
          },
          null,
          2
        ),
        "utf8"
      );
      writeFileSync(
        join(partAssistantRoot, "prt_text_1.json"),
        JSON.stringify(
          {
            id: "prt_text_1",
            type: "text",
            text: "assistant completed",
          },
          null,
          2
        ),
        "utf8"
      );

      writeFileSync(
        join(messageRoot, "msg_assistant_tool_calls.json"),
        JSON.stringify(
          {
            id: "msg_assistant_tool_calls",
            sessionID: "ses_live",
            role: "assistant",
            finish: "tool-calls",
            time: { created: 1771209002500, completed: 1771209002550 },
          },
          null,
          2
        ),
        "utf8"
      );

      const oldMessagePath = join(messageRoot, "msg_old.json");
      writeFileSync(
        oldMessagePath,
        JSON.stringify(
          {
            id: "msg_old",
            sessionID: "ses_live",
            role: "user",
            time: { created: 1771100000000 },
          },
          null,
          2
        ),
        "utf8"
      );
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      utimesSync(oldMessagePath, old, old);

      const ingest1Res = await fetch(`${baseUrl}/v1/ingest/opencode-history`, { method: "POST" });
      expect(ingest1Res.ok).toBe(true);
      const ingest1 = (await ingest1Res.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number; files_scanned: number; files_skipped_backfill: number }>;
      };
      expect(ingest1.ok).toBe(true);
      expect(ingest1.items[0]?.events_imported).toBe(2);
      expect(ingest1.items[0]?.files_scanned).toBeGreaterThanOrEqual(3);
      expect(ingest1.items[0]?.files_skipped_backfill).toBeGreaterThanOrEqual(1);

      const feedRes = await fetch(`${baseUrl}/v1/feed?project=Context-Harness&limit=10&include_private=false`);
      expect(feedRes.ok).toBe(true);
      const feed = (await feedRes.json()) as { ok: boolean; items: Array<{ event_type: string; project: string }> };
      expect(feed.ok).toBe(true);
      expect(feed.items.length).toBe(2);
      expect(feed.items.every((item) => item.project === "Context-Harness")).toBe(true);

      writeFileSync(
        join(messageRoot, "msg_user_2.json"),
        JSON.stringify(
          {
            id: "msg_user_2",
            sessionID: "ses_live",
            role: "user",
            time: { created: 1771209003000 },
          },
          null,
          2
        ),
        "utf8"
      );
      mkdirSync(join(opencodeStorageRoot, "part", "msg_user_2"), { recursive: true });
      writeFileSync(
        join(opencodeStorageRoot, "part", "msg_user_2", "prt_text_1.json"),
        JSON.stringify({ id: "prt_text_1", type: "text", text: "delta prompt" }, null, 2),
        "utf8"
      );

      const ingest2Res = await fetch(`${baseUrl}/v1/ingest/opencode-sessions`, { method: "POST" });
      expect(ingest2Res.ok).toBe(true);
      const ingest2 = (await ingest2Res.json()) as { ok: boolean; items: Array<{ events_imported: number }> };
      expect(ingest2.ok).toBe(true);
      expect(ingest2.items[0]?.events_imported).toBe(1);
    } finally {
      runtime.stop();
    }
  });
});
