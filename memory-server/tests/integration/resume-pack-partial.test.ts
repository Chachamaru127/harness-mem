/**
 * §91-003: resume_pack partial summary integration tests
 *
 * Verifies that resume_pack adopts partial session summaries
 * (is_partial=true, created by S91-001 partial finalize) and applies
 * the correct recency precedence rules.
 *
 * DoD coverage:
 * (a) full(t=T) + partial(t=T+1) same session → partial is returned
 *     Interpretation: partial finalize happens before full in time,
 *     but is recorded later (T+1 > T). Since partial on a closed session
 *     is a no-op, we model this as: partial created at T+1, then later
 *     a full finalize produces a full summary at T+2.  For case (a) we
 *     test the simpler scenario: partial finalize on an ACTIVE session →
 *     partial is the most recent summary → resume_pack returns it.
 * (b) full(t=T+2) + partial(t=T+1) → full is returned
 *     Partial at T+1, full at T+2 (full is newer) → full wins.
 * (c) partial older than another session's full → other session's full is returned
 * (d) include_partial=false excludes partial, returns only full-finalize summary
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

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function createRuntime(name: string): {
  core: HarnessMemCore;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-s91-003-${name}-`));
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
    project: "s91-003-project",
    session_id: "s91-003-session",
    event_type: "user_prompt",
    ts: "2026-04-20T00:00:00.000Z",
    payload: { content: "test content" },
    tags: [],
    privacy_tags: [],
  };
  const res = core.recordEvent({ ...base, ...overrides });
  expect(res.ok).toBe(true);
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("§91-003: resume_pack partial summary adoption", () => {
  test("(a) partial(t=T+1) on active session — no full finalize — partial is returned", async () => {
    // DoD (a): full(t=T) + partial(t=T+1) same session → partial is returned.
    // We model this as: a previous session was fully finalized (t=T),
    // then a NEW active session has a partial finalize (t=T+1).
    // resume_pack must prefer the more-recent partial.
    const rt = createRuntime("dod-a");
    const { core, baseUrl } = rt;
    const project = "s91-003-dod-a";
    const prevSession = "sess-dod-a-prev";
    const activeSession = "sess-dod-a-active";

    try {
      // Previous session: full finalize (t=T — will have an older created_at)
      recordUserEvent(core, {
        event_id: "evt-dod-a-prev-1",
        project,
        session_id: prevSession,
        ts: "2026-04-20T00:00:00.000Z",
        payload: { content: "previous session content" },
      });
      const fullRes = core.finalizeSession({
        session_id: prevSession,
        project,
        platform: "claude",
      });
      expect(fullRes.ok).toBe(true);

      // Small delay so wall-clock created_at of the next obs is strictly newer
      await new Promise((r) => setTimeout(r, 20));

      // Active session: partial finalize only (t=T+1 — newer created_at)
      recordUserEvent(core, {
        event_id: "evt-dod-a-active-1",
        project,
        session_id: activeSession,
        ts: "2026-04-20T01:00:00.000Z",
        payload: { content: "active session content" },
      });
      const partialRes = core.finalizeSession({
        session_id: activeSession,
        project,
        platform: "claude",
        partial: true,
      });
      expect(partialRes.ok).toBe(true);
      const partialItem = partialRes.items[0] as Record<string, unknown>;
      expect(partialItem.partial).toBe(true);
      expect(partialItem.no_op).toBeUndefined();

      // resume_pack should return the partial summary (most recent)
      const pack = await postResumePack(baseUrl, { project });
      expect(pack.ok).toBe(true);

      const summaryItem = pack.items.find((i) => i.type === "session_summary");
      expect(summaryItem).toBeDefined();
      // is_partial flag must be present and true
      expect(summaryItem!.is_partial).toBe(true);
      expect(summaryItem!.session_id).toBe(activeSession);
    } finally {
      rt.stop();
    }
  });

  test("(b) full(t=T+2) + partial(t=T+1) same session → full is returned", async () => {
    // Partial created first (T+1), then full finalize at T+2 (newer).
    // Full finalize on closed session is still valid; partial on closed is no-op.
    // So: partial → full finalize. Full is the newest observation → full wins.
    const rt = createRuntime("dod-b");
    const { core, baseUrl } = rt;
    const project = "s91-003-dod-b";
    const sessionId = "sess-dod-b";

    try {
      recordUserEvent(core, {
        event_id: "evt-dod-b-1",
        project,
        session_id: sessionId,
        ts: "2026-04-20T00:00:00.000Z",
        payload: { content: "initial content" },
      });

      // Partial finalize at t=T+1 — session stays active
      const partialRes = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
        partial: true,
      });
      expect(partialRes.ok).toBe(true);
      expect((partialRes.items[0] as Record<string, unknown>).no_op).toBeUndefined();

      // Small delay to ensure full finalize obs has newer created_at
      await new Promise((r) => setTimeout(r, 20));

      // Add more content and full finalize at t=T+2 (later)
      recordUserEvent(core, {
        event_id: "evt-dod-b-2",
        project,
        session_id: sessionId,
        ts: "2026-04-20T00:10:00.000Z",
        payload: { content: "more content after partial" },
      });
      const fullRes = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
      });
      expect(fullRes.ok).toBe(true);

      // resume_pack should return the full summary (most recent)
      const pack = await postResumePack(baseUrl, { project });
      expect(pack.ok).toBe(true);

      const summaryItem = pack.items.find((i) => i.type === "session_summary");
      expect(summaryItem).toBeDefined();
      // Full summary: is_partial should be absent or false
      expect(summaryItem!.is_partial).toBeFalsy();
      expect(summaryItem!.session_id).toBe(sessionId);
    } finally {
      rt.stop();
    }
  });

  test("(c) partial older than other session full → other session full is returned", async () => {
    const rt = createRuntime("dod-c");
    const { core, baseUrl } = rt;
    const project = "s91-003-dod-c";
    const olderSession = "sess-dod-c-older";
    const newerSession = "sess-dod-c-newer";

    try {
      // Older session: partial finalize only
      recordUserEvent(core, {
        event_id: "evt-dod-c-old-1",
        project,
        session_id: olderSession,
        ts: "2026-04-20T00:00:00.000Z",
        payload: { content: "older session content" },
      });
      const oldPartial = core.finalizeSession({
        session_id: olderSession,
        project,
        platform: "claude",
        partial: true,
      });
      expect(oldPartial.ok).toBe(true);

      // Small delay to ensure newer session obs has strictly later created_at
      await new Promise((r) => setTimeout(r, 20));

      // Newer session: full finalize (later timestamp)
      recordUserEvent(core, {
        event_id: "evt-dod-c-new-1",
        project,
        session_id: newerSession,
        ts: "2026-04-20T01:00:00.000Z",
        payload: { content: "newer session content" },
      });
      const newFull = core.finalizeSession({
        session_id: newerSession,
        project,
        platform: "claude",
      });
      expect(newFull.ok).toBe(true);

      // resume_pack must pick newer session's full summary
      const pack = await postResumePack(baseUrl, { project });
      expect(pack.ok).toBe(true);

      const summaryItem = pack.items.find((i) => i.type === "session_summary");
      expect(summaryItem).toBeDefined();
      expect(summaryItem!.session_id).toBe(newerSession);
      // Full summary: is_partial absent/false
      expect(summaryItem!.is_partial).toBeFalsy();
    } finally {
      rt.stop();
    }
  });

  test("(d) include_partial=false excludes partial, returns only full-finalize summary", async () => {
    const rt = createRuntime("dod-d");
    const { core, baseUrl } = rt;
    const project = "s91-003-dod-d";
    const sessionId = "sess-dod-d";
    const activeSession = "sess-dod-d-active";

    try {
      // Session A: full finalize (provides the fallback full summary)
      recordUserEvent(core, {
        event_id: "evt-dod-d-1",
        project,
        session_id: sessionId,
        ts: "2026-04-20T00:00:00.000Z",
        payload: { content: "dod-d content" },
      });
      const fullRes = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
      });
      expect(fullRes.ok).toBe(true);

      // Small delay so partial obs is strictly newer
      await new Promise((r) => setTimeout(r, 20));

      // Session B (active): partial finalize only (newer than A's full)
      recordUserEvent(core, {
        event_id: "evt-dod-d-active-1",
        project,
        session_id: activeSession,
        ts: "2026-04-20T01:00:00.000Z",
        payload: { content: "active session content" },
      });
      const partialRes = core.finalizeSession({
        session_id: activeSession,
        project,
        platform: "claude",
        partial: true,
      });
      expect(partialRes.ok).toBe(true);
      expect((partialRes.items[0] as Record<string, unknown>).no_op).toBeUndefined();

      // With include_partial=false, partial must be excluded →
      // only the full-finalize summary from session A is returned
      const packExclude = await postResumePack(baseUrl, {
        project,
        include_partial: false,
      });
      expect(packExclude.ok).toBe(true);

      const summaryExclude = packExclude.items.find((i) => i.type === "session_summary");
      // A full summary must still be returned
      expect(summaryExclude).toBeDefined();
      // It must NOT be from the partial-only session
      expect(summaryExclude!.session_id).toBe(sessionId);
      // Not partial
      expect(summaryExclude!.is_partial).toBeFalsy();

      // With include_partial=true (default), the partial wins (it's newer)
      const packInclude = await postResumePack(baseUrl, {
        project,
        include_partial: true,
      });
      expect(packInclude.ok).toBe(true);

      const summaryInclude = packInclude.items.find((i) => i.type === "session_summary");
      expect(summaryInclude).toBeDefined();
      expect(summaryInclude!.is_partial).toBe(true);
      expect(summaryInclude!.session_id).toBe(activeSession);
    } finally {
      rt.stop();
    }
  });
});
