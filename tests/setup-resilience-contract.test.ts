import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const HARNESS_MEM_SCRIPT = readFileSync("scripts/harness-mem", "utf8");
const SEARCH_QUALITY_TEST = readFileSync("memory-server/tests/integration/search-quality.test.ts", "utf8");

describe("setup resilience contract", () => {
  test("Windows shell quality timing is a setup warning instead of a hard failure", () => {
    expect(HARNESS_MEM_SCRIPT).toContain("is_windows_shell()");
    expect(HARNESS_MEM_SCRIPT).toContain("ok:windows_warning");
    expect(HARNESS_MEM_SCRIPT).toContain("setup will continue");
    expect(SEARCH_QUALITY_TEST).toContain("IS_WINDOWS_SHELL");
    expect(SEARCH_QUALITY_TEST).toContain("IS_WINDOWS_SHELL ? 900 : 500");
  });

  test("optional setup import skips missing Claude-mem DB while explicit import remains strict", () => {
    expect(HARNESS_MEM_SCRIPT).toContain("skipping optional setup import");
    expect(HARNESS_MEM_SCRIPT).toContain('[ -f "$IMPORT_SOURCE" ] || fail "source db not found: $IMPORT_SOURCE"');
  });
});
