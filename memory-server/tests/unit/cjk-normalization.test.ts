/**
 * S154-101a: CJK normalization + segmentation regression.
 *
 * Locks in NFKC normalization (halfwidth katakana / fullwidth ASCII folding) applied
 * consistently to the content (segmentJapaneseForFts) and query (buildSearchTokens /
 * buildFtsQuery) sides, plus the existing katakana-subword and kanji-katakana split
 * behavior. No morphological analyzer is introduced.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  normalizeCjkText,
  segmentJapaneseForFts,
  buildSearchTokens,
  buildFtsQuery,
  isCjkLexicalBoostEnabled,
  isCjkNormalizationEnabled,
  isDualQueryNormalizationEnabled,
} from "../../src/core/core-utils";

const CJK_TOGGLE_ENVS = [
  "HARNESS_MEM_DISABLE_CJK_NORMALIZE",
  "HARNESS_MEM_LEXICAL_BOOST",
  "HARNESS_MEM_DUAL_QUERY",
] as const;

const DISABLE_CJK_ENV = CJK_TOGGLE_ENVS[0];

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const saved = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

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

describe("S154-150 CJK normalization off switch", () => {
  let savedEnv: Partial<Record<(typeof CJK_TOGGLE_ENVS)[number], string>>;

  beforeEach(() => {
    savedEnv = {};
    for (const name of CJK_TOGGLE_ENVS) {
      savedEnv[name] = process.env[name];
    }
  });

  afterEach(() => {
    for (const name of CJK_TOGGLE_ENVS) {
      const saved = savedEnv[name];
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    }
  });

  test("HARNESS_MEM_DISABLE_CJK_NORMALIZE=1 bypasses NFKC in normalizeCjkText", () => {
    process.env[DISABLE_CJK_ENV] = "1";
    expect(isCjkNormalizationEnabled()).toBe(false);
    expect(normalizeCjkText("ｶﾀｶﾅ")).toBe("ｶﾀｶﾅ");
    expect(normalizeCjkText("Ａ１２３")).toBe("Ａ１２３");
    expect(normalizeCjkText("ﾃﾞﾌﾟﾛｲ")).toBe("ﾃﾞﾌﾟﾛｲ");
  });

  test("unset flag keeps NFKC ON (101a regression)", () => {
    delete process.env[DISABLE_CJK_ENV];
    expect(isCjkNormalizationEnabled()).toBe(true);
    expect(normalizeCjkText("ｶﾀｶﾅ")).toBe("カタカナ");
    expect(normalizeCjkText("Ａ１２３")).toBe("A123");
    const half = buildSearchTokens("ｶﾀｶﾅ");
    const full = buildSearchTokens("カタカナ");
    expect(half).toEqual(full);
  });

  test("halfwidth query no longer matches fullwidth seed tokens when disabled", () => {
    process.env[DISABLE_CJK_ENV] = "1";
    const seedTokens = buildSearchTokens("カタカナ");
    const queryTokens = buildSearchTokens("ｶﾀｶﾅ");
    expect(seedTokens).toContain("カタカナ");
    expect(queryTokens).not.toEqual(seedTokens);
    expect(queryTokens).not.toContain("カタカナ");

    const seedFts = buildFtsQuery("カタカナ");
    const queryFts = buildFtsQuery("ｶﾀｶﾅ");
    expect(seedFts).toContain("カタカナ");
    expect(queryFts).not.toContain("カタカナ");
    // Halfwidth katakana stays outside the FTS token charset when NFKC is off.
    expect(queryFts).toBe('""');
  });

  test("segmentJapaneseForFts leaves halfwidth katakana unsegmented when disabled", () => {
    process.env[DISABLE_CJK_ENV] = "1";
    const out = segmentJapaneseForFts("ｶﾀｶﾅ");
    expect(out).toBe("ｶﾀｶﾅ");
    expect(out).not.toContain("カタカナ");
  });

  test("future 101b/102 env toggles default OFF without changing behavior", () => {
    delete process.env.HARNESS_MEM_LEXICAL_BOOST;
    delete process.env.HARNESS_MEM_DUAL_QUERY;
    expect(isCjkLexicalBoostEnabled()).toBe(false);
    expect(isDualQueryNormalizationEnabled()).toBe(false);
    withEnv("HARNESS_MEM_LEXICAL_BOOST", "1", () => {
      expect(isCjkLexicalBoostEnabled()).toBe(true);
    });
    withEnv("HARNESS_MEM_DUAL_QUERY", "1", () => {
      expect(isDualQueryNormalizationEnabled()).toBe(true);
    });
  });

  test("HARNESS_MEM_LEXICAL_BOOST=1 adds CJK reading tokens to FTS queries", () => {
    delete process.env.HARNESS_MEM_LEXICAL_BOOST;
    expect(buildSearchTokens("きおくさくいんなおすほうしん")).not.toContain("記憶");

    process.env.HARNESS_MEM_LEXICAL_BOOST = "1";
    const tokens = buildSearchTokens("きおくさくいんなおすほうしん");
    expect(tokens.slice(0, 4)).toEqual(["記憶", "索引", "直す", "方針"]);

    const ftsQuery = buildFtsQuery("きおくさくいんなおすほうしん");
    expect(ftsQuery).toContain("\"記憶\"");
    expect(ftsQuery).toContain("\"索引\"");
    expect(ftsQuery).toContain("\"直す\"");
    expect(ftsQuery).toContain("\"方針\"");
  });
});
