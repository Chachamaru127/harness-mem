/**
 * cursor-supported-docs-contract.test.ts
 *
 * Contract test for the public Cursor support ceiling across README/setup docs.
 * Keep this focused on stable claims, not exact prose.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC_PATHS = [
  "README.md",
  "README_ja.md",
  "docs/harness-mem-setup.md",
  "docs/harness-mem-setup-ja.md",
  "docs/readme-claims.md",
  "docs/readme-claims-ja.md",
];

function readRequiredRepoFile(relativePath: string): string {
  const path = resolve(import.meta.dir, "..", relativePath);
  expect(existsSync(path), `required file is missing: ${relativePath}`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("Cursor supported docs contract", () => {
  test.each(DOC_PATHS)("%s keeps stable Cursor setup claims", (relativePath) => {
    const body = readRequiredRepoFile(relativePath);
    expect(body).toContain("setup --platform cursor");
    expect(body).toContain("doctor --platform cursor");
    expect(body).toContain("mcpServers.harness-mem");
    expect(body).toMatch(/Tier 2|tier 2/);
  });

  test.each(DOC_PATHS)("%s does not overclaim Cursor support tier", (relativePath) => {
    const body = readRequiredRepoFile(relativePath);
    expect(body).not.toMatch(/Cursor\s+(is|as|=)\s+(a\s+)?Tier 1/i);
    expect(body).not.toMatch(/Cursor\s+は\s+Tier 1/);
    expect(body).not.toMatch(/Cursor Marketplace/i);
  });
});
