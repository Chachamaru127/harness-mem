import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REPRO_DOC_PATH = join(ROOT, "docs", "bun-test-panic-repro.md");
const REPRO_SCRIPT_PATH = join(ROOT, "scripts", "repro-bun-panic.sh");

describe("bun panic docs contract", () => {
  test("repro doc exists and separates facts from mitigation", () => {
    expect(existsSync(REPRO_DOC_PATH)).toBe(true);
    const doc = readFileSync(REPRO_DOC_PATH, "utf8");

    expect(doc).toContain("### 事実");
    expect(doc).toContain("### 推測");
    expect(doc).toContain("### この repo 側の対策");
    expect(doc).toContain("scripts/repro-bun-panic.sh");
    expect(doc).toContain("npm test");
    expect(doc).toContain("TESTING.md");
  });

  test("repro script supports raw and safe comparison", () => {
    expect(existsSync(REPRO_SCRIPT_PATH)).toBe(true);
    const script = readFileSync(REPRO_SCRIPT_PATH, "utf8");

    expect(script).toContain("--raw");
    expect(script).toContain("--safe");
    expect(script).toContain("run-bun-test-safe.sh");
    expect(script).toContain("cross-tool-transfer.test.ts");
  });
});
