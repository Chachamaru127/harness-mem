import { describe, expect, test } from "bun:test";
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
        const final = Number(scores.final ?? 0);
        const recomputed = 0.35 * lexical + 0.30 * vector + 0.10 * recency + 0.15 * tagBoost + 0.10 * importance;
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

  test("search latency p95 stays below 500ms on medium synthetic corpus", () => {
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
  });
});
