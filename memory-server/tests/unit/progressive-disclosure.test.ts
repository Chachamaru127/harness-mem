/**
 * §78-E03: Progressive disclosure unit tests
 *
 * Tests the search detail_level transformation:
 *   "index"   → { id, title, score } only
 *   "context" → { id, title, snippet≤120, score, meta } (default)
 *   "full"    → { id, title, content, raw_text, score, scores, meta }
 *
 * Also verifies meta.token_estimate increases: index < context < full.
 */

import { describe, expect, test } from "bun:test";
import {
  applyDetailLevel,
  transformSearchItem,
  estimateTokens,
  type SearchDetailLevel,
} from "../../../mcp-server/src/search-detail-level";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LONG_CONTENT = "A".repeat(300); // > 120 chars — forces snippet truncation

function makeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "obs-001",
    title: "TypeScript is the primary language",
    content: LONG_CONTENT,
    raw_text: "raw content here",
    score: 0.87,
    scores: { lexical: 0.4, vector: 0.3, recency: 0.1, final: 0.87 },
    session_id: "sess-001",
    project: "test-proj",
    platform: "claude",
    created_at: "2026-01-01T00:00:00Z",
    tags: ["tech-stack"],
    ...overrides,
  };
}

function makeItems(count = 3): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => makeItem({ id: `obs-${i + 1}` }));
}

const BASE_META: Record<string, unknown> = {
  count: 3,
  latency_ms: 12,
  filters: {},
  ranking: "hybrid_v3",
};

// ---------------------------------------------------------------------------
// transformSearchItem
// ---------------------------------------------------------------------------

describe("transformSearchItem", () => {
  test("index: only id + title + score, no content or snippet", () => {
    const item = makeItem();
    const result = transformSearchItem(item, "index");

    expect(result.id).toBe("obs-001");
    expect(result.title).toBe("TypeScript is the primary language");
    expect(typeof result.score).toBe("number");
    expect("content" in result).toBe(false);
    expect("snippet" in result).toBe(false);
    expect("meta" in result).toBe(false);
    expect("scores" in result).toBe(false);
  });

  test("context: has snippet ≤ 120 chars, no full content", () => {
    const item = makeItem();
    const result = transformSearchItem(item, "context");

    expect("snippet" in result).toBe(true);
    expect(typeof result.snippet).toBe("string");
    expect((result.snippet as string).length).toBeLessThanOrEqual(120);
    expect("content" in result).toBe(false);
    expect("meta" in result).toBe(true);
  });

  test("context: snippet is exactly 120 chars when content > 120", () => {
    const item = makeItem({ content: "X".repeat(200) });
    const result = transformSearchItem(item, "context");
    expect((result.snippet as string).length).toBe(120);
  });

  test("context: snippet is full content when content ≤ 120 chars", () => {
    const shortContent = "Short content";
    const item = makeItem({ content: shortContent });
    const result = transformSearchItem(item, "context");
    expect(result.snippet).toBe(shortContent);
  });

  test("full: has complete content, raw_text, scores breakdown", () => {
    const item = makeItem();
    const result = transformSearchItem(item, "full");

    expect(result.content).toBe(LONG_CONTENT);
    expect(result.raw_text).toBe("raw content here");
    expect(result.scores).toEqual(item.scores);
    expect("snippet" in result).toBe(false);
    expect("meta" in result).toBe(true);
  });

  test("full: raw_text is null when absent in source", () => {
    const item = makeItem({ raw_text: undefined });
    const result = transformSearchItem(item, "full");
    expect(result.raw_text).toBeNull();
  });

  test("score fallback: extracts from scores.final when top-level score absent", () => {
    const item = makeItem({ score: undefined, scores: { final: 0.75 } });
    const result = transformSearchItem(item, "index");
    expect(result.score).toBe(0.75);
  });

  test("score fallback: returns 0 when neither score nor scores.final present", () => {
    const item = makeItem({ score: undefined, scores: {} });
    const result = transformSearchItem(item, "index");
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyDetailLevel
// ---------------------------------------------------------------------------

describe("applyDetailLevel", () => {
  test("default (no detail_level) behaves like context", () => {
    const items = makeItems(2);
    const { items: out, meta } = applyDetailLevel(items, { ...BASE_META });

    expect(out).toHaveLength(2);
    expect("snippet" in out[0]).toBe(true);
    expect("content" in out[0]).toBe(false);
    expect(meta.detail_level).toBe("context");
  });

  test("index: items have no content or snippet", () => {
    const items = makeItems(3);
    const { items: out } = applyDetailLevel(items, { ...BASE_META }, "index");

    for (const item of out) {
      expect("content" in item).toBe(false);
      expect("snippet" in item).toBe(false);
      expect("id" in item).toBe(true);
      expect("score" in item).toBe(true);
    }
  });

  test("context: items have snippet ≤ 120 chars", () => {
    const items = makeItems(3);
    const { items: out } = applyDetailLevel(items, { ...BASE_META }, "context");

    for (const item of out) {
      expect("snippet" in item).toBe(true);
      expect((item.snippet as string).length).toBeLessThanOrEqual(120);
      expect("content" in item).toBe(false);
    }
  });

  test("full: items have complete content", () => {
    const items = makeItems(3);
    const { items: out } = applyDetailLevel(items, { ...BASE_META }, "full");

    for (const item of out) {
      expect(item.content).toBe(LONG_CONTENT);
      expect("snippet" in item).toBe(false);
    }
  });

  test("meta.token_estimate is a positive number", () => {
    const items = makeItems(3);
    const { meta } = applyDetailLevel(items, { ...BASE_META }, "context");
    expect(typeof meta.token_estimate).toBe("number");
    expect((meta.token_estimate as number)).toBeGreaterThan(0);
  });

  test("meta.token_estimate increases: index < context < full", () => {
    const items = makeItems(3);
    const { meta: metaIndex } = applyDetailLevel(items, { ...BASE_META }, "index");
    const { meta: metaContext } = applyDetailLevel(items, { ...BASE_META }, "context");
    const { meta: metaFull } = applyDetailLevel(items, { ...BASE_META }, "full");

    const tIndex = metaIndex.token_estimate as number;
    const tContext = metaContext.token_estimate as number;
    const tFull = metaFull.token_estimate as number;

    expect(tIndex).toBeLessThan(tContext);
    expect(tContext).toBeLessThan(tFull);
  });

  test("meta.detail_level is set to the requested level", () => {
    const items = makeItems(1);
    expect(applyDetailLevel(items, { ...BASE_META }, "index").meta.detail_level).toBe("index");
    expect(applyDetailLevel(items, { ...BASE_META }, "context").meta.detail_level).toBe("context");
    expect(applyDetailLevel(items, { ...BASE_META }, "full").meta.detail_level).toBe("full");
  });

  test("original meta fields are preserved in output meta", () => {
    const items = makeItems(1);
    const { meta } = applyDetailLevel(items, { ...BASE_META }, "context");
    expect(meta.count).toBe(3);
    expect(meta.ranking).toBe("hybrid_v3");
    expect(meta.latency_ms).toBe(12);
  });

  test("empty items array → token_estimate > 0 (at least '[]')", () => {
    const { meta } = applyDetailLevel([], { ...BASE_META }, "index");
    expect((meta.token_estimate as number)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  test("returns positive value for non-empty array", () => {
    expect(estimateTokens([{ id: "x", title: "y", score: 1 }])).toBeGreaterThan(0);
  });

  test("larger payload → larger estimate", () => {
    const small = [{ id: "x" }];
    const large = [{ id: "x", content: "A".repeat(1000) }];
    expect(estimateTokens(large)).toBeGreaterThan(estimateTokens(small));
  });
});
