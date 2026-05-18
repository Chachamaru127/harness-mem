import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CODEX_SESSION_START = resolve(import.meta.dir, "../scripts/hook-handlers/codex-session-start.sh");
const CODEX_USER_PROMPT = resolve(import.meta.dir, "../scripts/hook-handlers/codex-user-prompt.sh");
const CODEX_SESSION_STOP = resolve(import.meta.dir, "../scripts/hook-handlers/codex-session-stop.sh");
const HOOK_COMMON_LIB = resolve(import.meta.dir, "../scripts/hook-handlers/lib/hook-common.sh");

type HookLogEntry = { command: string; payload: Record<string, unknown> };

function extractAdditionalContext(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  const parsed = JSON.parse(trimmed) as {
    hookSpecificOutput?: { additionalContext?: string | null };
  };
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

function parsePayloadLog(payloadLog: string): HookLogEntry[] {
  return readFileSync(payloadLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line) as { command: string; payload: string };
      if (!entry.payload) return { command: entry.command, payload: {} };
      try {
        return { command: entry.command, payload: JSON.parse(entry.payload) };
      } catch {
        return { command: entry.command, payload: { __raw: entry.payload } };
      }
    });
}

function setupCodexWorkHintSandbox(prefix: string) {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  const homeDir = join(tmp, "home");
  const harnessHome = join(homeDir, ".harness-mem");
  const projectDir = join(tmp, "project-a");
  const scriptRoot = join(projectDir, "scripts");
  const hookDir = join(scriptRoot, "hook-handlers");
  const libDir = join(hookDir, "lib");
  const payloadLog = join(projectDir, "payloads.jsonl");
  const syncLog = join(projectDir, "sync-plans.log");
  const mockClient = join(scriptRoot, "harness-mem-client.sh");
  const mockHarnessMem = join(scriptRoot, "harness-mem");

  mkdirSync(libDir, { recursive: true });
  mkdirSync(harnessHome, { recursive: true });
  writeFileSync(join(hookDir, "codex-session-start.sh"), readFileSync(CODEX_SESSION_START, "utf8"));
  writeFileSync(join(hookDir, "codex-user-prompt.sh"), readFileSync(CODEX_USER_PROMPT, "utf8"));
  writeFileSync(join(hookDir, "codex-session-stop.sh"), readFileSync(CODEX_SESSION_STOP, "utf8"));
  writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
  writeFileSync(
    join(harnessHome, "config.json"),
    JSON.stringify({ recall: { mode: "quiet" } }, null, 2)
  );

  writeFileSync(
    mockClient,
    `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
case "$command" in
  health)
    payload="{}"
    ;;
  work-query)
    payload="\${2:-}"
    [ -n "$payload" ] || payload="{}"
    ;;
  *)
    payload="$(cat || true)"
    ;;
esac
jq -nc --arg command "$command" --arg payload "$payload" '{command:$command,payload:$payload}' >> ${JSON.stringify(payloadLog)}
case "$command" in
  health)
    printf '%s\\n' '{"ok":true}'
    ;;
  resume-pack)
    printf '%s\\n' '{"ok":true,"meta":{"count":1,"continuity_briefing":{"content":"# Continuity Briefing\\n\\n## Current Focus\\n- Resume existing work first"}},"items":[]}'
    ;;
  search)
    printf '%s\\n' '{"ok":true,"meta":{"count":1},"items":[{"id":"obs-recall","title":"Recall note","content":"Use the existing recall whisper before work hints.","scores":{"final":0.9}}]}'
    ;;
  work-query)
    printf '%s\\n' '{"ok":true,"source":"workgraph","items":[{"rank":1,"work_id":"S125-013","title":"Hook hint observability","description":"SECRET_DO_NOT_LEAK","score":67,"reasons":[{"code":"priority","score":32,"message":"priority 1"},{"code":"session_continuity","score":20,"message":"continues session thread-work"}]}],"meta":{"filters":{"project":"project-a"},"ranking":"work_next_v1"}}'
    ;;
  finalize-session)
    printf '%s\\n' '{"ok":true,"items":[{"session_id":"thread-work","finalized_at":"2026-05-17T12:00:00Z"}],"meta":{"count":1}}'
    ;;
  record-event)
    printf '%s\\n' '{"ok":true,"items":[],"meta":{"count":1}}'
    ;;
  *)
    printf '%s\\n' '{"ok":true,"items":[],"meta":{"count":0}}'
    ;;
esac
`
  );
  chmodSync(mockClient, 0o755);

  writeFileSync(
    mockHarnessMem,
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(syncLog)}
db_path="\${HARNESS_MEM_DB_PATH:-\${HARNESS_MEM_HOME:-$HOME/.harness-mem}/harness-mem.db}"
mkdir -p "$(dirname "$db_path")"
: > "$db_path"
printf '%s\\n' '{"ok":true,"command":"work.sync-plans","mode":"write","writes":1,"work_items":1,"dependencies":0,"results":[],"diagnostics":[]}'
`
  );
  chmodSync(mockHarnessMem, 0o755);

  return { tmp, homeDir, harnessHome, projectDir, hookDir, payloadLog, syncLog };
}

function envFor(sandbox: ReturnType<typeof setupCodexWorkHintSandbox>, enabled: boolean) {
  return {
    ...process.env,
    HOME: sandbox.homeDir,
    HARNESS_MEM_HOME: sandbox.harnessHome,
    HARNESS_MEM_WORKGRAPH: "",
    HARNESS_MEM_WORK_HINTS: enabled ? "1" : "",
  };
}

describe("Codex WorkGraph hook hints (§S125-013)", () => {
  test("SessionStart auto-syncs an existing Plans.md without enabling work hints", async () => {
    const sandbox = setupCodexWorkHintSandbox("hmem-codex-work-auto-sync-");
    try {
      writeFileSync(
        join(sandbox.projectDir, "Plans.md"),
        `
| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S126-002 | **SessionStart auto sync** — import existing Plans.md | synced | - | cc:TODO |
`
      );

      const runSessionStart = async () => {
        const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-session-start.sh")], {
          cwd: sandbox.projectDir,
          env: envFor(sandbox, false),
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
        proc.stdin.write(JSON.stringify({ hook_event_name: "SessionStart", thread_id: "thread-work" }));
        proc.stdin.end();
        await new Response(proc.stdout).text();
        await new Response(proc.stderr).text();
        expect(await proc.exited).toBe(0);
      };

      await runSessionStart();
      await runSessionStart();

      const syncLines = readFileSync(sandbox.syncLog, "utf8").trim().split("\n").filter(Boolean);
      expect(syncLines).toHaveLength(1);
      expect(syncLines[0]).toBe(`work sync-plans --project ${realpathSync(sandbox.projectDir)} --write --json`);
      expect(parsePayloadLog(sandbox.payloadLog).map((entry) => entry.command)).not.toContain("work-query");
      expect(existsSync(join(sandbox.harnessHome, "workgraph-sync-state.json"))).toBe(true);
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("SessionStart keeps work hints disabled by default and preserves resume context", async () => {
    const sandbox = setupCodexWorkHintSandbox("hmem-codex-work-hint-default-");
    try {
      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-session-start.sh")], {
        cwd: sandbox.projectDir,
        env: envFor(sandbox, false),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(JSON.stringify({ hook_event_name: "SessionStart", thread_id: "thread-work" }));
      proc.stdin.end();
      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);

      const context = extractAdditionalContext(stdout);
      expect(context).toContain("source: harness_mem_resume_pack");
      expect(context).toContain("Resume existing work first");
      expect(context).not.toContain("WorkGraph Hint");
      expect(parsePayloadLog(sandbox.payloadLog).map((entry) => entry.command)).not.toContain("work-query");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("SessionStart opt-in appends a short cwd-scoped work hint after resume context", async () => {
    const sandbox = setupCodexWorkHintSandbox("hmem-codex-work-hint-start-");
    try {
      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-session-start.sh")], {
        cwd: sandbox.projectDir,
        env: envFor(sandbox, true),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(JSON.stringify({ hook_event_name: "SessionStart", thread_id: "thread-work" }));
      proc.stdin.end();
      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);

      const context = extractAdditionalContext(stdout);
      expect(context.indexOf("source: harness_mem_resume_pack")).toBeLessThan(
        context.indexOf("## WorkGraph Hint")
      );
      expect(context).toContain("source: harness_work_query");
      expect(context).toContain("next_work_id: S125-013");
      expect(context).not.toContain("SECRET_DO_NOT_LEAK");

      const workQuery = parsePayloadLog(sandbox.payloadLog).find((entry) => entry.command === "work-query");
      expect(workQuery?.payload).toMatchObject({
        mode: "next",
        limit: 1,
        current_session_id: "thread-work",
      });
      expect(realpathSync(String(workQuery?.payload.cwd))).toBe(realpathSync(sandbox.projectDir));
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("UserPromptSubmit appends work hint without replacing recall intent or contextual recall", async () => {
    const sandbox = setupCodexWorkHintSandbox("hmem-codex-work-hint-prompt-");
    try {
      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-user-prompt.sh")], {
        cwd: sandbox.projectDir,
        env: envFor(sandbox, true),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        thread_id: "thread-work",
        prompt: "思い出して、次アクション S125-013",
        privacy_tags: [],
      }));
      proc.stdin.end();
      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);

      const context = extractAdditionalContext(stdout);
      expect(context).toContain("Recall Intent Detected");
      expect(context).toContain("harness-recall");
      expect(context).toContain("## Contextual Recall");
      expect(context.indexOf("## Contextual Recall")).toBeLessThan(context.indexOf("## WorkGraph Hint"));
      expect(context).toContain("next_work_id: S125-013");
      expect(context).not.toContain("SECRET_DO_NOT_LEAK");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("UserPromptSubmit suppresses work hint when privacy tags request redaction", async () => {
    const sandbox = setupCodexWorkHintSandbox("hmem-codex-work-hint-privacy-");
    try {
      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-user-prompt.sh")], {
        cwd: sandbox.projectDir,
        env: envFor(sandbox, true),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        thread_id: "thread-work",
        prompt: "api key を含むので記録しないで",
        privacy_tags: ["redact"],
      }));
      proc.stdin.end();
      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);

      expect(extractAdditionalContext(stdout)).not.toContain("WorkGraph Hint");
      expect(parsePayloadLog(sandbox.payloadLog).map((entry) => entry.command)).not.toContain("work-query");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("Stop records follow-up suggestion only and never calls work update or close", async () => {
    const sandbox = setupCodexWorkHintSandbox("hmem-codex-work-hint-stop-");
    try {
      const proc = Bun.spawn(["bash", join(sandbox.hookDir, "codex-session-stop.sh")], {
        cwd: sandbox.projectDir,
        env: envFor(sandbox, true),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(JSON.stringify({
        hook_event_name: "Stop",
        thread_id: "thread-work",
        meta: { correlation_id: "corr-work" },
      }));
      proc.stdin.end();
      expect(await proc.exited).toBe(0);

      const payloads = parsePayloadLog(sandbox.payloadLog);
      expect(payloads.map((entry) => entry.command)).toContain("finalize-session");
      expect(payloads.map((entry) => entry.command)).toContain("work-query");
      expect(payloads.map((entry) => entry.command)).not.toContain("work-update");

      const followup = payloads.find((entry) =>
        entry.command === "record-event" &&
        JSON.stringify(entry.payload).includes("workgraph_followup_suggestion")
      );
      expect(followup).toBeTruthy();
      const serialized = JSON.stringify(followup?.payload ?? {});
      expect(serialized).toContain("next_work_id: S125-013");
      expect(serialized).not.toContain("SECRET_DO_NOT_LEAK");
      expect(serialized).not.toContain('"action":"close"');
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });
});
