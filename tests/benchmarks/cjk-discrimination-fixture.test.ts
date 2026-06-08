import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  buildFtsQuery,
  segmentJapaneseForFts,
} from "../../memory-server/src/core/core-utils";

const FIXTURE_PATH = join(process.cwd(), "tests/benchmarks/fixtures/cjk-discrimination.json");

const SLICES = ["nfkc_fixable", "non_nfkc_orthographic", "mixed_en_ja"] as const;
const IMPROVERS = ["101a", "101b", "102"] as const;
const REQUIRED_ENTRY_TAGS = ["developer-memory", "synthetic"] as const;
const IMPROVEMENT_TOGGLE_ENVS = [
  "HARNESS_MEM_DISABLE_CJK_NORMALIZE",
  "HARNESS_MEM_LEXICAL_BOOST",
  "HARNESS_MEM_DUAL_QUERY",
] as const;

type FixtureEntry = {
  id: string;
  role: "target" | "distractor";
  tags: string[];
  content: string;
};

type FixtureCase = {
  id: string;
  slice: (typeof SLICES)[number];
  normalization_kind: string;
  target_improver: (typeof IMPROVERS)[number];
  query: string;
  target_id: string;
  entries: FixtureEntry[];
};

type FixtureDocument = {
  schema_version: string;
  description: string;
  cases: FixtureCase[];
};

function readFixture(): FixtureDocument {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as FixtureDocument;
}

function ftsLexicalHit(query: string, content: string): boolean {
  const db = new Database(":memory:");
  try {
    db.run(`CREATE VIRTUAL TABLE fts USING fts5(content, tokenize='unicode61')`);
    db.run(`INSERT INTO fts(content) VALUES (?)`, [segmentJapaneseForFts(content)]);

    for (const mode of ["and", "hybrid"] as const) {
      const ftsQuery = buildFtsQuery(query, mode);
      if (ftsQuery === '""') continue;
      try {
        const row = db
          .query(`SELECT COUNT(*) AS n FROM fts WHERE fts MATCH ?`)
          .get(ftsQuery) as { n: number };
        if (row.n > 0) return true;
      } catch {
        // Invalid MATCH syntax for this token set; try the next mode.
      }
    }
    return false;
  } finally {
    db.close();
  }
}

function ftsLexicalHits(fixtureCase: FixtureCase): string[] {
  return fixtureCase.entries
    .filter((entry) => ftsLexicalHit(fixtureCase.query, entry.content))
    .map((entry) => entry.id);
}

function sliceRecall(cases: FixtureCase[], hit: (fixtureCase: FixtureCase) => boolean): number {
  if (cases.length === 0) return 0;
  const hits = cases.filter(hit).length;
  return hits / cases.length;
}

describe("S154-151 cjk-discrimination fixture", () => {
  const fixture = readFixture();

  test("fixture JSON shape and required metadata", () => {
    expect(fixture.schema_version).toBe("cjk-discrimination.v1");
    expect(typeof fixture.description).toBe("string");
    expect(Array.isArray(fixture.cases)).toBe(true);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
  });

  test("case and entry ids are unique with one target and 3-4 distractors", () => {
    const caseIds = new Set<string>();
    const entryIds = new Set<string>();

    for (const fixtureCase of fixture.cases) {
      expect(caseIds.has(fixtureCase.id)).toBe(false);
      caseIds.add(fixtureCase.id);

      expect(SLICES.includes(fixtureCase.slice)).toBe(true);
      expect(typeof fixtureCase.normalization_kind).toBe("string");
      expect(fixtureCase.normalization_kind.length).toBeGreaterThan(0);
      expect(IMPROVERS.includes(fixtureCase.target_improver)).toBe(true);
      expect(typeof fixtureCase.query).toBe("string");
      expect(fixtureCase.query.length).toBeGreaterThan(0);

      const targets = fixtureCase.entries.filter((entry) => entry.role === "target");
      const distractors = fixtureCase.entries.filter((entry) => entry.role === "distractor");
      expect(targets).toHaveLength(1);
      expect(distractors.length).toBeGreaterThanOrEqual(3);
      expect(distractors.length).toBeLessThanOrEqual(4);
      expect(fixtureCase.target_id).toBe(targets[0]?.id);

      for (const entry of fixtureCase.entries) {
        expect(entryIds.has(entry.id)).toBe(false);
        entryIds.add(entry.id);
        expect(entry.content.length).toBeGreaterThan(0);
        for (const tag of REQUIRED_ENTRY_TAGS) {
          expect(entry.tags).toContain(tag);
        }
        expect(entry.tags).toContain(fixtureCase.slice);
      }
    }
  });

  test("slice coverage assigns each improver to its intended slice", () => {
    const bySlice = Object.fromEntries(SLICES.map((slice) => [slice, fixture.cases.filter((c) => c.slice === slice)])) as Record<
      (typeof SLICES)[number],
      FixtureCase[]
    >;

    expect(bySlice.nfkc_fixable.length).toBeGreaterThanOrEqual(3);
    expect(bySlice.non_nfkc_orthographic.length).toBeGreaterThanOrEqual(3);
    expect(bySlice.mixed_en_ja.length).toBeGreaterThanOrEqual(3);
    expect(bySlice.nfkc_fixable.every((c) => c.target_improver === "101a")).toBe(true);
    expect(bySlice.non_nfkc_orthographic.every((c) => c.target_improver === "101b" || c.target_improver === "102")).toBe(true);
    expect(bySlice.mixed_en_ja.every((c) => c.target_improver === "102")).toBe(true);
  });

  test("nfkc_fixable cases hit only the target when normalization is enabled", () => {
    for (const fixtureCase of fixture.cases.filter((c) => c.slice === "nfkc_fixable")) {
      expect(ftsLexicalHits(fixtureCase)).toEqual([fixtureCase.target_id]);
    }
  });

  describe("negative control with all improvements off", () => {
    let savedEnv: Partial<Record<(typeof IMPROVEMENT_TOGGLE_ENVS)[number], string | undefined>>;

    beforeEach(() => {
      savedEnv = {};
      for (const name of IMPROVEMENT_TOGGLE_ENVS) {
        savedEnv[name] = process.env[name];
      }
      process.env.HARNESS_MEM_DISABLE_CJK_NORMALIZE = "1";
      delete process.env.HARNESS_MEM_LEXICAL_BOOST;
      delete process.env.HARNESS_MEM_DUAL_QUERY;
    });

    afterEach(() => {
      for (const name of IMPROVEMENT_TOGGLE_ENVS) {
        const saved = savedEnv[name];
        if (saved === undefined) delete process.env[name];
        else process.env[name] = saved;
      }
    });

    test("no case trivially hits its target under all-improvements-off", () => {
      for (const fixtureCase of fixture.cases) {
        const target = fixtureCase.entries.find((entry) => entry.id === fixtureCase.target_id);
        expect(target).toBeDefined();
        expect(ftsLexicalHit(fixtureCase.query, target!.content)).toBe(false);
      }
    });

    test("slice recall stays below 0.5 when CJK normalization is disabled", () => {
      for (const slice of SLICES) {
        const sliceCases = fixture.cases.filter((c) => c.slice === slice);
        const recall = sliceRecall(sliceCases, (fixtureCase) => {
          return ftsLexicalHits(fixtureCase).includes(fixtureCase.target_id);
        });
        expect(recall).toBeLessThan(0.5);
      }
    });
  });
});
