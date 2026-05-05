import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const DOC = readFileSync("docs/claude-harness-companion-contract.md", "utf8");
const SCRIPT = readFileSync("scripts/harness-mem", "utf8");

describe("Claude-harness companion contract", () => {
  test("documents ownership, paths, setup, doctor, off, and purge contract", () => {
    expect(DOC).toContain("harness-mem | daemon, local database");
    expect(DOC).toContain("Claude-harness | companion discovery");
    expect(DOC).toContain("~/.harness-mem/harness-mem.db");
    expect(DOC).toContain("--platform codex,claude");
    expect(DOC).toContain("--auto-update enable");
    expect(DOC).toContain("contract_version");
    expect(DOC).toContain("harness_mem_version");
    expect(DOC).toContain("harness-mem recall off");
    expect(DOC).toContain("harness-mem uninstall --platform codex,claude --purge-db");
    expect(DOC).toContain("must never call purge");
  });

  test("script exposes non-interactive auto-update and doctor JSON fields", () => {
    expect(SCRIPT).toContain("COMPANION_CONTRACT_VERSION");
    expect(SCRIPT).toContain("--auto-update enable|disable");
    expect(SCRIPT).toContain("SETUP_AUTO_UPDATE_OPT_IN=1");
    expect(SCRIPT).toContain("UPDATE_AUTO_UPDATE_OPT_IN=1");
    expect(SCRIPT).toContain("contract_version: $contract_version");
    expect(SCRIPT).toContain("harness_mem_version:");
  });
});
