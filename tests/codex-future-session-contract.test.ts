import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CODEX_SESSION_START = resolve(import.meta.dir, "../scripts/hook-handlers/codex-session-start.sh");
const CODEX_USER_PROMPT = resolve(import.meta.dir, "../scripts/hook-handlers/codex-user-prompt.sh");
const CODEX_SESSION_STOP = resolve(import.meta.dir, "../scripts/hook-handlers/codex-session-stop.sh");
const HOOK_COMMON_LIB = resolve(import.meta.dir, "../scripts/hook-handlers/lib/hook-common.sh");

type HookLogEntry = { command: string; payload: Record<string, unknown> };

function parsePayloadLog(payloadLog: string): HookLogEntry[] {
  return readFileSync(payloadLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [command, rawPayload] = line.split("\t", 2);
      return { command, payload: rawPayload ? JSON.parse(rawPayload) : {} };
    });
}

function setupCodexSandbox(prefix: string): {
  tmp: string;
  projectDir: string;
  scriptRoot: string;
  hookDir: string;
  libDir: string;
  payloadLog: string;
  mockClient: string;
} {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  const projectDir = join(tmp, "codex-future-session-project");
  const scriptRoot = join(projectDir, "scripts");
  const hookDir = join(scriptRoot, "hook-handlers");
  const libDir = join(hookDir, "lib");
  const payloadLog = join(projectDir, "codex-future-session-payloads.jsonl");
  const mockClient = join(scriptRoot, "harness-mem-client.sh");
  mkdirSync(libDir, { recursive: true });

  return { tmp, projectDir, scriptRoot, hookDir, libDir, payloadLog, mockClient };
}

function writeMockClient(mockClient: string, payloadLog: string): void {
  writeFileSync(
    mockClient,
    `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
case "$command" in
  health)
    printf '%s\\n' '{"ok":true}'
    ;;
  resume-pack|search)
    printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
    ;;
  finalize-session|record-event)
    printf '%s\\n' '{"ok":true,"items":[{"session_id":"thread-stop-1","finalized_at":"2026-04-25T12:00:00Z"}],"meta":{"count":1}}'
    ;;
  *)
    printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
    ;;
esac
`
  );
  chmodSync(mockClient, 0o755);
}

describe("codex future-session contract", () => {
  test("SessionStart preserves additive thread/environment fields in event meta while keeping attribution stable", async () => {
    const sandbox = setupCodexSandbox("hmem-codex-future-start-");

    try {
      writeFileSync(join(sandbox.hookDir, "codex-session-start.sh"), readFileSync(CODEX_SESSION_START, "utf8"));
      writeFileSync(join(sandbox.libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeMockClient(sandbox.mockClient, sandbox.payloadLog);

      const input = {
        hook_event_name: "SessionStart",
        source: "codex-future-contract",
        ts: "2026-04-25T12:00:00Z",
        thread_id: "thread-start-1",
        correlation_id: "corr-start-1",
        turn_id: "turn-start-1",
        environment: { id: "env-prod-1", name: "prod" },
        active_environment: { id: "env-prod-1", name: "prod" },
        permission_mode: "on-request",
        permissionProfile: { id: "profile-trusted-write", name: "trusted-write" },
        activeProfile: { id: "profile-trusted-write", name: "trusted-write" },
        sandbox_profile: "workspace-write",
        cwd: sandbox.projectDir,
        modelProvider: "openai",
        threadStore: { provider: "remote-sqlite" },
        appServer: { transport: "unix-socket" },
        remote_thread_store: { provider: "example" },
      };

      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-session-start.sh")], {
        cwd: sandbox.projectDir,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(`${JSON.stringify(input)}\n`);
      proc.stdin.end();

      expect(await proc.exited).toBe(0);

      const payloads = parsePayloadLog(sandbox.payloadLog);
      const recordEvent = payloads.find((entry) => entry.command === "record-event")?.payload as {
        event?: {
          session_id?: string;
          correlation_id?: string;
          payload?: {
            source?: string;
            meta?: Record<string, unknown>;
          };
        };
      };
      const resumePack = payloads.find((entry) => entry.command === "resume-pack")?.payload as {
        session_id?: string;
        correlation_id?: string;
      };

      expect(recordEvent.event?.session_id).toBe("thread-start-1");
      expect(recordEvent.event?.correlation_id).toBe("corr-start-1");
      expect(recordEvent.event?.payload?.source).toBe("codex_hooks_engine");
      expect(recordEvent.event?.payload?.meta?.thread_id).toBe("thread-start-1");
      expect(recordEvent.event?.payload?.meta?.turn_id).toBe("turn-start-1");
      expect(recordEvent.event?.payload?.meta?.environment_id).toBe("env-prod-1");
      expect(recordEvent.event?.payload?.meta?.environment_name).toBe("prod");
      expect(recordEvent.event?.payload?.meta?.permission_mode).toBe("on-request");
      expect(recordEvent.event?.payload?.meta?.permission_profile).toBe("trusted-write");
      expect(recordEvent.event?.payload?.meta?.permission_profile_id).toBe("profile-trusted-write");
      expect(recordEvent.event?.payload?.meta?.active_profile).toBe("trusted-write");
      expect(recordEvent.event?.payload?.meta?.active_profile_id).toBe("profile-trusted-write");
      expect(recordEvent.event?.payload?.meta?.sandbox_profile).toBe("workspace-write");
      expect(recordEvent.event?.payload?.meta?.cwd).toBe(sandbox.projectDir);
      expect(recordEvent.event?.payload?.meta?.model_provider).toBe("openai");
      expect(recordEvent.event?.payload?.meta?.thread_store).toBe("remote-sqlite");
      expect(recordEvent.event?.payload?.meta?.app_server_transport).toBe("unix-socket");
      expect(resumePack.session_id).toBe("thread-start-1");
      expect(resumePack.correlation_id).toBe("corr-start-1");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("UserPromptSubmit preserves additive thread/environment fields and meta correlation_id", async () => {
    const sandbox = setupCodexSandbox("hmem-codex-future-prompt-");

    try {
      writeFileSync(join(sandbox.hookDir, "codex-user-prompt.sh"), readFileSync(CODEX_USER_PROMPT, "utf8"));
      writeFileSync(join(sandbox.libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeMockClient(sandbox.mockClient, sandbox.payloadLog);

      const input = {
        hook_event_name: "UserPromptSubmit",
        source: "codex-future-contract",
        ts: "2026-04-25T12:05:00Z",
        thread_id: "thread-prompt-1",
        meta: { correlation_id: "corr-prompt-1" },
        prompt: "現在の進捗を確認したい",
        privacy_tags: [],
        turn_id: "turn-prompt-1",
        environment_id: "env-stage-1",
        active_environment: { name: "staging" },
        permission_mode: "never",
        permission_profile: { id: "profile-read-only", name: "read-only" },
        sandbox: { profile: "danger-full-access" },
        goal: { id: "goal-continue-release", status: "paused" },
        externalAgent: { name: "claude-code" },
        importedSession: { id: "external-session-42" },
      };

      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-user-prompt.sh")], {
        cwd: sandbox.projectDir,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(`${JSON.stringify(input)}\n`);
      proc.stdin.end();

      expect(await proc.exited).toBe(0);

      const payloads = parsePayloadLog(sandbox.payloadLog);
      const recordEvent = payloads.find((entry) => entry.command === "record-event")?.payload as {
        event?: {
          session_id?: string;
          correlation_id?: string;
          payload?: {
            prompt?: string;
            meta?: Record<string, unknown>;
          };
        };
      };

      expect(recordEvent.event?.session_id).toBe("thread-prompt-1");
      expect(recordEvent.event?.correlation_id).toBe("corr-prompt-1");
      expect(recordEvent.event?.payload?.prompt).toBe("現在の進捗を確認したい");
      expect(recordEvent.event?.payload?.meta?.thread_id).toBe("thread-prompt-1");
      expect(recordEvent.event?.payload?.meta?.turn_id).toBe("turn-prompt-1");
      expect(recordEvent.event?.payload?.meta?.environment_id).toBe("env-stage-1");
      expect(recordEvent.event?.payload?.meta?.environment_name).toBe("staging");
      expect(recordEvent.event?.payload?.meta?.permission_mode).toBe("never");
      expect(recordEvent.event?.payload?.meta?.permission_profile).toBe("read-only");
      expect(recordEvent.event?.payload?.meta?.permission_profile_id).toBe("profile-read-only");
      expect(recordEvent.event?.payload?.meta?.sandbox_profile).toBe("danger-full-access");
      expect(recordEvent.event?.payload?.meta?.goal_id).toBe("goal-continue-release");
      expect(recordEvent.event?.payload?.meta?.goal_status).toBe("paused");
      expect(recordEvent.event?.payload?.meta?.external_agent).toBe("claude-code");
      expect(recordEvent.event?.payload?.meta?.external_session_id).toBe("external-session-42");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("SessionStart preserves Codex 0.130.0 safe additive metadata without credential fields", async () => {
    const sandbox = setupCodexSandbox("hmem-codex-0130-start-");

    try {
      writeFileSync(join(sandbox.hookDir, "codex-session-start.sh"), readFileSync(CODEX_SESSION_START, "utf8"));
      writeFileSync(join(sandbox.libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeMockClient(sandbox.mockClient, sandbox.payloadLog);

      const input = {
        hook_event_name: "SessionStart",
        source: "codex-future-contract",
        ts: "2026-05-10T09:00:00Z",
        thread_id: "thread-0130-1",
        correlation_id: "corr-0130-1",
        sessionSource: "remote-control",
        remote_control: false,
        remoteControl: { token: "REMOTE_CONTROL_TOKEN_SHOULD_NOT_PERSIST" },
        items_view: { token: "ITEMS_VIEW_TOKEN_SHOULD_NOT_PERSIST" },
        itemsView: "summary",
        selected_environment_id: "env-selected-0130",
        bedrockAuth: {
          method: "aws-login-profile",
          accessKeyId: "AKIA0123456789SECRET",
          secretAccessKey: "BEDROCK_SECRET_SHOULD_NOT_PERSIST",
        },
        applyPatch: {
          status: "applied",
          patch: "PATCH_BODY_SHOULD_NOT_PERSIST",
        },
        turn_diff_status: "accurate",
        turnDiff: {
          status: "stale",
          raw: "TURN_DIFF_RAW_SHOULD_NOT_PERSIST",
        },
      };

      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-session-start.sh")], {
        cwd: sandbox.projectDir,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(`${JSON.stringify(input)}\n`);
      proc.stdin.end();

      expect(await proc.exited).toBe(0);

      const payloads = parsePayloadLog(sandbox.payloadLog);
      const recordEvent = payloads.find((entry) => entry.command === "record-event")?.payload as {
        event?: {
          session_id?: string;
          payload?: {
            meta?: Record<string, unknown>;
          };
        };
      };
      const meta = recordEvent.event?.payload?.meta ?? {};

      expect(recordEvent.event?.session_id).toBe("thread-0130-1");
      expect(meta.session_source).toBe("remote-control");
      expect(meta.remote_control).toBe("false");
      expect(meta.items_view).toBe("summary");
      expect(meta.selected_environment_id).toBe("env-selected-0130");
      expect(meta.bedrock_auth_method).toBe("aws-login-profile");
      expect(meta.apply_patch_status).toBe("applied");
      expect(meta.turn_diff_status).toBe("accurate");

      for (const key of [
        "session_source",
        "remote_control",
        "items_view",
        "selected_environment_id",
        "bedrock_auth_method",
        "apply_patch_status",
        "turn_diff_status",
      ]) {
        expect(typeof meta[key]).toBe("string");
      }

      const serializedMeta = JSON.stringify(meta);
      expect(serializedMeta).not.toContain("REMOTE_CONTROL_TOKEN_SHOULD_NOT_PERSIST");
      expect(serializedMeta).not.toContain("ITEMS_VIEW_TOKEN_SHOULD_NOT_PERSIST");
      expect(serializedMeta).not.toContain("AKIA0123456789SECRET");
      expect(serializedMeta).not.toContain("BEDROCK_SECRET_SHOULD_NOT_PERSIST");
      expect(serializedMeta).not.toContain("PATCH_BODY_SHOULD_NOT_PERSIST");
      expect(serializedMeta).not.toContain("TURN_DIFF_RAW_SHOULD_NOT_PERSIST");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("Stop finalizes from thread_id and meta correlation_id even with additive future fields present", async () => {
    const sandbox = setupCodexSandbox("hmem-codex-future-stop-");

    try {
      writeFileSync(join(sandbox.hookDir, "codex-session-stop.sh"), readFileSync(CODEX_SESSION_STOP, "utf8"));
      writeFileSync(join(sandbox.libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
      writeMockClient(sandbox.mockClient, sandbox.payloadLog);

      const input = {
        hook_event_name: "Stop",
        source: "codex-future-contract",
        ts: "2026-04-25T12:10:00Z",
        thread_id: "thread-stop-1",
        meta: { correlation_id: "corr-stop-1" },
        environment: { id: "env-dev-1", name: "dev" },
        active_environment: { name: "dev" },
        permission_mode: "on-request",
        externalAgent: { name: "claude-code" },
        importedSession: { id: "external-session-42" },
        remote_thread_store: { provider: "example" },
      };

      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-session-stop.sh")], {
        cwd: sandbox.projectDir,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(`${JSON.stringify(input)}\n`);
      proc.stdin.end();

      expect(await proc.exited).toBe(0);

      const payloads = parsePayloadLog(sandbox.payloadLog);
      const finalizePayload = payloads.find((entry) => entry.command === "finalize-session")?.payload as {
        session_id?: string;
        correlation_id?: string;
        summary_mode?: string;
      };

      expect(finalizePayload.session_id).toBe("thread-stop-1");
      expect(finalizePayload.correlation_id).toBe("corr-stop-1");
      expect(finalizePayload.summary_mode).toBe("standard");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });
});
