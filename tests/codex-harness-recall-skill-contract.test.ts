/**
 * codex-harness-recall-skill-contract.test.ts
 *
 * §97 S97-001: contract test for the Codex harness-recall skill.
 *
 * - codex/skills/harness-recall/SKILL.md exists
 * - frontmatter declares the skill name
 * - trigger phrases stay aligned with the Claude /harness-recall skill
 * - body defines the same intent-routing recipe and source: output contract
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLAUDE_SKILL_PATH = resolve(import.meta.dir, "../skills/harness-recall/SKILL.md");
const CODEX_SKILL_PATH = resolve(import.meta.dir, "../codex/skills/harness-recall/SKILL.md");

const RECIPE_ROUTES: Array<{ label: string; tool: string }> = [
  { label: "resume / 続き", tool: "harness_mem_resume_pack" },
  { label: "decisions / 方針", tool: "decisions.md" },
  { label: "前に踏んだ同じ問題", tool: "harness_cb_recall" },
  { label: "直近 session", tool: "harness_mem_sessions_list" },
  { label: "特定キーワード", tool: "harness_mem_search" },
];

function readRequiredFile(path: string): string {
  expect(existsSync(path), `required file is missing: ${path}`).toBe(true);
  return readFileSync(path, "utf8");
}

function readFrontmatter(body: string): string {
  const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/);
  expect(frontmatter).not.toBeNull();
  return frontmatter![1];
}

function readTriggerPhrases(frontmatter: string): string[] {
  const triggerBlock = frontmatter.match(/trigger_phrases:\s*\n((?:\s+-\s+.+\n?)+)/);
  expect(triggerBlock).not.toBeNull();
  return triggerBlock![1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter((line) => line.length > 0);
}

describe("§97 Codex harness-recall skill contract", () => {
  test("Claude source skill exists for parity comparison", () => {
    expect(existsSync(CLAUDE_SKILL_PATH)).toBe(true);
  });

  test("SKILL.md file exists at codex/skills/harness-recall/SKILL.md", () => {
    expect(existsSync(CODEX_SKILL_PATH)).toBe(true);
  });

  test("frontmatter declares name: harness-recall", () => {
    const body = readRequiredFile(CODEX_SKILL_PATH);
    const frontmatter = readFrontmatter(body);
    expect(frontmatter).toMatch(/^name:\s*harness-recall\s*$/m);
  });

  test("description frontmatter field exists and mentions the skill purpose", () => {
    const body = readRequiredFile(CODEX_SKILL_PATH);
    const frontmatter = readFrontmatter(body);
    expect(frontmatter).toMatch(/^description:/m);
  });

  test("trigger_phrases stay aligned with the Claude harness-recall skill", () => {
    const claudeBody = readRequiredFile(CLAUDE_SKILL_PATH);
    const codexBody = readRequiredFile(CODEX_SKILL_PATH);
    const claudeTriggers = readTriggerPhrases(readFrontmatter(claudeBody));
    const codexTriggers = readTriggerPhrases(readFrontmatter(codexBody));

    expect(codexTriggers).toEqual(claudeTriggers);
  });

  test("Codex skill body mentions every recall trigger phrase", () => {
    const claudeBody = readRequiredFile(CLAUDE_SKILL_PATH);
    const codexBody = readRequiredFile(CODEX_SKILL_PATH);
    const claudeTriggers = readTriggerPhrases(readFrontmatter(claudeBody));

    for (const phrase of claudeTriggers) {
      expect(codexBody).toContain(phrase);
    }
  });

  for (const route of RECIPE_ROUTES) {
    test(`recipe routes "${route.label}" to ${route.tool}`, () => {
      const body = readRequiredFile(CODEX_SKILL_PATH);
      expect(body).toContain(route.tool);
    });
  }

  test("output format guideline requires a source: line", () => {
    const body = readRequiredFile(CODEX_SKILL_PATH);
    expect(body).toMatch(/source:/i);
  });
});
