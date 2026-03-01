/**
 * NEXT-001: Cognitive セクター自動分類 のテスト
 *
 * classifySector() が以下の5セクターを正しく分類することを検証:
 * - work    : 仕事・開発・コーディング関連
 * - people  : 人・組織・コミュニケーション関連
 * - health  : 健康・運動・メンタル関連
 * - hobby   : 趣味・娯楽・個人的活動関連
 * - meta    : メモリ管理・システム設定・自己参照関連（デフォルト）
 *
 * また router.ts の sector 重み付けが正しく機能することも検証する。
 */
import { describe, expect, test } from "bun:test";
import {
  classifySector,
  SECTOR_WEIGHTS,
  routeQueryWithSector,
  type CognitiveSector,
} from "../../src/retrieval/router";

describe("classifySector", () => {
  test("仕事・開発関連テキストを 'work' に分類する", () => {
    expect(classifySector("プロジェクト", "TypeScript でバグを修正した")).toBe("work");
    expect(classifySector("コードレビュー", "PR を merge した")).toBe("work");
    expect(classifySector("deploy", "本番環境にリリースした")).toBe("work");
  });

  test("人・組織関連テキストを 'people' に分類する", () => {
    expect(classifySector("田中さん", "チームメンバーと議論した")).toBe("people");
    expect(classifySector("1on1", "上司と面談した")).toBe("people");
  });

  test("健康・運動関連テキストを 'health' に分類する", () => {
    expect(classifySector("ランニング", "5km走った")).toBe("health");
    expect(classifySector("睡眠", "7時間睡眠を取った")).toBe("health");
    expect(classifySector("ジム", "ジムでトレーニングした")).toBe("health");
  });

  test("趣味・娯楽関連テキストを 'hobby' に分類する", () => {
    expect(classifySector("読書", "技術書を読んだ")).toBe("hobby");
    expect(classifySector("ゲーム", "新しいゲームをプレイした")).toBe("hobby");
    expect(classifySector("映画", "映画を観た")).toBe("hobby");
  });

  test("分類不明な場合はデフォルトの 'meta' を返す", () => {
    const result = classifySector("random title abc", "random content xyz 123");
    expect(result).toBe("meta");
  });

  test("英語テキストも正しく分類する", () => {
    expect(classifySector("coding session", "fixed a bug in the TypeScript code")).toBe("work");
    expect(classifySector("workout", "jogging exercise ran 5km today")).toBe("health");
    expect(classifySector("team meeting", "1on1 with manager feedback")).toBe("people");
  });

  test("大文字小文字を区別しない", () => {
    expect(classifySector("CODE REVIEW", "PULL REQUEST MERGED")).toBe("work");
    expect(classifySector("RUNNING", "GYM WORKOUT EXERCISE")).toBe("health");
  });
});

describe("SECTOR_WEIGHTS", () => {
  test("全5セクターのエントリーが存在する", () => {
    expect(SECTOR_WEIGHTS).toHaveProperty("work");
    expect(SECTOR_WEIGHTS).toHaveProperty("people");
    expect(SECTOR_WEIGHTS).toHaveProperty("health");
    expect(SECTOR_WEIGHTS).toHaveProperty("hobby");
    expect(SECTOR_WEIGHTS).toHaveProperty("meta");
  });

  test("各セクターに sector_boost フィールドが存在する", () => {
    const sectors: CognitiveSector[] = ["work", "people", "health", "hobby", "meta"];
    for (const sector of sectors) {
      expect(SECTOR_WEIGHTS[sector]).toHaveProperty("sector_boost");
      expect(typeof SECTOR_WEIGHTS[sector].sector_boost).toBe("number");
    }
  });

  test("work セクターは lexical と vector を重視する", () => {
    const weights = SECTOR_WEIGHTS["work"];
    expect(weights.lexical).toBeGreaterThan(0.2);
    expect(weights.vector).toBeGreaterThan(0.2);
  });

  test("people セクターは lexical を重視する", () => {
    const weights = SECTOR_WEIGHTS["people"];
    expect(weights.lexical).toBeGreaterThan(0.2);
  });

  test("health セクターは recency を重視する", () => {
    const weights = SECTOR_WEIGHTS["health"];
    expect(weights.recency).toBeGreaterThan(0.1);
  });
});

describe("routeQueryWithSector", () => {
  test("セクターなしの場合は通常のルーティングを返す", () => {
    const result = routeQueryWithSector("memory management best practices");
    expect(result).toBeDefined();
    expect(result.kind).toBeDefined();
    expect(result.weights).toBeDefined();
  });

  test("セクターあり場合はセクター重みを適用する", () => {
    const result = routeQueryWithSector("recent code changes", "work");
    expect(result.sector).toBe("work");
    expect(result.weights.lexical).toBe(SECTOR_WEIGHTS["work"].lexical);
  });

  test("health セクター指定で health 重みが適用される", () => {
    const result = routeQueryWithSector("workout routine", "health");
    expect(result.sector).toBe("health");
    expect(result.weights.recency).toBe(SECTOR_WEIGHTS["health"].recency);
  });

  test("people セクター指定で people 重みが適用される", () => {
    const result = routeQueryWithSector("team discussion", "people");
    expect(result.sector).toBe("people");
    expect(result.weights.lexical).toBe(SECTOR_WEIGHTS["people"].lexical);
  });

  test("hobby セクター指定で hobby 重みが適用される", () => {
    const result = routeQueryWithSector("game progress", "hobby");
    expect(result.sector).toBe("hobby");
    expect(result.weights.vector).toBe(SECTOR_WEIGHTS["hobby"].vector);
  });

  test("meta セクター指定で meta 重みが適用される", () => {
    const result = routeQueryWithSector("session context", "meta");
    expect(result.sector).toBe("meta");
    expect(result.weights.vector).toBe(SECTOR_WEIGHTS["meta"].vector);
  });
});
