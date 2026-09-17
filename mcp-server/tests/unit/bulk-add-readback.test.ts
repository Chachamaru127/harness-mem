import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../../memory-server/src/core/harness-mem-core";
import { startHarnessMemServer } from "../../../memory-server/src/server";
import { handleMemoryTool } from "../../src/tools/memory";

test("bulk_add stores advertised fields, preserves payload precedence and tags, and rejects malformed batches before writing", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-bulk-readback-"));
  const config: Config = {
    dbPath: join(root, "memory.db"), bindHost: "127.0.0.1", bindPort: 0,
    vectorDimension: 64, embeddingProvider: "fallback", captureEnabled: true,
    retrievalEnabled: true, injectionEnabled: true, codexHistoryEnabled: false,
    codexProjectRoot: root, codexSessionsRoot: root, codexIngestIntervalMs: 5000,
    codexBackfillHours: 24, opencodeIngestEnabled: false, cursorIngestEnabled: false,
    antigravityIngestEnabled: false, geminiIngestEnabled: false,
    claudeCodeIngestEnabled: false, backgroundWorkersEnabled: false, consolidationEnabled: false,
  };
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  const oldRemote = process.env.HARNESS_MEM_REMOTE_URL;
  process.env.HARNESS_MEM_REMOTE_URL = `http://127.0.0.1:${server.port}`;
  const common = { platform: "codex", project: "bulk-fixture", session_id: "bulk-readback", event_type: "user_prompt", ts: new Date().toISOString() };
  const events = [
    { ...common, event_id: "bulk-flat", title: "一括保存の見出し", content: "一括入力された本文を保持する", tags: ["bulk", "readback"] },
    { ...common, event_id: "bulk-payload", title: "flat title", content: "flat content", payload: { title: "payload title", content: "payload wins", extra: "retained" }, tags: ["payload"], privacy_tags: ["private"] },
    { ...common, event_id: "bulk-mixed", title: "filled title", content: "ignored content", payload: { content: "existing content" } },
  ];
  const original = JSON.stringify(events);
  try {
    const result = await handleMemoryTool("harness_mem_bulk_add", { events });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(events)).toBe(original);
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/observations/get`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["obs_bulk-flat", "obs_bulk-payload", "obs_bulk-mixed"], include_private: true }),
    });
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    const rows = new Map(body.items.map(row => [row.id, row]));
    expect(rows.get("obs_bulk-flat")).toMatchObject({ title: events[0].title, content: events[0].content, tags: ["bulk", "readback"] });
    expect(rows.get("obs_bulk-payload")).toMatchObject({ title: "payload title", content: "payload wins", tags: ["payload"], privacy_tags: ["private"] });
    expect(rows.get("obs_bulk-mixed")).toMatchObject({ title: "filled title", content: "existing content" });
    expect(core.getObservations({ ids: ["obs_bulk-payload"] }).items).toHaveLength(0);

    const invalidRequired = ["platform", "project", "session_id", "event_type"].flatMap(key =>
      [undefined, null, "", "   ", 42].map(value => ({ ...common, [key]: value })));
    for (const malformed of [null, [], "event", {}, ...invalidRequired,
      { ...common, project: "bad\0project" }, { ...common, payload: null }, { ...common, payload: [] },
      { ...common, content: 42 }, { ...common, title: null }, { ...common, tags: "tag" }, { ...common, tags: [42] },
      { ...common, privacy_tags: "private" }]) {
      const invalid = await handleMemoryTool("harness_mem_bulk_add", {
        events: [{ ...common, event_id: "must-not-write", content: "partial batch must not persist" }, malformed],
      });
      expect(invalid.isError).toBe(true);
    }
    const absent = core.getObservations({ ids: ["obs_must-not-write"], include_private: true });
    expect(absent.items).toHaveLength(0);
  } finally {
    if (oldRemote === undefined) delete process.env.HARNESS_MEM_REMOTE_URL;
    else process.env.HARNESS_MEM_REMOTE_URL = oldRemote;
    server.stop(true);
    await core.shutdown("test");
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
