import { describe, expect, test } from "bun:test";
import { buildFtsQuery, buildSearchTokens, expandSearchQuery } from "../../src/core/core-utils";

describe("search query expansion", () => {
  test("expands internal alias query to canonical benchmark terms", () => {
    const expanded = expandSearchQuery("まさおベンチ");
    expect(expanded).toContain("locomo benchmark");
    expect(expanded).toContain("Backboard-Locomo-Benchmark");
  });

  test("buildSearchTokens includes canonical terms for alias queries", () => {
    const tokens = buildSearchTokens("まさおベンチ");
    expect(tokens).toContain("locomo");
    expect(tokens).toContain("benchmark");
  });

  test("buildFtsQuery augments metric-focused natural language queries", () => {
    const fts = buildFtsQuery("日本語 release gate の overall F1 はいくつ");
    expect(fts).toContain("ja");
    expect(fts).toContain("release");
    expect(fts).toContain("overall");
    expect(fts).toContain("f1");
  });
});
