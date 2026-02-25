/**
 * gemini-wiring-contract.test.ts
 *
 * GT-001: Gemini CLI wiring contract tests.
 * Verifies that harness-mem script, collector, core, and package.json
 * all satisfy the Gemini integration contract.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

describe("Gemini CLI wiring contract", () => {
  const harnessMemScript = readFileSync("scripts/harness-mem", "utf8");

  test("setup_gemini_wiring function exists", () => {
    expect(harnessMemScript).toContain("setup_gemini_wiring()");
  });

  test("check_gemini_wiring function exists", () => {
    expect(harnessMemScript).toContain("check_gemini_wiring()");
  });

  test("uninstall_gemini_wiring function exists", () => {
    expect(harnessMemScript).toContain("uninstall_gemini_wiring()");
  });

  test("gemini is in platform validation", () => {
    expect(harnessMemScript).toMatch(/all\|codex\|opencode\|claude\|cursor\|antigravity\|gemini/);
  });

  test("gemini settings.json path is referenced", () => {
    expect(harnessMemScript).toContain(".gemini/settings.json");
  });

  test("gemini MCP wiring uses correct JSON structure", () => {
    expect(harnessMemScript).toContain("mcpServers.harness");
    expect(harnessMemScript).toContain("upsert_gemini_json");
  });

  const collectorTs = readFileSync("memory-server/src/system-environment/collector.ts", "utf8");

  test("collector includes gemini in ai_tools", () => {
    expect(collectorTs).toContain("gemini_cli");
    expect(collectorTs).toContain("Gemini CLI");
  });

  test("collector includes gemini_wiring in doctor checks", () => {
    expect(collectorTs).toContain("gemini_wiring");
  });

  const coreTs = readFileSync("memory-server/src/core/harness-mem-core.ts", "utf8");

  test("Platform type includes gemini", () => {
    expect(coreTs).toMatch(/"gemini"/);
  });

  test("Config includes gemini ingest fields", () => {
    expect(coreTs).toContain("geminiIngestEnabled");
    expect(coreTs).toContain("geminiEventsPath");
  });

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  test("package.json keywords include gemini", () => {
    expect(packageJson.keywords).toContain("gemini");
    expect(packageJson.keywords).toContain("gemini-cli");
  });

  test("package.json files include gemini/", () => {
    expect(packageJson.files).toContain("gemini/");
  });
});
