/**
 * Gemini setup retirement contract.
 *
 * Gemini ingest/history code may remain as legacy data plumbing, but the CLI
 * setup surface no longer advertises or installs Gemini wiring.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

describe("Gemini setup retirement contract", () => {
  const harnessMemScript = readFileSync("scripts/harness-mem", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    files: string[];
    keywords: string[];
  };

  test("Gemini is not accepted as a setup platform", () => {
    expect(harnessMemScript).not.toMatch(/codex\|opencode\|claude\|cursor\|antigravity\|gemini/);
    expect(harnessMemScript).not.toContain("setup_gemini_wiring");
    expect(harnessMemScript).not.toContain("check_gemini_wiring");
    expect(harnessMemScript).not.toContain("uninstall_gemini_wiring");
    expect(harnessMemScript).not.toContain(".gemini/settings.json");
  });

  test("Gemini is not shipped as an npm setup surface", () => {
    expect(packageJson.files).not.toContain("gemini/");
    expect(packageJson.keywords).not.toContain("gemini");
    expect(packageJson.keywords).not.toContain("gemini-cli");
    expect(existsSync("scripts/hook-handlers/memory-gemini-event.sh")).toBe(false);
    expect(existsSync("gemini/GEMINI.md")).toBe(false);
  });
});
