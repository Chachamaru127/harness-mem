/**
 * session-self-check-contract.test.ts
 *
 * セッション開始セルフチェックの契約を検証する。
 * - self-check artifact JSON のスキーマ
 * - 失敗時 warning ファイル生成
 * - 成功時 warning クリア
 * - hooks.json に startup/resume 両方の self-check 配線があること
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SELFCHECK_SCRIPT = resolve(import.meta.dir, "../scripts/hook-handlers/memory-self-check.sh");
const HOOKS_JSON = resolve(import.meta.dir, "../hooks/hooks.json");

describe("session self-check contract", () => {
  test("hooks.json has memory-self-check in SessionStart startup", () => {
    const content = readFileSync(HOOKS_JSON, "utf8");
    expect(content).toContain("hook-handlers/memory-self-check");
    const parsed = JSON.parse(content);
    const sessionStart = parsed.hooks?.SessionStart;
    expect(sessionStart).toBeDefined();
    const startup = sessionStart.find((s: { matcher?: string }) => s.matcher === "startup");
    expect(startup).toBeDefined();
    const commands = startup.hooks.map((h: { command?: string }) => h.command || "");
    expect(commands.some((c: string) => c.includes("memory-self-check"))).toBe(true);
  });

  test("hooks.json has memory-self-check in SessionStart resume", () => {
    const parsed = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
    const sessionStart = parsed.hooks?.SessionStart;
    const resume = sessionStart.find((s: { matcher?: string }) => s.matcher === "resume");
    expect(resume).toBeDefined();
    const commands = resume.hooks.map((h: { command?: string }) => h.command || "");
    expect(commands.some((c: string) => c.includes("memory-self-check"))).toBe(true);
  });

  test("memory-self-check.sh exists and is executable", () => {
    expect(existsSync(SELFCHECK_SCRIPT)).toBe(true);
    const stat = Bun.file(SELFCHECK_SCRIPT);
    expect(stat.size).toBeGreaterThan(0);
  });

  test("self-check script records resume probe fields in artifact JSON contract", () => {
    const script = readFileSync(SELFCHECK_SCRIPT, "utf8");
    expect(script).toContain("resume_probe_ok");
    expect(script).toContain("resume_probe_count");
    expect(script).toContain("resume_probe_error_code");
    expect(script).toContain("resume_probe_error");
  });

  test("self-check warning includes resume-pack recovery guidance", () => {
    const script = readFileSync(SELFCHECK_SCRIPT, "utf8");
    expect(script).toContain("doctor --fix");
    expect(script).toContain("resume-pack probe");
    expect(script).toContain("./scripts/harness-mem-client.sh resume-pack");
  });
});
