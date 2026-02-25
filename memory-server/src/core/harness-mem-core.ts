import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  configureDatabase as configureDb,
  initFtsIndex as initFtsFromDb,
  initSchema as initDbSchema,
  migrateSchema as migrateDbSchema,
} from "../db/schema";
import type { StorageAdapter } from "../db/storage-adapter";
import { SqliteStorageAdapter } from "../db/sqlite-adapter";
import { createStorageAdapter } from "../db/adapter-factory";
import { buildClaudeMemImportPlan, type ClaudeMemImportRequest } from "../ingest/claude-mem-import";
import { parseCodexHistoryChunk } from "../ingest/codex-history";
import { parseCodexSessionsChunk, type CodexSessionsContext } from "../ingest/codex-sessions";
import { parseCursorHooksChunk } from "../ingest/cursor-hooks";
import { parseOpencodeDbMessageRow, type OpencodeDbMessageRow } from "../ingest/opencode-db";
import { parseOpencodeMessageChunk } from "../ingest/opencode-storage";
import { parseAntigravityFile } from "../ingest/antigravity-files";
import { parseAntigravityLogChunk } from "../ingest/antigravity-logs";
import { parseGeminiEventsChunk } from "../ingest/gemini-events";
import {
  resolveVectorEngine,
  upsertSqliteVecRow,
  type VectorEngine,
} from "../vector/providers";
import {
  createEmbeddingProviderRegistry,
} from "../embedding/registry";
import {
  type EmbeddingProvider,
  type EmbeddingHealth,
} from "../embedding/types";
import { createRerankerRegistry } from "../rerank/registry";
import {
  type Reranker,
  type RerankInputItem,
  type RerankOutputItem,
} from "../rerank/types";
import { buildTokenEstimateMeta, estimateTokenCount } from "../utils/token-estimate";
import {
  enqueueConsolidationJob,
  runConsolidationOnce,
  type ConsolidationRunOptions,
  type ConsolidationRunStats,
} from "../consolidation/worker";
import { routeQuery, type RouteDecision } from "../retrieval/router";
import { compileAnswer, type CompiledAnswer } from "../answer/compiler";
import { ManagedBackend, type ManagedBackendStatus } from "../projector/managed-backend";
import type { StoredEvent } from "../projector/types";
import { collectEnvironmentSnapshot, type EnvironmentSnapshot } from "../system-environment/collector";
import { TtlCache } from "../system-environment/cache";

const DEFAULT_DB_PATH = "~/.harness-mem/harness-mem.db";
const DEFAULT_BIND_HOST = "127.0.0.1";
const DEFAULT_BIND_PORT = 37888;
const DEFAULT_VECTOR_DIM = 256;
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
const DEFAULT_ANTIGRAVITY_LOGS_ROOT = "~/Library/Application Support/Antigravity/logs";
const DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT = "~/Library/Application Support/Antigravity/User/workspaceStorage";
const DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS = 5000;
const DEFAULT_ANTIGRAVITY_BACKFILL_HOURS = 24;
const DEFAULT_GEMINI_EVENTS_PATH = "~/.harness-mem/adapters/gemini/events.jsonl";
const DEFAULT_GEMINI_INGEST_INTERVAL_MS = 5000;
const DEFAULT_GEMINI_BACKFILL_HOURS = 24;
const DEFAULT_SEARCH_RANKING = "hybrid_v3";
const DEFAULT_SEARCH_EXPAND_LINKS = true;
const VECTOR_MODEL_VERSION = "local-hash-v3";
const HEARTBEAT_FILE = "~/.harness-mem/daemon.heartbeat";
const SQLITE_HEADER = "SQLite format 3\u0000";
const DEFAULT_ENVIRONMENT_CACHE_TTL_MS = 20_000;

type Platform = "claude" | "codex" | "opencode" | "cursor" | "antigravity" | "gemini";
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
  correlation_id?: string;
}

export interface SearchRequest {
  query: string;
  project?: string;
  session_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  include_private?: boolean;
  expand_links?: boolean;
  strict_project?: boolean;
  debug?: boolean;
  /** Explicit question kind for retrieval routing: profile|timeline|graph|vector|hybrid */
  question_kind?: "profile" | "timeline" | "graph" | "vector" | "hybrid";
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

export interface ConsolidationRunRequest {
  reason?: string;
  project?: string;
  session_id?: string;
  limit?: number;
}

export interface AuditLogRequest {
  limit?: number;
  action?: string;
  target_type?: string;
}

export interface BackupRequest {
  dest_dir?: string;
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
  correlation_id?: string;
  limit?: number;
  include_private?: boolean;
  resume_pack_max_tokens?: number;
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
  sla_latency_ms: number;
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
  tag_boost: number;
  importance: number;
  graph: number;
  final: number;
  rerank: number;
  created_at: string;
}

export interface Config {
  dbPath: string;
  bindHost: string;
  bindPort: number;
  vectorDimension: number;
  embeddingProvider?: string;
  openaiApiKey?: string;
  openaiEmbedModel?: string;
  ollamaBaseUrl?: string;
  ollamaEmbedModel?: string;
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
  antigravityLogsRoot?: string;
  antigravityWorkspaceStorageRoot?: string;
  antigravityIngestIntervalMs?: number;
  antigravityBackfillHours?: number;
  geminiIngestEnabled?: boolean;
  geminiEventsPath?: string;
  geminiIngestIntervalMs?: number;
  geminiBackfillHours?: number;
  searchRanking?: string;
  searchExpandLinks?: boolean;
  rerankerEnabled?: boolean;
  consolidationEnabled?: boolean;
  consolidationIntervalMs?: number;
  backendMode?: "local" | "managed" | "hybrid";
  managedEndpoint?: string;
  managedApiKey?: string;
  resumePackMaxTokens?: number;
}

const EVENT_TYPE_IMPORTANCE: Record<string, number> = {
  checkpoint: 0.9,
  session_end: 0.8,
  tool_use: 0.5,
  user_prompt: 0.4,
  session_start: 0.2,
};

const SYNONYM_MAP: Record<string, string[]> = {
  typescript: ["ts"],
  javascript: ["js"],
  ts: ["typescript"],
  js: ["javascript"],
  react: ["jsx", "tsx"],
  test: ["spec", "jest", "vitest"],
  spec: ["test"],
  error: ["bug", "exception", "failure"],
  bug: ["error", "issue", "defect"],
  fix: ["patch", "repair", "resolve"],
  api: ["endpoint", "route"],
  endpoint: ["api", "route"],
  database: ["db", "sqlite"],
  db: ["database", "sqlite"],
  config: ["configuration", "settings"],
  deploy: ["deployment", "release"],
  auth: ["authentication", "login"],
  env: ["environment"],
  dep: ["dependency"],
  deps: ["dependencies"],
  dependency: ["dep", "package"],
  dependencies: ["deps", "packages"],
  refactor: ["restructure", "reorganize"],
  migrate: ["migration"],
  migration: ["migrate"],
};

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

interface ProjectNormalizationOptions {
  preferredRoots?: string[];
}

function normalizePathLike(inputPath: string): string {
  return inputPath.replace(/\/+$/, "").replace(/\\/g, "/");
}

function isAbsoluteProjectPath(project: string): boolean {
  const normalized = normalizePathLike(project.trim());
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function projectBasenameKey(project: string): string {
  const normalized = normalizePathLike(project.trim());
  return (basename(normalized) || normalized).toLowerCase();
}

function realpathOrNormalized(inputPath: string): string {
  try {
    const { realpathSync } = require("node:fs") as typeof import("node:fs");
    return normalizePathLike(realpathSync(inputPath));
  } catch {
    return normalizePathLike(inputPath);
  }
}

function resolvePreferredWorkspaceRoot(existingPath: string, preferredRoots: string[] = []): string | null {
  const normalizedPath = normalizePathLike(existingPath);
  for (const root of preferredRoots) {
    if (typeof root !== "string" || !root.trim()) {
      continue;
    }
    const normalizedRoot = normalizePathLike(root.trim());
    if (!normalizedRoot) {
      continue;
    }
    if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return normalizedRoot;
    }
  }
  return null;
}

function resolveGitWorkspaceRoot(existingPath: string): string | null {
  let cursor = normalizePathLike(existingPath);
  if (!cursor.startsWith("/")) {
    return null;
  }

  while (true) {
    const gitMarker = join(cursor, ".git");
    if (existsSync(gitMarker)) {
      try {
        const markerStat = statSync(gitMarker);
        if (markerStat.isDirectory()) {
          return realpathOrNormalized(cursor);
        }
        if (markerStat.isFile()) {
          const markerBody = readFileSync(gitMarker, "utf8");
          const match = markerBody.match(/^\s*gitdir:\s*(.+)\s*$/i);
          if (!match) {
            return realpathOrNormalized(cursor);
          }
          const gitDirPath = normalizePathLike(resolve(cursor, match[1].trim()));
          const worktreeToken = "/.git/worktrees/";
          const worktreeIndex = gitDirPath.indexOf(worktreeToken);
          if (worktreeIndex > 0) {
            return realpathOrNormalized(gitDirPath.slice(0, worktreeIndex));
          }
          return realpathOrNormalized(cursor);
        }
      } catch {
        return realpathOrNormalized(cursor);
      }
      return realpathOrNormalized(cursor);
    }

    const parent = normalizePathLike(dirname(cursor));
    if (!parent || parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return null;
}

function resolveWorkspaceRoot(existingPath: string, options: ProjectNormalizationOptions = {}): string | null {
  const gitRoot = resolveGitWorkspaceRoot(existingPath);
  if (gitRoot) {
    return normalizePathLike(gitRoot);
  }
  const preferredRoot = resolvePreferredWorkspaceRoot(existingPath, options.preferredRoots || []);
  if (preferredRoot) {
    return normalizePathLike(preferredRoot);
  }
  return null;
}

function shouldExposeProjectInStats(project: string): boolean {
  const normalized = normalizePathLike(project.trim());
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (lower === "unknown") {
    return false;
  }

  const withoutLeadingSlash = lower.startsWith("/") ? lower.slice(1) : lower;
  if (withoutLeadingSlash.startsWith("shadow-")) {
    return false;
  }

  if (normalized.startsWith("/")) {
    const segments = normalized.split("/").filter(Boolean);
    for (const segment of segments) {
      if (segment.startsWith(".")) {
        return false;
      }
    }
  }

  return true;
}

function normalizeProjectName(name: string, options: ProjectNormalizationOptions = {}): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("project name must not be empty");
  // trailing slashを除去、normalize path
  const normalized = normalizePathLike(trimmed);
  // パスとして存在する場合はsymlink解決してbasename相当の正規パスを返す
  try {
    const { realpathSync } = require("node:fs") as typeof import("node:fs");
    const real = normalizePathLike(realpathSync(normalized));
    const workspaceRoot = resolveWorkspaceRoot(real, options);
    return workspaceRoot || real;
  } catch {
    // basenameのみの入力は、既知のworkspace root basenameと一致する場合に
    // そのworkspace root(絶対パス)へ寄せる。
    if (!normalized.includes("/")) {
      const roots = Array.isArray(options.preferredRoots) ? options.preferredRoots : [];
      const target = normalized.toLowerCase();
      for (const root of roots) {
        if (typeof root !== "string" || !root.trim()) {
          continue;
        }
        const rootNormalized = normalizePathLike(root.trim());
        const rootBase = basename(rootNormalized).toLowerCase();
        if (rootBase === target) {
          try {
            const { realpathSync } = require("node:fs") as typeof import("node:fs");
            const real = normalizePathLike(realpathSync(rootNormalized));
            const workspaceRoot = resolveWorkspaceRoot(real, options);
            return workspaceRoot || real;
          } catch {
            return rootNormalized;
          }
        }
      }
    }
    // ディレクトリが存在しない場合はnormalized文字列をそのまま返す
    return normalized;
  }
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

// hashToken + embedText moved to memory-server/src/vector/providers.ts

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

interface ExtractedEntity {
  name: string;
  type: string;
}

interface VectorSearchResult {
  scores: Map<string, number>;
  coverage: number;
  migrationWarning?: string;
}

interface RankingWeights {
  lexical: number;
  vector: number;
  recency: number;
  tag_boost: number;
  importance: number;
  graph: number;
}

const FILE_EXT_RE = /(?:^|\s|["'`(])([\w./\\-]+\.(?:ts|js|py|rs|go|tsx|jsx|vue|sql|css|scss|html|json|yaml|yml|toml|md|sh))\b/g;
const PACKAGE_RE = /(?:npm|yarn|pnpm|pip|cargo|bun)\s+(?:install|add|i|remove)\s+([\w@/.+\-]+)/g;
const FUNC_RE = /(?:function|def|fn|func|const|let|var)\s+([A-Za-z_]\w{2,})/g;
const URL_RE = /https?:\/\/[^\s"'`<>)\]]+/g;

function extractEntities(content: string): ExtractedEntity[] {
  const seen = new Set<string>();
  const entities: ExtractedEntity[] = [];

  function add(name: string, type: string): void {
    const key = `${type}:${name}`;
    if (!seen.has(key) && entities.length < 50) {
      seen.add(key);
      entities.push({ name: name.slice(0, 255), type });
    }
  }

  for (const match of content.matchAll(FILE_EXT_RE)) {
    if (match[1]) add(match[1], "file");
  }
  for (const match of content.matchAll(PACKAGE_RE)) {
    if (match[1]) add(match[1], "package");
  }
  for (const match of content.matchAll(FUNC_RE)) {
    if (match[1]) add(match[1], "symbol");
  }
  for (const match of content.matchAll(URL_RE)) {
    if (match[0]) add(match[0].replace(/[.,;:!?]+$/, "").slice(0, 255), "url");
  }

  return entities;
}

function hasPrivateVisibilityTag(tags: string[]): boolean {
  return tags.some((tag) => {
    const normalized = tag.toLowerCase();
    return normalized === "private" || normalized === "sensitive";
  });
}

function normalizeWeights(weights: RankingWeights): RankingWeights {
  const total = weights.lexical + weights.vector + weights.recency + weights.tag_boost + weights.importance + weights.graph;
  if (total <= 0) {
    return { lexical: 0, vector: 0, recency: 0, tag_boost: 0, importance: 0, graph: 0 };
  }
  return {
    lexical: weights.lexical / total,
    vector: weights.vector / total,
    recency: weights.recency / total,
    tag_boost: weights.tag_boost / total,
    importance: weights.importance / total,
    graph: weights.graph / total,
  };
}

function normalizeVectorDimension(vector: number[], dimension: number): number[] {
  const normalized = vector.filter((value): value is number => typeof value === "number");
  if (normalized.length === dimension) {
    return normalized;
  }
  if (normalized.length > dimension) {
    return normalized.slice(0, dimension);
  }
  return [...normalized, ...new Array<number>(dimension - normalized.length).fill(0)];
}

function makeResponse(
  startedAt: number,
  items: unknown[],
  filters: Record<string, unknown>,
  extras: Record<string, unknown> = {}
): ApiResponse {
  const latencyMs = Math.round(performance.now() - startedAt);
  return {
    ok: true,
    source: "core",
    items,
    meta: {
      count: items.length,
      latency_ms: latencyMs,
      sla_latency_ms: latencyMs,
      filters,
      ranking: "hybrid_v1",
      ...extras,
    },
  };
}

function makeErrorResponse(startedAt: number, message: string, filters: Record<string, unknown>): ApiResponse {
  const latencyMs = Math.round(performance.now() - startedAt);
  return {
    ok: false,
    source: "core",
    items: [],
    meta: {
      count: 0,
      latency_ms: latencyMs,
      sla_latency_ms: latencyMs,
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

function listAntigravityPlannerLogFiles(logsRoot: string): string[] {
  const files: string[] = [];
  const stack: string[] = [logsRoot];

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
      if (entry.name !== "Antigravity.log") {
        continue;
      }
      if (!fullPath.replace(/\\/g, "/").includes("/google.antigravity/")) {
        continue;
      }
      files.push(resolve(fullPath));
    }
  }

  files.sort((lhs, rhs) => lhs.localeCompare(rhs));
  return files;
}

function fileUriToPath(uriOrPath: string): string {
  const raw = uriOrPath.trim();
  if (!raw) {
    return "";
  }

  if (/^file:\/\//i.test(raw)) {
    let value = raw.replace(/^file:\/\//i, "");
    if (value.startsWith("localhost/")) {
      value = value.slice("localhost".length);
    }
    if (!value.startsWith("/")) {
      value = `/${value}`;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return raw;
}

function resolveWorkspaceRootFromWorkspaceFile(workspacePath: string): string {
  try {
    const raw = readFileSync(workspacePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    for (const folder of folders) {
      if (typeof folder !== "object" || folder === null || Array.isArray(folder)) {
        continue;
      }
      const pathValue = (folder as Record<string, unknown>).path;
      if (typeof pathValue !== "string" || !pathValue.trim()) {
        continue;
      }
      const normalized = pathValue.trim();
      if (normalized.startsWith("/")) {
        return resolve(normalized);
      }
      return resolve(join(dirname(workspacePath), normalized));
    }
  } catch {
    // best effort fallback below
  }

  return dirname(workspacePath);
}

function resolveWorkspaceRootFromWorkspaceJson(workspaceJsonPath: string): string {
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(workspaceJsonPath, "utf8");
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return "";
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return "";
  }

  const folder = typeof parsed.folder === "string" ? parsed.folder : "";
  if (folder) {
    const folderPath = fileUriToPath(folder);
    return folderPath ? resolve(folderPath) : "";
  }

  const workspace = typeof parsed.workspace === "string" ? parsed.workspace : "";
  if (!workspace) {
    return "";
  }
  const workspacePath = fileUriToPath(workspace);
  if (!workspacePath) {
    return "";
  }
  if (workspacePath.endsWith(".code-workspace")) {
    return resolveWorkspaceRootFromWorkspaceFile(workspacePath);
  }
  return resolve(workspacePath);
}

export class HarnessMemCore {
  private readonly storage: StorageAdapter;
  private readonly db: Database;
  /** True when backend mode is "managed" and ManagedBackend MUST be connected for durable writes. */
  private readonly managedRequired: boolean;
  private ftsEnabled = false;
  private vectorEngine: VectorEngine = "js-fallback";
  private vecTableReady = false;
  private embeddingProvider!: EmbeddingProvider;
  private embeddingHealth: EmbeddingHealth = { status: "healthy", details: "not-initialized" };
  private embeddingWarnings: string[] = [];
  private vectorModelVersion = VECTOR_MODEL_VERSION;
  private reranker: Reranker | null = null;
  private rerankerEnabled = false;
  private managedBackend: ManagedBackend | null = null;
  private readonly heartbeatPath: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ingestTimer: ReturnType<typeof setInterval> | null = null;
  private opencodeIngestTimer: ReturnType<typeof setInterval> | null = null;
  private cursorIngestTimer: ReturnType<typeof setInterval> | null = null;
  private antigravityIngestTimer: ReturnType<typeof setInterval> | null = null;
  private geminiIngestTimer: ReturnType<typeof setInterval> | null = null;
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  /** Application-level write serialization queue */
  private writeQueue: Promise<void> = Promise.resolve();
  private writeQueuePending = 0;
  private readonly writeQueueLimit = 100;
  private streamEventCounter = 0;
  private streamEvents: StreamEvent[] = [];
  private readonly streamEventRetention = 600;
  private readonly codexRolloutContextCache = new Map<string, CodexSessionsContext>();
  private readonly projectNormalizationRoots: string[];
  private readonly environmentSnapshotCache = new TtlCache<EnvironmentSnapshot>(DEFAULT_ENVIRONMENT_CACHE_TTL_MS);

  constructor(private readonly config: Config) {
    const dbPath = resolveHomePath(config.dbPath);
    ensureDir(resolve(join(dbPath, "..")));

    this.heartbeatPath = resolveHomePath(HEARTBEAT_FILE);
    ensureDir(resolve(join(this.heartbeatPath, "..")));
    this.projectNormalizationRoots = this.buildProjectNormalizationRoots();

    // Create storage adapter based on backend mode.
    const { adapter, managedRequired } = createStorageAdapter({
      backendMode: config.backendMode || "local",
      dbPath,
      managedEndpoint: config.managedEndpoint,
      managedApiKey: config.managedApiKey,
    });
    this.storage = adapter;
    this.managedRequired = managedRequired;

    // Expose raw SQLite Database for backward compat and SQLite-specific features
    // (FTS5, sqlite-vec, PRAGMA).  Will be removed once all methods migrate to storage.
    this.db = (this.storage as SqliteStorageAdapter).raw;

    this.configureDatabase();
    this.initSchema();
    this.initVectorEngine();
    this.initEmbeddingProvider();
    this.initReranker();

    this.startBackgroundWorkers();
    this.initManagedBackend();
  }

  private configureDatabase(): void {
    configureDb(this.db);
  }

  private initSchema(): void {
    initDbSchema(this.db);
    migrateDbSchema(this.db);
    this.ftsEnabled = initFtsFromDb(this.db);
    this.migrateLegacyProjectAliases();
  }

  private buildProjectNormalizationRoots(): string[] {
    const candidates = [this.config.codexProjectRoot, process.cwd()];
    const roots: string[] = [];
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) {
        continue;
      }
      const resolved = resolveHomePath(candidate);
      try {
        roots.push(normalizeProjectName(resolve(resolved)));
      } catch {
        // ignore invalid candidate
      }
    }
    return [...new Set(roots)];
  }

  private normalizeProjectInput(project: string): string {
    return normalizeProjectName(project, {
      preferredRoots: this.projectNormalizationRoots,
    });
  }

  private extendProjectNormalizationRoots(candidates: string[]): void {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return;
    }

    const merged = new Set(this.projectNormalizationRoots);
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) {
        continue;
      }
      let normalized = normalizePathLike(resolveHomePath(candidate.trim()));
      try {
        normalized = normalizeProjectName(normalized, {
          preferredRoots: [...merged],
        });
      } catch {
        // keep normalized fallback
      }
      if (!isAbsoluteProjectPath(normalized)) {
        continue;
      }
      merged.add(normalized);
    }

    if (merged.size === this.projectNormalizationRoots.length) {
      return;
    }
    this.projectNormalizationRoots.splice(0, this.projectNormalizationRoots.length, ...merged);
  }

  private migrateLegacyProjectAliases(): void {
    const projectTables = [
      "mem_sessions",
      "mem_events",
      "mem_observations",
      "mem_facts",
      "mem_consolidation_queue",
    ] as const;

    const distinctProjects = this.db
      .query(`
        SELECT DISTINCT project
        FROM (
          SELECT project FROM mem_sessions
          UNION
          SELECT project FROM mem_events
          UNION
          SELECT project FROM mem_observations
          UNION
          SELECT project FROM mem_facts
          UNION
          SELECT project FROM mem_consolidation_queue
        )
        WHERE project IS NOT NULL AND TRIM(project) <> ''
      `)
      .all() as Array<{ project: string }>;

    const projectWeightsRows = this.db
      .query(`
        SELECT project, COUNT(*) AS weight
        FROM mem_observations
        GROUP BY project
      `)
      .all() as Array<{ project: string; weight: number }>;
    const projectWeights = new Map<string, number>();
    for (const row of projectWeightsRows) {
      const key = typeof row.project === "string" ? row.project.trim() : "";
      if (!key) {
        continue;
      }
      projectWeights.set(key, Number(row.weight || 0));
    }

    const aliasMap = new Map<string, string>();
    const absoluteProjectsByBasename = new Map<string, Set<string>>();
    const variantsByLower = new Map<string, Set<string>>();
    const observedAbsoluteProjects = new Set<string>();

    const registerAbsoluteCandidate = (project: string): void => {
      if (!isAbsoluteProjectPath(project)) {
        return;
      }
      observedAbsoluteProjects.add(project);
      const baseKey = projectBasenameKey(project);
      if (!absoluteProjectsByBasename.has(baseKey)) {
        absoluteProjectsByBasename.set(baseKey, new Set());
      }
      absoluteProjectsByBasename.get(baseKey)!.add(project);
    };

    for (const row of distinctProjects) {
      const original = typeof row.project === "string" ? row.project.trim() : "";
      if (!original) {
        continue;
      }
      const lowerKey = normalizePathLike(original).toLowerCase();
      if (!variantsByLower.has(lowerKey)) {
        variantsByLower.set(lowerKey, new Set());
      }
      variantsByLower.get(lowerKey)!.add(original);
      try {
        const normalized = this.normalizeProjectInput(original);
        registerAbsoluteCandidate(normalized);
        if (normalized && normalized !== original) {
          aliasMap.set(original, normalized);
        }
      } catch {
        // ignore invalid project keys
      }
      registerAbsoluteCandidate(original);
    }

    this.extendProjectNormalizationRoots([...observedAbsoluteProjects]);

    for (const row of distinctProjects) {
      const original = typeof row.project === "string" ? row.project.trim() : "";
      if (!original || isAbsoluteProjectPath(original)) {
        continue;
      }
      const normalized = normalizePathLike(original);
      if (normalized.includes("/")) {
        continue;
      }
      const candidates = absoluteProjectsByBasename.get(normalized.toLowerCase());
      if (!candidates || candidates.size !== 1) {
        continue;
      }
      const [target] = [...candidates];
      if (target && target !== original) {
        aliasMap.set(original, target);
      }
    }

    const chooseCanonicalVariant = (variants: string[]): string => {
      return [...variants].sort((lhs, rhs) => {
        const lhsWeight = projectWeights.get(lhs) || 0;
        const rhsWeight = projectWeights.get(rhs) || 0;
        if (rhsWeight !== lhsWeight) {
          return rhsWeight - lhsWeight;
        }
        const lhsAbs = isAbsoluteProjectPath(lhs) ? 1 : 0;
        const rhsAbs = isAbsoluteProjectPath(rhs) ? 1 : 0;
        if (rhsAbs !== lhsAbs) {
          return rhsAbs - lhsAbs;
        }
        return lhs.localeCompare(rhs);
      })[0] || variants[0] || "";
    };

    for (const variantsSet of variantsByLower.values()) {
      const variants = [...variantsSet];
      if (variants.length <= 1) {
        continue;
      }
      const canonical = chooseCanonicalVariant(variants);
      for (const variant of variants) {
        if (variant !== canonical) {
          aliasMap.set(variant, canonical);
        }
      }
    }

    if (aliasMap.size === 0) {
      return;
    }

    const resolvedAliasMap = new Map<string, string>();
    for (const [source] of aliasMap) {
      let target = aliasMap.get(source) || source;
      const seen = new Set<string>([source]);
      while (aliasMap.has(target) && !seen.has(target)) {
        seen.add(target);
        target = aliasMap.get(target) || target;
      }
      if (target !== source) {
        resolvedAliasMap.set(source, target);
      }
    }

    if (resolvedAliasMap.size === 0) {
      return;
    }

    let changed = 0;
    try {
      const apply = this.db.transaction(() => {
        for (const [fromProject, toProject] of resolvedAliasMap) {
          for (const table of projectTables) {
            const result = this.db.query(`UPDATE ${table} SET project = ? WHERE project = ?`).run(toProject, fromProject);
            changed += Number((result as { changes?: number }).changes || 0);
          }
        }

        const metaRows = this.db
          .query(`SELECT key, value FROM mem_meta WHERE key LIKE 'codex_rollout_context:%'`)
          .all() as Array<{ key: string; value: string }>;
        for (const row of metaRows) {
          if (typeof row.value !== "string" || !row.value.trim()) {
            continue;
          }
          let parsed: Record<string, unknown>;
          try {
            const value = JSON.parse(row.value) as unknown;
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
              continue;
            }
            parsed = value as Record<string, unknown>;
          } catch {
            continue;
          }
          const currentProject = typeof parsed.project === "string" ? parsed.project.trim() : "";
          const mappedProject = currentProject ? resolvedAliasMap.get(currentProject) : undefined;
          if (!mappedProject || mappedProject === currentProject) {
            continue;
          }
          parsed.project = mappedProject;
          this.db
            .query(`UPDATE mem_meta SET value = ?, updated_at = ? WHERE key = ?`)
            .run(JSON.stringify(parsed), nowIso(), row.key);
          changed += 1;
        }
      });
      apply();
    } catch {
      return;
    }

    if (changed > 0) {
      console.log(`[harness-mem] normalized legacy project aliases (aliases=${resolvedAliasMap.size}, rows=${changed})`);
    }
  }

  private initVectorEngine(): void {
    const resolved = resolveVectorEngine(this.db, this.config.retrievalEnabled, this.config.vectorDimension);
    this.vectorEngine = resolved.engine;
    this.vecTableReady = resolved.vecTableReady;
  }

  private initEmbeddingProvider(): void {
    const registry = createEmbeddingProviderRegistry({
      providerName: this.config.embeddingProvider,
      dimension: this.config.vectorDimension,
      openaiApiKey: this.config.openaiApiKey,
      openaiEmbedModel: this.config.openaiEmbedModel,
      ollamaBaseUrl: this.config.ollamaBaseUrl,
      ollamaEmbedModel: this.config.ollamaEmbedModel,
    });
    this.embeddingProvider = registry.provider;
    this.embeddingWarnings = [...registry.warnings];
    this.vectorModelVersion = `${registry.provider.name}:${registry.provider.model}`;
    this.embeddingHealth = registry.provider.health();
  }

  private refreshEmbeddingHealth(): void {
    try {
      this.embeddingHealth = this.embeddingProvider.health();
    } catch {
      this.embeddingHealth = {
        status: "degraded",
        details: "embedding provider health call failed",
      };
    }
  }

  private initReranker(): void {
    const rerankerSetting =
      typeof this.config.rerankerEnabled === "boolean"
        ? this.config.rerankerEnabled
        : envFlag("HARNESS_MEM_RERANKER_ENABLED", false);
    const registry = createRerankerRegistry(rerankerSetting);
    this.rerankerEnabled = registry.enabled;
    this.reranker = registry.reranker;
    if (registry.warnings.length > 0) {
      this.embeddingWarnings.push(...registry.warnings);
    }
  }

  private initManagedBackend(): void {
    const mode = this.config.backendMode;
    if (mode !== "hybrid" && mode !== "managed") {
      return;
    }
    if (!this.config.managedEndpoint) {
      if (mode === "managed") {
        // managed mode MUST have an endpoint — fail loudly
        throw new Error(
          "backend_mode=managed requires managedEndpoint. " +
          "Set HARNESS_MEM_MANAGED_ENDPOINT or configure managed.endpoint in config.json"
        );
      }
      this.embeddingWarnings.push(
        `backend_mode=${mode} but managedEndpoint not configured. ` +
        "Managed backend will not be initialized."
      );
      return;
    }

    this.managedBackend = new ManagedBackend({
      endpoint: this.config.managedEndpoint,
      apiKey: this.config.managedApiKey || "",
      backendMode: mode,
    });

    // Fire-and-forget initialization
    this.managedBackend.initialize().catch((err) => {
      this.embeddingWarnings.push(
        `managed backend init failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  /** Get managed backend status (null if not in managed/hybrid mode). */
  getManagedStatus(): ManagedBackendStatus | null {
    return this.managedBackend?.getStatus() ?? null;
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

  private getAntigravityLogsRoot(): string {
    return resolveHomePath(this.config.antigravityLogsRoot || DEFAULT_ANTIGRAVITY_LOGS_ROOT);
  }

  private getAntigravityWorkspaceStorageRoot(): string {
    return resolveHomePath(
      this.config.antigravityWorkspaceStorageRoot || DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT
    );
  }

  private getConfiguredAntigravityWorkspaceRoots(): string[] {
    const roots = Array.isArray(this.config.antigravityWorkspaceRoots) ? this.config.antigravityWorkspaceRoots : [];
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
      if (!entry.isDirectory()) {
        continue;
      }
      const workspaceJsonPath = join(storageRoot, entry.name, "workspace.json");
      if (!existsSync(workspaceJsonPath)) {
        continue;
      }
      const resolvedRoot = resolveWorkspaceRootFromWorkspaceJson(workspaceJsonPath);
      if (!resolvedRoot || !existsSync(resolvedRoot)) {
        continue;
      }
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

    const fallbackRoot = resolve(this.config.codexProjectRoot || process.cwd());
    if (fallbackRoot && existsSync(fallbackRoot)) {
      return [fallbackRoot];
    }

    return [];
  }

  private resolveAntigravityWorkspaceStorageIdFromLogFile(logFilePath: string): string {
    const exthostDir = dirname(dirname(logFilePath));
    const exthostLog = join(exthostDir, "exthost.log");
    if (!existsSync(exthostLog)) {
      return "";
    }

    let text = "";
    try {
      text = readFileSync(exthostLog, "utf8");
    } catch {
      return "";
    }
    if (!text) {
      return "";
    }

    const matches = [...text.matchAll(/workspaceStorage\/([0-9a-z]{8,})/gi)];
    if (matches.length === 0) {
      return "";
    }
    const latest = matches[matches.length - 1];
    return (latest?.[1] || "").trim();
  }

  private resolveAntigravityWorkspaceRootByStorageId(storageId: string): string {
    const normalized = (storageId || "").trim();
    if (!normalized) {
      return "";
    }
    const workspaceJsonPath = join(this.getAntigravityWorkspaceStorageRoot(), normalized, "workspace.json");
    if (!existsSync(workspaceJsonPath)) {
      return "";
    }
    const resolvedRoot = resolveWorkspaceRootFromWorkspaceJson(workspaceJsonPath);
    if (!resolvedRoot || !existsSync(resolvedRoot)) {
      return "";
    }
    return resolve(resolvedRoot);
  }

  private resolveAntigravityLogProject(logFilePath: string): { project: string; workspaceRoot: string; sessionSeed: string } {
    const storageId = this.resolveAntigravityWorkspaceStorageIdFromLogFile(logFilePath);
    const workspaceRoot = this.resolveAntigravityWorkspaceRootByStorageId(storageId);
    const fallbackProject = normalizeProjectName(resolve(this.config.codexProjectRoot || process.cwd()));
    const project = workspaceRoot ? normalizeProjectName(resolve(workspaceRoot)) : fallbackProject;

    const sessionDir = basename(dirname(dirname(dirname(dirname(logFilePath)))));
    const sessionSeed = [project || "unknown", storageId || sessionDir || "planner"].filter(Boolean).join(":");
    return { project, workspaceRoot, sessionSeed };
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

  private isGeminiIngestEnabled(): boolean {
    return this.config.geminiIngestEnabled !== false;
  }

  private getGeminiEventsPath(): string {
    return resolveHomePath(this.config.geminiEventsPath || DEFAULT_GEMINI_EVENTS_PATH);
  }

  private getGeminiIngestIntervalMs(): number {
    return clampLimit(
      Number(this.config.geminiIngestIntervalMs || DEFAULT_GEMINI_INGEST_INTERVAL_MS),
      DEFAULT_GEMINI_INGEST_INTERVAL_MS,
      1000,
      300000
    );
  }

  private getGeminiBackfillHours(): number {
    return clampLimit(
      Number(this.config.geminiBackfillHours || DEFAULT_GEMINI_BACKFILL_HOURS),
      DEFAULT_GEMINI_BACKFILL_HOURS,
      1,
      24 * 365
    );
  }

  private isConsolidationEnabled(): boolean {
    return this.config.consolidationEnabled !== false;
  }

  private getConsolidationIntervalMs(): number {
    return clampLimit(Number(this.config.consolidationIntervalMs || 60000), 60000, 5000, 600000);
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

    if (this.isGeminiIngestEnabled()) {
      this.geminiIngestTimer = setInterval(() => {
        this.ingestGeminiHistory();
      }, this.getGeminiIngestIntervalMs());
    }

    if (this.isConsolidationEnabled()) {
      let consolidationRunning = false;
      this.consolidationTimer = setInterval(() => {
        if (consolidationRunning) return;
        consolidationRunning = true;
        void this.runConsolidation({ reason: "scheduler", limit: 10 }).finally(() => {
          consolidationRunning = false;
        });
      }, this.getConsolidationIntervalMs());
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

  private autoLinkObservation(observationId: string, sessionId: string, createdAt: string): void {
    try {
      const previous = this.db
        .query(`
          SELECT id
          FROM mem_observations
          WHERE session_id = ? AND id <> ? AND created_at <= ?
          ORDER BY created_at DESC
          LIMIT 1
        `)
        .get(sessionId, observationId, createdAt) as { id: string } | null;

      if (previous?.id) {
        this.db
          .query(`
            INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
            VALUES (?, ?, 'follows', 1.0, ?)
          `)
          .run(observationId, previous.id, createdAt);
      }
    } catch {
      // best effort
    }

    try {
      const sharedRows = this.db
        .query(`
          SELECT DISTINCT oe2.observation_id AS id
          FROM mem_observation_entities oe1
          JOIN mem_observation_entities oe2 ON oe1.entity_id = oe2.entity_id
          WHERE oe1.observation_id = ? AND oe2.observation_id <> ?
          ORDER BY oe2.observation_id ASC
          LIMIT 20
        `)
        .all(observationId, observationId) as Array<{ id: string }>;

      for (const row of sharedRows) {
        this.db
          .query(`
            INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
            VALUES (?, ?, 'shared_entity', 0.7, ?)
          `)
          .run(observationId, row.id, createdAt);
      }
    } catch {
      // best effort
    }
  }

  private extractAndStoreEntities(observationId: string, content: string, createdAt: string): void {
    const entities = extractEntities(content);
    for (const entity of entities) {
      try {
        this.db
          .query(`INSERT OR IGNORE INTO mem_entities(name, entity_type, created_at) VALUES (?, ?, ?)`)
          .run(entity.name, entity.type, createdAt);

        const stored = this.db
          .query(`SELECT id FROM mem_entities WHERE name = ? AND entity_type = ?`)
          .get(entity.name, entity.type) as { id: number } | null;
        if (stored?.id) {
          this.db
            .query(`
              INSERT OR IGNORE INTO mem_observation_entities(observation_id, entity_id, created_at)
              VALUES (?, ?, ?)
            `)
            .run(observationId, stored.id, createdAt);
        }
      } catch {
        // best effort
      }
    }
  }

  private classifyObservation(eventType: string, title: string, content: string): string {
    if (eventType === "session_end") return "summary";
    if (eventType === "session_start") return "context";
    if (eventType === "tool_use") return "action";

    const text = `${title} ${content}`.toLowerCase();

    if (/(decided|chose|picked|switched to|方針|決定|採用|選択)/.test(text)) return "decision";
    if (/(pattern|usually|consistently|repeatedly|傾向|パターン|毎回|常に)/.test(text)) return "pattern";
    if (/(prefer|dislike|avoid|rather|preference|好み|希望|避けたい)/.test(text)) return "preference";
    if (/(learned|lesson|realized|gotcha|mistake|学び|反省|気づき|教訓)/.test(text)) return "lesson";
    if (/(next step|todo|next action|次対応|次の対応|アクション)/.test(text)) return "action";
    return "context";
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

  private ensureSession(sessionId: string, platform: string, project: string, ts: string, correlationId?: string | null): void {
    const current = nowIso();
    this.db
      .query(`
        INSERT INTO mem_sessions(
          session_id, platform, project, started_at, correlation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          started_at = CASE
            WHEN mem_sessions.started_at <= excluded.started_at THEN mem_sessions.started_at
            ELSE excluded.started_at
          END,
          correlation_id = COALESCE(mem_sessions.correlation_id, excluded.correlation_id),
          updated_at = excluded.updated_at
      `)
      .run(sessionId, platform, project, ts, correlationId ?? null, current, current);
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

  private writeAuditLog(
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>
  ): void {
    this.db
      .query(`
        INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
        VALUES (?, 'system', ?, ?, ?, ?)
      `)
      .run(action, targetType, targetId, JSON.stringify(details), nowIso());
  }

  private upsertVector(observationId: string, content: string, createdAt: string): void {
    if (this.vectorEngine === "disabled") {
      return;
    }

    const vector = normalizeVectorDimension(this.embeddingProvider.embed(content), this.config.vectorDimension);
    this.refreshEmbeddingHealth();
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
      .run(observationId, this.vectorModelVersion, this.config.vectorDimension, vectorJson, createdAt, updatedAt);

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

    let normalizedProject: string;
    try {
      normalizedProject = this.normalizeProjectInput(event.project);
    } catch (e) {
      return makeErrorResponse(startedAt, e instanceof Error ? e.message : String(e), { project: event.project });
    }
    if (isAbsoluteProjectPath(normalizedProject)) {
      this.extendProjectNormalizationRoots([normalizedProject]);
    }

    const tags = normalizeTags(event.tags);
    const privacyTags = normalizeTags(event.privacy_tags);

    if (isBlockedTag(privacyTags)) {
      return makeResponse(startedAt, [], { blocked: true }, { skipped: true });
    }

    // Fail-close in managed mode: do not accept local-only writes when
    // the managed backend is unavailable.
    if (this.managedRequired && (!this.managedBackend || !this.managedBackend.isConnected())) {
      return makeErrorResponse(
        startedAt,
        "managed backend is required but not connected; write blocked (fail-close)",
        {
          project: normalizedProject,
          session_id: event.session_id,
          backend_mode: this.config.backendMode || "local",
          write_durability: "blocked",
        }
      );
    }

    const timestamp = event.ts || nowIso();
    const payload = parseJsonSafe(event.payload);
    const payloadText = JSON.stringify(payload);
    const redactedPayload = redactContent(payloadText, privacyTags);

    const dedupeHash = (event.dedupe_hash || buildDedupeHash(event)).trim();
    const eventId = (event.event_id || generateEventId()).trim();

    const observationBase = this.buildObservationFromEvent(event, redactedPayload);
    const redactedContent = redactContent(observationBase.content, privacyTags);
    const observationType = this.classifyObservation(event.event_type, observationBase.title, observationBase.content);
    const observationId = `obs_${eventId}`;
    const current = nowIso();

    try {
      const transaction = this.db.transaction(() => {
        this.ensureSession(event.session_id, event.platform, normalizedProject, timestamp, event.correlation_id);

        const eventInsert = this.db
          .query(`
            INSERT OR IGNORE INTO mem_events(
              event_id, platform, project, session_id, event_type, ts,
              payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, correlation_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            eventId,
            event.platform,
            normalizedProject,
            event.session_id,
            event.event_type,
            timestamp,
            redactedPayload,
            JSON.stringify(tags),
            JSON.stringify(privacyTags),
            dedupeHash,
            observationId,
            event.correlation_id ?? null,
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
              title, content, content_redacted, observation_type,
              tags_json, privacy_tags_json,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              content = excluded.content,
              content_redacted = excluded.content_redacted,
              observation_type = excluded.observation_type,
              tags_json = excluded.tags_json,
              privacy_tags_json = excluded.privacy_tags_json,
              updated_at = excluded.updated_at
          `)
          .run(
            observationId,
            eventId,
            event.platform,
            normalizedProject,
            event.session_id,
            observationBase.title,
            observationBase.content,
            redactedContent,
            observationType,
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
        this.extractAndStoreEntities(observationId, redactedContent, timestamp);
        this.autoLinkObservation(observationId, event.session_id, timestamp);

        if (isPrivateTag(privacyTags)) {
          this.db.query(`
            INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
            VALUES ('privacy_filter', ?, 'event', ?, ?, ?)
          `).run(
            event.platform,
            eventId,
            JSON.stringify({ reason: "private_tag", path: `${event.platform}/${normalizedProject}`, privacy_tags: privacyTags }),
            current
          );
        }

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
        project: normalizedProject,
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

      // Dual-write: replicate to managed backend if hybrid/managed
      if (this.managedBackend) {
        const storedEvent: StoredEvent = {
          event_id: eventId,
          platform: event.platform,
          project: normalizedProject,
          workspace_uid: "",
          session_id: event.session_id,
          event_type: event.event_type,
          ts: timestamp,
          payload_json: redactedPayload,
          tags_json: JSON.stringify(tags),
          privacy_tags_json: JSON.stringify(privacyTags),
          dedupe_hash: dedupeHash,
          observation_id: observationId,
          correlation_id: event.correlation_id || undefined,
          created_at: current,
        };
        this.managedBackend.replicateEvent(storedEvent);
      }

      const writeDurability = this.managedRequired ? "managed" : "local";

      return makeResponse(
        startedAt,
        [item],
        {
          project: normalizedProject,
          session_id: event.session_id,
          event_type: event.event_type,
        },
        {
          vector_engine: this.vectorEngine,
          embedding_provider: this.embeddingProvider.name,
          embedding_provider_status: this.embeddingHealth.status,
          write_durability: writeDurability,
        }
      );
    } catch (error) {
      if (options.allowQueue) {
        this.enqueueRetry(event, error instanceof Error ? error.message : String(error));
      }
      return makeErrorResponse(startedAt, error instanceof Error ? error.message : String(error), {
        project: normalizedProject,
        session_id: event.session_id,
      });
    }
  }

  /**
   * Enqueue a write operation for application-level serialization.
   * All SQLite writes are funneled through this queue to prevent
   * concurrent write conflicts between HTTP handlers and background workers.
   */
  private enqueueWrite<T>(fn: () => T): Promise<T> {
    this.writeQueuePending += 1;
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const resultPromise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.writeQueue = this.writeQueue.then(() => {
      this.writeQueuePending -= 1;
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    });

    return resultPromise;
  }

  /**
   * Queue-backed variant of recordEvent for use in HTTP handlers.
   * Returns "queue_full" when the pending queue exceeds the limit,
   * so callers can respond with 503 + Retry-After.
   */
  async recordEventQueued(
    event: EventEnvelope,
    options: { allowQueue: boolean } = { allowQueue: true }
  ): Promise<ApiResponse | "queue_full"> {
    if (this.writeQueuePending >= this.writeQueueLimit) {
      return "queue_full";
    }
    return this.enqueueWrite(() => this.recordEvent(event, options));
  }

  private visibilityFilterSql(alias: string, includePrivate: boolean): string {
    if (includePrivate) {
      return "";
    }

    return `
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(
          CASE
            WHEN json_valid(COALESCE(${alias}.privacy_tags_json, '[]')) THEN COALESCE(${alias}.privacy_tags_json, '[]')
            ELSE '["private"]'
          END
        ) AS jt
        WHERE lower(CAST(jt.value AS TEXT)) IN ('private', 'sensitive')
      )
    `;
  }

  private platformVisibilityFilterSql(alias: string): string {
    // Antigravity is currently hidden by default until official hooks are available.
    if (!this.isAntigravityIngestEnabled()) {
      return ` AND ${alias}.platform <> 'antigravity' `;
    }
    return "";
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
      strict_project?: boolean;
    },
    options: {
      skipPrivacy?: boolean;
    } = {}
  ): string {
    let nextSql = sql;
    const strictProject = filters.strict_project !== false;

    if (filters.project && strictProject) {
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

    nextSql += this.platformVisibilityFilterSql(alias);
    if (!options.skipPrivacy) {
      nextSql += this.visibilityFilterSql(alias, Boolean(filters.include_private));
    }
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

    const expanded = new Set<string>(escaped);
    for (const token of escaped) {
      const synonyms = SYNONYM_MAP[token];
      if (synonyms) {
        for (const synonym of synonyms) {
          expanded.add(synonym);
        }
      }
    }
    for (let i = 0; i < escaped.length - 1; i += 1) {
      expanded.add(`${escaped[i]} ${escaped[i + 1]}`);
    }

    return [...expanded].map((token) => `"${token}"`).join(" OR ");
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

  private vectorSearch(request: SearchRequest, internalLimit: number): VectorSearchResult {
    if (this.vectorEngine === "disabled") {
      return { scores: new Map<string, number>(), coverage: 0 };
    }

    const queryVector = normalizeVectorDimension(this.embeddingProvider.embed(request.query), this.config.vectorDimension);
    this.refreshEmbeddingHealth();
    const queryVectorJson = JSON.stringify(queryVector);

    if (this.vectorEngine === "sqlite-vec" && this.vecTableReady) {
      try {
        const params: unknown[] = [queryVectorJson, internalLimit * 3, this.vectorModelVersion, this.config.vectorDimension];
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
          JOIN mem_vectors mv
            ON mv.observation_id = c.id
            AND mv.model = ?
            AND mv.dimension = ?
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
        const normalized = normalizeScoreMap(raw);
        const migrationWarning = this.getMigrationProgress(this.vectorModelVersion) ?? undefined;
        return {
          scores: normalized,
          coverage: rows.length === 0 ? 0 : normalized.size / rows.length,
          migrationWarning,
        };
      } catch {
        this.vecTableReady = false;
      }
    }

    // JS brute-force path with migration fallback support
    const strictProjectWindow =
      request.project && request.strict_project !== false
        ? Math.min(1500, Math.max(600, internalLimit * 12))
        : Math.min(2000, Math.max(800, internalLimit * 20));

    const runBruteForce = (model: string): Array<{ id: string; score: number }> => {
      const p: unknown[] = [model, this.config.vectorDimension];
      let q = `
        SELECT
          v.observation_id AS id,
          v.vector_json AS vector_json,
          o.created_at AS created_at
        FROM mem_vectors v
        JOIN mem_observations o ON o.id = v.observation_id
        WHERE v.model = ? AND v.dimension = ?
      `;
      q = this.applyCommonFilters(q, p, "o", request);
      q += " ORDER BY o.created_at DESC LIMIT ?";
      p.push(strictProjectWindow);

      const bfRows = this.db.query(q).all(...(p as any[])) as Array<{ id: string; vector_json: string; created_at: string }>;
      const bfScored: Array<{ id: string; score: number }> = [];
      for (const row of bfRows) {
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
        bfScored.push({ id: row.id, score: (cosine + 1) / 2 });
      }
      return bfScored;
    };

    const scored = runBruteForce(this.vectorModelVersion);

    // Emit a migration warning when vectors are in a mixed-model state.
    // We do NOT score candidates from the legacy model to avoid cross-model
    // cosine similarity distortion. When coverage is low (<0.2), the ranking
    // layer zeros out vector weight and lexical search handles retrieval.
    const migrationWarning: string | undefined = this.getMigrationProgress(this.vectorModelVersion) ?? undefined;

    scored.sort((lhs, rhs) => rhs.score - lhs.score);
    const sliced = scored.slice(0, internalLimit);

    const raw = new Map<string, number>();
    for (const entry of sliced) {
      raw.set(entry.id, entry.score);
    }

    const normalized = normalizeScoreMap(raw);
    return {
      scores: normalized,
      coverage: scored.length === 0 ? 0 : normalized.size / scored.length,
      migrationWarning,
    };
  }

  /**
   * Returns the model name with the most vectors that differs from currentModel,
   * or null if no other models exist. Used for migration fallback during provider switch.
   */
  private resolveFallbackVectorModel(currentModel: string): string | null {
    const row = this.db
      .query(
        `SELECT model, COUNT(*) AS cnt
         FROM mem_vectors
         WHERE model != ?
         GROUP BY model
         ORDER BY cnt DESC
         LIMIT 1`
      )
      .get(currentModel) as { model: string; cnt: number } | null;
    return row?.model ?? null;
  }

  /**
   * Returns migration progress as a human-readable string when vectors are mixed
   * (i.e. some vectors use a different model than the current one),
   * or null when all vectors already belong to the current model.
   */
  private getMigrationProgress(currentModel: string): string | null {
    const totals = this.db
      .query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN model = ? THEN 1 ELSE 0 END) AS current_count
         FROM mem_vectors`
      )
      .get(currentModel) as { total: number; current_count: number } | null;

    if (!totals || totals.total === 0) {
      return null;
    }
    const total = Number(totals.total);
    const current = Number(totals.current_count);
    if (current >= total) {
      return null;
    }
    const pct = Math.round((current / total) * 100);
    return `vector_migration: ${current}/${total} vectors reindexed (${pct}%)`;
  }

  private recencyScore(createdAt: string): number {
    const created = Date.parse(createdAt);
    if (Number.isNaN(created)) {
      return 0;
    }

    const ageMs = Math.max(0, Date.now() - created);
    const ageHours = ageMs / (1000 * 60 * 60);
    const envDays = Number(process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS);
    const halfLifeDays = Number.isFinite(envDays) && envDays > 0 ? envDays : 14;
    const halfLifeHours = 24 * halfLifeDays;
    return Math.exp(-ageHours / halfLifeHours);
  }

  private tagMatchScore(tagsJson: unknown, queryTokens: string[]): number {
    const tags = parseArrayJson(tagsJson);
    if (tags.length === 0 || queryTokens.length === 0) {
      return 0;
    }

    let matches = 0;
    for (const tag of tags) {
      const normalizedTag = tag.toLowerCase();
      for (const token of queryTokens) {
        if (normalizedTag === token || normalizedTag.includes(token) || token.includes(normalizedTag)) {
          matches += 1;
          break;
        }
      }
    }

    return matches / Math.max(tags.length, queryTokens.length);
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
            o.id,
            o.event_id,
            o.platform,
            o.project,
            o.session_id,
            o.title,
            o.content_redacted,
            o.observation_type,
            o.tags_json,
            o.privacy_tags_json,
            o.created_at,
            o.updated_at,
            e.event_type
          FROM mem_observations o
          LEFT JOIN mem_events e ON e.event_id = o.event_id
          WHERE o.id IN (${placeholders})
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

  private expandByLinks(topIds: string[], request: SearchRequest, existingIds: Set<string>): Map<string, number> {
    if (topIds.length === 0) {
      return new Map<string, number>();
    }

    const placeholders = topIds.map(() => "?").join(", ");
    const params: unknown[] = [...topIds];

    let sql = `
      SELECT
        o.id AS id,
        MAX(l.weight) AS weight
      FROM mem_links l
      JOIN mem_observations o ON o.id = l.to_observation_id
      WHERE l.from_observation_id IN (${placeholders})
        AND l.relation IN ('shared_entity', 'follows')
    `;

    sql = this.applyCommonFilters(sql, params, "o", request);
    sql += " GROUP BY o.id ORDER BY weight DESC, o.created_at DESC LIMIT 40";

    try {
      const rows = this.db.query(sql).all(...(params as any[])) as Array<{ id: string; weight: number }>;
      const raw = new Map<string, number>();
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : "";
        const weight = Number(row.weight ?? 0);
        if (!id || existingIds.has(id) || Number.isNaN(weight)) {
          continue;
        }
        raw.set(id, weight);
      }
      return normalizeScoreMap(raw);
    } catch {
      return new Map<string, number>();
    }
  }

  private resolveSearchWeights(vectorCoverage: number): RankingWeights {
    const base: RankingWeights = {
      lexical: 0.32,
      vector: 0.28,
      recency: 0.10,
      tag_boost: 0.12,
      importance: 0.08,
      graph: 0.10,
    };
    if (vectorCoverage < 0.2) {
      return normalizeWeights({ ...base, vector: 0 });
    }
    return normalizeWeights(base);
  }

  private buildRerankInput(
    ranked: SearchCandidate[],
    observations: Map<string, Record<string, unknown>>
  ): RerankInputItem[] {
    return ranked.map((item, index) => {
      const observation = observations.get(item.id) ?? {};
      return {
        id: item.id,
        score: item.final,
        created_at: item.created_at,
        title: typeof observation.title === "string" ? observation.title : "",
        content: typeof observation.content_redacted === "string" ? observation.content_redacted : "",
        source_index: index,
      };
    });
  }

  private applyRerank(
    query: string,
    ranked: SearchCandidate[],
    observations: Map<string, Record<string, unknown>>
  ): { ranked: SearchCandidate[]; pre: Array<Record<string, unknown>>; post: Array<Record<string, unknown>> } {
    const pre = ranked.slice(0, 25).map((item, index) => ({
      rank: index + 1,
      id: item.id,
      score: Number(item.final.toFixed(6)),
    }));

    if (!this.rerankerEnabled || !this.reranker || ranked.length === 0) {
      for (const item of ranked) {
        item.rerank = item.final;
      }
      return { ranked, pre, post: pre };
    }

    const reranked = this.reranker.rerank({
      query,
      items: this.buildRerankInput(ranked, observations),
    });
    const rerankScoreById = new Map<string, number>();
    const rerankOrderById = new Map<string, number>();
    reranked.forEach((item: RerankOutputItem, index) => {
      rerankScoreById.set(item.id, item.rerank_score);
      rerankOrderById.set(item.id, index);
    });

    ranked.sort((lhs, rhs) => {
      const lhsOrder = rerankOrderById.get(lhs.id);
      const rhsOrder = rerankOrderById.get(rhs.id);
      if (typeof lhsOrder === "number" && typeof rhsOrder === "number" && lhsOrder !== rhsOrder) {
        return lhsOrder - rhsOrder;
      }
      const lhsScore = rerankScoreById.get(lhs.id) ?? lhs.final;
      const rhsScore = rerankScoreById.get(rhs.id) ?? rhs.final;
      if (rhsScore !== lhsScore) {
        return rhsScore - lhsScore;
      }
      return lhs.id.localeCompare(rhs.id);
    });

    for (const item of ranked) {
      item.rerank = rerankScoreById.get(item.id) ?? item.final;
    }

    const post = ranked.slice(0, 25).map((item, index) => ({
      rank: index + 1,
      id: item.id,
      score: Number((item.rerank ?? item.final).toFixed(6)),
    }));

    return { ranked, pre, post };
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
    const includePrivate = Boolean(request.include_private);
    const strictProject = request.strict_project !== false;
    const expandLinks = (this.config.searchExpandLinks !== false) && request.expand_links !== false;
    const normalizedProject = request.project ? this.normalizeProjectInput(request.project) : request.project;
    const normalizedRequest: SearchRequest = {
      ...request,
      project: normalizedProject,
      include_private: includePrivate,
      strict_project: strictProject,
      expand_links: expandLinks,
    };

    const lexical = this.lexicalSearch(normalizedRequest, internalLimit);
    const vectorResult = this.vectorSearch(normalizedRequest, internalLimit);
    const vector = vectorResult.scores;
    const graph = new Map<string, number>();

    const candidateIds = new Set<string>([...lexical.keys(), ...vector.keys()]);
    if (expandLinks && candidateIds.size > 0) {
      const topIds = [...candidateIds]
        .sort((lhs, rhs) => {
          const lhsScore = (lexical.get(lhs) ?? 0) + (vector.get(lhs) ?? 0);
          const rhsScore = (lexical.get(rhs) ?? 0) + (vector.get(rhs) ?? 0);
          return rhsScore - lhsScore;
        })
        .slice(0, 10);
      const linked = this.expandByLinks(topIds, normalizedRequest, candidateIds);
      for (const [id, score] of linked.entries()) {
        candidateIds.add(id);
        graph.set(id, score);
      }
    }
    const observations = this.loadObservations([...candidateIds]);
    const queryTokens = tokenize(request.query);

    const ranked: SearchCandidate[] = [];
    let vectorCandidateCount = 0;
    let privacyExcludedCount = 0;
    let boundaryExcludedCount = 0;
    for (const id of candidateIds) {
      const observation = observations.get(id);
      if (!observation) {
        continue;
      }

      const observationProject = typeof observation.project === "string" ? observation.project : "";
      if (strictProject && normalizedProject && observationProject !== normalizedProject) {
        boundaryExcludedCount++;
        continue;
      }

      const privacyTags = parseArrayJson(observation.privacy_tags_json);
      if (!includePrivate && hasPrivateVisibilityTag(privacyTags)) {
        privacyExcludedCount++;
        continue;
      }

      const createdAt = typeof observation.created_at === "string" ? observation.created_at : nowIso();
      const lexicalScore = lexical.get(id) ?? 0;
      const vectorScore = vector.get(id) ?? 0;
      if (vector.has(id)) {
        vectorCandidateCount += 1;
      }
      const recency = this.recencyScore(createdAt);
      const tagBoost = this.tagMatchScore(observation.tags_json, queryTokens);
      const eventType = typeof observation.event_type === "string" ? observation.event_type : "";
      const baseImportance = EVENT_TYPE_IMPORTANCE[eventType] ?? 0.5;
      const graphScore = graph.get(id) ?? 0;

      ranked.push({
        id,
        lexical: lexicalScore,
        vector: vectorScore,
        recency,
        tag_boost: tagBoost,
        importance: baseImportance,
        graph: graphScore,
        final: 0,
        rerank: 0,
        created_at: createdAt,
      });
    }

    // アクセス頻度による importance 加点（mem_audit_log の search_hit を一括集計）
    if (ranked.length > 0) {
      const ids = ranked.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      try {
        const hitCounts = this.db
          .query(
            `SELECT target_id, COUNT(*) AS cnt
             FROM mem_audit_log
             WHERE action = 'search_hit' AND target_type = 'observation' AND target_id IN (${placeholders})
             GROUP BY target_id`
          )
          .all(...ids) as Array<{ target_id: string; cnt: number }>;
        const hitMap = new Map<string, number>();
        for (const row of hitCounts) {
          hitMap.set(row.target_id, Number(row.cnt));
        }
        for (const item of ranked) {
          const cnt = hitMap.get(item.id) ?? 0;
          // access_count >= 10 → +0.2, >= 5 → +0.1（上限 +0.2）
          const boost = cnt >= 10 ? 0.2 : cnt >= 5 ? 0.1 : 0;
          item.importance = Math.min(1.0, item.importance + boost);
        }
      } catch {
        // best effort: アクセス頻度加点に失敗しても検索は継続
      }
    }

    const vectorCoverage = ranked.length === 0 ? 0 : vectorCandidateCount / ranked.length;

    // Route query to determine retrieval strategy and weight overrides
    const routeDecision: RouteDecision = routeQuery(request.query, request.question_kind);
    const baseWeights = this.resolveSearchWeights(vectorCoverage);
    // Blend router weights with existing weights: router takes precedence
    // when a specific question kind is detected (confidence > 0.5)
    const weights = routeDecision.confidence > 0.5
      ? routeDecision.weights
      : baseWeights;

    for (const item of ranked) {
      item.final =
        weights.lexical * item.lexical +
        weights.vector * item.vector +
        weights.recency * item.recency +
        weights.tag_boost * item.tag_boost +
        weights.importance * item.importance +
        weights.graph * item.graph;
    }

    ranked.sort((lhs, rhs) => {
      if (rhs.final !== lhs.final) {
        return rhs.final - lhs.final;
      }
      if (rhs.created_at !== lhs.created_at) {
        return String(rhs.created_at).localeCompare(String(lhs.created_at));
      }
      return lhs.id.localeCompare(rhs.id);
    });

    const rerankResult = this.applyRerank(request.query, ranked, observations);
    const rankedAfterRerank = rerankResult.ranked;

    const items = rankedAfterRerank.slice(0, limit).map((entry) => {
      const observation = observations.get(entry.id) ?? {};
      const tags = parseArrayJson(observation.tags_json);
      const privacyTags = parseArrayJson(observation.privacy_tags_json);

      const item: Record<string, unknown> = {
        id: entry.id,
        event_id: observation.event_id,
        platform: observation.platform,
        project: observation.project,
        session_id: observation.session_id,
        title: observation.title,
        content: typeof observation.content_redacted === "string"
          ? observation.content_redacted.slice(0, 2000)
          : "",
        observation_type: observation.observation_type || "context",
        created_at: observation.created_at,
        tags,
        privacy_tags: privacyTags,
        scores: {
          lexical: Number(entry.lexical.toFixed(6)),
          vector: Number(entry.vector.toFixed(6)),
          recency: Number(entry.recency.toFixed(6)),
          tag_boost: Number(entry.tag_boost.toFixed(6)),
          importance: Number(entry.importance.toFixed(6)),
          graph: Number(entry.graph.toFixed(6)),
          final: Number(entry.final.toFixed(6)),
          rerank: Number((entry.rerank || entry.final).toFixed(6)),
        },
      };

      if (request.debug) {
        const total = entry.final;
        item.recall_trace = {
          lexical: Number((weights.lexical * entry.lexical).toFixed(6)),
          vector: Number((weights.vector * entry.vector).toFixed(6)),
          recency: Number((weights.recency * entry.recency).toFixed(6)),
          tag_boost: Number((weights.tag_boost * entry.tag_boost).toFixed(6)),
          importance: Number((weights.importance * entry.importance).toFixed(6)),
          graph: Number((weights.graph * entry.graph).toFixed(6)),
          total: Number(total.toFixed(6)),
        };
      }

      return item;
    });

    const meta: Record<string, unknown> = {
      ranking: this.config.searchRanking || DEFAULT_SEARCH_RANKING,
      question_kind: routeDecision.kind,
      question_kind_confidence: Number(routeDecision.confidence.toFixed(3)),
      vector_engine: this.vectorEngine,
      vector_model: this.vectorModelVersion,
      fts_enabled: this.ftsEnabled,
      embedding_provider: this.embeddingProvider.name,
      embedding_provider_status: this.embeddingHealth.status,
      lexical_candidates: lexical.size,
      vector_candidates: vector.size,
      graph_candidates: graph.size,
      candidate_counts: {
        lexical: lexical.size,
        vector: vector.size,
        graph: graph.size,
        final: rankedAfterRerank.length,
      },
      vector_coverage: Number(vectorCoverage.toFixed(6)),
    };
    // Append migration warning when vectors are in a mixed-model state
    if (vectorResult.migrationWarning) {
      const existingWarnings = Array.isArray(meta.warnings) ? (meta.warnings as string[]) : [];
      meta.warnings = [...existingWarnings, vectorResult.migrationWarning];
    }
    meta.token_estimate = buildTokenEstimateMeta({
      input: {
        query: request.query,
        limit,
        project: request.project,
      },
      output: items.map((item) => ({
        id: item.id,
        title: item.title,
      })),
      strategy: "index",
    });
    if (request.debug) {
      meta.debug = {
        strict_project: strictProject,
        expand_links: expandLinks,
        weights,
        vector_backend_coverage: Number(vectorResult.coverage.toFixed(6)),
        embedding_provider: this.embeddingProvider.name,
        embedding_model: this.embeddingProvider.model,
        reranker: {
          enabled: this.rerankerEnabled,
          name: this.reranker?.name || null,
        },
        rerank_pre: rerankResult.pre,
        rerank_post: rerankResult.post,
      };
    }

    try {
      this.writeAuditLog("read.search", "project", normalizedProject || "", {
        query: request.query,
        limit,
        include_private: includePrivate,
        count: items.length,
        privacy_excluded_count: privacyExcludedCount,
        boundary_excluded_count: boundaryExcludedCount,
      });
      if (privacyExcludedCount > 0) {
        this.writeAuditLog("privacy_filter", "search", normalizedProject || "", {
          reason: "include_private_false",
          query: request.query,
          returned_count: items.length,
          excluded_count: privacyExcludedCount,
          path: `search/${normalizedProject || "global"}`,
          ts: nowIso(),
        });
      }
      if (boundaryExcludedCount > 0) {
        this.writeAuditLog("boundary_filter", "search", normalizedProject || "", {
          reason: "workspace_boundary",
          excluded_count: boundaryExcludedCount,
          project: normalizedProject,
        });
      }
      // 返却した observation ごとに search_hit を記録（アクセス頻度集計用）
      for (const item of items) {
        const itemId = item.id as string;
        if (itemId) {
          this.writeAuditLog("search_hit", "observation", itemId, {
            query: request.query,
            project: normalizedProject,
          });
        }
      }
    } catch {
      // best effort
    }

    // Shadow-read: compare results with managed backend (fire-and-forget)
    if (this.managedBackend) {
      const resultIds = items.map((item) => item.id as string);
      this.managedBackend.shadowRead(request.query, resultIds, {
        project: normalizedProject,
        limit,
      }).catch(() => {
        // fire-and-forget, errors tracked in shadow metrics
      });
    }

    // Evidence-bound answer compilation
    const compiled = compileAnswer({
      question_kind: routeDecision.kind,
      observations: items.map((item) => ({
        id: item.id as string,
        platform: item.platform as string,
        project: item.project as string,
        title: item.title as string | null,
        content_redacted: item.content as string,
        created_at: item.created_at as string,
        tags_json: JSON.stringify(item.tags),
        session_id: item.session_id as string,
        final_score: (item.scores as { final: number }).final,
      })),
      privacy_excluded_count: privacyExcludedCount,
    });
    meta.compiled = {
      question_kind: compiled.question_kind,
      evidence_count: compiled.evidence_count,
      platforms: compiled.meta.platforms,
      projects: compiled.meta.projects,
      time_span: compiled.meta.time_span,
      cross_session: compiled.meta.cross_session,
      privacy_excluded: compiled.meta.privacy_excluded,
    };

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, meta);
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
    const normalizedProject = request.project ? this.normalizeProjectInput(request.project) : undefined;

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

    if (normalizedProject) {
      sql += " AND o.project = ?";
      params.push(normalizedProject);
    }

    if (typeFilter) {
      sql += " AND COALESCE(e.event_type, '') = ?";
      params.push(typeFilter);
    }

    sql += this.platformVisibilityFilterSql("o");
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
    const normalizedProject = request.project ? this.normalizeProjectInput(request.project) : undefined;

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

    if (normalizedProject) {
      sql += " AND s.project = ?";
      params.push(normalizedProject);
    }
    sql += this.platformVisibilityFilterSql("s");

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
    const normalizedProject = request.project ? this.normalizeProjectInput(request.project) : undefined;
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

    if (normalizedProject) {
      sql += " AND o.project = ?";
      params.push(normalizedProject);
    }

    sql += this.platformVisibilityFilterSql("o");
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
        project: normalizedProject,
        include_private: includePrivate,
      },
      { ranking: "session_thread_v1" }
    );
  }

  searchFacets(request: SearchFacetsRequest): ApiResponse {
    const startedAt = performance.now();
    const includePrivate = Boolean(request.include_private);
    const normalizedProject = request.project ? this.normalizeProjectInput(request.project) : undefined;
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

    if (normalizedProject) {
      sql += " AND o.project = ?";
      params.push(normalizedProject);
    }

    sql += this.platformVisibilityFilterSql("o");
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

    try {
      this.writeAuditLog("read.timeline", "observation", request.id, {
        before,
        after,
        include_private: includePrivate,
        count: items.length,
      });
    } catch {
      // best effort
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      center_id: request.id,
      token_estimate: buildTokenEstimateMeta({
        input: {
          id: request.id,
          before,
          after,
        },
        output: items,
        strategy: "timeline",
      }),
    });
  }

  getObservations(request: GetObservationsRequest): ApiResponse {
    const startedAt = performance.now();
    const ids = Array.isArray(request.ids) ? request.ids.filter((id): id is string => typeof id === "string") : [];

    if (ids.length === 0) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        token_estimate: buildTokenEstimateMeta({
          input: { ids: [] },
          output: [],
          strategy: "details",
        }),
      });
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

    const warnings: string[] = [];
    if (ids.length >= 20) {
      warnings.push(
        "Large details request detected. Prefer 3-layer workflow: search -> timeline -> get_observations (targeted IDs)."
      );
    }

    try {
      this.writeAuditLog("read.get_observations", "observation", ids[0] || "", {
        requested_ids: ids.length,
        returned_ids: items.length,
        include_private: includePrivate,
        compact,
      });
    } catch {
      // best effort
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      compact,
      token_estimate: buildTokenEstimateMeta({
        input: { ids, compact },
        output: items,
        strategy: "details",
      }),
      warnings,
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
    this.enqueueConsolidation(request.project || basename(process.cwd()), request.session_id, "finalize");

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

  resolveSessionChain(correlationId: string, project: string): ApiResponse {
    const startedAt = performance.now();

    if (!correlationId || !project) {
      return makeErrorResponse(startedAt, "correlation_id and project are required", { correlation_id: correlationId, project });
    }

    const normalizedProject = this.normalizeProjectInput(project);
    const sessions = this.db
      .query(
        `
          SELECT session_id, platform, project, started_at, ended_at, correlation_id
          FROM mem_sessions
          WHERE correlation_id = ? AND project = ?
          ORDER BY started_at ASC
        `
      )
      .all(correlationId, normalizedProject) as Array<{ session_id: string; platform: string; project: string; started_at: string; ended_at: string | null; correlation_id: string }>;

    const items = sessions.map((s) => ({
      session_id: s.session_id,
      platform: s.platform,
      project: s.project,
      started_at: s.started_at,
      ended_at: s.ended_at,
      correlation_id: s.correlation_id,
    }));

    return makeResponse(startedAt, items, { correlation_id: correlationId, project: normalizedProject }, { chain_length: items.length });
  }

  resumePack(request: ResumePackRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.config.injectionEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, { injection_enabled: false });
    }

    if (!request.project) {
      return makeErrorResponse(startedAt, "project is required", request as unknown as Record<string, unknown>);
    }

    const normalizedProject = this.normalizeProjectInput(request.project);
    const limit = clampLimit(request.limit, 5, 1, 20);
    const includePrivate = Boolean(request.include_private);
    const visibility = this.visibilityFilterSql("o", includePrivate);

    // max_tokens: request > config > env > default (4000)
    const maxTokens: number = (() => {
      if (typeof request.resume_pack_max_tokens === "number" && request.resume_pack_max_tokens > 0) {
        return request.resume_pack_max_tokens;
      }
      if (typeof this.config.resumePackMaxTokens === "number" && this.config.resumePackMaxTokens > 0) {
        return this.config.resumePackMaxTokens;
      }
      const envRaw = Number(process.env.HARNESS_MEM_RESUME_PACK_MAX_TOKENS);
      if (Number.isFinite(envRaw) && envRaw > 0) {
        return envRaw;
      }
      return 4000;
    })();

    // correlation_id 指定時: 同じ相関IDを持つ全セッションから文脈を取得
    const useCorrelationId = Boolean(request.correlation_id);

    const correlationId = request.correlation_id ?? null;

    const latestSummary = this.db
      .query(
        `
          SELECT s.session_id, s.summary, s.ended_at
          FROM mem_sessions s
          WHERE s.project = ?
          ${useCorrelationId ? "AND s.correlation_id = ?" : "AND s.summary IS NOT NULL"}
          ORDER BY s.ended_at DESC
          LIMIT 1
        `
      )
      .get(...(useCorrelationId ? [normalizedProject, correlationId as string] : [normalizedProject])) as { session_id: string; summary: string; ended_at: string } | null;

    let rows: Array<Record<string, unknown>>;

    if (useCorrelationId) {
      // correlation_id が指定された場合: 全関連セッションから観測を取得
      rows = this.db
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
              o.created_at,
              e.event_type
            FROM mem_observations o
            JOIN mem_sessions s ON o.session_id = s.session_id
            LEFT JOIN mem_events e ON o.event_id = e.event_id
            WHERE o.project = ?
              AND s.correlation_id = ?
              ${request.session_id ? "AND o.session_id <> ?" : ""}
            ${visibility}
            ORDER BY o.created_at DESC
            LIMIT ?
          `
        )
        .all(...(request.session_id ? [normalizedProject, correlationId as string, request.session_id, limit] : [normalizedProject, correlationId as string, limit])) as Array<Record<string, unknown>>;
    } else {
      rows = this.db
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
              o.created_at,
              e.event_type
            FROM mem_observations o
            LEFT JOIN mem_events e ON o.event_id = e.event_id
            WHERE o.project = ?
            ${request.session_id ? "AND o.session_id <> ?" : ""}
            ${visibility}
            ORDER BY o.created_at DESC
            LIMIT ?
          `
        )
        .all(...(request.session_id ? [normalizedProject, request.session_id, limit] : [normalizedProject, limit])) as Array<Record<string, unknown>>;
    }

    // Progressive Compaction: importance × recency でランク付け
    interface RankedRow {
      row: Record<string, unknown>;
      score: number;
    }
    const rankedRows: RankedRow[] = rows.map((row) => {
      const eventType = typeof row.event_type === "string" ? row.event_type : "";
      const importance = typeof EVENT_TYPE_IMPORTANCE[eventType] === "number" ? EVENT_TYPE_IMPORTANCE[eventType] : 0.5;
      const recency = this.recencyScore(typeof row.created_at === "string" ? row.created_at : "");
      return { row, score: importance * recency };
    });
    rankedRows.sort((a, b) => b.score - a.score);

    // トークン予算を計算（session_summary が存在すればそのトークン数を差し引く）
    const summaryTokens = latestSummary ? estimateTokenCount(latestSummary.summary ?? "") : 0;
    const observationBudget = Math.max(0, maxTokens - summaryTokens);

    // 上位から詳細出力、予算を超えたら 1行サマリに圧縮
    const detailedItems: Array<Record<string, unknown>> = [];
    const compactItems: Array<Record<string, unknown>> = [];
    let usedTokens = 0;
    let originalTokens = 0;

    for (const { row } of rankedRows) {
      const content = typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 800) : "";
      const fullItem = {
        id: row.id,
        type: "observation",
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        session_id: row.session_id,
        title: row.title,
        content,
        created_at: row.created_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: parseArrayJson(row.privacy_tags_json),
      };
      const fullTokens = estimateTokenCount(JSON.stringify(fullItem));
      originalTokens += fullTokens;

      if (usedTokens + fullTokens <= observationBudget) {
        detailedItems.push(fullItem);
        usedTokens += fullTokens;
      } else {
        // 1行サマリに圧縮: "- {title} ({date})"
        const title = typeof row.title === "string" && row.title.length > 0 ? row.title : typeof row.id === "string" ? row.id : "observation";
        const date = typeof row.created_at === "string" ? row.created_at.slice(0, 10) : "";
        const summaryLine = `- ${title} (${date})`;
        compactItems.push({
          id: row.id,
          type: "observation_summary",
          title,
          created_at: row.created_at,
          summary: summaryLine,
        });
        usedTokens += estimateTokenCount(summaryLine);
      }
    }

    const compressedTokens = summaryTokens + usedTokens;
    const totalOriginalTokens = summaryTokens + originalTokens;
    const compaction_ratio = totalOriginalTokens > 0
      ? Math.max(0, 1 - compressedTokens / totalOriginalTokens)
      : 0;

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

    for (const item of detailedItems) {
      items.push(item);
    }
    for (const item of compactItems) {
      items.push(item);
    }

    // static_section: 有効なファクト（変化しにくいプロジェクト知識）をまとめてキャッシュ可能な形式で提供
    const activeFacts = this.db
      .query(
        `
          SELECT fact_type, fact_key, fact_value, confidence
          FROM mem_facts
          WHERE project = ?
            AND merged_into_fact_id IS NULL
            AND superseded_by IS NULL
          ORDER BY fact_type ASC, fact_key ASC, created_at ASC
        `
      )
      .all(normalizedProject) as Array<{
        fact_type: string;
        fact_key: string;
        fact_value: string;
        confidence: number;
      }>;

    interface StaticSection {
      content: string;
      content_hash: string;
      cache_hint: "stable";
      fact_count: number;
    }

    interface DynamicSection {
      content: string;
      cache_hint: "volatile";
      observation_count: number;
    }

    let static_section: StaticSection | undefined;
    let dynamic_section: DynamicSection | undefined;

    if (activeFacts.length > 0) {
      // ファクトを決定論的な順序でテキスト化（同じファクトセット → 同じテキスト）
      const factLines = activeFacts.map(
        (f) => `[${f.fact_type}] ${f.fact_key}: ${f.fact_value} (confidence=${f.confidence.toFixed(2)})`
      );
      const staticContent = `# Project Facts\n\n${factLines.join("\n")}`;
      const contentHash = createHash("sha256").update(staticContent, "utf8").digest("hex");
      static_section = {
        content: staticContent,
        content_hash: contentHash,
        cache_hint: "stable",
        fact_count: activeFacts.length,
      };
    }

    // dynamic_section: Progressive Compaction 済みの直近観測（セッションごとに変化する）
    const dynamicLines: string[] = [];
    if (latestSummary) {
      dynamicLines.push(`## Session Summary (${latestSummary.session_id})\n${latestSummary.summary}`);
    }
    if (detailedItems.length > 0) {
      dynamicLines.push(
        "## Recent Observations\n" +
          detailedItems
            .map((item) => {
              const title = typeof item.title === "string" ? item.title : String(item.id);
              const content = typeof item.content === "string" ? item.content.slice(0, 200) : "";
              const date = typeof item.created_at === "string" ? item.created_at.slice(0, 10) : "";
              return `### ${title} (${date})\n${content}`;
            })
            .join("\n\n")
      );
    }
    if (compactItems.length > 0) {
      dynamicLines.push(
        "## Compacted Observations\n" +
          compactItems.map((item) => (typeof item.summary === "string" ? item.summary : String(item.id))).join("\n")
      );
    }

    if (dynamicLines.length > 0) {
      dynamic_section = {
        content: dynamicLines.join("\n\n"),
        cache_hint: "volatile",
        observation_count: detailedItems.length + compactItems.length,
      };
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      include_summary: Boolean(latestSummary),
      correlation_id: request.correlation_id ?? null,
      compaction_ratio: Math.round(compaction_ratio * 1000) / 1000,
      resume_pack_max_tokens: maxTokens,
      detailed_count: detailedItems.length,
      compacted_count: compactItems.length,
      ...(static_section !== undefined ? { static_section } : {}),
      ...(dynamic_section !== undefined ? { dynamic_section } : {}),
    });
  }

  health(): ApiResponse {
    const startedAt = performance.now();
    this.refreshEmbeddingHealth();

    const sessions = this.db.query(`SELECT COUNT(*) AS count FROM mem_sessions`).get() as { count: number };
    const events = this.db.query(`SELECT COUNT(*) AS count FROM mem_events`).get() as { count: number };
    const observations = this.db.query(`SELECT COUNT(*) AS count FROM mem_observations`).get() as { count: number };
    const queue = this.db.query(`SELECT COUNT(*) AS count FROM mem_retry_queue`).get() as { count: number };

    const dbPath = resolveHomePath(this.config.dbPath);
    const dbSize = existsSync(dbPath) ? statSync(dbPath).size : 0;

    const managedDegraded = this.managedRequired && (!this.managedBackend || !this.managedBackend.isConnected());

    return makeResponse(
      startedAt,
      [
        {
          status: managedDegraded ? "degraded" : "ok",
          pid: process.pid,
          host: this.config.bindHost,
          port: this.config.bindPort,
          backend_mode: this.config.backendMode || "local",
          db_path: dbPath,
          db_size_bytes: dbSize,
          vector_engine: this.vectorEngine,
          vector_model: this.vectorModelVersion,
          fts_enabled: this.ftsEnabled,
          embedding_provider: this.embeddingProvider.name,
          embedding_provider_status: this.embeddingHealth.status,
          embedding_provider_details: this.embeddingHealth.details,
          features: {
            capture: this.config.captureEnabled,
            retrieval: this.config.retrievalEnabled,
            injection: this.config.injectionEnabled,
            embedding_provider: this.embeddingProvider.name,
            embedding_model: this.embeddingProvider.model,
            reranker_enabled: this.rerankerEnabled,
            reranker_name: this.reranker?.name || null,
            consolidation_enabled: this.isConsolidationEnabled(),
            consolidation_interval_ms: this.getConsolidationIntervalMs(),
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
            antigravity_logs_root: this.getAntigravityLogsRoot(),
            antigravity_workspace_storage_root: this.getAntigravityWorkspaceStorageRoot(),
            antigravity_ingest_interval_ms: this.getAntigravityIngestIntervalMs(),
            antigravity_backfill_hours: this.getAntigravityBackfillHours(),
            gemini_history_ingest: this.isGeminiIngestEnabled(),
            gemini_events_path: this.getGeminiEventsPath(),
            gemini_ingest_interval_ms: this.getGeminiIngestIntervalMs(),
            gemini_backfill_hours: this.getGeminiBackfillHours(),
            search_ranking: this.config.searchRanking || DEFAULT_SEARCH_RANKING,
            search_expand_links: this.config.searchExpandLinks !== false,
          },
          managed_backend: this.managedBackend ? this.managedBackend.getStatus() : null,
          warnings: [
            ...this.embeddingWarnings,
            ...(this.managedRequired && (!this.managedBackend || !this.managedBackend.isConnected())
              ? ["managed mode active but ManagedBackend not connected — writes are BLOCKED (fail-close)"]
              : []),
          ],
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
    this.refreshEmbeddingHealth();

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

    const consolidationStats = this.db
      .query(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_jobs,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_jobs,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_jobs
        FROM mem_consolidation_queue
      `)
      .get() as
      | { pending_jobs?: number; running_jobs?: number; failed_jobs?: number; completed_jobs?: number }
      | null;

    const factStats = this.db
      .query(`
        SELECT
          COUNT(*) AS facts_total,
          SUM(CASE WHEN merged_into_fact_id IS NULL THEN 0 ELSE 1 END) AS facts_merged
        FROM mem_facts
        WHERE valid_to IS NULL
      `)
      .get() as { facts_total?: number; facts_merged?: number } | null;

    return makeResponse(
      startedAt,
      [
        {
          vector_engine: this.vectorEngine,
          vector_model: this.vectorModelVersion,
          vec_table_ready: this.vecTableReady,
          fts_enabled: this.ftsEnabled,
          embedding_provider: this.embeddingProvider.name,
          embedding_provider_status: this.embeddingHealth.status,
          embedding_provider_details: this.embeddingHealth.details,
          reranker_enabled: this.rerankerEnabled,
          reranker_name: this.reranker?.name || null,
          coverage: {
            observations: Number(vectorCoverage?.observations_count ?? 0),
            mem_vectors: Number(vectorCoverage?.mem_vectors_count ?? 0),
            mem_vectors_vec_map: Number(vectorCoverage?.vec_map_count ?? 0),
          },
          retry_queue: {
            count: Number(queueStats?.count ?? 0),
            max_retry_count: Number(queueStats?.max_retry_count ?? 0),
          },
          consolidation_queue: {
            pending: Number(consolidationStats?.pending_jobs ?? 0),
            running: Number(consolidationStats?.running_jobs ?? 0),
            failed: Number(consolidationStats?.failed_jobs ?? 0),
            completed: Number(consolidationStats?.completed_jobs ?? 0),
          },
          facts: {
            total: Number(factStats?.facts_total ?? 0),
            merged: Number(factStats?.facts_merged ?? 0),
          },
          managed_backend: this.managedBackend ? this.managedBackend.getStatus() : null,
        },
      ],
      {},
      { ranking: "metrics_v1" }
    );
  }

  environmentSnapshot(): ApiResponse {
    const startedAt = performance.now();
    const uiPortRaw = Number(process.env.HARNESS_MEM_UI_PORT || 37901);
    const uiPort = Number.isFinite(uiPortRaw) ? Math.trunc(uiPortRaw) : 37901;
    const healthPayload = this.health();
    const healthItem = (healthPayload.items[0] || {}) as Record<string, unknown>;
    const managedStatus = this.managedBackend ? (this.managedBackend.getStatus() as unknown as Record<string, unknown>) : null;

    const cache = this.environmentSnapshotCache.getOrCreate(() =>
      collectEnvironmentSnapshot({
        state_dir: process.env.HARNESS_MEM_HOME,
        mem_host: this.config.bindHost,
        mem_port: this.config.bindPort,
        ui_port: uiPort,
        health_item: healthItem,
        managed_backend: managedStatus,
      })
    );

    try {
      this.writeAuditLog("read.environment", "system", cache.value.snapshot_id, {
        cache_hit: cache.cache_hit,
        cache_age_ms: cache.age_ms,
        cache_ttl_ms: cache.ttl_ms,
      });
    } catch {
      // best effort
    }

    return makeResponse(
      startedAt,
      [cache.value],
      {},
      {
        ranking: "environment_v1",
        cache_hit: cache.cache_hit,
        cache_age_ms: cache.age_ms,
        cache_ttl_ms: cache.ttl_ms,
        snapshot_id: cache.value.snapshot_id,
      }
    );
  }

  private enqueueConsolidation(project: string, sessionId: string, reason: string): void {
    if (!this.isConsolidationEnabled()) {
      return;
    }
    enqueueConsolidationJob(this.db, project, sessionId, reason);
  }

  async runConsolidation(request: ConsolidationRunRequest = {}): Promise<ApiResponse> {
    const startedAt = performance.now();
    if (!this.isConsolidationEnabled()) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        skipped: "consolidation_disabled",
      });
    }

    const options: ConsolidationRunOptions = {
      reason: request.reason || "manual",
      project: request.project,
      session_id: request.session_id,
      limit: request.limit,
    };

    const stats: ConsolidationRunStats = await runConsolidationOnce(this.db, options);
    try {
      this.writeAuditLog("admin.consolidation.run", "consolidation", "", {
        ...stats,
        reason: options.reason,
      });
    } catch {
      // best effort
    }

    return makeResponse(
      startedAt,
      [
        {
          ...stats,
          reason: options.reason,
        },
      ],
      request as unknown as Record<string, unknown>,
      { ranking: "consolidation_v1" }
    );
  }

  getConsolidationStatus(): ApiResponse {
    const startedAt = performance.now();
    const queue = this.db
      .query(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_jobs,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_jobs,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_jobs
        FROM mem_consolidation_queue
      `)
      .get() as
      | {
          pending_jobs?: number;
          running_jobs?: number;
          failed_jobs?: number;
          completed_jobs?: number;
        }
      | null;

    const facts = this.db
      .query(`
        SELECT
          COUNT(*) AS facts_total,
          SUM(CASE WHEN merged_into_fact_id IS NULL THEN 0 ELSE 1 END) AS facts_merged
        FROM mem_facts
        WHERE valid_to IS NULL
      `)
      .get() as { facts_total?: number; facts_merged?: number } | null;

    return makeResponse(
      startedAt,
      [
        {
          pending_jobs: Number(queue?.pending_jobs ?? 0),
          running_jobs: Number(queue?.running_jobs ?? 0),
          failed_jobs: Number(queue?.failed_jobs ?? 0),
          completed_jobs: Number(queue?.completed_jobs ?? 0),
          facts_total: Number(facts?.facts_total ?? 0),
          facts_merged: Number(facts?.facts_merged ?? 0),
          enabled: this.isConsolidationEnabled(),
          interval_ms: this.getConsolidationIntervalMs(),
        },
      ],
      {},
      { ranking: "consolidation_status_v1" }
    );
  }

  getAuditLog(request: AuditLogRequest = {}): ApiResponse {
    const startedAt = performance.now();
    const limit = clampLimit(request.limit, 50, 1, 500);
    const params: unknown[] = [];

    let sql = `
      SELECT id, action, actor, target_type, target_id, details_json, created_at
      FROM mem_audit_log
      WHERE 1 = 1
    `;

    if (request.action) {
      sql += " AND action = ?";
      params.push(request.action);
    }
    if (request.target_type) {
      sql += " AND target_type = ?";
      params.push(request.target_type);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.query(sql).all(...(params as any[])) as Array<{
      id: number;
      action: string;
      actor: string;
      target_type: string;
      target_id: string;
      details_json: string;
      created_at: string;
    }>;

    const items = rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.actor,
      target_type: row.target_type,
      target_id: row.target_id,
      details: parseJsonSafe(row.details_json),
      created_at: row.created_at,
    }));

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "audit_log_v1",
    });
  }

  projectsStats(request: ProjectsStatsRequest = {}): ApiResponse {
    const startedAt = performance.now();
    const includePrivate = Boolean(request.include_private);
    const visibility = this.visibilityFilterSql("o", includePrivate);
    const platformVisibility = this.platformVisibilityFilterSql("o");

    const rows = this.db
      .query(`
        SELECT
          o.project AS project,
          COUNT(*) AS observations,
          COUNT(DISTINCT o.session_id) AS sessions,
          MAX(o.created_at) AS updated_at
        FROM mem_observations o
        WHERE 1 = 1
        ${platformVisibility}
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
    })).filter((row) => shouldExposeProjectInStats(row.project));

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

  backup(options?: { destDir?: string }): ApiResponse {
    if (!this.db) {
      throw new Error("Backup is only supported in local (SQLite) mode");
    }
    const startedAt = performance.now();
    const resolvedDbPath = resolveHomePath(this.config.dbPath);
    const defaultDestDir = dirname(resolvedDbPath);
    const destDir = options?.destDir ? resolveHomePath(options.destDir) : defaultDestDir;

    ensureDir(destDir);

    // ISO timestamp: 2026-02-26T12-34-56-789Z (colons replaced for filesystem compat)
    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
    const filename = `harness-mem-backup-${ts}.db`;
    const destPath = join(destDir, filename);

    try {
      this.db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeErrorResponse(startedAt, `backup failed: ${message}`, {});
    }

    let size = 0;
    try {
      size = statSync(destPath).size;
    } catch {
      // best effort
    }

    this.writeAuditLog("admin.backup", "backup", destPath, { size_bytes: size });

    return makeResponse(
      startedAt,
      [{ path: destPath, size_bytes: size }],
      {},
      { backup_path: destPath, size_bytes: size }
    );
  }

  reindexVectors(limitInput?: number): ApiResponse {
    const startedAt = performance.now();
    if (this.vectorEngine === "disabled") {
      return makeResponse(startedAt, [], {}, { reindexed: 0, skipped: "vector_disabled" });
    }

    const limit = clampLimit(limitInput, 100, 1, 1000000);

    // Prioritize observations whose vectors are on a legacy model (not the current one).
    // This enables incremental, no-downtime migration: each call processes a batch of
    // stale vectors first, then falls back to all observations if none are stale.
    // Searches continue to serve results from the legacy model during migration.
    const legacyRows = this.db
      .query(`
        SELECT o.id, o.content_redacted, o.created_at
        FROM mem_observations o
        JOIN mem_vectors v ON v.observation_id = o.id
        WHERE v.model != ?
        ORDER BY o.created_at DESC
        LIMIT ?
      `)
      .all(this.vectorModelVersion, limit) as Array<{ id: string; content_redacted: string; created_at: string }>;

    const rows: Array<{ id: string; content_redacted: string; created_at: string }> = legacyRows.length > 0
      ? legacyRows
      : (this.db
          .query(`
            SELECT id, content_redacted, created_at
            FROM mem_observations
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(limit) as Array<{ id: string; content_redacted: string; created_at: string }>);

    // Count total legacy vectors before reindexing for progress reporting
    const beforeCounts = this.db
      .query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN model = ? THEN 1 ELSE 0 END) AS current_count
         FROM mem_vectors`
      )
      .get(this.vectorModelVersion) as { total: number; current_count: number } | null;
    const totalBefore = Number(beforeCounts?.total ?? 0);
    const currentBefore = Number(beforeCounts?.current_count ?? 0);

    let reindexed = 0;
    for (const row of rows) {
      this.upsertVector(row.id, row.content_redacted || "", row.created_at || nowIso());
      reindexed += 1;
    }

    const currentAfter = currentBefore + reindexed;
    const remaining = Math.max(0, totalBefore - currentAfter);
    const pct = totalBefore === 0 ? 100 : Math.round((currentAfter / totalBefore) * 100);

    return makeResponse(
      startedAt,
      [
        {
          reindexed,
          limit,
          total_vectors: totalBefore,
          current_model_vectors: currentAfter,
          legacy_vectors_remaining: remaining,
          progress_pct: pct,
        },
      ],
      { limit },
      {
        vector_engine: this.vectorEngine,
        embedding_provider: this.embeddingProvider.name,
        embedding_provider_model: this.vectorModelVersion,
        embedding_provider_status: this.embeddingHealth.status,
        migration_complete: remaining === 0,
      }
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
    const defaultProject = normalizeProjectName(resolve(this.config.codexProjectRoot));
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
    const project = normalizeProjectName(resolve(this.config.codexProjectRoot));

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
        const result = this.recordEvent(
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
      const result = this.recordEvent(
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
    if (this.geminiIngestTimer) {
      clearInterval(this.geminiIngestTimer);
      this.geminiIngestTimer = null;
    }
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
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

    // Shutdown managed backend (fire-and-forget, best effort)
    if (this.managedBackend) {
      this.managedBackend.shutdown().catch(() => {});
      this.managedBackend = null;
    }

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
  const antigravityLogsRoot = resolveHomePath(
    process.env.HARNESS_MEM_ANTIGRAVITY_LOGS_ROOT || DEFAULT_ANTIGRAVITY_LOGS_ROOT
  );
  const antigravityWorkspaceStorageRoot = resolveHomePath(
    process.env.HARNESS_MEM_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT || DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT
  );
  const geminiIngestIntervalRaw = Number(
    process.env.HARNESS_MEM_GEMINI_INGEST_INTERVAL_MS || DEFAULT_GEMINI_INGEST_INTERVAL_MS
  );
  const geminiBackfillRaw = Number(
    process.env.HARNESS_MEM_GEMINI_BACKFILL_HOURS || DEFAULT_GEMINI_BACKFILL_HOURS
  );
  const searchRankingRaw = (process.env.HARNESS_MEM_SEARCH_RANKING || DEFAULT_SEARCH_RANKING).trim();
  const searchRanking = searchRankingRaw ? searchRankingRaw : DEFAULT_SEARCH_RANKING;
  const embeddingProviderRaw = (process.env.HARNESS_MEM_EMBEDDING_PROVIDER || "fallback").trim().toLowerCase();
  const embeddingProvider = embeddingProviderRaw || "fallback";
  const openaiApiKey = (process.env.HARNESS_MEM_OPENAI_API_KEY || "").trim();
  const openaiEmbedModel = (process.env.HARNESS_MEM_OPENAI_EMBED_MODEL || "text-embedding-3-small").trim();
  const ollamaBaseUrl = (process.env.HARNESS_MEM_OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim();
  const ollamaEmbedModel = (process.env.HARNESS_MEM_OLLAMA_EMBED_MODEL || "nomic-embed-text").trim();
  const consolidationIntervalRaw = Number(process.env.HARNESS_MEM_CONSOLIDATION_INTERVAL_MS || 60000);

  return {
    dbPath,
    bindHost,
    bindPort: Number.isFinite(bindPort) ? bindPort : DEFAULT_BIND_PORT,
    vectorDimension: clampLimit(Number(process.env.HARNESS_MEM_VECTOR_DIM || DEFAULT_VECTOR_DIM), DEFAULT_VECTOR_DIM, 32, 4096),
    embeddingProvider,
    openaiApiKey,
    openaiEmbedModel,
    ollamaBaseUrl,
    ollamaEmbedModel,
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
    antigravityIngestEnabled: envFlag("HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST", false),
    antigravityWorkspaceRoots,
    antigravityLogsRoot,
    antigravityWorkspaceStorageRoot,
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
    geminiIngestEnabled: envFlag("HARNESS_MEM_ENABLE_GEMINI_INGEST", true),
    geminiEventsPath: resolveHomePath(process.env.HARNESS_MEM_GEMINI_EVENTS_PATH || DEFAULT_GEMINI_EVENTS_PATH),
    geminiIngestIntervalMs: clampLimit(
      geminiIngestIntervalRaw,
      DEFAULT_GEMINI_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    geminiBackfillHours: clampLimit(geminiBackfillRaw, DEFAULT_GEMINI_BACKFILL_HOURS, 1, 24 * 365),
    searchRanking,
    searchExpandLinks: envFlag("HARNESS_MEM_SEARCH_EXPAND_LINKS", DEFAULT_SEARCH_EXPAND_LINKS),
    rerankerEnabled: envFlag("HARNESS_MEM_RERANKER_ENABLED", false),
    consolidationEnabled: envFlag("HARNESS_MEM_CONSOLIDATION_ENABLED", true),
    consolidationIntervalMs: clampLimit(consolidationIntervalRaw, 60000, 5000, 600000),
    backendMode: parseBackendMode(process.env.HARNESS_MEM_BACKEND_MODE),
    managedEndpoint: (process.env.HARNESS_MEM_MANAGED_ENDPOINT || "").trim() || undefined,
    managedApiKey: (process.env.HARNESS_MEM_MANAGED_API_KEY || "").trim() || undefined,
    resumePackMaxTokens: (() => {
      const raw = Number(process.env.HARNESS_MEM_RESUME_PACK_MAX_TOKENS);
      return Number.isFinite(raw) && raw > 0 ? raw : undefined;
    })(),
  };
}

function parseBackendMode(value: string | undefined): "local" | "managed" | "hybrid" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "managed" || normalized === "hybrid") return normalized;
  return "local";
}
