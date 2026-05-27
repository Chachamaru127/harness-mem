/**
 * codex-harness-mem-skill-contract.test.ts
 *
 * Contract test for codex/skills/harness-mem/SKILL.md.
 *
 * The general Codex memory skill must teach the S127 bounded-search behavior:
 * project-scoped search first, no unscoped facets, and 503 as backpressure.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SKILL_PATH = resolve(import.meta.dir, "../codex/skills/harness-mem/SKILL.md");

function readRequiredFile(path: string): string {
  expect(existsSync(path), `required file is missing: ${path}`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("Codex harness-mem skill contract", () => {
  test("SKILL.md file exists at codex/skills/harness-mem/SKILL.md", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  test("frontmatter declares name: harness-mem", () => {
    const body = readRequiredFile(SKILL_PATH);
    const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter![1]).toMatch(/^name:\s*harness-mem\s*$/m);
  });

  test("progressive retrieval sequence keeps search scoped before expansion", () => {
    const body = readRequiredFile(SKILL_PATH);
    expect(body).toContain("harness_mem_resume_pack(project, session_id)");
    expect(body).toContain("harness_mem_search({ query, project })");
    expect(body).toContain("harness_mem_timeline");
    expect(body).toContain("harness_mem_get_observations");
  });

  test("S127 bounded search guidance is present for Codex memory UX", () => {
    const body = readRequiredFile(SKILL_PATH);
    expect(body).toContain("S127 Bounded Search Rules");
    expect(body).toContain("harness_mem_search_facets");
    expect(body).toContain("Do not call it with no arguments");
    expect(body).toContain("search_facets_unbounded");
    expect(body).toContain("503");
    expect(body).toContain("backpressure");
    expect(body).toContain("project");
    expect(body).toContain("Do not use unscoped search when a project can be inferred");
    expect(body).toContain("Cross-project or unscoped search is only");
    expect(body).toContain("project=unknown");
    expect(body).toContain("vector_search=false");
  });

  test("supported client setup distinguishes Codex HTTP from Cursor user-scope wiring", () => {
    const body = readRequiredFile(SKILL_PATH);
    expect(body).toContain("Supported Client Setup");
    expect(body).toContain("harness-mem setup --platform codex");
    expect(body).toContain("harness-mem doctor --platform codex");
    expect(body).toContain("http://127.0.0.1:37889/mcp");
    expect(body).toContain("harness-mem setup --platform cursor");
    expect(body).toContain("harness-mem doctor --platform cursor");
    expect(body).toContain("~/.cursor/mcp.json");
    expect(body).toContain("mcpServers.harness-mem");
    expect(body).toContain("official Cursor Hooks");
    expect(body).toContain("MCP reload");
    expect(body).toContain("Tier 2 supported local client");
  });
});
