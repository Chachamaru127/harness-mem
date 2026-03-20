/**
 * S58-001: search result reason field tests
 * Verifies that generateSearchReason returns a non-empty string for each
 * dominant scoring dimension: lexical, vector, recency, tag_boost, importance, graph.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateSearchReason, type SearchCandidate } from "../../src/core/core-utils";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

// ---------------------------------------------------------------------------
// Unit tests for generateSearchReason
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    id: "test-id",
    lexical: 0,
    vector: 0,
    recency: 0,
    tag_boost: 0,
    importance: 0,
    graph: 0,
    final: 0,
    rerank: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("generateSearchReason unit", () => {
  test("lexical dominant → reason is non-empty and mentions keywords", () => {
    const candidate = makeCandidate({ lexical: 0.9, vector: 0.1, recency: 0.1 });
    const reason = generateSearchReason(candidate);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
    // lexical dominant should mention keywords
    expect(reason.toLowerCase()).toMatch(/keyword|title|content/);
  });

  test("vector dominant → reason mentions semantic similarity", () => {
    const candidate = makeCandidate({ lexical: 0.05, vector: 0.95, recency: 0.1 });
    const reason = generateSearchReason(candidate);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
    expect(reason.toLowerCase()).toMatch(/semantic|similar/);
  });

  test("recency dominant → reason mentions recent", () => {
    const candidate = makeCandidate({ lexical: 0.0, vector: 0.0, recency: 0.99 });
    const reason = generateSearchReason(candidate);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
    expect(reason.toLowerCase()).toMatch(/recent/);
  });

  test("tag_boost dominant → reason mentions tag", () => {
    // tag_boost weight=0.10, so contribution = 0.10 * 1.0 = 0.10
    // other dims must be lower contribution
    const candidate = makeCandidate({ lexical: 0.0, vector: 0.0, recency: 0.0, tag_boost: 1.0, importance: 0.0, graph: 0.0 });
    const reason = generateSearchReason(candidate);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
    expect(reason.toLowerCase()).toMatch(/tag/);
  });

  test("graph dominant → reason mentions related/graph expansion", () => {
    // graph weight=0.07, need graph contribution > others
    const candidate = makeCandidate({ lexical: 0.0, vector: 0.0, recency: 0.0, tag_boost: 0.0, importance: 0.0, graph: 1.0 });
    const reason = generateSearchReason(candidate);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
    expect(reason.toLowerCase()).toMatch(/related|expand/);
  });

  test("all-zero scores → fallback reason is non-empty", () => {
    const candidate = makeCandidate();
    const reason = generateSearchReason(candidate);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Integration test: search API response includes reason on each item
// ---------------------------------------------------------------------------

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-reason-${name}-`));
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
  return { core: new HarnessMemCore(config), dir };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "codex",
    project: "reason-test",
    session_id: "session-reason",
    event_type: "user_prompt",
    ts: "2026-03-01T00:00:00.000Z",
    payload: { content: "default content" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("search reason integration", () => {
  test("each search result item has a non-empty reason string", () => {
    const { core, dir } = createCore("all-items");
    try {
      // Insert several events with different content
      core.recordEvent(makeEvent({
        event_id: "reason-1",
        payload: { content: "machine learning model training gradient descent optimization" },
        tags: ["ml"],
      }));
      core.recordEvent(makeEvent({
        event_id: "reason-2",
        ts: "2026-03-15T00:00:00.000Z",
        payload: { content: "recent deployment to production environment" },
        tags: ["deploy"],
      }));
      core.recordEvent(makeEvent({
        event_id: "reason-3",
        payload: { content: "database schema migration and indexing strategy" },
        tags: ["database"],
      }));

      const result = core.search({
        query: "machine learning model",
        project: "reason-test",
        limit: 10,
        include_private: true,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        expect(typeof item.reason).toBe("string");
        expect((item.reason as string).length).toBeGreaterThan(0);
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
