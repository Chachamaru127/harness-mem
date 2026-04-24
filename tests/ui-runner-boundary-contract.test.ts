import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ROOT_BUNFIG = resolve(ROOT, "bunfig.toml");
const PLAYWRIGHT_CONFIG = resolve(ROOT, "harness-mem-ui", "playwright.config.ts");
const E2E_DIR = resolve(ROOT, "harness-mem-ui", "tests", "e2e");

describe("UI runner boundary contract", () => {
  test("root bunfig documents Vitest/Playwright naming boundaries instead of global jsdom preload", () => {
    const bunfig = readFileSync(ROOT_BUNFIG, "utf8");
    expect(bunfig).toContain("*.vitest.ts(x)");
    expect(bunfig).toContain("*.e2e.ts");
    expect(bunfig.includes('preload = ["./harness-mem-ui/tests/setup.ts"]')).toBe(false);
  });

  test("Playwright config matches only *.e2e.ts files", () => {
    const config = readFileSync(PLAYWRIGHT_CONFIG, "utf8");
    expect(config).toContain('testMatch: "**/*.e2e.ts"');
  });

  test("Playwright test files use *.e2e.ts naming so bun:test does not auto-discover them", () => {
    const files = readdirSync(E2E_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith(".spec.ts"))).toBe(false);
    expect(files.every((file) => file.endsWith(".e2e.ts"))).toBe(true);
  });

  test("Vitest UI files use *.vitest.ts(x) naming so bun:test does not auto-discover them", () => {
    const files = readdirSync(resolve(ROOT, "harness-mem-ui", "tests", "ui"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"))).toBe(false);
    expect(
      files.every((file) => file.endsWith(".vitest.ts") || file.endsWith(".vitest.tsx"))
    ).toBe(true);
  });
});
