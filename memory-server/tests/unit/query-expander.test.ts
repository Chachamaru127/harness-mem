import { describe, expect, test } from "bun:test";
import { expandQuery } from "../../src/embedding/query-expander";

describe("query-expander", () => {
  const japaneseCases = [
    ["本番反映の手順", "デプロイ"],
    ["切り戻しの流れ", "ロールバック"],
    ["障害の原因調査", "インシデント"],
    ["確認フローを整理", "手順"],
    ["監視通知の設定", "モニタリング"],
    ["認証設定の確認", "チェック"],
    ["データベース保存", "DB"],
    ["検索クエリの改善", "search"],
    ["移行手順を確認", "フロー"],
    ["更新と修正をまとめる", "アップデート"],
  ] as const;

  for (const [query, expectedToken] of japaneseCases) {
    test(`ruri route expands japanese query: ${query}`, () => {
      const expanded = expandQuery(query, "ruri");
      expect(expanded.expanded.length).toBeGreaterThan(0);
      expect(expanded.expanded.some((candidate) => candidate.includes(expectedToken))).toBe(true);
    });
  }

  const englishCases = [
    ["deploy checklist", "release"],
    ["rollback steps", "revert"],
    ["incident review", "outage"],
    ["verify config", "check"],
    ["monitoring alert", "observability"],
    ["authentication flow", "auth"],
    ["database migration", "db"],
    ["search query tuning", "retrieval"],
    ["update workflow", "modify"],
    ["fix the bug", "defect"],
  ] as const;

  for (const [query, expectedToken] of englishCases) {
    test(`openai route expands english query: ${query}`, () => {
      const expanded = expandQuery(query, "openai");
      expect(expanded.expanded.length).toBeGreaterThan(0);
      expect(expanded.expanded.some((candidate) => candidate.includes(expectedToken))).toBe(true);
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
