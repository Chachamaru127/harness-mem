import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const STOP_SCRIPT = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/memory-stop.sh"
);
const HOOK_COMMON_LIB = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/lib/hook-common.sh"
);

describe("memory-stop contract", () => {
  test("finalize success stores latest handoff in continuity state", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-stop-"));
    const claudeStateDir = join(tmp, ".claude", "state");
    const continuityDir = join(tmp, ".harness-mem", "state");
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");
    const copiedStop = join(hookDir, "memory-stop.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");
    const payloadLog = join(tmp, "finalize-payloads.jsonl");

    try {
      mkdirSync(libDir, { recursive: true });
      mkdirSync(claudeStateDir, { recursive: true });
      mkdirSync(continuityDir, { recursive: true });
      writeFileSync(copiedStop, readFileSync(STOP_SCRIPT, "utf8"));
      writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
printf '%s\\n' '{"ok":true,"items":[{"session_id":"sess-stop","finalized_at":"2026-03-24T12:00:00Z"}],"meta":{"count":1}}'
`
      );
      chmodSync(mockClient, 0o755);

      writeFileSync(
        join(claudeStateDir, "session.json"),
        JSON.stringify({ session_id: "sess-stop" }, null, 2)
      );
      writeFileSync(
        join(continuityDir, "continuity.json"),
        JSON.stringify({
          version: 1,
          project: "harness-mem-stop",
          sessions: {
            "sess-stop": {
              correlation_id: "corr-stop",
              platform: "claude",
              origin: "session_state",
              updated_at: "2026-03-24T11:59:00Z",
            },
          },
          latest_handoff: null,
        }, null, 2)
      );

      const proc = Bun.spawn(["bash", copiedStop], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const continuityPath = join(continuityDir, "continuity.json");
      expect(existsSync(continuityPath)).toBe(true);
      const continuity = JSON.parse(readFileSync(continuityPath, "utf8")) as {
        latest_handoff: { session_id: string; correlation_id: string; consumed_by_session_id: string | null };
      };
      expect(continuity.latest_handoff.session_id).toBe("sess-stop");
      expect(continuity.latest_handoff.correlation_id).toBe("corr-stop");
      expect(continuity.latest_handoff.consumed_by_session_id).toBe(null);

      const payloadLines = readFileSync(payloadLog, "utf8").trim().split("\n");
      expect(payloadLines.length).toBe(1);
      const [, rawPayload] = payloadLines[0].split("\t", 2);
      const payload = JSON.parse(rawPayload) as { correlation_id?: string };
      expect(payload.correlation_id).toBe("corr-stop");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("stop hook persists last assistant message before finalize", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-stop-assistant-"));
    const claudeStateDir = join(tmp, ".claude", "state");
    const continuityDir = join(tmp, ".harness-mem", "state");
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");
    const copiedStop = join(hookDir, "memory-stop.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");
    const payloadLog = join(tmp, "stop-payloads.jsonl");

    try {
      mkdirSync(libDir, { recursive: true });
      mkdirSync(claudeStateDir, { recursive: true });
      mkdirSync(continuityDir, { recursive: true });
      writeFileSync(copiedStop, readFileSync(STOP_SCRIPT, "utf8"));
      writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
printf '%s\\n' '{"ok":true,"items":[{"session_id":"sess-stop","finalized_at":"2026-03-24T12:00:00Z"}],"meta":{"count":1}}'
`
      );
      chmodSync(mockClient, 0o755);

      writeFileSync(join(claudeStateDir, "session.json"), JSON.stringify({ session_id: "sess-stop" }, null, 2));
      writeFileSync(
        join(continuityDir, "continuity.json"),
        JSON.stringify({
          version: 1,
          project: "harness-mem-stop",
          sessions: {
            "sess-stop": {
              correlation_id: "corr-stop",
              platform: "claude",
              origin: "session_state",
              updated_at: "2026-03-24T11:59:00Z",
            },
          },
          latest_handoff: null,
        }, null, 2)
      );

      const proc = Bun.spawn(["bash", copiedStop], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      proc.stdin.write(
        JSON.stringify({
          session_id: "sess-stop",
          hook_event_name: "Stop",
          summary_mode: "standard",
          last_assistant_message:
            "1. 問題: 文脈が途切れる 2. 決定: continuity briefing を必ず見せる 3. 次にやるべきこと: adapter delivery を両方で揃える",
        })
      );
      proc.stdin.end();
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const lines = readFileSync(payloadLog, "utf8").trim().split("\n");
      expect(lines.length).toBe(2);

      const [recordCommand, recordRawPayload] = lines[0].split("\t", 2);
      expect(recordCommand).toBe("record-event");
      const recordPayload = JSON.parse(recordRawPayload) as {
        event: { event_type: string; correlation_id?: string; payload?: { title?: string; content?: string; source?: string } };
      };
      expect(recordPayload.event.event_type).toBe("checkpoint");
      expect(recordPayload.event.correlation_id).toBe("corr-stop");
      expect(recordPayload.event.payload?.title).toBe("assistant_response");
      expect(recordPayload.event.payload?.source).toBe("stop_hook");
      expect(String(recordPayload.event.payload?.content)).toContain("continuity briefing");

      const [finalizeCommand, finalizeRawPayload] = lines[1].split("\t", 2);
      expect(finalizeCommand).toBe("finalize-session");
      const finalizePayload = JSON.parse(finalizeRawPayload) as { correlation_id?: string };
      expect(finalizePayload.correlation_id).toBe("corr-stop");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("visibility-suppressed session tags assistant_response checkpoint", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-stop-suppressed-"));
    const claudeStateDir = join(tmp, ".claude", "state");
    const continuityDir = join(tmp, ".harness-mem", "state");
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");
    const copiedStop = join(hookDir, "memory-stop.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");
    const payloadLog = join(tmp, "stop-suppressed-payloads.jsonl");

    try {
      mkdirSync(libDir, { recursive: true });
      mkdirSync(claudeStateDir, { recursive: true });
      mkdirSync(continuityDir, { recursive: true });
      writeFileSync(copiedStop, readFileSync(STOP_SCRIPT, "utf8"));
      writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
printf '%s\\n' '{"ok":true,"items":[{"session_id":"sess-stop","finalized_at":"2026-03-24T12:00:00Z"}],"meta":{"count":1}}'
`
      );
      chmodSync(mockClient, 0o755);

      writeFileSync(join(claudeStateDir, "session.json"), JSON.stringify({ session_id: "sess-stop" }, null, 2));
      writeFileSync(
        join(continuityDir, "continuity.json"),
        JSON.stringify({
          version: 1,
          project: "harness-mem-stop",
          sessions: {
            "sess-stop": {
              correlation_id: "corr-stop",
              platform: "claude",
              origin: "session_state",
              updated_at: "2026-03-24T11:59:00Z",
              suppress_visibility: true,
            },
          },
          latest_handoff: null,
        }, null, 2)
      );

      const proc = Bun.spawn(["bash", copiedStop], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      proc.stdin.write(
        JSON.stringify({
          session_id: "sess-stop",
          hook_event_name: "Stop",
          summary_mode: "standard",
          last_assistant_message: "saved",
        })
      );
      proc.stdin.end();
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const lines = readFileSync(payloadLog, "utf8").trim().split("\n");
      expect(lines.length).toBe(2);
      const [, recordRawPayload] = lines[0].split("\t", 2);
      const recordPayload = JSON.parse(recordRawPayload) as {
        event: { tags?: string[]; payload?: { content?: string } };
      };
      expect(recordPayload.event.tags).toContain("visibility_suppressed");
      expect(String(recordPayload.event.payload?.content)).toBe("saved");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
