/**
 * memory-session-start-contract.test.ts
 *
 * CMC-001/002:
 * - resume-pack failure should clean stale resume context artifacts
 * - memory-resume-error.md should include cause/impact/next command guidance
 * - harness-mem-client fallback should expose machine-readable error_code
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SESSION_START_SCRIPT = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/memory-session-start.sh"
);
const CLIENT_SCRIPT = resolve(import.meta.dir, "../scripts/harness-mem-client.sh");

describe("memory-session-start contract", () => {
  test("harness-mem-client fallback defines machine-readable resume-pack error_code", () => {
    const script = readFileSync(CLIENT_SCRIPT, "utf8");
    expect(script).toContain('"error_code":"%s"');
    expect(script).toContain('resume-pack) printf \'resume_pack_failed\'');
    expect(script).toContain('fallback_error "resume-pack" "resume-pack failed"');
  });

  test("resume-pack failure removes stale artifacts and writes recovery note", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-session-start-"));
    const stateDir = join(tmp, ".claude", "state");
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const copiedSessionStart = join(hookDir, "memory-session-start.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");

    try {
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(copiedSessionStart, readFileSync(SESSION_START_SCRIPT, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
if [ "$command" = "resume-pack" ]; then
  printf '{"ok":false,"error":"resume-pack failed","error_code":"resume_pack_failed","meta":{"count":0},"items":[]}\n'
  exit 0
fi
printf '{"ok":true,"meta":{"count":0},"items":[]}\n'
`
      );
      chmodSync(mockClient, 0o755);

      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "memory-resume-context.md"), "stale resume context");
      writeFileSync(join(stateDir, "memory-resume-pack.json"), '{"ok":true}');
      writeFileSync(join(stateDir, ".memory-resume-pending"), "1");

      const proc = Bun.spawn(["bash", copiedSessionStart], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      await proc.exited;

      expect(existsSync(join(stateDir, "memory-resume-context.md"))).toBe(false);
      expect(existsSync(join(stateDir, "memory-resume-pack.json"))).toBe(false);
      expect(existsSync(join(stateDir, ".memory-resume-pending"))).toBe(false);

      const errorPath = join(stateDir, "memory-resume-error.md");
      expect(existsSync(errorPath)).toBe(true);
      const errorText = readFileSync(errorPath, "utf8");
      expect(errorText).toContain("原因");
      expect(errorText).toContain("影響");
      expect(errorText).toContain("次コマンド");
      expect(errorText).toContain("resume_pack_failed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
