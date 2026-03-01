/**
 * NEXT-001: Cognitive セクター自動分類のユニットテスト
 *
 * 5セクター（work/people/health/hobby/meta）の自動分類と
 * 検索時のセクター重み付けを検証する。
 */
import { describe, expect, test } from "bun:test";

// router.ts から classifySector と SearchWeights の sector_boost フィールドをテスト
import {
  classifySector,
  type CognitiveSector,
  SECTOR_WEIGHTS,
  routeQueryWithSector,
} from "../../memory-server/src/retrieval/router";

describe("NEXT-001: Cognitive セクター自動分類", () => {
  // テスト1: work セクターの分類
  test("work キーワードを含むコンテンツを work セクターに分類する", () => {
    const result = classifySector("バグ修正作業", "TypeScript でエラーハンドリングを実装した。プロジェクトのコードレビューを完了。");
    expect(result).toBe("work");
  });

  // テスト2: people セクターの分類
  test("people キーワードを含むコンテンツを people セクターに分類する", () => {
    const result = classifySector("チームミーティング", "田中さんと山本さんが会議で意見交換した。メンターからフィードバックをもらった。");
    expect(result).toBe("people");
  });

  // テスト3: health セクターの分類
  test("health キーワードを含むコンテンツを health セクターに分類する", () => {
    const result = classifySector("睡眠記録", "昨日は8時間睡眠できた。運動としてジョギング30分実施。食事はバランスよく摂取。");
    expect(result).toBe("health");
  });

  // テスト4: hobby セクターの分類
  test("hobby キーワードを含むコンテンツを hobby セクターに分類する", () => {
    const result = classifySector("読書記録", "SF小説を読み終えた。ゲームでレベルアップした。音楽の練習を1時間行った。");
    expect(result).toBe("hobby");
  });

  // テスト5: meta セクターへのフォールバック
  test("特定セクターに分類できないコンテンツを meta セクターに分類する", () => {
    const result = classifySector("メモ", "今日の天気は晴れだった。");
    expect(result).toBe("meta");
  });

  // テスト6: SearchWeights に sector_boost フィールドが存在し、セクター別重み付けが機能する
  test("SearchWeights に sector_boost フィールドがあり、routeQueryWithSector がセクターフィルタ付き RouteDecision を返す", () => {
    // SearchWeights に sector_boost が存在することを確認
    const workWeights = SECTOR_WEIGHTS["work"];
    expect(workWeights).toBeDefined();
    expect(typeof workWeights.sector_boost).toBe("number");
    expect(workWeights.sector_boost).toBeGreaterThan(0);

    // sector フィルタ付きクエリが sector_boost を適用することを確認
    const decision = routeQueryWithSector("最近のコード実装について教えて", "work");
    expect(decision.weights.sector_boost).toBeGreaterThan(0);
    expect(decision.sector).toBe("work");
  });
});
