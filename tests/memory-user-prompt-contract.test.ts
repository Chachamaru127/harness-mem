import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLAUDE_USER_PROMPT = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/memory-user-prompt.sh"
);
const CODEX_USER_PROMPT = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/codex-user-prompt.sh"
);
const HOOK_COMMON_LIB = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/lib/hook-common.sh"
);

type PromptHookRun = Array<{ command: string; payload: Record<string, unknown> }>;

async function runUserPromptHook(
  client: "claude" | "codex",
  prompt: string,
  correlationId = "corr-explicit"
): Promise<PromptHookRun> {
  const tmp = mkdtempSync(join(tmpdir(), `harness-mem-user-prompt-${client}-`));
  const projectDir = join(tmp, `${client}-user-prompt-project`);
  const scriptRoot = join(projectDir, "scripts");
  const hookDir = join(scriptRoot, "hook-handlers");
  const libDir = join(hookDir, "lib");
  const mockClient = join(scriptRoot, "harness-mem-client.sh");
  const payloadLog = join(projectDir, `${client}-payloads.jsonl`);
  const scriptPath =
    client === "claude"
      ? join(hookDir, "memory-user-prompt.sh")
      : join(hookDir, "codex-user-prompt.sh");

  try {
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      scriptPath,
      readFileSync(client === "claude" ? CLAUDE_USER_PROMPT : CODEX_USER_PROMPT, "utf8")
    );
    writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
    writeFileSync(
      mockClient,
      `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
`
    );
    chmodSync(mockClient, 0o755);

    const inputPath = join(projectDir, `${client}-user-prompt-input.json`);
    writeFileSync(
      inputPath,
      JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        source: "contract-test",
        ts: "2026-03-25T12:00:00Z",
        session_id: `${client}-session`,
        correlation_id: correlationId,
        prompt,
        privacy_tags: [],
      })
    );

    const proc = Bun.spawn(["bash", scriptPath], {
      cwd: projectDir,
      stdin: Bun.file(inputPath),
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const payloads = readFileSync(payloadLog, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [command, rawPayload] = line.split("\t", 2);
        return { command, payload: rawPayload ? JSON.parse(rawPayload) : {} };
      });

    return payloads;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("memory-user-prompt contract", () => {
  test("explicit handoff prompt emits pinned continuity checkpoint for Claude and Codex", async () => {
    const explicitPrompt = [
      "ツールを使わず、次の handoff を次回セッション用に受け取ってください。返答は saved のみ。",
      "",
      "問題:",
      "- 新しいセッションを開くと、前に何を話していたかが途切れやすい",
      "",
      "決定:",
      "- continuity briefing を最初のターンで必ず見せる",
      "- Claude と Codex で同じ品質にする",
      "",
      "次アクション:",
      "- adapter delivery を両方で揃える",
      "- OpenAPI や DB index の話は今回の本筋ではない",
    ].join("\n");

    for (const client of ["claude", "codex"] as const) {
      const payloads = await runUserPromptHook(client, explicitPrompt);
      const eventPayloads = payloads.filter((entry) => entry.command === "record-event");
      expect(eventPayloads).toHaveLength(2);

      const firstEvent = eventPayloads[0].payload.event as Record<string, unknown>;
      expect(firstEvent.event_type).toBe("user_prompt");
      expect(firstEvent.correlation_id).toBe("corr-explicit");
      expect((firstEvent.tags as string[])).toContain("visibility_suppressed");

      const pinnedEvent = eventPayloads[1].payload.event as Record<string, unknown>;
      const pinnedPayload = pinnedEvent.payload as Record<string, unknown>;
      expect(pinnedEvent.event_type).toBe("checkpoint");
      expect(pinnedEvent.correlation_id).toBe("corr-explicit");
      expect(pinnedPayload.title).toBe("continuity_handoff");
      expect(String(pinnedPayload.content)).toContain("Problem:");
      expect(String(pinnedPayload.content)).toContain("Decision:");
      expect(String(pinnedPayload.content)).toContain("Next Action:");
      expect(String(pinnedPayload.content)).toContain("adapter delivery を両方で揃える");
      expect(String(pinnedPayload.content)).not.toContain("返答は saved のみ");
      expect((pinnedEvent.tags as string[])).toContain("continuity_handoff");
      expect((pinnedEvent.tags as string[])).not.toContain("visibility_suppressed");
    }
  });

  test("plain prompt does not emit pinned continuity checkpoint", async () => {
    for (const client of ["claude", "codex"] as const) {
      const payloads = await runUserPromptHook(client, "セッション継続性の現状を確認したい");
      const eventPayloads = payloads.filter((entry) => entry.command === "record-event");
      expect(eventPayloads).toHaveLength(1);
      const onlyEvent = eventPayloads[0].payload.event as Record<string, unknown>;
      expect(onlyEvent.event_type).toBe("user_prompt");
    }
  });
});
