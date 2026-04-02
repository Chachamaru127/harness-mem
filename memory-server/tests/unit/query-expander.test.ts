import { describe, expect, test } from "bun:test";
import { expandQuery } from "../../src/embedding/query-expander";

describe("query-expander", () => {
  const hasJapanese = (value: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(value);
  const hasEnglish = (value: string) => /[A-Za-z]/.test(value);

  const japaneseCases = [
    ["本番反映の手順", ["deploy", "production"]],
    ["切り戻しの流れ", ["rollback", "flow"]],
    ["障害の原因調査", ["incident", "investigation"]],
    ["確認フローを整理", ["review", "workflow"]],
    ["監視通知の設定", ["monitoring", "alert", "config"]],
    ["認証設定の確認", ["authentication", "auth", "configuration"]],
    ["データベース保存", ["DB", "database"]],
    ["検索クエリの改善", ["search", "query"]],
    ["移行手順を確認", ["migration", "procedure"]],
    ["更新と修正をまとめる", ["update", "fix", "patch"]],
  ] as const;

  for (const [query, expectedTokens] of japaneseCases) {
    test(`ruri route expands japanese query: ${query}`, () => {
      const expanded = expandQuery(query, "ruri");
      expect(expanded.expanded.length).toBeGreaterThan(0);
      expect(expanded.expanded.some((candidate) => hasEnglish(candidate))).toBe(true);
      expect(
        expectedTokens.some((token) => expanded.expanded.some((candidate) => candidate.includes(token))),
      ).toBe(true);
    });
  }

  const englishCases = [
    ["deploy checklist", ["本番反映", "確認"]],
    ["rollback steps", ["切り戻し", "cutback"]],
    ["incident review", ["障害", "確認"]],
    ["verify config", ["設定", "検証"]],
    ["monitoring alert", ["監視", "通知"]],
    ["authentication flow", ["auth", "認証"]],
    ["database migration", ["データベース", "移行"]],
    ["search query tuning", ["検索", "チューニング"]],
    ["update workflow", ["modify", "更新"]],
    ["fix the bug", ["不具合", "修正"]],
  ] as const;

  for (const [query, expectedTokens] of englishCases) {
    test(`openai route expands english query: ${query}`, () => {
      const expanded = expandQuery(query, "openai");
      expect(expanded.expanded.length).toBeGreaterThan(0);
      expect(expanded.expanded.some((candidate) => hasJapanese(candidate))).toBe(true);
      expect(
        expectedTokens.some((token) => expanded.expanded.some((candidate) => candidate.includes(token))),
      ).toBe(true);
    });
  }

  test("ensemble route mixes japanese and english dictionaries", () => {
    const expanded = expandQuery("本番反映 deploy 手順", "ensemble");
    expect(expanded.expanded.some((candidate) => candidate.includes("デプロイ"))).toBe(true);
    expect(expanded.expanded.some((candidate) => candidate.includes("リリース") || candidate.includes("deploy"))).toBe(true);
  });

  test("maxVariants limits expansion count", () => {
    const expanded = expandQuery("本番反映 デプロイ リリース 更新 修正", "ensemble", { maxVariants: 2 });
    expect(expanded.expanded.length).toBeLessThanOrEqual(2);
  });

  test("null route returns no expansions", () => {
    expect(expandQuery("deploy", null).expanded).toEqual([]);
  });
});
