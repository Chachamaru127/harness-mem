import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore } from "../../src/core/harness-mem-core";
import { createTestConfig } from "../core-split/test-helpers";

test("a committed event survives lost reader ACK and replay does not duplicate the actual memory DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-reader-lost-ack-"));
  const dbPath = join(dir, "memory.db");
  const sourcePath = join(dir, "gemini.jsonl");
  const content = "Durable reader ACK loss regression";
  writeFileSync(sourcePath, JSON.stringify({
    platform: "gemini", project: dir, session_id: "ack-loss-session", event_type: "user_prompt",
    ts: new Date().toISOString(), payload: { content },
  }) + "\n");
  let dropAck = true;
  const acknowledgments: boolean[] = [];
  const core = new HarnessMemCore(createTestConfig({
    dbPath, codexProjectRoot: dir, codexSessionsRoot: join(dir, "no-codex"),
    geminiIngestEnabled: true, geminiEventsPath: sourcePath, geminiIngestIntervalMs: 3_600_000,
    claudeCodeIngestEnabled: false, backgroundWorkersEnabled: false, embeddingProvider: "fallback",
  }), {
    sourceReader: {
      spawnReader(options) {
        const proc = Bun.spawn(options);
        const input = proc.stdin!;
        return {
          pid: proc.pid, stdout: proc.stdout, stderr: proc.stderr, exited: proc.exited,
          kill: proc.kill.bind(proc),
          stdin: {
            write(bytes: Uint8Array) {
              const packet = JSON.parse(Buffer.from(bytes).toString("utf8"));
              if (packet.callId && packet.result?.ok === true) {
                acknowledgments.push(packet.result.meta?.deduped === true);
                if (dropAck) {
                  dropAck = false;
                  // The actual EventRecorder commit has returned successfully;
                  // only delivery of that success to the reader is interrupted.
                  throw new Error("test: discard committed save ACK");
                }
              }
              return input.write(bytes);
            },
            flush: () => input.flush(),
          },
        } as ReturnType<typeof Bun.spawn>;
      },
    },
  });
  const readState = () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return {
        events: db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mem_events").get()!.count,
        observations: db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL").get()!.count,
        offset: db.query<{ offset: number }, [string]>("SELECT offset FROM mem_ingest_offsets WHERE source_key = ?").get(`gemini_events:${sourcePath}`)?.offset ?? null,
        content: db.query<{ content: string }, []>("SELECT content FROM mem_observations WHERE archived_at IS NULL").get()?.content,
        dedupeHash: db.query<{ dedupe_hash: string }, []>("SELECT dedupe_hash FROM mem_events").get()?.dedupe_hash,
      };
    } finally { db.close(); }
  };
  try {
    expect(await core.runPeriodicIngestTickLocal("gemini")).toEqual({ ok: false, error_code: "record_write_failed", retryable: true });
    const afterLostAck = readState();
    expect(afterLostAck).toMatchObject({ events: 1, observations: 1, offset: null, content });
    expect(afterLostAck.dedupeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(acknowledgments).toEqual([false]);

    expect(await core.runPeriodicIngestTickLocal("gemini")).toEqual({ ok: true });
    const committed = { ...afterLostAck, offset: statSync(sourcePath).size };
    expect(readState()).toEqual(committed);
    expect(acknowledgments).toEqual([false, true]);

    expect(await core.runPeriodicIngestTickLocal("gemini")).toEqual({ ok: true });
    expect(readState()).toEqual(committed);
    expect(acknowledgments).toEqual([false, true]);
  } finally {
    await core.shutdown("source-reader-lost-ack-test");
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);
