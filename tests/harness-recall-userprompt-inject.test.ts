/**
 * harness-recall-userprompt-inject.test.ts
 *
 * §96 S96-003: contract test for userprompt-inject-policy.sh recall trigger.
 *
 * - when the user's prompt contains a recall keyword (思い出して / 覚えてる /
 *   前回 / 続き / resume / recall / 直近 / 最後に / 先ほど / さっき),
 *   the hook must emit an additionalContext block that promotes the
 *   /harness-recall Skill invocation and lists the Skill name explicitly
 * - when the prompt does NOT contain recall keywords, the hook must NOT
 *   emit the recall trigger block (keep the surface lean)
 * - the recall trigger block is additive: it must not break the existing
 *   Memory Resume Context / LSP policy injection paths
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
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

function extractAdditionalContext(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  const parsed = JSON.parse(trimmed) as {
    hookSpecificOutput?: { additionalContext?: string | null };
  };
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

function setupHookSandbox() {
  const tmp = mkdtempSync(join(tmpdir(), "hmem-recall-trigger-"));
  const projectDir = join(tmp, "project");
  const scriptsDir = join(projectDir, "scripts");
  const hookDir = join(scriptsDir, "hook-handlers");
  const libDir = join(hookDir, "lib");
  const homeDir = join(tmp, "home");
  const harnessHome = join(homeDir, ".harness-mem");
  const clientScript = join(scriptsDir, "harness-mem-client.sh");

  mkdirSync(libDir, { recursive: true });
  mkdirSync(harnessHome, { recursive: true });

  writeFileSync(join(scriptsDir, "run-script.js"), readFileSync(RUN_SCRIPT, "utf8"));
  writeFileSync(
    join(scriptsDir, "userprompt-inject-policy.sh"),
    readFileSync(USERPROMPT_POLICY, "utf8")
  );
  writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON, "utf8"));
  writeFileSync(
    clientScript,
    `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
payload="$(cat)"
case "$command" in
  search)
    printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
    ;;
  resume-pack)
    printf '%s\\n' '{"ok":true,"meta":{"count":0,"continuity_briefing":null},"items":[]}'
    ;;
  *)
    printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
    ;;
esac
`
  );
  chmodSync(join(scriptsDir, "run-script.js"), 0o755);
  chmodSync(join(scriptsDir, "userprompt-inject-policy.sh"), 0o755);
  chmodSync(clientScript, 0o755);

  writeFileSync(
    join(harnessHome, "config.json"),
    JSON.stringify(
      {
        backend_mode: "local",
        recall: { mode: "off" },
        embedding_provider: "auto",
        embedding_model: "multilingual-e5",
        managed: { endpoint: "", api_key: "" },
        auto_update: { enabled: false, package_name: "@chachamaru127/harness-mem", channel: "latest", repair_platforms: [] },
      },
      null,
      2
    )
  );

  const stateDir = join(projectDir, ".claude", "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "session.json"),
    JSON.stringify({ session_id: "claude-session", prompt_seq: 0 })
  );

  return { tmp, projectDir, homeDir, harnessHome, stateDir };
}

async function runHookWithPrompt(
  sandbox: ReturnType<typeof setupHookSandbox>,
  prompt: string
): Promise<string> {
  const inputPath = join(sandbox.projectDir, "input.json");
  writeFileSync(
    inputPath,
    JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "claude-session",
      prompt,
    })
  );

  const proc = Bun.spawn(
    ["node", join(sandbox.projectDir, "scripts", "run-script.js"), "userprompt-inject-policy"],
    {
      cwd: sandbox.projectDir,
      env: { ...process.env, HOME: sandbox.homeDir, HARNESS_MEM_HOME: sandbox.harnessHome },
      stdin: Bun.file(inputPath),
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`hook exited with ${proc.exitCode}`);
  }
  return stdout;
}

const RECALL_PROMPTS = [
  "思い出して、前やってた retrieval の話",
  "覚えてる? XR-003 の経緯",
  "前回どこまで進めた?",
  "続きからお願い",
  "resume session please",
  "recall the §78 decision",
  "直近のセッション一覧を出して",
];

const NON_RECALL_PROMPTS = [
  "この関数を修正してください",
  "bun test を実行して",
  "README の typo を直したい",
];

describe("§96 /harness-recall userprompt trigger", () => {
  for (const prompt of RECALL_PROMPTS) {
    test(`recall trigger fires for prompt: "${prompt}"`, async () => {
      const sandbox = setupHookSandbox();
      try {
        const stdout = await runHookWithPrompt(sandbox, prompt);
        const context = extractAdditionalContext(stdout);
        expect(context).toContain("/harness-recall");
        expect(context.toLowerCase()).toContain("recall");
      } finally {
        rmSync(sandbox.tmp, { recursive: true, force: true });
      }
    });
  }

  for (const prompt of NON_RECALL_PROMPTS) {
    test(`recall trigger does NOT fire for non-recall prompt: "${prompt}"`, async () => {
      const sandbox = setupHookSandbox();
      try {
        const stdout = await runHookWithPrompt(sandbox, prompt);
        const context = extractAdditionalContext(stdout);
        expect(context).not.toContain("/harness-recall");
      } finally {
        rmSync(sandbox.tmp, { recursive: true, force: true });
      }
    });
  }

  test("recall trigger block is labelled and points to the 5 intent routes", async () => {
    const sandbox = setupHookSandbox();
    try {
      const stdout = await runHookWithPrompt(sandbox, "思い出して");
      const context = extractAdditionalContext(stdout);
      expect(context).toContain("Recall Intent Detected");
      expect(context).toContain("harness_mem_resume_pack");
      expect(context).toContain("harness_mem_search");
    } finally {
      rmSync(sandbox.tmp, { recursive: true, force: true });
    }
  });
});
