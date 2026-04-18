/**
 * ingest-coordinator.ts
 *
 * 取り込み調整モジュール。
 * HarnessMemCore から物理移動された各プラットフォームのデータ取り込み責務を担う。
 *
 * 担当 API:
 *   - ingestCodexHistory
 *   - ingestOpencodeHistory
 *   - ingestCursorHistory
 *   - ingestAntigravityHistory
 *   - ingestGeminiHistory
 *   - startClaudeMemImport
 *   - getImportJobStatus
 *   - verifyClaudeMemImport
 */

import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ApiResponse, Config, EventEnvelope } from "./types.js";
import {
  clampLimit,
  DEFAULT_ANTIGRAVITY_BACKFILL_HOURS,
  DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS,
  DEFAULT_ANTIGRAVITY_LOGS_ROOT,
  DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT,
  DEFAULT_CURSOR_BACKFILL_HOURS,
  DEFAULT_CURSOR_EVENTS_PATH,
  DEFAULT_CURSOR_INGEST_INTERVAL_MS,
  DEFAULT_CLAUDE_CODE_BACKFILL_HOURS,
  DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS,
  DEFAULT_CLAUDE_CODE_PROJECTS_ROOT,
  DEFAULT_GEMINI_BACKFILL_HOURS,
  DEFAULT_GEMINI_EVENTS_PATH,
  DEFAULT_GEMINI_INGEST_INTERVAL_MS,
  DEFAULT_OPENCODE_BACKFILL_HOURS,
  DEFAULT_OPENCODE_DB_PATH,
  DEFAULT_OPENCODE_INGEST_INTERVAL_MS,
  DEFAULT_OPENCODE_STORAGE_ROOT,
  fileUriToPath,
  generateEventId,
  makeErrorResponse,
  makeResponse,
  nowIso,
  parseJsonSafe,
  resolveHomePath,
  resolveWorkspaceRootFromWorkspaceFile,
  resolveWorkspaceRootFromWorkspaceJson,
  toArraySafe,
  visibilityFilterSql,
} from "./core-utils.js";
import { buildClaudeMemImportPlan, type ClaudeMemImportRequest } from "../ingest/claude-mem-import";
import type { PlatformIngester } from "../ingest/types.js";
import { parseCodexHistoryChunk } from "../ingest/codex-history";
import { parseCodexSessionsChunk, type CodexSessionsContext } from "../ingest/codex-sessions";
import { parseCursorHooksChunk } from "../ingest/cursor-hooks";
import { parseOpencodeDbMessageRow, type OpencodeDbMessageRow } from "../ingest/opencode-db";
import { parseOpencodeMessageChunk } from "../ingest/opencode-storage";
import { parseAntigravityFile } from "../ingest/antigravity-files";
import { parseAntigravityLogChunk } from "../ingest/antigravity-logs";
import { parseGeminiEventsChunk } from "../ingest/gemini-events";
import { parseClaudeCodeChunk, decodeClaudeProjectDir, type ClaudeCodeContext } from "../ingest/claude-code-sessions";
import { parseGitHubIssues } from "../connectors/github-issues";
import { parseDecisionsMd, parseAdrFile, type AdrObservation } from "../connectors/adr-decisions";

// ---------------------------------------------------------------------------
// モジュールレベルのヘルパー
// ---------------------------------------------------------------------------

function normalizeProjectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("project name must not be empty");
  return trimmed;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// ---------------------------------------------------------------------------
// ファイルリスト系ヘルパー（core から移動）
// ---------------------------------------------------------------------------

function listCodexRolloutFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true, encoding: "utf8" }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/^rollout-.*\.jsonl$/i.test(entry.name)) continue;
      files.push(resolve(fullPath));
    }
  }

  files.sort((lhs, rhs) => lhs.localeCompare(rhs));
  return files;
}

function inferSessionIdFromRolloutPath(filePath: string): string | null {
  const fileName = basename(filePath);
  if (!fileName.startsWith("rollout-") || !fileName.endsWith(".jsonl")) {
    return null;
  }
  const match = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] || null;
}

function listOpencodeMessageFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true, encoding: "utf8" }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/^msg_.*\.json$/i.test(entry.name)) continue;
      files.push(resolve(fullPath));
    }
  }

  files.sort((lhs, rhs) => lhs.localeCompare(rhs));
  return files;
}

function listOpencodeSessionFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true, encoding: "utf8" }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/^ses_.*\.json$/i.test(entry.name)) continue;
      files.push(resolve(fullPath));
    }
  }

  files.sort((lhs, rhs) => lhs.localeCompare(rhs));
  return files;
}

function listMarkdownFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true, encoding: "utf8" }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.md$/i.test(entry.name)) continue;
      files.push(resolve(fullPath));
    }
  }

  files.sort((lhs, rhs) => lhs.localeCompare(rhs));
  return files;
}

function listAntigravityPlannerLogFiles(logsRoot: string): string[] {
  const files: string[] = [];
  const stack: string[] = [logsRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true, encoding: "utf8" }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name !== "Antigravity.log") continue;
      if (!fullPath.replace(/\\/g, "/").includes("/google.antigravity/")) continue;
      files.push(resolve(fullPath));
    }
  }

  files.sort((lhs, rhs) => lhs.localeCompare(rhs));
  return files;
}

// ---------------------------------------------------------------------------
// サマリー型
// ---------------------------------------------------------------------------

interface CodexIngestSummary {
  eventsImported: number;
  filesScanned: number;
  filesSkippedBackfill: number;
  sessionsEventsImported: number;
  historyEventsImported: number;
}

function emptyCodexIngestSummary(): CodexIngestSummary {
  return {
    eventsImported: 0,
    filesScanned: 0,
    filesSkippedBackfill: 0,
    sessionsEventsImported: 0,
    historyEventsImported: 0,
  };
}

function mergeCodexIngestSummary(target: CodexIngestSummary, partial: CodexIngestSummary): void {
  target.eventsImported += partial.eventsImported;
  target.filesScanned += partial.filesScanned;
  target.filesSkippedBackfill += partial.filesSkippedBackfill;
  target.sessionsEventsImported += partial.sessionsEventsImported;
  target.historyEventsImported += partial.historyEventsImported;
}

interface OpencodeIngestSummary {
  eventsImported: number;
  filesScanned: number;
  filesSkippedBackfill: number;
  dbEventsImported: number;
  storageEventsImported: number;
}

function emptyOpencodeIngestSummary(): OpencodeIngestSummary {
  return {
    eventsImported: 0,
    filesScanned: 0,
    filesSkippedBackfill: 0,
    dbEventsImported: 0,
    storageEventsImported: 0,
  };
}

function mergeOpencodeIngestSummary(target: OpencodeIngestSummary, partial: OpencodeIngestSummary): void {
  target.eventsImported += partial.eventsImported;
  target.filesScanned += partial.filesScanned;
  target.filesSkippedBackfill += partial.filesSkippedBackfill;
  target.dbEventsImported += partial.dbEventsImported;
  target.storageEventsImported += partial.storageEventsImported;
}

interface CursorIngestSummary {
  eventsImported: number;
  filesScanned: number;
  filesSkippedBackfill: number;
  hooksEventsImported: number;
}

function emptyCursorIngestSummary(): CursorIngestSummary {
  return {
    eventsImported: 0,
    filesScanned: 0,
    filesSkippedBackfill: 0,
    hooksEventsImported: 0,
  };
}

function mergeCursorIngestSummary(target: CursorIngestSummary, partial: CursorIngestSummary): void {
  target.eventsImported += partial.eventsImported;
  target.filesScanned += partial.filesScanned;
  target.filesSkippedBackfill += partial.filesSkippedBackfill;
  target.hooksEventsImported += partial.hooksEventsImported;
}

interface AntigravityIngestSummary {
  eventsImported: number;
  filesScanned: number;
  filesSkippedBackfill: number;
  rootsScanned: number;
  checkpointEventsImported: number;
  toolEventsImported: number;
  logEventsImported: number;
  logFilesScanned: number;
}

function emptyAntigravityIngestSummary(): AntigravityIngestSummary {
  return {
    eventsImported: 0,
    filesScanned: 0,
    filesSkippedBackfill: 0,
    rootsScanned: 0,
    checkpointEventsImported: 0,
    toolEventsImported: 0,
    logEventsImported: 0,
    logFilesScanned: 0,
  };
}

function mergeAntigravityIngestSummary(target: AntigravityIngestSummary, partial: AntigravityIngestSummary): void {
  target.eventsImported += partial.eventsImported;
  target.filesScanned += partial.filesScanned;
  target.filesSkippedBackfill += partial.filesSkippedBackfill;
  target.rootsScanned += partial.rootsScanned;
  target.checkpointEventsImported += partial.checkpointEventsImported;
  target.toolEventsImported += partial.toolEventsImported;
  target.logEventsImported += partial.logEventsImported;
  target.logFilesScanned += partial.logFilesScanned;
}

interface GeminiIngestSummary {
  eventsImported: number;
  filesScanned: number;
  filesSkippedBackfill: number;
}

function emptyGeminiIngestSummary(): GeminiIngestSummary {
  return {
    eventsImported: 0,
    filesScanned: 0,
    filesSkippedBackfill: 0,
  };
}

// ---------------------------------------------------------------------------
// IngestCoordinatorDeps: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface IngestCoordinatorDeps {
  db: Database;
  config: Config;
  recordEvent: (event: EventEnvelope, options?: { allowQueue: boolean }) => ApiResponse;
  upsertSessionSummary: (
    sessionId: string,
    platform: string,
    project: string,
    summary: string,
    endedAt: string,
    summaryMode: string
  ) => void;
  // タイマー管理に必要な追加依存
  heartbeatPath: string;
  isShuttingDown: () => boolean;
  processRetryQueue: (force?: boolean) => void;
  runConsolidation: (opts: { reason: string; limit: number }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// IngestCoordinator クラス
// ---------------------------------------------------------------------------

const SQLITE_HEADER = "SQLite format 3\u0000";

export class IngestCoordinator {
  private readonly codexRolloutContextCache = new Map<string, CodexSessionsContext>();

  // タイマーハンドル（startTimers / stopTimers で管理）
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ingestTimer: ReturnType<typeof setInterval> | null = null;
  private opencodeIngestTimer: ReturnType<typeof setInterval> | null = null;
  private cursorIngestTimer: ReturnType<typeof setInterval> | null = null;
  private antigravityIngestTimer: ReturnType<typeof setInterval> | null = null;
  private geminiIngestTimer: ReturnType<typeof setInterval> | null = null;
  private claudeCodeIngestStartTimer: ReturnType<typeof setTimeout> | null = null;
  private claudeCodeIngestTimer: ReturnType<typeof setInterval> | null = null;
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;

  // PlatformIngester 登録管理（ARC-019: 宣言的ポーリング管理）
  private readonly registeredIngesters: PlatformIngester[] = [];
  private readonly ingesterTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly deps: IngestCoordinatorDeps) {}

  // ---------------------------------------------------------------------------
  // タイマー管理
  // ---------------------------------------------------------------------------

  /** heartbeat + ingest ポーリングタイマーを開始する */
  startTimers(): void {
    const { config } = this.deps;

    this.heartbeatTimer = setInterval(() => {
      if (this.deps.isShuttingDown()) return;
      this.writeHeartbeat();
    }, 5000);

    if (config.codexHistoryEnabled) {
      this.ingestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        try { this.ingestCodexHistory(); } catch { /* ignore post-shutdown DB errors */ }
      }, config.codexIngestIntervalMs);
    }

    if (config.opencodeIngestEnabled !== false) {
      this.opencodeIngestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        try { this.ingestOpencodeHistory(); } catch { /* ignore post-shutdown DB errors */ }
      }, clampLimit(Number(config.opencodeIngestIntervalMs || DEFAULT_OPENCODE_INGEST_INTERVAL_MS), DEFAULT_OPENCODE_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (config.cursorIngestEnabled !== false) {
      this.cursorIngestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        try { this.ingestCursorHistory(); } catch { /* ignore post-shutdown DB errors */ }
      }, clampLimit(Number(config.cursorIngestIntervalMs || DEFAULT_CURSOR_INGEST_INTERVAL_MS), DEFAULT_CURSOR_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (config.antigravityIngestEnabled !== false) {
      this.antigravityIngestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        try { this.ingestAntigravityHistory(); } catch { /* ignore post-shutdown DB errors */ }
      }, clampLimit(Number(config.antigravityIngestIntervalMs || DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS), DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (config.geminiIngestEnabled !== false) {
      this.geminiIngestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        try { this.ingestGeminiHistory(); } catch { /* ignore post-shutdown DB errors */ }
      }, clampLimit(Number(config.geminiIngestIntervalMs || DEFAULT_GEMINI_INGEST_INTERVAL_MS), DEFAULT_GEMINI_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (config.claudeCodeIngestEnabled !== false) {
      const ccInterval = clampLimit(Number(config.claudeCodeIngestIntervalMs || DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS), DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS, 1000, 300000);
      const runClaudeCodeIngest = () => {
        if (this.deps.isShuttingDown()) return;
        try { this.ingestClaudeCodeSessions(); } catch { /* ignore post-shutdown DB errors */ }
      };
      // 起動完了直後の次ティックで一度取り込み、その後 interval に移る。
      this.claudeCodeIngestStartTimer = setTimeout(() => {
        this.claudeCodeIngestStartTimer = null;
        if (this.deps.isShuttingDown()) return;
        runClaudeCodeIngest();
        this.claudeCodeIngestTimer = setInterval(runClaudeCodeIngest, ccInterval);
      }, 0);
    }

    if (config.consolidationEnabled !== false) {
      let consolidationRunning = false;
      this.consolidationTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        if (consolidationRunning) return;
        consolidationRunning = true;
        void this.deps.runConsolidation({ reason: "scheduler", limit: 10 }).finally(() => {
          consolidationRunning = false;
        });
      }, clampLimit(Number(config.consolidationIntervalMs || 60000), 60000, 5000, 600000));
    }

    this.retryTimer = setInterval(() => {
      if (this.deps.isShuttingDown()) return;
      try { this.deps.processRetryQueue(); } catch { /* ignore post-shutdown DB errors */ }
    }, 15000);

    this.checkpointTimer = setInterval(() => {
      if (this.deps.isShuttingDown()) return;
      try { this.deps.db.exec("PRAGMA wal_checkpoint(PASSIVE);"); } catch { /* ignore post-shutdown DB errors */ }
    }, 60000);

    this.writeHeartbeat();
  }

  /** 全タイマーを停止する (shutdown 時に呼ぶ) */
  stopTimers(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.ingestTimer) { clearInterval(this.ingestTimer); this.ingestTimer = null; }
    if (this.opencodeIngestTimer) { clearInterval(this.opencodeIngestTimer); this.opencodeIngestTimer = null; }
    if (this.cursorIngestTimer) { clearInterval(this.cursorIngestTimer); this.cursorIngestTimer = null; }
    if (this.antigravityIngestTimer) { clearInterval(this.antigravityIngestTimer); this.antigravityIngestTimer = null; }
    if (this.geminiIngestTimer) { clearInterval(this.geminiIngestTimer); this.geminiIngestTimer = null; }
    if (this.claudeCodeIngestStartTimer) { clearTimeout(this.claudeCodeIngestStartTimer); this.claudeCodeIngestStartTimer = null; }
    if (this.claudeCodeIngestTimer) { clearInterval(this.claudeCodeIngestTimer); this.claudeCodeIngestTimer = null; }
    if (this.consolidationTimer) { clearInterval(this.consolidationTimer); this.consolidationTimer = null; }
    if (this.retryTimer) { clearInterval(this.retryTimer); this.retryTimer = null; }
    if (this.checkpointTimer) { clearInterval(this.checkpointTimer); this.checkpointTimer = null; }
  }

  // ---------------------------------------------------------------------------
  // PlatformIngester 宣言的ポーリング管理 (ARC-019)
  // ---------------------------------------------------------------------------

  /**
   * PlatformIngester を登録する。
   * startAll() を呼ぶ前に登録しておくと、pollIntervalMs に基づいて
   * タイマーが自動設定される。
   * 同名の ingester が既に登録されている場合は上書きしない。
   */
  registerIngester(ingester: PlatformIngester): void {
    const alreadyRegistered = this.registeredIngesters.some((i) => i.name === ingester.name);
    if (!alreadyRegistered) {
      this.registeredIngesters.push(ingester);
    }
  }

  /**
   * 登録された全 ingester のポーリングタイマーを一括起動する。
   * pollIntervalMs が 0 の ingester はスキップする。
   * 既に起動済みの ingester はスキップする（冪等）。
   */
  startAll(): void {
    const isShuttingDown = this.deps.isShuttingDown?.bind(this.deps);
    for (const ingester of this.registeredIngesters) {
      if (ingester.pollIntervalMs <= 0) continue;
      if (this.ingesterTimers.has(ingester.name)) continue;

      const timer = setInterval(() => {
        if (isShuttingDown?.()) return;
        ingester.poll().catch(() => { /* ignore post-shutdown errors */ });
      }, ingester.pollIntervalMs);

      this.ingesterTimers.set(ingester.name, timer);
    }
  }

  /**
   * startAll() で起動した全 ingester のタイマーを一括停止する。
   */
  stopAll(): void {
    for (const [name, timer] of this.ingesterTimers) {
      clearInterval(timer);
      this.ingesterTimers.delete(name);
    }
  }

  private writeHeartbeat(): void {
    try {
      writeFileSync(this.deps.heartbeatPath, JSON.stringify({ pid: process.pid, ts: nowIso() }));
    } catch {
      // best effort
    }
  }

  // ---------------------------------------------------------------------------
  // オフセット管理
  // ---------------------------------------------------------------------------

  private updateIngestOffset(sourceKey: string, offset: number): void {
    this.deps.db
      .query(
        `
          INSERT INTO mem_ingest_offsets(source_key, offset, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(source_key) DO UPDATE SET
            offset = excluded.offset,
            updated_at = excluded.updated_at
        `
      )
      .run(sourceKey, Math.max(0, Math.floor(offset)), nowIso());
  }

  // ---------------------------------------------------------------------------
  // Codex セッションコンテキスト管理
  // ---------------------------------------------------------------------------

  private loadCodexRolloutContext(sourceKey: string): CodexSessionsContext {
    const cached = this.codexRolloutContextCache.get(sourceKey);
    if (cached) {
      return { ...cached };
    }

    const metaKey = `codex_rollout_context:${sourceKey}`;
    const row = this.deps.db
      .query(`SELECT value FROM mem_meta WHERE key = ?`)
      .get(metaKey) as { value?: string } | null;

    if (!row?.value) {
      return {};
    }

    const parsed = parseJsonSafe(row.value);
    const context: CodexSessionsContext = {
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id.trim() : undefined,
      project: typeof parsed.project === "string" ? parsed.project.trim() : undefined,
      lastUserPrompt: typeof parsed.last_user_prompt === "string" ? parsed.last_user_prompt.trim() : undefined,
      lastAssistantContent:
        typeof parsed.last_assistant_content === "string" ? parsed.last_assistant_content.trim() : undefined,
    };
    this.codexRolloutContextCache.set(sourceKey, context);
    return { ...context };
  }

  private storeCodexRolloutContext(sourceKey: string, context: CodexSessionsContext): void {
    const sessionId = typeof context.sessionId === "string" ? context.sessionId.trim() : "";
    const project = typeof context.project === "string" ? context.project.trim() : "";
    const lastUserPrompt =
      typeof context.lastUserPrompt === "string" ? context.lastUserPrompt.trim().slice(0, 4000) : "";
    const lastAssistantContent =
      typeof context.lastAssistantContent === "string" ? context.lastAssistantContent.trim().slice(0, 4000) : "";
    if (!sessionId && !project && !lastUserPrompt && !lastAssistantContent) {
      return;
    }

    const normalized: CodexSessionsContext = {
      sessionId: sessionId || undefined,
      project: project || undefined,
      lastUserPrompt: lastUserPrompt || undefined,
      lastAssistantContent: lastAssistantContent || undefined,
    };

    const metaKey = `codex_rollout_context:${sourceKey}`;
    this.deps.db
      .query(
        `
          INSERT INTO mem_meta(key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `
      )
      .run(
        metaKey,
        JSON.stringify({
          session_id: normalized.sessionId || "",
          project: normalized.project || "",
          last_user_prompt: normalized.lastUserPrompt || "",
          last_assistant_content: normalized.lastAssistantContent || "",
        }),
        nowIso()
      );

    this.codexRolloutContextCache.set(sourceKey, normalized);
  }

  // ---------------------------------------------------------------------------
  // インポートジョブ管理
  // ---------------------------------------------------------------------------

  private createImportJob(jobId: string, sourceDbPath: string, dryRun: boolean): void {
    const requestedAt = nowIso();
    this.deps.db
      .query(`
        INSERT INTO mem_import_jobs(
          job_id, source, source_db_path, status, dry_run,
          requested_at, started_at, result_json
        ) VALUES (?, 'claude-mem', ?, 'running', ?, ?, ?, '{}')
      `)
      .run(jobId, sourceDbPath, dryRun ? 1 : 0, requestedAt, requestedAt);
  }

  private updateImportJob(params: {
    jobId: string;
    status: "running" | "completed" | "failed";
    result: Record<string, unknown>;
    error?: string;
  }): void {
    this.deps.db
      .query(`
        UPDATE mem_import_jobs
        SET status = ?, result_json = ?, error = ?, finished_at = CASE WHEN ? = 'running' THEN finished_at ELSE ? END
        WHERE job_id = ?
      `)
      .run(
        params.status,
        JSON.stringify(params.result || {}),
        params.error || null,
        params.status,
        params.status === "running" ? null : nowIso(),
        params.jobId
      );
  }

  // ---------------------------------------------------------------------------
  // Opencode ヘルパー
  // ---------------------------------------------------------------------------

  private getOpencodeStorageRoot(): string {
    return resolveHomePath(this.deps.config.opencodeStorageRoot || DEFAULT_OPENCODE_STORAGE_ROOT);
  }

  private getOpencodeDbPath(): string {
    const configured = this.deps.config.opencodeDbPath;
    if (typeof configured === "string" && configured.trim()) {
      return resolveHomePath(configured);
    }
    return resolve(join(dirname(this.getOpencodeStorageRoot()), "opencode.db"));
  }

  private getOpencodeBackfillHours(): number {
    return clampLimit(
      Number(this.deps.config.opencodeBackfillHours || DEFAULT_OPENCODE_BACKFILL_HOURS),
      DEFAULT_OPENCODE_BACKFILL_HOURS,
      1,
      24 * 365
    );
  }

  private isOpencodeIngestEnabled(): boolean {
    return this.deps.config.opencodeIngestEnabled !== false;
  }

  private readOpencodeMessageTextFromDb(sourceDb: Database, messageId: string): string {
    if (!messageId.trim()) {
      return "";
    }

    let rows: Array<{ data: string }>;
    try {
      rows = sourceDb
        .query(`SELECT data FROM part WHERE message_id = ? ORDER BY rowid ASC`)
        .all(messageId) as Array<{ data: string }>;
    } catch {
      return "";
    }

    const texts: string[] = [];
    for (const row of rows) {
      const parsed = parseJsonSafe(row.data);
      if (typeof parsed.type !== "string" || parsed.type !== "text") continue;
      if (typeof parsed.text !== "string") continue;
      const text = parsed.text.trim();
      if (!text) continue;
      texts.push(text);
    }

    return texts.join("\n\n").slice(0, 12000);
  }

  private loadOpencodeSessionDirectoryMap(sessionsRoot: string): Map<string, string> {
    const map = new Map<string, string>();
    const sessionFiles = listOpencodeSessionFiles(sessionsRoot);
    for (const filePath of sessionFiles) {
      let raw = "";
      try {
        raw = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const parsed = parseJsonSafe(raw);
      const sessionId = typeof parsed.id === "string" ? parsed.id.trim() : "";
      const directory = typeof parsed.directory === "string" ? parsed.directory.trim() : "";
      if (!sessionId || !directory) continue;
      map.set(sessionId, directory);
    }
    return map;
  }

  private readOpencodeMessageText(partsRoot: string, messageId: string): string {
    if (!messageId) {
      return "";
    }

    const messagePartDir = join(partsRoot, messageId);
    if (!existsSync(messagePartDir)) {
      return "";
    }

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(messagePartDir, { withFileTypes: true, encoding: "utf8" }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      return "";
    }

    const texts: string[] = [];
    const files = entries
      .filter((entry) => entry.isFile() && /^prt_.*\.json$/i.test(entry.name))
      .map((entry) => join(messagePartDir, entry.name))
      .sort((lhs, rhs) => lhs.localeCompare(rhs));

    for (const partPath of files) {
      let raw = "";
      try {
        raw = readFileSync(partPath, "utf8");
      } catch {
        continue;
      }
      const parsed = parseJsonSafe(raw);
      if (typeof parsed.type !== "string" || parsed.type !== "text") continue;
      if (typeof parsed.text !== "string") continue;
      const text = parsed.text.trim();
      if (!text) continue;
      texts.push(text);
    }

    return texts.join("\n\n").slice(0, 12000);
  }

  // ---------------------------------------------------------------------------
  // Cursor ヘルパー
  // ---------------------------------------------------------------------------

  private isCursorIngestEnabled(): boolean {
    return this.deps.config.cursorIngestEnabled !== false;
  }

  private getCursorEventsPath(): string {
    return resolveHomePath(this.deps.config.cursorEventsPath || DEFAULT_CURSOR_EVENTS_PATH);
  }

  private getCursorBackfillHours(): number {
    return clampLimit(
      Number(this.deps.config.cursorBackfillHours || DEFAULT_CURSOR_BACKFILL_HOURS),
      DEFAULT_CURSOR_BACKFILL_HOURS,
      1,
      24 * 365
    );
  }

  // ---------------------------------------------------------------------------
  // Antigravity ヘルパー
  // ---------------------------------------------------------------------------

  private isAntigravityIngestEnabled(): boolean {
    return this.deps.config.antigravityIngestEnabled !== false;
  }

  private getAntigravityLogsRoot(): string {
    return resolveHomePath(this.deps.config.antigravityLogsRoot || DEFAULT_ANTIGRAVITY_LOGS_ROOT);
  }

  private getAntigravityWorkspaceStorageRoot(): string {
    return resolveHomePath(
      this.deps.config.antigravityWorkspaceStorageRoot || DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT
    );
  }

  private getAntigravityBackfillHours(): number {
    return clampLimit(
      Number(this.deps.config.antigravityBackfillHours || DEFAULT_ANTIGRAVITY_BACKFILL_HOURS),
      DEFAULT_ANTIGRAVITY_BACKFILL_HOURS,
      1,
      24 * 365
    );
  }

  private getConfiguredAntigravityWorkspaceRoots(): string[] {
    const roots = Array.isArray(this.deps.config.antigravityWorkspaceRoots)
      ? this.deps.config.antigravityWorkspaceRoots
      : [];
    return roots
      .map((root) => (typeof root === "string" ? root.trim() : ""))
      .filter((root) => root.length > 0)
      .map((root) => resolveHomePath(root));
  }

  private discoverAntigravityWorkspaceRootsFromStorage(): string[] {
    const storageRoot = this.getAntigravityWorkspaceStorageRoot();
    if (!existsSync(storageRoot)) {
      return [];
    }

    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = readdirSync(storageRoot, { withFileTypes: true, encoding: "utf8" }) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      return [];
    }

    const discovered: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspaceJsonPath = join(storageRoot, entry.name, "workspace.json");
      if (!existsSync(workspaceJsonPath)) continue;
      const resolvedRoot = resolveWorkspaceRootFromWorkspaceJson(workspaceJsonPath);
      if (!resolvedRoot || !existsSync(resolvedRoot)) continue;
      discovered.push(resolve(resolvedRoot));
    }

    return [...new Set(discovered)].sort((lhs, rhs) => lhs.localeCompare(rhs));
  }

  private getAntigravityWorkspaceRoots(): string[] {
    const configuredRoots = this.getConfiguredAntigravityWorkspaceRoots();
    if (configuredRoots.length > 0) {
      return [...new Set(configuredRoots)].sort((lhs, rhs) => lhs.localeCompare(rhs));
    }

    const discovered = this.discoverAntigravityWorkspaceRootsFromStorage();
    if (discovered.length > 0) {
      return discovered;
    }

    const fallbackRoot = resolve(this.deps.config.codexProjectRoot || process.cwd());
    if (fallbackRoot && existsSync(fallbackRoot)) {
      return [fallbackRoot];
    }

    return [];
  }

  private resolveAntigravityWorkspaceStorageIdFromLogFile(logFilePath: string): string {
    const exthostDir = dirname(dirname(logFilePath));
    const exthostLog = join(exthostDir, "exthost.log");
    if (!existsSync(exthostLog)) return "";

    let text = "";
    try {
      text = readFileSync(exthostLog, "utf8");
    } catch {
      return "";
    }
    if (!text) return "";

    const matches = [...text.matchAll(/workspaceStorage\/([0-9a-z]{8,})/gi)];
    if (matches.length === 0) return "";
    const latest = matches[matches.length - 1];
    return (latest?.[1] || "").trim();
  }

  private resolveAntigravityWorkspaceRootByStorageId(storageId: string): string {
    const normalized = (storageId || "").trim();
    if (!normalized) return "";
    const workspaceJsonPath = join(this.getAntigravityWorkspaceStorageRoot(), normalized, "workspace.json");
    if (!existsSync(workspaceJsonPath)) return "";
    const resolvedRoot = resolveWorkspaceRootFromWorkspaceJson(workspaceJsonPath);
    if (!resolvedRoot || !existsSync(resolvedRoot)) return "";
    return resolve(resolvedRoot);
  }

  private resolveAntigravityLogProject(logFilePath: string): { project: string; workspaceRoot: string; sessionSeed: string } {
    const storageId = this.resolveAntigravityWorkspaceStorageIdFromLogFile(logFilePath);
    const workspaceRoot = this.resolveAntigravityWorkspaceRootByStorageId(storageId);
    const fallbackProject = normalizeProjectName(resolve(this.deps.config.codexProjectRoot || process.cwd()));
    const project = workspaceRoot ? normalizeProjectName(resolve(workspaceRoot)) : fallbackProject;

    const sessionDir = basename(dirname(dirname(dirname(dirname(logFilePath)))));
    const sessionSeed = [project || "unknown", storageId || sessionDir || "planner"].filter(Boolean).join(":");
    return { project, workspaceRoot, sessionSeed };
  }

  // ---------------------------------------------------------------------------
  // Gemini ヘルパー
  // ---------------------------------------------------------------------------

  private isGeminiIngestEnabled(): boolean {
    return this.deps.config.geminiIngestEnabled !== false;
  }

  private getGeminiEventsPath(): string {
    return resolveHomePath(this.deps.config.geminiEventsPath || DEFAULT_GEMINI_EVENTS_PATH);
  }

  private getGeminiBackfillHours(): number {
    return clampLimit(
      Number(this.deps.config.geminiBackfillHours || DEFAULT_GEMINI_BACKFILL_HOURS),
      DEFAULT_GEMINI_BACKFILL_HOURS,
      1,
      24 * 365
    );
  }

  // ---------------------------------------------------------------------------
  // Codex ingest メソッド（core から移動）
  // ---------------------------------------------------------------------------

  private ingestCodexSessionsRollouts(): CodexIngestSummary {
    const summary = emptyCodexIngestSummary();
    const sessionsRoot = resolveHomePath(this.deps.config.codexSessionsRoot);
    if (!existsSync(sessionsRoot)) {
      return summary;
    }

    const files = listCodexRolloutFiles(sessionsRoot);
    const defaultProject = normalizeProjectName(resolve(this.deps.config.codexProjectRoot));
    const cutoffMs = Date.now() - Math.max(0, this.deps.config.codexBackfillHours) * 60 * 60 * 1000;

    for (const rolloutPath of files) {
      summary.filesScanned += 1;
      const sourceKey = `codex_rollout:${resolve(rolloutPath)}`;

      let fileSize = 0;
      let mtimeMs = Date.now();
      try {
        const stats = statSync(rolloutPath);
        fileSize = stats.size;
        mtimeMs = stats.mtimeMs;
      } catch {
        continue;
      }

      const offsetRow = this.deps.db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(sourceKey) as { offset: number } | null;

      const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
      let offset = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

      if (!hasOffset && mtimeMs < cutoffMs) {
        this.updateIngestOffset(sourceKey, fileSize);
        summary.filesSkippedBackfill += 1;
        continue;
      }

      if (offset > fileSize) {
        offset = 0;
      }
      if (offset === fileSize) {
        continue;
      }

      let chunk = "";
      try {
        const buffer = readFileSync(rolloutPath);
        chunk = buffer.subarray(offset).toString("utf8");
      } catch {
        continue;
      }

      const context = this.loadCodexRolloutContext(sourceKey);
      const fallbackSessionId = inferSessionIdFromRolloutPath(rolloutPath) || context.sessionId || undefined;
      const parsedChunk = parseCodexSessionsChunk({
        sourceKey,
        baseOffset: offset,
        chunk,
        fallbackNowIso: nowIso,
        context,
        defaultSessionId: fallbackSessionId,
        defaultProject: defaultProject,
      });

      let imported = 0;
      const committedContext: CodexSessionsContext = {
        sessionId: parsedChunk.context.sessionId || fallbackSessionId,
        project: parsedChunk.context.project || defaultProject,
        lastUserPrompt: context.lastUserPrompt,
        lastAssistantContent: context.lastAssistantContent,
      };
      let nextOffset = offset + parsedChunk.consumedBytes;
      for (const entry of parsedChunk.events) {
        const result = this.deps.recordEvent(
          {
            platform: "codex",
            project: entry.project,
            session_id: entry.sessionId,
            event_type: entry.eventType,
            ts: entry.timestamp,
            payload: entry.payload,
            tags: ["codex_sessions_ingest"],
            privacy_tags: [],
            dedupe_hash: entry.dedupeHash,
          },
          { allowQueue: false }
        );
        if (!result.ok) {
          nextOffset = Math.max(offset, entry.lineOffset);
          break;
        }
        const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
        if (result.ok && !deduped) {
          imported += 1;
        }
        committedContext.sessionId = entry.sessionId || committedContext.sessionId;
        committedContext.project = entry.project || committedContext.project;
        if (entry.eventType === "user_prompt") {
          const prompt = normalizeString(entry.payload.prompt) || normalizeString(entry.payload.content);
          if (prompt) {
            committedContext.lastUserPrompt = prompt;
          }
        }
        if (entry.eventType === "checkpoint") {
          const assistantContent = normalizeString(entry.payload.content);
          if (assistantContent) {
            committedContext.lastAssistantContent = assistantContent;
          }
        }
      }

      summary.eventsImported += imported;
      summary.sessionsEventsImported += imported;

      this.storeCodexRolloutContext(sourceKey, committedContext);
      this.updateIngestOffset(sourceKey, nextOffset);
    }

    return summary;
  }

  private ingestLegacyCodexHistoryFile(): CodexIngestSummary {
    const summary = emptyCodexIngestSummary();
    const historyPath = join(this.deps.config.codexProjectRoot, ".codex", "history.jsonl");
    if (!existsSync(historyPath)) {
      return summary;
    }

    summary.filesScanned += 1;
    let contentBuffer: Buffer;
    try {
      contentBuffer = readFileSync(historyPath);
    } catch {
      return summary;
    }

    const sourceKey = `codex_history:${resolve(this.deps.config.codexProjectRoot)}`;
    const offsetRow = this.deps.db
      .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
      .get(sourceKey) as { offset: number } | null;

    let offset = offsetRow?.offset ?? 0;
    if (offset > contentBuffer.length) {
      offset = 0;
    }
    if (offset === contentBuffer.length) {
      return summary;
    }

    const chunk = contentBuffer.subarray(offset).toString("utf8");
    const parsedChunk = parseCodexHistoryChunk({
      sourceKey,
      baseOffset: offset,
      chunk,
      fallbackNowIso: nowIso,
    });
    const project = normalizeProjectName(resolve(this.deps.config.codexProjectRoot));

    let imported = 0;
    for (const entry of parsedChunk.events) {
      const result = this.deps.recordEvent(
        {
          platform: "codex",
          project,
          session_id: entry.sessionId,
          event_type: entry.eventType,
          ts: entry.timestamp,
          payload: entry.parsed,
          tags: ["codex_history_ingest"],
          privacy_tags: [],
          dedupe_hash: entry.dedupeHash,
        },
        { allowQueue: false }
      );
      const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
      if (result.ok && !deduped) {
        imported += 1;
      }
    }

    const consumedBytes = Buffer.byteLength(chunk.slice(0, parsedChunk.consumedLength), "utf8");
    this.updateIngestOffset(sourceKey, offset + consumedBytes);

    summary.eventsImported += imported;
    summary.historyEventsImported += imported;
    return summary;
  }

  ingestCodexHistory(): ApiResponse {
    const startedAt = performance.now();
    const summary = emptyCodexIngestSummary();

    if (!this.deps.config.codexHistoryEnabled) {
      return makeResponse(
        startedAt,
        [
          {
            events_imported: 0,
            files_scanned: 0,
            files_skipped_backfill: 0,
            sessions_events_imported: 0,
            history_events_imported: 0,
          },
        ],
        {},
        { ingest_mode: "disabled" }
      );
    }

    mergeCodexIngestSummary(summary, this.ingestCodexSessionsRollouts());
    mergeCodexIngestSummary(summary, this.ingestLegacyCodexHistoryFile());

    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
          sessions_events_imported: summary.sessionsEventsImported,
          history_events_imported: summary.historyEventsImported,
        },
      ],
      {},
      { ingest_mode: "codex_hybrid_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // Opencode ingest メソッド（core から移動）
  // ---------------------------------------------------------------------------

  private ingestOpencodeDbMessages(): OpencodeIngestSummary {
    const summary = emptyOpencodeIngestSummary();
    const sourceDbPath = this.getOpencodeDbPath();
    if (!existsSync(sourceDbPath)) {
      return summary;
    }

    summary.filesScanned += 1;
    const sourceKey = `opencode_db_message:${resolve(sourceDbPath)}`;
    const cutoffMs = Date.now() - Math.max(0, this.getOpencodeBackfillHours()) * 60 * 60 * 1000;
    const offsetRow = this.deps.db
      .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
      .get(sourceKey) as { offset: number } | null;
    const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
    let cursor = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

    let sourceDb: Database | null = null;
    try {
      sourceDb = new Database(sourceDbPath, { readonly: true, create: false });

      const maxRow =
        (sourceDb.query(`SELECT COALESCE(MAX(rowid), 0) AS max_rowid FROM message`).get() as { max_rowid?: number } | null)
          ?.max_rowid || 0;

      const rows = (hasOffset
        ? sourceDb
            .query(
              `
                SELECT
                  m.rowid AS rowid,
                  m.id AS message_id,
                  m.session_id AS session_id,
                  m.time_created AS time_created,
                  m.data AS message_data,
                  COALESCE(s.directory, '') AS session_directory
                FROM message m
                LEFT JOIN session s ON s.id = m.session_id
                WHERE m.rowid > ?
                ORDER BY m.rowid ASC
              `
            )
            .all(cursor)
        : sourceDb
            .query(
              `
                SELECT
                  m.rowid AS rowid,
                  m.id AS message_id,
                  m.session_id AS session_id,
                  m.time_created AS time_created,
                  m.data AS message_data,
                  COALESCE(s.directory, '') AS session_directory
                FROM message m
                LEFT JOIN session s ON s.id = m.session_id
                WHERE m.time_created >= ?
                ORDER BY m.rowid ASC
              `
            )
            .all(cutoffMs)) as Array<{
        rowid: number;
        message_id: string;
        session_id: string;
        time_created: number;
        message_data: string;
        session_directory: string;
      }>;

      if (!hasOffset && rows.length === 0 && maxRow > 0) {
        this.updateIngestOffset(sourceKey, maxRow);
        summary.filesSkippedBackfill += 1;
        return summary;
      }

      if (!hasOffset && rows.length > 0 && rows[0] && rows[0].rowid > 1) {
        summary.filesSkippedBackfill += 1;
      }

      let imported = 0;
      for (const row of rows) {
        cursor = Math.max(cursor, Math.floor(row.rowid || 0));
        const normalizedRow: OpencodeDbMessageRow = {
          rowid: Math.floor(row.rowid || 0),
          messageId: typeof row.message_id === "string" ? row.message_id : "",
          sessionId: typeof row.session_id === "string" ? row.session_id : "",
          timeCreated: Number(row.time_created || 0),
          messageData: typeof row.message_data === "string" ? row.message_data : "",
          sessionDirectory: typeof row.session_directory === "string" ? row.session_directory : "",
        };

        const parsed = parseOpencodeDbMessageRow({
          sourceKey,
          row: normalizedRow,
          fallbackNowIso: nowIso,
          resolveMessageText: (messageId) => this.readOpencodeMessageTextFromDb(sourceDb as Database, messageId),
        });
        if (!parsed) continue;

        const result = this.deps.recordEvent(
          {
            platform: "opencode",
            project: parsed.project,
            session_id: parsed.sessionId,
            event_type: parsed.eventType,
            ts: parsed.timestamp,
            payload: parsed.payload,
            tags: ["opencode_db_ingest"],
            privacy_tags: [],
            dedupe_hash: parsed.dedupeHash,
          },
          { allowQueue: false }
        );

        const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
        if (result.ok && !deduped) {
          imported += 1;
        }
      }

      if (cursor > 0) {
        this.updateIngestOffset(sourceKey, cursor);
      }

      summary.eventsImported += imported;
      summary.dbEventsImported += imported;
      return summary;
    } catch {
      return summary;
    } finally {
      if (sourceDb) {
        try {
          sourceDb.close(false);
        } catch {
          // best effort
        }
      }
    }
  }

  private ingestOpencodeStorageMessages(): OpencodeIngestSummary {
    const summary = emptyOpencodeIngestSummary();
    const storageRoot = this.getOpencodeStorageRoot();
    const messageRoot = join(storageRoot, "message");
    const sessionRoot = join(storageRoot, "session");
    const partsRoot = join(storageRoot, "part");

    if (!existsSync(messageRoot)) {
      return summary;
    }

    const files = listOpencodeMessageFiles(messageRoot);
    const sessionDirectoryMap = this.loadOpencodeSessionDirectoryMap(sessionRoot);
    const cutoffMs = Date.now() - Math.max(0, this.getOpencodeBackfillHours()) * 60 * 60 * 1000;

    for (const messagePath of files) {
      summary.filesScanned += 1;
      const sourceKey = `opencode_rollout:${resolve(messagePath)}`;

      let fileSize = 0;
      let mtimeMs = Date.now();
      try {
        const stats = statSync(messagePath);
        fileSize = stats.size;
        mtimeMs = stats.mtimeMs;
      } catch {
        continue;
      }

      const offsetRow = this.deps.db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(sourceKey) as { offset: number } | null;

      const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
      let offset = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

      if (!hasOffset && mtimeMs < cutoffMs) {
        this.updateIngestOffset(sourceKey, fileSize);
        summary.filesSkippedBackfill += 1;
        continue;
      }

      if (offset > fileSize) {
        offset = 0;
      }
      if (offset === fileSize) {
        continue;
      }

      let chunk = "";
      try {
        const buffer = readFileSync(messagePath);
        chunk = buffer.subarray(offset).toString("utf8");
      } catch {
        continue;
      }

      let cachedSessionId = "";
      let cachedMessageId = "";
      const parsedChunk = parseOpencodeMessageChunk({
        sourceKey,
        baseOffset: offset,
        chunk,
        fallbackNowIso: nowIso,
        resolveSessionDirectory: (sessionId) => {
          cachedSessionId = sessionId;
          return sessionDirectoryMap.get(sessionId);
        },
        resolveMessageText: (messageId) => {
          cachedMessageId = messageId;
          return this.readOpencodeMessageText(partsRoot, messageId);
        },
      });

      let imported = 0;
      for (const entry of parsedChunk.events) {
        const result = this.deps.recordEvent(
          {
            platform: "opencode",
            project: entry.project,
            session_id: entry.sessionId,
            event_type: entry.eventType,
            ts: entry.timestamp,
            payload: entry.payload,
            tags: ["opencode_sessions_ingest"],
            privacy_tags: [],
            dedupe_hash: entry.dedupeHash,
          },
          { allowQueue: false }
        );
        const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
        if (result.ok && !deduped) {
          imported += 1;
        }
      }
      summary.eventsImported += imported;
      summary.storageEventsImported += imported;

      if (parsedChunk.consumedBytes > 0) {
        this.updateIngestOffset(sourceKey, offset + parsedChunk.consumedBytes);
      }

      if (!parsedChunk.events.length && !cachedSessionId && !cachedMessageId && parsedChunk.consumedBytes === 0) {
        continue;
      }
    }

    return summary;
  }

  ingestOpencodeHistory(): ApiResponse {
    const startedAt = performance.now();
    if (!this.isOpencodeIngestEnabled()) {
      return makeResponse(
        startedAt,
        [
          {
            events_imported: 0,
            files_scanned: 0,
            files_skipped_backfill: 0,
            db_events_imported: 0,
            storage_events_imported: 0,
          },
        ],
        {},
        { ingest_mode: "disabled" }
      );
    }

    const summary = emptyOpencodeIngestSummary();
    mergeOpencodeIngestSummary(summary, this.ingestOpencodeDbMessages());
    mergeOpencodeIngestSummary(summary, this.ingestOpencodeStorageMessages());

    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
          db_events_imported: summary.dbEventsImported,
          storage_events_imported: summary.storageEventsImported,
        },
      ],
      {},
      { ingest_mode: "opencode_hybrid_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // Cursor ingest メソッド（core から移動）
  // ---------------------------------------------------------------------------

  private ingestCursorHooksEvents(): CursorIngestSummary {
    const summary = emptyCursorIngestSummary();
    const eventsPath = this.getCursorEventsPath();
    if (!existsSync(eventsPath)) {
      return summary;
    }

    summary.filesScanned += 1;
    const sourceKey = `cursor_hooks:${resolve(eventsPath)}`;
    const cutoffMs = Date.now() - Math.max(0, this.getCursorBackfillHours()) * 60 * 60 * 1000;

    let fileSize = 0;
    let mtimeMs = Date.now();
    try {
      const stats = statSync(eventsPath);
      fileSize = stats.size;
      mtimeMs = stats.mtimeMs;
    } catch {
      return summary;
    }

    const offsetRow = this.deps.db
      .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
      .get(sourceKey) as { offset: number } | null;
    const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
    let offset = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

    if (!hasOffset && mtimeMs < cutoffMs) {
      this.updateIngestOffset(sourceKey, fileSize);
      summary.filesSkippedBackfill += 1;
      return summary;
    }

    if (offset > fileSize) {
      offset = 0;
    }
    if (offset === fileSize) {
      return summary;
    }

    let chunk = "";
    try {
      const buffer = readFileSync(eventsPath);
      chunk = buffer.subarray(offset).toString("utf8");
    } catch {
      return summary;
    }

    const parsedChunk = parseCursorHooksChunk({
      sourceKey,
      baseOffset: offset,
      chunk,
      fallbackNowIso: nowIso,
    });

    let imported = 0;
    for (const entry of parsedChunk.events) {
      const result = this.deps.recordEvent(
        {
          platform: "cursor",
          project: entry.project,
          session_id: entry.sessionId,
          event_type: entry.eventType,
          ts: entry.timestamp,
          payload: entry.payload,
          tags: ["cursor_hooks_ingest"],
          privacy_tags: [],
          dedupe_hash: entry.dedupeHash,
        },
        { allowQueue: false }
      );
      const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
      if (result.ok && !deduped) {
        imported += 1;
      }
    }

    summary.eventsImported += imported;
    summary.hooksEventsImported += imported;

    if (parsedChunk.consumedBytes > 0) {
      this.updateIngestOffset(sourceKey, offset + parsedChunk.consumedBytes);
    }

    return summary;
  }

  ingestCursorHistory(): ApiResponse {
    const startedAt = performance.now();
    if (!this.isCursorIngestEnabled()) {
      return makeResponse(
        startedAt,
        [
          {
            events_imported: 0,
            files_scanned: 0,
            files_skipped_backfill: 0,
            hooks_events_imported: 0,
          },
        ],
        {},
        { ingest_mode: "disabled" }
      );
    }

    const summary = emptyCursorIngestSummary();
    mergeCursorIngestSummary(summary, this.ingestCursorHooksEvents());
    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
          hooks_events_imported: summary.hooksEventsImported,
        },
      ],
      {},
      { ingest_mode: "cursor_spool_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // Antigravity ingest メソッド（core から移動）
  // ---------------------------------------------------------------------------

  private ingestAntigravityWorkspace(rootDir: string): AntigravityIngestSummary {
    const summary = emptyAntigravityIngestSummary();
    if (!existsSync(rootDir)) {
      return summary;
    }
    summary.rootsScanned += 1;

    const candidates: string[] = [];
    const checkpointRoot = join(rootDir, "docs", "checkpoints");
    const responsesRoot = join(rootDir, "logs", "codex-responses");
    if (existsSync(checkpointRoot)) {
      candidates.push(...listMarkdownFiles(checkpointRoot));
    }
    if (existsSync(responsesRoot)) {
      candidates.push(...listMarkdownFiles(responsesRoot));
    }

    const uniqueFiles = [...new Set(candidates)].sort((lhs, rhs) => lhs.localeCompare(rhs));
    const cutoffMs = Date.now() - Math.max(0, this.getAntigravityBackfillHours()) * 60 * 60 * 1000;

    for (const filePath of uniqueFiles) {
      summary.filesScanned += 1;
      const sourceKey = `antigravity_file:${resolve(filePath)}`;

      let fileSize = 0;
      let mtimeMs = Date.now();
      try {
        const stats = statSync(filePath);
        fileSize = stats.size;
        mtimeMs = stats.mtimeMs;
      } catch {
        continue;
      }

      const offsetRow = this.deps.db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(sourceKey) as { offset: number } | null;
      const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
      let offset = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

      if (!hasOffset && mtimeMs < cutoffMs) {
        this.updateIngestOffset(sourceKey, fileSize);
        summary.filesSkippedBackfill += 1;
        continue;
      }

      if (offset > fileSize) {
        offset = 0;
      }
      if (offset === fileSize) {
        continue;
      }

      let content = "";
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const parsed = parseAntigravityFile({
        sourceKey,
        filePath,
        workspaceRoot: rootDir,
        content,
        mtimeMs,
        fallbackNowIso: nowIso,
      });

      if (parsed) {
        const tags =
          parsed.eventType === "checkpoint"
            ? ["antigravity_files_ingest", "checkpoint_file"]
            : ["antigravity_files_ingest", "codex_response_file"];

        const result = this.deps.recordEvent(
          {
            platform: "antigravity",
            project: parsed.project,
            session_id: parsed.sessionId,
            event_type: parsed.eventType,
            ts: parsed.timestamp,
            payload: parsed.payload,
            tags,
            privacy_tags: [],
            dedupe_hash: parsed.dedupeHash,
          },
          { allowQueue: false }
        );
        const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
        if (result.ok && !deduped) {
          summary.eventsImported += 1;
          if (parsed.eventType === "checkpoint") {
            summary.checkpointEventsImported += 1;
          } else {
            summary.toolEventsImported += 1;
          }
        }
      }

      this.updateIngestOffset(sourceKey, fileSize);
    }

    return summary;
  }

  private ingestAntigravityLogEvents(): AntigravityIngestSummary {
    const summary = emptyAntigravityIngestSummary();
    const logsRoot = this.getAntigravityLogsRoot();
    if (!existsSync(logsRoot)) {
      return summary;
    }

    const logFiles = listAntigravityPlannerLogFiles(logsRoot);
    const cutoffMs = Date.now() - Math.max(0, this.getAntigravityBackfillHours()) * 60 * 60 * 1000;

    for (const filePath of logFiles) {
      summary.filesScanned += 1;
      summary.logFilesScanned += 1;
      const sourceKey = `antigravity_log:${resolve(filePath)}`;

      let fileSize = 0;
      let mtimeMs = Date.now();
      try {
        const stats = statSync(filePath);
        fileSize = stats.size;
        mtimeMs = stats.mtimeMs;
      } catch {
        continue;
      }

      const offsetRow = this.deps.db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(sourceKey) as { offset: number } | null;
      const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
      let offset = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

      if (!hasOffset && mtimeMs < cutoffMs) {
        this.updateIngestOffset(sourceKey, fileSize);
        summary.filesSkippedBackfill += 1;
        continue;
      }

      if (offset > fileSize) {
        offset = 0;
      }
      if (offset === fileSize) {
        continue;
      }

      let chunk = "";
      try {
        const buffer = readFileSync(filePath);
        chunk = buffer.subarray(offset).toString("utf8");
      } catch {
        continue;
      }

      const resolved = this.resolveAntigravityLogProject(filePath);
      const parsedChunk = parseAntigravityLogChunk({
        sourceKey,
        baseOffset: offset,
        chunk,
        fallbackNowIso: nowIso,
        project: resolved.project || "unknown",
        sessionSeed: resolved.sessionSeed || "planner",
        filePath,
      });

      let imported = 0;
      for (const entry of parsedChunk.events) {
        const result = this.deps.recordEvent(
          {
            platform: "antigravity",
            project: entry.project,
            session_id: entry.sessionId,
            event_type: entry.eventType,
            ts: entry.timestamp,
            payload: {
              ...entry.payload,
              workspace_root: resolved.workspaceRoot || undefined,
            },
            tags: ["antigravity_logs_ingest", "planner_request"],
            privacy_tags: [],
            dedupe_hash: entry.dedupeHash,
          },
          { allowQueue: false }
        );

        const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
        if (result.ok && !deduped) {
          imported += 1;
        }
      }

      summary.eventsImported += imported;
      summary.logEventsImported += imported;

      if (parsedChunk.consumedBytes > 0) {
        this.updateIngestOffset(sourceKey, offset + parsedChunk.consumedBytes);
      }
    }

    return summary;
  }

  ingestAntigravityHistory(): ApiResponse {
    const startedAt = performance.now();
    if (!this.isAntigravityIngestEnabled()) {
      return makeResponse(
        startedAt,
        [
          {
            events_imported: 0,
            files_scanned: 0,
            files_skipped_backfill: 0,
            roots_scanned: 0,
            checkpoint_events_imported: 0,
            tool_events_imported: 0,
            log_events_imported: 0,
            log_files_scanned: 0,
          },
        ],
        {},
        { ingest_mode: "disabled" }
      );
    }

    const roots = this.getAntigravityWorkspaceRoots();
    const summary = emptyAntigravityIngestSummary();
    for (const root of roots) {
      mergeAntigravityIngestSummary(summary, this.ingestAntigravityWorkspace(root));
    }
    mergeAntigravityIngestSummary(summary, this.ingestAntigravityLogEvents());

    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
          roots_scanned: summary.rootsScanned,
          checkpoint_events_imported: summary.checkpointEventsImported,
          tool_events_imported: summary.toolEventsImported,
          log_events_imported: summary.logEventsImported,
          log_files_scanned: summary.logFilesScanned,
        },
      ],
      {},
      {
        ingest_mode: "antigravity_hybrid_v1",
        workspace_roots: roots,
        logs_root: this.getAntigravityLogsRoot(),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Gemini ingest メソッド（core から移動）
  // ---------------------------------------------------------------------------

  private ingestGeminiEvents(): GeminiIngestSummary {
    const summary = emptyGeminiIngestSummary();
    const eventsPath = this.getGeminiEventsPath();
    if (!existsSync(eventsPath)) {
      return summary;
    }

    summary.filesScanned += 1;
    const sourceKey = `gemini_events:${resolve(eventsPath)}`;
    const cutoffMs = Date.now() - Math.max(0, this.getGeminiBackfillHours()) * 60 * 60 * 1000;

    let fileSize = 0;
    let mtimeMs = Date.now();
    try {
      const stats = statSync(eventsPath);
      fileSize = stats.size;
      mtimeMs = stats.mtimeMs;
    } catch {
      return summary;
    }

    const offsetRow = this.deps.db
      .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
      .get(sourceKey) as { offset: number } | null;
    const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
    let offset = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

    if (!hasOffset && mtimeMs < cutoffMs) {
      this.updateIngestOffset(sourceKey, fileSize);
      summary.filesSkippedBackfill += 1;
      return summary;
    }

    if (offset > fileSize) {
      offset = 0;
    }
    if (offset === fileSize) {
      return summary;
    }

    let chunk = "";
    try {
      const bytesToRead = fileSize - offset;
      const buf = Buffer.alloc(bytesToRead);
      const fd = openSync(eventsPath, "r");
      try {
        readSync(fd, buf, 0, bytesToRead, offset);
      } finally {
        closeSync(fd);
      }
      chunk = buf.toString("utf8");
    } catch {
      return summary;
    }

    const parsedChunk = parseGeminiEventsChunk({
      sourceKey,
      baseOffset: offset,
      chunk,
      fallbackNowIso: nowIso,
    });

    let imported = 0;
    for (const entry of parsedChunk.events) {
      const result = this.deps.recordEvent(
        {
          platform: "gemini",
          project: entry.project,
          session_id: entry.sessionId,
          event_type: entry.eventType,
          ts: entry.timestamp,
          payload: entry.payload,
          tags: ["gemini_events_ingest"],
          privacy_tags: [],
          dedupe_hash: entry.dedupeHash,
        },
        { allowQueue: false }
      );
      const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
      if (result.ok && !deduped) {
        imported += 1;
      }
    }

    summary.eventsImported += imported;

    if (parsedChunk.consumedBytes > 0) {
      this.updateIngestOffset(sourceKey, offset + parsedChunk.consumedBytes);
    }

    return summary;
  }

  ingestGeminiHistory(): ApiResponse {
    const startedAt = performance.now();
    if (!this.isGeminiIngestEnabled()) {
      return makeResponse(
        startedAt,
        [
          {
            events_imported: 0,
            files_scanned: 0,
            files_skipped_backfill: 0,
          },
        ],
        {},
        { ingest_mode: "disabled" }
      );
    }

    const summary = this.ingestGeminiEvents();
    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
        },
      ],
      {},
      { ingest_mode: "gemini_spool_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // Claude Code ingest メソッド
  // ---------------------------------------------------------------------------

  private readonly claudeCodeContextCache = new Map<string, ClaudeCodeContext>();

  private listClaudeCodeJsonlFiles(projectsRoot: string): string[] {
    const files: string[] = [];
    let projectDirs: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      projectDirs = readdirSync(projectsRoot, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      return files;
    }

    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = join(projectsRoot, dir.name);
      let entries: Array<{ name: string; isFile: () => boolean }>;
      try {
        entries = readdirSync(dirPath, { withFileTypes: true }) as Array<{
          name: string;
          isFile: () => boolean;
        }>;
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".jsonl")) continue;
        // UUID.jsonl のみ対象
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(entry.name)) continue;
        files.push(resolve(dirPath, entry.name));
      }
    }

    // recent-first: poll budget が小さくても最新セッションから追従する。
    files.sort((lhs, rhs) => {
      let lhsMtime = 0;
      let rhsMtime = 0;
      try { lhsMtime = statSync(lhs).mtimeMs; } catch { /* ignore */ }
      try { rhsMtime = statSync(rhs).mtimeMs; } catch { /* ignore */ }
      if (lhsMtime !== rhsMtime) return rhsMtime - lhsMtime;
      return rhs.localeCompare(lhs);
    });
    return files;
  }

  private inferClaudeCodeSessionId(filePath: string): string | null {
    const fileName = basename(filePath);
    const match = fileName.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
    return match?.[1] || null;
  }

  private inferClaudeCodeProject(filePath: string): string {
    const dirName = basename(dirname(filePath));
    return decodeClaudeProjectDir(dirName);
  }

  private loadClaudeCodeContext(sourceKey: string): ClaudeCodeContext {
    const cached = this.claudeCodeContextCache.get(sourceKey);
    if (cached) return { ...cached };

    const metaKey = `claude_code_context:${sourceKey}`;
    const row = this.deps.db
      .query(`SELECT value FROM mem_meta WHERE key = ?`)
      .get(metaKey) as { value?: string } | null;

    if (!row?.value) return {};

    const parsed = parseJsonSafe(row.value);
    const ctx: ClaudeCodeContext = {
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : undefined,
      project: typeof parsed.project === "string" ? parsed.project.trim() : undefined,
      lastUserPrompt: typeof parsed.lastUserPrompt === "string" ? parsed.lastUserPrompt.trim() : undefined,
      lastAssistantContent: typeof parsed.lastAssistantContent === "string" ? parsed.lastAssistantContent.trim() : undefined,
    };
    this.claudeCodeContextCache.set(sourceKey, ctx);
    return { ...ctx };
  }

  private storeClaudeCodeContext(sourceKey: string, context: ClaudeCodeContext): void {
    const sessionId = typeof context.sessionId === "string" ? context.sessionId.trim() : "";
    const project = typeof context.project === "string" ? context.project.trim() : "";
    const lastUserPrompt =
      typeof context.lastUserPrompt === "string" ? context.lastUserPrompt.trim().slice(0, 4000) : "";
    const lastAssistantContent =
      typeof context.lastAssistantContent === "string" ? context.lastAssistantContent.trim().slice(0, 4000) : "";
    if (!sessionId && !project && !lastUserPrompt && !lastAssistantContent) return;

    const normalized: ClaudeCodeContext = {
      sessionId: sessionId || undefined,
      project: project || undefined,
      lastUserPrompt: lastUserPrompt || undefined,
      lastAssistantContent: lastAssistantContent || undefined,
    };

    const metaKey = `claude_code_context:${sourceKey}`;
    this.deps.db
      .query(
        `
          INSERT INTO mem_meta(key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `
      )
      .run(
        metaKey,
        JSON.stringify({
          sessionId: normalized.sessionId || "",
          project: normalized.project || "",
          lastUserPrompt: normalized.lastUserPrompt || "",
          lastAssistantContent: normalized.lastAssistantContent || "",
        }),
        new Date().toISOString()
      );
    this.claudeCodeContextCache.set(sourceKey, normalized);
  }

  private ingestClaudeCodeSessions(options?: {
    maxFiles?: number;
    maxBytesPerFile?: number;
    replayFromStart?: boolean;
  }): { eventsImported: number; filesScanned: number; filesSkippedBackfill: number } {
    const summary = { eventsImported: 0, filesScanned: 0, filesSkippedBackfill: 0 };
    const projectsRoot = resolveHomePath(
      this.deps.config.claudeCodeProjectsRoot || DEFAULT_CLAUDE_CODE_PROJECTS_ROOT
    );
    if (!existsSync(projectsRoot)) return summary;

    const files = this.listClaudeCodeJsonlFiles(projectsRoot);
    const cutoffMs = Date.now() - Math.max(0, this.deps.config.claudeCodeBackfillHours || DEFAULT_CLAUDE_CODE_BACKFILL_HOURS) * 60 * 60 * 1000;
    const MAX_FILES_PER_POLL = options?.maxFiles ?? 50;
    const MAX_BYTES_PER_FILE = options?.maxBytesPerFile ?? (2 * 1024 * 1024); // 2MB per file per poll
    const replayFromStart = options?.replayFromStart === true;
    let filesProcessed = 0;

    for (const filePath of files) {
      summary.filesScanned += 1;
      const sourceKey = `claude_code:${resolve(filePath)}`;

      let fileSize = 0;
      let mtimeMs = Date.now();
      try {
        const stats = statSync(filePath);
        fileSize = stats.size;
        mtimeMs = stats.mtimeMs;
      } catch {
        continue;
      }

      const offsetRow = this.deps.db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(sourceKey) as { offset: number } | null;

      const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
      let offset = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

      if (!hasOffset && !replayFromStart && mtimeMs < cutoffMs) {
        this.updateIngestOffset(sourceKey, fileSize);
        summary.filesSkippedBackfill += 1;
        continue;
      }

      if (offset > fileSize) offset = 0;
      const readOffset = replayFromStart ? 0 : offset;
      if (!replayFromStart && offset === fileSize) continue;

      // バッチ上限: 実際にファイルを読み込む回数を制限してイベントループをブロックしない
      filesProcessed += 1;
      if (filesProcessed > MAX_FILES_PER_POLL) break;

      let chunk = "";
      try {
        const remainingBytes = Math.max(0, fileSize - readOffset);
        const readSize = Number.isFinite(MAX_BYTES_PER_FILE)
          ? Math.min(remainingBytes, MAX_BYTES_PER_FILE)
          : remainingBytes;
        if (readSize <= 0) continue;
        const fd = openSync(filePath, "r");
        try {
          const buffer = Buffer.alloc(readSize);
          readSync(fd, buffer, 0, readSize, readOffset);
          chunk = buffer.toString("utf8");
        } finally {
          closeSync(fd);
        }
      } catch {
        continue;
      }

      const context = replayFromStart
        ? { sessionId: "", project: "", lastUserPrompt: "", lastAssistantContent: "" }
        : this.loadClaudeCodeContext(sourceKey);
      const fallbackSessionId = this.inferClaudeCodeSessionId(filePath) || context.sessionId || undefined;
      const fallbackProject = this.inferClaudeCodeProject(filePath);

      const parsedChunk = parseClaudeCodeChunk({
        sourceKey,
        baseOffset: readOffset,
        chunk,
        fallbackNowIso: nowIso,
        context,
        defaultSessionId: fallbackSessionId,
        defaultProject: fallbackProject,
      });

      let imported = 0;
      for (const entry of parsedChunk.events) {
        const result = this.deps.recordEvent(
          {
            platform: "claude",
            project: entry.project,
            session_id: entry.sessionId,
            event_type: entry.eventType,
            ts: entry.timestamp,
            payload: entry.payload,
            tags: ["claude_code_sessions_ingest"],
            privacy_tags: [],
            dedupe_hash: entry.dedupeHash,
          },
          { allowQueue: false }
        );
        const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
        if (result.ok && !deduped) imported += 1;
      }

      summary.eventsImported += imported;

      this.storeClaudeCodeContext(sourceKey, {
        sessionId: parsedChunk.context.sessionId || fallbackSessionId,
        project: parsedChunk.context.project || fallbackProject,
        lastUserPrompt: parsedChunk.context.lastUserPrompt,
        lastAssistantContent: parsedChunk.context.lastAssistantContent,
      });

      const nextOffset = readOffset + parsedChunk.consumedBytes;
      this.updateIngestOffset(sourceKey, Math.max(offset, nextOffset));
    }

    return summary;
  }

  ingestClaudeCodeHistory(): ApiResponse {
    const startedAt = performance.now();
    if (this.deps.config.claudeCodeIngestEnabled === false) {
      return makeResponse(
        startedAt,
        [{ events_imported: 0, files_scanned: 0, files_skipped_backfill: 0 }],
        {},
        { ingest_mode: "disabled" }
      );
    }

    const summary = this.ingestClaudeCodeSessions({
      maxFiles: Infinity,
      maxBytesPerFile: Infinity,
      replayFromStart: true,
    });
    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
        },
      ],
      {},
      { ingest_mode: "claude_code_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // Claude-mem import メソッド（core から移動）
  // ---------------------------------------------------------------------------

  startClaudeMemImport(request: ClaudeMemImportRequest): ApiResponse {
    const startedAt = performance.now();
    const sourceDbPath = resolveHomePath(request.source_db_path || "");
    const dryRun = Boolean(request.dry_run);
    const localDbPath = resolveHomePath(this.deps.config.dbPath);
    if (!sourceDbPath) {
      return makeErrorResponse(startedAt, "source_db_path is required", {});
    }
    if (!existsSync(sourceDbPath)) {
      return makeErrorResponse(startedAt, `source_db_path not found: ${sourceDbPath}`, {});
    }
    if (sourceDbPath === localDbPath) {
      return makeErrorResponse(startedAt, "source_db_path must not be the harness-mem db path", {});
    }
    let stats;
    try {
      stats = statSync(sourceDbPath);
    } catch {
      return makeErrorResponse(startedAt, `source_db_path is not accessible: ${sourceDbPath}`, {});
    }
    if (!stats.isFile()) {
      return makeErrorResponse(startedAt, "source_db_path must point to a regular file", {});
    }
    if (stats.size < SQLITE_HEADER.length) {
      return makeErrorResponse(startedAt, "source_db_path is too small to be a SQLite database", {});
    }
    const header = this.readFileHeader(sourceDbPath, SQLITE_HEADER.length);
    if (header !== SQLITE_HEADER) {
      return makeErrorResponse(startedAt, "source_db_path is not a valid SQLite database file", {});
    }

    const jobId = `import_${generateEventId()}`;
    this.createImportJob(jobId, sourceDbPath, dryRun);

    try {
      const plan = buildClaudeMemImportPlan({
        sourceDbPath,
        projectOverride: request.project,
        nowIso,
      });

      const importTag = `import_job:${jobId}`;
      let insertedEvents = 0;
      let dedupedEvents = 0;
      let failedEvents = 0;
      const sampleObservationIds: string[] = [];
      const errors: string[] = [];

      if (!dryRun) {
        for (const event of plan.events) {
          const normalizedTags = [...new Set([...(event.tags || []), "claude_mem_import", importTag])];
          const response = this.deps.recordEvent(
            {
              ...event,
              tags: normalizedTags,
            },
            { allowQueue: false }
          );

          if (!response.ok) {
            failedEvents += 1;
            if (response.error) {
              errors.push(response.error);
            }
            continue;
          }

          const meta = response.meta as unknown as Record<string, unknown>;
          if (meta.deduped === true) {
            dedupedEvents += 1;
            continue;
          }

          insertedEvents += 1;
          const first = (response.items[0] || {}) as Record<string, unknown>;
          if (typeof first.id === "string" && sampleObservationIds.length < 20) {
            sampleObservationIds.push(first.id);
          }
        }

        for (const summary of plan.summaries) {
          this.deps.upsertSessionSummary(
            summary.session_id,
            "claude",
            summary.project,
            summary.summary,
            summary.ts,
            "imported"
          );
        }
      }

      const result = {
        source: "claude-mem",
        source_db_path: sourceDbPath,
        dry_run: dryRun,
        source_tables: plan.source_tables,
        source_rows: {
          observations: plan.observation_rows,
          session_summaries: plan.summary_rows,
          sdk_sessions: plan.sdk_session_rows,
          total_events: plan.events.length,
        },
        imported: {
          inserted_events: insertedEvents,
          deduped_events: dedupedEvents,
          failed_events: failedEvents,
          summaries_upserted: dryRun ? 0 : plan.summaries.length,
          sample_observation_ids: sampleObservationIds,
        },
        warnings: plan.warnings,
        errors: errors.slice(0, 20),
      };

      this.updateImportJob({
        jobId,
        status: "completed",
        result,
      });

      return makeResponse(
        startedAt,
        [
          {
            job_id: jobId,
            status: "completed",
            ...result,
          },
        ],
        {
          source: "claude-mem",
          dry_run: dryRun,
        },
        { ranking: "import_v1" }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateImportJob({
        jobId,
        status: "failed",
        result: {},
        error: message,
      });
      return makeErrorResponse(startedAt, message, { job_id: jobId });
    }
  }

  getImportJobStatus(request: { job_id: string }): ApiResponse {
    const startedAt = performance.now();
    if (!request.job_id) {
      return makeErrorResponse(startedAt, "job_id is required", {});
    }

    const row = this.deps.db
      .query(`
        SELECT job_id, source, source_db_path, status, dry_run, requested_at, started_at, finished_at, result_json, error
        FROM mem_import_jobs
        WHERE job_id = ?
      `)
      .get(request.job_id) as
      | {
          job_id: string;
          source: string;
          source_db_path: string;
          status: string;
          dry_run: number;
          requested_at: string;
          started_at: string | null;
          finished_at: string | null;
          result_json: string;
          error: string | null;
        }
      | null;

    if (!row) {
      return makeErrorResponse(startedAt, `import job not found: ${request.job_id}`, {
        job_id: request.job_id,
      });
    }

    const result = parseJsonSafe(row.result_json);
    return makeResponse(
      startedAt,
      [
        {
          job_id: row.job_id,
          source: row.source,
          source_db_path: row.source_db_path,
          status: row.status,
          dry_run: row.dry_run === 1,
          requested_at: row.requested_at,
          started_at: row.started_at,
          finished_at: row.finished_at,
          result,
          error: row.error,
        },
      ],
      { job_id: request.job_id },
      { ranking: "import_job_v1" }
    );
  }

  verifyClaudeMemImport(request: { job_id: string }): ApiResponse {
    const startedAt = performance.now();
    if (!request.job_id) {
      return makeErrorResponse(startedAt, "job_id is required", {});
    }

    const job = this.deps.db
      .query(`
        SELECT job_id, status, dry_run, result_json, error
        FROM mem_import_jobs
        WHERE job_id = ?
      `)
      .get(request.job_id) as
      | {
          job_id: string;
          status: string;
          dry_run: number;
          result_json: string;
          error: string | null;
        }
      | null;

    if (!job) {
      return makeErrorResponse(startedAt, `import job not found: ${request.job_id}`, {
        job_id: request.job_id,
      });
    }

    const result = parseJsonSafe(job.result_json);
    const imported = parseJsonSafe(result.imported);
    const sourceRows = parseJsonSafe(result.source_rows);
    const sampleIds = toArraySafe(imported.sample_observation_ids);
    const importTag = `import_job:${request.job_id}`;

    const importedCountRow = this.deps.db
      .query(`
        SELECT COUNT(DISTINCT observation_id) AS count
        FROM mem_tags
        WHERE tag = ?
      `)
      .get(importTag) as { count?: number } | null;
    const importedCount = Number(importedCountRow?.count ?? 0);

    const privateCountRow = this.deps.db
      .query(`
        SELECT COUNT(*) AS count
        FROM mem_observations o
        JOIN mem_tags t ON t.observation_id = o.id
        WHERE t.tag = ?
          AND (
            o.privacy_tags_json LIKE '%"private"%'
            OR o.privacy_tags_json LIKE '%"sensitive"%'
          )
      `)
      .get(importTag) as { count?: number } | null;
    const privateCount = Number(privateCountRow?.count ?? 0);

    const privateVisibleByDefaultRow = this.deps.db
      .query(`
        SELECT COUNT(*) AS count
        FROM mem_observations o
        JOIN mem_tags t ON t.observation_id = o.id
        WHERE t.tag = ?
          AND (
            o.privacy_tags_json LIKE '%"private"%'
            OR o.privacy_tags_json LIKE '%"sensitive"%'
          )
          ${visibilityFilterSql("o", false)}
      `)
      .get(importTag) as { count?: number } | null;
    const privateVisibleByDefault = Number(privateVisibleByDefaultRow?.count ?? 0);

    let sampleFound = 0;
    if (sampleIds.length > 0) {
      const placeholders = sampleIds.map(() => "?").join(", ");
      const sampleFoundRow = this.deps.db
        .query(`
          SELECT COUNT(*) AS count
          FROM mem_observations
          WHERE id IN (${placeholders})
        `)
        .get(...sampleIds) as { count?: number } | null;
      sampleFound = Number(sampleFoundRow?.count ?? 0);
    }

    const insertedEvents = Number(imported.inserted_events ?? 0);
    const dedupedEvents = Number(imported.deduped_events ?? 0);
    const sourceEvents = Number(sourceRows.total_events ?? 0);
    const checks = [
      {
        name: "job_completed",
        pass: job.status === "completed",
        detail: job.status,
      },
      {
        name: "inserted_or_deduped",
        pass: job.dry_run === 1 ? true : sourceEvents === 0 || importedCount > 0 || insertedEvents > 0 || dedupedEvents > 0,
        detail: {
          imported_observations: importedCount,
          inserted_events: insertedEvents,
          deduped_events: dedupedEvents,
          source_events: sourceEvents,
        },
      },
      {
        name: "sample_observations_present",
        pass: sampleIds.length === 0 ? true : sampleFound === sampleIds.length,
        detail: {
          sample_total: sampleIds.length,
          sample_found: sampleFound,
        },
      },
      {
        name: "privacy_default_hidden",
        pass: privateVisibleByDefault === 0,
        detail: {
          private_imported: privateCount,
          private_visible_default: privateVisibleByDefault,
        },
      },
    ];

    const ok = checks.every((entry) => entry.pass);
    return makeResponse(
      startedAt,
      [
        {
          ok,
          job_id: request.job_id,
          status: job.status,
          dry_run: job.dry_run === 1,
          imported_observations: importedCount,
          private_observations: privateCount,
          checks,
          error: job.error,
        },
      ],
      { job_id: request.job_id },
      { ranking: "import_verify_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // ファイルヘッダー読み取りヘルパー
  // ---------------------------------------------------------------------------

  private readFileHeader(filePath: string, bytes: number): string {
    let fd: number | null = null;
    try {
      fd = openSync(filePath, "r");
      const buffer = Buffer.alloc(Math.max(1, bytes));
      const readBytes = readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, readBytes).toString("utf8");
    } catch {
      return "";
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // best effort
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 外部ナレッジ取り込み (IMP-010)
  // ---------------------------------------------------------------------------

  ingestGitHubIssues(request: {
    repo: string;
    json: string;
    project?: string;
    platform?: string;
    session_id?: string;
  }): ApiResponse {
    const startedAt = performance.now();
    if (!request.repo || !request.json) {
      return makeErrorResponse(startedAt, "repo and json are required", request as Record<string, unknown>);
    }

    const { observations, errors } = parseGitHubIssues({
      repo: request.repo,
      json: request.json,
      project: request.project,
    });

    const platform = request.platform ?? "github";
    const sessionId = request.session_id ?? `github-issues-${request.repo.replace("/", "-")}`;
    const project = request.project ?? request.repo;

    let imported = 0;
    let skipped = 0;
    for (const obs of observations) {
      const result = this.deps.recordEvent(
        {
          platform,
          project,
          session_id: sessionId,
          event_type: "context",
          ts: obs.updated_at ?? obs.created_at,
          payload: { content: obs.content, title: obs.title, metadata: obs.metadata },
          tags: obs.tags,
          privacy_tags: [],
          dedupe_hash: obs.dedupeHash,
        },
        { allowQueue: false }
      );
      const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
      if (result.ok && !deduped) {
        imported += 1;
      } else if (deduped) {
        skipped += 1;
      }
    }

    return makeResponse(
      startedAt,
      [{ issues_imported: imported, issues_skipped: skipped, parse_errors: errors.length }],
      request as unknown as Record<string, unknown>,
      { ingest_mode: "github_issues_v1" }
    );
  }

  /**
   * IMP-010: decisions.md または ADR ファイルを harness-mem に取り込む。
   */
  ingestKnowledgeFile(request: {
    file_path: string;
    content: string;
    kind?: "decisions_md" | "adr";
    project?: string;
    platform?: string;
    session_id?: string;
    /** S78-D01 / §81-B02: Temporal forgetting — ISO-8601 または Unix 秒。null = 無期限 */
    expires_at?: string | number | null;
    /** S78-E02: Branch-scoped memory — git ブランチ名（呼び出し元が明示的に渡す） */
    branch?: string | null;
  }): ApiResponse {
    const startedAt = performance.now();
    if (!request.file_path || !request.content) {
      return makeErrorResponse(startedAt, "file_path and content are required", request as Record<string, unknown>);
    }

    const kind =
      request.kind ??
      (request.file_path.toLowerCase().includes("decisions") ? "decisions_md" : "adr");

    const platform = request.platform ?? "knowledge";
    const project = request.project ?? "default";
    const sessionId =
      request.session_id ??
      `knowledge-${kind}-${request.file_path.replace(/[^a-z0-9]/gi, "-").slice(0, 32)}`;

    let observations: AdrObservation[];
    let parseErrors: Array<{ section?: string; error: string }> = [];

    if (kind === "decisions_md") {
      const result = parseDecisionsMd({
        filePath: request.file_path,
        content: request.content,
        project: request.project,
      });
      observations = result.observations;
      parseErrors = result.errors;
    } else {
      const result = parseAdrFile({
        filePath: request.file_path,
        content: request.content,
        project: request.project,
      });
      observations = result.observation ? [result.observation] : [];
      if (result.error) {
        parseErrors = [{ error: result.error }];
      }
    }

    let imported = 0;
    let skipped = 0;
    for (const obs of observations) {
      const result = this.deps.recordEvent(
        {
          platform,
          project,
          session_id: sessionId,
          event_type: "context",
          ts: obs.created_at,
          payload: { content: obs.content, title: obs.title, metadata: obs.metadata },
          tags: obs.tags,
          privacy_tags: [],
          dedupe_hash: obs.dedupeHash,
          // S78-D01 / §81-B02: TTL パススルー (expires_at カラムへ)
          ...(request.expires_at != null && { expires_at: request.expires_at }),
          // S78-E02: Branch パススルー
          ...(request.branch != null && { branch: request.branch }),
        },
        { allowQueue: false }
      );
      const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
      if (result.ok && !deduped) {
        imported += 1;
      } else if (deduped) {
        skipped += 1;
      }
    }

    return makeResponse(
      startedAt,
      [
        {
          entries_imported: imported,
          entries_skipped: skipped,
          parse_errors: parseErrors.length,
          kind,
        },
      ],
      request as unknown as Record<string, unknown>,
      { ingest_mode: "knowledge_file_v1" }
    );
  }
}
