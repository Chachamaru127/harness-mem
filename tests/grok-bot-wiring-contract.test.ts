import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPT = readFileSync(join(ROOT, "scripts/harness-mem"), "utf8");

describe("grok-bot wiring contract", () => {
  test("CLI usage surfaces grok-bot in setup/doctor/uninstall and mcp-config", () => {
    expect(SCRIPT).toContain("--platform <all|codex|opencode|claude|cursor|antigravity|grok-bot|comma-list>");
    expect(SCRIPT).toContain("--client <claude,codex,cursor,hermes,grok-bot|all>");
    expect(SCRIPT).toContain("6) grok-bot  (Tier 3 MCP-only via ~/.cursor/mcp.json)");
  });

  test("platform alias and wiring functions stay registered", () => {
    expect(SCRIPT).toContain("grokbot)");
    expect(SCRIPT).toContain("printf 'grok-bot'");
    expect(SCRIPT).toContain("setup_grok_bot_wiring()");
    expect(SCRIPT).toContain("check_grok_bot_wiring()");
    expect(SCRIPT).toContain("uninstall_grok_bot_wiring()");
    expect(SCRIPT).toContain("_doctor_record \"grok_bot_wiring\" \"ok\" \"\"");
  });
});
