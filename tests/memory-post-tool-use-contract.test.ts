import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const POST_TOOL_USE_SCRIPT = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/memory-post-tool-use.sh"
);
const HOOK_COMMON_LIB = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/lib/hook-common.sh"
);

function parsePayloadLog(payloadLog: string): Array<{ command: string; payload: Record<string, unknown> }> {
  return readFileSync(payloadLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [command, rawPayload] = line.split("\t", 2);
      return { command, payload: rawPayload ? JSON.parse(rawPayload) : {} };
    });
}

describe("memory-post-tool-use contract", () => {
  test("forwards duration_ms into record-event meta payload", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-post-tool-use-"));
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");
    const copiedHook = join(hookDir, "memory-post-tool-use.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");
    const payloadLog = join(tmp, "post-tool-use-payloads.jsonl");

    try {
      mkdirSync(libDir, { recursive: true });
      writeFileSync(copiedHook, readFileSync(POST_TOOL_USE_SCRIPT, "utf8"));
      writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
printf '%s\\n' '{"ok":true}'
`
      );
      chmodSync(mockClient, 0o755);

      const proc = Bun.spawn(["bash", copiedHook], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      const input = {
        session_id: "claude-session-1",
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/example.txt" },
        hook_event_name: "PostToolUse",
        source: "hook",
        duration_ms: 1234,
      };
      proc.stdin.write(`${JSON.stringify(input)}\n`);
      proc.stdin.end();

      expect(await proc.exited).toBe(0);

      const recordEventPayload = parsePayloadLog(payloadLog).find((entry) => entry.command === "record-event")
        ?.payload as {
        event?: {
          payload?: {
            tool_name?: string;
            meta?: { duration_ms?: number; hook_event?: string };
          };
        };
      };

      expect(recordEventPayload.event?.payload?.tool_name).toBe("Edit");
      expect(recordEventPayload.event?.payload?.meta?.hook_event).toBe("PostToolUse");
      expect(recordEventPayload.event?.payload?.meta?.duration_ms).toBe(1234);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("omits duration_ms when upstream hook payload does not provide a valid number", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-post-tool-use-invalid-"));
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");
    const copiedHook = join(hookDir, "memory-post-tool-use.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");
    const payloadLog = join(tmp, "post-tool-use-invalid-payloads.jsonl");

    try {
      mkdirSync(libDir, { recursive: true });
      writeFileSync(copiedHook, readFileSync(POST_TOOL_USE_SCRIPT, "utf8"));
      writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
printf '%s\\n' '{"ok":true}'
`
      );
      chmodSync(mockClient, 0o755);

      const proc = Bun.spawn(["bash", copiedHook], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      const input = {
        session_id: "claude-session-2",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        duration_ms: "not-a-number",
      };
      proc.stdin.write(`${JSON.stringify(input)}\n`);
      proc.stdin.end();

      expect(await proc.exited).toBe(0);

      const recordEventPayload = parsePayloadLog(payloadLog).find((entry) => entry.command === "record-event")
        ?.payload as {
        event?: {
          payload?: {
            meta?: Record<string, unknown>;
          };
        };
      };

      expect(recordEventPayload.event?.payload?.meta?.duration_ms).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
