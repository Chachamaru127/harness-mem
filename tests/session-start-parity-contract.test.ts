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
import { performance } from "node:perf_hooks";

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
// §160-003: 実物の harness-mem-client.sh。既存 5 テストは自前 mock を CLIENT_SCRIPT に
// 差し替えるため本番 daemon (127.0.0.1:37888) に触れないが、この定数は「daemon 不在」
// 回帰テストで本番クライアントの curl フォールバック経路を検証するために使う。
const REAL_CLIENT_SCRIPT = resolve(import.meta.dir, "../scripts/harness-mem-client.sh");
// scripts/harness-mem-client.sh:22 の `REQUEST_TIMEOUT="${HARNESS_MEM_CLIENT_TIMEOUT_SEC:-8}"`
// と一致させる。「daemon 不在」回帰テストは、この本番既定値より短い --max-time が
// curl に実際に渡っていることを機構レベルで検証する基準値として使う。
const PRODUCTION_DEFAULT_CLIENT_TIMEOUT_SEC = 8;
// bun test のこのファイル全体のデフォルトタイムアウト (bun 標準の 5000ms) を明示的に
// 底上げする。2026-07-28 に本番 daemon が履歴 catch-up の WAL checkpoint で I/O を
// 専有し、ホスト全体のプロセス起動が遅延した結果、CLIENT_SCRIPT を完全 mock 化した
// 経路ですら 5000ms を超えて false fail した。テスト自体は daemon に触れないため
// 結果は daemon 状態と無関係だが、実行時間はホストの負荷に引きずられる。ここを
// daemon の応答性から切り離す。
const SESSION_START_TEST_TIMEOUT_MS = 15000;

type SessionStartRun = {
  content: string;
  rawStdout: string;
  rawStderr: string;
  payloads: Array<{ command: string; payload: Record<string, unknown> }>;
};

function normalizeSessionStartEnv(
  inheritedEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  const env = { ...inheritedEnv };
  // Claude Code 親プロセスの plugin slot は parity contract の入力ではない。
  // Bun.spawn の暗黙継承から hook-common.sh に漏れると、警告と state 保存先が実行元依存になる。
  delete env.CLAUDE_PLUGIN_DATA;
  // §160-003: このファイルの各テストは CLIENT_SCRIPT を専用 mock に差し替えるため、
  // hook スクリプトは本番 daemon (127.0.0.1:37888) の状態と無関係に動く。
  // HARNESS_MEM_HOST/PORT を到達不能な値に固定しておくのは、mock が読まない値でも
  // 将来 hook 側にこの env 経由の直接ネットワーク経路が増えたときに本番 daemon へ
  // 誤って到達しないためのフェイルセーフ (port 1 は特権なしでは何も listen しない)。
  env.HARNESS_MEM_HOST = "127.0.0.1";
  env.HARNESS_MEM_PORT = "1";
  return env;
}

// curl の呼び出しログを 1 呼び出し = ["===CALL===", arg0, arg1, ...] の並びで書き出す
// stub。実ネットワークに一切触れず、常に curl の「接続失敗」exit code (7) を返す
// ことで harness-mem-client.sh の fallback_error 経路を決定的に踏ませる。壁時計や
// ホストの I/O 負荷に一切依存しない。
const CURL_STUB_SCRIPT = `#!/bin/bash
{
  echo "===CALL==="
  for arg in "$@"; do
    printf '%s\\n' "$arg"
  done
} >> "$CURL_STUB_LOG" 2>/dev/null
exit 7
`;

function parseCurlStubLog(raw: string): string[][] {
  if (!raw) {
    return [];
  }
  return raw
    .split("===CALL===\n")
    .map((block) => block.replace(/\n$/, ""))
    .filter((block) => block.length > 0)
    .map((block) => block.split("\n"));
}

function findCurlCallArgs(calls: string[][], urlSubstring: string): string[] | undefined {
  return calls.find((args) => args.some((arg) => arg.includes(urlSubstring)));
}

function extractFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

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
  continuityState?: Record<string, unknown>,
  inheritedEnv: Record<string, string | undefined> = process.env
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
  const env = normalizeSessionStartEnv(inheritedEnv);

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
        env,
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
        env,
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

type DaemonDownRun = {
  content: string;
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
  /** 参考情報のみ。ホスト負荷で揺れるため assertion の根拠にしない。 */
  elapsedMs: number;
  resumeErrorFile: string | undefined;
  /** curl stub が記録した、実際に daemon へ向けて発行されようとした呼び出し一覧。 */
  curlCalls: string[][];
};

// §160-003 回帰テスト用: 実物の harness-mem-client.sh を、実ネットワークに一切触れない
// curl stub 越しに動かし、daemon が不在/無応答のときに Claude/Codex 双方の SessionStart
// hook が (a) exit 0 で終わり、(b) 同じ空の結果に収束し、(c) 本番既定の 8 秒タイムアウト
// より短い --max-time が実際に curl に渡っていることを機構レベルで固定する。
//
// 壁時計 (elapsedMs) ではなく curl の呼び出し引数を検証する理由: 「daemon 不在」を
// 実際の閉じた port への接続失敗で作ると、結果は正しくても所要時間はホストの
// CPU/IO 負荷に引きずられる (2026-07-28 の false fail と同じ再発リスク)。curl 自体を
// stub化して即座に exit 7 (接続失敗) を返させれば、検証対象を「hook が daemon の
// 不在を正しくハンドリングするか」という機構に絞り込め、ホスト負荷の影響を受けない。
//
// CLIENT_SCRIPT を丸ごと mock する既存ヘルパーとは別に、hook-common.sh が実クライアント
// を解決する経路 (`${PARENT_DIR}/harness-mem-client.sh` + 隣接する `harness-memd`) を
// そのまま使う。
async function runSessionStartWithUnreachableDaemon(
  client: "claude" | "codex"
): Promise<DaemonDownRun> {
  const tmp = mkdtempSync(join(tmpdir(), `harness-mem-session-start-daemon-down-${client}-`));
  const projectDir = join(tmp, "session-start-parity-project");
  const scriptRoot = join(projectDir, "scripts");
  const hookDir = join(scriptRoot, "hook-handlers");
  const libDir = join(hookDir, "lib");
  const realClient = join(scriptRoot, "harness-mem-client.sh");
  const noopDaemon = join(scriptRoot, "harness-memd");
  const stubBinDir = join(projectDir, "stub-bin");
  const curlStubLog = join(projectDir, "curl-calls.log");

  const scriptPath =
    client === "claude"
      ? join(hookDir, "memory-session-start.sh")
      : join(hookDir, "codex-session-start.sh");

  try {
    mkdirSync(libDir, { recursive: true });
    mkdirSync(stubBinDir, { recursive: true });
    writeFileSync(
      scriptPath,
      readFileSync(client === "claude" ? CLAUDE_SESSION_START : CODEX_SESSION_START, "utf8")
    );
    writeFileSync(join(libDir, "hook-common.sh"), readFileSync(HOOK_COMMON_LIB, "utf8"));
    writeFileSync(realClient, readFileSync(REAL_CLIENT_SCRIPT, "utf8"));
    chmodSync(realClient, 0o755);
    // ensure_daemon() が harness-mem-client.sh の隣の harness-memd を叩く。本番の
    // harness-memd を絶対に起動させないため、常に即 exit する no-op に差し替える。
    writeFileSync(noopDaemon, "#!/bin/bash\nexit 0\n");
    chmodSync(noopDaemon, 0o755);
    writeFileSync(join(stubBinDir, "curl"), CURL_STUB_SCRIPT);
    chmodSync(join(stubBinDir, "curl"), 0o755);

    const env = normalizeSessionStartEnv(process.env);
    // stub-bin を PATH の先頭に差し込み、harness-mem-client.sh が呼ぶ裸の `curl` を
    // 常に stub へ解決させる (scripts/benchmarks/session-continuity-shared.ts が
    // CLAUDE_MEM_EXTRA_PATH で PATH 先頭に test double を差し込むのと同じパターン)。
    env.PATH = `${stubBinDir}:${env.PATH ?? ""}`;
    env.CURL_STUB_LOG = curlStubLog;
    // resume-pack 呼び出しはコード上 HARNESS_MEM_CLIENT_TIMEOUT_SEC の override を
    // 持たない (health だけ hook 側で 2 に固定される)。ここで明示的に本番既定の 8 より
    // 短い値を渡し、それが curl の --max-time に実際に伝播することを後で検証する。
    env.HARNESS_MEM_CLIENT_TIMEOUT_SEC = "3";

    let rawStdout = "";
    let rawStderr = "";
    let content = "";
    let exitCode: number | null = null;
    let resumeErrorFile: string | undefined;
    const start = performance.now();

    if (client === "claude") {
      const stateDir = join(projectDir, ".claude", "state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "session.json"), JSON.stringify({ session_id: "claude-current" }));

      const proc = Bun.spawn(["bash", scriptPath], {
        cwd: projectDir,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      exitCode = proc.exitCode;
      rawStdout = await new Response(proc.stdout).text();
      rawStderr = await new Response(proc.stderr).text();
      const resumePath = join(stateDir, "memory-resume-context.md");
      content = existsSync(resumePath) ? readFileSync(resumePath, "utf8") : "";
      const errorPath = join(stateDir, "memory-resume-error.md");
      resumeErrorFile = existsSync(errorPath) ? readFileSync(errorPath, "utf8") : undefined;
    } else {
      const inputPath = join(projectDir, "codex-session-start-input.json");
      writeFileSync(inputPath, JSON.stringify({ session_id: "codex-current" }));
      const proc = Bun.spawn(["bash", scriptPath], {
        cwd: projectDir,
        env,
        stdin: Bun.file(inputPath),
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      exitCode = proc.exitCode;
      rawStdout = await new Response(proc.stdout).text();
      rawStderr = await new Response(proc.stderr).text();
      content = extractCodexAdditionalContext(rawStdout);
    }

    const elapsedMs = performance.now() - start;
    // 参考情報として stderr に出す (assertion の根拠にはしない)。ホスト負荷下で
    // 遅くなること自体は許容し、機構 (--max-time の伝播) の方を厳密に検証する。
    console.error(`[session-start-parity-contract] daemon-unreachable ${client} elapsedMs=${elapsedMs.toFixed(1)}`);
    const curlCalls = existsSync(curlStubLog) ? parseCurlStubLog(readFileSync(curlStubLog, "utf8")) : [];
    return { content, rawStdout, rawStderr, exitCode, elapsedMs, resumeErrorFile, curlCalls };
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
  }, SESSION_START_TEST_TIMEOUT_MS);

  test("parent CLAUDE_PLUGIN_DATA does not change Claude/Codex parity", async () => {
    const resumeResponse = JSON.stringify({
      ok: true,
      meta: {
        count: 1,
        continuity_briefing: {
          content:
            "# Continuity Briefing\n\n## Current Focus\n- Keep the parity contract isolated from the parent launcher",
        },
      },
      items: [],
    });
    const inheritedEnv = {
      ...process.env,
      CLAUDE_PLUGIN_DATA: "/tmp/dummy-plugin-data",
      HARNESS_MEM_DB_PATH: undefined,
      HARNESS_MEM_PLUGIN_DATA_WARNED: undefined,
      HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN: undefined,
    };

    const claude = await runSessionStart("claude", resumeResponse, undefined, inheritedEnv);
    const codex = await runSessionStart("codex", resumeResponse, undefined, inheritedEnv);
    const strippedClaude = stripArtifactIdentityHeader(claude.content);
    const strippedCodex = stripArtifactIdentityHeader(codex.content);

    expect(normalize(strippedClaude)).toBe(normalize(strippedCodex));
    for (const run of [claude, codex]) {
      expect(run.content).toContain("Keep the parity contract isolated");
      expect(run.rawStderr.trim()).toBe("");
    }
  }, SESSION_START_TEST_TIMEOUT_MS);

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
    }, SESSION_START_TEST_TIMEOUT_MS);

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
    }, SESSION_START_TEST_TIMEOUT_MS);

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
  }, SESSION_START_TEST_TIMEOUT_MS);

  // §160-003 回帰テスト: 本番 daemon が居ない/応答しない状況を、実プロセスの停止では
  // なく curl 自体の stub 化 (常に接続失敗 exit code 7 を返す) で再現する。CLIENT_SCRIPT
  // は実物 (mock ではない) を使い、Claude/Codex 双方の hook が (a) exit 0 で終わる、
  // (b) 同じ空の結果に収束する、(c) 本番既定の 8 秒タイムアウトより短い --max-time が
  // 実際に curl へ渡っている、の 3 点を機構レベルで固定する。
  //
  // wall-clock ではなく curl の呼び出し引数で検証する: 実際に閉じた port へ接続させて
  // 所要時間を測ると、結果 (exit 0 / 空コンテンツ) は正しくても所要時間はホストの
  // CPU/IO 負荷に引きずられる。2026-07-28 の false fail も、2026-07-29 のレビューで
  // 指摘された「4000ms 閾値がホスト負荷下で再び flake する」問題も、根は同じ
  // 「wall-clock を assertion に使う」ことにあった。curl を stub 化して即座に失敗
  // させれば、検証対象を「hook が daemon 不在を正しくハンドリングするか」という
  // 機構に絞り込め、ホスト負荷から完全に独立する。
  test(
    "session-start parity holds when the daemon endpoint is unreachable",
    async () => {
      const claude = await runSessionStartWithUnreachableDaemon("claude");
      const codex = await runSessionStartWithUnreachableDaemon("codex");

      for (const run of [claude, codex]) {
        expect(run.exitCode).toBe(0);
        expect(run.content).toBe("");
        expect(run.rawStderr).not.toContain("command not found");

        // 機構検証 1: resume-pack の curl 呼び出しが実際に行われ、本番既定 8 秒より
        // 短い --max-time を積んでいること。health だけが hook 側で 2 秒に固定される
        // のに対し、resume-pack はコード上 override を持たないため、env の
        // HARNESS_MEM_CLIENT_TIMEOUT_SEC=3 が正しく伝播していることの直接証拠になる。
        const resumePackCall = findCurlCallArgs(run.curlCalls, "/v1/resume-pack");
        expect(resumePackCall).toBeDefined();
        const resumePackMaxTime = extractFlagValue(resumePackCall ?? [], "--max-time");
        expect(resumePackMaxTime).toBe("3");
        expect(Number(resumePackMaxTime)).toBeLessThan(PRODUCTION_DEFAULT_CLIENT_TIMEOUT_SEC);

        // 機構検証 2: 隔離が本物であること。curl に渡された URL がどれも本番 daemon
        // の port (37888) を指していない。
        for (const args of run.curlCalls) {
          expect(args.join(" ")).not.toContain("37888");
        }
      }

      // Claude 側は resume-pack 失敗時に理由つきのエラーファイルを残す設計
      // (memory-session-start.sh の write_resume_error_file)。ここが埋まっている
      // ことで、単に「何も起きなかった」のではなく daemon 不在の分岐を実際に
      // 通過したことを確認する。
      expect(claude.resumeErrorFile).toBeDefined();
      expect(claude.resumeErrorFile ?? "").toContain("resume_pack");
    },
    SESSION_START_TEST_TIMEOUT_MS
  );
});
