import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const RUN_SCRIPT = resolve(ROOT, "scripts/run-script.js");
const USERPROMPT_POLICY = resolve(ROOT, "scripts/userprompt-inject-policy.sh");
const HOOK_COMMON = resolve(ROOT, "scripts/hook-handlers/lib/hook-common.sh");
const CODEX_SESSION_START = resolve(ROOT, "scripts/hook-handlers/codex-session-start.sh");
const CODEX_USER_PROMPT = resolve(ROOT, "scripts/hook-handlers/codex-user-prompt.sh");

function extractAdditionalContext(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = JSON.parse(trimmed) as {
    hookSpecificOutput?: { additionalContext?: string | null };
  };
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

function makeSearchResponse(items: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    ok: true,
    meta: { count: items.length },
    items,
  });
}

function setupHookSandbox(searchResponse: string) {
  const tmp = mkdtempSync(join(tmpdir(), "hmem-contextual-recall-"));
  const projectDir = join(tmp, "project");
  const scriptsDir = join(projectDir, "scripts");
  const hookDir = join(scriptsDir, "hook-handlers");
  const libDir = join(hookDir, "lib");
  const homeDir = join(tmp, "home");
  const harnessHome = join(homeDir, ".harness-mem");
  const payloadLog = join(projectDir, "payloads.jsonl");
  const clientScript = join(scriptsDir, "harness-mem-client.sh");

  mkdirSync(libDir, { recursive: true });
  mkdirSync(join(homeDir, ".harness-mem"), { recursive: true });

  writeFileSync(join(scriptsDir, "run-script.js"), readFileSync(RUN_SCRIPT, "utf8"));
  writeFileSync(join(scriptsDir, "userprompt-inject-policy.sh"), readFileSync(USERPROMPT_POLICY, "utf8"));
  writeFileSync(join(hookDir, "codex-session-start.sh"), readFileSync(CODEX_SESSION_START, "utf8"));
  writeFileSync(join(hookDir, "codex-user-prompt.sh"), readFileSync(CODEX_USER_PROMPT, "utf8"));
  writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON, "utf8"));
  writeFileSync(
    clientScript,
    `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
case "$command" in
  search)
    printf '%s\\n' '${searchResponse.replace(/'/g, `'\\''`)}'
    ;;
  resume-pack)
    printf '%s\\n' '{"ok":true,"meta":{"count":1,"continuity_briefing":{"content":"# Continuity Briefing\\n- resume context"}},"items":[]}'
    ;;
  *)
    printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
    ;;
esac
`
  );
  chmodSync(join(scriptsDir, "run-script.js"), 0o755);
  chmodSync(join(scriptsDir, "userprompt-inject-policy.sh"), 0o755);
  chmodSync(join(hookDir, "codex-session-start.sh"), 0o755);
  chmodSync(join(hookDir, "codex-user-prompt.sh"), 0o755);
  chmodSync(clientScript, 0o755);

  writeFileSync(
    join(harnessHome, "config.json"),
    JSON.stringify(
      {
        backend_mode: "local",
        recall: { mode: "on" },
        embedding_provider: "auto",
        embedding_model: "multilingual-e5",
        managed: { endpoint: "", api_key: "" },
        auto_update: { enabled: false, package_name: "@chachamaru127/harness-mem", channel: "latest", repair_platforms: [] },
      },
      null,
      2
    )
  );

  return { tmp, projectDir, homeDir, harnessHome, payloadLog };
}

describe("contextual recall contract", () => {
  test("Claude policy injects resume context and skips same-turn recall", async () => {
    const sandbox = setupHookSandbox(
      makeSearchResponse([
        {
          id: "obs-1",
          title: "build fix",
          content: "Fix the parser error in src/app.ts",
          scores: { final: 0.03, rerank: 0.91 },
        },
      ])
    );

    try {
      const stateDir = join(sandbox.projectDir, ".claude", "state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "session.json"), JSON.stringify({ session_id: "claude-session", prompt_seq: 0 }));
      writeFileSync(join(stateDir, "memory-resume-context.md"), "Carry forward the benchmark cleanup.");
      writeFileSync(join(stateDir, ".memory-resume-pending"), "1");

      const inputPath = join(sandbox.projectDir, "input.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "claude-session",
          prompt: "src/app.ts error を直したい",
        })
      );

      const proc = Bun.spawn(["node", join(sandbox.projectDir, "scripts", "run-script.js"), "userprompt-inject-policy"], {
        cwd: sandbox.projectDir,
        env: { ...process.env, HOME: sandbox.homeDir, HARNESS_MEM_HOME: sandbox.harnessHome },
        stdin: Bun.file(inputPath),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const context = extractAdditionalContext(stdout);
      expect(context).toContain("Memory Resume Context");
      expect(context).not.toContain("Contextual Recall");

      const session = JSON.parse(readFileSync(join(stateDir, "session.json"), "utf8")) as {
        resume_injected?: boolean;
        resume_injected_prompt_seq?: number;
        prompt_seq?: number;
      };
      expect(session.resume_injected).toBe(true);
      expect(session.resume_injected_prompt_seq).toBe(1);
      expect(session.prompt_seq).toBe(1);
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("Claude policy emits contextual recall and persists budget state", async () => {
    const sandbox = setupHookSandbox(
      makeSearchResponse([
        {
          id: "obs-1",
          title: "parser decision",
          content: "Keep the parser rollout behind a feature flag.",
          scores: { final: 0.02, rerank: 0.93 },
        },
      ])
    );

    try {
      const stateDir = join(sandbox.projectDir, ".claude", "state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "session.json"), JSON.stringify({ session_id: "claude-session", prompt_seq: 0 }));

      const inputPath = join(sandbox.projectDir, "input.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "claude-session",
          prompt: "parser rollout の次アクションを決めたい",
        })
      );

      const proc = Bun.spawn(["node", join(sandbox.projectDir, "scripts", "run-script.js"), "userprompt-inject-policy"], {
        cwd: sandbox.projectDir,
        env: { ...process.env, HOME: sandbox.homeDir, HARNESS_MEM_HOME: sandbox.harnessHome },
        stdin: Bun.file(inputPath),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const context = extractAdditionalContext(stdout);
      expect(context).toContain("Contextual Recall");
      expect(context).toContain("parser decision");

      const whisperStatePath = join(sandbox.projectDir, ".harness-mem", "state", "whisper-budget.json");
      expect(existsSync(whisperStatePath)).toBe(true);
      const whisperState = JSON.parse(readFileSync(whisperStatePath, "utf8")) as {
        sessions?: Record<string, { inject_count?: number; seen_ids?: string[]; accumulated_tokens?: number }>;
      };
      expect(whisperState.sessions?.["claude-session"]?.inject_count).toBe(1);
      expect(whisperState.sessions?.["claude-session"]?.seen_ids).toContain("obs-1");
      expect((whisperState.sessions?.["claude-session"]?.accumulated_tokens ?? 0)).toBeGreaterThan(0);
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("Codex skips recall on the first prompt after session-start resume injection", async () => {
    const sandbox = setupHookSandbox(
      makeSearchResponse([
        {
          id: "obs-1",
          title: "recent fix",
          content: "Follow up on the resume context.",
          scores: { final: 0.02, rerank: 0.91 },
        },
      ])
    );

    try {
      const startInput = join(sandbox.projectDir, "codex-session-start-input.json");
      writeFileSync(startInput, JSON.stringify({ session_id: "codex-session" }));
      const startProc = Bun.spawn(["bash", join(sandbox.projectDir, "scripts", "hook-handlers", "codex-session-start.sh")], {
        cwd: sandbox.projectDir,
        env: { ...process.env, HOME: sandbox.homeDir, HARNESS_MEM_HOME: sandbox.harnessHome },
        stdin: Bun.file(startInput),
        stdout: "pipe",
        stderr: "pipe",
      });
      await startProc.exited;
      expect(startProc.exitCode).toBe(0);

      const promptInput = join(sandbox.projectDir, "codex-user-prompt-input.json");
      writeFileSync(
        promptInput,
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "codex-session",
          prompt: "recent fix の次アクションを決めたい",
        })
      );
      const promptProc = Bun.spawn(["bash", join(sandbox.projectDir, "scripts", "hook-handlers", "codex-user-prompt.sh")], {
        cwd: sandbox.projectDir,
        env: { ...process.env, HOME: sandbox.homeDir, HARNESS_MEM_HOME: sandbox.harnessHome },
        stdin: Bun.file(promptInput),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(promptProc.stdout).text();
      await promptProc.exited;
      expect(promptProc.exitCode).toBe(0);
      expect(extractAdditionalContext(stdout)).toBe("");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("Codex quiet mode falls back to top 1 item when reranker is unavailable", async () => {
    const sandbox = setupHookSandbox(
      makeSearchResponse([
        {
          id: "obs-1",
          title: "top hit",
          content: "This should be the only fallback whisper in quiet mode.",
          scores: { final: 0.04 },
        },
        {
          id: "obs-2",
          title: "second hit",
          content: "This should stay hidden in quiet mode.",
          scores: { final: 0.03 },
        },
      ])
    );

    try {
      writeFileSync(
        join(sandbox.harnessHome, "config.json"),
        JSON.stringify({ backend_mode: "local", recall: { mode: "quiet" } }, null, 2)
      );

      const promptInput = join(sandbox.projectDir, "codex-user-prompt-input.json");
      writeFileSync(
        promptInput,
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "codex-session",
          prompt: "src/app.ts の次アクションを決めたい",
        })
      );

      const promptProc = Bun.spawn(["bash", join(sandbox.projectDir, "scripts", "hook-handlers", "codex-user-prompt.sh")], {
        cwd: sandbox.projectDir,
        env: { ...process.env, HOME: sandbox.homeDir, HARNESS_MEM_HOME: sandbox.harnessHome },
        stdin: Bun.file(promptInput),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(promptProc.stdout).text();
      await promptProc.exited;
      expect(promptProc.exitCode).toBe(0);

      const context = extractAdditionalContext(stdout);
      expect(context).toContain("Contextual Recall");
      expect(context).toContain("top hit");
      expect(context).not.toContain("second hit");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });

  test("Claude policy stops recall after the per-session injection limit", async () => {
    const sandbox = setupHookSandbox(
      makeSearchResponse([
        {
          id: "obs-1",
          title: "limit hit",
          content: "This recall should be suppressed by the session budget.",
          scores: { final: 0.02, rerank: 0.91 },
        },
      ])
    );

    try {
      const stateDir = join(sandbox.projectDir, ".claude", "state");
      const whisperDir = join(sandbox.projectDir, ".harness-mem", "state");
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(whisperDir, { recursive: true });
      writeFileSync(join(stateDir, "session.json"), JSON.stringify({ session_id: "claude-session", prompt_seq: 0 }));
      writeFileSync(
        join(whisperDir, "whisper-budget.json"),
        JSON.stringify(
          {
            version: 1,
            project: "project",
            sessions: {
              "claude-session": {
                seen_ids: [],
                accumulated_tokens: 1200,
                prompt_count_since_last_inject: 5,
                inject_count: 5,
                pending_resume_skip: false,
              },
            },
          },
          null,
          2
        )
      );

      const inputPath = join(sandbox.projectDir, "input.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "claude-session",
          prompt: "src/app.ts の方針を決めたい",
        })
      );

      const proc = Bun.spawn(["node", join(sandbox.projectDir, "scripts", "run-script.js"), "userprompt-inject-policy"], {
        cwd: sandbox.projectDir,
        env: { ...process.env, HOME: sandbox.homeDir, HARNESS_MEM_HOME: sandbox.harnessHome },
        stdin: Bun.file(inputPath),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      expect(proc.exitCode).toBe(0);
      expect(extractAdditionalContext(stdout)).toBe("");

      if (existsSync(sandbox.payloadLog)) {
        const payloadLog = readFileSync(sandbox.payloadLog, "utf8");
        expect(payloadLog).not.toContain("search\t");
      }
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });
});
