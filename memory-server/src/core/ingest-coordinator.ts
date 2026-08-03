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
 *   - ingestHermesState
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
import { ingestHermesStateDbQueued, type HermesStateIngestRequest } from "../ingest/hermes-state";
import { parseGitHubIssues } from "../connectors/github-issues";
import { parseDecisionsMd, parseAdrFile, type AdrObservation } from "../connectors/adr-decisions";
import { recordRecallTelemetry } from "../telemetry/otel";

// ---------------------------------------------------------------------------
// モジュールレベルのヘルパー
// ---------------------------------------------------------------------------

function normalizeProjectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("project name must not be empty");
  return trimmed;
}

/**
 * §159-003b: 定期 ingest tick が event loop を占有してよい上限 (ms)。
 *
 * 履歴 ingest は同期実行なので、この時間を超えると /health も search も返せない。
 *
 * `HARNESS_MEM_INGEST_TICK_BUDGET_MS` の解釈:
 * - 正の整数 → その値 (ms)
 * - 0 以下の整数 → `Infinity` (制限なし。明示的に無効化したい運用のため)
 * - 未指定 / 整数として解釈できない値 → 既定値
 *
 * 整数表記のみを受理する。`parseInt` は "50ms" を 50、"1.5" を 1 と解釈してしまい、
 * 設定ミスを有効値として黙って受け入れるため使わない。
 */
export const DEFAULT_INGEST_TICK_BUDGET_MS = 200;

export function resolveIngestTickBudgetMs(): number {
  const rawText = process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS?.trim() ?? "";
  if (!/^[+-]?\d+$/.test(rawText)) return DEFAULT_INGEST_TICK_BUDGET_MS;
  const raw = Number(rawText);
  if (!Number.isFinite(raw)) return DEFAULT_INGEST_TICK_BUDGET_MS;
  return raw > 0 ? raw : Infinity;
}

/**
 * §159-003c: 60 秒周期 job のどれが event loop を占有しているかを、本番環境で
 * A/B なしに特定するための閾値 (ms)。
 *
 * これらの job は同期実行なので、1 tick の所要時間がそのまま /health の無応答時間に
 * なる。閾値を超えた tick だけを記録することで、平常時のログを汚さずに犯人を絞れる。
 *
 * `HARNESS_MEM_SLOW_TICK_LOG_MS` の解釈は `HARNESS_MEM_INGEST_TICK_BUDGET_MS` と同型
 * (正整数=閾値 / 0 以下=記録しない / 未指定・不正=既定値)。
 */
/**
 * §159-003c/d: 1 tick で 1 ファイルから読み込む最大バイト数。
 *
 * 元は claude_code が 2MB、codex と cursor は「残り全体」だった。2MB でも **read +
 * utf8 変換 + parse がそれ自体で数秒かかる** ため、tick budget (既定 200ms) を
 * insert ループに入れても超過が残った (2026-07-26 実測: codex 1.3〜3.3 秒 /
 * cursor 1.1〜1.4 秒)。budget は「読み込み前」と「insert ループ内」でしか判定できず、
 * read と parse の途中では抜けられないので、1 回に読む量自体を絞る必要がある。
 *
 * `HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE` で上書き可 (0 以下は制限なし)。offset は
 * 永続化されるので、上限で切っても次 tick が続きから再開する。
 */
export const DEFAULT_INGEST_MAX_BYTES_PER_FILE = 512 * 1024;

export function resolveIngestMaxBytesPerFile(): number {
  const rawText = process.env.HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE?.trim() ?? "";
  if (!/^[+-]?\d+$/.test(rawText)) return DEFAULT_INGEST_MAX_BYTES_PER_FILE;
  const raw = Number(rawText);
  if (!Number.isFinite(raw)) return DEFAULT_INGEST_MAX_BYTES_PER_FILE;
  return raw > 0 ? raw : Infinity;
}

/**
 * §159-003e: 1 回の read + utf8 変換 + parse が budget 判定を越えて止められない時間を
 * 抑えるための読み込み幅。512KB 上限でも restart 直後の cursor tick が 1148ms
 * かかったため、既定を 64KB に分割する。
 */
export const DEFAULT_INGEST_READ_SLICE_BYTES = 64 * 1024;

export function resolveIngestReadSliceBytes(): number {
  const rawText = process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES?.trim() ?? "";
  if (!/^[+-]?\d+$/.test(rawText)) return DEFAULT_INGEST_READ_SLICE_BYTES;
  const raw = Number(rawText);
  if (!Number.isFinite(raw)) return DEFAULT_INGEST_READ_SLICE_BYTES;
  return raw > 0 ? raw : Infinity;
}

/**
 * §159-003f: 明示 WAL checkpoint の実行間隔 (ms)。
 *
 * `PRAGMA wal_checkpoint(PASSIVE)` は同期 DB I/O で、DB が大きいほど event loop を
 * 占有する。SQLite 自身が `wal_autocheckpoint` (既定 1000 ページ) で commit 時に
 * 逐次 checkpoint するため、この明示実行は WAL 肥大化に対する保険であり、頻度を
 * 落としても安全性は autocheckpoint 側が担保する。
 *
 * `HARNESS_MEM_WAL_CHECKPOINT_INTERVAL_MS` で上書き可 (0 以下は既定にフォールバック。
 * 無効化は WAL 肥大化のリスクがあるため受け付けない)。
 */
export const DEFAULT_WAL_CHECKPOINT_INTERVAL_MS = 300_000;

export function resolveWalCheckpointIntervalMs(): number {
  const rawText = process.env.HARNESS_MEM_WAL_CHECKPOINT_INTERVAL_MS?.trim() ?? "";
  if (!/^[+-]?\d+$/.test(rawText)) return DEFAULT_WAL_CHECKPOINT_INTERVAL_MS;
  const raw = Number(rawText);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WAL_CHECKPOINT_INTERVAL_MS;
  return raw;
}

export const DEFAULT_SLOW_TICK_LOG_MS = 1000;

export function resolveSlowTickLogMs(): number {
  const rawText = process.env.HARNESS_MEM_SLOW_TICK_LOG_MS?.trim() ?? "";
  if (!/^[+-]?\d+$/.test(rawText)) return DEFAULT_SLOW_TICK_LOG_MS;
  const raw = Number(rawText);
  if (!Number.isFinite(raw)) return DEFAULT_SLOW_TICK_LOG_MS;
  return raw > 0 ? raw : Infinity;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const MAX_CURSOR_HOOK_EVENTS_PER_INGEST = 50;

/**
 * §160-007: opencode DB 経路 (`ingestOpencodeDbMessages`) が 1 tick で SQL から
 * 読む行数の上限。
 *
 * 旧実装は `SELECT ... ORDER BY m.rowid ASC` に `LIMIT` が無く、offset 以降 (または
 * backfill window 内) の全行を `.all()` で一括メモリ展開していた。budget チェックは
 * insert ループの中にしか無かったため、Spec.md の「## Periodic Ingest Budget」契約
 * (時間 budget だけでは読み込み量の上限にならない。読み込み自体を budget 判定と
 * 独立に上限化する) を満たしていなかった。
 *
 * 値の根拠 (§160-001 recordEvent コスト実測 `docs/benchmarks/s160-001-recordevent-cost-by-db-size.md`):
 * recordEvent 1 件のコストは空 DB で p50=4.286ms/p90=7.122ms、4.9GB DB で
 * p50=39.048ms/max=49.519ms。既定 tick budget (200ms) 内で処理できる件数は
 * 空 DB で ~28 件、4.9GB DB で ~4 件と DB サイズに強く依存するため、行数上限は
 * 「通常運用では entry ループの時間 budget が先に効き、この LIMIT はほぼ発火しない」
 * 程度に余裕を持たせつつ、ロング再起動後の大量バックログ流入時にメモリ展開量を
 * 有限にする防御的な上限として 500 を選ぶ。
 */
const MAX_OPENCODE_DB_ROWS_PER_INGEST = 500;

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
  filesSkippedTooLarge: number;
  dbEventsImported: number;
  storageEventsImported: number;
}

function emptyOpencodeIngestSummary(): OpencodeIngestSummary {
  return {
    eventsImported: 0,
    filesScanned: 0,
    filesSkippedBackfill: 0,
    filesSkippedTooLarge: 0,
    dbEventsImported: 0,
    storageEventsImported: 0,
  };
}

function mergeOpencodeIngestSummary(target: OpencodeIngestSummary, partial: OpencodeIngestSummary): void {
  target.eventsImported += partial.eventsImported;
  target.filesScanned += partial.filesScanned;
  target.filesSkippedBackfill += partial.filesSkippedBackfill;
  target.filesSkippedTooLarge += partial.filesSkippedTooLarge;
  target.dbEventsImported += partial.dbEventsImported;
  target.storageEventsImported += partial.storageEventsImported;
}

interface CursorIngestSummary {
  eventsImported: number;
  eventsFailed: number;
  eventsDeferred: number;
  filesScanned: number;
  filesSkippedBackfill: number;
  hooksEventsImported: number;
  retryOffset?: number;
  lastRecordError?: string;
}

function emptyCursorIngestSummary(): CursorIngestSummary {
  return {
    eventsImported: 0,
    eventsFailed: 0,
    eventsDeferred: 0,
    filesScanned: 0,
    filesSkippedBackfill: 0,
    hooksEventsImported: 0,
  };
}

function mergeCursorIngestSummary(target: CursorIngestSummary, partial: CursorIngestSummary): void {
  target.eventsImported += partial.eventsImported;
  target.eventsFailed += partial.eventsFailed;
  target.eventsDeferred += partial.eventsDeferred;
  target.filesScanned += partial.filesScanned;
  target.filesSkippedBackfill += partial.filesSkippedBackfill;
  target.hooksEventsImported += partial.hooksEventsImported;
  if (partial.retryOffset !== undefined) {
    target.retryOffset = partial.retryOffset;
  }
  if (partial.lastRecordError) {
    target.lastRecordError = partial.lastRecordError;
  }
}

interface AntigravityIngestSummary {
  eventsImported: number;
  filesScanned: number;
  filesSkippedBackfill: number;
  // §160-007 (review 指摘): readFileSync 前のサイズ上限判定で読まずにスキップした
  // ファイル数。filesSkippedBackfill と混ぜない (原因が違うと運用時の切り分けが
  // できなくなる)。
  filesSkippedTooLarge: number;
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
    filesSkippedTooLarge: 0,
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
  target.filesSkippedTooLarge += partial.filesSkippedTooLarge;
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
  recordEventQueued: (event: EventEnvelope, options?: { allowQueue: boolean }) => Promise<ApiResponse | "queue_full">;
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

  // §160-007 (review 指摘): サイズ上限超過ファイルは offset を進めない設計なので、
  // round-robin で再訪問するたびに同じ警告を出しログを埋める。source_key ごとに
  // 初回 1 回だけ warn する。件数の観測は summary.filesSkippedTooLarge が担うので、
  // warn を減らしても観測性は落ちない。
  private readonly warnedTooLargeSourceKeys = new Set<string>();

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

  /**
   * §159-003f: 走査を budget で打ち切ったときの再開位置 (source 種別 → 次に見るファイルの index)。
   * 打ち切りっぱなしだと末尾のファイルが永久に処理されないため、次 tick は続きから走査する。
   * 永続化しない (restart 後は先頭から) — 公平性のための順序であって状態ではないため。
   */
  private readonly scanCursors = new Map<string, number>();

  constructor(private readonly deps: IngestCoordinatorDeps) {}

  /**
   * §159-003c: 同期 tick の所要時間を測り、閾値超過だけを記録する。
   *
   * これらの job は event loop 上で同期実行されるため、所要時間 = /health が
   * 応答できない時間。既存の `try { ... } catch {}` と同じく例外は飲み込む
   * (post-shutdown の DB エラーで daemon を落とさないため)。
   */
  private runTick(label: string, fn: () => void): void {
    const startedAt = Date.now();
    try {
      fn();
    } catch {
      /* ignore post-shutdown DB errors */
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= resolveSlowTickLogMs()) {
        console.warn(`[ingest] slow tick: ${label} blocked the event loop for ${elapsed}ms`);
      }
    }
  }

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
        this.runTick("codex", () => this.ingestCodexHistoryTick());
      }, config.codexIngestIntervalMs);
    }

    if (config.opencodeIngestEnabled !== false) {
      this.opencodeIngestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        this.runTick("opencode", () => this.ingestOpencodeHistoryTick());
      }, clampLimit(Number(config.opencodeIngestIntervalMs || DEFAULT_OPENCODE_INGEST_INTERVAL_MS), DEFAULT_OPENCODE_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (config.cursorIngestEnabled !== false) {
      this.cursorIngestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        this.runTick("cursor", () => this.ingestCursorHistoryTick());
      }, clampLimit(Number(config.cursorIngestIntervalMs || DEFAULT_CURSOR_INGEST_INTERVAL_MS), DEFAULT_CURSOR_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (config.antigravityIngestEnabled !== false) {
      this.antigravityIngestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        this.runTick("antigravity", () => this.ingestAntigravityHistoryTick());
      }, clampLimit(Number(config.antigravityIngestIntervalMs || DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS), DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (config.geminiIngestEnabled !== false) {
      this.geminiIngestTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        this.runTick("gemini", () => this.ingestGeminiHistoryTick());
      }, clampLimit(Number(config.geminiIngestIntervalMs || DEFAULT_GEMINI_INGEST_INTERVAL_MS), DEFAULT_GEMINI_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (config.claudeCodeIngestEnabled !== false) {
      const ccInterval = clampLimit(Number(config.claudeCodeIngestIntervalMs || DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS), DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS, 1000, 300000);
      const runClaudeCodeIngest = () => {
        if (this.deps.isShuttingDown()) return;
        this.runTick("claude_code", () => this.ingestClaudeCodeSessions());
      };
      // S115-003: 大規模履歴では起動直後の同期 scan が readiness/search を塞ぐため、
      // 最初の取り込みも通常 interval まで遅らせる。
      this.claudeCodeIngestStartTimer = setTimeout(() => {
        this.claudeCodeIngestStartTimer = null;
        if (this.deps.isShuttingDown()) return;
        runClaudeCodeIngest();
        this.claudeCodeIngestTimer = setInterval(runClaudeCodeIngest, ccInterval);
      }, ccInterval);
    }

    if (config.consolidationEnabled !== false) {
      let consolidationRunning = false;
      this.consolidationTimer = setInterval(() => {
        if (this.deps.isShuttingDown()) return;
        if (consolidationRunning) return;
        consolidationRunning = true;
        // §155-A04: 元コードは .catch() を持たず、SQLITE_BUSY 等の rejection が
        // Bun の uncaughtException 扱いで daemon プロセスを殺し、launchd が
        // 再起動を繰り返す crashloop を引き起こしていた。次サイクル (60s 後) で
        // 自然に再試行されるので、ここでは WARN ログだけ残して swallow する。
        // §159-003c: consolidation は async だが、内部の同期 DB 処理が event loop を
        // 占有する。所要時間 (await 込み) を測っておき、閾値超過だけ記録する。
        const consolidationStartedAt = Date.now();
        void this.deps
          .runConsolidation({ reason: "scheduler", limit: 10 })
          .catch((err: unknown) => {
            const code = (err as { code?: string } | null)?.code;
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
              `[consolidation-scheduler] swallowed error (code=${code ?? "n/a"}): ${message} — will retry on next interval`,
            );
          })
          .finally(() => {
            consolidationRunning = false;
            const elapsed = Date.now() - consolidationStartedAt;
            if (elapsed >= resolveSlowTickLogMs()) {
              console.warn(`[ingest] slow tick: consolidation took ${elapsed}ms`);
            }
          });
      }, clampLimit(Number(config.consolidationIntervalMs || 60000), 60000, 5000, 600000));
    }

    this.retryTimer = setInterval(() => {
      if (this.deps.isShuttingDown()) return;
      this.runTick("retry_queue", () => this.deps.processRetryQueue());
    }, 15000);

    // §159-003f: WAL checkpoint は同期 DB I/O なので、DB が大きいほど event loop を
    // 塞ぐ。2026-07-28 実測 (4.9GB DB) で、他の周期ジョブがすべて 1000ms 未満なのに
    // /health が 5 秒超えで応答しない窓が残り、`sample` の leaf は pread (SQLite の
    // ページ読み) が支配的だった。ここだけ計測外だったため runTick で可視化する。
    // SQLite は wal_autocheckpoint (既定 1000 ページ) で commit 時に逐次
    // checkpoint するため、この明示 checkpoint は WAL 肥大化に対する保険。
    // 間隔を env で緩められるようにして、大きい DB での占有頻度を下げられるようにする。
    this.checkpointTimer = setInterval(() => {
      if (this.deps.isShuttingDown()) return;
      this.runTick("wal_checkpoint", () => {
        this.deps.db.exec("PRAGMA wal_checkpoint(PASSIVE);");
      });
    }, resolveWalCheckpointIntervalMs());

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

    // §160-007 (review 指摘): これは ingestAntigravityLogEvents が 1 ファイル訪問ごとに
    // 呼ぶ、つまり timer 経路の一部である。Spec.md「## Periodic Ingest Budget」は
    // 「同じ source の一部として読む二次的・レガシーな入力」も上限化を要求し、
    // 一部でも無制限なら source 全体が非準拠だと定めている。exthost.log は長時間
    // セッションで際限なく育つので、全文 readFileSync は上限を持たなければならない。
    //
    // 先頭ではなく末尾から読む: この関数は「最後に出現した」storage id を採るため、
    // 打ち切るなら古い側を捨てるのが正しい。
    let text = "";
    try {
      const maxBytes = resolveIngestMaxBytesPerFile();
      const fileSize = statSync(exthostLog).size;
      if (Number.isFinite(maxBytes) && fileSize > maxBytes) {
        // 切り口 (fileSize - maxBytes) は任意のバイト位置なので、真に最後の一致が
        // ちょうどそこを跨ぐと窓の中では不完全になり、取り逃す (レビューで実際に
        // 再現された)。一致 1 個分より広く手前へ広げて読めば、元の切り口を跨ぐ
        // 一致は必ず窓の中に収まる。新しい切り口を跨ぐ一致はそれより古いので、
        // 「最後の一致」を採る限り取り逃しても結果は変わらない。
        //
        // 十分な幅であることは正規表現側で構造的に保証する: 一致の最大長は
        // "workspaceStorage/" (17) + id 上限 (64) = 81 バイトなので、256 で足りる
        // (id の上限が無いままだと「256 で足りるか」が実データ次第の仮定になる)。
        const overlapBytes = 256;
        const start = Math.max(0, fileSize - maxBytes - overlapBytes);
        const length = fileSize - start;
        const fd = openSync(exthostLog, "r");
        try {
          const buffer = Buffer.alloc(length);
          const bytesRead = readSync(fd, buffer, 0, length, start);
          text = buffer.subarray(0, Math.max(0, bytesRead)).toString("utf8");
        } finally {
          closeSync(fd);
        }
      } else {
        text = readFileSync(exthostLog, "utf8");
      }
    } catch {
      return "";
    }
    if (!text) return "";

    // 上限 64: workspaceStorage の id は決定的ハッシュ (32〜40 hex) なので実データは
    // 十分収まる。上限を明示することで、上の overlapBytes が足りるかどうかが
    // 実データ依存の仮定ではなく計算で決まる。
    const matches = [...text.matchAll(/workspaceStorage\/([0-9a-z]{8,64})/gi)];
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

  private ingestCodexSessionsRollouts(options?: {
    budgetMs?: number;
    maxBytesPerFile?: number;
  }): CodexIngestSummary {
    const summary = emptyCodexIngestSummary();
    // §159-003c: 本番実測でこの tick が 11.9〜15.0 秒 event loop を塞いでいた
    // (`[ingest] slow tick: codex ...`)。claude_code と同型の budget を入れる。
    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    const maxBytesPerFile = options?.maxBytesPerFile ?? resolveIngestMaxBytesPerFile();
    const readSliceBytes = resolveIngestReadSliceBytes();
    const sessionsRoot = resolveHomePath(this.deps.config.codexSessionsRoot);
    if (!existsSync(sessionsRoot)) {
      return summary;
    }

    const files = listCodexRolloutFiles(sessionsRoot);
    const defaultProject = normalizeProjectName(resolve(this.deps.config.codexProjectRoot));
    const cutoffMs = Date.now() - Math.max(0, this.deps.config.codexBackfillHours) * 60 * 60 * 1000;
    let slicesProcessed = 0;
    let stopTick = false;

    // §159-003f: 走査そのものを budget の対象にする。
    // 2026-07-28 実測で ~/.codex/sessions は 4721 ファイル / 9.0GB あり、
    // 1 ファイルあたり statSync + `SELECT offset` を全件に対して毎 tick 実行すると
    // 読み込みに到達する前に 3〜10 秒 event loop を塞いでいた (slow tick ログで観測)。
    // 打ち切ると末尾のファイルが永久に処理されないので、次 tick は前回の続きから
    // 走査する round-robin にして公平性を保つ。
    const scanCursorKey = "codex_rollout";
    const startIndex = files.length > 0 ? (this.scanCursors.get(scanCursorKey) ?? 0) % files.length : 0;
    let filesVisited = 0;

    for (let step = 0; step < files.length; step += 1) {
      const rolloutPath = files[(startIndex + step) % files.length] as string;
      // 進捗保証: 1 件目は budget 超過済みでも必ず見る。
      if (
        filesVisited > 0 &&
        Number.isFinite(budgetMs) &&
        Date.now() - startedAtMs > budgetMs
      ) {
        break;
      }
      filesVisited += 1;
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

      // §159-003e: offset が進まない tick の反復を避けるため、budget 超過済みでも
      // tick 全体の最初のスライスだけは処理する。
      if (
        slicesProcessed > 0 &&
        Number.isFinite(budgetMs) &&
        Date.now() - startedAtMs > budgetMs
      ) {
        break;
      }

      const context = this.loadCodexRolloutContext(sourceKey);
      const fallbackSessionId =
        inferSessionIdFromRolloutPath(rolloutPath) || context.sessionId || undefined;
      const committedContext: CodexSessionsContext = {
        sessionId: context.sessionId || fallbackSessionId,
        project: context.project || defaultProject,
        lastUserPrompt: context.lastUserPrompt,
        lastAssistantContent: context.lastAssistantContent,
      };
      let currentOffset = offset;
      let nextReadOffset = offset;
      let bytesReadThisFile = 0;
      let pending = Buffer.alloc(0);

      try {
        const fd = openSync(rolloutPath, "r");
        try {
          while (
            nextReadOffset < fileSize &&
            (!Number.isFinite(maxBytesPerFile) || bytesReadThisFile < maxBytesPerFile)
          ) {
            const remainingFileBytes = fileSize - nextReadOffset;
            const remainingReadBytes = Number.isFinite(maxBytesPerFile)
              ? maxBytesPerFile - bytesReadThisFile
              : remainingFileBytes;
            const readSize = Math.min(
              remainingFileBytes,
              remainingReadBytes,
              Number.isFinite(readSliceBytes) ? readSliceBytes : remainingFileBytes
            );
            if (readSize <= 0) break;

            const buffer = Buffer.alloc(readSize);
            const bytesRead = readSync(fd, buffer, 0, readSize, nextReadOffset);
            if (bytesRead <= 0) break;
            pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
            bytesReadThisFile += bytesRead;
            nextReadOffset += bytesRead;
            slicesProcessed += 1;

            const parsedChunk = parseCodexSessionsChunk({
              sourceKey,
              baseOffset: currentOffset,
              chunk: pending.toString("utf8"),
              fallbackNowIso: nowIso,
              context: committedContext,
              defaultSessionId: fallbackSessionId,
              defaultProject: defaultProject,
            });

            // 1 行が 64KB を超える場合は次スライスを連結する。ファイル上限または EOF
            // まで改行がなければ次 tick に回し、同一 while 内の無限再試行を防ぐ。
            if (parsedChunk.consumedBytes === 0) {
              // §159-003f (review): 行が完結していない間も budget を見る。ここを抜けないと
              // 1 行が複数スライスにまたがる場合に maxBytesPerFile まで読み続けてしまう。
              if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
              if (
                nextReadOffset >= fileSize ||
                (Number.isFinite(maxBytesPerFile) && bytesReadThisFile >= maxBytesPerFile)
              ) {
                break;
              }
              continue;
            }

            committedContext.sessionId = parsedChunk.context.sessionId || fallbackSessionId;
            committedContext.project = parsedChunk.context.project || defaultProject;
            let nextOffset = currentOffset + parsedChunk.consumedBytes;
            let budgetExhausted = false;
            let sliceDeferred = false;
            let processed = 0;
            let imported = 0;
            for (const entry of parsedChunk.events) {
              // §159-003c: insert ループも budget で打ち切る。中断位置は既存の失敗時と同じく
              // entry.lineOffset で保存する。1 件目では抜けない (offset が進まず同じ chunk を
              // 読み直し続けるため)。
              if (
                processed > 0 &&
                Number.isFinite(budgetMs) &&
                Date.now() - startedAtMs > budgetMs
              ) {
                nextOffset = Math.max(currentOffset, entry.lineOffset);
                budgetExhausted = true;
                sliceDeferred = true;
                break;
              }
              processed += 1;
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
                nextOffset = Math.max(currentOffset, entry.lineOffset);
                sliceDeferred = true;
                break;
              }
              const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
              if (!deduped) {
                imported += 1;
              }
              committedContext.sessionId = entry.sessionId || committedContext.sessionId;
              committedContext.project = entry.project || committedContext.project;
              if (entry.eventType === "user_prompt") {
                const prompt =
                  normalizeString(entry.payload.prompt) || normalizeString(entry.payload.content);
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

            if (sliceDeferred) {
              if (budgetExhausted) stopTick = true;
              break;
            }

            currentOffset = nextOffset;
            pending = pending.subarray(parsedChunk.consumedBytes);
            if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
              stopTick = true;
              break;
            }
          }
        } finally {
          closeSync(fd);
        }
      } catch {
        continue;
      }
      if (stopTick) break;
    }

    if (files.length > 0) {
      this.scanCursors.set(scanCursorKey, (startIndex + filesVisited) % files.length);
    }

    return summary;
  }

  /**
   * §160-005b: 本番実測で 1 tick 173,528ms event loop を塞いだ legacy codex 履歴
   * (`~/.codex/history.jsonl`) の取り込み。旧実装は `readFileSync` でファイル残り
   * 全部を一括読みし、entry ループに budget が無かった。§159-003c で
   * `ingestCodexSessionsRollouts()` が既に解いた「スライス読み → parse → budget 付き
   * insert ループ」の形にそろえる (context 追跡や複数ファイルの round-robin は
   * legacy には無いので、その部分だけ削って移植する)。
   */
  private ingestLegacyCodexHistoryFile(options?: { budgetMs?: number; maxBytesPerFile?: number }): CodexIngestSummary {
    const summary = emptyCodexIngestSummary();
    const historyPath = join(this.deps.config.codexProjectRoot, ".codex", "history.jsonl");
    if (!existsSync(historyPath)) {
      return summary;
    }

    summary.filesScanned += 1;

    // §160-005b DoD (a): 完了判定は statSync の実ファイルサイズを基準にする。
    // スライス読みに切り替えた後は途中経過の buffer 長 (= readSliceBytes 相当) を
    // 「ファイル全体の長さ」として使うと、64KB を超えた時点で毎回 offset > buffer.length
    // が成立してしまい、64KB 以降が永久に truncate 扱い (offset=0 リセット) になる。
    let fileSize = 0;
    try {
      fileSize = statSync(historyPath).size;
    } catch {
      return summary;
    }

    const sourceKey = `codex_history:${resolve(this.deps.config.codexProjectRoot)}`;
    const offsetRow = this.deps.db
      .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
      .get(sourceKey) as { offset: number } | null;

    let offset = offsetRow?.offset ?? 0;
    if (offset > fileSize) {
      offset = 0;
    }
    if (offset === fileSize) {
      return summary;
    }

    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    const maxBytesPerFile = options?.maxBytesPerFile ?? resolveIngestMaxBytesPerFile();
    const readSliceBytes = resolveIngestReadSliceBytes();
    const project = normalizeProjectName(resolve(this.deps.config.codexProjectRoot));

    let currentOffset = offset;
    let nextReadOffset = offset;
    let bytesReadThisFile = 0;
    let pending = Buffer.alloc(0);
    let imported = 0;

    try {
      const fd = openSync(historyPath, "r");
      try {
        while (
          nextReadOffset < fileSize &&
          (!Number.isFinite(maxBytesPerFile) || bytesReadThisFile < maxBytesPerFile)
        ) {
          const remainingFileBytes = fileSize - nextReadOffset;
          const remainingReadBytes = Number.isFinite(maxBytesPerFile)
            ? maxBytesPerFile - bytesReadThisFile
            : remainingFileBytes;
          const readSize = Math.min(
            remainingFileBytes,
            remainingReadBytes,
            Number.isFinite(readSliceBytes) ? readSliceBytes : remainingFileBytes
          );
          if (readSize <= 0) break;

          const buffer = Buffer.alloc(readSize);
          const bytesRead = readSync(fd, buffer, 0, readSize, nextReadOffset);
          if (bytesRead <= 0) break;
          pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
          bytesReadThisFile += bytesRead;
          nextReadOffset += bytesRead;

          const pendingChunk = pending.toString("utf8");
          const parsedChunk = parseCodexHistoryChunk({
            sourceKey,
            baseOffset: currentOffset,
            chunk: pendingChunk,
            fallbackNowIso: nowIso,
          });
          const consumedBytes = Buffer.byteLength(pendingChunk.slice(0, parsedChunk.consumedLength), "utf8");

          // 1 行が readSliceBytes (既定 64KB) を超える場合は次スライスと連結する。
          // 上限または EOF まで改行が来なければ次 tick に回し、同一 while 内で無限に
          // 待ち続けない (§159-003f と同型)。
          if (consumedBytes === 0) {
            if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
            if (
              nextReadOffset >= fileSize ||
              (Number.isFinite(maxBytesPerFile) && bytesReadThisFile >= maxBytesPerFile)
            ) {
              break;
            }
            continue;
          }

          let nextOffset = currentOffset + consumedBytes;
          let sliceDeferred = false;
          let entryIndex = 0;
          for (const entry of parsedChunk.events) {
            // §160-005b DoD (b)/(d): 1 件目は budget 超過済みでも必ず処理する。
            // さもないと offset が進まず同じ chunk を読み直し続ける。
            if (entryIndex > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
              nextOffset = Math.max(currentOffset, entry.lineOffset);
              sliceDeferred = true;
              break;
            }
            entryIndex += 1;
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
            if (!result.ok) {
              nextOffset = Math.max(currentOffset, entry.lineOffset);
              sliceDeferred = true;
              break;
            }
            const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
            if (!deduped) {
              imported += 1;
            }
          }

          // §160-005b DoD (b): updateIngestOffset は recordEvent が完了した範囲に
          // 対してのみ呼ぶ。先に楽観的に進めると未処理行が二度と読まれず消える。
          this.updateIngestOffset(sourceKey, nextOffset);

          if (sliceDeferred) break;

          currentOffset = nextOffset;
          pending = pending.subarray(consumedBytes);
          if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      // 読み込み失敗時は offset を進めず、次 tick で再試行する。
    }

    summary.eventsImported += imported;
    summary.historyEventsImported += imported;
    return summary;
  }

  /**
   * §159-003c: 定期 tick 用の codex 取り込み。`ingestCodexHistory()` は明示 API で
   * 完走させる契約なので、scheduler からはこちらを呼んで tick budget を効かせる。
   * scheduler が公開 API をそのまま呼ぶと budget が無効化される (実測で 12〜16 秒の
   * ブロックが残った) ため、経路を分けている。
   */
  private ingestCodexHistoryTick(): void {
    if (!this.deps.config.codexHistoryEnabled) return;
    this.ingestCodexSessionsRollouts();
    this.ingestLegacyCodexHistoryFile();
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

    // 明示 API は完走させる (§159-003c/§160-005b の budget は定期実行のみに効かせる)
    mergeCodexIngestSummary(
      summary,
      this.ingestCodexSessionsRollouts({ budgetMs: Infinity, maxBytesPerFile: Infinity })
    );
    mergeCodexIngestSummary(
      summary,
      this.ingestLegacyCodexHistoryFile({ budgetMs: Infinity, maxBytesPerFile: Infinity })
    );

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

  /**
   * §160-007: opencode DB 経路。`SELECT ... ORDER BY m.rowid ASC` に `LIMIT` が無く
   * offset 以降の全行を `.all()` で一括メモリ展開し、insert (entry) ループにも
   * budget チェックが無かった。本番実測で 1 tick 最大 4,618ms event loop を塞いだ。
   * ingestLegacyCodexHistoryFile (§160-005b) と同じ「入力を tick 単位で有限にする /
   * budget で打ち切る / 完了した範囲だけ offset を進める」形に揃える。SQL 経路なので
   * ファイル読みのようなスライスの概念は無く、`LIMIT` で 1 tick の読み込み行数を絞る
   * (MAX_OPENCODE_DB_ROWS_PER_INGEST のコメント参照)。
   */
  private ingestOpencodeDbMessages(options?: { budgetMs?: number; maxRows?: number }): OpencodeIngestSummary {
    const summary = emptyOpencodeIngestSummary();
    const sourceDbPath = this.getOpencodeDbPath();
    if (!existsSync(sourceDbPath)) {
      return summary;
    }

    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    const rawMaxRows = options?.maxRows ?? MAX_OPENCODE_DB_ROWS_PER_INGEST;
    // SQLite の LIMIT は負値で「無制限」を意味する。Infinity をそのまま bind すると
    // integer binding に失敗するため、Infinity/0 以下は -1 (無制限) に変換する。
    const maxRows = Number.isFinite(rawMaxRows) && rawMaxRows > 0 ? Math.floor(rawMaxRows) : -1;

    summary.filesScanned += 1;
    const sourceKey = `opencode_db_message:${resolve(sourceDbPath)}`;
    const cutoffMs = Date.now() - Math.max(0, this.getOpencodeBackfillHours()) * 60 * 60 * 1000;
    const offsetRow = this.deps.db
      .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
      .get(sourceKey) as { offset: number } | null;
    const hasOffset = offsetRow !== null && Number.isFinite(offsetRow.offset);
    const cursor = hasOffset ? Math.max(0, Math.floor(offsetRow?.offset ?? 0)) : 0;

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
                LIMIT ?
              `
            )
            .all(cursor, maxRows)
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
                LIMIT ?
              `
            )
            .all(cutoffMs, maxRows)) as Array<{
        rowid: number;
        message_id: string;
        session_id: string;
        time_created: number;
        message_data: string;
        session_directory: string;
      }>;

      // §160-007 レビュー: !hasOffset && rows.length === 0 の早期リターンは
      // 「0 件処理したのに offset を最大まで進める」ように見えるが、ファイル経路の
      // `!hasOffset && mtimeMs < cutoffMs` (backfill window の外側は初回から
      // 取り込み対象外にする) と同型の意図的な設計。cutoffMs 以降に対象行が 1 件も
      // 無い = backfill window の外側にしかデータが無いということなので、その古い
      // 行は元から取り込み対象外であり「取りこぼし」ではない (LIMIT を追加しても
      // rows.length === 0 の判定自体は変わらない)。
      if (!hasOffset && rows.length === 0 && maxRow > 0) {
        this.updateIngestOffset(sourceKey, maxRow);
        summary.filesSkippedBackfill += 1;
        return summary;
      }

      if (!hasOffset && rows.length > 0 && rows[0] && rows[0].rowid > 1) {
        summary.filesSkippedBackfill += 1;
      }

      let imported = 0;
      let entryIndex = 0;
      let advancedTo = cursor;
      for (const row of rows) {
        // §160-005b と同型: 1 件目は budget 超過済みでも必ず処理する。さもないと
        // offset (rowid カーソル) が進まず、次 tick も同じ範囲を読み直し続ける。
        if (entryIndex > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
          break;
        }
        entryIndex += 1;

        const rowId = Math.floor(row.rowid || 0);
        const normalizedRow: OpencodeDbMessageRow = {
          rowid: rowId,
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
        if (!parsed) {
          // recordEvent すべき内容が無い行 (role が user/assistant でない等)。
          // データは変化しないため恒久的にスキップして良く、offset を進めて構わない。
          advancedTo = Math.max(advancedTo, rowId);
          continue;
        }

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

        if (!result.ok) {
          // §160-007 罠 2: updateIngestOffset は recordEvent が完了した範囲にのみ
          // 呼ぶ。未完了の行より先へ進めず、次 tick に再試行させる。
          break;
        }

        advancedTo = Math.max(advancedTo, rowId);
        const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
        if (!deduped) {
          imported += 1;
        }
      }

      if (advancedTo > 0) {
        this.updateIngestOffset(sourceKey, advancedTo);
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

  /**
   * §160-007: opencode ストレージ経路。旧実装は `readFileSync` でファイル残り全体を
   * 一括読みし、ファイル一覧のループにも entry ループにも budget チェックが無かった。
   * 本番実測で 1 tick 最大 4,618ms event loop を塞いだ。メッセージファイルは 1 件
   * あたり小さいが、件数 (ファイル数) が多いと合計時間が積み上がるため、
   * ingestCodexSessionsRollouts (§159-003c) と同型の「ファイル一覧を round-robin で
   * 走査し、1 件目は必ず処理する budget 付きファイルループ」を外側に、
   * ingestLegacyCodexHistoryFile (§160-005b) と同型の「statSync 基準のスライス読み +
   * budget 付き entry ループ」を内側に組み合わせる。
   */
  private ingestOpencodeStorageMessages(options?: { budgetMs?: number; maxBytesPerFile?: number }): OpencodeIngestSummary {
    const summary = emptyOpencodeIngestSummary();
    const storageRoot = this.getOpencodeStorageRoot();
    const messageRoot = join(storageRoot, "message");
    const sessionRoot = join(storageRoot, "session");
    const partsRoot = join(storageRoot, "part");

    if (!existsSync(messageRoot)) {
      return summary;
    }

    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    const maxBytesPerFile = options?.maxBytesPerFile ?? resolveIngestMaxBytesPerFile();
    const readSliceBytes = resolveIngestReadSliceBytes();

    const files = listOpencodeMessageFiles(messageRoot);
    const sessionDirectoryMap = this.loadOpencodeSessionDirectoryMap(sessionRoot);
    const cutoffMs = Date.now() - Math.max(0, this.getOpencodeBackfillHours()) * 60 * 60 * 1000;

    // §159-003f と同型: ファイル一覧の走査そのものを budget の対象にする。件数が
    // 多い場合に打ち切ると末尾のファイルが永久に処理されないため、次 tick は前回の
    // 続きから走査する round-robin にして公平性を保つ。
    const scanCursorKey = "opencode_storage_message";
    const startIndex = files.length > 0 ? (this.scanCursors.get(scanCursorKey) ?? 0) % files.length : 0;
    let filesVisited = 0;
    let stopTick = false;

    for (let step = 0; step < files.length; step += 1) {
      const messagePath = files[(startIndex + step) % files.length] as string;
      // 進捗保証: 1 件目は budget 超過済みでも必ず見る。
      if (filesVisited > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
        break;
      }
      filesVisited += 1;
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

      // §160-007 (review 指摘): parseOpencodeMessageChunk はファイル 1 件 = JSON 1 個を
      // 前提とし、途中まで読んだスライスでは JSON.parse が失敗して consumedBytes 0 を
      // 返す。つまり maxBytesPerFile を超えるファイルは、上限まで読んでも決して
      // 完成せず、毎巡 512KB を読み捨てるだけで永久に取り込まれない。antigravity
      // workspace と同じ構造 (全文が要る parser) なので、同じ扱いに揃える:
      // 読む前にサイズで弾き、件数を数え、warn は source_key ごとに初回 1 回。
      if (Number.isFinite(maxBytesPerFile) && fileSize > maxBytesPerFile) {
        summary.filesSkippedTooLarge += 1;
        if (!this.warnedTooLargeSourceKeys.has(sourceKey)) {
          this.warnedTooLargeSourceKeys.add(sourceKey);
          console.warn(
            `[ingest] opencode message file too large, skipping until it shrinks or the cap is raised: ${messagePath} (${fileSize} bytes > maxBytesPerFile=${maxBytesPerFile})`
          );
        }
        continue;
      }

      if (offset > fileSize) {
        offset = 0;
      }
      if (offset === fileSize) {
        continue;
      }

      let currentOffset = offset;
      let nextReadOffset = offset;
      let bytesReadThisFile = 0;
      let pending = Buffer.alloc(0);

      try {
        const fd = openSync(messagePath, "r");
        try {
          while (
            nextReadOffset < fileSize &&
            (!Number.isFinite(maxBytesPerFile) || bytesReadThisFile < maxBytesPerFile)
          ) {
            const remainingFileBytes = fileSize - nextReadOffset;
            const remainingReadBytes = Number.isFinite(maxBytesPerFile)
              ? maxBytesPerFile - bytesReadThisFile
              : remainingFileBytes;
            const readSize = Math.min(
              remainingFileBytes,
              remainingReadBytes,
              Number.isFinite(readSliceBytes) ? readSliceBytes : remainingFileBytes
            );
            if (readSize <= 0) break;

            const buffer = Buffer.alloc(readSize);
            const bytesRead = readSync(fd, buffer, 0, readSize, nextReadOffset);
            if (bytesRead <= 0) break;
            pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
            bytesReadThisFile += bytesRead;
            nextReadOffset += bytesRead;

            const parsedChunk = parseOpencodeMessageChunk({
              sourceKey,
              baseOffset: currentOffset,
              chunk: pending.toString("utf8"),
              fallbackNowIso: nowIso,
              resolveSessionDirectory: (sessionId) => sessionDirectoryMap.get(sessionId),
              resolveMessageText: (messageId) => this.readOpencodeMessageText(partsRoot, messageId),
            });

            // メッセージファイルは 1 件で 1 つの JSON オブジェクトなので、
            // readSliceBytes を超える大きさなら次スライスと連結する。上限または
            // EOF まで完結しなければ次 tick に回し、同一 while 内で無限に
            // 待ち続けない (§159-003f と同型)。
            if (parsedChunk.consumedBytes === 0) {
              if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
              if (
                nextReadOffset >= fileSize ||
                (Number.isFinite(maxBytesPerFile) && bytesReadThisFile >= maxBytesPerFile)
              ) {
                break;
              }
              continue;
            }

            let nextOffset = currentOffset + parsedChunk.consumedBytes;
            let sliceDeferred = false;
            let entryIndex = 0;
            let imported = 0;
            for (const entry of parsedChunk.events) {
              // 1 件目は budget 超過済みでも必ず処理する。さもないと offset が
              // 進まず同じ chunk を読み直し続ける。
              if (entryIndex > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
                nextOffset = Math.max(currentOffset, entry.lineOffset);
                sliceDeferred = true;
                break;
              }
              entryIndex += 1;
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
              if (!result.ok) {
                // §160-007 罠 2: 未完了の entry より先へ offset を進めない。この
                // ファイルは次 tick に再試行させ、他のファイルの処理は続ける
                // (budget 超過ではないので stopTick は立てない)。
                nextOffset = Math.max(currentOffset, entry.lineOffset);
                sliceDeferred = true;
                break;
              }
              const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
              if (!deduped) {
                imported += 1;
              }
            }

            summary.eventsImported += imported;
            summary.storageEventsImported += imported;
            // §160-007 レビュー: 1 件目で recordEvent が失敗すると nextOffset は
            // currentOffset と等値になる。無条件に書くと初回 tick で offset 0 の行が
            // でき、以後 hasOffset が恒久的に true になって backfill window 判定
            // (`!hasOffset && mtimeMs < cutoffMs`) が二度と効かない。cursor 経路と
            // 同じく、実際に消費した範囲があるときだけ永続化する。
            if (nextOffset > currentOffset) {
              this.updateIngestOffset(sourceKey, nextOffset);
            }

            if (sliceDeferred) {
              break;
            }

            currentOffset = nextOffset;
            pending = pending.subarray(parsedChunk.consumedBytes);
            if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
              stopTick = true;
              break;
            }
          }
        } finally {
          closeSync(fd);
        }
      } catch {
        continue;
      }
      if (stopTick) break;
    }

    if (files.length > 0) {
      this.scanCursors.set(scanCursorKey, (startIndex + filesVisited) % files.length);
    }

    return summary;
  }

  /**
   * §160-007: 定期 tick 用の opencode 取り込み。`ingestOpencodeHistory()` は
   * 明示 API として完走させる契約 (Spec.md「## Periodic Ingest Budget」の
   * explicit ingest exemption) なので、scheduler からはこちらを呼んで tick
   * budget を効かせる。ingestCodexHistoryTick (§159-003c) と同じ理由で経路を分ける:
   * scheduler が公開 API をそのまま呼ぶと budget が無効化される。
   */
  private ingestOpencodeHistoryTick(): void {
    if (!this.isOpencodeIngestEnabled()) return;
    this.ingestOpencodeDbMessages();
    this.ingestOpencodeStorageMessages();
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
            files_skipped_too_large: 0,
            db_events_imported: 0,
            storage_events_imported: 0,
          },
        ],
        {},
        { ingest_mode: "disabled" }
      );
    }

    const summary = emptyOpencodeIngestSummary();
    // 明示 API は完走させる (§159-003c/§160-007 の budget は定期実行のみに効かせる)
    mergeOpencodeIngestSummary(
      summary,
      this.ingestOpencodeDbMessages({ budgetMs: Infinity, maxRows: Infinity })
    );
    mergeOpencodeIngestSummary(
      summary,
      this.ingestOpencodeStorageMessages({ budgetMs: Infinity, maxBytesPerFile: Infinity })
    );

    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
          files_skipped_too_large: summary.filesSkippedTooLarge,
          db_events_imported: summary.dbEventsImported,
          storage_events_imported: summary.storageEventsImported,
        },
      ],
      {},
      { ingest_mode: "opencode_hybrid_v1" }
    );
  }

  async ingestHermesState(request: HermesStateIngestRequest): Promise<ApiResponse> {
    const startedAt = performance.now();
    try {
      const stats = await ingestHermesStateDbQueued({
        request,
        recordEvent: (event, options) => this.deps.recordEventQueued(event, options),
      });
      return makeResponse(
        startedAt,
        [stats],
        {
          source_db_path: stats.source_db_path,
          project: stats.project,
          dry_run: stats.dry_run,
          limit: stats.limit,
          since: stats.since,
        },
        { ingest_mode: "hermes_state_db_v1" }
      );
    } catch (error) {
      return makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        {
          source_db_path: request.source_db_path || "",
          project: request.project || "",
          dry_run: request.dry_run !== false,
        }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Cursor ingest メソッド（core から移動）
  // ---------------------------------------------------------------------------

  private ingestCursorHooksEvents(options?: {
    budgetMs?: number;
    maxBytesPerFile?: number;
    maxEvents?: number;
  }): CursorIngestSummary {
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

    // §159-003d: 実測で cursor tick が 1.1〜1.4 秒 event loop を塞いでいた。件数上限
    // (MAX_CURSOR_HOOK_EVENTS_PER_INGEST) は insert しか縛らず、read + utf8 変換 +
    // parse は残り全体を対象にしていたため。1 回に読む量を絞る。
    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    const maxBytesPerFile = options?.maxBytesPerFile ?? resolveIngestMaxBytesPerFile();
    // §160-007 (review 指摘): 件数上限も override 可能にする。budget だけ Infinity に
    // しても、この定数が 50 件で打ち切るため明示 API が完走しなかった
    // (実測: 遅延ゼロでも 120 件中 50 件)。MAX_OPENCODE_DB_ROWS_PER_INGEST と同じ扱い。
    const maxEvents = options?.maxEvents ?? MAX_CURSOR_HOOK_EVENTS_PER_INGEST;
    const readSliceBytes = resolveIngestReadSliceBytes();
    let currentOffset = offset;
    let nextReadOffset = offset;
    let bytesReadThisFile = 0;
    let pending = Buffer.alloc(0);
    let processed = 0;
    let slicesProcessed = 0;

    try {
      const fd = openSync(eventsPath, "r");
      try {
        while (
          nextReadOffset < fileSize &&
          (!Number.isFinite(maxBytesPerFile) || bytesReadThisFile < maxBytesPerFile)
        ) {
          const remainingFileBytes = fileSize - nextReadOffset;
          const remainingReadBytes = Number.isFinite(maxBytesPerFile)
            ? maxBytesPerFile - bytesReadThisFile
            : remainingFileBytes;
          const readSize = Math.min(
            remainingFileBytes,
            remainingReadBytes,
            Number.isFinite(readSliceBytes) ? readSliceBytes : remainingFileBytes
          );
          if (readSize <= 0) break;

          const buffer = Buffer.alloc(readSize);
          const bytesRead = readSync(fd, buffer, 0, readSize, nextReadOffset);
          if (bytesRead <= 0) break;
          pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
          bytesReadThisFile += bytesRead;
          nextReadOffset += bytesRead;
          slicesProcessed += 1;

          const parsedChunk = parseCursorHooksChunk({
            sourceKey,
            baseOffset: currentOffset,
            chunk: pending.toString("utf8"),
            fallbackNowIso: nowIso,
          });

          // 64KB 内に改行がない長大行は次スライスまで連結する。上限または EOF で
          // offset を据え置いて抜けるため、同じ tick 内では無限ループしない。
          if (parsedChunk.consumedBytes === 0) {
            // §159-003f (review): 行が完結していない間も budget を見る。ここを抜けないと
            // 1 行が複数スライスにまたがる場合に maxBytesPerFile まで読み続けてしまう。
            if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
            if (
              nextReadOffset >= fileSize ||
              (Number.isFinite(maxBytesPerFile) && bytesReadThisFile >= maxBytesPerFile)
            ) {
              break;
            }
            continue;
          }

          let imported = 0;
          let nextOffset = currentOffset + parsedChunk.consumedBytes;
          let sliceDeferred = false;
          let sliceProcessed = 0;
          for (const entry of parsedChunk.events) {
            // §159-003d: 件数上限に加えて時間でも打ち切る。既存の deferred 経路と同じ形で
            // 中断位置を保存するので、次 tick が続きから再開する。
            const overBudget =
              processed > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs;
            if (processed >= maxEvents || overBudget) {
              nextOffset = Math.max(currentOffset, entry.lineOffset);
              summary.eventsDeferred = parsedChunk.events.length - sliceProcessed;
              summary.retryOffset = nextOffset;
              sliceDeferred = true;
              break;
            }
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
            if (!result.ok) {
              nextOffset = Math.max(currentOffset, entry.lineOffset);
              summary.eventsFailed += 1;
              summary.retryOffset = nextOffset;
              summary.lastRecordError = result.error || "recordEvent failed";
              sliceDeferred = true;
              break;
            }
            processed += 1;
            sliceProcessed += 1;
            const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
            if (!deduped) {
              imported += 1;
            }
          }

          summary.eventsImported += imported;
          summary.hooksEventsImported += imported;
          if (nextOffset > currentOffset) {
            this.updateIngestOffset(sourceKey, nextOffset);
          }
          if (sliceDeferred) break;

          currentOffset = nextOffset;
          pending = pending.subarray(parsedChunk.consumedBytes);
          if (
            processed >= maxEvents ||
            (slicesProcessed > 0 &&
              Number.isFinite(budgetMs) &&
              Date.now() - startedAtMs > budgetMs)
          ) {
            break;
          }
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      return summary;
    }

    return summary;
  }

  /**
   * §160-007 (review 指摘): 定期 tick 用の cursor 取り込み。`ingestCursorHistory()` は
   * `/v1/ingest/cursor-history` の明示 API なので budget で打ち切ってはならない。
   *
   * この経路は §159 で budget を入れた時点から明示 API と融合したままだった
   * (0.29.4 で出荷済み)。antigravity / gemini と同じ欠陥で、同じ形で直す。
   */
  private ingestCursorHistoryTick(): void {
    if (!this.isCursorIngestEnabled()) return;
    this.ingestCursorHooksEvents();
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
            hooks_events_failed: 0,
            hooks_events_deferred: 0,
          },
        ],
        {},
        { ingest_mode: "disabled" }
      );
    }

    const summary = emptyCursorIngestSummary();
    // 明示 API は完走させる (Spec.md の explicit ingest exemption)。
    mergeCursorIngestSummary(
      summary,
      this.ingestCursorHooksEvents({ budgetMs: Infinity, maxBytesPerFile: Infinity, maxEvents: Infinity })
    );
    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
          hooks_events_imported: summary.hooksEventsImported,
          hooks_events_failed: summary.eventsFailed,
          hooks_events_deferred: summary.eventsDeferred,
          retry_offset: summary.retryOffset,
          last_record_error: summary.lastRecordError,
        },
      ],
      {},
      {
        ingest_mode: "cursor_spool_v1",
        hooks_events_failed: summary.eventsFailed,
        hooks_events_deferred: summary.eventsDeferred,
        retry_offset: summary.retryOffset,
        last_record_error: summary.lastRecordError,
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Antigravity ingest メソッド（core から移動）
  // ---------------------------------------------------------------------------

  /**
   * §160-007: runTick から毎 tick 呼ばれるのに読み込み上限も budget も無かった経路。
   * 1 ファイル = 高々 1 event (JSONL のような複数 entry ではない) なので、
   * ingestLegacyCodexHistoryFile (§160-005b) 型のスライス読みは対象外
   * (parseAntigravityFile は見出し抽出に文書全体の trim 済みテキストを要求するため、
   * 部分読みに切り替えると dedupeHash/内容が変わってしまう)。budget が効くべきなのは
   * 「何百ファイルも回る外側ループ」なので、ingestCodexSessionsRollouts
   * (§159-003c/f) の外側 round-robin + budget を移植する。
   *
   * §160-007 (review 指摘): budget は経過時間でしか判定できず、readFileSync で
   * ファイル全文を読み終えるまで一度もチェックが走らない。1 ファイルが巨大だと
   * budget があっても意味を成さない (Spec.md `## Periodic Ingest Budget`)。そのため
   * readFileSync の前に maxBytesPerFile (既定 512KB, resolveIngestMaxBytesPerFile())
   * でサイズ判定し、超えるファイルは読まずにスキップする。
   */
  private ingestAntigravityWorkspace(
    rootDir: string,
    options?: { budgetMs?: number; maxBytesPerFile?: number }
  ): AntigravityIngestSummary {
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

    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    // §160-007 (review 指摘): budget は「読んだ後」にしか効かない。1 ファイルが
    // maxBytesPerFile を超える場合、readFileSync に到達する前にサイズで弾く
    // (Spec.md `## Periodic Ingest Budget`: 読み込み量そのものを時間と独立に上限化する)。
    const maxBytesPerFile = options?.maxBytesPerFile ?? resolveIngestMaxBytesPerFile();

    // §159-003f と同型: 走査そのものを budget の対象にする。打ち切ると末尾のファイルが
    // 永久に処理されないので、次 tick は前回の続きから走査する round-robin にする。
    const scanCursorKey = `antigravity_workspace:${resolve(rootDir)}`;
    const startIndex =
      uniqueFiles.length > 0 ? (this.scanCursors.get(scanCursorKey) ?? 0) % uniqueFiles.length : 0;
    let filesVisited = 0;

    for (let step = 0; step < uniqueFiles.length; step += 1) {
      const filePath = uniqueFiles[(startIndex + step) % uniqueFiles.length] as string;
      // 進捗保証: 1 件目は budget 超過済みでも必ず見る。
      if (filesVisited > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
        break;
      }
      filesVisited += 1;
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

      // §160-007 (review 指摘): サイズ上限を超えるファイルは読まずにスキップする。
      // offset は進めない — 進めるとこのファイルのイベントは二度と取り込まれない
      // (欠落は無害な繰り返しより悪い)。進めなくても、このチェックは readFileSync
      // より前にあるので毎 round-robin サイクルの再訪問コストは statSync 1 回分
      // (O(1)) で済み、event loop を塞がない。round-robin の進捗保証
      // (`filesVisited > 0`) は「訪問したか」だけを見て「実際に読めたか」は見ない
      // ので、この軽いスキップを繰り返しても他ファイルの走査を飢餓させない。
      if (Number.isFinite(maxBytesPerFile) && fileSize > maxBytesPerFile) {
        summary.filesSkippedTooLarge += 1;
        // 同一ファイルは毎 tick ここを通るので、warn は source_key ごとに初回のみ。
        if (!this.warnedTooLargeSourceKeys.has(sourceKey)) {
          this.warnedTooLargeSourceKeys.add(sourceKey);
          console.warn(
            `[ingest] antigravity file too large, skipping until it shrinks or the cap is raised: ${filePath} (${fileSize} bytes > maxBytesPerFile=${maxBytesPerFile})`
          );
        }
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

      // §160-007: updateIngestOffset は recordEvent が完了した範囲に対してのみ呼ぶ。
      // 旧実装は recordEvent の成否を見ずに無条件で fileSize まで進めていたため、
      // 書き込み失敗時にこのファイルのイベントが二度と読まれず消えていた。
      let recordFailed = false;
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
        if (!result.ok) {
          recordFailed = true;
        } else {
          const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
          if (!deduped) {
            summary.eventsImported += 1;
            if (parsed.eventType === "checkpoint") {
              summary.checkpointEventsImported += 1;
            } else {
              summary.toolEventsImported += 1;
            }
          }
        }
      }

      if (!recordFailed) {
        this.updateIngestOffset(sourceKey, fileSize);
      }
    }

    if (uniqueFiles.length > 0) {
      this.scanCursors.set(scanCursorKey, (startIndex + filesVisited) % uniqueFiles.length);
    }

    return summary;
  }

  /**
   * §160-007: legacy codex history (§160-005b) と同じ「readFileSync 全文読み + budget
   * 無し entry ループ」だったうえ、複数ログファイルを回る外側ループにも budget が無い
   * (ingestCodexSessionsRollouts §159-003c/f と同じ穴)。両方を組み合わせて移植する:
   * 外側は round-robin + budget、1 ファイルの中身はスライス読み + budget 付き entry
   * ループ。gemini/codex と異なり複数ファイルに跨る文脈 (context) は無いので、その
   * 部分だけ削って移植する。
   */
  private ingestAntigravityLogEvents(options?: {
    budgetMs?: number;
    maxBytesPerFile?: number;
  }): AntigravityIngestSummary {
    const summary = emptyAntigravityIngestSummary();
    const logsRoot = this.getAntigravityLogsRoot();
    if (!existsSync(logsRoot)) {
      return summary;
    }

    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    const maxBytesPerFile = options?.maxBytesPerFile ?? resolveIngestMaxBytesPerFile();
    const readSliceBytes = resolveIngestReadSliceBytes();

    const logFiles = listAntigravityPlannerLogFiles(logsRoot);
    const cutoffMs = Date.now() - Math.max(0, this.getAntigravityBackfillHours()) * 60 * 60 * 1000;

    // §159-003f と同型: 走査そのものを budget の対象にする。打ち切ると末尾のファイルが
    // 永久に処理されないので、次 tick は前回の続きから走査する round-robin にする。
    const scanCursorKey = `antigravity_log_scan:${resolve(logsRoot)}`;
    const startIndex = logFiles.length > 0 ? (this.scanCursors.get(scanCursorKey) ?? 0) % logFiles.length : 0;
    let filesVisited = 0;
    let slicesProcessed = 0;
    let stopTick = false;

    for (let step = 0; step < logFiles.length; step += 1) {
      const filePath = logFiles[(startIndex + step) % logFiles.length] as string;
      // 進捗保証: 1 ファイル目は budget 超過済みでも必ず見る。
      if (filesVisited > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
        break;
      }
      filesVisited += 1;
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

      // 進捗保証: tick 全体で最初のスライスは budget 超過済みでも必ず処理する
      // (さもないと offset が進まず走査だけを繰り返す)。
      if (slicesProcessed > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
        break;
      }

      const resolved = this.resolveAntigravityLogProject(filePath);
      let currentOffset = offset;
      let nextReadOffset = offset;
      let bytesReadThisFile = 0;
      let pending = Buffer.alloc(0);

      try {
        const fd = openSync(filePath, "r");
        try {
          while (
            nextReadOffset < fileSize &&
            (!Number.isFinite(maxBytesPerFile) || bytesReadThisFile < maxBytesPerFile)
          ) {
            const remainingFileBytes = fileSize - nextReadOffset;
            const remainingReadBytes = Number.isFinite(maxBytesPerFile)
              ? maxBytesPerFile - bytesReadThisFile
              : remainingFileBytes;
            const readSize = Math.min(
              remainingFileBytes,
              remainingReadBytes,
              Number.isFinite(readSliceBytes) ? readSliceBytes : remainingFileBytes
            );
            if (readSize <= 0) break;

            const buffer = Buffer.alloc(readSize);
            const bytesRead = readSync(fd, buffer, 0, readSize, nextReadOffset);
            if (bytesRead <= 0) break;
            pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
            bytesReadThisFile += bytesRead;
            nextReadOffset += bytesRead;
            slicesProcessed += 1;

            const parsedChunk = parseAntigravityLogChunk({
              sourceKey,
              baseOffset: currentOffset,
              chunk: pending.toString("utf8"),
              fallbackNowIso: nowIso,
              project: resolved.project || "unknown",
              sessionSeed: resolved.sessionSeed || "planner",
              filePath,
            });

            // 1 行が readSliceBytes を超える場合は次スライスと連結する。上限または EOF
            // まで改行が来なければ次 tick に回し、同一 while 内で無限に待ち続けない
            // (§159-003f / §160-005b と同型)。
            if (parsedChunk.consumedBytes === 0) {
              if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
              if (
                nextReadOffset >= fileSize ||
                (Number.isFinite(maxBytesPerFile) && bytesReadThisFile >= maxBytesPerFile)
              ) {
                break;
              }
              continue;
            }

            let nextOffset = currentOffset + parsedChunk.consumedBytes;
            let budgetExhausted = false;
            let sliceDeferred = false;
            let entryIndex = 0;
            let imported = 0;
            for (const entry of parsedChunk.events) {
              // 1 件目は budget 超過済みでも必ず処理する (さもないと offset が進まず
              // 同じ chunk を読み直し続ける)。
              if (entryIndex > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
                nextOffset = Math.max(currentOffset, entry.lineOffset);
                budgetExhausted = true;
                sliceDeferred = true;
                break;
              }
              entryIndex += 1;
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
              if (!result.ok) {
                nextOffset = Math.max(currentOffset, entry.lineOffset);
                sliceDeferred = true;
                break;
              }
              const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
              if (!deduped) {
                imported += 1;
              }
            }

            summary.eventsImported += imported;
            summary.logEventsImported += imported;
            // §160-007: updateIngestOffset は recordEvent が完了した範囲に対してのみ
            // 呼ぶ。先に楽観的に進めると未処理行が二度と読まれず消える。
            // さらに、消費 0 バイトのときは offset 行自体を作らない。作ると初回 tick で
            // hasOffset が true になり、backfill window 判定が恒久的に無効化される。
            if (nextOffset > currentOffset) {
              this.updateIngestOffset(sourceKey, nextOffset);
            }

            if (sliceDeferred) {
              if (budgetExhausted) stopTick = true;
              break;
            }

            currentOffset = nextOffset;
            pending = pending.subarray(parsedChunk.consumedBytes);
            if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
              stopTick = true;
              break;
            }
          }
        } finally {
          closeSync(fd);
        }
      } catch {
        continue;
      }
      if (stopTick) break;
    }

    if (logFiles.length > 0) {
      this.scanCursors.set(scanCursorKey, (startIndex + filesVisited) % logFiles.length);
    }

    return summary;
  }

  /**
   * §160-007 (review 指摘): 定期 tick 用の antigravity 取り込み。
   * `ingestAntigravityHistory()` は `/v1/ingest/antigravity-history` が呼ぶ明示 API
   * であり、Spec.md「## Periodic Ingest Budget」の explicit ingest exemption により
   * 完走させる契約。scheduler がその公開 API をそのまま呼ぶと、明示呼び出しの側が
   * tick budget で打ち切られてしまう (ingestOpencodeHistoryTick / ingestCodexHistoryTick
   * と同じ理由で経路を分ける)。
   *
   * さらに workspace root は operator が設定する可変長リストなので、root ごとに
   * 独立した budget を与えると 1 tick の最悪ブロックが root 数に比例して伸びる。
   * ここでは tick 全体で 1 つの budget を共有し、各 root には残り時間だけを渡す。
   */
  private ingestAntigravityHistoryTick(): void {
    if (!this.isAntigravityIngestEnabled()) return;

    const startedAtMs = Date.now();
    const budgetMs = resolveIngestTickBudgetMs();
    const remaining = (): number =>
      Number.isFinite(budgetMs) ? Math.max(0, budgetMs - (Date.now() - startedAtMs)) : budgetMs;

    // budget を共有する以上、走査は必ず先頭 root から始まる。1 つ目の root が毎回
    // budget を使い切ると 2 つ目以降が永久に処理されないので、ファイル走査と同じ
    // round-robin を root の並びにも掛ける (§159-003f と同型)。
    const roots = this.getAntigravityWorkspaceRoots();
    const rootCursorKey = "antigravity_root_scan";
    const startIndex = roots.length > 0 ? (this.scanCursors.get(rootCursorKey) ?? 0) % roots.length : 0;
    let rootsVisited = 0;
    for (let step = 0; step < roots.length; step += 1) {
      // 進捗保証: 1 root 目は budget を使い切っていても必ず見る。さもないと
      // root が 1 つも進まない tick が続きうる。
      if (rootsVisited > 0 && remaining() <= 0) break;
      rootsVisited += 1;
      this.ingestAntigravityWorkspace(roots[(startIndex + step) % roots.length] as string, {
        budgetMs: remaining(),
      });
    }
    if (roots.length > 0) {
      this.scanCursors.set(rootCursorKey, (startIndex + rootsVisited) % roots.length);
    }
    // log 経路は budget を使い切った状態で呼ばれうるが、内部に「1 ファイル目は
    // 必ず見る」進捗保証と round-robin cursor があるため、tick あたり最低 1 件は
    // 進む。遅くはなるが飢餓にはならない。
    this.ingestAntigravityLogEvents({ budgetMs: remaining() });
  }

  /**
   * §160-007 (review 指摘): 定期 tick 用の gemini 取り込み。理由は
   * `ingestAntigravityHistoryTick` と同じ — `ingestGeminiHistory()` は
   * `/v1/ingest/gemini-history` の明示 API なので budget で打ち切ってはならない。
   */
  private ingestGeminiHistoryTick(): void {
    if (!this.isGeminiIngestEnabled()) return;
    this.ingestGeminiEvents();
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
            files_skipped_too_large: 0,
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

    // 明示 API は完走させる (Spec.md「## Periodic Ingest Budget」の explicit ingest
    // exemption)。timer 経路は ingestAntigravityHistoryTick が担当する。
    const unbounded = { budgetMs: Infinity, maxBytesPerFile: Infinity };
    const roots = this.getAntigravityWorkspaceRoots();
    const summary = emptyAntigravityIngestSummary();
    for (const root of roots) {
      mergeAntigravityIngestSummary(summary, this.ingestAntigravityWorkspace(root, unbounded));
    }
    mergeAntigravityIngestSummary(summary, this.ingestAntigravityLogEvents(unbounded));

    return makeResponse(
      startedAt,
      [
        {
          events_imported: summary.eventsImported,
          files_scanned: summary.filesScanned,
          files_skipped_backfill: summary.filesSkippedBackfill,
          files_skipped_too_large: summary.filesSkippedTooLarge,
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

  /**
   * §160-007: 本番ログで最大 3,030ms event loop を塞いだ gemini イベントスプールの
   * 取り込み。旧実装は `Buffer.alloc(fileSize - offset)` でファイル残り全部を一括読み
   * し、entry ループに budget も無く、`updateIngestOffset` が処理済み範囲と無関係に
   * (`offset + parsedChunk.consumedBytes` を常に) 進んでいた。ingestLegacyCodexHistoryFile
   * (§160-005b) が既に解いた「スライス読み → parse → budget 付き insert ループ」の形に
   * そろえる。gemini のパーサ (parseGeminiEventsChunk) は codex-sessions.ts と同じ
   * バイト走査 (`buffer.indexOf(0x0a, cursor)`) で `lineOffset` を `.trim()` 前に
   * 確定済みなので、パーサ側の変更は不要。
   */
  private ingestGeminiEvents(options?: { budgetMs?: number; maxBytesPerFile?: number }): GeminiIngestSummary {
    const summary = emptyGeminiIngestSummary();
    const eventsPath = this.getGeminiEventsPath();
    if (!existsSync(eventsPath)) {
      return summary;
    }

    summary.filesScanned += 1;
    const sourceKey = `gemini_events:${resolve(eventsPath)}`;
    const cutoffMs = Date.now() - Math.max(0, this.getGeminiBackfillHours()) * 60 * 60 * 1000;

    // §160-005b DoD (a) と同じ理由: 完了判定は statSync の実ファイルサイズを基準にする。
    // スライス読みに切り替えた後、途中経過 buffer 長を「ファイル全体」として使うと
    // readSliceBytes を超えた時点で毎回 offset > buffer.length が成立し、それ以降が
    // 永久に truncate 扱い (offset=0 リセット) になる。
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

    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    const maxBytesPerFile = options?.maxBytesPerFile ?? resolveIngestMaxBytesPerFile();
    const readSliceBytes = resolveIngestReadSliceBytes();

    let currentOffset = offset;
    let nextReadOffset = offset;
    let bytesReadThisFile = 0;
    let pending = Buffer.alloc(0);
    let imported = 0;

    try {
      const fd = openSync(eventsPath, "r");
      try {
        while (
          nextReadOffset < fileSize &&
          (!Number.isFinite(maxBytesPerFile) || bytesReadThisFile < maxBytesPerFile)
        ) {
          const remainingFileBytes = fileSize - nextReadOffset;
          const remainingReadBytes = Number.isFinite(maxBytesPerFile)
            ? maxBytesPerFile - bytesReadThisFile
            : remainingFileBytes;
          const readSize = Math.min(
            remainingFileBytes,
            remainingReadBytes,
            Number.isFinite(readSliceBytes) ? readSliceBytes : remainingFileBytes
          );
          if (readSize <= 0) break;

          const buffer = Buffer.alloc(readSize);
          const bytesRead = readSync(fd, buffer, 0, readSize, nextReadOffset);
          if (bytesRead <= 0) break;
          pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
          bytesReadThisFile += bytesRead;
          nextReadOffset += bytesRead;

          const parsedChunk = parseGeminiEventsChunk({
            sourceKey,
            baseOffset: currentOffset,
            chunk: pending.toString("utf8"),
            fallbackNowIso: nowIso,
          });

          // 1 行が readSliceBytes (既定 64KB) を超える場合は次スライスと連結する。
          // 上限または EOF まで改行が来なければ次 tick に回し、同一 while 内で無限に
          // 待ち続けない (§159-003f / §160-005b と同型)。
          if (parsedChunk.consumedBytes === 0) {
            if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
            if (
              nextReadOffset >= fileSize ||
              (Number.isFinite(maxBytesPerFile) && bytesReadThisFile >= maxBytesPerFile)
            ) {
              break;
            }
            continue;
          }

          let nextOffset = currentOffset + parsedChunk.consumedBytes;
          let sliceDeferred = false;
          let entryIndex = 0;
          for (const entry of parsedChunk.events) {
            // §160-005b DoD (b)/(d) と同型: 1 件目は budget 超過済みでも必ず処理する。
            // さもないと offset が進まず同じ chunk を読み直し続ける。
            if (entryIndex > 0 && Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
              nextOffset = Math.max(currentOffset, entry.lineOffset);
              sliceDeferred = true;
              break;
            }
            entryIndex += 1;
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
            if (!result.ok) {
              nextOffset = Math.max(currentOffset, entry.lineOffset);
              sliceDeferred = true;
              break;
            }
            const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
            if (!deduped) {
              imported += 1;
            }
          }

          // §160-005b DoD (b) と同型: updateIngestOffset は recordEvent が完了した範囲
          // に対してのみ呼ぶ。先に楽観的に進めると未処理行が二度と読まれず消える。
          // さらに、消費 0 バイトのときは offset 行自体を作らない。作ると初回 tick で
          // hasOffset が true になり、backfill window 判定が恒久的に無効化される。
          if (nextOffset > currentOffset) {
            this.updateIngestOffset(sourceKey, nextOffset);
          }

          if (sliceDeferred) break;

          currentOffset = nextOffset;
          pending = pending.subarray(parsedChunk.consumedBytes);
          if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      // 読み込み失敗時は offset を進めず、次 tick で再試行する。
    }

    summary.eventsImported += imported;

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

    // 明示 API は完走させる (Spec.md の explicit ingest exemption)。
    // timer 経路は ingestGeminiHistoryTick が担当する。
    const summary = this.ingestGeminiEvents({ budgetMs: Infinity, maxBytesPerFile: Infinity });
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
    budgetMs?: number;
  }): { eventsImported: number; filesScanned: number; filesSkippedBackfill: number } {
    const summary = { eventsImported: 0, filesScanned: 0, filesSkippedBackfill: 0 };
    const startedAtMs = Date.now();
    const budgetMs = options?.budgetMs ?? resolveIngestTickBudgetMs();
    const projectsRoot = resolveHomePath(
      this.deps.config.claudeCodeProjectsRoot || DEFAULT_CLAUDE_CODE_PROJECTS_ROOT
    );
    if (!existsSync(projectsRoot)) return summary;

    const files = this.listClaudeCodeJsonlFiles(projectsRoot);
    const cutoffMs = Date.now() - Math.max(0, this.deps.config.claudeCodeBackfillHours || DEFAULT_CLAUDE_CODE_BACKFILL_HOURS) * 60 * 60 * 1000;
    const MAX_FILES_PER_POLL = options?.maxFiles ?? 50;
    const MAX_BYTES_PER_FILE = options?.maxBytesPerFile ?? resolveIngestMaxBytesPerFile();
    const READ_SLICE_BYTES = resolveIngestReadSliceBytes();
    const replayFromStart = options?.replayFromStart === true;
    let filesProcessed = 0;
    let slicesProcessed = 0;
    let stopTick = false;

    // §159-003f: 走査そのものを budget の対象にする (codex 経路と同型)。
    // 2026-07-28 実測で ~/.claude/projects は 1665 ファイルあり、全件の statSync +
    // `SELECT offset` を毎 tick 実行するだけで 2.5 秒級のブロックが出ていた。
    // 打ち切ると末尾が処理されないので、次 tick は続きから見る round-robin にする。
    // 明示 API (replayFromStart) は先頭から全件を対象にする。
    const scanCursorKey = "claude_code";
    const startIndex =
      !replayFromStart && files.length > 0
        ? (this.scanCursors.get(scanCursorKey) ?? 0) % files.length
        : 0;
    let filesVisited = 0;

    for (let step = 0; step < files.length; step += 1) {
      const filePath = files[(startIndex + step) % files.length] as string;
      // 進捗保証: 1 件目は budget 超過済みでも必ず見る。
      if (
        filesVisited > 0 &&
        Number.isFinite(budgetMs) &&
        Date.now() - startedAtMs > budgetMs
      ) {
        break;
      }
      filesVisited += 1;
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

      // §159-003b/e: 1665 ファイル / 1.5GB で最大 40 秒止まった同期処理を budget で
      // 切る。ただし offset が未更新のまま同じ先頭を再読しないよう、最初の 1 slice は通す。
      if (
        slicesProcessed > 0 &&
        Number.isFinite(budgetMs) &&
        Date.now() - startedAtMs > budgetMs
      ) {
        break;
      }

      let context: ClaudeCodeContext = replayFromStart
        ? { sessionId: "", project: "", lastUserPrompt: "", lastAssistantContent: "" }
        : this.loadClaudeCodeContext(sourceKey);
      const fallbackSessionId =
        this.inferClaudeCodeSessionId(filePath) || context.sessionId || undefined;
      const fallbackProject = this.inferClaudeCodeProject(filePath);
      let currentOffset = readOffset;
      let nextReadOffset = readOffset;
      let bytesReadThisFile = 0;
      let pending = Buffer.alloc(0);

      try {
        const fd = openSync(filePath, "r");
        try {
          while (
            nextReadOffset < fileSize &&
            (!Number.isFinite(MAX_BYTES_PER_FILE) || bytesReadThisFile < MAX_BYTES_PER_FILE)
          ) {
            const remainingFileBytes = fileSize - nextReadOffset;
            const remainingReadBytes = Number.isFinite(MAX_BYTES_PER_FILE)
              ? MAX_BYTES_PER_FILE - bytesReadThisFile
              : remainingFileBytes;
            const readSize = Math.min(
              remainingFileBytes,
              remainingReadBytes,
              Number.isFinite(READ_SLICE_BYTES) ? READ_SLICE_BYTES : remainingFileBytes
            );
            if (readSize <= 0) break;

            const buffer = Buffer.alloc(readSize);
            const bytesRead = readSync(fd, buffer, 0, readSize, nextReadOffset);
            if (bytesRead <= 0) break;
            pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
            bytesReadThisFile += bytesRead;
            nextReadOffset += bytesRead;
            slicesProcessed += 1;

            const parsedChunk = parseClaudeCodeChunk({
              sourceKey,
              baseOffset: currentOffset,
              chunk: pending.toString("utf8"),
              fallbackNowIso: nowIso,
              context,
              defaultSessionId: fallbackSessionId,
              defaultProject: fallbackProject,
            });

            // 64KB を超える 1 行は改行まで連結する。maxBytesPerFile または EOF に達した
            // 場合は offset を進めず次 tick に回し、同一 tick 内の無限ループを防ぐ。
            if (parsedChunk.consumedBytes === 0) {
              // §159-003f (review): 行が完結していない間も budget を見る。ここを抜けないと
              // 1 行が複数スライスにまたがる場合に maxBytesPerFile まで読み続けてしまう。
              if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) break;
              if (
                nextReadOffset >= fileSize ||
                (Number.isFinite(MAX_BYTES_PER_FILE) && bytesReadThisFile >= MAX_BYTES_PER_FILE)
              ) {
                break;
              }
              continue;
            }

            let imported = 0;
            let resumeOffset: number | null = null;
            let entryIndex = 0;
            for (const entry of parsedChunk.events) {
              if (
                entryIndex > 0 &&
                Number.isFinite(budgetMs) &&
                Date.now() - startedAtMs > budgetMs
              ) {
                resumeOffset = entry.lineOffset;
                break;
              }
              entryIndex += 1;
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
            if (resumeOffset !== null) {
              // chunk 全体の context を保存すると未挿入 event まで進むため、次 tick で再構成する。
              this.updateIngestOffset(sourceKey, Math.max(offset, resumeOffset));
              stopTick = true;
              break;
            }

            context = parsedChunk.context;
            this.storeClaudeCodeContext(sourceKey, {
              sessionId: context.sessionId || fallbackSessionId,
              project: context.project || fallbackProject,
              lastUserPrompt: context.lastUserPrompt,
              lastAssistantContent: context.lastAssistantContent,
            });

            const nextOffset = currentOffset + parsedChunk.consumedBytes;
            this.updateIngestOffset(sourceKey, Math.max(offset, nextOffset));
            currentOffset = nextOffset;
            pending = pending.subarray(parsedChunk.consumedBytes);
            if (Number.isFinite(budgetMs) && Date.now() - startedAtMs > budgetMs) {
              stopTick = true;
              break;
            }
          }
        } finally {
          closeSync(fd);
        }
      } catch {
        continue;
      }
      if (stopTick) break;
    }

    if (!replayFromStart && files.length > 0) {
      this.scanCursors.set(scanCursorKey, (startIndex + filesVisited) % files.length);
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
      // 明示 API は完走させる (§159-003b の tick budget は定期実行のみに効かせる)
      budgetMs: Infinity,
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

    const response = makeResponse(
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
    if (kind === "adr") {
      const firstAdr = observations[0]?.metadata as Record<string, unknown> | undefined;
      recordRecallTelemetry(
        "adr.ingest",
        {
          "harness.result": response.ok ? "ok" : "error",
          "adr.status": typeof firstAdr?.status === "string" ? firstAdr.status : "unknown",
          "adr.has_supersedes": false,
          "adr.entries_imported": imported,
          "adr.entries_skipped": skipped,
          "adr.parse_error_count": parseErrors.length,
        },
        {
          recall_latency_ms: typeof response.meta.latency_ms === "number"
            ? response.meta.latency_ms
            : Number((performance.now() - startedAt).toFixed(2)),
          adr_recall_count: imported,
        },
      );
    }
    return response;
  }
}
