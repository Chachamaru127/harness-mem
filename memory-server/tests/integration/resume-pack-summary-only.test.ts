/**
 * §90-002: resume_pack summary_only mode integration tests
 *
 * Verifies that resume_pack with summary_only=true:
 * - Returns meta.summary as the latest session summary string
 * - Skips heavy ranking/facts/continuity computation
 * - Preserves backward-compat items[] shape (session_summary when present)
 * - Respects include_partial flag for summary selection
 *
 * DoD coverage:
 * (a) summary_only=true with partial → meta.summary + is_partial=true
 * (b) summary_only=true with full    → meta.summary + is_partial=false
 * (c) summary_only=true no summary   → meta.summary="" + session_id=null
 * (d) summary_only=false (default)   → pre-existing response, no meta.summary
 * (e) summary_only=true + include_partial=false → excludes partial, full only
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HarnessMemCore,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  core: HarnessMemCore;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-s90-002-${name}-`));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return {
    core,
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

type ApiPayload = {
  ok: boolean;
  items: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  error?: string;
};

async function postResumePack(
  baseUrl: string,
  body: Record<string, unknown>
): Promise<ApiPayload> {
  const response = await fetch(`${baseUrl}/v1/resume-pack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<ApiPayload>;
}

function recordUserEvent(
  core: HarnessMemCore,
  overrides: Partial<EventEnvelope>
): void {
  const base: EventEnvelope = {
    event_id: "default-event",
    platform: "claude",
    project: "s90-002-project",
    session_id: "s90-002-session",
    event_type: "user_prompt",
    ts: "2026-04-20T00:00:00.000Z",
    payload: { content: "test content" },
    tags: [],
    privacy_tags: [],
  };
  const res = core.recordEvent({ ...base, ...overrides });
  expect(res.ok).toBe(true);
}

describe("§90-002: resume_pack summary_only mode", () => {
  test("(a) summary_only=true + partial — meta.summary + is_partial=true", async () => {
    const rt = createRuntime("dod-a");
    const { core, baseUrl } = rt;
    const project = "s90-002-dod-a";
    const sessionId = "sess-s90-dod-a";

    try {
      recordUserEvent(core, {
        event_id: "evt-s90-a-1",
        project,
        session_id: sessionId,
        payload: { content: "partial content" },
      });
      const partialRes = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
        partial: true,
      });
      expect(partialRes.ok).toBe(true);

      const pack = await postResumePack(baseUrl, {
        project,
        summary_only: true,
      });
      expect(pack.ok).toBe(true);
      expect(pack.meta.summary_only).toBe(true);
      expect(typeof pack.meta.summary).toBe("string");
      expect((pack.meta.summary as string).length).toBeGreaterThan(0);
      expect(pack.meta.session_id).toBe(sessionId);
      expect(pack.meta.is_partial).toBe(true);

      // Item list still exposes session_summary for backward-compat
      expect(pack.items.length).toBe(1);
      const item = pack.items[0];
      expect(item.type).toBe("session_summary");
      expect(item.is_partial).toBe(true);
      expect(item.session_id).toBe(sessionId);
    } finally {
      rt.stop();
    }
  });

  test("(b) summary_only=true + full — meta.summary + is_partial=false", async () => {
    const rt = createRuntime("dod-b");
    const { core, baseUrl } = rt;
    const project = "s90-002-dod-b";
    const sessionId = "sess-s90-dod-b";

    try {
      recordUserEvent(core, {
        event_id: "evt-s90-b-1",
        project,
        session_id: sessionId,
        payload: { content: "full content" },
      });
      const fullRes = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
      });
      expect(fullRes.ok).toBe(true);

      const pack = await postResumePack(baseUrl, {
        project,
        summary_only: true,
      });
      expect(pack.ok).toBe(true);
      expect(pack.meta.summary_only).toBe(true);
      expect(typeof pack.meta.summary).toBe("string");
      expect((pack.meta.summary as string).length).toBeGreaterThan(0);
      expect(pack.meta.session_id).toBe(sessionId);
      expect(pack.meta.is_partial).toBe(false);

      expect(pack.items.length).toBe(1);
      const item = pack.items[0];
      expect(item.type).toBe("session_summary");
      expect(item.is_partial).toBeUndefined();
    } finally {
      rt.stop();
    }
  });

  test("(c) summary_only=true with no summary — meta.summary='' + empty items", async () => {
    const rt = createRuntime("dod-c");
    const { baseUrl } = rt;
    const project = "s90-002-dod-c";

    try {
      const pack = await postResumePack(baseUrl, {
        project,
        summary_only: true,
      });
      expect(pack.ok).toBe(true);
      expect(pack.meta.summary_only).toBe(true);
      expect(pack.meta.summary).toBe("");
      expect(pack.meta.session_id).toBeNull();
      expect(pack.meta.is_partial).toBe(false);
      expect(pack.items.length).toBe(0);
    } finally {
      rt.stop();
    }
  });

  test("(d) summary_only=false (default) — no meta.summary, pre-existing behavior", async () => {
    const rt = createRuntime("dod-d");
    const { core, baseUrl } = rt;
    const project = "s90-002-dod-d";
    const sessionId = "sess-s90-dod-d";

    try {
      recordUserEvent(core, {
        event_id: "evt-s90-d-1",
        project,
        session_id: sessionId,
        payload: { content: "default content" },
      });
      const fullRes = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
      });
      expect(fullRes.ok).toBe(true);

      // Default (no summary_only param) — existing behavior
      const pack = await postResumePack(baseUrl, { project });
      expect(pack.ok).toBe(true);
      expect(pack.meta.summary_only).toBeUndefined();
      expect(pack.meta.summary).toBeUndefined();

      // Full response includes session_summary + possibly other items/fields
      const summaryItem = pack.items.find((i) => i.type === "session_summary");
      expect(summaryItem).toBeDefined();
    } finally {
      rt.stop();
    }
  });

  test("(e) summary_only=true + include_partial=false — excludes partial, picks full", async () => {
    const rt = createRuntime("dod-e");
    const { core, baseUrl } = rt;
    const project = "s90-002-dod-e";
    const fullSessionId = "sess-s90-e-full";
    const partialSessionId = "sess-s90-e-partial";

    try {
      // Older full
      recordUserEvent(core, {
        event_id: "evt-s90-e-full-1",
        project,
        session_id: fullSessionId,
        payload: { content: "older full content" },
      });
      const fullRes = core.finalizeSession({
        session_id: fullSessionId,
        project,
        platform: "claude",
      });
      expect(fullRes.ok).toBe(true);

      await new Promise((r) => setTimeout(r, 20));

      // Newer partial
      recordUserEvent(core, {
        event_id: "evt-s90-e-partial-1",
        project,
        session_id: partialSessionId,
        payload: { content: "newer partial content" },
      });
      const partialRes = core.finalizeSession({
        session_id: partialSessionId,
        project,
        platform: "claude",
        partial: true,
      });
      expect(partialRes.ok).toBe(true);

      // summary_only=true + include_partial=false → full wins
      const pack = await postResumePack(baseUrl, {
        project,
        summary_only: true,
        include_partial: false,
      });
      expect(pack.ok).toBe(true);
      expect(pack.meta.summary_only).toBe(true);
      expect(pack.meta.session_id).toBe(fullSessionId);
      expect(pack.meta.is_partial).toBe(false);
    } finally {
      rt.stop();
    }
  });
});
