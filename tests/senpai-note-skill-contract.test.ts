/**
 * senpai-note-skill-contract.test.ts
 *
 * §138 S138-004: contract test for the /senpai-note Skill.
 *
 * - skills/senpai-note/SKILL.md exists
 * - frontmatter declares name: senpai-note
 * - trigger phrases cover handoff/runbook/reuse intents (Japanese + English)
 * - body routes through existing harness-mem primitives (no new daemon API)
 * - body keeps the §127 bounded-search safety terms (project / safe_mode / 503)
 * - body defines the HANDOFF_CARD / RUNBOOK / REPLAY_PROMPT output contract
 * - the skill bundle ships in the npm package (skills/)
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SKILL_PATH = resolve(import.meta.dir, "../skills/senpai-note/SKILL.md");
const PACKAGE_JSON_PATH = resolve(import.meta.dir, "../package.json");

const TRIGGER_PHRASES = [
  "Senpai Note",
  "引き継ぎ",
  "手順化",
  "runbook",
  "handoff",
  "再利用",
  "次回使える形",
  "次の人に渡す",
  "replay prompt",
];

const REQUIRED_ROUTES = [
  "harness_mem_session_thread",
  "harness_mem_resume_pack",
  "harness_mem_search",
];

const REQUIRED_SAFETY_TERMS = [
  "project",
  "safe_mode",
  "vector_search=false",
  "503",
  "backpressure",
];

const REQUIRED_OUTPUTS = [
  "HANDOFF_CARD",
  "RUNBOOK",
  "REPLAY_PROMPT",
  "source:",
  "summary:",
];

describe("§138 /senpai-note skill contract", () => {
  test("SKILL.md file exists at skills/senpai-note/SKILL.md", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  test("frontmatter declares name: senpai-note", () => {
    const body = readFileSync(SKILL_PATH, "utf8");
    const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter![1]).toMatch(/^name:\s*senpai-note\s*$/m);
  });

  test("description frontmatter field exists", () => {
    const body = readFileSync(SKILL_PATH, "utf8");
    const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter![1]).toMatch(/^description:/m);
  });

  test("frontmatter declares a non-empty trigger_phrases list", () => {
    const body = readFileSync(SKILL_PATH, "utf8");
    const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatter).not.toBeNull();
    const triggerBlock = frontmatter![1].match(/trigger_phrases:\s*\n((?:\s+-\s+.+\n?)+)/);
    expect(triggerBlock).not.toBeNull();
    const phrases = triggerBlock![1]
      .split("\n")
      .map((line) => line.replace(/^\s*-\s+/, "").trim())
      .filter((line) => line.length > 0);
    expect(phrases.length).toBeGreaterThan(0);
  });

  for (const phrase of TRIGGER_PHRASES) {
    test(`trigger phrase exists: ${phrase}`, () => {
      const body = readFileSync(SKILL_PATH, "utf8");
      expect(body).toContain(phrase);
    });
  }

  for (const route of REQUIRED_ROUTES) {
    test(`routing mentions ${route}`, () => {
      const body = readFileSync(SKILL_PATH, "utf8");
      expect(body).toContain(route);
    });
  }

  for (const term of REQUIRED_SAFETY_TERMS) {
    test(`bounded-search safety guidance mentions ${term}`, () => {
      const body = readFileSync(SKILL_PATH, "utf8");
      expect(body).toContain(term);
    });
  }

  for (const output of REQUIRED_OUTPUTS) {
    test(`output contract mentions ${output}`, () => {
      const body = readFileSync(SKILL_PATH, "utf8");
      expect(body).toContain(output);
    });
  }

  test("does not require a new daemon endpoint (Skill-first MVP)", () => {
    const body = readFileSync(SKILL_PATH, "utf8");
    // The MVP must lean on existing primitives, not invent new HTTP routes.
    expect(body).not.toMatch(/\/v1\/senpai/i);
  });

  test("npm package includes the skills bundle", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as { files?: string[] };
    expect(pkg.files ?? []).toContain("skills/");
  });
});
