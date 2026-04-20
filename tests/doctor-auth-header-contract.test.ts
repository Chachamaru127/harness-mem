import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HARNESS_MEM_SCRIPT_PATH = join(ROOT, "scripts", "harness-mem");

describe("doctor auth header contract", () => {
  test("tokenless lease/signal probes do not expand an empty auth header array under nounset", () => {
    const script = readFileSync(HARNESS_MEM_SCRIPT_PATH, "utf8");

    expect(script).not.toMatch(/^\s*"\$\{_auth_hdr\[@\]\}"\s*\\/m);
    expect(script.match(/\$\{_auth_hdr\[@\]\+"/g)?.length ?? 0).toBe(3);
  });
});
