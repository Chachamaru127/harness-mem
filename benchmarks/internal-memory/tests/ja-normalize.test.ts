import { describe, expect, test } from "bun:test";
import { semanticGroundingScore, tokenOverlapScore } from "../lib/ja-normalize";

describe("ja semantic grounding", () => {
  test("tokenOverlapScore handles Japanese characters", () => {
    const score = tokenOverlapScore("認証方式は JWT です", "JWT");
    expect(score).toBeGreaterThan(0);
  });

  test("semanticGroundingScore matches keywords in retrieved content", () => {
    const score = semanticGroundingScore(
      ["デプロイ設定を production 環境に反映した"],
      ["production", "Docker"],
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
