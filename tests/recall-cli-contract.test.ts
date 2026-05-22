import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../scripts/harness-mem");
const HARNESS_MEM_SOURCE = readFileSync(SCRIPT, "utf8");

async function runHarnessMem(args: string[], home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: home,
      HARNESS_MEM_HOME: join(home, ".harness-mem"),
    },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("recall CLI contract", () => {
  test("recall on/status/off persists mode in config.json", async () => {
    const home = mkdtempSync(join(tmpdir(), "hmem-recall-cli-"));
    try {
      let result = await runHarnessMem(["recall", "status"], home);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("quiet");

      result = await runHarnessMem(["recall", "on"], home);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("on");

      result = await runHarnessMem(["recall", "status"], home);
      expect(result.stdout).toContain("on");

      result = await runHarnessMem(["recall", "off"], home);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("off");

      const config = JSON.parse(readFileSync(join(home, ".harness-mem", "config.json"), "utf8")) as {
        recall?: { mode?: string };
      };
      expect(config.recall?.mode).toBe("off");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("recall explain exposes compact /v1/recall explanation contract", () => {
    expect(HARNESS_MEM_SOURCE).toContain("recall explain");
    expect(HARNESS_MEM_SOURCE).toContain("/v1/recall");
    expect(HARNESS_MEM_SOURCE).toContain("explanation");
    expect(HARNESS_MEM_SOURCE).toContain("without memory body text");
    expect(HARNESS_MEM_SOURCE).not.toContain("content_redacted,");
  });
});
