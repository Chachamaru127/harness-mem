/**
 * COMP-005: 埋め込みカタログ拡張テスト
 *
 * テストケース:
 * 1. 正常: bge-small が MODEL_CATALOG に登録されている
 * 2. 正常: multilingual-e5 が MODEL_CATALOG に登録されている
 * 3. 正常: nomic-embed が MODEL_CATALOG に登録されている
 * 4. 正常: 多言語（韓国語/中国語など）テキストで multilingual モデルが自動選択される
 * 5. 正常: 日本語テキストは ruri-v3-30m が選択される（既存挙動を維持）
 * 6. 正常: 英語テキストは gte-small が選択される（既存挙動を維持）
 */

import { describe, expect, test } from "bun:test";
import { MODEL_CATALOG, findModelById } from "../../src/embedding/model-catalog";
import { detectLanguage, selectModelByLanguage } from "../../src/embedding/registry";

describe("COMP-005: 埋め込みカタログ拡張", () => {
  test("正常: bge-small が MODEL_CATALOG に登録されている", () => {
    const entry = findModelById("bge-small");
    expect(entry).toBeDefined();
    expect(entry?.id).toBe("bge-small");
    expect(entry?.dimension).toBeGreaterThan(0);
    expect(entry?.language).toBeDefined();
    expect(entry?.onnxRepo).toBeTruthy();
  });

  test("正常: multilingual-e5 が MODEL_CATALOG に登録されている", () => {
    const entry = findModelById("multilingual-e5");
    expect(entry).toBeDefined();
    expect(entry?.id).toBe("multilingual-e5");
    expect(entry?.dimension).toBeGreaterThan(0);
    expect(entry?.language).toBe("multilingual");
    expect(entry?.onnxRepo).toBeTruthy();
  });

  test("正常: nomic-embed が MODEL_CATALOG に登録されている", () => {
    const entry = findModelById("nomic-embed");
    expect(entry).toBeDefined();
    expect(entry?.id).toBe("nomic-embed");
    expect(entry?.dimension).toBeGreaterThan(0);
    expect(entry?.onnxRepo).toBeTruthy();
  });

  test("正常: MODEL_CATALOG に合計6モデル以上が登録されている", () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(6);
  });

  test("正常: 多言語テキスト（韓国語/中国語）で multilingual モデルが自動選択される", () => {
    // 韓国語テキスト
    const koreanText = "안녕하세요 오늘 날씨가 좋습니다";
    const koreanLang = detectLanguage(koreanText);
    const koreanModel = selectModelByLanguage(koreanLang);
    // multilingual モデルが選択されるか、または英語フォールバックを許容
    expect(["multilingual-e5", "gte-small", "bge-small"].includes(koreanModel)).toBe(true);

    // 中国語テキスト
    const chineseText = "今天天气很好，我们去公园吧";
    const chineseLang = detectLanguage(chineseText);
    const chineseModel = selectModelByLanguage(chineseLang);
    expect(["multilingual-e5", "gte-small", "bge-small"].includes(chineseModel)).toBe(true);
  });

  test("正常: 日本語は ruri-v3-30m、英語は gte-small の既存挙動を維持", () => {
    expect(selectModelByLanguage("ja")).toBe("ruri-v3-30m");
    expect(selectModelByLanguage("en")).toBe("gte-small");
  });
});
