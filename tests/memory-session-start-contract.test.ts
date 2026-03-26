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
const HOOK_COMMON_LIB = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/lib/hook-common.sh"
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
    const libDir = join(hookDir, "lib");
    const copiedSessionStart = join(hookDir, "memory-session-start.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");

    try {
      mkdirSync(libDir, { recursive: true });
      writeFileSync(copiedSessionStart, readFileSync(SESSION_START_SCRIPT, "utf8"));
      writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
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

  test("resume-pack success prefers continuity briefing content when available", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-session-start-success-"));
    const stateDir = join(tmp, ".claude", "state");
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");
    const copiedSessionStart = join(hookDir, "memory-session-start.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");

    try {
      mkdirSync(libDir, { recursive: true });
      writeFileSync(copiedSessionStart, readFileSync(SESSION_START_SCRIPT, "utf8"));
      writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
if [ "$command" = "resume-pack" ]; then
  printf '%s\n' '{"ok":true,"meta":{"count":1,"continuity_briefing":{"content":"# Continuity Briefing\\n\\n## Current Focus\\n- Continue from the previous adapter fix"}},"items":[{"id":"session:prev","type":"session_summary","summary":"fallback summary"}]}'
  exit 0
fi
printf '%s\n' '{"ok":true,"meta":{"count":0},"items":[]}'
`
      );
      chmodSync(mockClient, 0o755);

      mkdirSync(stateDir, { recursive: true });

      const proc = Bun.spawn(["bash", copiedSessionStart], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      await proc.exited;

      const resumePath = join(stateDir, "memory-resume-context.md");
      expect(existsSync(resumePath)).toBe(true);
      expect(existsSync(join(stateDir, ".memory-resume-pending"))).toBe(true);

      const resumeText = readFileSync(resumePath, "utf8");
      expect(resumeText).toContain("# Continuity Briefing");
      expect(resumeText).toContain("Continue from the previous adapter fix");
      expect(resumeText).not.toContain("## Memory Resume Pack");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("latest handoff correlation_id is forwarded to session_start and resume-pack", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-session-start-chain-"));
    const stateDir = join(tmp, ".claude", "state");
    const continuityDir = join(tmp, ".harness-mem", "state");
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");
    const copiedSessionStart = join(hookDir, "memory-session-start.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");
    const payloadLog = join(tmp, "session-start-payloads.jsonl");

    try {
      mkdirSync(libDir, { recursive: true });
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(continuityDir, { recursive: true });
      writeFileSync(copiedSessionStart, readFileSync(SESSION_START_SCRIPT, "utf8"));
      writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
if [ "$command" = "resume-pack" ]; then
  printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
  exit 0
fi
printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
`
      );
      chmodSync(mockClient, 0o755);

      writeFileSync(
        join(continuityDir, "continuity.json"),
        JSON.stringify({
          version: 1,
          project: "harness-mem-session-start-chain",
          sessions: {},
          latest_handoff: {
            session_id: "previous-session",
            platform: "claude",
            correlation_id: "corr-handoff",
            summary_mode: "standard",
            finalized_at: "2026-03-24T11:58:00Z",
            consumed_by_session_id: null,
          },
        }, null, 2)
      );

      const proc = Bun.spawn(["bash", copiedSessionStart], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const payloads = readFileSync(payloadLog, "utf8").trim().split("\n").map((line) => {
        const [command, rawPayload] = line.split("\t", 2);
        return { command, payload: rawPayload ? JSON.parse(rawPayload) : {} };
      });

      const recordEventPayload = payloads.find((entry) => entry.command === "record-event")?.payload as {
        event?: { correlation_id?: string; session_id?: string };
      };
      expect(recordEventPayload.event?.correlation_id).toBe("corr-handoff");

      const resumePayload = payloads.find((entry) => entry.command === "resume-pack")?.payload as {
        correlation_id?: string;
      };
      expect(resumePayload.correlation_id).toBe("corr-handoff");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
