import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { Database } from "bun:sqlite";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  dir: string;
  projectsRoot: string;
  dbPath: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-claude-code-sessions-${name}-`));
  const projectsRoot = join(dir, "claude-projects");
  const dbPath = join(dir, "harness-mem.db");
  mkdirSync(projectsRoot, { recursive: true });

  const config: Config = {
    dbPath,
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: dir,
    codexSessionsRoot: dir,
    codexIngestIntervalMs: 3600000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    geminiIngestEnabled: false,
    claudeCodeIngestEnabled: true,
    claudeCodeProjectsRoot: projectsRoot,
    claudeCodeIngestIntervalMs: 3600000,
    claudeCodeBackfillHours: 24,
  };

  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);

  return {
    dir,
    projectsRoot,
    dbPath,
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function writeClaudeSessionFile(params: {
  dir: string;
  sessionId: string;
  project: string;
  prompt: string;
  answer: string;
  timestamp: string;
}): string {
  const filePath = join(params.dir, `${params.sessionId}.jsonl`);
  writeFileSync(
    filePath,
    [
      JSON.stringify({
        type: "user",
        timestamp: params.timestamp,
        sessionId: params.sessionId,
        cwd: params.project,
        message: {
          role: "user",
          content: params.prompt,
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: params.timestamp,
        sessionId: params.sessionId,
        cwd: params.project,
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          content: [{ type: "text", text: params.answer }],
        },
      }),
    ].join("\n") + "\n",
    "utf8"
  );
  return filePath;
}

describe("claude code sessions ingest integration", () => {
  test("prioritizes most recently updated Claude session files within the per-poll budget", async () => {
    const runtime = createRuntime("recent-first");
    const { baseUrl, projectsRoot } = runtime;

    try {
      // Startup ingest runs on the next tick. Let it finish against the empty fixture dir
      // before creating test files so the manual replay path stays deterministic.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const project = "/Users/example/Desktop/Code/CC-harness/harness-mem";
      const encodedProjectDir = join(projectsRoot, "-Users-example-Desktop-Code-CC-harness-harness-mem");
      mkdirSync(encodedProjectDir, { recursive: true });

      const sessions = [
        { sessionId: "11111111-1111-1111-1111-111111111111", label: "oldest", mtime: "2026-03-11T14:00:00.000Z" },
        { sessionId: "22222222-2222-2222-2222-222222222222", label: "older-2", mtime: "2026-03-11T14:01:00.000Z" },
        { sessionId: "33333333-3333-3333-3333-333333333333", label: "older-3", mtime: "2026-03-11T14:02:00.000Z" },
        { sessionId: "44444444-4444-4444-4444-444444444444", label: "older-4", mtime: "2026-03-11T14:03:00.000Z" },
        { sessionId: "55555555-5555-5555-5555-555555555555", label: "older-5", mtime: "2026-03-11T14:04:00.000Z" },
        { sessionId: "ffffffff-ffff-ffff-ffff-ffffffffffff", label: "newest", mtime: "2026-03-11T14:05:00.000Z" },
      ];

      for (const session of sessions) {
        const filePath = writeClaudeSessionFile({
          dir: encodedProjectDir,
          sessionId: session.sessionId,
          project,
          prompt: `${session.label} prompt`,
          answer: `${session.label} answer`,
          timestamp: session.mtime,
        });
        const at = new Date(session.mtime);
        utimesSync(filePath, at, at);
      }

      const ingestRes = await fetch(`${baseUrl}/v1/ingest/claude-code-sessions`, {
        method: "POST",
      });
      expect(ingestRes.ok).toBe(true);
      const ingest = (await ingestRes.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number; files_scanned: number }>;
      };
      expect(ingest.ok).toBe(true);
      // Manual API uses maxFiles=Infinity, so all 6 files (12 events) are ingested
      expect(ingest.items[0]?.events_imported).toBe(12);
      expect(ingest.items[0]?.files_scanned).toBe(6);

      const feedRes = await fetch(
        `${baseUrl}/v1/feed?project=${encodeURIComponent(project)}&limit=20&include_private=false`
      );
      expect(feedRes.ok).toBe(true);
      const feed = (await feedRes.json()) as {
        ok: boolean;
        items: Array<{ content?: string }>;
      };
      expect(feed.ok).toBe(true);

      const contents = feed.items.map((item) => String(item.content || ""));
      expect(contents.some((content) => content.includes("newest answer"))).toBe(true);
      expect(contents.some((content) => content.includes("oldest answer"))).toBe(true);
    } finally {
      runtime.stop();
    }
  });

  test("manual Claude ingest replays from file start and backfills skipped visible turns while ignoring wrapper prompts", async () => {
    const runtime = createRuntime("replay-from-start");
    const { baseUrl, projectsRoot, dbPath } = runtime;

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const project = "/Users/example/Desktop/Code/CC-harness/harness-mem";
      const sessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const encodedProjectDir = join(projectsRoot, "-Users-example-Desktop-Code-CC-harness-harness-mem");
      mkdirSync(encodedProjectDir, { recursive: true });
      const filePath = join(encodedProjectDir, `${sessionId}.jsonl`);

      const lines = [
        JSON.stringify({
          type: "user",
          timestamp: "2026-03-11T00:00:00.000Z",
          sessionId,
          cwd: project,
          message: {
            role: "user",
            content:
              "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.</local-command-caveat>",
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-03-11T00:00:01.000Z",
          sessionId,
          cwd: project,
          message: {
            role: "user",
            content: "<command-name>/plugin</command-name>\n<command-message>plugin</command-message>\n<command-args></command-args>",
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-03-11T00:00:02.000Z",
          sessionId,
          cwd: project,
          message: {
            role: "user",
            content: "visible claude prompt",
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-03-11T00:00:03.000Z",
          sessionId,
          cwd: project,
          message: {
            role: "assistant",
            model: "claude-sonnet-4",
            content: [{ type: "text", text: "visible claude answer" }],
          },
        }),
      ];
      writeFileSync(filePath, lines.join("\n") + "\n", "utf8");

      const db = new Database(dbPath);
      try {
        db.query(
          "INSERT INTO mem_ingest_offsets (source_key, offset, updated_at) VALUES (?, ?, ?)"
        ).run(`claude_code:${filePath}`, Buffer.byteLength(lines.join("\n") + "\n"), "2026-03-11T00:10:00.000Z");
      } finally {
        db.close();
      }

      const ingestRes = await fetch(`${baseUrl}/v1/ingest/claude-code-sessions`, {
        method: "POST",
      });
      expect(ingestRes.ok).toBe(true);
      const ingest = (await ingestRes.json()) as {
        ok: boolean;
        items: Array<{ events_imported: number }>;
      };
      expect(ingest.ok).toBe(true);
      expect(ingest.items[0]?.events_imported).toBe(2);

      const threadRes = await fetch(
        `${baseUrl}/v1/sessions/thread?session_id=${sessionId}&project=${encodeURIComponent(project)}&include_private=true&limit=20`
      );
      expect(threadRes.ok).toBe(true);
      const thread = (await threadRes.json()) as {
        ok: boolean;
        items: Array<{ event_type?: string; title?: string; content?: string }>;
      };
      expect(thread.ok).toBe(true);
      expect(thread.items).toHaveLength(2);
      expect(thread.items[0]?.event_type).toBe("user_prompt");
      expect(thread.items[0]?.content).toBe("visible claude prompt");
      expect(thread.items[1]?.title).toBe("assistant_response");
      expect(thread.items[1]?.content).toBe("visible claude answer");
    } finally {
      runtime.stop();
    }
  });
});
