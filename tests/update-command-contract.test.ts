import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("update command contract", () => {
  test("harness-mem script exposes update command and prompts only when auto-update is disabled", () => {
    const script = readFileSync(join(process.cwd(), "scripts/harness-mem"), "utf8");

    expect(script).toContain("update     Update global harness-mem package");
    expect(script).toContain("should_prompt_update_auto_update_selection()");
    expect(script).toContain("prompt_update_auto_update_selection()");
    expect(script).toContain("if [ \"$(read_auto_update_enabled)\" -eq 1 ]; then");
    expect(script).toContain("update_impl()");
    expect(script).toContain("npm install -g \"${AUTO_UPDATE_PACKAGE}@${AUTO_UPDATE_CHANNEL}\"");
  });

  test("update flow remembers managed platforms and runs post-update repair", () => {
    const script = readFileSync(join(process.cwd(), "scripts/harness-mem"), "utf8");

    expect(script).toContain("\"repair_platforms\": []");
    expect(script).toContain("remember_auto_update_repair_platforms \"$PLATFORM\"");
    expect(script).toContain("forget_auto_update_repair_platforms \"$PLATFORM\"");
    expect(script).toContain("run_post_update_repair \"auto-update\"");
    expect(script).toContain("run_post_update_repair \"manual-update\"");
    expect(script).toContain("doctor --fix --platform \"$platforms\" --skip-version-check --quiet");
  });
});
