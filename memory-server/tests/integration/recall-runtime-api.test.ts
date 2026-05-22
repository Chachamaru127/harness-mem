import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-recall-runtime-${name}-`));
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
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function recordMemory(
  baseUrl: string,
  eventId: string,
  project: string,
  content: string,
): Promise<void> {
  const response = await postJson(baseUrl, "/v1/events/record", {
    event: {
      event_id: eventId,
      platform: "codex",
      project,
      session_id: "recall-runtime-session",
      event_type: "user_prompt",
      ts: "2026-05-22T00:00:00.000Z",
      payload: { content },
      tags: ["recall-runtime"],
      privacy_tags: [],
    },
  });
  expect(response.status).toBe(200);
}

describe("Recall Runtime API", () => {
  test("exposes degradation manifest without raw memory content", async () => {
    const runtime = createRuntime("manifest");
    try {
      const response = await fetch(`${runtime.baseUrl}/v1/admin/recall-degradation-manifest`);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        items: Array<{ reasons: Array<Record<string, unknown>>; ready_probe_policy: string }>;
        meta: Record<string, unknown>;
      };
      expect(payload.ok).toBe(true);
      expect(payload.meta.ranking).toBe("recall_degradation_manifest_v1");
      expect(payload.items[0].ready_probe_policy).toBe("no_exact_db_counts");
      expect(payload.items[0].reasons.map((reason) => reason.code)).toContain("projection_stale");
      expect(JSON.stringify(payload.items[0])).not.toContain("raw");
    } finally {
      runtime.stop();
    }
  });

  test("requires scope unless forensic recall is explicit", async () => {
    const runtime = createRuntime("scope-required");
    try {
      const response = await postJson(runtime.baseUrl, "/v1/recall", {
        query: "scope test",
      });
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { ok: boolean; meta: Record<string, unknown> };
      expect(payload.ok).toBe(false);
      expect(payload.meta.recall_scope_required).toBe(true);
      expect(payload.meta.recall_degraded_reason).toBe("scope_required");
    } finally {
      runtime.stop();
    }
  });

  test("falls back to observation search when projection is missing", async () => {
    const runtime = createRuntime("projection-missing");
    const project = "recall-runtime-missing";
    try {
      await recordMemory(runtime.baseUrl, "recall-missing-1", project, "projection missing fallback sentinel");
      const response = await postJson(runtime.baseUrl, "/v1/recall", {
        query: "fallback sentinel",
        project,
        limit: 5,
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
        meta: Record<string, unknown>;
      };
      expect(payload.ok).toBe(true);
      expect(payload.items.length).toBeGreaterThan(0);
      expect(payload.meta.recall_degraded).toBe(true);
      expect(payload.meta.recall_degraded_reason).toBe("projection_missing");
      expect(payload.meta.fallback_path).toBe("observation_search");
    } finally {
      runtime.stop();
    }
  });

  test("uses materialized projection and degrades when projection becomes stale", async () => {
    const runtime = createRuntime("projection-hit-stale");
    const project = "recall-runtime-hit";
    try {
      await recordMemory(runtime.baseUrl, "recall-hit-1", project, "projection hit alpha sentinel");
      const refreshResponse = await postJson(runtime.baseUrl, "/v1/admin/recall-projection", {
        project,
        action: "write",
      });
      expect(refreshResponse.status).toBe(200);

      const hitResponse = await postJson(runtime.baseUrl, "/v1/recall", {
        query: "alpha sentinel",
        project,
        limit: 5,
      });
      expect(hitResponse.status).toBe(200);
      const hitPayload = (await hitResponse.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
        meta: Record<string, unknown>;
      };
      expect(hitPayload.ok).toBe(true);
      expect(hitPayload.items.length).toBe(1);
      expect(hitPayload.items[0].source_ref).toMatch(/^observation:/);
      expect(hitPayload.items[0].explanation).toMatchObject({
        version: "recall_explanation_v1",
        scope: "project",
        type: "fact",
        source: { type: "observation" },
      });
      expect(hitPayload.items[0].explanation).not.toHaveProperty("project");
      expect((hitPayload.items[0].explanation as { reasons?: unknown[] }).reasons).toEqual(
        expect.arrayContaining(["scope_match", "type_match", "source_match", "lexical_match"]),
      );
      expect(JSON.stringify(hitPayload.items[0].explanation)).not.toContain("alpha sentinel");
      expect(JSON.stringify(hitPayload.items[0].explanation)).not.toContain(project);
      expect(hitPayload.meta.ranking).toBe("recall_projection_v1");
      expect(hitPayload.meta.recall_degraded).toBe(false);

      await recordMemory(runtime.baseUrl, "recall-hit-2", project, "projection stale beta sentinel");
      const staleResponse = await postJson(runtime.baseUrl, "/v1/recall", {
        query: "beta sentinel",
        project,
        limit: 5,
      });
      expect(staleResponse.status).toBe(200);
      const stalePayload = (await staleResponse.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
        meta: Record<string, unknown>;
      };
      expect(stalePayload.ok).toBe(true);
      expect(stalePayload.items.length).toBeGreaterThan(0);
      expect(stalePayload.meta.ranking).toBe("recall_degraded_fallback_v1");
      expect(stalePayload.meta.recall_degraded).toBe(true);
      expect(stalePayload.meta.recall_degraded_reason).toBe("projection_stale");
      expect(stalePayload.items[0].explanation).toMatchObject({
        version: "recall_explanation_v1",
        scope: "project",
        fallback: "projection_stale",
      });
      expect(JSON.stringify(stalePayload.items[0].explanation)).not.toContain("beta sentinel");
      expect(JSON.stringify(stalePayload.items[0].explanation)).not.toContain(project);
    } finally {
      runtime.stop();
    }
  });
});
