import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type ApiResponse, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-search-${name}-`));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
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
  return { core: new HarnessMemCore(config), dir };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "codex",
    project: "search-quality",
    session_id: "sq-session-1",
    event_type: "user_prompt",
    ts: "2026-02-14T00:00:00.000Z",
    payload: { content: "default event content" },
    tags: ["quality"],
    privacy_tags: [],
    ...overrides,
  };
}

function asItems(response: ApiResponse): Array<Record<string, unknown>> {
  return response.items as Array<Record<string, unknown>>;
}

describe("search quality integration", () => {
  test("hybrid scoring formula remains consistent and recency affects rank", () => {
    const { core, dir } = createCore("scoring");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "sq-old",
          ts: "2025-01-01T00:00:00.000Z",
          payload: { content: "release checklist automation baseline" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "sq-new",
          ts: "2026-02-14T00:00:00.000Z",
          payload: { content: "release checklist automation baseline" },
        })
      );

      const result = core.search({
        query: "release checklist automation baseline",
        project: "search-quality",
        limit: 5,
        include_private: true,
      });

      expect(result.ok).toBe(true);
      const items = asItems(result);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(String(items[0].id)).toContain("sq-new");

      for (const item of items) {
        const scores = (item.scores || {}) as Record<string, unknown>;
        const lexical = Number(scores.lexical ?? 0);
        const vector = Number(scores.vector ?? 0);
        const recency = Number(scores.recency ?? 0);
        const tagBoost = Number(scores.tag_boost ?? 0);
        const importance = Number(scores.importance ?? 0);
        const graph = Number(scores.graph ?? 0);
        const final = Number(scores.final ?? 0);
        const recomputed = 0.32 * lexical + 0.28 * vector + 0.10 * recency + 0.12 * tagBoost + 0.08 * importance + 0.10 * graph;
        expect(Math.abs(final - recomputed)).toBeLessThan(0.00001);
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("private observations stay hidden by default and appear when requested", () => {
    const { core, dir } = createCore("privacy");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "sq-public",
          payload: { content: "deployment note public visibility" },
          privacy_tags: [],
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "sq-private",
          payload: { content: "deployment note private visibility" },
          privacy_tags: ["private"],
        })
      );

      const hidden = core.search({
        query: "deployment note visibility",
        project: "search-quality",
        limit: 10,
        include_private: false,
        strict_project: true,
      });
      expect(hidden.ok).toBe(true);

      for (const item of asItems(hidden)) {
        const privacyTags = (item.privacy_tags || []) as string[];
        expect(privacyTags.includes("private")).toBe(false);
      }

      const visible = core.search({
        query: "deployment note visibility",
        project: "search-quality",
        limit: 10,
        include_private: true,
        strict_project: true,
      });
      expect(visible.ok).toBe(true);
      const privateHits = asItems(visible).filter((item) =>
        ((item.privacy_tags || []) as string[]).includes("private")
      );
      expect(privateHits.length).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(
    "search latency p95 stays below 500ms on medium synthetic corpus",
    () => {
      const { core, dir } = createCore("latency");
      try {
        const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
        const total = 1500;
        for (let i = 0; i < total; i += 1) {
          const ts = new Date(baseTs + i * 60_000).toISOString();
          core.recordEvent(
            makeEvent({
              event_id: `sq-bulk-${i}`,
              session_id: `sq-session-${i % 5}`,
              ts,
              payload: {
                content: `feature-${i % 40} migration note ${i} search quality benchmark`,
              },
              tags: ["quality", `feature-${i % 40}`],
            })
          );
        }

        const latencies: number[] = [];
        for (let i = 0; i < 40; i += 1) {
          const query = `feature-${i % 40} migration note`;
          const response = core.search({
            query,
            project: "search-quality",
            limit: 20,
            include_private: false,
          });
          expect(response.ok).toBe(true);
          expect(response.items.length).toBeGreaterThan(0);
          latencies.push(Number(response.meta.latency_ms));
        }

        const sorted = [...latencies].sort((a, b) => a - b);
        const idx = Math.floor((sorted.length - 1) * 0.95);
        const p95 = sorted[idx];
        expect(p95).toBeLessThan(500);
      } finally {
        core.shutdown("test");
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120000
  );

  const heavyTest = process.env.HARNESS_MEM_RUN_HEAVY_SEARCH_BENCH === "1" ? test : test.skip;
  heavyTest("search latency p95 stays below 650ms on 30k corpus with link expansion", () => {
    const { core, dir } = createCore("latency-heavy");
    try {
      const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
      const total = 30000;
      for (let i = 0; i < total; i += 1) {
        const ts = new Date(baseTs + i * 1_000).toISOString();
        core.recordEvent(
          makeEvent({
            event_id: `sq-heavy-${i}`,
            session_id: `sq-heavy-session-${i % 30}`,
            project: `heavy-project-${i % 5}`,
            ts,
            payload: {
              content: `heavy feature-${i % 300} migration note ${i} search quality benchmark`,
            },
            tags: ["quality", `feature-${i % 300}`],
          })
        );
      }

      const latencies: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        const query = `feature-${i % 300} migration note`;
        const response = core.search({
          query,
          project: `heavy-project-${i % 5}`,
          limit: 20,
          include_private: false,
          expand_links: true,
          strict_project: true,
        });
        expect(response.ok).toBe(true);
        expect(response.items.length).toBeGreaterThan(0);
        latencies.push(Number(response.meta.latency_ms));
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      const idx = Math.floor((sorted.length - 1) * 0.95);
      const p95 = sorted[idx];
      expect(p95).toBeLessThan(650);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("strict_project=true keeps graph expansion inside project", () => {
    const { core, dir } = createCore("strict-project");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "strict-a1",
          project: "project-a",
          session_id: "session-a",
          payload: { content: "touch src/index.ts and update parser" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "strict-b1",
          project: "project-b",
          session_id: "session-b",
          payload: { content: "touch src/index.ts and update parser" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "strict-a2",
          project: "project-a",
          session_id: "session-a",
          event_type: "tool_use",
          payload: { content: "follow-up changes for src/index.ts in project-a" },
        })
      );

      const result = core.search({
        query: "src/index.ts parser",
        project: "project-a",
        strict_project: true,
        include_private: true,
        limit: 20,
      });
      expect(result.ok).toBe(true);
      const items = asItems(result);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.project).toBe("project-a");
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("vector search ignores mismatched model/dimension rows", () => {
    const { core, dir } = createCore("vector-model");
    const dbPath = join(dir, "harness-mem.db");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "vector-good",
          project: "search-quality",
          payload: { content: "typescript dependency migration plan" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "vector-old",
          project: "search-quality",
          payload: { content: "typescript dependency migration old strategy" },
        })
      );

      const db = new Database(dbPath);
      try {
        db.query(`
          UPDATE mem_vectors
          SET model = 'local-hash-v1', dimension = 64
          WHERE observation_id = 'obs_vector-old'
        `).run();
      } finally {
        db.close();
      }

      const result = core.search({
        query: "typescript dependency migration",
        project: "search-quality",
        strict_project: true,
        include_private: true,
        limit: 10,
        debug: true,
      });
      expect(result.ok).toBe(true);
      const debug = (result.meta.debug || {}) as Record<string, unknown>;
      const coverage = Number(debug.vector_backend_coverage ?? 0);
      expect(coverage).toBeLessThanOrEqual(1);
      const items = asItems(result);
      const oldItem = items.find((item) => item.id === "obs_vector-old");
      if (oldItem) {
        const scores = (oldItem.scores || {}) as Record<string, unknown>;
        expect(Number(scores.vector ?? 0)).toBe(0);
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("vector_coverage below threshold disables vector weight", () => {
    const { core, dir } = createCore("vector-coverage-threshold");
    const dbPath = join(dir, "harness-mem.db");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "coverage-1",
          payload: { content: "coverage threshold test one" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "coverage-2",
          payload: { content: "coverage threshold test two" },
        })
      );

      const db = new Database(dbPath);
      try {
        db.query(`UPDATE mem_vectors SET model = 'legacy-model'`).run();
      } finally {
        db.close();
      }

      const result = core.search({
        query: "coverage threshold test",
        project: "search-quality",
        include_private: true,
        strict_project: true,
        debug: true,
      });
      expect(result.ok).toBe(true);
      expect(Number(result.meta.vector_coverage)).toBeLessThan(0.2);
      const debug = (result.meta.debug || {}) as Record<string, unknown>;
      const weights = (debug.weights || {}) as Record<string, unknown>;
      expect(Number(weights.vector ?? 1)).toBe(0);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("privacy filter keeps semi-private visible and private hidden", () => {
    const { core, dir } = createCore("privacy-strict-json");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "semi-private-tag",
          payload: { content: "semi-private note should remain visible" },
          privacy_tags: ["semi-private"],
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "strict-private-tag",
          payload: { content: "private note should be hidden by default" },
          privacy_tags: ["private"],
        })
      );

      const hidden = core.search({
        query: "note should",
        project: "search-quality",
        include_private: false,
        strict_project: true,
        limit: 20,
      });
      const hiddenItems = asItems(hidden);
      const ids = hiddenItems.map((item) => String(item.id));
      expect(ids.includes("obs_semi-private-tag")).toBe(true);
      expect(ids.includes("obs_strict-private-tag")).toBe(false);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
