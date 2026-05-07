import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runConsolidationOnce } from "../../src/consolidation/worker";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-s108-007-${name}-`));
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
    backgroundWorkersEnabled: false,
  };
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "codex",
    project: "s108-temporal-project",
    session_id: "s108-temporal-session",
    event_type: "user_prompt",
    ts: "2026-05-07T02:00:00.000Z",
    payload: { prompt: "Decision: use worker.ts and deploy.sh for temporal persistence." },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

function obsId(result: ReturnType<HarnessMemCore["recordEvent"]>): string {
  expect(result.ok).toBe(true);
  const item = result.items[0] as { id?: string } | undefined;
  expect(typeof item?.id).toBe("string");
  return item!.id!;
}

describe("S108-007 temporal anchor persistence", () => {
  test("recordEvent persists explicit anchors and keeps unknown event_time explicit", () => {
    const core = new HarnessMemCore(createConfig("observation"));
    try {
      const explicitId = obsId(core.recordEvent(baseEvent({
        event_id: "explicit-anchor",
        event_time: "2026-05-01T10:00:00-05:00",
        observed_at: "2026-05-02T09:30:00.000Z",
        valid_from: "2026-05-01T00:00:00.000Z",
        valid_to: "2026-05-05T00:00:00.000Z",
        supersedes: "obs-old-anchor",
        invalidated_at: "2026-05-06T00:00:00.000Z",
      })));
      const unknownId = obsId(core.recordEvent(baseEvent({
        event_id: "unknown-anchor",
        ts: "2026-05-07T03:00:00.000Z",
        payload: { prompt: "Decision: unknown event time must not become current by default." },
      })));

      const db = core.getRawDb();
      const explicit = db
        .query(`
          SELECT event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at
          FROM mem_observations WHERE id = ?
        `)
        .get(explicitId) as Record<string, string | null>;
      const unknown = db
        .query(`SELECT event_time, observed_at FROM mem_observations WHERE id = ?`)
        .get(unknownId) as { event_time: string | null; observed_at: string | null };

      expect(explicit.event_time).toBe("2026-05-01T15:00:00.000Z");
      expect(explicit.observed_at).toBe("2026-05-02T09:30:00.000Z");
      expect(explicit.valid_from).toBe("2026-05-01T00:00:00.000Z");
      expect(explicit.valid_to).toBe("2026-05-05T00:00:00.000Z");
      expect(explicit.supersedes).toBe("obs-old-anchor");
      expect(explicit.invalidated_at).toBe("2026-05-06T00:00:00.000Z");
      expect(unknown.event_time).toBeNull();
      expect(unknown.observed_at).toBe("2026-05-07T03:00:00.000Z");

      const relation = db
        .query(`
          SELECT event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at
          FROM mem_relations WHERE observation_id = ? LIMIT 1
        `)
        .get(explicitId) as Record<string, string | null> | null;
      expect(relation).not.toBeNull();
      expect(relation?.event_time).toBe("2026-05-01T15:00:00.000Z");
      expect(relation?.observed_at).toBe("2026-05-02T09:30:00.000Z");
      expect(relation?.supersedes).toBe("obs-old-anchor");
    } finally {
      core.close?.();
    }
  });

  test("createLink persists relation anchors without changing supersedes read behavior", () => {
    const core = new HarnessMemCore(createConfig("link"));
    try {
      const oldId = obsId(core.recordEvent(baseEvent({
        event_id: "old-link",
        ts: "2026-05-01T00:00:00.000Z",
        payload: { prompt: "Decision: old temporal relation target." },
      })));
      const newId = obsId(core.recordEvent(baseEvent({
        event_id: "new-link",
        ts: "2026-05-02T00:00:00.000Z",
        payload: { prompt: "Decision: new temporal relation target." },
      })));

      const linkResult = core.createLink({
        from_observation_id: newId,
        to_observation_id: oldId,
        relation: "supersedes",
        event_time: "2026-05-02T00:00:00.000Z",
        observed_at: "2026-05-02T01:00:00.000Z",
        valid_from: "2026-05-02T00:00:00.000Z",
        valid_to: null,
        invalidated_at: null,
      });
      expect(linkResult.ok).toBe(true);

      const link = core.getRawDb()
        .query(`
          SELECT relation, event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at
          FROM mem_links WHERE from_observation_id = ? AND to_observation_id = ?
        `)
        .get(newId, oldId) as Record<string, string | null>;

      expect(link.relation).toBe("supersedes");
      expect(link.event_time).toBe("2026-05-02T00:00:00.000Z");
      expect(link.observed_at).toBe("2026-05-02T01:00:00.000Z");
      expect(link.valid_from).toBe("2026-05-02T00:00:00.000Z");
      expect(link.valid_to).toBeNull();
      expect(link.supersedes).toBe(oldId);
      expect(link.invalidated_at).toBeNull();

      const search = core.search({
        query: "temporal persistence",
        project: "s108-temporal-project",
        include_superseded: false,
        limit: 10,
      });
      expect(search.ok).toBe(true);
      const ids = (search.items as Array<{ id?: string }>).map((item) => item.id);
      expect(ids).not.toContain(oldId);
    } finally {
      core.close?.();
    }
  });

  test("consolidation propagates observation temporal anchors to facts", async () => {
    const core = new HarnessMemCore(createConfig("fact"));
    try {
      obsId(core.recordEvent(baseEvent({
        event_id: "fact-anchor",
        event_time: "2026-04-30T12:00:00.000Z",
        observed_at: "2026-05-01T12:00:00.000Z",
        valid_from: "2026-04-30T00:00:00.000Z",
        payload: { prompt: "Decision: S108 fact anchors should follow the source observation." },
      })));

      const stats = await runConsolidationOnce(core.getRawDb(), {
        project: "s108-temporal-project",
        session_id: "s108-temporal-session",
      });
      expect(stats.facts_extracted).toBeGreaterThan(0);

      const fact = core.getRawDb()
        .query(`
          SELECT event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at
          FROM mem_facts
          WHERE project = 's108-temporal-project'
          LIMIT 1
        `)
        .get() as Record<string, string | null>;

      expect(fact.event_time).toBe("2026-04-30T12:00:00.000Z");
      expect(fact.observed_at).toBe("2026-05-01T12:00:00.000Z");
      expect(fact.valid_from).toBe("2026-04-30T00:00:00.000Z");
      expect(fact.valid_to).toBeNull();
      expect(fact.supersedes).toBeNull();
      expect(fact.invalidated_at).toBeNull();
    } finally {
      core.close?.();
    }
  });

  test("expires_at, privacy, and strict project reads stay intact", () => {
    const core = new HarnessMemCore(createConfig("read-path"));
    try {
      core.recordEvent(baseEvent({
        event_id: "visible-alpha",
        project: "project-alpha",
        payload: { prompt: "visible alpha temporal contract marker" },
      }));
      core.recordEvent(baseEvent({
        event_id: "private-alpha",
        project: "project-alpha",
        payload: { prompt: "private alpha temporal contract marker" },
        privacy_tags: ["private"],
      }));
      core.recordEvent(baseEvent({
        event_id: "expired-alpha",
        project: "project-alpha",
        payload: { prompt: "expired alpha temporal contract marker" },
        expires_at: "2026-01-01T00:00:00.000Z",
      }));
      core.recordEvent(baseEvent({
        event_id: "visible-beta",
        project: "project-beta",
        payload: { prompt: "visible alpha temporal contract marker from beta" },
      }));

      const result = core.search({
        query: "temporal contract marker",
        project: "project-alpha",
        strict_project: true,
        include_private: false,
        include_expired: false,
        limit: 10,
      });
      expect(result.ok).toBe(true);
      const items = result.items as Array<{ project?: string; content?: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.project === "project-alpha")).toBe(true);
      expect(items.some((item) => String(item.content ?? "").includes("private alpha"))).toBe(false);
      expect(items.some((item) => String(item.content ?? "").includes("expired alpha"))).toBe(false);
    } finally {
      core.close?.();
    }
  });
});
