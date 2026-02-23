import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("harness-memd UI autostart contract", () => {
  test("daemon script keeps UI lifecycle wiring", () => {
    const script = readFileSync(join(process.cwd(), "scripts/harness-memd"), "utf8");

    expect(script).toContain('UI_ENABLED_RAW="${HARNESS_MEM_ENABLE_UI:-true}"');
    expect(script).toContain("start_ui()");
    expect(script).toContain("stop_ui()");
    expect(script).toContain("if start_ui; then");
    expect(script).toContain("stop_ui || true");
    expect(script).toContain("is_ui_reachable()");
    expect(script).not.toContain("HARNESS_MEM_UI_PARITY_V1");
  });
});
