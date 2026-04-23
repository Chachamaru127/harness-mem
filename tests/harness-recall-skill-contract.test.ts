/**
 * harness-recall-skill-contract.test.ts
 *
 * §96 S96-001: contract test for /harness-recall Skill.
 *
 * - skills/harness-recall/SKILL.md exists
 * - frontmatter declares the skill name
 * - description lists the trigger phrases end-users speak ("思い出して" etc.)
 *   so Claude Code loads the skill trigger via the available-skills surface
 * - body defines the intent-routing recipe (resume / decisions / cb_recall /
 *   sessions_list / search) that the user flow depends on
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SKILL_PATH = resolve(import.meta.dir, "../skills/harness-recall/SKILL.md");
const HOOK_PATH = resolve(import.meta.dir, "../scripts/userprompt-inject-policy.sh");

const TRIGGER_PHRASES = [
  "思い出して",
  "覚えてる",
  "前回",
  "続き",
  "resume",
  "recall",
];

const RECIPE_ROUTES: Array<{ label: string; tool: string }> = [
  { label: "resume / 続き", tool: "harness_mem_resume_pack" },
  { label: "decisions / 方針", tool: "decisions.md" },
  { label: "前に踏んだ同じ問題", tool: "harness_cb_recall" },
  { label: "直近 session", tool: "harness_mem_sessions_list" },
  { label: "特定キーワード", tool: "harness_mem_search" },
];

describe("§96 /harness-recall skill contract", () => {
  test("SKILL.md file exists at skills/harness-recall/SKILL.md", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  test("frontmatter declares name: harness-recall", () => {
    const body = readFileSync(SKILL_PATH, "utf8");
    const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter![1]).toMatch(/^name:\s*harness-recall\s*$/m);
  });

  test("description frontmatter field exists and mentions the skill purpose", () => {
    const body = readFileSync(SKILL_PATH, "utf8");
    const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter![1]).toMatch(/^description:/m);
  });

  for (const phrase of TRIGGER_PHRASES) {
    test(`description or trigger section lists the phrase "${phrase}"`, () => {
      const body = readFileSync(SKILL_PATH, "utf8");
      expect(body).toContain(phrase);
    });
  }

  for (const route of RECIPE_ROUTES) {
    test(`recipe routes "${route.label}" to ${route.tool}`, () => {
      const body = readFileSync(SKILL_PATH, "utf8");
      expect(body).toContain(route.tool);
    });
  }

  test("output format guideline requires a source: line", () => {
    const body = readFileSync(SKILL_PATH, "utf8");
    expect(body).toMatch(/source:/i);
  });

  test("SKILL.md trigger_phrases must match the RECALL_KEYWORDS regex in userprompt-inject-policy.sh (guard against silent divergence)", () => {
    const skillBody = readFileSync(SKILL_PATH, "utf8");
    const frontmatter = skillBody.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatter).not.toBeNull();

    const triggerBlock = frontmatter![1].match(/trigger_phrases:\s*\n((?:\s+-\s+.+\n?)+)/);
    expect(triggerBlock).not.toBeNull();
    const skillPhrases = triggerBlock![1]
      .split("\n")
      .map((line) => line.replace(/^\s*-\s+/, "").trim())
      .filter((line) => line.length > 0);
    expect(skillPhrases.length).toBeGreaterThan(0);

    const hookBody = readFileSync(HOOK_PATH, "utf8");
    const kwMatch = hookBody.match(/RECALL_KEYWORDS="([^"]+)"/);
    expect(kwMatch).not.toBeNull();
    const hookKeywords = kwMatch![1].split("|").map((s) => s.trim());
    expect(hookKeywords.length).toBeGreaterThan(0);

    for (const phrase of skillPhrases) {
      const hit = hookKeywords.some(
        (kw) => phrase.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(phrase.toLowerCase())
      );
      expect(hit, `SKILL.md trigger_phrases "${phrase}" is not covered by RECALL_KEYWORDS in userprompt-inject-policy.sh`).toBe(true);
    }
    for (const kw of hookKeywords) {
      const hit = skillPhrases.some(
        (phrase) => phrase.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(phrase.toLowerCase())
      );
      expect(hit, `RECALL_KEYWORDS entry "${kw}" has no corresponding SKILL.md trigger_phrases entry`).toBe(true);
    }
  });
});
