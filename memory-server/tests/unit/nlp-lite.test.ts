/**
 * nlp-lite.test.ts  (§F-1 / S78-C02b)
 *
 * Table-driven tests for the entity-type and relation-kind heuristics.
 * These tests intentionally cover BOTH positive cases (the rule fires) and
 * negative cases (the rule does NOT mis-fire), to keep the discriminators
 * honest under future edits.
 */

import { describe, expect, test } from "bun:test";
import {
  classifyEntityType,
  classifyRelationKind,
  type EntityType,
  type RelationKind,
} from "../../src/core/nlp-lite";

describe("classifyEntityType", () => {
  const cases: Array<{ label: string; context?: string; want: EntityType; why: string }> = [
    // --- technology --------------------------------------------------------
    { label: "TypeScript",   want: "technology", why: "explicit whitelist" },
    { label: "Docker",       want: "technology", why: "explicit whitelist" },
    { label: "postgres",     want: "technology", why: "lowercased whitelist" },
    { label: "worker.ts",    want: "technology", why: "source-file extension" },
    { label: "deploy.sh",    want: "technology", why: "shell script extension" },
    { label: "schema.sql",   want: "technology", why: "sql extension" },
    { label: "ReactRouter",  want: "technology", why: "tech-root prefix in CamelCase" },
    { label: "v3",           want: "technology", why: "version literal" },
    { label: "1.2.3",        want: "technology", why: "semver-like literal" },

    // --- action ------------------------------------------------------------
    { label: "fix",          want: "action",     why: "imperative verb" },
    { label: "Refactored",   want: "action",     why: "past-tense verb, capitalized" },
    { label: "deploying",    want: "action",     why: "gerund of action verb" },
    { label: "merge",        want: "action",     why: "imperative" },

    // --- person ------------------------------------------------------------
    { label: "Alice",        want: "person",     why: "bare Capitalized name" },
    { label: "Bob",          want: "person",     why: "short Capitalized name (3 chars)" },
    {
      label: "Smith",
      context: "Met with Dr. Smith yesterday",
      want: "person",
      why: "name-shape with honorific in context",
    },
    {
      label: "Tanaka",
      context: "田中さん と打ち合わせ",
      want: "person",
      why: "JA honorific in context (loose)",
    },

    // --- other / negative cases -------------------------------------------
    { label: "RaceCondition",    want: "other", why: "code-class suffix Condition" },
    { label: "AuthService",      want: "other", why: "code-class suffix Service" },
    { label: "MemoryError",      want: "other", why: "code-class suffix Error" },
    { label: "user_profile",     want: "other", why: "snake_case ident, not name/tech" },
    { label: "foo",              want: "other", why: "lowercased non-tech token" },
    { label: "",                 want: "other", why: "empty input" },
    // Even with honorific context, do not flip a tech token to person.
    {
      label: "Docker",
      context: "Dr. Smith deployed Docker",
      want: "technology",
      why: "tech whitelist beats honorific disambiguation",
    },
  ];

  for (const c of cases) {
    test(`${c.want.padEnd(11)} ← ${JSON.stringify(c.label)} (${c.why})`, () => {
      expect(classifyEntityType(c.label, c.context)).toBe(c.want);
    });
  }
});

describe("classifyRelationKind", () => {
  const cases: Array<{
    src: string;
    dst: string;
    text: string;
    want: RelationKind;
    why: string;
  }> = [
    // --- fixes -------------------------------------------------------------
    {
      src: "patch", dst: "RaceCondition",
      text: "This patch fixes RaceCondition in the worker.",
      want: "fixes",
      why: "X fixes Y phrasing",
    },
    {
      src: "PR", dst: "bug",
      text: "PR resolves bug introduced last week.",
      want: "fixes",
      why: "resolves synonym",
    },
    {
      src: "fix", dst: "auth",
      text: "fix(auth): handle missing token",
      want: "fixes",
      why: "conventional-commit prefix",
    },

    // --- uses --------------------------------------------------------------
    {
      src: "Server", dst: "Redis",
      text: "Server uses Redis for the session store.",
      want: "uses",
      why: "X uses Y phrasing",
    },
    {
      src: "API", dst: "Postgres",
      text: "API depends on Postgres for persistence.",
      want: "uses",
      why: "depends on synonym",
    },
    {
      src: "worker.ts", dst: "queue",
      text: "worker.ts imports queue from the lib.",
      want: "uses",
      why: "imports synonym",
    },

    // --- is_a --------------------------------------------------------------
    {
      src: "Vector", dst: "embedding",
      text: "Vector is an embedding produced by the model.",
      want: "is_a",
      why: "X is an Y",
    },
    {
      src: "label", dst: "string",
      text: "label: string field on the entity row.",
      want: "is_a",
      why: "definition colon form",
    },

    // --- generic -----------------------------------------------------------
    {
      src: "Alice", dst: "deploy.sh",
      text: "Alice ran deploy.sh during the demo.",
      want: "generic",
      why: "co-occurrence without is_a/uses/fixes pattern",
    },
    {
      src: "a", dst: "b",
      text: "",
      want: "generic",
      why: "empty text",
    },
    // Negative: do not over-claim 'uses' when only one side is in the span.
    {
      src: "X", dst: "Y",
      text: "We used the library. Later X did something. Y did something else.",
      want: "generic",
      why: "verb appears but X/Y not in same matched span",
    },
  ];

  for (const c of cases) {
    test(`${c.want.padEnd(7)} ← (${c.src} , ${c.dst}) :: "${c.text.slice(0, 40)}…" (${c.why})`, () => {
      expect(classifyRelationKind(c.src, c.dst, c.text)).toBe(c.want);
    });
  }

  test("priority: fixes > uses when both phrases match the same pair", () => {
    // "X fixes Y. X uses Y." — fixes should win.
    const t = "patch fixes module. patch uses module.";
    expect(classifyRelationKind("patch", "module", t)).toBe("fixes");
  });
});
