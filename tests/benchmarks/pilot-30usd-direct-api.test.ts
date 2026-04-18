import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const PILOT_DOC_PATH = join(ROOT, "docs", "benchmarks", "pilot-30usd-direct-api.md");
const PILOT_SCRIPT_PATH = join(ROOT, "scripts", "bench-pilot-30usd.sh");

describe("30 USD direct-api pilot contract", () => {
  test("ships the runbook and wrapper", () => {
    expect(existsSync(PILOT_DOC_PATH)).toBe(true);
    expect(existsSync(PILOT_SCRIPT_PATH)).toBe(true);

    const doc = readFileSync(PILOT_DOC_PATH, "utf8");
    const script = readFileSync(PILOT_SCRIPT_PATH, "utf8");

    expect(doc).toContain("30 USD");
    expect(doc).toContain("direct API");
    expect(doc).toContain("OpenRouter");
    expect(doc).toContain("OpenCode");
    expect(doc).toContain("gpt-5-mini");
    expect(doc).toContain("gemini/gemini-2.5-flash-lite");
    expect(doc).toContain("Phase 1");
    expect(doc).toContain("Phase 4");

    expect(script).toContain("--dry-run");
    expect(script).toContain("budget cap: 30 USD");
    expect(script).toContain("OpenRouter, OpenCode, NoLiMa");
    expect(script).toContain("phase1 tau3 smoke");
    expect(script).toContain("phase4 swebench compare");
  });

  test("package.json exposes the pilot scripts", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};

    expect(scripts["benchmark:pilot30"]).toBe("bash scripts/bench-pilot-30usd.sh");
    expect(scripts["benchmark:pilot30:dry-run"]).toBe("bash scripts/bench-pilot-30usd.sh --dry-run");
  });
});
