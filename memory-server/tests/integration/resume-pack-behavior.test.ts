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
  const port = server.port;
  return {
    core,
    dir,
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
      const leakCount = observations.filter((item) => {
        const tags = ((item.privacy_tags || []) as string[]).map((tag) => tag.toLowerCase());
        return tags.includes("private") || tags.includes("sensitive");
      }).length;

      expect(ids).toContain("obs_resume-public");
      expect(ids).not.toContain("obs_resume-private");
      expect(ids).not.toContain("obs_resume-sensitive");
      expect(leakCount).toBe(0);

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
      const leakCount = observations.filter(
        (item) => String(item.project) !== "resume-pack-project-a"
      ).length;
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.some((item) => item.id === "obs_project-b-1")).toBe(false);
      expect(leakCount).toBe(0);

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

  test("resume-pack exposes continuity briefing with latest interaction context", async () => {
    const runtime = createRuntime("continuity-briefing");
    const { core, baseUrl } = runtime;
    const project = "resume-pack-briefing";

    try {
      recordEvent(core, {
        event_id: "briefing-user",
        project,
        session_id: "previous-session",
        ts: "2026-02-20T04:00:00.000Z",
        payload: { content: "Figure out why new sessions lose context" },
      });
      recordEvent(core, {
        event_id: "briefing-assistant",
        project,
        session_id: "previous-session",
        event_type: "checkpoint",
        ts: "2026-02-20T04:00:05.000Z",
        payload: {
          title: "assistant_response",
          content: "We decided to ship a continuity briefing and fix adapter delivery next.",
        },
      });

      const finalizeResponse = core.finalizeSession({
        session_id: "previous-session",
        project,
        platform: "codex",
        summary_mode: "standard",
      });
      expect(finalizeResponse.ok).toBe(true);

      const payload = await postResumePack(baseUrl, {
        project,
        session_id: "current-session",
        include_private: true,
        limit: 5,
      });
      expect(payload.ok).toBe(true);

      const latestInteraction = payload.meta.latest_interaction as Record<string, unknown>;
      expect(latestInteraction).toBeTruthy();
      expect(latestInteraction.scope).toBe("project");
      expect(latestInteraction.session_id).toBe("previous-session");
      expect(latestInteraction.incomplete).toBe(false);

      const prompt = latestInteraction.prompt as Record<string, unknown>;
      const response = latestInteraction.response as Record<string, unknown>;
      expect(String(prompt.content)).toContain("lose context");
      expect(String(response.content)).toContain("continuity briefing");

      const briefing = payload.meta.continuity_briefing as Record<string, unknown>;
      expect(briefing).toBeTruthy();
      expect(briefing.source_session_id).toBe("previous-session");
      expect(briefing.includes_summary).toBe(true);
      expect(briefing.includes_latest_interaction).toBe(true);
      expect(String(briefing.content)).toContain("Continuity Briefing");
      expect(String(briefing.content)).toContain("lose context");
      expect(String(briefing.content)).toContain("continuity briefing");
    } finally {
      runtime.stop();
    }
  });

  test("resume-pack carry-forward surfaces explicit decisions and next actions near the top", async () => {
    const runtime = createRuntime("continuity-carry-forward");
    const { core, baseUrl } = runtime;
    const project = "resume-pack-carry-forward";

    try {
      recordEvent(core, {
        event_id: "carry-user",
        project,
        session_id: "previous-session",
        ts: "2026-03-25T00:00:00.000Z",
        payload: {
          content: [
            "問題:",
            "- 新しいセッションを開くと、前に何を話していたかが途切れやすい",
            "",
            "決定:",
            "- continuity briefing を最初のターンで必ず見せる",
            "- Claude と Codex で同じ品質にする",
            "",
            "次アクション:",
            "- adapter delivery を両方で揃える",
            "- OpenAPI や DB index の話は今回の本筋ではない",
          ].join("\n"),
        },
      });

      const finalizeResponse = core.finalizeSession({
        session_id: "previous-session",
        project,
        platform: "claude",
        summary_mode: "standard",
      });
      expect(finalizeResponse.ok).toBe(true);

      const payload = await postResumePack(baseUrl, {
        project,
        session_id: "current-session",
        include_private: true,
        limit: 5,
      });

      const briefing = payload.meta.continuity_briefing as Record<string, unknown>;
      expect(briefing).toBeTruthy();
      expect(String(briefing.content)).toContain("## Carry Forward");
      expect(String(briefing.content)).toContain("Decision: continuity briefing を最初のターンで必ず見せる");
      expect(String(briefing.content)).toContain("Decision: Claude と Codex で同じ品質にする");
      expect(String(briefing.content)).toContain("Next Action: adapter delivery を両方で揃える");
      expect(String(briefing.content)).not.toContain("Next Action: OpenAPI や DB index の話は今回の本筋ではない");
      expect(String(briefing.content)).toContain("## Key Points");
      expect(String(briefing.content)).toContain("OpenAPI や DB index の話は今回の本筋ではない");
      expect(String(briefing.content).match(/## Latest Exchange/g)?.length ?? 0).toBe(1);
    } finally {
      runtime.stop();
    }
  });

  test("pinned continuity keeps the original next action visible across follow-up sessions", async () => {
    const runtime = createRuntime("pinned-continuity");
    const { core, baseUrl } = runtime;
    const project = "resume-pack-pinned";
    const correlationId = "corr-pinned";
    const explicitHandoff = [
      "問題:",
      "- 新しいセッションを開くと、前に何を話していたかが途切れやすい",
      "",
      "決定:",
      "- continuity briefing を最初のターンで必ず見せる",
      "- Claude と Codex で同じ品質にする",
      "",
      "次アクション:",
      "- adapter delivery を両方で揃える",
      "- OpenAPI や DB index の話は今回の本筋ではない",
    ].join("\n");

    try {
      recordEvent(core, {
        event_id: "pinned-user",
        project,
        session_id: "session-1",
        correlation_id: correlationId,
        ts: "2026-03-25T01:00:00.000Z",
        payload: { prompt: explicitHandoff },
        tags: ["hook", "user_prompt"],
      });
      recordEvent(core, {
        event_id: "pinned-explicit-handoff",
        project,
        session_id: "session-1",
        correlation_id: correlationId,
        event_type: "checkpoint",
        ts: "2026-03-25T01:00:01.000Z",
        payload: { title: "continuity_handoff", content: explicitHandoff },
        tags: ["hook", "continuity_handoff", "pinned_continuity"],
      });

      const firstFinalize = core.finalizeSession({
        session_id: "session-1",
        project,
        platform: "claude",
        correlation_id: correlationId,
        summary_mode: "standard",
      });
      expect(firstFinalize.ok).toBe(true);

      recordEvent(core, {
        event_id: "thin-follow-up-response",
        project,
        session_id: "session-2",
        correlation_id: correlationId,
        event_type: "checkpoint",
        ts: "2026-03-25T01:10:00.000Z",
        payload: {
          title: "assistant_response",
          content: [
            "1. 問題: 新しいセッションを開始すると前の会話の文脈が途切れる",
            "2. 決定: continuity briefing を最初のターンで必ず表示する",
            "3. 次にやるべきこと: S59-006 を完了する",
          ].join("\n"),
        },
        tags: ["hook", "assistant_response"],
      });

      const secondFinalize = core.finalizeSession({
        session_id: "session-2",
        project,
        platform: "claude",
        correlation_id: correlationId,
        summary_mode: "standard",
      });
      expect(secondFinalize.ok).toBe(true);

      const payload = await postResumePack(baseUrl, {
        project,
        session_id: "session-3",
        correlation_id: correlationId,
        include_private: true,
        limit: 5,
      });

      const briefing = payload.meta.continuity_briefing as Record<string, unknown>;
      expect(briefing).toBeTruthy();
      const content = String(briefing.content);
      expect(content).toContain("## Pinned Continuity");
      expect(content).toContain("## Recent Update");
      expect(content).toContain("Next Action: adapter delivery を両方で揃える");
      expect(content).toContain("S59-006 を完了する");
      expect(content.indexOf("## Pinned Continuity")).toBeLessThan(content.indexOf("## Current Focus"));
      expect(content.indexOf("adapter delivery を両方で揃える")).toBeLessThan(content.indexOf("S59-006 を完了する"));
      expect(content).not.toContain("continuity_handoff:");
      expect(content).not.toContain("session_start:");
      expect(content).not.toContain("## Carry Forward");
      expect(content).not.toContain("## Memory Anchors");
      expect(content).not.toContain("## Last Session Summary");
    } finally {
      runtime.stop();
    }
  });

  test("resume-pack exposes a secondary recent-project context without breaking chain-first continuity", async () => {
    const runtime = createRuntime("recent-project-context");
    const { core, baseUrl } = runtime;
    const project = "resume-pack-recent-project";
    const correlationId = "corr-hybrid";

    try {
      recordEvent(core, {
        event_id: "hybrid-user",
        project,
        session_id: "session-chain-1",
        correlation_id: correlationId,
        ts: "2026-03-28T01:00:00.000Z",
        payload: { content: "Users say opening a new session forgets the current thread." },
        tags: ["continuity"],
      });
      recordEvent(core, {
        event_id: "hybrid-assistant",
        project,
        session_id: "session-chain-1",
        correlation_id: correlationId,
        event_type: "checkpoint",
        ts: "2026-03-28T01:00:05.000Z",
        payload: {
          title: "assistant_response",
          content: "Decision: ship continuity briefing first. Next Action: align adapter delivery.",
        },
        tags: ["continuity"],
      });
      expect(
        core.finalizeSession({
          session_id: "session-chain-1",
          project,
          platform: "claude",
          correlation_id: correlationId,
          summary_mode: "standard",
        }).ok
      ).toBe(true);

      recordEvent(core, {
        event_id: "recent-openapi-user",
        project,
        session_id: "session-openapi",
        correlation_id: "corr-openapi",
        ts: "2026-03-28T02:00:00.000Z",
        payload: { content: "Regenerate OpenAPI 3.1 docs and polish Swagger dark mode." },
        tags: ["docs"],
      });
      recordEvent(core, {
        event_id: "recent-openapi-assistant",
        project,
        session_id: "session-openapi",
        correlation_id: "corr-openapi",
        event_type: "checkpoint",
        ts: "2026-03-28T02:00:05.000Z",
        payload: {
          title: "assistant_response",
          content: "OpenAPI 3.1 bundle refreshed. Swagger dark mode tweaks are pending.",
        },
        tags: ["docs"],
      });

      recordEvent(core, {
        event_id: "recent-db-user",
        project,
        session_id: "session-db",
        correlation_id: "corr-db",
        ts: "2026-03-28T03:00:00.000Z",
        payload: { content: "Investigate the database index slowdown on users queries." },
        tags: ["perf"],
      });
      recordEvent(core, {
        event_id: "recent-db-assistant",
        project,
        session_id: "session-db",
        correlation_id: "corr-db",
        event_type: "checkpoint",
        ts: "2026-03-28T03:00:05.000Z",
        payload: {
          title: "assistant_response",
          content: "Composite database index reduced the query time from 120ms to 8ms.",
        },
        tags: ["perf"],
      });

      const payload = await postResumePack(baseUrl, {
        project,
        session_id: "session-current",
        correlation_id: correlationId,
        include_private: true,
        limit: 5,
      });

      const briefing = payload.meta.continuity_briefing as Record<string, unknown>;
      expect(String(briefing.content)).toContain("align adapter delivery");

      const recentProject = payload.meta.recent_project_context as Record<string, unknown>;
      expect(recentProject).toBeTruthy();
      expect(recentProject.source_scope).toBe("project");
      expect(recentProject.item_count).toBe(2);
      const recentContent = String(recentProject.content);
      expect(recentContent).toContain("## Also Recently in This Project");
      expect(recentContent).toContain("OpenAPI 3.1");
      expect(recentContent).toContain("Swagger dark mode");
      expect(recentContent).toContain("database index");
      expect(recentContent).toContain("120ms to 8ms");
      expect(recentContent).not.toContain("align adapter delivery");
      expect(recentContent).not.toContain("session_start:");
      expect(recentContent).not.toContain("continuity_handoff:");
    } finally {
      runtime.stop();
    }
  });
});
