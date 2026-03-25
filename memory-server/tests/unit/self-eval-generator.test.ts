/**
 * §54 S54-001: SelfEval テンプレート拡張テスト
 *
 * QUERY_TEMPLATES の数・型・slice カバレッジ・テンプレート関数の動作を検証する。
 */

import { describe, expect, test } from "bun:test";
import {
  QUERY_TEMPLATES,
  type SelfEvalEntry,
} from "../../src/benchmark/self-eval-generator";

// ---------------------------------------------------------------------------
// テスト用ダミーエントリ
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<SelfEvalEntry> = {}): SelfEvalEntry {
  return {
    id: "entry-001",
    content: "implement feature X with TypeScript fix error bug resolve",
    created_at: "2026-01-01T00:00:00.000Z",
    session_id: "session-test",
    ...overrides,
  };
}

const dummyEntries: SelfEvalEntry[] = [
  makeEntry({ id: "e1", content: "start project setup with npm install.ts" }),
  makeEntry({ id: "e2", content: "implement feature error fix resolve bug" }),
  makeEntry({ id: "e3", content: "run tests and fix failing.json file" }),
  makeEntry({ id: "e4", content: "refactor code and update README.md" }),
  makeEntry({ id: "e5", content: "deploy to production エラー修正完了" }),
];

// ---------------------------------------------------------------------------
// テンプレート数
// ---------------------------------------------------------------------------

describe("QUERY_TEMPLATES count", () => {
  test("テンプレート数が20以上であること", () => {
    expect(QUERY_TEMPLATES.length).toBeGreaterThanOrEqual(20);
  });

  test("テンプレート数がちょうど20であること", () => {
    expect(QUERY_TEMPLATES.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 型の正しさ
// ---------------------------------------------------------------------------

describe("QUERY_TEMPLATES structure", () => {
  test("全テンプレートに id フィールドがあること", () => {
    for (const tmpl of QUERY_TEMPLATES) {
      expect(typeof tmpl.id).toBe("string");
      expect(tmpl.id.length).toBeGreaterThan(0);
    }
  });

  test("全テンプレートに slice フィールドがあること", () => {
    for (const tmpl of QUERY_TEMPLATES) {
      expect(typeof tmpl.slice).toBe("string");
      expect(tmpl.slice.length).toBeGreaterThan(0);
    }
  });

  test("全テンプレートに template 関数があること", () => {
    for (const tmpl of QUERY_TEMPLATES) {
      expect(typeof tmpl.template).toBe("function");
    }
  });

  test("全テンプレートに expected_order 関数があること", () => {
    for (const tmpl of QUERY_TEMPLATES) {
      expect(typeof tmpl.expected_order).toBe("function");
    }
  });

  test("id が重複していないこと", () => {
    const ids = QUERY_TEMPLATES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// slice カバレッジ
// ---------------------------------------------------------------------------

describe("QUERY_TEMPLATES slice coverage", () => {
  const slices = new Set(QUERY_TEMPLATES.map((t) => t.slice));

  test("slice の種類が7以上あること", () => {
    expect(slices.size).toBeGreaterThanOrEqual(7);
  });

  const requiredSlices = [
    "temporal-order",
    "tool-recall",
    "error-resolution",
    "decision-why",
    "file-change",
    "cross-client",
    "session-summary",
    "noisy-ja",
    "cross-lingual",
    "dependency",
  ];

  for (const slice of requiredSlices) {
    test(`slice "${slice}" が含まれていること`, () => {
      expect(slices.has(slice)).toBe(true);
    });
  }

  test("temporal-order のテンプレートが3種あること", () => {
    const count = QUERY_TEMPLATES.filter(
      (t) => t.slice === "temporal-order"
    ).length;
    expect(count).toBe(3);
  });

  test("tool-recall のテンプレートが2種あること", () => {
    const count = QUERY_TEMPLATES.filter(
      (t) => t.slice === "tool-recall"
    ).length;
    expect(count).toBe(2);
  });

  test("error-resolution のテンプレートが2種あること", () => {
    const count = QUERY_TEMPLATES.filter(
      (t) => t.slice === "error-resolution"
    ).length;
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// template 関数の動作
// ---------------------------------------------------------------------------

describe("template functions", () => {
  test("全テンプレートがダミーエントリで文字列を返すこと", () => {
    for (const tmpl of QUERY_TEMPLATES) {
      const result = tmpl.template(dummyEntries);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  test("se-to-01: セッション固有スニペットを含むクエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "se-to-01")!;
    const result = tmpl.template(dummyEntries);
    expect(result).toContain("first thing I worked on");
    expect(result).toContain("start project setup");
  });

  test("se-to-02: セッション固有スニペットを含むクエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "se-to-02")!;
    const result = tmpl.template(dummyEntries);
    expect(result).toContain("most recent activity");
    expect(result).toContain("start project setup");
  });

  test("se-to-03: 2番目エントリのスニペットを含むクエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "se-to-03")!;
    const result = tmpl.template(dummyEntries);
    expect(result).toContain("implement feature error");
  });

  test("error-resolution-en: エラー関連エントリのスニペットを含むクエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find(
      (t) => t.id === "error-resolution-en"
    )!;
    const result = tmpl.template(dummyEntries);
    expect(typeof result).toBe("string");
    expect(result).toContain("resolved");
  });

  test("error-resolution-ja: 日本語クエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find(
      (t) => t.id === "error-resolution-ja"
    )!;
    const result = tmpl.template(dummyEntries);
    expect(result).toContain("どう解決しましたか");
  });

  test("decision-why-en: 中間エントリのスニペットを含む英語クエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "decision-why-en")!;
    const result = tmpl.template(dummyEntries);
    expect(result).toContain("Why was the decision made");
  });

  test("decision-why-ja: 判断の理由を問う日本語クエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "decision-why-ja")!;
    const result = tmpl.template(dummyEntries);
    expect(result).toContain("判断の理由");
  });

  test("noisy-casual-ja: 口語日本語クエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "noisy-casual-ja")!;
    const result = tmpl.template(dummyEntries);
    expect(result).toContain("あの");
    expect(result).toContain("どうなったんだっけ");
  });

  test("cross-lingual-en-to-ja: 日本語クエリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find(
      (t) => t.id === "cross-lingual-en-to-ja"
    )!;
    const result = tmpl.template(dummyEntries);
    expect(result).toContain("について教えてください");
  });
});

// ---------------------------------------------------------------------------
// expected_order 関数の動作
// ---------------------------------------------------------------------------

describe("expected_order functions", () => {
  test("全テンプレートが空でない配列を返すこと", () => {
    for (const tmpl of QUERY_TEMPLATES) {
      const result = tmpl.expected_order(dummyEntries);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  test("se-to-01: 昇順（全エントリ）を返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "se-to-01")!;
    expect(tmpl.expected_order(dummyEntries)).toEqual(
      dummyEntries.map((e) => e.id)
    );
  });

  test("se-to-02: 降順（全エントリ）を返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "se-to-02")!;
    expect(tmpl.expected_order(dummyEntries)).toEqual(
      [...dummyEntries].reverse().map((e) => e.id)
    );
  });

  test("se-to-03: 3番目以降のエントリを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "se-to-03")!;
    expect(tmpl.expected_order(dummyEntries)).toEqual(
      dummyEntries.slice(2).map((e) => e.id)
    );
  });

  test("error-resolution-en: エラーがない場合でも空配列にならないこと（フォールバック）", () => {
    const noErrorEntries: SelfEvalEntry[] = [
      makeEntry({ id: "x1", content: "setup project" }),
      makeEntry({ id: "x2", content: "write documentation" }),
      makeEntry({ id: "x3", content: "deploy application" }),
    ];
    const tmpl = QUERY_TEMPLATES.find(
      (t) => t.id === "error-resolution-en"
    )!;
    const result = tmpl.expected_order(noErrorEntries);
    expect(result.length).toBeGreaterThan(0);
  });

  test("file-change-en: ファイル拡張子がない場合でも空配列にならないこと（フォールバック）", () => {
    const noFileEntries: SelfEvalEntry[] = [
      makeEntry({ id: "y1", content: "discuss architecture" }),
      makeEntry({ id: "y2", content: "plan sprint" }),
      makeEntry({ id: "y3", content: "review design" }),
    ];
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "file-change-en")!;
    const result = tmpl.expected_order(noFileEntries);
    expect(result.length).toBeGreaterThan(0);
  });

  test("file-change-en: ファイル拡張子があるエントリのみを返すこと", () => {
    const tmpl = QUERY_TEMPLATES.find((t) => t.id === "file-change-en")!;
    const result = tmpl.expected_order(dummyEntries);
    // dummyEntries に .ts, .json, .md を含むエントリがあるので filtered が返る
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(dummyEntries.length);
  });

  test("expected_order の結果が有効なエントリIDのみを含むこと", () => {
    const validIds = new Set(dummyEntries.map((e) => e.id));
    for (const tmpl of QUERY_TEMPLATES) {
      const result = tmpl.expected_order(dummyEntries);
      for (const id of result) {
        expect(validIds.has(id)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// temporal-order テンプレートの ID 追従
// ---------------------------------------------------------------------------

describe("temporal-order template IDs", () => {
  const existingIds = [
    "se-to-01",
    "se-to-02",
    "se-to-03",
  ];

  for (const id of existingIds) {
    test(`テンプレート "${id}" が存在すること`, () => {
      const tmpl = QUERY_TEMPLATES.find((t) => t.id === id);
      expect(tmpl).toBeDefined();
    });

    test(`テンプレート "${id}" の slice が "temporal-order" であること`, () => {
      const tmpl = QUERY_TEMPLATES.find((t) => t.id === id)!;
      expect(tmpl.slice).toBe("temporal-order");
    });
  }
});
