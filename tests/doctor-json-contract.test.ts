/**
 * doctor-json-contract.test.ts
 *
 * T-1: `doctor --json` の出力が JSON schema contract を満たすことを検証する。
 * - stdout が純粋な JSON 1 オブジェクトのみであること（余計なテキスト混入なし）
 * - 必須フィールド: status, all_green, failed_count, checked_count, timestamp, checks, fix_command
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../scripts/harness-mem");

async function runDoctorJson(): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bash", SCRIPT, "doctor", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HARNESS_MEM_DB: ":memory:" },
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, code };
}

describe("doctor --json contract", () => {
  test("stdout is pure JSON with no extra text", async () => {
    const { stdout, stderr, code } = await runDoctorJson();

    // stdout が空でないこと
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(code).toBe(0);

    // JSON として parse できること（余計なテキストが混入していない）
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      throw new Error(
        `doctor --json stdout is not valid JSON.\nstdout:\n${stdout}\nstderr:\n${stderr}`
      );
    }

    // 純粋な JSON オブジェクトであること（配列や scalar ではない）
    expect(typeof parsed).toBe("object");
    expect(Array.isArray(parsed)).toBe(false);
  }, 60_000);

  test("all_green field is boolean", async () => {
    const { stdout, code } = await runDoctorJson();
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(typeof parsed.all_green).toBe("boolean");
  }, 60_000);

  test("required fields have correct types", async () => {
    const { stdout, code } = await runDoctorJson();
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);

    expect(parsed.schema_version).toBe("doctor.v2");

    // status: string ("healthy" | "unhealthy")
    expect(typeof parsed.status).toBe("string");
    expect(["healthy", "unhealthy"]).toContain(parsed.status);
    expect(typeof parsed.overall_status).toBe("string");
    expect(["healthy", "degraded", "broken"]).toContain(parsed.overall_status);

    // all_green: boolean
    expect(typeof parsed.all_green).toBe("boolean");

    // failed_count: number (>= 0)
    expect(typeof parsed.failed_count).toBe("number");
    expect(parsed.failed_count).toBeGreaterThanOrEqual(0);

    // checked_count: number (>= 0)
    expect(typeof parsed.checked_count).toBe("number");
    expect(parsed.checked_count).toBeGreaterThanOrEqual(0);

    // timestamp: ISO8601 string
    expect(typeof parsed.timestamp).toBe("string");
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // checks: array
    expect(Array.isArray(parsed.checks)).toBe(true);

    // fix_command: string
    expect(typeof parsed.fix_command).toBe("string");

    // backend_mode: string (local | managed | hybrid)
    expect(typeof parsed.backend_mode).toBe("string");
    expect(["local", "managed", "hybrid"]).toContain(parsed.backend_mode);
  }, 60_000);

  test("all_green matches failed_count == 0", async () => {
    const { stdout, code } = await runDoctorJson();
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);

    // all_green は failed_count == 0 と一致すること
    expect(parsed.all_green).toBe(parsed.failed_count === 0);
  }, 60_000);

  test("checks array items have name and status fields", async () => {
    const { stdout, code } = await runDoctorJson();
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);

    for (const check of parsed.checks) {
      expect(typeof check.name).toBe("string");
      expect(typeof check.status).toBe("string");
      expect(["pass", "warn", "fail", "skip"]).toContain(check.result);
      expect(typeof check.reason_code).toBe("string");
      // fix は null | string
      expect(check.fix === null || typeof check.fix === "string").toBe(true);
    }
  }, 60_000);

  test("reachable-with-warnings remains a warning in doctor.v2 JSON classification", () => {
    const script = readFileSync(SCRIPT, "utf8");
    const statusFn = script.match(/_doctor_status_result\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(statusFn.indexOf("ok:reachable_with_warnings")).toBeGreaterThanOrEqual(0);
    expect(statusFn.indexOf("ok:reachable_with_warnings")).toBeLessThan(statusFn.indexOf("ok|ok:*"));
  });

  test("strict-exit returns non-zero for JSON doctor failures", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-doctor-strict-"));
    try {
      const proc = Bun.spawn(["bash", SCRIPT, "doctor", "--json", "--read-only", "--strict-exit", "--platform", "codex", "--skip-version-check"], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: join(tmpHome, ".harness-mem"),
          HARNESS_MEM_NON_INTERACTIVE: "1",
        },
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      expect(proc.exitCode).not.toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.schema_version).toBe("doctor.v2");
      expect(parsed.all_green).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);
});
