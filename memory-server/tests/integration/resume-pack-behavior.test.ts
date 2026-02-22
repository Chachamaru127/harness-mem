import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  core: HarnessMemCore;
  dir: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-resume-pack-${name}-`));
  const port = 40200 + Math.floor(Math.random() * 1000);
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
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return {
    core,
    dir,
    baseUrl: `http://127.0.0.1:${port}`,
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

function recordEvent(core: HarnessMemCore, overrides: Partial<EventEnvelope>): void {
  const event: EventEnvelope = {
    event_id: "default-event-id",
    platform: "codex",
    project: "resume-pack-project",
    session_id: "resume-pack-session",
    event_type: "user_prompt",
    ts: "2026-02-20T00:00:00.000Z",
    payload: { content: "resume pack default content" },
    tags: ["resume-pack"],
    privacy_tags: [],
    ...overrides,
  };
  const response = core.recordEvent(event);
  expect(response.ok).toBe(true);
}

async function postResumePack(baseUrl: string, body: Record<string, unknown>): Promise<ApiPayload> {
  const response = await fetch(`${baseUrl}/v1/resume-pack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<ApiPayload>;
}

function pickObservationItems(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return items.filter((item) => item.type === "observation");
}

describe("resume-pack integration behavior", () => {
  test("include_private=false excludes private and sensitive observations", async () => {
    const runtime = createRuntime("privacy");
    const { core, baseUrl } = runtime;
    const project = "resume-pack-privacy";

    try {
      recordEvent(core, {
        event_id: "resume-public",
        project,
        session_id: "privacy-session",
        ts: "2026-02-20T00:00:00.000Z",
        payload: { content: "public note for resume-pack" },
        privacy_tags: [],
      });
      recordEvent(core, {
        event_id: "resume-private",
        project,
        session_id: "privacy-session",
        ts: "2026-02-20T00:01:00.000Z",
        payload: { content: "private note for resume-pack" },
        privacy_tags: ["private"],
      });
      recordEvent(core, {
        event_id: "resume-sensitive",
        project,
        session_id: "privacy-session",
        ts: "2026-02-20T00:02:00.000Z",
        payload: { content: "sensitive note for resume-pack" },
        privacy_tags: ["sensitive"],
      });

      const payload = await postResumePack(baseUrl, {
        project,
        include_private: false,
        limit: 20,
      });
      expect(payload.ok).toBe(true);
      const observations = pickObservationItems(payload.items);
      const ids = observations.map((item) => String(item.id));

      expect(ids).toContain("obs_resume-public");
      expect(ids).not.toContain("obs_resume-private");
      expect(ids).not.toContain("obs_resume-sensitive");

      for (const item of observations) {
        const tags = ((item.privacy_tags || []) as string[]).map((tag) => tag.toLowerCase());
        expect(tags.includes("private")).toBe(false);
        expect(tags.includes("sensitive")).toBe(false);
      }
    } finally {
      runtime.stop();
    }
  });

  test("project boundary prevents cross-project leakage", async () => {
    const runtime = createRuntime("project-boundary");
    const { core, baseUrl } = runtime;

    try {
      recordEvent(core, {
        event_id: "project-a-1",
        project: "resume-pack-project-a",
        session_id: "project-a-session",
        ts: "2026-02-20T01:00:00.000Z",
        payload: { content: "project a context" },
      });
      recordEvent(core, {
        event_id: "project-b-1",
        project: "resume-pack-project-b",
        session_id: "project-b-session",
        ts: "2026-02-20T01:01:00.000Z",
        payload: { content: "project b context" },
      });

      const payload = await postResumePack(baseUrl, {
        project: "resume-pack-project-a",
        include_private: true,
        limit: 20,
      });
      expect(payload.ok).toBe(true);

      const observations = pickObservationItems(payload.items);
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.some((item) => item.id === "obs_project-b-1")).toBe(false);

      for (const item of observations) {
        expect(item.project).toBe("resume-pack-project-a");
      }
    } finally {
      runtime.stop();
    }
  });

  test("session_id excludes observations from the same session", async () => {
    const runtime = createRuntime("session-exclusion");
    const { core, baseUrl } = runtime;
    const project = "resume-pack-session";
    const currentSession = "active-session";
    const previousSession = "history-session";

    try {
      recordEvent(core, {
        event_id: "session-current-1",
        project,
        session_id: currentSession,
        ts: "2026-02-20T02:00:00.000Z",
        payload: { content: "current session context" },
      });
      recordEvent(core, {
        event_id: "session-current-2",
        project,
        session_id: currentSession,
        ts: "2026-02-20T02:01:00.000Z",
        payload: { content: "current session follow-up" },
      });
      recordEvent(core, {
        event_id: "session-history-1",
        project,
        session_id: previousSession,
        ts: "2026-02-20T02:02:00.000Z",
        payload: { content: "history session context" },
      });

      const payload = await postResumePack(baseUrl, {
        project,
        session_id: currentSession,
        include_private: true,
        limit: 20,
      });
      expect(payload.ok).toBe(true);

      const observations = pickObservationItems(payload.items);
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.some((item) => item.session_id === currentSession)).toBe(false);
      expect(observations.some((item) => item.session_id === previousSession)).toBe(true);
    } finally {
      runtime.stop();
    }
  });

  test("correlation_id limits results to the targeted chain only", async () => {
    const runtime = createRuntime("correlation");
    const { core, baseUrl } = runtime;
    const project = "resume-pack-correlation";
    const targetCorrelationId = "corr-target";

    try {
      recordEvent(core, {
        event_id: "corr-target-1",
        project,
        session_id: "target-session-1",
        correlation_id: targetCorrelationId,
        ts: "2026-02-20T03:00:00.000Z",
        payload: { content: "target chain event 1" },
      });
      recordEvent(core, {
        event_id: "corr-target-2",
        project,
        session_id: "target-session-2",
        correlation_id: targetCorrelationId,
        ts: "2026-02-20T03:01:00.000Z",
        payload: { content: "target chain event 2" },
      });
      recordEvent(core, {
        event_id: "corr-other-chain",
        project,
        session_id: "other-chain-session",
        correlation_id: "corr-other",
        ts: "2026-02-20T03:02:00.000Z",
        payload: { content: "other chain event" },
      });
      recordEvent(core, {
        event_id: "corr-other-project",
        project: "resume-pack-other-project",
        session_id: "other-project-session",
        correlation_id: targetCorrelationId,
        ts: "2026-02-20T03:03:00.000Z",
        payload: { content: "same correlation id, different project" },
      });

      const payload = await postResumePack(baseUrl, {
        project,
        correlation_id: targetCorrelationId,
        include_private: true,
        limit: 20,
      });
      expect(payload.ok).toBe(true);

      const observations = pickObservationItems(payload.items);
      expect(observations.length).toBeGreaterThan(0);
      const allowedSessions = new Set(["target-session-1", "target-session-2"]);

      for (const item of observations) {
        expect(allowedSessions.has(String(item.session_id))).toBe(true);
      }

      const observedSessionIds = new Set(observations.map((item) => String(item.session_id)));
      expect(observedSessionIds.has("target-session-1")).toBe(true);
      expect(observedSessionIds.has("target-session-2")).toBe(true);
      expect(observedSessionIds.has("other-chain-session")).toBe(false);
      expect(observedSessionIds.has("other-project-session")).toBe(false);

      const summary = payload.items.find((item) => item.type === "session_summary");
      if (summary) {
        expect(allowedSessions.has(String(summary.session_id))).toBe(true);
      }
    } finally {
      runtime.stop();
    }
  });
});
