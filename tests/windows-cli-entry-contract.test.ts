import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PACKAGE_JSON = resolve(ROOT, "package.json");
const HARNESS_MEM_WRAPPER = resolve(ROOT, "scripts/harness-mem.js");

describe("windows CLI entry contract", () => {
  test("package bin entries point at node launchers instead of raw bash scripts", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      bin: Record<string, string>;
    };

    expect(pkg.bin["harness-mem"]).toBe("scripts/harness-mem.js");
    expect(pkg.bin["harness-memd"]).toBe("scripts/harness-memd.js");
    expect(pkg.bin["harness-mem-client"]).toBe("scripts/harness-mem-client.js");
  });

  test("native Windows receives an actionable error instead of a /bin/bash shim failure", async () => {
    const proc = Bun.spawn(["node", HARNESS_MEM_WRAPPER, "setup"], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HARNESS_MEM_FORCE_PLATFORM: "win32",
      },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(1);
    expect(stdout.trim()).toBe("");
    expect(stderr).toContain("does not support native Windows PowerShell / CMD yet");
    expect(stderr).toContain("Recommended path: run harness-mem inside WSL2");
  });
});
