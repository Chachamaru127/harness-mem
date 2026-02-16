import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { configureDatabase as configureDb, initFtsIndex as initFtsFromDb, initSchema as initDbSchema } from "../db/schema";
import { buildClaudeMemImportPlan, type ClaudeMemImportRequest } from "../ingest/claude-mem-import";
import { parseCodexHistoryChunk } from "../ingest/codex-history";
import { parseCodexSessionsChunk, type CodexSessionsContext } from "../ingest/codex-sessions";
import { parseCursorHooksChunk } from "../ingest/cursor-hooks";
import { parseOpencodeDbMessageRow, type OpencodeDbMessageRow } from "../ingest/opencode-db";
import { parseOpencodeMessageChunk } from "../ingest/opencode-storage";
import { parseAntigravityFile } from "../ingest/antigravity-files";
import {
  resolveVectorEngine,
  upsertSqliteVecRow,
  type VectorEngine,
} from "../vector/providers";

const DEFAULT_DB_PATH = "~/.harness-mem/harness-mem.db";
const DEFAULT_BIND_HOST = "127.0.0.1";
const DEFAULT_BIND_PORT = 37888;
const DEFAULT_VECTOR_DIM = 64;
const DEFAULT_CODEX_SESSIONS_ROOT = "~/.codex/sessions";
const DEFAULT_CODEX_INGEST_INTERVAL_MS = 5000;
const DEFAULT_CODEX_BACKFILL_HOURS = 24;
const DEFAULT_OPENCODE_STORAGE_ROOT = "~/.local/share/opencode/storage";
const DEFAULT_OPENCODE_DB_PATH = "~/.local/share/opencode/opencode.db";
const DEFAULT_OPENCODE_INGEST_INTERVAL_MS = 5000;
const DEFAULT_OPENCODE_BACKFILL_HOURS = 24;
const DEFAULT_CURSOR_EVENTS_PATH = "~/.harness-mem/adapters/cursor/events.jsonl";
const DEFAULT_CURSOR_INGEST_INTERVAL_MS = 5000;
const DEFAULT_CURSOR_BACKFILL_HOURS = 24;
const DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS = 5000;
const DEFAULT_ANTIGRAVITY_BACKFILL_HOURS = 24;
const HEARTBEAT_FILE = "~/.harness-mem/daemon.heartbeat";
const SQLITE_HEADER = "SQLite format 3\u0000";

type Platform = "claude" | "codex" | "opencode" | "cursor" | "antigravity";
type EventType = "session_start" | "user_prompt" | "tool_use" | "checkpoint" | "session_end";

export interface EventEnvelope {
  event_id?: string;
  platform: Platform | string;
  project: string;
  session_id: string;
  event_type: EventType | string;
  ts?: string;
  payload?: Record<string, unknown>;
  tags?: string[];
  privacy_tags?: string[];
  dedupe_hash?: string;
}

export interface SearchRequest {
  query: string;
  project?: string;
  session_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  include_private?: boolean;
}

export interface FeedRequest {
  cursor?: string;
  limit?: number;
  project?: string;
  type?: string;
  include_private?: boolean;
}

export interface ProjectsStatsRequest {
  include_private?: boolean;
}

export interface SessionsListRequest {
  project?: string;
  limit?: number;
  include_private?: boolean;
}

export interface SessionThreadRequest {
  session_id: string;
  project?: string;
  limit?: number;
  include_private?: boolean;
}

export interface SearchFacetsRequest {
  query?: string;
  project?: string;
  include_private?: boolean;
}

export interface ImportJobStatusRequest {
  job_id: string;
}

export interface VerifyImportRequest {
  job_id: string;
}

export interface StreamEvent {
  id: number;
  type: "observation.created" | "session.finalized" | "health.changed";
  ts: string;
  data: Record<string, unknown>;
}

export interface TimelineRequest {
  id: string;
  before?: number;
  after?: number;
  include_private?: boolean;
}

export interface ResumePackRequest {
  project: string;
  session_id?: string;
  limit?: number;
  include_private?: boolean;
}

export interface GetObservationsRequest {
  ids: string[];
  include_private?: boolean;
  compact?: boolean;
}

export interface RecordCheckpointRequest {
  platform?: Platform | string;
  project?: string;
  session_id: string;
  title: string;
  content: string;
  tags?: string[];
  privacy_tags?: string[];
}

export interface FinalizeSessionRequest {
  platform?: Platform | string;
  project?: string;
  session_id: string;
  summary_mode?: "standard" | "short" | "detailed";
}

export interface ApiMeta {
  count: number;
  latency_ms: number;
  filters: Record<string, unknown>;
  ranking: string;
  [key: string]: unknown;
}

export interface ApiResponse {
  ok: boolean;
  source: "core" | "merged";
  items: unknown[];
  meta: ApiMeta;
  error?: string;
}

interface SearchCandidate {
  id: string;
  lexical: number;
  vector: number;
  recency: number;
  final: number;
}

export interface Config {
  dbPath: string;
  bindHost: string;
  bindPort: number;
  vectorDimension: number;
  captureEnabled: boolean;
  retrievalEnabled: boolean;
  injectionEnabled: boolean;
  codexHistoryEnabled: boolean;
  codexProjectRoot: string;
  codexSessionsRoot: string;
  codexIngestIntervalMs: number;
  codexBackfillHours: number;
  opencodeIngestEnabled?: boolean;
  opencodeStorageRoot?: string;
  opencodeDbPath?: string;
  opencodeIngestIntervalMs?: number;
  opencodeBackfillHours?: number;
  cursorIngestEnabled?: boolean;
  cursorEventsPath?: string;
  cursorIngestIntervalMs?: number;
  cursorBackfillHours?: number;
  antigravityIngestEnabled?: boolean;
  antigravityWorkspaceRoots?: string[];
  antigravityIngestIntervalMs?: number;
  antigravityBackfillHours?: number;
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no");
}

function resolveHomePath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
    return resolve(join(homeDir, inputPath.slice(1)));
  }
  return resolve(inputPath);
}

function readFileHeader(filePath: string, bytes: number): string {
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

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") {
      continue;
    }
    const normalized = tag.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return [...deduped];
}

function isPrivateTag(tags: string[]): boolean {
  return tags.includes("private") || tags.includes("sensitive");
}

function isBlockedTag(tags: string[]): boolean {
  return tags.includes("block") || tags.includes("no_mem");
}

function shouldRedact(tags: string[]): boolean {
  return tags.includes("redact") || tags.includes("mask");
}

function redactContent(raw: string, tags: string[]): string {
  if (!shouldRedact(tags)) {
    return raw;
  }

  const rules: Array<[RegExp, string]> = [
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
    [/\b(sk|rk|pk)_[A-Za-z0-9]{16,}\b/g, "[REDACTED_KEY]"],
    [/\b(?:api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]"],
    [/\b[0-9a-f]{32,}\b/gi, "[REDACTED_HEX]"],
  ];

  let content = raw;
  for (const [pattern, replacement] of rules) {
    content = content.replace(pattern, replacement);
  }
  return content;
}

function buildDedupeHash(event: EventEnvelope): string {
  const basis = {
    platform: (event.platform || "unknown").toString().trim().toLowerCase(),
    project: (event.project || "unknown").toString().trim(),
    session_id: (event.session_id || "unknown").toString().trim(),
    event_type: (event.event_type || "unknown").toString().trim().toLowerCase(),
    ts: (event.ts || "").toString().trim(),
    payload: event.payload ?? {},
    tags: normalizeTags(event.tags),
    privacy_tags: normalizeTags(event.privacy_tags),
  };

  const hash = createHash("sha256");
  hash.update(JSON.stringify(basis));
  return hash.digest("hex");
}

function generateEventId(): string {
  const ts = Date.now().toString(36).padStart(10, "0");
  const random = crypto.getRandomValues(new Uint8Array(8));
  const rand = [...random].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${ts}${rand}`;
}

function clampLimit(input: unknown, fallback: number, min = 1, max = 200): number {
  if (typeof input !== "number" || Number.isNaN(input)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(input)));
}

function parseJsonSafe(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as unknown as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore JSON parse errors
    }
  }
  return {};
}

function toArraySafe(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseArrayJson(value: unknown): string[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return toArraySafe(parsed);
  } catch {
    return [];
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 4096);
}

function escapeLikePattern(input: string): string {
  return input.replace(/([\\%_])/g, "\\$1");
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function embedText(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % dim;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vector;
  }

  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = vector[i] / norm;
  }
  return vector;
}

function cosineSimilarity(lhs: number[], rhs: number[]): number {
  const dim = Math.min(lhs.length, rhs.length);
  if (dim === 0) {
    return 0;
  }

  let dot = 0;
  let lhsNorm = 0;
  let rhsNorm = 0;
  for (let i = 0; i < dim; i += 1) {
    dot += lhs[i] * rhs[i];
    lhsNorm += lhs[i] * lhs[i];
    rhsNorm += rhs[i] * rhs[i];
  }

  if (lhsNorm === 0 || rhsNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(lhsNorm) * Math.sqrt(rhsNorm));
}

function normalizeScoreMap(raw: Map<string, number>): Map<string, number> {
  if (raw.size === 0) {
    return new Map<string, number>();
  }

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const value of raw.values()) {
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  }

  if (maxValue === minValue) {
    const normalized = new Map<string, number>();
    for (const key of raw.keys()) {
      normalized.set(key, 1);
    }
    return normalized;
  }

  const normalized = new Map<string, number>();
  for (const [key, value] of raw.entries()) {
    normalized.set(key, (value - minValue) / (maxValue - minValue));
  }

  return normalized;
}

function makeResponse(
  startedAt: number,
  items: unknown[],
  filters: Record<string, unknown>,
  extras: Record<string, unknown> = {}
): ApiResponse {
  return {
    ok: true,
    source: "core",
    items,
    meta: {
      count: items.length,
      latency_ms: Math.round(performance.now() - startedAt),
      filters,
      ranking: "hybrid_v1",
      ...extras,
    },
  };
}

function makeErrorResponse(startedAt: number, message: string, filters: Record<string, unknown>): ApiResponse {
  return {
    ok: false,
    source: "core",
    items: [],
    meta: {
      count: 0,
      latency_ms: Math.round(performance.now() - startedAt),
      filters,
      ranking: "hybrid_v1",
    },
    error: message,
  };
}

interface FeedCursor {
  created_at: string;
  id: string;
}

function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeFeedCursor(raw: string | undefined): FeedCursor | null {
  if (!raw || !raw.trim()) {
    return null;
  }

  const candidates: string[] = [raw.trim()];
  if (!raw.includes("=")) {
    candidates.push(raw.trim().replace(/-/g, "+").replace(/_/g, "/"));
  }

  for (const candidate of candidates) {
    try {
      const json = Buffer.from(candidate, "base64url").toString("utf8");
      const parsed = JSON.parse(json) as Partial<FeedCursor>;
      if (
        typeof parsed.created_at === "string" &&
        parsed.created_at.trim() &&
        typeof parsed.id === "string" &&
        parsed.id.trim()
      ) {
        return { created_at: parsed.created_at, id: parsed.id };
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

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

function listCodexRolloutFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

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
      if (!entry.isFile()) {
        continue;
      }
      if (!/^rollout-.*\.jsonl$/i.test(entry.name)) {
        continue;
      }
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
}

function emptyAntigravityIngestSummary(): AntigravityIngestSummary {
  return {
    eventsImported: 0,
    filesScanned: 0,
    filesSkippedBackfill: 0,
    rootsScanned: 0,
    checkpointEventsImported: 0,
    toolEventsImported: 0,
  };
}

function mergeAntigravityIngestSummary(target: AntigravityIngestSummary, partial: AntigravityIngestSummary): void {
  target.eventsImported += partial.eventsImported;
  target.filesScanned += partial.filesScanned;
  target.filesSkippedBackfill += partial.filesSkippedBackfill;
  target.rootsScanned += partial.rootsScanned;
  target.checkpointEventsImported += partial.checkpointEventsImported;
  target.toolEventsImported += partial.toolEventsImported;
}

function listOpencodeMessageFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

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
      if (!entry.isFile()) {
        continue;
      }
      if (!/^msg_.*\.json$/i.test(entry.name)) {
        continue;
      }
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
    if (!current) {
      continue;
    }

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
      if (!entry.isFile()) {
        continue;
      }
      if (!/^ses_.*\.json$/i.test(entry.name)) {
        continue;
      }
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
    if (!current) {
      continue;
    }

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
      if (!entry.isFile()) {
        continue;
      }
      if (!/\.md$/i.test(entry.name)) {
        continue;
      }
      files.push(resolve(fullPath));
    }
  }

  files.sort((lhs, rhs) => lhs.localeCompare(rhs));
  return files;
}

export class HarnessMemCore {
  private readonly db: Database;
  private ftsEnabled = false;
  private vectorEngine: VectorEngine = "js-fallback";
  private vecTableReady = false;
  private readonly heartbeatPath: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ingestTimer: ReturnType<typeof setInterval> | null = null;
  private opencodeIngestTimer: ReturnType<typeof setInterval> | null = null;
  private cursorIngestTimer: ReturnType<typeof setInterval> | null = null;
  private antigravityIngestTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private streamEventCounter = 0;
  private streamEvents: StreamEvent[] = [];
  private readonly streamEventRetention = 600;
  private readonly codexRolloutContextCache = new Map<string, CodexSessionsContext>();

  constructor(private readonly config: Config) {
    const dbPath = resolveHomePath(config.dbPath);
    ensureDir(resolve(join(dbPath, "..")));

    this.heartbeatPath = resolveHomePath(HEARTBEAT_FILE);
    ensureDir(resolve(join(this.heartbeatPath, "..")));

    this.db = new Database(dbPath, { create: true, strict: false });

    this.configureDatabase();
    this.initSchema();
    this.initVectorEngine();

    this.startBackgroundWorkers();
  }

  private configureDatabase(): void {
    configureDb(this.db);
  }

  private initSchema(): void {
    initDbSchema(this.db);
    this.ftsEnabled = initFtsFromDb(this.db);
  }

  private initVectorEngine(): void {
    const resolved = resolveVectorEngine(this.db, this.config.retrievalEnabled, this.config.vectorDimension);
    this.vectorEngine = resolved.engine;
    this.vecTableReady = resolved.vecTableReady;
  }

  private isOpencodeIngestEnabled(): boolean {
    return this.config.opencodeIngestEnabled !== false;
  }

  private getOpencodeStorageRoot(): string {
    return resolveHomePath(this.config.opencodeStorageRoot || DEFAULT_OPENCODE_STORAGE_ROOT);
  }

  private getOpencodeDbPath(): string {
    const configured = this.config.opencodeDbPath;
    if (typeof configured === "string" && configured.trim()) {
      return resolveHomePath(configured);
    }
    return resolve(join(dirname(this.getOpencodeStorageRoot()), "opencode.db"));
  }

  private getOpencodeIngestIntervalMs(): number {
    return clampLimit(
      Number(this.config.opencodeIngestIntervalMs || DEFAULT_OPENCODE_INGEST_INTERVAL_MS),
      DEFAULT_OPENCODE_INGEST_INTERVAL_MS,
      1000,
      300000
    );
  }

  private getOpencodeBackfillHours(): number {
    return clampLimit(
      Number(this.config.opencodeBackfillHours || DEFAULT_OPENCODE_BACKFILL_HOURS),
      DEFAULT_OPENCODE_BACKFILL_HOURS,
      1,
      24 * 365
    );
  }

  private isCursorIngestEnabled(): boolean {
    return this.config.cursorIngestEnabled !== false;
  }

  private getCursorEventsPath(): string {
    return resolveHomePath(this.config.cursorEventsPath || DEFAULT_CURSOR_EVENTS_PATH);
  }

  private getCursorIngestIntervalMs(): number {
    return clampLimit(
      Number(this.config.cursorIngestIntervalMs || DEFAULT_CURSOR_INGEST_INTERVAL_MS),
      DEFAULT_CURSOR_INGEST_INTERVAL_MS,
      1000,
      300000
    );
  }

  private getCursorBackfillHours(): number {
    return clampLimit(
      Number(this.config.cursorBackfillHours || DEFAULT_CURSOR_BACKFILL_HOURS),
      DEFAULT_CURSOR_BACKFILL_HOURS,
      1,
      24 * 365
    );
  }

  private isAntigravityIngestEnabled(): boolean {
    return this.config.antigravityIngestEnabled !== false;
  }

  private getAntigravityWorkspaceRoots(): string[] {
    const roots = Array.isArray(this.config.antigravityWorkspaceRoots) ? this.config.antigravityWorkspaceRoots : [];
    return roots
      .map((root) => (typeof root === "string" ? root.trim() : ""))
      .filter((root) => root.length > 0)
      .map((root) => resolveHomePath(root));
  }

  private getAntigravityIngestIntervalMs(): number {
    return clampLimit(
      Number(this.config.antigravityIngestIntervalMs || DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS),
      DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS,
      1000,
      300000
    );
  }

  private getAntigravityBackfillHours(): number {
    return clampLimit(
      Number(this.config.antigravityBackfillHours || DEFAULT_ANTIGRAVITY_BACKFILL_HOURS),
      DEFAULT_ANTIGRAVITY_BACKFILL_HOURS,
      1,
      24 * 365
    );
  }

  private startBackgroundWorkers(): void {
    this.heartbeatTimer = setInterval(() => {
      this.writeHeartbeat();
    }, 5000);

    if (this.config.codexHistoryEnabled) {
      this.ingestTimer = setInterval(() => {
        this.ingestCodexHistory();
      }, this.config.codexIngestIntervalMs);
    }

    if (this.isOpencodeIngestEnabled()) {
      this.opencodeIngestTimer = setInterval(() => {
        this.ingestOpencodeHistory();
      }, this.getOpencodeIngestIntervalMs());
    }

    if (this.isCursorIngestEnabled()) {
      this.cursorIngestTimer = setInterval(() => {
        this.ingestCursorHistory();
      }, this.getCursorIngestIntervalMs());
    }

    if (this.isAntigravityIngestEnabled()) {
      this.antigravityIngestTimer = setInterval(() => {
        this.ingestAntigravityHistory();
      }, this.getAntigravityIngestIntervalMs());
    }

    this.retryTimer = setInterval(() => {
      this.processRetryQueue();
    }, 15000);

    this.checkpointTimer = setInterval(() => {
      this.db.exec("PRAGMA wal_checkpoint(PASSIVE);");
    }, 60000);

    this.writeHeartbeat();
  }

  private writeHeartbeat(): void {
    try {
      writeFileSync(this.heartbeatPath, JSON.stringify({ pid: process.pid, ts: nowIso() }));
    } catch {
      // best effort
    }
  }

  private appendStreamEvent(
    type: StreamEvent["type"],
    data: Record<string, unknown>
  ): StreamEvent {
    const event: StreamEvent = {
      id: ++this.streamEventCounter,
      type,
      ts: nowIso(),
      data,
    };
    this.streamEvents.push(event);
    if (this.streamEvents.length > this.streamEventRetention) {
      this.streamEvents.splice(0, this.streamEvents.length - this.streamEventRetention);
    }
    return event;
  }

  getStreamEventsSince(lastEventId: number, limitInput?: number): StreamEvent[] {
    const limit = clampLimit(limitInput, 100, 1, 500);
    if (this.streamEvents.length === 0) {
      return [];
    }
    return this.streamEvents
      .filter((event) => event.id > lastEventId)
      .slice(0, limit)
      .map((event) => ({ ...event, data: { ...event.data } }));
  }

  private buildObservationFromEvent(event: EventEnvelope, redactedContent: string): { title: string; content: string } {
    const payload = parseJsonSafe(event.payload);

    const titleRaw = payload.title;
    const promptRaw = payload.prompt;
    const contentRaw = payload.content;
    const commandRaw = payload.command;

    const title =
      (typeof titleRaw === "string" && titleRaw.trim()) ||
      (typeof promptRaw === "string" && promptRaw.trim().slice(0, 120)) ||
      (typeof commandRaw === "string" && commandRaw.trim().slice(0, 120)) ||
      `${event.event_type}`;

    const content =
      (typeof contentRaw === "string" && contentRaw.trim()) ||
      (typeof promptRaw === "string" && promptRaw.trim()) ||
      (typeof commandRaw === "string" && commandRaw.trim()) ||
      redactedContent ||
      JSON.stringify(payload).slice(0, 4000);

    return {
      title,
      content,
    };
  }

  private ensureSession(sessionId: string, platform: string, project: string, ts: string): void {
    const current = nowIso();
    this.db
      .query(`
        INSERT INTO mem_sessions(
          session_id, platform, project, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          started_at = CASE
            WHEN mem_sessions.started_at <= excluded.started_at THEN mem_sessions.started_at
            ELSE excluded.started_at
          END,
          updated_at = excluded.updated_at
      `)
      .run(sessionId, platform, project, ts, current, current);
  }

  private upsertSessionSummary(
    sessionId: string,
    platform: string,
    project: string,
    summary: string,
    endedAt: string,
    summaryMode: string
  ): void {
    this.ensureSession(sessionId, platform, project, endedAt);
    this.db
      .query(`
        UPDATE mem_sessions
        SET ended_at = ?, summary = ?, summary_mode = ?, updated_at = ?
        WHERE session_id = ?
      `)
      .run(endedAt, summary, summaryMode, nowIso(), sessionId);
  }

  private createImportJob(jobId: string, sourceDbPath: string, dryRun: boolean): void {
    const requestedAt = nowIso();
    this.db
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
    this.db
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

  private upsertVector(observationId: string, content: string, createdAt: string): void {
    if (this.vectorEngine === "disabled") {
      return;
    }

    const vector = embedText(content, this.config.vectorDimension);
    const vectorJson = JSON.stringify(vector);
    const updatedAt = nowIso();

    this.db
      .query(`
        INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(observation_id) DO UPDATE SET
          model = excluded.model,
          dimension = excluded.dimension,
          vector_json = excluded.vector_json,
          updated_at = excluded.updated_at
      `)
      .run(observationId, "local-hash-v1", this.config.vectorDimension, vectorJson, createdAt, updatedAt);

    if (this.vectorEngine === "sqlite-vec" && this.vecTableReady) {
      const ok = upsertSqliteVecRow(this.db, observationId, vectorJson, updatedAt);
      if (!ok) {
        this.vecTableReady = false;
      }
    }
  }

  private enqueueRetry(event: EventEnvelope, reason: string): void {
    const current = nowIso();
    this.db
      .query(`
        INSERT INTO mem_retry_queue(event_json, reason, retry_count, next_retry_at, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?, ?)
      `)
      .run(JSON.stringify(event), reason.slice(0, 500), current, current, current);
  }

  private processRetryQueue(force = false): void {
    if (this.shuttingDown && !force) {
      return;
    }

    const now = nowIso();
    const rows = this.db
      .query(
        `SELECT id, event_json, retry_count FROM mem_retry_queue WHERE next_retry_at <= ? ORDER BY id ASC LIMIT 100`
      )
      .all(now) as Array<{ id: number; event_json: string; retry_count: number }>;

    for (const row of rows) {
      let parsed: EventEnvelope;
      try {
        parsed = JSON.parse(row.event_json) as EventEnvelope;
      } catch {
        this.db.query(`DELETE FROM mem_retry_queue WHERE id = ?`).run(row.id);
        continue;
      }

      const result = this.recordEvent(parsed, { allowQueue: false });
      if (result.ok) {
        this.db.query(`DELETE FROM mem_retry_queue WHERE id = ?`).run(row.id);
        continue;
      }

      const retryCount = row.retry_count + 1;
      const waitSeconds = Math.min(300, 2 ** Math.min(retryCount, 8));
      const nextRetry = new Date(Date.now() + waitSeconds * 1000).toISOString();
      this.db
        .query(`
          UPDATE mem_retry_queue
          SET retry_count = ?, next_retry_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(retryCount, nextRetry, nowIso(), row.id);
    }
  }

  recordEvent(event: EventEnvelope, options: { allowQueue: boolean } = { allowQueue: true }): ApiResponse {
    const startedAt = performance.now();

    if (!this.config.captureEnabled) {
      return makeResponse(startedAt, [], {}, { capture_enabled: false });
    }

    if (!event.project || !event.session_id || !event.event_type || !event.platform) {
      return makeErrorResponse(startedAt, "event.project / event.session_id / event.event_type / event.platform are required", {});
    }

    const tags = normalizeTags(event.tags);
    const privacyTags = normalizeTags(event.privacy_tags);

    if (isBlockedTag(privacyTags)) {
      return makeResponse(startedAt, [], { blocked: true }, { skipped: true });
    }

    const timestamp = event.ts || nowIso();
    const payload = parseJsonSafe(event.payload);
    const payloadText = JSON.stringify(payload);
    const redactedPayload = redactContent(payloadText, privacyTags);

    const dedupeHash = (event.dedupe_hash || buildDedupeHash(event)).trim();
    const eventId = (event.event_id || generateEventId()).trim();

    const observationBase = this.buildObservationFromEvent(event, redactedPayload);
    const redactedContent = redactContent(observationBase.content, privacyTags);
    const observationId = `obs_${eventId}`;
    const current = nowIso();

    try {
      const transaction = this.db.transaction(() => {
        this.ensureSession(event.session_id, event.platform, event.project, timestamp);

        const eventInsert = this.db
          .query(`
            INSERT OR IGNORE INTO mem_events(
              event_id, platform, project, session_id, event_type, ts,
              payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            eventId,
            event.platform,
            event.project,
            event.session_id,
            event.event_type,
            timestamp,
            redactedPayload,
            JSON.stringify(tags),
            JSON.stringify(privacyTags),
            dedupeHash,
            observationId,
            current
          );

        const eventChanges = Number((eventInsert as { changes?: number }).changes ?? 0);
        if (eventChanges === 0) {
          return { duplicated: true };
        }

        this.db
          .query(`
            INSERT INTO mem_observations(
              id, event_id, platform, project, session_id,
              title, content, content_redacted,
              tags_json, privacy_tags_json,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              content = excluded.content,
              content_redacted = excluded.content_redacted,
              tags_json = excluded.tags_json,
              privacy_tags_json = excluded.privacy_tags_json,
              updated_at = excluded.updated_at
          `)
          .run(
            observationId,
            eventId,
            event.platform,
            event.project,
            event.session_id,
            observationBase.title,
            observationBase.content,
            redactedContent,
            JSON.stringify(tags),
            JSON.stringify(privacyTags),
            timestamp,
            current
          );

        for (const tag of tags) {
          this.db
            .query(`
              INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at)
              VALUES (?, ?, 'tag', ?)
            `)
            .run(observationId, tag, current);
        }

        for (const tag of privacyTags) {
          this.db
            .query(`
              INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at)
              VALUES (?, ?, 'privacy', ?)
            `)
            .run(observationId, tag, current);
        }

        this.upsertVector(observationId, redactedContent, timestamp);

        return { duplicated: false, observationId };
      });

      const result = transaction() as { duplicated: boolean; observationId?: string };
      if (result.duplicated) {
        return makeResponse(startedAt, [], { dedupe_hash: dedupeHash }, { deduped: true });
      }

      const item = {
        id: result.observationId,
        event_id: eventId,
        dedupe_hash: dedupeHash,
        platform: event.platform,
        project: event.project,
        session_id: event.session_id,
        event_type: event.event_type,
        card_type: event.event_type === "session_end" ? "session_summary" : event.event_type,
        ts: timestamp,
        created_at: timestamp,
        title: observationBase.title,
        content: redactedContent.slice(0, 1200),
        tags,
        privacy_tags: privacyTags,
      };

      this.appendStreamEvent("observation.created", item as unknown as Record<string, unknown>);

      return makeResponse(
        startedAt,
        [item],
        {
          project: event.project,
          session_id: event.session_id,
          event_type: event.event_type,
        },
        { vector_engine: this.vectorEngine }
      );
    } catch (error) {
      if (options.allowQueue) {
        this.enqueueRetry(event, error instanceof Error ? error.message : String(error));
      }
      return makeErrorResponse(startedAt, error instanceof Error ? error.message : String(error), {
        project: event.project,
        session_id: event.session_id,
      });
    }
  }

  private visibilityFilterSql(alias: string, includePrivate: boolean): string {
    if (includePrivate) {
      return "";
    }

    return ` AND ${alias}.privacy_tags_json NOT LIKE '%"private"%' AND ${alias}.privacy_tags_json NOT LIKE '%"sensitive"%' `;
  }

  private applyCommonFilters(
    sql: string,
    params: unknown[],
    alias: string,
    filters: {
      project?: string;
      session_id?: string;
      since?: string;
      until?: string;
      include_private?: boolean;
    }
  ): string {
    let nextSql = sql;

    if (filters.project) {
      nextSql += ` AND ${alias}.project = ?`;
      params.push(filters.project);
    }

    if (filters.session_id) {
      nextSql += ` AND ${alias}.session_id = ?`;
      params.push(filters.session_id);
    }

    if (filters.since) {
      nextSql += ` AND ${alias}.created_at >= ?`;
      params.push(filters.since);
    }

    if (filters.until) {
      nextSql += ` AND ${alias}.created_at <= ?`;
      params.push(filters.until);
    }

    nextSql += this.visibilityFilterSql(alias, Boolean(filters.include_private));
    return nextSql;
  }

  private buildFtsQuery(query: string): string {
    const tokens = tokenize(query);
    if (tokens.length === 0) {
      return '""';
    }
    const escaped = tokens
      .map((token) => token.replace(/"/g, ""))
      .filter((token) => /^[a-z0-9\u3040-\u30ff\u3400-\u9fff]+$/.test(token));
    if (escaped.length === 0) {
      return '""';
    }
    return escaped.map((token) => `"${token}"`).join(" OR ");
  }

  private lexicalSearch(request: SearchRequest, internalLimit: number): Map<string, number> {
    if (!this.ftsEnabled) {
      const tokens = tokenize(request.query);
      if (tokens.length === 0) {
        return new Map<string, number>();
      }

      const params: unknown[] = [];
      let sql = `
        SELECT
          o.id AS id,
          o.title AS title,
          o.content_redacted AS content
        FROM mem_observations o
        WHERE 1 = 1
      `;

      sql = this.applyCommonFilters(sql, params, "o", request);
      sql += " ORDER BY o.created_at DESC LIMIT ?";
      params.push(Math.max(internalLimit * 4, 200));

      const rows = this.db
        .query(sql)
        .all(...(params as any[])) as Array<{ id: string; title: string; content: string }>;

      const raw = new Map<string, number>();
      for (const row of rows) {
        const title = (row.title || "").toLowerCase();
        const content = (row.content || "").toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (title.includes(token)) {
            score += 2;
          }
          if (content.includes(token)) {
            score += 1;
          }
        }
        if (score > 0) {
          raw.set(row.id, score);
        }
      }

      return normalizeScoreMap(raw);
    }

    const params: unknown[] = [];
    let sql = `
      SELECT
        o.id AS id,
        bm25(mem_observations_fts) AS bm25
      FROM mem_observations_fts
      JOIN mem_observations o ON o.rowid = mem_observations_fts.rowid
      WHERE mem_observations_fts MATCH ?
    `;

    params.push(this.buildFtsQuery(request.query));
    sql = this.applyCommonFilters(sql, params, "o", request);
    sql += " ORDER BY bm25 ASC LIMIT ?";
    params.push(internalLimit);

    const rows = this.db.query(sql).all(...(params as any[])) as Array<{ id: string; bm25: number }>;
    const raw = new Map<string, number>();
    for (const row of rows) {
      raw.set(row.id, -Number(row.bm25));
    }

    return normalizeScoreMap(raw);
  }

  private vectorSearch(request: SearchRequest, internalLimit: number): Map<string, number> {
    if (this.vectorEngine === "disabled") {
      return new Map<string, number>();
    }

    const queryVector = embedText(request.query, this.config.vectorDimension);
    const queryVectorJson = JSON.stringify(queryVector);

    if (this.vectorEngine === "sqlite-vec" && this.vecTableReady) {
      try {
        const params: unknown[] = [queryVectorJson, internalLimit * 3];
        let sql = `
          SELECT
            c.id AS id,
            c.distance AS distance,
            o.created_at AS created_at
          FROM (
            SELECT
              m.observation_id AS id,
              v.distance AS distance
            FROM mem_vectors_vec v
            JOIN mem_vectors_vec_map m ON m.rowid = v.rowid
            WHERE v.embedding MATCH ? AND k = ?
          ) c
          JOIN mem_observations o ON o.id = c.id
          WHERE 1 = 1
        `;
        sql = this.applyCommonFilters(sql, params, "o", request);
        sql += " ORDER BY c.distance ASC LIMIT ?";
        params.push(internalLimit);

        const rows = this.db
          .query(sql)
          .all(...(params as any[])) as Array<{ id: string; distance: number; created_at: string }>;

        const raw = new Map<string, number>();
        for (const row of rows) {
          const distance = Number(row.distance);
          if (Number.isNaN(distance)) {
            continue;
          }
          raw.set(row.id, 1 / (1 + Math.max(0, distance)));
        }
        return normalizeScoreMap(raw);
      } catch {
        this.vecTableReady = false;
      }
    }

    const params: unknown[] = [];
    let sql = `
      SELECT
        v.observation_id AS id,
        v.vector_json AS vector_json,
        o.created_at AS created_at
      FROM mem_vectors v
      JOIN mem_observations o ON o.id = v.observation_id
      WHERE 1 = 1
    `;

    sql = this.applyCommonFilters(sql, params, "o", request);
    sql += " ORDER BY o.created_at DESC LIMIT ?";
    params.push(Math.min(2000, Math.max(800, internalLimit * 20)));

    const rows = this.db.query(sql).all(...(params as any[])) as Array<{ id: string; vector_json: string; created_at: string }>;
    const scored: Array<{ id: string; score: number }> = [];

    for (const row of rows) {
      let vector: number[];
      try {
        const parsed = JSON.parse(row.vector_json);
        if (!Array.isArray(parsed)) {
          continue;
        }
        vector = parsed.filter((value): value is number => typeof value === "number");
      } catch {
        continue;
      }

      const cosine = cosineSimilarity(queryVector, vector);
      const score = (cosine + 1) / 2;
      scored.push({ id: row.id, score });
    }

    scored.sort((lhs, rhs) => rhs.score - lhs.score);
    const sliced = scored.slice(0, internalLimit);

    const raw = new Map<string, number>();
    for (const entry of sliced) {
      raw.set(entry.id, entry.score);
    }

    return normalizeScoreMap(raw);
  }

  private recencyScore(createdAt: string): number {
    const created = Date.parse(createdAt);
    if (Number.isNaN(created)) {
      return 0;
    }

    const ageMs = Math.max(0, Date.now() - created);
    const ageHours = ageMs / (1000 * 60 * 60);
    const halfLifeHours = 24 * 7;
    return Math.exp(-ageHours / halfLifeHours);
  }

  private loadObservations(ids: string[]): Map<string, Record<string, unknown>> {
    if (ids.length === 0) {
      return new Map<string, Record<string, unknown>>();
    }

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .query(
        `
          SELECT
            id,
            event_id,
            platform,
            project,
            session_id,
            title,
            content_redacted,
            tags_json,
            privacy_tags_json,
            created_at,
            updated_at
          FROM mem_observations
          WHERE id IN (${placeholders})
        `
      )
      .all(...ids) as Array<Record<string, unknown>>;

    const mapped = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : "";
      if (id) {
        mapped.set(id, row);
      }
    }
    return mapped;
  }

  search(request: SearchRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.config.retrievalEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, { retrieval_enabled: false });
    }

    if (!request.query || !request.query.trim()) {
      return makeErrorResponse(startedAt, "query is required", request as unknown as Record<string, unknown>);
    }

    const limit = clampLimit(request.limit, 20, 1, 100);
    const internalLimit = Math.min(500, limit * 5);

    const lexical = this.lexicalSearch(request, internalLimit);
    const vector = this.vectorSearch(request, internalLimit);

    const candidateIds = new Set<string>([...lexical.keys(), ...vector.keys()]);
    const observations = this.loadObservations([...candidateIds]);

    const ranked: SearchCandidate[] = [];
    for (const id of candidateIds) {
      const observation = observations.get(id);
      if (!observation) {
        continue;
      }

      const createdAt = typeof observation.created_at === "string" ? observation.created_at : nowIso();
      const lexicalScore = lexical.get(id) ?? 0;
      const vectorScore = vector.get(id) ?? 0;
      const recency = this.recencyScore(createdAt);
      const final = 0.45 * lexicalScore + 0.4 * vectorScore + 0.15 * recency;

      ranked.push({
        id,
        lexical: lexicalScore,
        vector: vectorScore,
        recency,
        final,
      });
    }

    ranked.sort((lhs, rhs) => rhs.final - lhs.final);

    const items = ranked.slice(0, limit).map((entry) => {
      const observation = observations.get(entry.id) ?? {};
      const tags = parseArrayJson(observation.tags_json);
      const privacyTags = parseArrayJson(observation.privacy_tags_json);

      return {
        id: entry.id,
        event_id: observation.event_id,
        platform: observation.platform,
        project: observation.project,
        session_id: observation.session_id,
        title: observation.title,
        content: typeof observation.content_redacted === "string"
          ? observation.content_redacted.slice(0, 2000)
          : "",
        created_at: observation.created_at,
        tags,
        privacy_tags: privacyTags,
        scores: {
          lexical: Number(entry.lexical.toFixed(6)),
          vector: Number(entry.vector.toFixed(6)),
          recency: Number(entry.recency.toFixed(6)),
          final: Number(entry.final.toFixed(6)),
        },
      };
    });

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "hybrid_v1",
      vector_engine: this.vectorEngine,
      fts_enabled: this.ftsEnabled,
      lexical_candidates: lexical.size,
      vector_candidates: vector.size,
    });
  }

  feed(request: FeedRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.config.retrievalEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, { retrieval_enabled: false });
    }

    const limit = clampLimit(request.limit, 40, 1, 200);
    const includePrivate = Boolean(request.include_private);
    const cursor = decodeFeedCursor(request.cursor);
    const typeFilter = typeof request.type === "string" && request.type.trim() ? request.type.trim() : undefined;

    const params: unknown[] = [];
    let sql = `
      SELECT
        o.id,
        o.event_id,
        o.platform,
        o.project,
        o.session_id,
        o.title,
        o.content_redacted,
        o.tags_json,
        o.privacy_tags_json,
        o.created_at,
        e.event_type AS event_type
      FROM mem_observations o
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    if (request.project) {
      sql += " AND o.project = ?";
      params.push(request.project);
    }

    if (typeFilter) {
      sql += " AND COALESCE(e.event_type, '') = ?";
      params.push(typeFilter);
    }

    sql += this.visibilityFilterSql("o", includePrivate);

    if (cursor) {
      sql += " AND (o.created_at < ? OR (o.created_at = ? AND o.id < ?))";
      params.push(cursor.created_at, cursor.created_at, cursor.id);
    }

    sql += " ORDER BY o.created_at DESC, o.id DESC LIMIT ?";
    params.push(limit + 1);

    const rows = this.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items = pageRows.map((row) => {
      const eventTypeRaw = typeof row.event_type === "string" ? row.event_type : "";
      const eventType = eventTypeRaw || "unknown";
      const cardType = eventType === "session_end" ? "session_summary" : eventType;
      const content = typeof row.content_redacted === "string" ? row.content_redacted : "";
      const privacyTags = parseArrayJson(row.privacy_tags_json);

      return {
        id: row.id,
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        session_id: row.session_id,
        event_type: eventType,
        card_type: cardType,
        title: row.title || eventType,
        content: content.slice(0, 1200),
        created_at: row.created_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: privacyTags,
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      const createdAt = typeof last.created_at === "string" ? last.created_at : "";
      const id = typeof last.id === "string" ? last.id : "";
      if (createdAt && id) {
        nextCursor = encodeFeedCursor({ created_at: createdAt, id });
      }
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "feed_v1",
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  }

  sessionsList(request: SessionsListRequest): ApiResponse {
    const startedAt = performance.now();
    const limit = clampLimit(request.limit, 50, 1, 200);
    const includePrivate = Boolean(request.include_private);

    const params: unknown[] = [];
    let sql = `
      SELECT
        s.session_id,
        s.platform,
        s.project,
        s.started_at,
        s.ended_at,
        s.summary,
        s.summary_mode,
        s.updated_at,
        MAX(o.created_at) AS last_event_at,
        COUNT(o.id) AS observation_count,
        SUM(CASE WHEN e.event_type = 'user_prompt' THEN 1 ELSE 0 END) AS prompt_count,
        SUM(CASE WHEN e.event_type = 'tool_use' THEN 1 ELSE 0 END) AS tool_count,
        SUM(CASE WHEN e.event_type = 'checkpoint' THEN 1 ELSE 0 END) AS checkpoint_count,
        SUM(CASE WHEN e.event_type = 'session_end' THEN 1 ELSE 0 END) AS summary_count
      FROM mem_sessions s
      LEFT JOIN mem_observations o
        ON o.session_id = s.session_id
        ${this.visibilityFilterSql("o", includePrivate)}
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    if (request.project) {
      sql += " AND s.project = ?";
      params.push(request.project);
    }

    sql += `
      GROUP BY
        s.session_id, s.platform, s.project, s.started_at,
        s.ended_at, s.summary, s.summary_mode, s.updated_at
      ORDER BY COALESCE(MAX(o.created_at), s.updated_at) DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    const items = rows.map((row) => ({
      session_id: row.session_id,
      platform: row.platform,
      project: row.project,
      started_at: row.started_at,
      ended_at: row.ended_at,
      updated_at: row.updated_at,
      last_event_at: row.last_event_at,
      summary: row.summary,
      summary_mode: row.summary_mode,
      counts: {
        observations: Number(row.observation_count || 0),
        prompts: Number(row.prompt_count || 0),
        tools: Number(row.tool_count || 0),
        checkpoints: Number(row.checkpoint_count || 0),
        summaries: Number(row.summary_count || 0),
      },
    }));

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "sessions_list_v1",
    });
  }

  sessionThread(request: SessionThreadRequest): ApiResponse {
    const startedAt = performance.now();
    if (!request.session_id) {
      return makeErrorResponse(startedAt, "session_id is required", {});
    }

    const includePrivate = Boolean(request.include_private);
    const limit = clampLimit(request.limit, 200, 1, 1000);
    const params: unknown[] = [request.session_id];
    let sql = `
      SELECT
        o.id,
        o.event_id,
        o.platform,
        o.project,
        o.session_id,
        o.title,
        o.content_redacted,
        o.tags_json,
        o.privacy_tags_json,
        o.created_at,
        e.event_type
      FROM mem_observations o
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE o.session_id = ?
    `;

    if (request.project) {
      sql += " AND o.project = ?";
      params.push(request.project);
    }

    sql += this.visibilityFilterSql("o", includePrivate);
    sql += " ORDER BY o.created_at ASC, o.id ASC LIMIT ?";
    params.push(limit);

    const rows = this.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    const items = rows.map((row, index) => ({
      step: index + 1,
      id: row.id,
      event_id: row.event_id,
      event_type: row.event_type || "unknown",
      platform: row.platform,
      project: row.project,
      session_id: row.session_id,
      title: row.title,
      content: typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 2000) : "",
      created_at: row.created_at,
      tags: parseArrayJson(row.tags_json),
      privacy_tags: parseArrayJson(row.privacy_tags_json),
    }));

    return makeResponse(
      startedAt,
      items,
      {
        session_id: request.session_id,
        project: request.project,
        include_private: includePrivate,
      },
      { ranking: "session_thread_v1" }
    );
  }

  searchFacets(request: SearchFacetsRequest): ApiResponse {
    const startedAt = performance.now();
    const includePrivate = Boolean(request.include_private);
    const params: unknown[] = [];

    let sql = `
      SELECT
        o.project,
        o.created_at,
        o.tags_json,
        o.privacy_tags_json,
        e.event_type
      FROM mem_observations o
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    if (request.project) {
      sql += " AND o.project = ?";
      params.push(request.project);
    }

    sql += this.visibilityFilterSql("o", includePrivate);

    const query = (request.query || "").trim();
    if (query) {
      if (this.ftsEnabled) {
        sql += `
          AND o.rowid IN (
            SELECT rowid
            FROM mem_observations_fts
            WHERE mem_observations_fts MATCH ?
          )
        `;
        params.push(this.buildFtsQuery(query));
      } else {
        const escapedLike = escapeLikePattern(query);
        sql += " AND (o.title LIKE ? ESCAPE '\\' OR o.content_redacted LIKE ? ESCAPE '\\')";
        params.push(`%${escapedLike}%`, `%${escapedLike}%`);
      }
    }

    sql += " ORDER BY o.created_at DESC LIMIT 5000";

    const rows = this.db.query(sql).all(...(params as any[])) as Array<{
      project: string;
      created_at: string;
      tags_json: string;
      privacy_tags_json: string;
      event_type: string;
    }>;

    const projectCounts = new Map<string, number>();
    const eventTypeCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const timeBucketCounts = new Map<string, number>([
      ["24h", 0],
      ["7d", 0],
      ["30d", 0],
      ["older", 0],
    ]);

    const now = Date.now();
    for (const row of rows) {
      const project = row.project || "unknown";
      const eventType = row.event_type || "unknown";
      projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
      eventTypeCounts.set(eventType, (eventTypeCounts.get(eventType) || 0) + 1);

      const tags = parseArrayJson(row.tags_json);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }

      const createdMs = Date.parse(row.created_at || "");
      if (!Number.isNaN(createdMs)) {
        const ageHours = (now - createdMs) / (1000 * 60 * 60);
        if (ageHours <= 24) {
          timeBucketCounts.set("24h", (timeBucketCounts.get("24h") || 0) + 1);
        } else if (ageHours <= 24 * 7) {
          timeBucketCounts.set("7d", (timeBucketCounts.get("7d") || 0) + 1);
        } else if (ageHours <= 24 * 30) {
          timeBucketCounts.set("30d", (timeBucketCounts.get("30d") || 0) + 1);
        } else {
          timeBucketCounts.set("older", (timeBucketCounts.get("older") || 0) + 1);
        }
      }
    }

    const toFacetArray = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((lhs, rhs) => rhs.count - lhs.count || lhs.value.localeCompare(rhs.value));

    return makeResponse(
      startedAt,
      [
        {
          query: query || null,
          total_candidates: rows.length,
          projects: toFacetArray(projectCounts).slice(0, 30),
          event_types: toFacetArray(eventTypeCounts).slice(0, 20),
          tags: toFacetArray(tagCounts).slice(0, 50),
          time_buckets: toFacetArray(timeBucketCounts),
        },
      ],
      {
        query: query || undefined,
        project: request.project,
        include_private: includePrivate,
      },
      { ranking: "search_facets_v1" }
    );
  }

  timeline(request: TimelineRequest): ApiResponse {
    const startedAt = performance.now();

    const before = clampLimit(request.before, 5, 0, 50);
    const after = clampLimit(request.after, 5, 0, 50);

    const center = this.db
      .query(
        `
          SELECT id, project, session_id, created_at, title, content_redacted, tags_json, privacy_tags_json
          FROM mem_observations
          WHERE id = ?
        `
      )
      .get(request.id) as unknown as Record<string, unknown> | null;

    if (!center) {
      return makeErrorResponse(startedAt, `observation not found: ${request.id}`, {
        id: request.id,
      });
    }

    const centerProject = typeof center.project === "string" ? center.project : "";
    const centerSession = typeof center.session_id === "string" ? center.session_id : "";
    const centerCreatedAt = typeof center.created_at === "string" ? center.created_at : nowIso();

    const includePrivate = Boolean(request.include_private);
    const visibility = this.visibilityFilterSql("o", includePrivate);

    const beforeRows = this.db
      .query(
        `
          SELECT o.id, o.created_at, o.title, o.content_redacted, o.tags_json, o.privacy_tags_json
          FROM mem_observations o
          WHERE o.project = ? AND o.session_id = ? AND o.created_at < ?
          ${visibility}
          ORDER BY o.created_at DESC
          LIMIT ?
        `
      )
      .all(centerProject, centerSession, centerCreatedAt, before) as Array<Record<string, unknown>>;

    const afterRows = this.db
      .query(
        `
          SELECT o.id, o.created_at, o.title, o.content_redacted, o.tags_json, o.privacy_tags_json
          FROM mem_observations o
          WHERE o.project = ? AND o.session_id = ? AND o.created_at > ?
          ${visibility}
          ORDER BY o.created_at ASC
          LIMIT ?
        `
      )
      .all(centerProject, centerSession, centerCreatedAt, after) as Array<Record<string, unknown>>;

    const normalizeItem = (row: Record<string, unknown>, position: "before" | "center" | "after") => ({
      id: row.id,
      position,
      created_at: row.created_at,
      title: row.title,
      content: typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 1200) : "",
      tags: parseArrayJson(row.tags_json),
      privacy_tags: parseArrayJson(row.privacy_tags_json),
    });

    const items = [
      ...beforeRows.reverse().map((row) => normalizeItem(row, "before")),
      normalizeItem(center, "center"),
      ...afterRows.map((row) => normalizeItem(row, "after")),
    ];

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      center_id: request.id,
    });
  }

  getObservations(request: GetObservationsRequest): ApiResponse {
    const startedAt = performance.now();
    const ids = Array.isArray(request.ids) ? request.ids.filter((id): id is string => typeof id === "string") : [];

    if (ids.length === 0) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>);
    }

    const observationMap = this.loadObservations(ids);
    const includePrivate = Boolean(request.include_private);
    const compact = request.compact !== false;

    const items: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const row = observationMap.get(id);
      if (!row) {
        continue;
      }

      const privacyTags = parseArrayJson(row.privacy_tags_json);
      if (!includePrivate && isPrivateTag(privacyTags)) {
        continue;
      }

      const content = typeof row.content_redacted === "string" ? row.content_redacted : "";

      items.push({
        id,
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        session_id: row.session_id,
        title: row.title,
        content: compact ? content.slice(0, 800) : content,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: privacyTags,
      });
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      compact,
    });
  }

  recordCheckpoint(request: RecordCheckpointRequest): ApiResponse {
    const event: EventEnvelope = {
      platform: request.platform || "claude",
      project: request.project || basename(process.cwd()),
      session_id: request.session_id,
      event_type: "checkpoint",
      ts: nowIso(),
      payload: {
        title: request.title,
        content: request.content,
      },
      tags: request.tags || [],
      privacy_tags: request.privacy_tags || [],
    };

    return this.recordEvent(event);
  }

  finalizeSession(request: FinalizeSessionRequest): ApiResponse {
    const startedAt = performance.now();

    if (!request.session_id) {
      return makeErrorResponse(startedAt, "session_id is required", request as unknown as Record<string, unknown>);
    }

    const summaryMode = request.summary_mode || "standard";
    const rows = this.db
      .query(
        `
          SELECT title, content_redacted, created_at
          FROM mem_observations
          WHERE session_id = ?
          ORDER BY created_at DESC
          LIMIT 12
        `
      )
      .all(request.session_id) as Array<{ title: string; content_redacted: string; created_at: string }>;

    const lines: string[] = [];
    for (const row of rows.reverse()) {
      const title = row.title || "untitled";
      const snippet = (row.content_redacted || "").replace(/\s+/g, " ").trim().slice(0, 100);
      lines.push(`- ${title}: ${snippet}`);
    }

    const summary = lines.length > 0
      ? `Session ${request.session_id} summary (${summaryMode})\n${lines.join("\n")}`
      : `Session ${request.session_id} summary (${summaryMode})\n- no observations`;

    const current = nowIso();
    this.db
      .query(
        `
          UPDATE mem_sessions
          SET ended_at = ?, summary = ?, summary_mode = ?, updated_at = ?
          WHERE session_id = ?
        `
      )
      .run(current, summary, summaryMode, current, request.session_id);

    this.recordEvent({
      platform: request.platform || "claude",
      project: request.project || basename(process.cwd()),
      session_id: request.session_id,
      event_type: "session_end",
      ts: current,
      payload: {
        summary,
        summary_mode: summaryMode,
      },
      tags: ["finalized"],
      privacy_tags: [],
    });

    this.appendStreamEvent("session.finalized", {
      session_id: request.session_id,
      project: request.project || basename(process.cwd()),
      summary_mode: summaryMode,
      finalized_at: current,
    });

    return makeResponse(
      startedAt,
      [
        {
          session_id: request.session_id,
          summary_mode: summaryMode,
          summary,
          finalized_at: current,
        },
      ],
      request as unknown as Record<string, unknown>
    );
  }

  resumePack(request: ResumePackRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.config.injectionEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, { injection_enabled: false });
    }

    if (!request.project) {
      return makeErrorResponse(startedAt, "project is required", request as unknown as Record<string, unknown>);
    }

    const limit = clampLimit(request.limit, 5, 1, 20);
    const includePrivate = Boolean(request.include_private);
    const visibility = this.visibilityFilterSql("o", includePrivate);

    const latestSummary = this.db
      .query(
        `
          SELECT session_id, summary, ended_at
          FROM mem_sessions
          WHERE project = ? AND summary IS NOT NULL
          ORDER BY ended_at DESC
          LIMIT 1
        `
      )
      .get(request.project) as { session_id: string; summary: string; ended_at: string } | null;

    const rows = this.db
      .query(
        `
          SELECT
            o.id,
            o.event_id,
            o.platform,
            o.project,
            o.session_id,
            o.title,
            o.content_redacted,
            o.tags_json,
            o.privacy_tags_json,
            o.created_at
          FROM mem_observations o
          WHERE o.project = ?
          ${request.session_id ? "AND o.session_id <> ?" : ""}
          ${visibility}
          ORDER BY o.created_at DESC
          LIMIT ?
        `
      )
      .all(...(request.session_id ? [request.project, request.session_id, limit] : [request.project, limit])) as Array<Record<string, unknown>>;

    const items: Array<Record<string, unknown>> = [];

    if (latestSummary) {
      items.push({
        id: `session:${latestSummary.session_id}`,
        type: "session_summary",
        session_id: latestSummary.session_id,
        summary: latestSummary.summary,
        ended_at: latestSummary.ended_at,
      });
    }

    for (const row of rows) {
      items.push({
        id: row.id,
        type: "observation",
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        session_id: row.session_id,
        title: row.title,
        content: typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 800) : "",
        created_at: row.created_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: parseArrayJson(row.privacy_tags_json),
      });
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      include_summary: Boolean(latestSummary),
    });
  }

  health(): ApiResponse {
    const startedAt = performance.now();

    const sessions = this.db.query(`SELECT COUNT(*) AS count FROM mem_sessions`).get() as { count: number };
    const events = this.db.query(`SELECT COUNT(*) AS count FROM mem_events`).get() as { count: number };
    const observations = this.db.query(`SELECT COUNT(*) AS count FROM mem_observations`).get() as { count: number };
    const queue = this.db.query(`SELECT COUNT(*) AS count FROM mem_retry_queue`).get() as { count: number };

    const dbPath = resolveHomePath(this.config.dbPath);
    const dbSize = existsSync(dbPath) ? statSync(dbPath).size : 0;

    return makeResponse(
      startedAt,
      [
        {
          status: "ok",
          pid: process.pid,
          host: this.config.bindHost,
          port: this.config.bindPort,
          db_path: dbPath,
          db_size_bytes: dbSize,
          vector_engine: this.vectorEngine,
          fts_enabled: this.ftsEnabled,
          features: {
            capture: this.config.captureEnabled,
            retrieval: this.config.retrievalEnabled,
            injection: this.config.injectionEnabled,
            codex_history_ingest: this.config.codexHistoryEnabled,
            codex_sessions_root: resolveHomePath(this.config.codexSessionsRoot),
            codex_ingest_interval_ms: this.config.codexIngestIntervalMs,
            codex_backfill_hours: this.config.codexBackfillHours,
            opencode_history_ingest: this.isOpencodeIngestEnabled(),
            opencode_storage_root: this.getOpencodeStorageRoot(),
            opencode_db_path: this.getOpencodeDbPath(),
            opencode_ingest_interval_ms: this.getOpencodeIngestIntervalMs(),
            opencode_backfill_hours: this.getOpencodeBackfillHours(),
            cursor_history_ingest: this.isCursorIngestEnabled(),
            cursor_events_path: this.getCursorEventsPath(),
            cursor_ingest_interval_ms: this.getCursorIngestIntervalMs(),
            cursor_backfill_hours: this.getCursorBackfillHours(),
            antigravity_history_ingest: this.isAntigravityIngestEnabled(),
            antigravity_workspace_roots: this.getAntigravityWorkspaceRoots(),
            antigravity_ingest_interval_ms: this.getAntigravityIngestIntervalMs(),
            antigravity_backfill_hours: this.getAntigravityBackfillHours(),
          },
          counts: {
            sessions: Number(sessions.count || 0),
            events: Number(events.count || 0),
            observations: Number(observations.count || 0),
            retry_queue: Number(queue.count || 0),
          },
        },
      ],
      {},
      { ranking: "health_v1" }
    );
  }

  metrics(): ApiResponse {
    const startedAt = performance.now();

    const vectorCoverage = this.db
      .query(`
        SELECT
          (SELECT COUNT(*) FROM mem_vectors) AS mem_vectors_count,
          (SELECT COUNT(*) FROM mem_vectors_vec_map) AS vec_map_count,
          (SELECT COUNT(*) FROM mem_observations) AS observations_count
      `)
      .get() as { mem_vectors_count: number; vec_map_count: number; observations_count: number } | null;

    const queueStats = this.db
      .query(`
        SELECT
          COUNT(*) AS count,
          COALESCE(MAX(retry_count), 0) AS max_retry_count
        FROM mem_retry_queue
      `)
      .get() as { count: number; max_retry_count: number } | null;

    return makeResponse(
      startedAt,
      [
        {
          vector_engine: this.vectorEngine,
          vec_table_ready: this.vecTableReady,
          fts_enabled: this.ftsEnabled,
          coverage: {
            observations: Number(vectorCoverage?.observations_count ?? 0),
            mem_vectors: Number(vectorCoverage?.mem_vectors_count ?? 0),
            mem_vectors_vec_map: Number(vectorCoverage?.vec_map_count ?? 0),
          },
          retry_queue: {
            count: Number(queueStats?.count ?? 0),
            max_retry_count: Number(queueStats?.max_retry_count ?? 0),
          },
        },
      ],
      {},
      { ranking: "metrics_v1" }
    );
  }

  projectsStats(request: ProjectsStatsRequest = {}): ApiResponse {
    const startedAt = performance.now();
    const includePrivate = Boolean(request.include_private);
    const visibility = this.visibilityFilterSql("o", includePrivate);

    const rows = this.db
      .query(`
        SELECT
          o.project AS project,
          COUNT(*) AS observations,
          COUNT(DISTINCT o.session_id) AS sessions,
          MAX(o.created_at) AS updated_at
        FROM mem_observations o
        WHERE 1 = 1
        ${visibility}
        GROUP BY o.project
        ORDER BY updated_at DESC
      `)
      .all() as Array<{ project: string; observations: number; sessions: number; updated_at: string | null }>;

    const items = rows.map((row) => ({
      project: row.project,
      observations: Number(row.observations || 0),
      sessions: Number(row.sessions || 0),
      updated_at: row.updated_at || null,
    }));

    return makeResponse(startedAt, items, { include_private: includePrivate }, { ranking: "projects_stats_v1" });
  }

  startClaudeMemImport(request: ClaudeMemImportRequest): ApiResponse {
    const startedAt = performance.now();
    const sourceDbPath = resolveHomePath(request.source_db_path || "");
    const dryRun = Boolean(request.dry_run);
    const localDbPath = resolveHomePath(this.config.dbPath);
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
    const header = readFileHeader(sourceDbPath, SQLITE_HEADER.length);
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
          const response = this.recordEvent(
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
          this.upsertSessionSummary(
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

  getImportJobStatus(request: ImportJobStatusRequest): ApiResponse {
    const startedAt = performance.now();
    if (!request.job_id) {
      return makeErrorResponse(startedAt, "job_id is required", {});
    }

    const row = this.db
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

  verifyClaudeMemImport(request: VerifyImportRequest): ApiResponse {
    const startedAt = performance.now();
    if (!request.job_id) {
      return makeErrorResponse(startedAt, "job_id is required", {});
    }

    const job = this.db
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

    const importedCountRow = this.db
      .query(`
        SELECT COUNT(DISTINCT observation_id) AS count
        FROM mem_tags
        WHERE tag = ?
      `)
      .get(importTag) as { count?: number } | null;
    const importedCount = Number(importedCountRow?.count ?? 0);

    const privateCountRow = this.db
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

    const privateVisibleByDefaultRow = this.db
      .query(`
        SELECT COUNT(*) AS count
        FROM mem_observations o
        JOIN mem_tags t ON t.observation_id = o.id
        WHERE t.tag = ?
          AND (
            o.privacy_tags_json LIKE '%"private"%'
            OR o.privacy_tags_json LIKE '%"sensitive"%'
          )
          ${this.visibilityFilterSql("o", false)}
      `)
      .get(importTag) as { count?: number } | null;
    const privateVisibleByDefault = Number(privateVisibleByDefaultRow?.count ?? 0);

    let sampleFound = 0;
    if (sampleIds.length > 0) {
      const placeholders = sampleIds.map(() => "?").join(", ");
      const sampleFoundRow = this.db
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

  reindexVectors(limitInput?: number): ApiResponse {
    const startedAt = performance.now();
    if (this.vectorEngine === "disabled") {
      return makeResponse(startedAt, [], {}, { reindexed: 0, skipped: "vector_disabled" });
    }

    const limit = clampLimit(limitInput, 5000, 1, 1000000);
    const rows = this.db
      .query(`
        SELECT id, content_redacted, created_at
        FROM mem_observations
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(limit) as Array<{ id: string; content_redacted: string; created_at: string }>;

    let reindexed = 0;
    for (const row of rows) {
      this.upsertVector(row.id, row.content_redacted || "", row.created_at || nowIso());
      reindexed += 1;
    }

    return makeResponse(
      startedAt,
      [
        {
          reindexed,
          limit,
        },
      ],
      { limit },
      { vector_engine: this.vectorEngine }
    );
  }

  private loadCodexRolloutContext(sourceKey: string): CodexSessionsContext {
    const cached = this.codexRolloutContextCache.get(sourceKey);
    if (cached) {
      return { ...cached };
    }

    const metaKey = `codex_rollout_context:${sourceKey}`;
    const row = this.db
      .query(`SELECT value FROM mem_meta WHERE key = ?`)
      .get(metaKey) as { value?: string } | null;

    if (!row?.value) {
      return {};
    }

    const parsed = parseJsonSafe(row.value);
    const context: CodexSessionsContext = {
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id.trim() : undefined,
      project: typeof parsed.project === "string" ? parsed.project.trim() : undefined,
    };
    this.codexRolloutContextCache.set(sourceKey, context);
    return { ...context };
  }

  private storeCodexRolloutContext(sourceKey: string, context: CodexSessionsContext): void {
    const sessionId = typeof context.sessionId === "string" ? context.sessionId.trim() : "";
    const project = typeof context.project === "string" ? context.project.trim() : "";
    if (!sessionId && !project) {
      return;
    }

    const normalized: CodexSessionsContext = {
      sessionId: sessionId || undefined,
      project: project || undefined,
    };

    const metaKey = `codex_rollout_context:${sourceKey}`;
    this.db
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
        }),
        nowIso()
      );

    this.codexRolloutContextCache.set(sourceKey, normalized);
  }

  private updateIngestOffset(sourceKey: string, offset: number): void {
    this.db
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

  private ingestCodexSessionsRollouts(): CodexIngestSummary {
    const summary = emptyCodexIngestSummary();
    const sessionsRoot = resolveHomePath(this.config.codexSessionsRoot);
    if (!existsSync(sessionsRoot)) {
      return summary;
    }

    const files = listCodexRolloutFiles(sessionsRoot);
    const defaultProject = basename(resolve(this.config.codexProjectRoot));
    const cutoffMs = Date.now() - Math.max(0, this.config.codexBackfillHours) * 60 * 60 * 1000;

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

      const offsetRow = this.db
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
      for (const entry of parsedChunk.events) {
        const result = this.recordEvent(
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
        const deduped = Boolean((result.meta as Record<string, unknown>)?.deduped);
        if (result.ok && !deduped) {
          imported += 1;
        }
      }

      summary.eventsImported += imported;
      summary.sessionsEventsImported += imported;

      this.storeCodexRolloutContext(sourceKey, {
        sessionId: parsedChunk.context.sessionId || fallbackSessionId,
        project: parsedChunk.context.project || defaultProject,
      });

      const nextOffset = offset + parsedChunk.consumedBytes;
      this.updateIngestOffset(sourceKey, nextOffset);
    }

    return summary;
  }

  private ingestLegacyCodexHistoryFile(): CodexIngestSummary {
    const summary = emptyCodexIngestSummary();
    const historyPath = join(this.config.codexProjectRoot, ".codex", "history.jsonl");
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

    const sourceKey = `codex_history:${resolve(this.config.codexProjectRoot)}`;
    const offsetRow = this.db
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
    const project = basename(resolve(this.config.codexProjectRoot));

    let imported = 0;
    for (const entry of parsedChunk.events) {
      const result = this.recordEvent(
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

    if (!this.config.codexHistoryEnabled) {
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
      if (typeof parsed.type !== "string" || parsed.type !== "text") {
        continue;
      }
      if (typeof parsed.text !== "string") {
        continue;
      }
      const text = parsed.text.trim();
      if (!text) {
        continue;
      }
      texts.push(text);
    }

    return texts.join("\n\n").slice(0, 12000);
  }

  private ingestOpencodeDbMessages(): OpencodeIngestSummary {
    const summary = emptyOpencodeIngestSummary();
    const sourceDbPath = this.getOpencodeDbPath();
    if (!existsSync(sourceDbPath)) {
      return summary;
    }

    summary.filesScanned += 1;
    const sourceKey = `opencode_db_message:${resolve(sourceDbPath)}`;
    const cutoffMs = Date.now() - Math.max(0, this.getOpencodeBackfillHours()) * 60 * 60 * 1000;
    const offsetRow = this.db
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
        if (!parsed) {
          continue;
        }

        const result = this.recordEvent(
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
      if (!sessionId || !directory) {
        continue;
      }
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
      if (typeof parsed.type !== "string" || parsed.type !== "text") {
        continue;
      }
      if (typeof parsed.text !== "string") {
        continue;
      }
      const text = parsed.text.trim();
      if (!text) {
        continue;
      }
      texts.push(text);
    }

    return texts.join("\n\n").slice(0, 12000);
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

      const offsetRow = this.db
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
        const result = this.recordEvent(
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

    const offsetRow = this.db
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
      const result = this.recordEvent(
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

      const offsetRow = this.db
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

        const result = this.recordEvent(
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
        },
      ],
      {},
      {
        ingest_mode: "antigravity_files_v1",
        workspace_roots: roots,
      }
    );
  }

  shutdown(signal: string): void {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ingestTimer) {
      clearInterval(this.ingestTimer);
      this.ingestTimer = null;
    }
    if (this.opencodeIngestTimer) {
      clearInterval(this.opencodeIngestTimer);
      this.opencodeIngestTimer = null;
    }
    if (this.cursorIngestTimer) {
      clearInterval(this.cursorIngestTimer);
      this.cursorIngestTimer = null;
    }
    if (this.antigravityIngestTimer) {
      clearInterval(this.antigravityIngestTimer);
      this.antigravityIngestTimer = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }

    this.processRetryQueue(true);

    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // best effort
    }

    try {
      this.db.close(false);
    } catch {
      // ignore close errors
    }

    try {
      writeFileSync(this.heartbeatPath, JSON.stringify({ pid: process.pid, ts: nowIso(), state: `stopped:${signal}` }));
    } catch {
      // best effort
    }
  }
}

export function getConfig(): Config {
  const dbPath = process.env.HARNESS_MEM_DB_PATH || DEFAULT_DB_PATH;
  const rawBindHost = (process.env.HARNESS_MEM_HOST || DEFAULT_BIND_HOST).trim();
  const bindHost = rawBindHost === "127.0.0.1" || rawBindHost === "localhost"
    ? rawBindHost
    : DEFAULT_BIND_HOST;
  const bindPortRaw = process.env.HARNESS_MEM_PORT;
  const bindPort = bindPortRaw ? Number(bindPortRaw) : DEFAULT_BIND_PORT;
  const codexIngestIntervalRaw = Number(process.env.HARNESS_MEM_CODEX_INGEST_INTERVAL_MS || DEFAULT_CODEX_INGEST_INTERVAL_MS);
  const codexBackfillRaw = Number(process.env.HARNESS_MEM_CODEX_BACKFILL_HOURS || DEFAULT_CODEX_BACKFILL_HOURS);
  const opencodeIngestIntervalRaw = Number(
    process.env.HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS || DEFAULT_OPENCODE_INGEST_INTERVAL_MS
  );
  const opencodeBackfillRaw = Number(
    process.env.HARNESS_MEM_OPENCODE_BACKFILL_HOURS || DEFAULT_OPENCODE_BACKFILL_HOURS
  );
  const cursorIngestIntervalRaw = Number(
    process.env.HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS || DEFAULT_CURSOR_INGEST_INTERVAL_MS
  );
  const cursorBackfillRaw = Number(
    process.env.HARNESS_MEM_CURSOR_BACKFILL_HOURS || DEFAULT_CURSOR_BACKFILL_HOURS
  );
  const antigravityIngestIntervalRaw = Number(
    process.env.HARNESS_MEM_ANTIGRAVITY_INGEST_INTERVAL_MS || DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS
  );
  const antigravityBackfillRaw = Number(
    process.env.HARNESS_MEM_ANTIGRAVITY_BACKFILL_HOURS || DEFAULT_ANTIGRAVITY_BACKFILL_HOURS
  );
  const antigravityRootsRaw = process.env.HARNESS_MEM_ANTIGRAVITY_ROOTS || "";
  const antigravityWorkspaceRoots = antigravityRootsRaw
    .split(/[,\n]/)
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .map((root) => resolveHomePath(root));

  return {
    dbPath,
    bindHost,
    bindPort: Number.isFinite(bindPort) ? bindPort : DEFAULT_BIND_PORT,
    vectorDimension: clampLimit(Number(process.env.HARNESS_MEM_VECTOR_DIM || DEFAULT_VECTOR_DIM), DEFAULT_VECTOR_DIM, 32, 1024),
    captureEnabled: envFlag("HARNESS_MEM_ENABLE_CAPTURE", true),
    retrievalEnabled: envFlag("HARNESS_MEM_ENABLE_RETRIEVAL", true),
    injectionEnabled: envFlag("HARNESS_MEM_ENABLE_INJECTION", true),
    codexHistoryEnabled: envFlag("HARNESS_MEM_ENABLE_CODEX_INGEST", true),
    codexProjectRoot: resolve(process.env.HARNESS_MEM_CODEX_PROJECT_ROOT || process.cwd()),
    codexSessionsRoot: resolveHomePath(process.env.HARNESS_MEM_CODEX_SESSIONS_ROOT || DEFAULT_CODEX_SESSIONS_ROOT),
    codexIngestIntervalMs: clampLimit(codexIngestIntervalRaw, DEFAULT_CODEX_INGEST_INTERVAL_MS, 1000, 300000),
    codexBackfillHours: clampLimit(codexBackfillRaw, DEFAULT_CODEX_BACKFILL_HOURS, 1, 24 * 365),
    opencodeIngestEnabled: envFlag("HARNESS_MEM_ENABLE_OPENCODE_INGEST", true),
    opencodeDbPath: resolveHomePath(process.env.HARNESS_MEM_OPENCODE_DB_PATH || DEFAULT_OPENCODE_DB_PATH),
    opencodeStorageRoot: resolveHomePath(
      process.env.HARNESS_MEM_OPENCODE_STORAGE_ROOT || DEFAULT_OPENCODE_STORAGE_ROOT
    ),
    opencodeIngestIntervalMs: clampLimit(
      opencodeIngestIntervalRaw,
      DEFAULT_OPENCODE_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    opencodeBackfillHours: clampLimit(opencodeBackfillRaw, DEFAULT_OPENCODE_BACKFILL_HOURS, 1, 24 * 365),
    cursorIngestEnabled: envFlag("HARNESS_MEM_ENABLE_CURSOR_INGEST", true),
    cursorEventsPath: resolveHomePath(process.env.HARNESS_MEM_CURSOR_EVENTS_PATH || DEFAULT_CURSOR_EVENTS_PATH),
    cursorIngestIntervalMs: clampLimit(
      cursorIngestIntervalRaw,
      DEFAULT_CURSOR_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    cursorBackfillHours: clampLimit(cursorBackfillRaw, DEFAULT_CURSOR_BACKFILL_HOURS, 1, 24 * 365),
    antigravityIngestEnabled: envFlag("HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST", true),
    antigravityWorkspaceRoots,
    antigravityIngestIntervalMs: clampLimit(
      antigravityIngestIntervalRaw,
      DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    antigravityBackfillHours: clampLimit(
      antigravityBackfillRaw,
      DEFAULT_ANTIGRAVITY_BACKFILL_HOURS,
      1,
      24 * 365
    ),
  };
}
