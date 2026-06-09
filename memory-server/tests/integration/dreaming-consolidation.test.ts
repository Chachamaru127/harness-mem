/**
 * S154-201: dreaming consolidation job wiring.
 *
 * Proves the DoD: after finalizeSession a `dreaming` job is enqueued, is visible
 * as a distinct job type via admin consolidation status (jobs_by_reason), and on
 * run produces a `consolidation.dreaming` audit row. Dreaming is local by default
 * (provider=ollama); pointing it at an external provider requires an explicit env
 * opt-in and is warned + audited. Existing consolidation behavior is non-regressed.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const ENV_KEYS = [
  "HARNESS_MEM_DREAMING_LLM_PROVIDER",
  "HARNESS_MEM_DREAMING_OLLAMA_HOST",
  "HARNESS_MEM_DREAMING_LLM_MODEL",
  "HARNESS_MEM_OLLAMA_HOST",
  "HARNESS_MEM_FACT_EXTRACTOR_MODE",
  "HARNESS_MEM_FACT_LLM_MODEL",
];
const cleanupPaths: string[] = [];
let savedEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-dreaming-${name}-`));
  cleanupPaths.push(dir);
  return {
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
    consolidationEnabled: true,
  };
}

function seedAndFinalize(core: HarnessMemCore, project: string, session: string): void {
  const event: EventEnvelope = {
    platform: "claude",
    project,
    session_id: session,
    event_type: "checkpoint",
    ts: "2026-06-08T10:00:00.000Z",
    payload: { prompt: "本番DBを PostgreSQL に決定した。" },
    tags: [],
    privacy_tags: [],
  };
  core.recordEvent(event);
  const res = core.finalizeSession({ session_id: session, project, platform: "claude" });
  expect(res.ok).toBe(true);
}

function statusItem(core: HarnessMemCore): Record<string, unknown> {
  const res = core.getConsolidationStatus();
  expect(res.ok).toBe(true);
  return res.items[0] as Record<string, unknown>;
}

function auditRows(core: HarnessMemCore, action: string): Array<{ details: Record<string, unknown> }> {
  const res = core.getAuditLog({ limit: 50, action });
  expect(res.ok).toBe(true);
  return res.items as Array<{ details: Record<string, unknown> }>;
}

function requestUrl(url: string | URL | Request): string {
  return typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
}

function isOllamaTagsRequest(url: string | URL | Request): boolean {
  return requestUrl(url).includes("/api/tags");
}

function ollamaTagsResponse(): Response {
  return new Response(JSON.stringify({ models: [{ name: "qwen3.5:9b" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockOllamaRewrite(response: Record<string, unknown>, inspect?: (body: string) => void): void {
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (isOllamaTagsRequest(url)) return ollamaTagsResponse();
    const raw = requestUrl(url);
    expect(raw).toContain("127.0.0.1");
    inspect?.(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({ message: { content: JSON.stringify(response) } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

describe("S154-201 dreaming consolidation job", () => {
  test("finalize enqueues a dreaming job visible by reason in admin status", async () => {
    const core = new HarnessMemCore(createConfig("status"));
    try {
      seedAndFinalize(core, "dream-status", "s1");
      const item = statusItem(core);
      const byReason = item.jobs_by_reason as Record<string, number>;
      expect(byReason).toBeDefined();
      expect(byReason.dreaming).toBeGreaterThanOrEqual(1);
      expect(byReason.finalize).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("running the queue produces a consolidation.dreaming audit (local default provider)", async () => {
    const core = new HarnessMemCore(createConfig("run"));
    try {
      seedAndFinalize(core, "dream-run", "s1");
      await core.runConsolidation({}); // process the queued finalize + dreaming jobs
      const dreaming = auditRows(core, "consolidation.dreaming");
      expect(dreaming.length).toBeGreaterThanOrEqual(1);
      expect(dreaming[0].details.provider).toBe("ollama"); // local default, no egress
      // the generic consolidation.run row carries reason=dreaming for the dreaming job
      const runs = auditRows(core, "consolidation.run");
      expect(runs.some((r) => r.details.reason === "dreaming")).toBe(true);
      // local default → no external-provider audit
      expect(auditRows(core, "consolidation.dreaming.external_provider")).toHaveLength(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("external dreaming provider requires explicit opt-in and is audited", async () => {
    process.env.HARNESS_MEM_DREAMING_LLM_PROVIDER = "openai";
    const core = new HarnessMemCore(createConfig("external"));
    try {
      seedAndFinalize(core, "dream-ext", "s1");
      await core.runConsolidation({});
      const ext = auditRows(core, "consolidation.dreaming.external_provider");
      expect(ext.length).toBeGreaterThanOrEqual(1);
      expect(ext[0].details.provider).toBe("openai");
      const dreaming = auditRows(core, "consolidation.dreaming");
      expect(dreaming[0].details.provider).toBe("openai");
      const skipped = auditRows(core, "consolidation.dreaming.tense_rewrite_skipped");
      expect(skipped[0].details.reason).toBe("external_provider");
    } finally {
      core.shutdown("test");
    }
  });

  test("hybrid backend skips local-only dreaming rewrites instead of creating unmanaged observations", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("hybrid backend should skip raw local dreaming writes before calling the LLM");
    };

    const core = new HarnessMemCore({
      ...createConfig("hybrid-skip"),
      backendMode: "hybrid",
    });
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-hybrid-skip",
        session_id: "s-hybrid-skip",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-hybrid-skip",
        session_id: "s-hybrid-skip",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-hybrid-skip", session_id: "s-hybrid-skip", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const row = core.getRawDb()
        .query(`SELECT COUNT(*) AS count FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { count: number };
      expect(row.count).toBe(0);

      const skipped = auditRows(core, "consolidation.dreaming.tense_rewrite_skipped");
      expect(skipped[0].details.reason).toBe("managed_backend");
    } finally {
      core.shutdown("test");
    }
  });

  test("local dreaming rewrites completed planned observations append-only and invalidates the old row", async () => {
    process.env.HARNESS_MEM_DREAMING_OLLAMA_HOST = "http://127.0.0.1:11434";
    process.env.HARNESS_MEM_DREAMING_LLM_MODEL = "qwen3.5:9b";
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted on Friday with 本番環境デプロイ.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Evidence says submitted.",
    });

    const core = new HarnessMemCore(createConfig("tense-rewrite"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-tense",
        session_id: "s-tense",
        user_id: "user-dream",
        team_id: "team-dream",
        thread_id: "thread-dream",
        topic: "api-spec",
        branch: "feature/dream",
        expires_at: "2030-01-01T00:00:00.000Z",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-tense",
        session_id: "s-tense",
        user_id: "user-dream",
        team_id: "team-dream",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const beforeRunMs = Date.now();
      const stats = await core.runConsolidation({ project: "dream-tense", session_id: "s-tense", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const db = core.getRawDb();
      const rewritten = db
        .query(`SELECT id, content_redacted, supersedes, event_time, valid_from, created_at, user_id, team_id, thread_id, topic, branch, expires_at FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as {
          id: string;
          content_redacted: string;
          supersedes: string;
          event_time: string;
          valid_from: string;
          created_at: string;
          user_id: string;
          team_id: string;
          thread_id: string;
          topic: string;
          branch: string;
          expires_at: string;
        };
      expect(rewritten.content_redacted).toContain("GearChange API spec was submitted");
      expect(rewritten.event_time).toBe("2026-06-09T10:00:00.000Z");
      expect(rewritten.valid_from).toBe("2026-06-09T10:00:00.000Z");
      expect(Date.parse(rewritten.created_at)).toBeGreaterThanOrEqual(beforeRunMs);
      expect(rewritten.user_id).toBe("user-dream");
      expect(rewritten.team_id).toBe("team-dream");
      expect(rewritten.thread_id).toBe("thread-dream");
      expect(rewritten.topic).toBe("api-spec");
      expect(rewritten.branch).toBe("feature/dream");
      expect(rewritten.expires_at).toBe("2030-01-01T00:00:00.000Z");

      const ftsMatch = db
        .query(`SELECT COUNT(*) AS count FROM mem_observations_fts WHERE mem_observations_fts MATCH ? AND observation_id = ?`)
        .get("デプロイ", rewritten.id) as { count: number };
      expect(ftsMatch.count).toBe(1);

      const oldRow = db
        .query(`SELECT valid_to, invalidated_at, content_redacted FROM mem_observations WHERE id = ?`)
        .get(rewritten.supersedes) as { valid_to: string | null; invalidated_at: string | null; content_redacted: string };
      expect(oldRow.content_redacted).toContain("will submit");
      expect(oldRow.valid_to).toBe("2026-06-09T10:00:00.000Z");
      expect(oldRow.invalidated_at).toBeTruthy();

      const link = db
        .query(`SELECT relation FROM mem_links WHERE from_observation_id = ? AND to_observation_id = ?`)
        .get(rewritten.id, rewritten.supersedes) as { relation: string };
      expect(link.relation).toBe("superseded");

      const vectorRows = db
        .query(`SELECT COUNT(*) AS count FROM mem_vectors WHERE observation_id = ?`)
        .get(rewritten.id) as { count: number };
      expect(vectorRows.count).toBeGreaterThanOrEqual(1);

      const nuggetVectorRows = db
        .query(`SELECT COUNT(*) AS count FROM mem_nugget_vectors WHERE observation_id = ?`)
        .get(rewritten.id) as { count: number };
      expect(nuggetVectorRows.count).toBeGreaterThanOrEqual(1);

      const dreaming = auditRows(core, "consolidation.dreaming");
      expect(dreaming[0].details.tense_rewrites_created).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite can close a planned observation from an earlier session", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted in the follow-up session.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Evidence says submitted.",
    });

    const core = new HarnessMemCore(createConfig("tense-cross-session"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-cross-session",
        session_id: "s-plan",
        user_id: "user-dream",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-cross-session",
        session_id: "s-done",
        user_id: "user-dream",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-cross-session", session_id: "s-done", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const db = core.getRawDb();
      const rewritten = db
        .query(`SELECT session_id, supersedes, content_redacted FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { session_id: string; supersedes: string; content_redacted: string };
      expect(rewritten.session_id).toBe("s-done");
      expect(rewritten.content_redacted).toContain("follow-up session");

      const source = db
        .query(`SELECT session_id, valid_to, invalidated_at FROM mem_observations WHERE id = ?`)
        .get(rewritten.supersedes) as { session_id: string; valid_to: string | null; invalidated_at: string | null };
      expect(source.session_id).toBe("s-plan");
      expect(source.valid_to).toBe("2026-06-09T10:00:00.000Z");
      expect(source.invalidated_at).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite keeps current-session rows even when project-wide recency cap is full", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted despite unrelated project noise.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Evidence says submitted.",
    });

    const core = new HarnessMemCore(createConfig("tense-session-cap"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-session-cap",
        session_id: "s-target",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-session-cap",
        session_id: "s-target",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      for (let i = 0; i < 501; i += 1) {
        core.recordEvent({
          platform: "claude",
          project: "dream-session-cap",
          session_id: `s-noise-${i}`,
          event_type: "checkpoint",
          ts: `2026-06-10T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
          payload: { prompt: `Unrelated project note ${i}.` },
          tags: [],
          privacy_tags: [],
        });
      }

      const stats = await core.runConsolidation({ project: "dream-session-cap", session_id: "s-target", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const row = core.getRawDb()
        .query(`SELECT content_redacted FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { content_redacted: string };
      expect(row.content_redacted).toContain("despite unrelated project noise");
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite does not call the local LLM for unrelated completion evidence", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("unrelated evidence should be filtered before Ollama preflight");
    };

    const core = new HarnessMemCore(createConfig("tense-unrelated-evidence"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-unrelated-evidence",
        session_id: "s-unrelated-evidence",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-unrelated-evidence",
        session_id: "s-unrelated-evidence",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the timesheet. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-unrelated-evidence", session_id: "s-unrelated-evidence", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite rejects unrelated local LLM output", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "Website deployment was completed.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Bad local output.",
    });

    const core = new HarnessMemCore(createConfig("tense-output-unrelated"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-output-unrelated",
        session_id: "s-output-unrelated",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-output-unrelated",
        session_id: "s-output-unrelated",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-output-unrelated", session_id: "s-output-unrelated", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite rejects mixed local LLM output", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted and DB is PostgreSQL.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Bad local output.",
    });

    const core = new HarnessMemCore(createConfig("tense-output-mixed"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-output-mixed",
        session_id: "s-output-mixed",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-output-mixed",
        session_id: "s-output-mixed",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-output-mixed", session_id: "s-output-mixed", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite skips when existing facts reveal mixed blast radius", async () => {
    let chatCalls = 0;
    globalThis.fetch = async (url: string | URL | Request): Promise<Response> => {
      if (isOllamaTagsRequest(url)) return ollamaTagsResponse();
      chatCalls += 1;
      throw new Error("mixed fact containment should skip before chat");
    };

    const core = new HarnessMemCore(createConfig("tense-fact-mixed"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-fact-mixed",
        session_id: "s-fact-mixed",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-fact-mixed",
        session_id: "s-fact-mixed",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const db = core.getRawDb();
      const planned = db
        .query(`SELECT id FROM mem_observations WHERE content_redacted LIKE '%will submit%' LIMIT 1`)
        .get() as { id: string };
      const createdAt = "2026-06-08T10:00:00.000Z";
      db.query(`
        INSERT INTO mem_facts(
          fact_id, observation_id, project, session_id, fact_type, fact_key, fact_value,
          confidence, created_at, updated_at
        ) VALUES
          ('fact_action_scope', ?, 'dream-fact-mixed', 's-fact-mixed', 'action', 'GearChange API spec', 'submit on Friday', 0.9, ?, ?),
          ('fact_unrelated_scope', ?, 'dream-fact-mixed', 's-fact-mixed', 'decision', 'database engine', 'PostgreSQL', 0.9, ?, ?)
      `).run(planned.id, createdAt, createdAt, planned.id, createdAt, createdAt);

      const stats = await core.runConsolidation({ project: "dream-fact-mixed", session_id: "s-fact-mixed", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
      expect(chatCalls).toBe(0);

      const facts = db
        .query(`SELECT fact_id, valid_to, invalidated_at FROM mem_facts WHERE observation_id = ? ORDER BY fact_id`)
        .all(planned.id) as Array<{ fact_id: string; valid_to: string | null; invalidated_at: string | null }>;
      expect(facts).toHaveLength(2);
      expect(facts.every((fact) => fact.valid_to === null && fact.invalidated_at === null)).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite does not pair completion evidence from another branch", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("cross-branch evidence should not be sent to tense rewrite");
    };

    const core = new HarnessMemCore(createConfig("tense-branch-skip"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-branch-skip",
        session_id: "s-branch-skip",
        branch: "feature/a",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-branch-skip",
        session_id: "s-branch-skip",
        branch: "feature/b",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-branch-skip", session_id: "s-branch-skip", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const source = core.getRawDb()
        .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE branch = 'feature/a' AND content_redacted LIKE '%will submit%' LIMIT 1`)
        .get() as { valid_to: string | null; invalidated_at: string | null };
      expect(source.valid_to).toBeNull();
      expect(source.invalidated_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite skips quickly when local Ollama is unavailable", async () => {
    process.env.HARNESS_MEM_DREAMING_OLLAMA_HOST = "http://127.0.0.1:65535";
    let calls = 0;
    globalThis.fetch = async (url: string | URL | Request): Promise<Response> => {
      calls += 1;
      const raw = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      expect(raw).toContain("/api/tags");
      throw new Error("ollama unavailable");
    };

    const core = new HarnessMemCore(createConfig("tense-ollama-unavailable"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-ollama-unavailable",
        session_id: "s-ollama-unavailable",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-ollama-unavailable",
        session_id: "s-ollama-unavailable",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const started = performance.now();
      const stats = await core.runConsolidation({ project: "dream-ollama-unavailable", session_id: "s-ollama-unavailable", reason: "dreaming" });
      expect(performance.now() - started).toBeLessThan(1000);
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
      expect(calls).toBe(1);

      const skipped = auditRows(core, "consolidation.dreaming.tense_rewrite_skipped");
      expect(skipped[0].details.reason).toBe("ollama_unavailable");
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite does not pair completion evidence from another user scope", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("cross-user evidence should not be sent to tense rewrite");
    };

    const core = new HarnessMemCore(createConfig("tense-user-scope-skip"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-user-scope-skip",
        session_id: "s-user-scope-skip",
        user_id: "alice",
        team_id: "team-a",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-user-scope-skip",
        session_id: "s-user-scope-skip",
        user_id: "bob",
        team_id: "team-b",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-user-scope-skip", session_id: "s-user-scope-skip", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const source = core.getRawDb()
        .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE user_id = 'alice' AND content_redacted LIKE '%will submit%' LIMIT 1`)
        .get() as { valid_to: string | null; invalidated_at: string | null };
      expect(source.valid_to).toBeNull();
      expect(source.invalidated_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite invalidates stale facts before extracting completed facts", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Evidence says submitted.",
    });

    const core = new HarnessMemCore(createConfig("tense-facts"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-facts",
        session_id: "s-facts",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "Next action: submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });

      const initialStats = await core.runConsolidation({ project: "dream-facts", session_id: "s-facts", reason: "manual" });
      expect(initialStats.ok).toBe(true);

      const db = core.getRawDb();
      const staleFact = db
        .query(`
          SELECT f.fact_id, f.observation_id
          FROM mem_facts f
          WHERE f.project = 'dream-facts'
            AND f.valid_to IS NULL
            AND f.fact_value LIKE '%Next action:%'
          LIMIT 1
        `)
        .get() as { fact_id: string; observation_id: string };
      expect(staleFact.fact_id).toBeTruthy();

      core.recordEvent({
        platform: "claude",
        project: "dream-facts",
        session_id: "s-facts",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-facts", session_id: "s-facts", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const invalidated = db
        .query(`SELECT valid_to, invalidated_at FROM mem_facts WHERE fact_id = ?`)
        .get(staleFact.fact_id) as { valid_to: string | null; invalidated_at: string | null };
      expect(invalidated.valid_to).toBe("2026-06-09T10:00:00.000Z");
      expect(invalidated.invalidated_at).toBeTruthy();

      const completedFact = db
        .query(`
          SELECT COUNT(*) AS count
          FROM mem_facts f
          JOIN mem_observations o ON o.id = f.observation_id
          WHERE o.platform = 'dreaming'
            AND f.valid_to IS NULL
            AND f.fact_value LIKE '%was submitted%'
        `)
        .get() as { count: number };
      expect(completedFact.count).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite closes existing future valid_to at the completion timestamp", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Evidence says submitted.",
    });

    const core = new HarnessMemCore(createConfig("tense-future-valid-to-close"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-future-valid-to-close",
        session_id: "s-future-valid-to-close",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "Next action: submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      const initialStats = await core.runConsolidation({ project: "dream-future-valid-to-close", session_id: "s-future-valid-to-close", reason: "manual" });
      expect(initialStats.ok).toBe(true);

      const db = core.getRawDb();
      const planned = db
        .query(`SELECT id FROM mem_observations WHERE content_redacted LIKE '%Next action:%' LIMIT 1`)
        .get() as { id: string };
      db.query(`UPDATE mem_observations SET valid_to = '2030-01-01T00:00:00.000Z' WHERE id = ?`).run(planned.id);
      db.query(`UPDATE mem_facts SET valid_to = '2030-01-01T00:00:00.000Z' WHERE observation_id = ?`).run(planned.id);

      core.recordEvent({
        platform: "claude",
        project: "dream-future-valid-to-close",
        session_id: "s-future-valid-to-close",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-future-valid-to-close", session_id: "s-future-valid-to-close", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const oldRow = db
        .query(`SELECT valid_to FROM mem_observations WHERE id = ?`)
        .get(planned.id) as { valid_to: string | null };
      expect(oldRow.valid_to).toBe("2026-06-09T10:00:00.000Z");

      const oldFact = db
        .query(`SELECT valid_to FROM mem_facts WHERE observation_id = ? LIMIT 1`)
        .get(planned.id) as { valid_to: string | null };
      expect(oldFact.valid_to).toBe("2026-06-09T10:00:00.000Z");
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite skips mixed observations instead of expiring unrelated facts", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("mixed observations should not be sent to tense rewrite");
    };

    const core = new HarnessMemCore(createConfig("tense-mixed-skip"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-mixed-skip",
        session_id: "s-mixed-skip",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday; DB is PostgreSQL." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-mixed-skip",
        session_id: "s-mixed-skip",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-mixed-skip", session_id: "s-mixed-skip", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const source = core.getRawDb()
        .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE content_redacted LIKE '%DB is PostgreSQL%' LIMIT 1`)
        .get() as { valid_to: string | null; invalidated_at: string | null };
      expect(source.valid_to).toBeNull();
      expect(source.invalidated_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite skips conjunction-style mixed observations", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("conjunction-style mixed observations should not be sent to tense rewrite");
    };

    const core = new HarnessMemCore(createConfig("tense-conjunction-mixed-skip"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-conjunction-mixed-skip",
        session_id: "s-conjunction-mixed-skip",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the API spec and DB is PostgreSQL." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-conjunction-mixed-skip",
        session_id: "s-conjunction-mixed-skip",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-conjunction-mixed-skip", session_id: "s-conjunction-mixed-skip", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const source = core.getRawDb()
        .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE content_redacted LIKE '%DB is PostgreSQL%' LIMIT 1`)
        .get() as { valid_to: string | null; invalidated_at: string | null };
      expect(source.valid_to).toBeNull();
      expect(source.invalidated_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite skips comma-separated mixed observations", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("comma-separated mixed observations should not be sent to tense rewrite");
    };

    const core = new HarnessMemCore(createConfig("tense-comma-mixed-skip"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-comma-mixed-skip",
        session_id: "s-comma-mixed-skip",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the API spec, DB is PostgreSQL." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-comma-mixed-skip",
        session_id: "s-comma-mixed-skip",
        event_type: "checkpoint",
        ts: "2026-06-08T10:05:00.000Z",
        payload: { prompt: "API specを提出予定、DBはPostgreSQL。" },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-comma-mixed-skip",
        session_id: "s-comma-mixed-skip",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-comma-mixed-skip", session_id: "s-comma-mixed-skip", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const rows = core.getRawDb()
        .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE content_redacted LIKE '%DB%PostgreSQL%'`)
        .all() as Array<{ valid_to: string | null; invalidated_at: string | null }>;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.valid_to === null && row.invalidated_at === null)).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite skips multi-action planned observations", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("multi-action observations should not be sent to tense rewrite");
    };

    const core = new HarnessMemCore(createConfig("tense-multi-action-skip"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-multi-action-skip",
        session_id: "s-multi-action-skip",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the API spec; we will update the migration." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-multi-action-skip",
        session_id: "s-multi-action-skip",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-multi-action-skip", session_id: "s-multi-action-skip", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const source = core.getRawDb()
        .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE content_redacted LIKE '%update the migration%' LIMIT 1`)
        .get() as { valid_to: string | null; invalidated_at: string | null };
      expect(source.valid_to).toBeNull();
      expect(source.invalidated_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite ignores completion evidence that is temporally before the plan", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("older backfilled completion should not be considered later evidence");
    };

    const core = new HarnessMemCore(createConfig("tense-backfill-before"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-backfill-before",
        session_id: "s-backfill-before",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-backfill-before",
        session_id: "s-backfill-before",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "Submitted an older GearChange draft. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-backfill-before", session_id: "s-backfill-before", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
      const row = core.getRawDb()
        .query(`SELECT COUNT(*) AS count FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite skips plans whose valid_to cutoff has already passed", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("valid_to-expired plans should not be sent to tense rewrite");
    };

    const core = new HarnessMemCore(createConfig("tense-valid-to-expired"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-valid-to-expired",
        session_id: "s-valid-to-expired",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.getRawDb()
        .query(`
          UPDATE mem_observations
          SET valid_to = '2026-06-09T00:00:00.000Z',
              invalidated_at = NULL
          WHERE project = 'dream-valid-to-expired'
            AND content_redacted LIKE '%will submit%'
        `)
        .run();
      core.recordEvent({
        platform: "claude",
        project: "dream-valid-to-expired",
        session_id: "s-valid-to-expired",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-valid-to-expired", session_id: "s-valid-to-expired", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const row = core.getRawDb()
        .query(`SELECT COUNT(*) AS count FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite does not invalidate plans for future-effective completions", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("future-effective completion evidence should not be sent to tense rewrite");
    };

    const core = new HarnessMemCore(createConfig("tense-future-completion"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-future-completion",
        session_id: "s-future-completion",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-future-completion",
        session_id: "s-future-completion",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        valid_from: "2030-06-12T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-future-completion", session_id: "s-future-completion", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);

      const source = core.getRawDb()
        .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE content_redacted LIKE '%will submit%' LIMIT 1`)
        .get() as { valid_to: string | null; invalidated_at: string | null };
      expect(source.valid_to).toBeNull();
      expect(source.invalidated_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite is idempotent for already rewritten sources", async () => {
    let calls = 0;
    globalThis.fetch = async (url: string | URL | Request): Promise<Response> => {
      if (isOllamaTagsRequest(url)) return ollamaTagsResponse();
      calls += 1;
      const rewritten = calls === 1
        ? "GearChange API spec was submitted."
        : "GearChange API spec was submitted again with different wording.";
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              changed: true,
              false_positive: false,
              rewritten,
              completed_at: "2026-06-09T10:00:00.000Z",
              reason: "Evidence says submitted.",
            }),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const core = new HarnessMemCore(createConfig("tense-idempotent"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-idempotent",
        session_id: "s-idempotent",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-idempotent",
        session_id: "s-idempotent",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const first = await core.runConsolidation({ project: "dream-idempotent", session_id: "s-idempotent", reason: "dreaming" });
      expect(first.ok).toBe(true);
      expect((first.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const second = await core.runConsolidation({ project: "dream-idempotent", session_id: "s-idempotent", reason: "dreaming" });
      expect(second.ok).toBe(true);
      expect((second.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
      expect(calls).toBe(1);

      const row = core.getRawDb()
        .query(`SELECT COUNT(*) AS count FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { count: number };
      expect(row.count).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite does not reprocess dreaming-generated rows", async () => {
    let calls = 0;
    globalThis.fetch = async (url: string | URL | Request): Promise<Response> => {
      if (isOllamaTagsRequest(url)) return ollamaTagsResponse();
      calls += 1;
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              changed: true,
              false_positive: false,
              rewritten: "GearChange API spec was submitted.",
              completed_at: "2026-06-09T10:00:00.000Z",
              reason: "Evidence says submitted.",
            }),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const core = new HarnessMemCore(createConfig("tense-no-dreaming-reprocess"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-no-reprocess",
        session_id: "s-no-reprocess",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "Next action: submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-no-reprocess",
        session_id: "s-no-reprocess",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const first = await core.runConsolidation({ project: "dream-no-reprocess", session_id: "s-no-reprocess", reason: "dreaming" });
      expect(first.ok).toBe(true);
      expect((first.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      core.recordEvent({
        platform: "claude",
        project: "dream-no-reprocess",
        session_id: "s-no-reprocess",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "Completed unrelated follow-up. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const second = await core.runConsolidation({ project: "dream-no-reprocess", session_id: "s-no-reprocess", reason: "dreaming" });
      expect(second.ok).toBe(true);
      expect((second.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
      expect(calls).toBe(1);

      const row = core.getRawDb()
        .query(`SELECT COUNT(*) AS count FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { count: number };
      expect(row.count).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite clamps out-of-range LLM completion timestamps to evidence time", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted.",
      completed_at: "2026-06-01T10:00:00.000Z",
      reason: "Model copied an old example timestamp.",
    });

    const core = new HarnessMemCore(createConfig("tense-clamp"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-clamp",
        session_id: "s-clamp",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-clamp",
        session_id: "s-clamp",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const beforeRunMs = Date.now();
      const stats = await core.runConsolidation({ project: "dream-clamp", session_id: "s-clamp", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const rewritten = core.getRawDb()
        .query(`SELECT supersedes, event_time, valid_from, created_at FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { supersedes: string; event_time: string; valid_from: string; created_at: string };
      expect(rewritten.event_time).toBe("2026-06-09T10:00:00.000Z");
      expect(rewritten.valid_from).toBe("2026-06-09T10:00:00.000Z");
      expect(Date.parse(rewritten.created_at)).toBeGreaterThanOrEqual(beforeRunMs);

      const oldRow = core.getRawDb()
        .query(`SELECT valid_to FROM mem_observations WHERE id = ?`)
        .get(rewritten.supersedes) as { valid_to: string | null };
      expect(oldRow.valid_to).toBe("2026-06-09T10:00:00.000Z");
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite keeps its local model default independent from fact LLM model", async () => {
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "gpt-5";
    mockOllamaRewrite(
      {
        changed: true,
        false_positive: false,
        rewritten: "GearChange API spec was submitted.",
        completed_at: "2026-06-09T10:00:00.000Z",
        reason: "Evidence says submitted.",
      },
      (body) => {
        expect(body).toContain('"model":"qwen3.5:9b"');
        expect(body).not.toContain("gpt-5");
      },
    );

    const core = new HarnessMemCore(createConfig("tense-model-default"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-model-default",
        session_id: "s-model-default",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-model-default",
        session_id: "s-model-default",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-model-default", session_id: "s-model-default", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite filters unrelated evidence before using the related completion", async () => {
    let calls = 0;
    globalThis.fetch = async (url: string | URL | Request): Promise<Response> => {
      if (isOllamaTagsRequest(url)) return ollamaTagsResponse();
      calls += 1;
      const response = {
          changed: true,
          false_positive: false,
          rewritten: "GearChange API spec was submitted.",
          completed_at: "2026-06-09T10:00:00.000Z",
          reason: "Matching evidence says submitted.",
        };
      return new Response(
        JSON.stringify({ message: { content: JSON.stringify(response) } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const core = new HarnessMemCore(createConfig("tense-later-evidence"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-later-evidence",
        session_id: "s-later-evidence",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-later-evidence",
        session_id: "s-later-evidence",
        event_type: "checkpoint",
        ts: "2026-06-08T11:00:00.000Z",
        payload: { prompt: "Completed the Billing dashboard cleanup. 完了した。" },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-later-evidence",
        session_id: "s-later-evidence",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-later-evidence", session_id: "s-later-evidence", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);
      expect(calls).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite caps local LLM attempts per job", async () => {
    let calls = 0;
    globalThis.fetch = async (url: string | URL | Request): Promise<Response> => {
      if (isOllamaTagsRequest(url)) return ollamaTagsResponse();
      calls += 1;
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              changed: false,
              false_positive: false,
              rewritten: "",
              reason: "Rejected candidate.",
            }),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const core = new HarnessMemCore(createConfig("tense-attempt-cap"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-attempt-cap",
        session_id: "s-attempt-cap",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      for (let i = 0; i < 30; i += 1) {
        core.recordEvent({
          platform: "claude",
          project: "dream-attempt-cap",
          session_id: "s-attempt-cap",
          event_type: "checkpoint",
          ts: `2026-06-08T11:${String(i).padStart(2, "0")}:00.000Z`,
          payload: { prompt: `Completed GearChange API spec candidate . 完了した。` },
          tags: [],
          privacy_tags: [],
        });
      }

      const stats = await core.runConsolidation({ project: "dream-attempt-cap", session_id: "s-attempt-cap", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
      expect(calls).toBeGreaterThanOrEqual(1);
      expect(calls).toBeLessThanOrEqual(24);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite scopes dedupe per source observation", async () => {
    let calls = 0;
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "The API spec was completed.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Evidence says completed.",
    }, () => {
      calls += 1;
    });

    const core = new HarnessMemCore(createConfig("tense-dedupe"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-dedupe",
        session_id: "s-dedupe",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-dedupe",
        session_id: "s-dedupe",
        event_type: "checkpoint",
        ts: "2026-06-08T10:01:00.000Z",
        payload: { prompt: "We will submit the Billing API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-dedupe",
        session_id: "s-dedupe",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "GearChange API spec completed. 完了した。" },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-dedupe",
        session_id: "s-dedupe",
        event_type: "checkpoint",
        ts: "2026-06-09T10:01:00.000Z",
        payload: { prompt: "Billing API spec completed. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-dedupe", session_id: "s-dedupe", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(2);
      expect(calls).toBe(2);

      const row = core.getRawDb()
        .query(`
          SELECT COUNT(*) AS count, COUNT(DISTINCT content_dedupe_hash) AS distinct_hashes
          FROM mem_observations
          WHERE platform = 'dreaming'
        `)
        .get() as { count: number; distinct_hashes: number };
      expect(row.count).toBe(2);
      expect(row.distinct_hashes).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite does not infer completion without evidence", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error("tense rewrite should not call LLM without completion evidence");
    };
    const core = new HarnessMemCore(createConfig("tense-negative"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-negative",
        session_id: "s-negative",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-negative", session_id: "s-negative", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(0);
      const row = core.getRawDb()
        .query(`SELECT COUNT(*) AS count FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite redacts secrets before prompt and storage", async () => {
    const secret = "sk-abcdefghij0123456789ABCDEFGH";
    mockOllamaRewrite(
      {
        changed: true,
        false_positive: false,
        rewritten: `Deployment key ${secret} was rotated after the release completed.`,
        completed_at: "2026-06-09T10:00:00.000Z",
        reason: "Evidence says completed.",
      },
      (body) => {
        expect(body).not.toContain(secret);
        expect(body).toContain("[REDACTED_");
      },
    );

    const core = new HarnessMemCore(createConfig("tense-redaction"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-redact",
        session_id: "s-redact",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: `We will rotate deployment key ${secret} on Friday.` },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-redact",
        session_id: "s-redact",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Deployment key rotation completed. 完了した。" },
        tags: [],
        privacy_tags: [],
      });

      const stats = await core.runConsolidation({ project: "dream-redact", session_id: "s-redact", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);
      const rewritten = core.getRawDb()
        .query(`SELECT content_redacted FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { content_redacted: string };
      expect(rewritten.content_redacted).not.toContain(secret);
      expect(rewritten.content_redacted).toContain("[REDACTED_");
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite propagates privacy tags from completion evidence", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Evidence says submitted.",
    });

    const core = new HarnessMemCore(createConfig("tense-evidence-privacy"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-evidence-privacy",
        session_id: "s-evidence-privacy",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-evidence-privacy",
        session_id: "s-evidence-privacy",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: ["private"],
      });

      const stats = await core.runConsolidation({ project: "dream-evidence-privacy", session_id: "s-evidence-privacy", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const row = core.getRawDb()
        .query(`SELECT privacy_tags_json FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { privacy_tags_json: string };
      expect(JSON.parse(row.privacy_tags_json)).toContain("private");
    } finally {
      core.shutdown("test");
    }
  });

  test("dreaming tense rewrite fail-closes malformed privacy tag metadata", async () => {
    mockOllamaRewrite({
      changed: true,
      false_positive: false,
      rewritten: "GearChange API spec was submitted.",
      completed_at: "2026-06-09T10:00:00.000Z",
      reason: "Evidence says submitted.",
    });

    const core = new HarnessMemCore(createConfig("tense-malformed-privacy"));
    try {
      core.recordEvent({
        platform: "claude",
        project: "dream-malformed-privacy",
        session_id: "s-malformed-privacy",
        event_type: "checkpoint",
        ts: "2026-06-08T10:00:00.000Z",
        payload: { prompt: "We will submit the GearChange API spec on Friday." },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "claude",
        project: "dream-malformed-privacy",
        session_id: "s-malformed-privacy",
        event_type: "checkpoint",
        ts: "2026-06-09T10:00:00.000Z",
        payload: { prompt: "Submitted the GearChange API spec. 完了した。" },
        tags: [],
        privacy_tags: [],
      });
      core.getRawDb()
        .query(`
          UPDATE mem_observations
          SET privacy_tags_json = '[{"tag":"private"}]'
          WHERE project = 'dream-malformed-privacy'
            AND content_redacted LIKE '%will submit%'
        `)
        .run();

      const stats = await core.runConsolidation({ project: "dream-malformed-privacy", session_id: "s-malformed-privacy", reason: "dreaming" });
      expect(stats.ok).toBe(true);
      expect((stats.items[0] as { dreaming_rewrites_created?: number }).dreaming_rewrites_created).toBe(1);

      const row = core.getRawDb()
        .query(`SELECT privacy_tags_json FROM mem_observations WHERE platform = 'dreaming'`)
        .get() as { privacy_tags_json: string };
      expect(JSON.parse(row.privacy_tags_json)).toContain("private");
    } finally {
      core.shutdown("test");
    }
  });
});
