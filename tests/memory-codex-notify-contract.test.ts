import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NOTIFY_SCRIPT = resolve(import.meta.dir, "../scripts/hook-handlers/memory-codex-notify.sh");

describe("memory-codex-notify contract", () => {
  test("backfills assistant content and prompt from rollout file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-codex-notify-"));
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const copiedNotify = join(hookDir, "memory-codex-notify.sh");
    const mockClient = join(scriptRoot, "harness-mem-client.sh");
    const eventsLog = join(tmp, "recorded-events.jsonl");
    const fakeHome = join(tmp, "home");

    try {
      mkdirSync(hookDir, { recursive: true });
      mkdirSync(fakeHome, { recursive: true });
      writeFileSync(copiedNotify, readFileSync(NOTIFY_SCRIPT, "utf8"));
      writeFileSync(
        mockClient,
        `#!/bin/bash
set -euo pipefail
command="\${1:-}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(eventsLog)}
printf '{"ok":true,"items":[],"meta":{"count":0}}\\n'
`
      );
      chmodSync(mockClient, 0o755);

      const rolloutDir = join(fakeHome, ".codex", "sessions", "2026", "03", "07");
      mkdirSync(rolloutDir, { recursive: true });
      const threadId = "thread-123";
      const rolloutPath = join(rolloutDir, `rollout-2026-03-07T10-00-00-${threadId}.jsonl`);
      writeFileSync(
        rolloutPath,
        [
          JSON.stringify({
            timestamp: "2026-03-07T10:00:00.000Z",
            type: "session_meta",
            payload: {
              id: threadId,
              cwd: "/tmp/project-x",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-07T10:00:01.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "この返答を覚えておいて" }],
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-07T10:00:02.000Z",
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "はい、この prompt に対する回答として記録します。",
            },
          }),
        ].join("\n") + "\n",
        "utf8"
      );

      const proc = Bun.spawn(
        [
          "bash",
          copiedNotify,
          JSON.stringify({
            type: "agent-turn-complete",
            thread_id: threadId,
            turn_id: "turn-9",
          }),
        ],
        {
          cwd: tmp,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            HOME: fakeHome,
          },
        }
      );
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const lines = readFileSync(eventsLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(lines.length).toBe(2);

      const events = lines.map((line) => {
        const [command, rawPayload] = line.split("\t", 2);
        return {
          command,
          payload: JSON.parse(rawPayload) as {
            event: {
              event_type: string;
              payload: Record<string, string>;
            };
          },
        };
      });

      const checkpoint = events.find((entry) => entry.payload.event.event_type === "checkpoint");
      const userPrompt = events.find((entry) => entry.payload.event.event_type === "user_prompt");

      expect(checkpoint?.command).toBe("record-event");
      expect(checkpoint?.payload.event.payload.title).toBe("assistant_response");
      expect(checkpoint?.payload.event.payload.content).toBe(
        "はい、この prompt に対する回答として記録します。"
      );
      expect(checkpoint?.payload.event.payload.last_assistant_message).toBe(
        "はい、この prompt に対する回答として記録します。"
      );
      expect(checkpoint?.payload.event.payload.prompt).toBe("この返答を覚えておいて");
      expect(checkpoint?.payload.event.payload.turn_id).toBe("turn-9");

      expect(userPrompt?.command).toBe("record-event");
      expect(userPrompt?.payload.event.payload.prompt).toBe("この返答を覚えておいて");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
