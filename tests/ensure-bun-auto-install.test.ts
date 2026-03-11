/**
 * ensure-bun-auto-install.test.ts
 *
 * ensure_bun() 自動インストール関数の契約テスト:
 * - ensure_bun() 関数が scripts/harness-mem に存在する
 * - ensure_dependencies() が ensure_bun を呼んでいる (require_cmd bun ではない)
 * - ensure_bun() が curl -fsSL https://bun.sh/install | bash を使う
 * - PATH フォールバック ($HOME/.bun/bin) が含まれている
 * - macOS 以外のプラットフォームで適切なエラーメッセージを出す
 * - bun が既にある場合は即座に return 0 する
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HARNESS_MEM_SCRIPT = resolve(import.meta.dir, "../scripts/harness-mem");

describe("ensure_bun auto-install contract", () => {
  const script = readFileSync(HARNESS_MEM_SCRIPT, "utf8");

  test("ensure_bun() function is defined", () => {
    expect(script).toContain("ensure_bun()");
  });

  test("ensure_dependencies calls ensure_bun instead of require_cmd bun", () => {
    // ensure_dependencies 内で ensure_bun が呼ばれている
    const depBlock = script.match(/ensure_dependencies\(\)\s*\{[\s\S]*?\n\}/);
    expect(depBlock).toBeTruthy();
    const block = depBlock![0];
    expect(block).toContain("ensure_bun");
    expect(block).not.toContain("require_cmd bun");
  });

  test("ensure_bun uses official bun installer URL", () => {
    expect(script).toContain("https://bun.sh/install");
  });

  test("ensure_bun includes PATH fallback for ~/.bun/bin", () => {
    expect(script).toContain('$HOME/.bun/bin');
  });

  test("ensure_bun handles non-macOS platforms with clear error message", () => {
    // uname -s の case 文で Darwin 以外のケースがある
    const bunFunc = script.match(/ensure_bun\(\)\s*\{[\s\S]*?\n\}/);
    expect(bunFunc).toBeTruthy();
    const func = bunFunc![0];
    expect(func).toContain("Darwin");
    expect(func).toContain("https://bun.sh/docs/installation");
  });

  test("ensure_bun returns 0 immediately when bun is present", () => {
    const bunFunc = script.match(/ensure_bun\(\)\s*\{[\s\S]*?\n\}/);
    expect(bunFunc).toBeTruthy();
    const func = bunFunc![0];
    // check_cmd bun が最初にチェックされ、成功なら return 0
    const lines = func.split("\n");
    const checkIdx = lines.findIndex((l: string) => l.includes("check_cmd bun"));
    const returnIdx = lines.findIndex((l: string, i: number) => i > checkIdx && l.trim() === "return 0");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(checkIdx);
    // return 0 は check_cmd bun の直後にあるべき
    expect(returnIdx - checkIdx).toBeLessThanOrEqual(2);
  });

  test("ensure_bun runs hash -r after install to refresh command cache", () => {
    const bunFunc = script.match(/ensure_bun\(\)\s*\{[\s\S]*?\n\}/);
    expect(bunFunc).toBeTruthy();
    expect(bunFunc![0]).toContain("hash -r");
  });

  test("ensure_bun is placed before ensure_ripgrep in file order", () => {
    const bunPos = script.indexOf("ensure_bun()");
    const rgPos = script.indexOf("ensure_ripgrep()");
    expect(bunPos).toBeGreaterThan(-1);
    expect(rgPos).toBeGreaterThan(-1);
    expect(bunPos).toBeLessThan(rgPos);
  });

  test("ensure_bun when bun is already present exits quickly", async () => {
    // bun コマンドは現環境で確実に利用可能なので、ensure_bun は即座に完了するはず
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-ensure-bun-"));
    const testScript = join(tmp, "test-ensure-bun.sh");
    try {
      writeFileSync(
        testScript,
        `#!/bin/bash
set +e
check_cmd() { command -v "\$1" >/dev/null 2>&1; }
warn() { echo "WARN: \$*" >&2; }
log() { echo "LOG: \$*" >&2; }
fail() { echo "FAIL: \$*" >&2; exit 1; }

${script.match(/ensure_bun\(\)\s*\{[\s\S]*?\n\}/)![0]}

ensure_bun
echo "ENSURE_BUN_OK"
`
      );
      chmodSync(testScript, 0o755);

      const proc = Bun.spawn(["bash", testScript], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("ENSURE_BUN_OK");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
