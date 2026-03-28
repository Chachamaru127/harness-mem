import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../memory-server/src/core/harness-mem-core";
import { startHarnessMemServer } from "../../memory-server/src/server";

const CLAUDE_SESSION_START_SCRIPT = resolve(
  import.meta.dir,
  "../hook-handlers/memory-session-start.sh"
);
const CODEX_SESSION_START_SCRIPT = resolve(
  import.meta.dir,
  "../hook-handlers/codex-session-start.sh"
);

export const CONTINUITY_SCENARIO = {
  project: "session-continuity-bench",
  targetCorrelationId: "corr-session-continuity",
  previousSessionId: "continuity-previous-session",
  targetPrompt: "Users say that opening a new Claude or Codex session forgets what we were talking about.",
  targetResponse:
    "We agreed to ship a continuity briefing first and then fix adapter delivery for both Claude and Codex.",
  noisePrompt: "Regenerate the OpenAPI 3.1 docs and tweak the Swagger dark mode.",
  noiseResponse: "Next step is to polish dark mode styles and database index notes.",
  requiredFacts: [
    {
      id: "problem",
      anyOf: ["forgets what we were talking about", "lose context", "new claude or codex session"],
    },
    {
      id: "decision",
      anyOf: ["continuity briefing"],
    },
    {
      id: "next_action",
      anyOf: ["fix adapter delivery", "adapter delivery"],
    },
    {
      id: "parity_scope",
      anyOf: ["both claude and codex", "claude and codex", "claude/codex"],
    },
  ],
  forbiddenFacts: [
    {
      id: "openapi_noise",
      anyOf: ["openapi 3.1", "swagger dark mode"],
    },
    {
      id: "db_noise",
      anyOf: ["database index", "dark mode styles"],
    },
  ],
  recentProjectFacts: [
    {
      id: "recent_project_context",
      anyOf: ["openapi 3.1", "swagger dark mode", "database index", "docs refresh"],
    },
  ],
  recallProject: "session-memory-compare",
  recallQueries: [
    {
      query: "前回の auth middleware の作業はどこまで進んだ？",
      keywords: ["pr #42", "レビュー"],
    },
    {
      query: "auth middleware で何を変更した？",
      keywords: ["cookie", "authorization", "jwt"],
    },
    {
      query: "リフレッシュトークンの有効期限は？",
      keywords: ["7日", "ローテーション"],
    },
    {
      query: "auth のテストは何件？",
      keywords: ["12テスト", "パス"],
    },
    {
      query: "What was the last step in the auth refactoring?",
      keywords: ["pr", "#42", "review"],
    },
    {
      query: "前回のセッションで API ドキュメントはどうした？",
      keywords: ["openapi", "swagger"],
    },
    {
      query: "DB のパフォーマンス改善の結果は？",
      keywords: ["120ms", "8ms"],
    },
    {
      query: "最後に作業したのは何？",
      keywords: ["インデックス", "データベース"],
    },
  ],
  recallSessions: [
    {
      sessionId: "session-a-001",
      steps: [
        "auth middleware のリファクタリングを開始。現状の問題: セッショントークンが Cookie と Header の両方で扱われていて不統一。",
        "JWT バリデーションロジックを共通関数 validateToken() に抽出。",
        "Cookie パーサーを削除し、Authorization ヘッダに統一。",
        "リフレッシュトークンのローテーション実装。有効期限7日。",
        "CORS 設定を更新。credentials: true を追加。",
        "auth middleware のテスト追加。12テスト全パス。",
        "PR #42 を作成。レビュー待ち。",
      ],
    },
    {
      sessionId: "session-c-001",
      steps: [
        "API ドキュメントを OpenAPI 3.1 で再生成。",
        "Swagger UI の設定を更新。ダークモード対応。",
        "API バージョン v2 のエンドポイント追加。",
      ],
    },
    {
      sessionId: "session-d-001",
      steps: [
        "データベースのインデックス最適化。users テーブルに複合インデックス追加。",
        "EXPLAIN ANALYZE で確認。クエリ時間 120ms → 8ms。",
      ],
    },
  ],
} as const;

export interface FactScore {
  id: string;
  hit: boolean;
  match: string | null;
}

export interface ArtifactScore {
  artifact: string;
  chainArtifact: string;
  recentProjectArtifact: string;
  latencyMs: number;
  tokenCount: number;
  requiredHitCount: number;
  requiredTotal: number;
  recall: number;
  falseCarryoverCount: number;
  requiredFacts: FactScore[];
  falseCarryoverFacts: FactScore[];
  recentProjectHitCount: number;
  recentProjectTotal: number;
  recentProjectRecall: number;
  recentProjectFacts: FactScore[];
}

export interface HarnessClientScore extends ArtifactScore {
  client: "claude" | "codex";
}

export interface HarnessContinuityReport {
  claude: HarnessClientScore;
  codex: HarnessClientScore;
  parity: {
    normalizedEqual: boolean;
  };
}

export interface ComparisonScore {
  hits: number;
  total: number;
  recall: number;
  avgLatencyMs: number;
}

export interface MemoryRecallComparisonReport {
  harness: ComparisonScore;
  claudeMem: ComparisonScore;
}

export interface ClaudeMemContinuityReport extends ArtifactScore {
  client: "claude-mem";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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

function countTokens(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function extractRecentProjectSection(artifact: string): string {
  const lines = artifact.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    /^##\s+Also Recently in This Project\b/i.test(line.trim())
  );
  if (startIndex === -1) {
    return "";
  }

  const endIndex = lines.findIndex(
    (line, index) => index > startIndex && /^##\s+/.test(line.trim())
  );
  const sectionLines = endIndex === -1 ? lines.slice(startIndex) : lines.slice(startIndex, endIndex);
  return sectionLines.join("\n").trim();
}

function extractChainArtifact(artifact: string): string {
  const recentProjectSection = extractRecentProjectSection(artifact);
  if (!recentProjectSection) {
    return artifact.trim();
  }

  const sectionIndex = artifact.indexOf(recentProjectSection);
  if (sectionIndex === -1) {
    return artifact.trim();
  }

  return artifact.slice(0, sectionIndex).trimEnd();
}

function scoreFacts(text: string, facts: ReadonlyArray<{ id: string; anyOf: readonly string[] }>): FactScore[] {
  const normalized = normalizeText(text);
  return facts.map((fact) => {
    const match = fact.anyOf.find((candidate) => normalized.includes(candidate.toLowerCase())) || null;
    return { id: fact.id, hit: match !== null, match };
  });
}

function scoreArtifact(artifact: string): ArtifactScore {
  const chainArtifact = extractChainArtifact(artifact);
  const recentProjectArtifact = extractRecentProjectSection(artifact);
  const requiredFacts = scoreFacts(chainArtifact, CONTINUITY_SCENARIO.requiredFacts);
  const falseCarryoverFacts = scoreFacts(chainArtifact, CONTINUITY_SCENARIO.forbiddenFacts);
  const recentProjectFacts = scoreFacts(recentProjectArtifact, CONTINUITY_SCENARIO.recentProjectFacts);
  const requiredHitCount = requiredFacts.filter((fact) => fact.hit).length;
  const requiredTotal = requiredFacts.length;
  const recentProjectHitCount = recentProjectFacts.filter((fact) => fact.hit).length;
  const recentProjectTotal = CONTINUITY_SCENARIO.recentProjectFacts.length;

  return {
    artifact,
    chainArtifact,
    recentProjectArtifact,
    latencyMs: 0,
    tokenCount: countTokens(artifact),
    requiredHitCount,
    requiredTotal,
    recall: requiredTotal === 0 ? 0 : requiredHitCount / requiredTotal,
    falseCarryoverCount: falseCarryoverFacts.filter((fact) => fact.hit).length,
    requiredFacts,
    falseCarryoverFacts,
    recentProjectHitCount,
    recentProjectTotal,
    recentProjectRecall: recentProjectTotal === 0 ? 0 : recentProjectHitCount / recentProjectTotal,
    recentProjectFacts,
  };
}

async function reserveAvailablePort(host: string): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    const fail = (error: Error) => {
      probe.close(() => rejectPort(error));
    };

    probe.once("error", fail);
    probe.listen(0, host, () => {
      const address = probe.address();
      const port =
        typeof address === "object" && address !== null && typeof address.port === "number"
          ? address.port
          : null;

      if (port === null) {
        fail(new Error("failed to reserve benchmark port"));
        return;
      }

      probe.close((closeError) => {
        if (closeError) {
          rejectPort(closeError);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function createHarnessRuntime(name: string): Promise<{
  core: HarnessMemCore;
  baseUrl: string;
  stop: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-session-continuity-${name}-`));
  const bindHost = "127.0.0.1";
  const bindPort = await reserveAvailablePort(bindHost);
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost,
    bindPort,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
  const core = new HarnessMemCore(config);
  let server;
  try {
    server = startHarnessMemServer(core, config);
  } catch (error) {
    core.shutdown(name);
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    core,
    baseUrl: `http://${bindHost}:${server.port}`,
    stop: () => {
      core.shutdown(name);
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function recordHarnessEvent(core: HarnessMemCore, event: EventEnvelope): void {
  const response = core.recordEvent(event);
  if (!response.ok) {
    throw new Error(`failed to record event: ${event.event_id}`);
  }
}

function seedHarnessContinuity(core: HarnessMemCore, project: string): void {
  recordHarnessEvent(core, {
    event_id: "continuity-user",
    platform: "claude",
    project,
    session_id: CONTINUITY_SCENARIO.previousSessionId,
    correlation_id: CONTINUITY_SCENARIO.targetCorrelationId,
    event_type: "user_prompt",
    ts: "2026-03-24T10:00:00.000Z",
    payload: { content: CONTINUITY_SCENARIO.targetPrompt },
    tags: ["continuity"],
    privacy_tags: [],
  });
  recordHarnessEvent(core, {
    event_id: "continuity-assistant",
    platform: "claude",
    project,
    session_id: CONTINUITY_SCENARIO.previousSessionId,
    correlation_id: CONTINUITY_SCENARIO.targetCorrelationId,
    event_type: "checkpoint",
    ts: "2026-03-24T10:00:05.000Z",
    payload: {
      title: "assistant_response",
      content: CONTINUITY_SCENARIO.targetResponse,
      prompt: CONTINUITY_SCENARIO.targetPrompt,
      last_assistant_message: CONTINUITY_SCENARIO.targetResponse,
    },
    tags: ["continuity"],
    privacy_tags: [],
  });
  recordHarnessEvent(core, {
    event_id: "noise-user",
    platform: "codex",
    project,
    session_id: "continuity-noise-session",
    correlation_id: "corr-noise",
    event_type: "user_prompt",
    ts: "2026-03-24T11:00:00.000Z",
    payload: { content: CONTINUITY_SCENARIO.noisePrompt },
    tags: ["noise"],
    privacy_tags: [],
  });
  recordHarnessEvent(core, {
    event_id: "noise-assistant",
    platform: "codex",
    project,
    session_id: "continuity-noise-session",
    correlation_id: "corr-noise",
    event_type: "checkpoint",
    ts: "2026-03-24T11:00:05.000Z",
    payload: {
      title: "assistant_response",
      content: CONTINUITY_SCENARIO.noiseResponse,
      prompt: CONTINUITY_SCENARIO.noisePrompt,
      last_assistant_message: CONTINUITY_SCENARIO.noiseResponse,
    },
    tags: ["noise"],
    privacy_tags: [],
  });

  const finalize = core.finalizeSession({
    session_id: CONTINUITY_SCENARIO.previousSessionId,
    project,
    platform: "claude",
    summary_mode: "standard",
  });
  if (!finalize.ok) {
    throw new Error("failed to finalize harness continuity session");
  }
}

function createProjectDir(project: string, suffix: string): string {
  const root = mkdtempSync(join(tmpdir(), `harness-mem-project-${suffix}-`));
  const projectDir = join(root, project);
  mkdirSync(projectDir, { recursive: true });
  return projectDir;
}

function writeContinuityState(projectDir: string): void {
  const stateDir = join(projectDir, ".harness-mem", "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "continuity.json"),
    JSON.stringify(
      {
        version: 1,
        project: CONTINUITY_SCENARIO.project,
        sessions: {
          [CONTINUITY_SCENARIO.previousSessionId]: {
            correlation_id: CONTINUITY_SCENARIO.targetCorrelationId,
            platform: "claude",
            origin: "latest_handoff",
            updated_at: "2026-03-24T10:00:10Z",
          },
        },
        latest_handoff: {
          session_id: CONTINUITY_SCENARIO.previousSessionId,
          platform: "claude",
          correlation_id: CONTINUITY_SCENARIO.targetCorrelationId,
          summary_mode: "standard",
          finalized_at: "2026-03-24T10:00:10Z",
          consumed_by_session_id: null,
        },
      },
      null,
      2
    )
  );
}

async function runHook(client: "claude" | "codex"): Promise<HarnessClientScore> {
  const runtime = await createHarnessRuntime(client);
  const projectDir = createProjectDir(CONTINUITY_SCENARIO.project, client);

  try {
    seedHarnessContinuity(runtime.core, CONTINUITY_SCENARIO.project);
    writeContinuityState(projectDir);

    const env = {
      ...process.env,
      HARNESS_MEM_HOST: "127.0.0.1",
      HARNESS_MEM_PORT: runtime.baseUrl.split(":").pop() || "",
    };

    let artifact = "";
    const start = performance.now();

    if (client === "claude") {
      const stateDir = join(projectDir, ".claude", "state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        join(stateDir, "session.json"),
        JSON.stringify({ session_id: "current-claude-session" }, null, 2)
      );
      const proc = Bun.spawn(["bash", CLAUDE_SESSION_START_SCRIPT], {
        cwd: projectDir,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (proc.exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`claude session start failed: ${stderr}`);
      }
      const resumePath = join(stateDir, "memory-resume-context.md");
      artifact = existsSync(resumePath) ? readFileSync(resumePath, "utf8") : "";
    } else {
      const inputPath = join(projectDir, "codex-session-start-input.json");
      writeFileSync(inputPath, JSON.stringify({ session_id: "current-codex-session" }));
      const proc = Bun.spawn(["bash", CODEX_SESSION_START_SCRIPT], {
        cwd: projectDir,
        env,
        stdin: Bun.file(inputPath),
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (proc.exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`codex session start failed: ${stderr}`);
      }
      const stdout = await new Response(proc.stdout).text();
      artifact = extractCodexAdditionalContext(stdout);
    }

    const latencyMs = performance.now() - start;
    const scored = scoreArtifact(artifact);
    return {
      client,
      ...scored,
      latencyMs,
    };
  } finally {
    runtime.stop();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(dirname(projectDir), { recursive: true, force: true });
  }
}

export async function runHarnessFirstTurnContinuityBenchmark(): Promise<HarnessContinuityReport> {
  const claude = await runHook("claude");
  const codex = await runHook("codex");
  return {
    claude,
    codex,
    parity: {
      normalizedEqual: normalizeText(claude.artifact) === normalizeText(codex.artifact),
    },
  };
}

async function waitForClaudeMemHealth(baseUrl: string, timeoutMs: number = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("claude-mem worker did not become healthy");
}

async function withClaudeMemWorker<T>(
  repoPath: string,
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), "claude-mem-session-bench-"));
  const port = Number(process.env.CLAUDE_MEM_BENCH_PORT || 38000 + Math.floor(Math.random() * 1000));
  const extraPath = process.env.CLAUDE_MEM_EXTRA_PATH;
  const env = {
    ...process.env,
    PATH: extraPath ? `${extraPath}:${process.env.PATH || ""}` : process.env.PATH || "",
    CLAUDE_MEM_DATA_DIR: dataDir,
    CLAUDE_MEM_WORKER_PORT: String(port),
    CLAUDE_MEM_CHROMA_ENABLED: process.env.CLAUDE_MEM_CHROMA_ENABLED || "true",
  };
  const baseUrl = `http://127.0.0.1:${port}`;
  let workerProc: ReturnType<typeof Bun.spawn> | null = null;

  try {
    workerProc = Bun.spawn(["bash", "-lc", "exec bun plugin/scripts/worker-service.cjs --daemon"], {
      cwd: repoPath,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      await waitForClaudeMemHealth(baseUrl, 45_000);
    } catch (error) {
      if (workerProc) {
        workerProc.kill();
      }
      const stdout = workerProc ? await new Response(workerProc.stdout).text() : "";
      const stderr = workerProc ? await new Response(workerProc.stderr).text() : "";
      throw new Error(
        `failed to start claude-mem worker: ${stderr || stdout || (error as Error).message}`
      );
    }
    return await fn(baseUrl);
  } finally {
    if (workerProc) {
      workerProc.kill();
      await workerProc.exited;
    }
    const stopProc = Bun.spawn(["bash", "-lc", "bun plugin/scripts/worker-service.cjs stop"], {
      cwd: repoPath,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    await stopProc.exited;
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function seedClaudeMemContinuity(baseUrl: string): Promise<void> {
  const body = {
    sessions: [
      {
        content_session_id: CONTINUITY_SCENARIO.previousSessionId,
        memory_session_id: `mem-${CONTINUITY_SCENARIO.previousSessionId}`,
        project: CONTINUITY_SCENARIO.project,
        user_prompt: CONTINUITY_SCENARIO.targetPrompt,
        started_at: "2026-03-24T10:00:00.000Z",
        started_at_epoch: Date.parse("2026-03-24T10:00:00.000Z"),
        completed_at: "2026-03-24T10:00:10.000Z",
        completed_at_epoch: Date.parse("2026-03-24T10:00:10.000Z"),
        status: "completed",
      },
      {
        content_session_id: "continuity-noise-session",
        memory_session_id: "mem-noise-session",
        project: CONTINUITY_SCENARIO.project,
        user_prompt: CONTINUITY_SCENARIO.noisePrompt,
        started_at: "2026-03-24T11:00:00.000Z",
        started_at_epoch: Date.parse("2026-03-24T11:00:00.000Z"),
        completed_at: "2026-03-24T11:00:10.000Z",
        completed_at_epoch: Date.parse("2026-03-24T11:00:10.000Z"),
        status: "completed",
      },
    ],
    summaries: [
      {
        memory_session_id: `mem-${CONTINUITY_SCENARIO.previousSessionId}`,
        project: CONTINUITY_SCENARIO.project,
        request: "Figure out why new Claude or Codex sessions lose context.",
        investigated: "Compared the startup experience for Claude and Codex.",
        learned: "A continuity briefing is the right first-turn artifact.",
        completed: "Agreed to ship a continuity briefing first.",
        next_steps: "Fix adapter delivery for both Claude and Codex.",
        files_read: null,
        files_edited: null,
        notes: "Users expect the same remembered context across tools.",
        prompt_number: 1,
        discovery_tokens: 0,
        created_at: "2026-03-24T10:00:10.000Z",
        created_at_epoch: Date.parse("2026-03-24T10:00:10.000Z"),
      },
      {
        memory_session_id: "mem-noise-session",
        project: CONTINUITY_SCENARIO.project,
        request: "Regenerate OpenAPI docs.",
        investigated: "Adjusted Swagger dark mode.",
        learned: "The docs pipeline needs cleaner assets.",
        completed: "Refreshed the OpenAPI 3.1 bundle.",
        next_steps: "Polish dark mode styles and database index notes.",
        files_read: null,
        files_edited: null,
        notes: null,
        prompt_number: 1,
        discovery_tokens: 0,
        created_at: "2026-03-24T11:00:10.000Z",
        created_at_epoch: Date.parse("2026-03-24T11:00:10.000Z"),
      },
    ],
    observations: [
      {
        memory_session_id: `mem-${CONTINUITY_SCENARIO.previousSessionId}`,
        project: CONTINUITY_SCENARIO.project,
        text: CONTINUITY_SCENARIO.targetResponse,
        type: "decision",
        title: "Continuity briefing decision",
        subtitle: null,
        facts: JSON.stringify([
          "continuity briefing",
          "adapter delivery",
          "Claude",
          "Codex",
        ]),
        narrative: null,
        concepts: JSON.stringify(["session continuity"]),
        files_read: JSON.stringify([]),
        files_modified: JSON.stringify([]),
        prompt_number: 1,
        discovery_tokens: 0,
        created_at: "2026-03-24T10:00:05.000Z",
        created_at_epoch: Date.parse("2026-03-24T10:00:05.000Z"),
      },
      {
        memory_session_id: "mem-noise-session",
        project: CONTINUITY_SCENARIO.project,
        text: CONTINUITY_SCENARIO.noiseResponse,
        type: "task",
        title: "OpenAPI docs refresh",
        subtitle: null,
        facts: JSON.stringify(["openapi 3.1", "swagger dark mode", "database index"]),
        narrative: null,
        concepts: JSON.stringify(["docs refresh"]),
        files_read: JSON.stringify([]),
        files_modified: JSON.stringify([]),
        prompt_number: 1,
        discovery_tokens: 0,
        created_at: "2026-03-24T11:00:05.000Z",
        created_at_epoch: Date.parse("2026-03-24T11:00:05.000Z"),
      },
    ],
    prompts: [
      {
        content_session_id: CONTINUITY_SCENARIO.previousSessionId,
        prompt_number: 1,
        prompt_text: CONTINUITY_SCENARIO.targetPrompt,
        created_at: "2026-03-24T10:00:00.000Z",
        created_at_epoch: Date.parse("2026-03-24T10:00:00.000Z"),
      },
      {
        content_session_id: "continuity-noise-session",
        prompt_number: 1,
        prompt_text: CONTINUITY_SCENARIO.noisePrompt,
        created_at: "2026-03-24T11:00:00.000Z",
        created_at_epoch: Date.parse("2026-03-24T11:00:00.000Z"),
      },
    ],
  };
  const response = await fetch(`${baseUrl}/api/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`claude-mem import failed: HTTP ${response.status}`);
  }
}

async function waitForClaudeMemSearchData(
  baseUrl: string,
  project: string,
  query: string,
  timeoutMs: number = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const searchUrl = new URL(`${baseUrl}/api/search`);
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("project", project);
    searchUrl.searchParams.set("limit", "5");

    try {
      const response = await fetch(searchUrl);
      if (response.ok) {
        const payload = (await response.json()) as {
          items?: Array<Record<string, unknown>>;
        };
        if ((payload.items || []).length > 0) {
          return;
        }
      }
    } catch {
      // keep polling
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
}

export async function runClaudeMemContinuityBaseline(repoPath: string): Promise<ClaudeMemContinuityReport> {
  return withClaudeMemWorker(repoPath, async (baseUrl) => {
    await seedClaudeMemContinuity(baseUrl);
    const start = performance.now();
    const response = await fetch(
      `${baseUrl}/api/context/inject?project=${encodeURIComponent(CONTINUITY_SCENARIO.project)}`
    );
    const artifact = await response.text();
    if (!response.ok) {
      throw new Error(
        `claude-mem context inject failed: HTTP ${response.status} ${artifact.slice(0, 400)}`
      );
    }
    return {
      client: "claude-mem" as const,
      ...scoreArtifact(artifact),
      latencyMs: performance.now() - start,
    };
  });
}

async function ensureHarnessEmbeddings(core: HarnessMemCore): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const readiness = core.readiness();
    const item = (readiness.items?.[0] ?? {}) as Record<string, unknown>;
    if (item.ready === true) {
      return;
    }
    try {
      await core.primeEmbedding("__ready__", "passage");
      await core.primeEmbedding("__ready__", "query");
    } catch {
      // best effort
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("harness embedding timeout");
}

export async function runMemoryRecallComparison(repoPath: string): Promise<MemoryRecallComparisonReport> {
  const harnessDir = mkdtempSync(join(tmpdir(), "harness-mem-memory-compare-"));
  const harnessConfig: Config = {
    dbPath: join(harnessDir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 384,
    embeddingProvider: "local",
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
  const harnessCore = new HarnessMemCore(harnessConfig);

  try {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = process.env.HARNESS_MEM_EMBEDDING_MODEL || "multilingual-e5";
    await ensureHarnessEmbeddings(harnessCore);

    let eventCounter = 0;
    for (const session of CONTINUITY_SCENARIO.recallSessions) {
      for (const [index, content] of session.steps.entries()) {
        await harnessCore.primeEmbedding(content, "passage");
        recordHarnessEvent(harnessCore, {
          event_id: `recall-${session.sessionId}-${index + 1}`,
          platform: "claude",
          project: CONTINUITY_SCENARIO.recallProject,
          session_id: session.sessionId,
          event_type: "user_prompt",
          ts: new Date(Date.parse("2026-03-24T09:00:00.000Z") + eventCounter * 60_000).toISOString(),
          payload: { content },
          tags: ["recall"],
          privacy_tags: [],
        });
        eventCounter += 1;
      }
    }

    for (const item of CONTINUITY_SCENARIO.recallQueries) {
      await harnessCore.primeEmbedding(item.query, "query");
    }

    const harnessLatencies: number[] = [];
    let harnessHits = 0;
    for (const item of CONTINUITY_SCENARIO.recallQueries) {
      const start = performance.now();
      const result = harnessCore.search({
        query: item.query,
        project: CONTINUITY_SCENARIO.recallProject,
        limit: 5,
      });
      harnessLatencies.push(performance.now() - start);
      const haystack = JSON.stringify(result.items).toLowerCase();
      const hit = item.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
      if (hit) {
        harnessHits += 1;
      }
    }

    const claudeMem = await withClaudeMemWorker(repoPath, async (baseUrl) => {
      let tsIndex = 0;
      for (const session of CONTINUITY_SCENARIO.recallSessions) {
        for (const content of session.steps) {
          const response = await fetch(`${baseUrl}/api/memory/save`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              project: CONTINUITY_SCENARIO.recallProject,
              text: content,
              timestamp: new Date(Date.parse("2026-03-24T09:00:00.000Z") + tsIndex * 60_000).toISOString(),
            }),
          });
          if (!response.ok) {
            throw new Error(`claude-mem memory save failed: HTTP ${response.status}`);
          }
          tsIndex += 1;
        }
      }

      await waitForClaudeMemSearchData(
        baseUrl,
        CONTINUITY_SCENARIO.recallProject,
        "auth middleware"
      );

      const latencies: number[] = [];
      let hits = 0;
      for (const item of CONTINUITY_SCENARIO.recallQueries) {
        const searchUrl = new URL(`${baseUrl}/api/search`);
        searchUrl.searchParams.set("query", item.query);
        searchUrl.searchParams.set("project", CONTINUITY_SCENARIO.recallProject);
        searchUrl.searchParams.set("limit", "5");

        const start = performance.now();
        const response = await fetch(searchUrl);
        const payload = (await response.json()) as {
          items?: Array<Record<string, unknown>>;
        };
        latencies.push(performance.now() - start);
        if (!response.ok) {
          throw new Error(`claude-mem search failed: HTTP ${response.status}`);
        }
        const haystack = JSON.stringify(payload.items || []).toLowerCase();
        const hit = item.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
        if (hit) {
          hits += 1;
        }
      }

      return {
        hits,
        total: CONTINUITY_SCENARIO.recallQueries.length,
        recall: hits / CONTINUITY_SCENARIO.recallQueries.length,
        avgLatencyMs:
          latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length),
      };
    });

    return {
      harness: {
        hits: harnessHits,
        total: CONTINUITY_SCENARIO.recallQueries.length,
        recall: harnessHits / CONTINUITY_SCENARIO.recallQueries.length,
        avgLatencyMs:
          harnessLatencies.reduce((sum, value) => sum + value, 0) /
          Math.max(1, harnessLatencies.length),
      },
      claudeMem,
    };
  } finally {
    harnessCore.shutdown("memory-recall-comparison");
    rmSync(harnessDir, { recursive: true, force: true });
  }
}
