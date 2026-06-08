/**
 * S154-101a: CJK normalization + segmentation regression.
 *
 * Locks in NFKC normalization (halfwidth katakana / fullwidth ASCII folding) applied
 * consistently to the content (segmentJapaneseForFts) and query (buildSearchTokens /
 * buildFtsQuery) sides, plus the existing katakana-subword and kanji-katakana split
 * behavior. No morphological analyzer is introduced.
 */

import { describe, expect, test } from "bun:test";
import {
  normalizeCjkText,
  segmentJapaneseForFts,
  buildSearchTokens,
  buildFtsQuery,
} from "../../src/core/core-utils";

describe("S154-101a normalizeCjkText", () => {
  test("folds halfwidth katakana to fullwidth", () => {
    expect(normalizeCjkText("ｶﾀｶﾅ")).toBe("カタカナ");
    expect(normalizeCjkText("ﾃﾞﾌﾟﾛｲ")).toBe("デプロイ");
  });

  test("folds fullwidth ASCII / digits to halfwidth", () => {
    expect(normalizeCjkText("Ａ１２３")).toBe("A123");
  });

  test("is idempotent and a no-op on plain text", () => {
    const once = normalizeCjkText("カタカナ deploy 123");
    expect(normalizeCjkText(once)).toBe(once);
    expect(normalizeCjkText("plain ascii")).toBe("plain ascii");
  });
});

describe("S154-101a segmentJapaneseForFts", () => {
  test("halfwidth katakana is normalized then segmented", () => {
    const out = segmentJapaneseForFts("ｶﾀｶﾅ");
    expect(out).toContain("カタカナ"); // folded to fullwidth (was outside HAS_CJK range)
  });

  test("katakana compound emits subwords for partial match", () => {
    const out = segmentJapaneseForFts("カタカナテスト").split(/\s+/);
    // 4+ char katakana compound → 2/3-char subwords present
    expect(out).toContain("カタ");
    expect(out.some((t) => t.length === 3)).toBe(true);
  });

  test("kanji+katakana mixed word splits into components", () => {
    const out = segmentJapaneseForFts("日本語デプロイ").split(/\s+/);
    expect(out.some((t) => /[一-鿿]/.test(t))).toBe(true);
    expect(out.some((t) => /[゠-ヿ]/.test(t))).toBe(true);
  });
});

describe("S154-101a query/content sides agree after normalization", () => {
  test("halfwidth and fullwidth katakana queries tokenize identically", () => {
    const half = buildSearchTokens("ｶﾀｶﾅ");
    const full = buildSearchTokens("カタカナ");
    expect(half).toEqual(full);
  });

  test("buildFtsQuery normalizes halfwidth input", () => {
    const q = buildFtsQuery("ﾃﾞﾌﾟﾛｲ");
    expect(q).toContain("デプロイ"); // not the halfwidth original
    expect(q).not.toContain("ﾃﾞﾌﾟﾛｲ");
  });
});
