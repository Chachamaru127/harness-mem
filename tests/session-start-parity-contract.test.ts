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

const CLAUDE_SESSION_START = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/memory-session-start.sh"
);
const CODEX_SESSION_START = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/codex-session-start.sh"
);
const HOOK_COMMON_LIB = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/lib/hook-common.sh"
);

type SessionStartRun = {
  content: string;
  rawStdout: string;
  rawStderr: string;
  payloads: Array<{ command: string; payload: Record<string, unknown> }>;
};

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripArtifactIdentityHeader(value: string): string {
  return value
    .replace(
      /^source: harness_mem_resume_pack\nproject_key: [^\n]*\nsession_id: [^\n]*\ngenerated_at: [^\n]*\ncorrelation_id: [^\n]*\n\n/,
      ""
    )
    .trimStart();
}

function extractCodexAdditionalContext(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return trimmed;
  }

  const parsed = JSON.parse(trimmed) as {
    hookSpecificOutput?: { additionalContext?: string | null };
  };
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

async function runSessionStart(
  client: "claude" | "codex",
  resumeResponse: string,
  continuityState?: Record<string, unknown>
): Promise<SessionStartRun> {
  const tmp = mkdtempSync(join(tmpdir(), `harness-mem-session-start-${client}-`));
  const projectDir = join(tmp, "session-start-parity-project");
  const scriptRoot = join(projectDir, "scripts");
  const hookDir = join(scriptRoot, "hook-handlers");
  const libDir = join(hookDir, "lib");
  const mockClient = join(scriptRoot, "harness-mem-client.sh");
  const payloadLog = join(projectDir, `${client}-payloads.jsonl`);

  const scriptPath =
    client === "claude"
      ? join(hookDir, "memory-session-start.sh")
      : join(hookDir, "codex-session-start.sh");
  const escapedResumeResponse = resumeResponse.replace(/'/g, `'\\''`);

  try {
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      scriptPath,
      readFileSync(client === "claude" ? CLAUDE_SESSION_START : CODEX_SESSION_START, "utf8")
    );
    writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
    writeFileSync(
      mockClient,
      `#!/bin/bash
set -euo pipefail
command="\${1:-health}"
payload="$(cat)"
printf '%s\\t%s\\n' "$command" "$payload" >> ${JSON.stringify(payloadLog)}
if [ "$command" = "resume-pack" ]; then
  printf '%s\\n' '${escapedResumeResponse}'
  exit 0
fi
printf '%s\\n' '{"ok":true,"meta":{"count":0},"items":[]}'
`
    );
    chmodSync(mockClient, 0o755);

    if (continuityState) {
      const continuityDir = join(projectDir, ".harness-mem", "state");
      mkdirSync(continuityDir, { recursive: true });
      writeFileSync(join(continuityDir, "continuity.json"), JSON.stringify(continuityState, null, 2));
    }

    let content = "";
    let rawStdout = "";
    let rawStderr = "";
    if (client === "claude") {
      const stateDir = join(projectDir, ".claude", "state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "session.json"), JSON.stringify({ session_id: "claude-current" }));

      const proc = Bun.spawn(["bash", scriptPath], {
        cwd: projectDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      expect(proc.exitCode).toBe(0);
      rawStdout = await new Response(proc.stdout).text();
      rawStderr = await new Response(proc.stderr).text();
      const resumePath = join(stateDir, "memory-resume-context.md");
      content = existsSync(resumePath) ? readFileSync(resumePath, "utf8") : "";
    } else {
      const inputPath = join(projectDir, "codex-session-start-input.json");
      writeFileSync(inputPath, JSON.stringify({ session_id: "codex-current" }));
      const proc = Bun.spawn(["bash", scriptPath], {
        cwd: projectDir,
        stdin: Bun.file(inputPath),
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      expect(proc.exitCode).toBe(0);
      rawStdout = await new Response(proc.stdout).text();
      rawStderr = await new Response(proc.stderr).text();
      content = extractCodexAdditionalContext(rawStdout);
    }

    const payloads = readFileSync(payloadLog, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [command, rawPayload] = line.split("\t", 2);
        return { command, payload: rawPayload ? JSON.parse(rawPayload) : {} };
      });

    return { content, rawStdout, rawStderr, payloads };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("session-start parity contract", () => {
  test("continuity briefing artifact is identical for Claude and Codex", async () => {
    const resumeResponse = JSON.stringify({
      ok: true,
      meta: {
        count: 1,
        continuity_briefing: {
          content:
            "# Continuity Briefing\n\n## Current Focus\n- Continue the first-turn continuity benchmark\n\n## Next Actions\n- Keep Claude and Codex in parity",
        },
        recent_project_context: {
          content:
            "## Also Recently in This Project\n- OpenAPI docs refresh is still pending visual cleanup",
        },
      },
      items: [{ id: "summary-1", type: "session_summary", summary: "fallback summary" }],
    });

    const claude = await runSessionStart("claude", resumeResponse);
    const codex = await runSessionStart("codex", resumeResponse);
    const strippedClaude = stripArtifactIdentityHeader(claude.content);
    const strippedCodex = stripArtifactIdentityHeader(codex.content);

    expect(strippedClaude).not.toContain("source: harness_mem_resume_pack");
    expect(strippedCodex).not.toContain("source: harness_mem_resume_pack");
    expect(normalize(strippedClaude)).toBe(normalize(strippedCodex));
    for (const run of [claude, codex]) {
      expect(run.content).toContain("source: harness_mem_resume_pack");
      expect(run.content).toContain("project_key: session-start-parity-project");
      expect(run.content).toContain("session_id:");
      expect(run.content).toContain("generated_at:");
      expect(run.content).toContain("correlation_id:");
    }
    expect(claude.content).toContain("Continuity Briefing");
    expect(claude.content).toContain("## Also Recently in This Project");
    expect(codex.content).toContain("Keep Claude and Codex in parity");
    expect(codex.content.indexOf("## Current Focus")).toBeLessThan(
      codex.content.indexOf("## Also Recently in This Project")
    );
    expect(codex.rawStdout).toContain('"hookSpecificOutput"');
    expect(codex.rawStderr.trim()).toBe("");
  });

    test("fallback resume-pack list is rendered identically for Claude and Codex", async () => {
    const resumeResponse = JSON.stringify({
      ok: true,
      meta: { count: 2 },
      items: [
        {
          id: "session:prev",
          type: "session_summary",
          summary: "Continue from the previous adapter fix",
        },
        {
          id: "obs-1",
          type: "observation",
          title: "adapter delta",
          content: "Need to align SessionStart rendering between Claude and Codex.",
        },
      ],
    });

      const claude = await runSessionStart("claude", resumeResponse);
      const codex = await runSessionStart("codex", resumeResponse);

    const strippedClaude = stripArtifactIdentityHeader(claude.content);
    const strippedCodex = stripArtifactIdentityHeader(codex.content);
    expect(strippedClaude).not.toContain("source: harness_mem_resume_pack");
    expect(strippedCodex).not.toContain("source: harness_mem_resume_pack");
    expect(normalize(strippedClaude)).toBe(normalize(strippedCodex));
    expect(claude.content).toContain("source: harness_mem_resume_pack");
    expect(codex.content).toContain("source: harness_mem_resume_pack");
    expect(claude.content).toContain("Memory Resume Pack");
      expect(codex.content).toContain("SessionStart rendering");
    });

    test("Claude and Codex request L0 resume-pack with a bounded first-turn budget", async () => {
      const resumeResponse = JSON.stringify({
        ok: true,
        meta: { count: 0 },
        items: [],
      });

      const claude = await runSessionStart("claude", resumeResponse);
      const codex = await runSessionStart("codex", resumeResponse);

      for (const run of [claude, codex]) {
        const resumePayload = run.payloads.find((entry) => entry.command === "resume-pack")?.payload as {
          include_private?: boolean;
          detail_level?: string;
          resume_pack_max_tokens?: number;
        };
        expect(resumePayload).toBeDefined();
        expect(resumePayload.include_private).toBe(false);
        expect(resumePayload.detail_level).toBe("L0");
        expect(resumePayload.resume_pack_max_tokens).toBeLessThanOrEqual(1200);
      }
    });

  test("latest handoff correlation_id is forwarded consistently for Claude and Codex", async () => {
    const continuityState = {
      version: 1,
      project: "session-start-parity-project",
      sessions: {},
      latest_handoff: {
        session_id: "previous-session",
        platform: "claude",
        correlation_id: "corr-handoff",
        summary_mode: "standard",
        finalized_at: "2026-03-24T12:00:00Z",
        consumed_by_session_id: null,
      },
    };
    const resumeResponse = JSON.stringify({ ok: true, meta: { count: 0 }, items: [] });

    const claude = await runSessionStart("claude", resumeResponse, continuityState);
    const codex = await runSessionStart("codex", resumeResponse, continuityState);

    for (const run of [claude, codex]) {
      const recordEvent = run.payloads.find((entry) => entry.command === "record-event")?.payload as {
        event?: { correlation_id?: string };
      };
      const resumePack = run.payloads.find((entry) => entry.command === "resume-pack")?.payload as {
        correlation_id?: string;
        include_private?: boolean;
      };

      expect(recordEvent.event?.correlation_id).toBe("corr-handoff");
      expect(resumePack.correlation_id).toBe("corr-handoff");
      expect(resumePack.include_private).toBe(false);
    }
  });
});
