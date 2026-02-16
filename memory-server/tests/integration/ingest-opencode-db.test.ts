import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { Database } from "bun:sqlite";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  dir: string;
  baseUrl: string;
  dbPath: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-opencode-db-${name}-`));
  const storageRoot = join(dir, "storage");
  mkdirSync(storageRoot, { recursive: true });
  const dbPath = join(dir, "opencode.db");

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
    opencodeIngestEnabled: true,
    opencodeDbPath: dbPath,
    opencodeStorageRoot: storageRoot,
    opencodeIngestIntervalMs: 3600000,
    opencodeBackfillHours: 24,
  };

  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);

  return {
    dir,
    dbPath,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedOpencodeDb(dbPath: string): void {
  const db = new Database(dbPath, { create: true, strict: false });
  try {
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        parent_id TEXT,
        slug TEXT,
        directory TEXT,
        title TEXT,
        version TEXT,
        share_url TEXT,
        summary_additions INTEGER,
        summary_deletions INTEGER,
        summary_files INTEGER,
        summary_diffs TEXT,
        revert TEXT,
        permission TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        time_compacting INTEGER,
        time_archived INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);

    const oldTs = Date.now() - 48 * 60 * 60 * 1000;
    const recentTs = Date.now() - 1000;

    db.query(
      `
        INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES (?, 'project-1', 'slug', ?, 'title', '1.1.34', ?, ?)
      `
    ).run("ses_1", "/Users/test/Desktop/Code/CC-harness/Context-Harness", recentTs, recentTs);

    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(
        "msg_old",
        "ses_1",
        oldTs,
        oldTs,
        JSON.stringify({ role: "user", summary: { title: "old prompt" } })
      );

    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(
        "msg_user",
        "ses_1",
        recentTs,
        recentTs,
        JSON.stringify({ role: "user", summary: { title: "user title" } })
      );

    db.query(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        "prt_user",
        "msg_user",
        "ses_1",
        recentTs,
        recentTs,
        JSON.stringify({ type: "text", text: "dogfood user prompt" })
      );

    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(
        "msg_assistant",
        "ses_1",
        recentTs + 1,
        recentTs + 1,
        JSON.stringify({ role: "assistant", finish: "stop" })
      );

    db.query(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        "prt_assistant",
        "msg_assistant",
        "ses_1",
        recentTs + 1,
        recentTs + 1,
        JSON.stringify({ type: "text", text: "dogfood assistant response" })
      );

    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(
        "msg_assistant_tool_calls",
        "ses_1",
        recentTs + 2,
        recentTs + 2,
        JSON.stringify({ role: "assistant", finish: "tool-calls" })
      );
  } finally {
    db.close(false);
  }
}

describe("opencode db ingest integration", () => {
  test("ingests recent opencode db messages and isolates project", async () => {
    const runtime = createRuntime("db");
    const { dbPath, baseUrl } = runtime;
    try {
      seedOpencodeDb(dbPath);

      const ingest1Res = await fetch(`${baseUrl}/v1/ingest/opencode-history`, { method: "POST" });
      expect(ingest1Res.ok).toBe(true);
      const ingest1 = (await ingest1Res.json()) as {
        ok: boolean;
        items: Array<{
          events_imported: number;
          db_events_imported: number;
          files_skipped_backfill: number;
        }>;
      };
      expect(ingest1.ok).toBe(true);
      expect(ingest1.items[0]?.events_imported).toBe(2);
      expect(ingest1.items[0]?.db_events_imported).toBe(2);
      expect(ingest1.items[0]?.files_skipped_backfill).toBeGreaterThanOrEqual(1);

      const feedRes = await fetch(`${baseUrl}/v1/feed?project=Context-Harness&limit=10&include_private=false`);
      expect(feedRes.ok).toBe(true);
      const feed = (await feedRes.json()) as {
        ok: boolean;
        items: Array<{ platform: string; event_type: string; project: string }>;
      };
      expect(feed.ok).toBe(true);
      expect(feed.items.length).toBe(2);
      expect(feed.items.every((item) => item.platform === "opencode")).toBe(true);
      expect(feed.items.every((item) => item.project === "Context-Harness")).toBe(true);

      const sourceDb = new Database(dbPath, { create: false, readonly: false, strict: false });
      try {
        const now = Date.now();
        sourceDb.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`).run(
          "msg_user_delta",
          "ses_1",
          now,
          now,
          JSON.stringify({ role: "user", summary: { title: "delta title" } })
        );
        sourceDb.query(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`).run(
          "prt_delta",
          "msg_user_delta",
          "ses_1",
          now,
          now,
          JSON.stringify({ type: "text", text: "delta prompt" })
        );
      } finally {
        sourceDb.close(false);
      }

      const ingest2Res = await fetch(`${baseUrl}/v1/ingest/opencode-sessions`, { method: "POST" });
      expect(ingest2Res.ok).toBe(true);
      const ingest2 = (await ingest2Res.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number; db_events_imported: number }>;
      };
      expect(ingest2.ok).toBe(true);
      expect(ingest2.items[0]?.events_imported).toBe(1);
      expect(ingest2.items[0]?.db_events_imported).toBe(1);
    } finally {
      runtime.stop();
    }
  });
});
