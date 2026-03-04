/**
 * core-utils.ts
 *
 * サブモジュール間で横断的に使われる純粋ユーティリティ関数。
 * this を使わない pure function のみ定義する。
 * DB 依存がある関数は db を引数で受け取る。
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import type { ApiResponse, Config } from "./types.js";

// ---------------------------------------------------------------------------
// 時刻・基本ユーティリティ
// ---------------------------------------------------------------------------

export function nowIso(): string {
  return new Date().toISOString();
}

export function resolveHomePath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
    return resolve(join(homeDir, inputPath.slice(1)));
  }
  return resolve(inputPath);
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 数値を [min, max] の範囲に丸める。
 * デフォルト値は呼び出し側で明示すること。
 */
export function clampLimit(input: unknown, fallback: number, min: number, max: number): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// JSON パース
// ---------------------------------------------------------------------------

export function parseJsonSafe(value: unknown): Record<string, unknown> {
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

export function toArraySafe(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function parseArrayJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
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

// ---------------------------------------------------------------------------
// ApiResponse 生成
// ---------------------------------------------------------------------------

/**
 * サブモジュール用の成功レスポンスを生成する。
 * (harness-mem-core.ts 内の makeResponse とは latency_ms の計算式が異なる)
 */
export function makeResponse(
  startedAt: number,
  items: unknown[],
  filters: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): ApiResponse {
  const latency = performance.now() - startedAt;
  return {
    ok: true,
    source: "core",
    items,
    meta: {
      count: items.length,
      latency_ms: Math.round(latency * 100) / 100,
      sla_latency_ms: 200,
      filters,
      ranking: "default",
      ...extra,
    },
  };
}

export function makeErrorResponse(
  startedAt: number,
  message: string,
  filters: Record<string, unknown>
): ApiResponse {
  const latency = performance.now() - startedAt;
  return {
    ok: false,
    source: "core",
    items: [],
    meta: {
      count: 0,
      latency_ms: Math.round(latency * 100) / 100,
      sla_latency_ms: 200,
      filters,
      ranking: "error",
    },
    error: message,
  };
}

// ---------------------------------------------------------------------------
// 全文検索クエリ生成
// ---------------------------------------------------------------------------

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

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 4096);
}

export function buildFtsQuery(query: string): string {
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

  // AND-first: 全トークン一致を最優先、個別トークン+同義語でフォールバック
  const andClause = escaped.map((t) => `"${t}"`).join(" AND ");
  const orTokens = escaped.map((t) => `"${t}"`);

  // 同義語・バイグラムで候補拡張
  for (const token of escaped) {
    const synonyms = SYNONYM_MAP[token];
    if (synonyms) {
      for (const synonym of synonyms) {
        orTokens.push(`"${synonym}"`);
      }
    }
  }
  for (let i = 0; i < escaped.length - 1; i += 1) {
    orTokens.push(`"${escaped[i]} ${escaped[i + 1]}"`);
  }

  // AND一致 > 個別トークン一致（BM25が自動的にAND一致を高スコアにする）
  return `(${andClause}) OR ${orTokens.join(" OR ")}`;
}

// ---------------------------------------------------------------------------
// プライバシーフィルタ SQL
// ---------------------------------------------------------------------------

/**
 * 観察のプライバシータグに基づいて除外条件を生成する純粋関数。
 * alias: SQL テーブルエイリアス ("o" 等)
 * includePrivate: true の場合は空文字列を返す（フィルタなし）
 */
export function visibilityFilterSql(alias: string, includePrivate: boolean): string {
  if (includePrivate) {
    return "";
  }

  // alias はコードパス内部で固定値 ("o" 等) が渡されるが、安全のためバリデーション
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid SQL alias: ${alias}`);
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

// ---------------------------------------------------------------------------
// ベクトル検索ユーティリティ
// ---------------------------------------------------------------------------

export function cosineSimilarity(lhs: number[], rhs: number[]): number {
  const dim = Math.min(lhs.length, rhs.length);
  if (dim === 0) return 0;

  let dot = 0;
  let lhsNorm = 0;
  let rhsNorm = 0;
  for (let i = 0; i < dim; i += 1) {
    dot += lhs[i] * rhs[i];
    lhsNorm += lhs[i] * lhs[i];
    rhsNorm += rhs[i] * rhs[i];
  }

  if (lhsNorm === 0 || rhsNorm === 0) return 0;
  return dot / (Math.sqrt(lhsNorm) * Math.sqrt(rhsNorm));
}

export function normalizeScoreMap(raw: Map<string, number>): Map<string, number> {
  if (raw.size === 0) return new Map<string, number>();

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

export function hasPrivateVisibilityTag(tags: string[]): boolean {
  return tags.some((tag) => {
    const normalized = tag.toLowerCase();
    return normalized === "private" || normalized === "sensitive";
  });
}

export interface RankingWeights {
  lexical: number;
  vector: number;
  recency: number;
  tag_boost: number;
  importance: number;
  graph: number;
}

export function normalizeWeights(weights: RankingWeights): RankingWeights {
  const total =
    weights.lexical +
    weights.vector +
    weights.recency +
    weights.tag_boost +
    weights.importance +
    weights.graph;
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

export interface VectorSearchResult {
  scores: Map<string, number>;
  coverage: number;
  migrationWarning?: string;
}

export interface SearchCandidate {
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

export const EVENT_TYPE_IMPORTANCE: Record<string, number> = {
  checkpoint: 0.9,
  session_end: 0.8,
  tool_use: 0.5,
  user_prompt: 0.4,
  session_start: 0.2,
};

export function recencyScore(createdAt: string): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  const ageMs = Math.max(0, Date.now() - created);
  const ageHours = ageMs / (1000 * 60 * 60);
  const envDays = Number(process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS);
  const halfLifeDays = Number.isFinite(envDays) && envDays > 0 ? envDays : 14;
  const halfLifeHours = 24 * halfLifeDays;
  return Math.exp(-ageHours / halfLifeHours);
}

export function normalizeVectorDimension(vector: number[], dimension: number): number[] {
  const normalized = vector.filter((value): value is number => typeof value === "number");
  if (normalized.length === dimension) return normalized;
  if (normalized.length > dimension) return normalized.slice(0, dimension);
  return [...normalized, ...new Array<number>(dimension - normalized.length).fill(0)];
}

export function generateEventId(): string {
  const ts = Date.now().toString(36).padStart(10, "0");
  const random = crypto.getRandomValues(new Uint8Array(8));
  const rand = [...random].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${ts}${rand}`;
}

export function isPrivateTag(tags: string[]): boolean {
  return tags.includes("private") || tags.includes("sensitive");
}

// ---------------------------------------------------------------------------
// プラットフォームごとのデフォルト定数
// ---------------------------------------------------------------------------

export const DEFAULT_OPENCODE_STORAGE_ROOT = "~/.local/share/opencode/storage";
export const DEFAULT_OPENCODE_DB_PATH = "~/.local/share/opencode/opencode.db";
export const DEFAULT_OPENCODE_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_OPENCODE_BACKFILL_HOURS = 24;
export const DEFAULT_CURSOR_EVENTS_PATH = "~/.harness-mem/adapters/cursor/events.jsonl";
export const DEFAULT_CURSOR_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_CURSOR_BACKFILL_HOURS = 24;
export const DEFAULT_ANTIGRAVITY_LOGS_ROOT = "~/Library/Application Support/Antigravity/logs";
export const DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT = "~/Library/Application Support/Antigravity/User/workspaceStorage";
export const DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_ANTIGRAVITY_BACKFILL_HOURS = 24;
export const DEFAULT_GEMINI_EVENTS_PATH = "~/.harness-mem/adapters/gemini/events.jsonl";
export const DEFAULT_GEMINI_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_GEMINI_BACKFILL_HOURS = 24;

// ---------------------------------------------------------------------------
// ワークスペース解決ユーティリティ
// ---------------------------------------------------------------------------

export function fileUriToPath(uriOrPath: string): string {
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

export function resolveWorkspaceRootFromWorkspaceFile(workspacePath: string): string {
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

export function resolveWorkspaceRootFromWorkspaceJson(workspaceJsonPath: string): string {
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

// ---------------------------------------------------------------------------
// セッション保証ユーティリティ
// ---------------------------------------------------------------------------

export function ensureSession(
  db: Database,
  sessionId: string,
  platform: string,
  project: string,
  ts: string,
  correlationId?: string | null,
  userId?: string | null,
  teamId?: string | null
): void {
  const current = new Date().toISOString();
  const resolvedUserId = userId ?? "default";
  const resolvedTeamId = teamId ?? null;
  db.query(`
    INSERT INTO mem_sessions(
      session_id, platform, project, started_at, correlation_id, user_id, team_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      started_at = CASE
        WHEN mem_sessions.started_at <= excluded.started_at THEN mem_sessions.started_at
        ELSE excluded.started_at
      END,
      correlation_id = COALESCE(mem_sessions.correlation_id, excluded.correlation_id),
      updated_at = excluded.updated_at
  `).run(sessionId, platform, project, ts, correlationId ?? null, resolvedUserId, resolvedTeamId, current, current);
}

// ---------------------------------------------------------------------------
// 観察ロード
// ---------------------------------------------------------------------------

/**
 * 観察 ID の配列から観察データを一括ロードする。
 * db を引数で受け取ることで pure function に近い形で使える。
 */
export function loadObservations(db: Database, ids: string[]): Map<string, Record<string, unknown>> {
  if (ids.length === 0) {
    return new Map<string, Record<string, unknown>>();
  }

  // SQLite のバインド変数上限を考慮し、バッチ処理で安全に取得
  const MAX_BATCH = 500;
  const mapped = new Map<string, Record<string, unknown>>();

  for (let offset = 0; offset < ids.length; offset += MAX_BATCH) {
    const batch = ids.slice(offset, offset + MAX_BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db
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
            o.memory_type,
            o.tags_json,
            o.privacy_tags_json,
            o.signal_score,
            o.access_count,
            o.last_accessed_at,
            o.created_at,
            o.updated_at,
            e.event_type
          FROM mem_observations o
          LEFT JOIN mem_events e ON e.event_id = o.event_id
          WHERE o.id IN (${placeholders})
        `
      )
      .all(...batch) as Array<Record<string, unknown>>;

    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : "";
      if (id) {
        mapped.set(id, row);
      }
    }
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// getConfig — 環境変数から Config を構築するファクトリ
// (harness-mem-core.ts から分離してテスト依存を解消)
// ---------------------------------------------------------------------------

export const DEFAULT_DB_PATH = "~/.harness-mem/harness-mem.db";
export const DEFAULT_BIND_HOST = "127.0.0.1";
export const DEFAULT_BIND_PORT = 37888;
export const DEFAULT_VECTOR_DIM = 256;
export const DEFAULT_CODEX_SESSIONS_ROOT = "~/.codex/sessions";
export const DEFAULT_CODEX_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_CODEX_BACKFILL_HOURS = 24;
export const DEFAULT_SEARCH_RANKING = "hybrid_v3";
export const DEFAULT_SEARCH_EXPAND_LINKS = true;

export function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no");
}

export function parseBackendMode(value: string | undefined): "local" | "managed" | "hybrid" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "managed" || normalized === "hybrid") return normalized;
  return "local";
}

export function getConfig(): Config {
  const dbPath = process.env.HARNESS_MEM_DB_PATH || DEFAULT_DB_PATH;
  const rawBindHost = (process.env.HARNESS_MEM_HOST || DEFAULT_BIND_HOST).trim();
  // リモートバインドを許可する（起動時の安全チェックは index.ts / startHarnessMemServer 側で実施）
  const bindHost = rawBindHost || DEFAULT_BIND_HOST;
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
    // TEAM-003: ユーザー・チーム識別
    userId: (process.env.HARNESS_MEM_USER_ID || "").trim() || undefined,
    teamId: (process.env.HARNESS_MEM_TEAM_ID || "").trim() || undefined,
    // GRAPH-003: グラフ探索最大ホップ数
    graphMaxHops: (() => {
      const raw = Number(process.env.HARNESS_MEM_GRAPH_MAX_HOPS);
      if (!Number.isFinite(raw) || raw <= 0) return undefined;
      return Math.min(Math.max(Math.floor(raw), 1), 5);
    })(),
  };
}
