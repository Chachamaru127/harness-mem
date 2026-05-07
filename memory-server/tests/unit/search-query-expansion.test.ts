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

  test("buildSearchTokens normalizes code identifiers without losing their compact form", () => {
    const tokens = buildSearchTokens("cleanupFeatureFlags in src/core/cleanup-runner.ts");

    expect(tokens).toContain("cleanupfeatureflags");
    expect(tokens).toContain("cleanup");
    expect(tokens).toContain("feature");
    expect(tokens).toContain("flags");
    expect(tokens).toContain("src");
    expect(tokens).toContain("core");
    expect(tokens).toContain("runner");
    expect(tokens).toContain("cleanuprunner");
  });

  test("buildSearchTokens keeps developer workflow numbers searchable", () => {
    const tokens = buildSearchTokens("PR #214 fixed issue #7 on codex/S108-dev-workflow with --skip-quality");

    expect(tokens).toContain("pr214");
    expect(tokens).toContain("issue7");
    expect(tokens).toContain("codex");
    expect(tokens).toContain("s108");
    expect(tokens).toContain("workflow");
    expect(tokens).toContain("skipquality");
  });
});
