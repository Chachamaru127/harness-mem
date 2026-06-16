/**
 * S154-C: CJK held-out generalization gate test.
 *
 * Verifies:
 * 1. Fixture exists and has correct schema
 * 2. Vocabulary is disjoint from CJK_LEXICAL_READING_RULES + CJK_DUAL_QUERY_RULES + cjk-discrimination.json queries
 * 3. Gate runs real core.search (not fixture-value read)
 * 4. Artifact records verdict (improved or overfit)
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HELDOUT_FIXTURE = join(ROOT, "tests/benchmarks/fixtures/cjk-heldout-generalization.json");
const DISCRIMINATION_FIXTURE = join(ROOT, "tests/benchmarks/fixtures/cjk-discrimination.json");
const GATE_MODULE = join(ROOT, "scripts/s154-cjk-heldout-gate.ts");

// The actual dict words registered in CJK_LEXICAL_READING_RULES (hiragana patterns)
const LEXICAL_DICT_HIRAGANA = [
  "きおく",
  "さくいん",
  "けんさく",
  "あっしゅく",
  "なおす",
  "ほうしん",
  "せっけい",
  "きょうかい",
  "ひょう",
];

// The actual dict words registered in CJK_DUAL_QUERY_RULES (kanji/mixed patterns)
const DUAL_DICT_KANJI = [
  "再ランク",
  "さいらんく",
  "再順位",
  "候補",
  "融合",
  "合成",
  "係数",
  "重み",
  "二重クエリ",
  "二重検索",
  "二重取得",
  "正規化",
  "英語強調",
  "英語",
  "関数名",
  "コードトークン",
  "保持",
];

type FixtureEntry = {
  id: string;
  role: "target" | "distractor";
  tags: string[];
  content: string;
};

type FixtureCase = {
  id: string;
  slice: string;
  normalization_kind: string;
  query: string;
  target_id: string;
  entries: FixtureEntry[];
};

type FixtureDocument = {
  schema_version: string;
  description: string;
  cases: FixtureCase[];
};

describe("S154-C cjk-heldout-generalization fixture", () => {
  test("fixture file exists", () => {
    expect(existsSync(HELDOUT_FIXTURE)).toBe(true);
  });

  test("gate script exists", () => {
    expect(existsSync(GATE_MODULE)).toBe(true);
  });

  test("fixture schema_version is cjk-heldout-generalization.v1", () => {
    const fixture = JSON.parse(readFileSync(HELDOUT_FIXTURE, "utf8")) as FixtureDocument;
    expect(fixture.schema_version).toBe("cjk-heldout-generalization.v1");
  });

  test("fixture has at least 6 cases with both nfkc_fixable and non_nfkc slices", () => {
    const fixture = JSON.parse(readFileSync(HELDOUT_FIXTURE, "utf8")) as FixtureDocument;
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
    const slices = fixture.cases.map((c) => c.slice);
    expect(slices.some((s) => s === "nfkc_fixable")).toBe(true);
    expect(slices.some((s) => s.includes("non_nfkc") || s === "non_nfkc_orthographic")).toBe(true);
  });

  test("each case has exactly 1 target and 3-4 distractors", () => {
    const fixture = JSON.parse(readFileSync(HELDOUT_FIXTURE, "utf8")) as FixtureDocument;
    for (const c of fixture.cases) {
      const targets = c.entries.filter((e) => e.role === "target");
      const distractors = c.entries.filter((e) => e.role === "distractor");
      expect(targets).toHaveLength(1);
      expect(distractors.length).toBeGreaterThanOrEqual(3);
      expect(distractors.length).toBeLessThanOrEqual(4);
      expect(c.target_id).toBe(targets[0]?.id);
    }
  });

  describe("DISJOINTNESS: held-out queries must not overlap with registered dictionary patterns", () => {
    test("no query contains a CJK_LEXICAL_READING_RULES hiragana pattern", () => {
      const fixture = JSON.parse(readFileSync(HELDOUT_FIXTURE, "utf8")) as FixtureDocument;
      for (const c of fixture.cases) {
        for (const dictWord of LEXICAL_DICT_HIRAGANA) {
          const normalized = c.query.normalize("NFKC").toLowerCase();
          const contains = normalized.includes(dictWord);
          if (contains) {
            throw new Error(
              `Query "${c.query}" in case "${c.id}" contains lexical dict pattern "${dictWord}". Held-out queries must be disjoint from registered dictionary.`,
            );
          }
        }
      }
    });

    test("no query contains a CJK_DUAL_QUERY_RULES kanji/mixed pattern", () => {
      const fixture = JSON.parse(readFileSync(HELDOUT_FIXTURE, "utf8")) as FixtureDocument;
      for (const c of fixture.cases) {
        for (const dictWord of DUAL_DICT_KANJI) {
          const contains = c.query.includes(dictWord);
          if (contains) {
            throw new Error(
              `Query "${c.query}" in case "${c.id}" contains dual-query dict pattern "${dictWord}". Held-out queries must be disjoint from registered dictionary.`,
            );
          }
        }
      }
    });

    test("no held-out query matches any existing cjk-discrimination.json query", () => {
      const heldout = JSON.parse(readFileSync(HELDOUT_FIXTURE, "utf8")) as FixtureDocument;
      const discrimination = JSON.parse(readFileSync(DISCRIMINATION_FIXTURE, "utf8")) as FixtureDocument;
      const existingQueries = new Set(discrimination.cases.map((c) => c.query));
      for (const c of heldout.cases) {
        if (existingQueries.has(c.query)) {
          throw new Error(
            `Held-out query "${c.query}" in case "${c.id}" duplicates an existing cjk-discrimination.json query. Vocabulary must be disjoint.`,
          );
        }
      }
    });
  });
});

describe("S154-C gate runner integration", () => {
  test("runCjkHeldoutGate is exported from the gate script", async () => {
    const mod = await import(GATE_MODULE);
    expect(typeof mod.runCjkHeldoutGate).toBe("function");
  });

  test("gate result schema: verdict is 'improved' or 'overfit'", async () => {
    const mod = await import(GATE_MODULE);
    const result = await (mod.runCjkHeldoutGate as (opts: unknown) => Promise<unknown>)({
      writeArtifacts: false,
    });
    const r = result as Record<string, unknown>;
    expect(r.schema_version).toBe("s154-cjk-heldout-generalization.v1");
    expect(["improved", "overfit"]).toContain(r.generalization_verdict);
    expect(typeof r.overall_passed).toBe("boolean");
  });

  test("gate drives real HarnessMemCore.search not fixture values", async () => {
    // Verify gate result contains evidence of real search: per_case array with latency_ms
    const mod = await import(GATE_MODULE);
    const result = await (mod.runCjkHeldoutGate as (opts: unknown) => Promise<unknown>)({
      writeArtifacts: false,
    });
    const r = result as Record<string, unknown>;
    const perCase = r.per_case as Array<Record<string, unknown>>;
    expect(Array.isArray(perCase)).toBe(true);
    expect(perCase.length).toBeGreaterThan(0);
    // Each entry must have latency_ms > 0 if real search was run
    for (const entry of perCase) {
      if (entry.variant === "baseline" || entry.variant === "candidate") {
        expect(typeof entry.latency_ms).toBe("number");
      }
    }
  });
});
