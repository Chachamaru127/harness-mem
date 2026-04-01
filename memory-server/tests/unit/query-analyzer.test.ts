import { describe, expect, test } from "bun:test";
import {
  analyzeText,
  decideRoute,
  detectLanguage,
  selectModelByLanguage,
} from "../../src/embedding/query-analyzer";

describe("query-analyzer", () => {
  test("空文字は natural / en 扱いになる", () => {
    const analysis = analyzeText("");
    expect(analysis.length).toBe(0);
    expect(analysis.jaRatio).toBe(0);
    expect(analysis.codeRatio).toBe(0);
    expect(analysis.queryType).toBe("natural");
    expect(detectLanguage("")).toBe("en");
  });

  test("512文字超は先頭 512 文字だけを分析する", () => {
    const longText = `${"あ".repeat(600)} deploy`;
    const analysis = analyzeText(longText);
    expect(analysis.length).toBe(512);
    expect(analysis.jaRatio).toBeGreaterThan(0.95);
  });

  test("日本語文は高い jaRatio になる", () => {
    const cases = [
      "今日は本番反映の手順を確認します。",
      "障害対応のふりかえりをまとめておきたいです。",
      "検索結果の重み付けを日本語向けに調整したい。",
    ];
    for (const value of cases) {
      expect(analyzeText(value).jaRatio).toBeGreaterThanOrEqual(0.85);
      expect(decideRoute(analyzeText(value))).toBe("ruri");
    }
  });

  test("英語文は openai route になる", () => {
    const cases = [
      "Review the release checklist and update the deployment guide.",
      "Investigate the flaky test and document the root cause.",
      "Refactor the vector search ranking logic before shipping.",
    ];
    for (const value of cases) {
      const analysis = analyzeText(value);
      expect(analysis.jaRatio).toBeLessThan(0.05);
      expect(decideRoute(analysis)).toBe("openai");
    }
  });

  test("コード要素が強い文は code query になり openai route になる", () => {
    const cases = [
      "```ts\nconst sessionMap = new Map<string, number>();\nreturn sessionMap.get(userId);\n```",
      "user_session_map[user_id] = fetchData(userId);",
      "SELECT observation_id, model FROM mem_vectors WHERE model = 'adaptive';",
    ];
    for (const value of cases) {
      const analysis = analyzeText(value);
      expect(analysis.codeRatio).toBeGreaterThanOrEqual(0.35);
      expect(analysis.queryType === "code" || decideRoute(analysis) === "openai").toBe(true);
    }
  });

  test("日英混在文は ensemble route になりやすい", () => {
    const cases = [
      "本番 deploy の rollback 手順を確認したい",
      "検索 ranking の重みを日本語 query 向けに最適化する",
      "release note を日本語でも共有したい",
    ];
    for (const value of cases) {
      const analysis = analyzeText(value);
      expect(analysis.jaRatio).toBeGreaterThanOrEqual(0.05);
      expect(analysis.jaRatio).toBeLessThan(0.85);
      expect(decideRoute(analysis)).toBe("ensemble");
    }
  });

  test("中国語と韓国語は multilingual 判定になる", () => {
    expect(detectLanguage("数据库迁移需要确认")).toBe("multilingual");
    expect(detectLanguage("배포 체크리스트를 확인하세요")).toBe("multilingual");
  });

  test("selectModelByLanguage は既定モデルを返す", () => {
    expect(selectModelByLanguage("ja")).toBe("ruri-v3-30m");
    expect(selectModelByLanguage("en")).toBe("gte-small");
    expect(selectModelByLanguage("multilingual")).toBe("multilingual-e5");
  });

  test("閾値を上げると route が変わる", () => {
    const analysis = analyzeText("本番 deploy 手順を確認したい");
    expect(decideRoute(analysis)).toBe("ensemble");
    expect(decideRoute(analysis, { jaThreshold: 0.2, codeThreshold: 0.9 })).toBe("ruri");
  });
});
