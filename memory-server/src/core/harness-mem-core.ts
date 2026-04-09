import { Database, type SQLQueryBindings } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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
import { parseCodexSessionsChunk } from "../ingest/codex-sessions";
import {
  resolveVectorEngine,
  type VectorEngine,
} from "../vector/providers";
import {
  createEmbeddingProviderRegistry,
} from "../embedding/registry";
import { expandQuery } from "../embedding/query-expander";
import {
  type EmbeddingProvider,
  type AdaptiveRoute,
  type EmbeddingCacheStats,
  type EmbeddingHealth,
  type QueryAnalysis,
} from "../embedding/types";
import { createRerankerRegistry } from "../rerank/registry";
import {
  type Reranker,
} from "../rerank/types";
import { llmRerank, llmNoMemoryCheck, buildLlmRerankerConfigFromEnv } from "../rerank/llm-reranker.js";
import {
  enqueueConsolidationJob,
  runConsolidationOnce,
  type ConsolidationRunOptions,
  type ConsolidationRunStats,
} from "../consolidation/worker";
import { ManagedBackend, type ManagedBackendStatus } from "../projector/managed-backend";
import { collectEnvironmentSnapshot, type EnvironmentSnapshot } from "../system-environment/collector";
import { TtlCache } from "../system-environment/cache";
import { SessionManager } from "./session-manager";
import { EventRecorder } from "./event-recorder";
import { ObservationStore } from "./observation-store";
import { SqliteObservationRepository } from "../db/repositories/SqliteObservationRepository.js";
import { IngestCoordinator } from "./ingest-coordinator";
import { ConfigManager } from "./config-manager";
import { AnalyticsService } from "./analytics";
import type { UsageParams, UsageStats, EntityParams, EntityStats, TimelineParams, TimelineStats, OverviewParams, OverviewStats } from "./analytics";
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
  DEFAULT_SEARCH_RANKING,
  ensureDir,
  ensureSession,
  envFlag,
  fileUriToPath,
  makeErrorResponse,
  makeResponse,
  normalizeVectorDimension,
  nowIso,
  parseBackendMode,
  resolveHomePath,
  resolveWorkspaceRootFromWorkspaceFile,
  resolveWorkspaceRootFromWorkspaceJson,
} from "./core-utils.js";
import type {
  ApiMeta,
  ApiResponse,
  AuditLogRequest,
  BackupRequest,
  Config,
  ConsolidationRunRequest,
  CreateLinkRequest,
  EventEnvelope,
  FeedRequest,
  FinalizeSessionRequest,
  GetLinksRequest,
  GetObservationsRequest,
  ImportJobStatusRequest,
  ProjectsStatsRequest,
  FactHistoryRequest,
  RecordCheckpointRequest,
  ResumePackRequest,
  SearchFacetsRequest,
  SearchRequest,
  SessionsListRequest,
  SessionThreadRequest,
  StreamEvent,
  TimelineRequest,
  VerifyImportRequest,
} from "./types.js";

export type {
  ApiMeta,
  ApiResponse,
  AuditLogRequest,
  BackupRequest,
  Config,
  ConsolidationRunRequest,
  CreateLinkRequest,
  EventEnvelope,
  FactHistoryRequest,
  FeedRequest,
  FinalizeSessionRequest,
  GetLinksRequest,
  GetObservationsRequest,
  ImportJobStatusRequest,
  MemoryType,
  ProjectsStatsRequest,
  RecordCheckpointRequest,
  ResumePackRequest,
  SearchFacetsRequest,
  SearchRequest,
  SessionsListRequest,
  SessionThreadRequest,
  StreamEvent,
  TimelineRequest,
  VerifyImportRequest,
} from "./types.js";
import { getDecayTier, getDecayMultiplier } from "./adaptive-decay.js";

const VECTOR_MODEL_VERSION = "local-hash-v3";
const HEARTBEAT_FILE = "~/.harness-mem/daemon.heartbeat";
const DEFAULT_ENVIRONMENT_CACHE_TTL_MS = 20_000;
type EmbeddingPrimeMode = "passage" | "query";
type EmbeddingReadinessState = "not_required" | "ready" | "warming" | "failed";

interface ResolvedEmbeddingVariant {
  model: string;
  vector: number[];
}

interface ResolvedEmbeddingVariants {
  route: AdaptiveRoute | null;
  analysis: QueryAnalysis | null;
  primary: ResolvedEmbeddingVariant;
  secondary: ResolvedEmbeddingVariant | null;
}

interface EmbeddingReadiness {
  required: boolean;
  ready: boolean;
  state: EmbeddingReadinessState;
  retryable: boolean;
  providerStatus: EmbeddingHealth["status"];
  details: string;
}

type EmbeddingProviderError = Error & {
  code?: string;
  retryable?: boolean;
};

export class EmbeddingReadinessError extends Error {
  readonly readiness: EmbeddingReadiness;
  readonly code: string;

  constructor(message: string, readiness: EmbeddingReadiness, code: string = readiness.state) {
    super(message);
    this.name = "EmbeddingReadinessError";
    this.readiness = readiness;
    this.code = code;
  }
}

// getConfig は core-utils.ts から re-export
export { getConfig } from "./core-utils.js";

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

function resolveDirectGitWorkspaceRoot(existingPath: string): string | null {
  const cursor = normalizePathLike(existingPath);
  if (!cursor.startsWith("/")) {
    return null;
  }

  const gitMarker = join(cursor, ".git");
  if (!existsSync(gitMarker)) {
    return null;
  }

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

function normalizeExplicitProjectPath(project: string): string {
  const normalized = normalizePathLike(project.trim());
  if (!normalized) {
    return "";
  }
  const resolved = realpathOrNormalized(normalized);
  return resolveDirectGitWorkspaceRoot(resolved) || resolved;
}

function resolveWorkspaceRoot(existingPath: string, options: ProjectNormalizationOptions = {}): string | null {
  const directGitRoot = resolveDirectGitWorkspaceRoot(existingPath);
  if (directGitRoot) {
    return normalizePathLike(directGitRoot);
  }
  const preferredRoot = resolvePreferredWorkspaceRoot(existingPath, options.preferredRoots || []);
  if (preferredRoot) {
    return normalizePathLike(resolveDirectGitWorkspaceRoot(preferredRoot) || preferredRoot);
  }
  return null;
}

function normalizeProjectName(name: string, options: ProjectNormalizationOptions = {}): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("project name must not be empty");
  // trailing slashを除去、normalize path
  const normalized = normalizePathLike(trimmed);
  // パスとして存在する場合はsymlink解決してbasename相当の正規パスを返す
  try {

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


/**
 * Compute Antigravity workspace roots for health diagnostics.
 * Mirrors IngestCoordinator's logic without duplicating it as class methods.
 * Priority: configured roots > storage discovery > codexProjectRoot fallback.
 */
function computeAntigravityWorkspaceRoots(config: {
  antigravityWorkspaceRoots?: string[];
  antigravityWorkspaceStorageRoot?: string;
  codexProjectRoot?: string;
}): string[] {
  // 1. Explicitly configured roots
  const configuredRoots = (Array.isArray(config.antigravityWorkspaceRoots) ? config.antigravityWorkspaceRoots : [])
    .map((root) => (typeof root === "string" ? root.trim() : ""))
    .filter((root) => root.length > 0)
    .map((root) => resolveHomePath(root));
  if (configuredRoots.length > 0) {
    return [...new Set(configuredRoots)].sort((lhs, rhs) => lhs.localeCompare(rhs));
  }

  // 2. Discover from workspace storage directory
  const storageRoot = resolveHomePath(config.antigravityWorkspaceStorageRoot || DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT);
  if (existsSync(storageRoot)) {
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = readdirSync(storageRoot, { withFileTypes: true, encoding: "utf8" }) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      entries = [];
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
    const unique = [...new Set(discovered)].sort((lhs, rhs) => lhs.localeCompare(rhs));
    if (unique.length > 0) return unique;
  }

  // 3. Fallback to codexProjectRoot or cwd
  const fallbackRoot = resolve(config.codexProjectRoot || process.cwd());
  if (fallbackRoot && existsSync(fallbackRoot)) {
    return [fallbackRoot];
  }

  return [];
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
  private shuttingDown = false;
  private readonly projectNormalizationRoots: string[];
  private readonly environmentSnapshotCache = new TtlCache<EnvironmentSnapshot>(DEFAULT_ENVIRONMENT_CACHE_TTL_MS);

  // ---------------------------------------------------------------------------
  // モジュールインスタンス (facade パターン)
  // コンストラクタ末尾で initModules() を呼び出して初期化する
  // ---------------------------------------------------------------------------
  private sessionMgr!: SessionManager;
  private eventRec!: EventRecorder;
  private obsStore!: ObservationStore;
  private ingestCoord!: IngestCoordinator;
  private cfgMgr!: ConfigManager;
  private analyticsSvc!: AnalyticsService;

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

    this.initManagedBackend();
    this.initModules();
    const shouldStartWorkers = this.config.backgroundWorkersEnabled ?? (process.env.NODE_ENV !== "test");
    if (shouldStartWorkers) {
      this.startBackgroundWorkers();
    }
  }

  /** モジュールインスタンスを初期化する (コンストラクタ末尾で呼ぶ) */
  private initModules(): void {
    this.eventRec = new EventRecorder({
      db: this.db,
      config: this.config,
      normalizeProject: (p) => this.normalizeProjectInput(p),
      isAbsoluteProjectPath: (project) => isAbsoluteProjectPath(project),
      extendProjectNormalizationRoots: (candidates) => this.extendProjectNormalizationRoots(candidates),
      getManagedRequired: () => this.managedRequired,
      isManagedConnected: () => this.managedBackend?.isConnected() ?? false,
      replicateManagedEvent: (event) => { if (this.managedBackend) this.managedBackend.replicateEvent(event); },
      getVectorEngine: () => this.vectorEngine,
      getVecTableReady: () => this.vecTableReady,
      setVecTableReady: (value) => { this.vecTableReady = value; },
      embedContent: (content) => this.embedContentSync(content, "passage"),
      buildPassageEmbeddings: (content) => this.resolveEmbeddings(content, "passage"),
      getEmbeddingProviderName: () => this.embeddingProvider.name,
      getEmbeddingHealthStatus: () => this.embeddingHealth.status,
      getVectorModelVersion: () => this.vectorModelVersion,
      refreshEmbeddingHealth: () => this.refreshEmbeddingHealth(),
    });

    this.sessionMgr = new SessionManager({
      db: this.db,
      config: this.config,
      normalizeProject: (p) => this.normalizeProjectInput(p),
      canonicalizeProject: (p) => this.getCanonicalProjectName(p),
      expandProjectSelection: (project, scope) => this.expandProjectSelection(project, scope),
      platformVisibilityFilterSql: (alias) => this.platformVisibilityFilterSql(alias),
      recordEvent: (event) => this.recordEvent(event),
      appendStreamEvent: (type, data) => this.eventRec.appendStreamEvent(type, data),
      enqueueConsolidation: (proj, sess, reason) => this.enqueueConsolidation(proj, sess, reason),
    });

    this.obsStore = new ObservationStore({
      db: this.db,
      repo: new SqliteObservationRepository(this.db),
      config: this.config,
      ftsEnabled: this.ftsEnabled,
      normalizeProject: (p) => this.normalizeProjectInput(p),
      canonicalizeProject: (p) => this.getCanonicalProjectName(p),
      expandProjectSelection: (project, scope) => this.expandProjectSelection(project, scope),
      platformVisibilityFilterSql: (alias) => this.platformVisibilityFilterSql(alias),
      writeAuditLog: (action, targetType, targetId, details) =>
        this.writeAuditLog(action, targetType, targetId, details),
      getVectorEngine: () => this.vectorEngine,
      getVectorModelVersion: () => this.vectorModelVersion,
      vectorDimension: this.config.vectorDimension,
      getVecTableReady: () => this.vecTableReady,
      setVecTableReady: (value) => { this.vecTableReady = value; },
      embedContent: (content) => this.embedContentSync(content, "query"),
      buildQueryEmbeddings: (content) => this.resolveEmbeddings(content, "query"),
      refreshEmbeddingHealth: () => this.refreshEmbeddingHealth(),
      getEmbeddingProviderName: () => this.embeddingProvider.name,
      embeddingProviderModel: this.embeddingProvider.model,
      getEmbeddingHealthStatus: () => this.embeddingHealth.status,
      getRerankerEnabled: () => this.rerankerEnabled,
      getReranker: () => this.reranker,
      managedShadowRead: this.managedBackend
        ? (query, ids, opts) => this.managedBackend!.shadowRead(query, ids, opts)
        : null,
      searchRanking: this.config.searchRanking || DEFAULT_SEARCH_RANKING,
      searchExpandLinks: this.config.searchExpandLinks !== false,
    });

    this.ingestCoord = new IngestCoordinator({
      db: this.db,
      config: this.config,
      recordEvent: (event, options) => this.recordEvent(event, options),
      upsertSessionSummary: (sessionId, platform, project, summary, endedAt, summaryMode) =>
        this.upsertSessionSummary(sessionId, platform, project, summary, endedAt, summaryMode),
      heartbeatPath: this.heartbeatPath,
      isShuttingDown: () => this.shuttingDown,
      processRetryQueue: (force) => this.processRetryQueue(force),
      runConsolidation: ({ reason, limit }) =>
        this.runConsolidation({ reason, limit }).then(() => undefined),
    });

    this.cfgMgr = new ConfigManager({
      db: this.db,
      config: this.config,
      canonicalizeProject: (project) => this.getCanonicalProjectName(project),
      doHealth: () => this.health(),
      doMetrics: () => this.metrics(),
      doEnvironmentSnapshot: () => this.environmentSnapshot(),
      doRunConsolidation: (req) => this.runConsolidation(req),
      doGetManagedStatus: () => this.getManagedStatus(),
      doShutdown: (signal) => this.shutdown(signal),
      isConsolidationEnabled: () => this.config.consolidationEnabled !== false,
      getConsolidationIntervalMs: () => clampLimit(Number(this.config.consolidationIntervalMs || 60000), 60000, 5000, 600000),
      writeAuditLog: (action, targetType, targetId, details) => this.writeAuditLog(action, targetType, targetId, details ?? {}),
      getVectorEngine: () => this.vectorEngine,
      getVectorModelVersion: () => this.vectorModelVersion,
      embeddingProviderName: this.embeddingProvider.name,
      getEmbeddingHealthStatus: () => this.embeddingHealth.status,
      reindexObservationVector: (id, content, createdAt) =>
        this.eventRec.reindexObservationVector(id, content, createdAt),
      isAntigravityIngestEnabled: () => this.config.antigravityIngestEnabled !== false,
    });

    this.analyticsSvc = new AnalyticsService({
      db: {
        query: (sql: string, params?: unknown[]) => ({
          all: () => this.db.query(sql).all(...((params ?? []) as SQLQueryBindings[])),
        }),
      },
    });
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
    const candidates = [this.config.codexProjectRoot, this.config.codexSessionsRoot, process.cwd()];
    const roots: string[] = [];
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) {
        continue;
      }
      const resolved = resolveHomePath(candidate);
      try {
        const absoluteRoot = normalizePathLike(realpathSync(resolve(resolved)));
        roots.push(absoluteRoot);
        roots.push(normalizeProjectName(absoluteRoot));
      } catch {
        try {
          roots.push(normalizeProjectName(resolve(resolved)));
        } catch {
          // ignore invalid candidate
        }
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
      const absoluteCandidate = normalizePathLike(resolveHomePath(candidate.trim()));
      if (isAbsoluteProjectPath(absoluteCandidate)) {
        merged.add(absoluteCandidate);
      }
      let normalized = absoluteCandidate;
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

  private canonicalizeProjectName(project: string): string {
    const trimmed = project.trim();
    if (!trimmed) {
      return "";
    }

    const scopeIndex = trimmed.indexOf("::");
    if (scopeIndex > 0) {
      return this.canonicalizeProjectName(trimmed.slice(0, scopeIndex));
    }

    const normalized = normalizePathLike(trimmed);
    if (normalized.includes("/") || /^[A-Za-z]:\//.test(normalized)) {
      const resolved = realpathOrNormalized(normalized);
      const directGitRoot = resolveDirectGitWorkspaceRoot(resolved);
      if (directGitRoot) {
        return basename(normalizePathLike(directGitRoot)) || directGitRoot;
      }
      return basename(resolved) || resolved;
    }

    return normalized;
  }

  private isExplicitRawProjectSelection(project: string): boolean {
    const normalized = normalizePathLike(project.trim());
    if (!normalized) {
      return false;
    }
    return normalized.includes("/") || normalized.includes("::") || /^[A-Za-z]:\//.test(normalized);
  }

  private loadDistinctProjects(scope: "observations" | "sessions" = "observations"): string[] {
    const rows = scope === "sessions"
      ? this.db
          .query(`
            SELECT DISTINCT project
            FROM (
              SELECT project FROM mem_sessions
              UNION
              SELECT project FROM mem_observations
            )
            WHERE project IS NOT NULL AND TRIM(project) <> ''
          `)
          .all() as Array<{ project: string }>
      : this.db
          .query(`
            SELECT DISTINCT project
            FROM mem_observations
            WHERE project IS NOT NULL AND TRIM(project) <> ''
          `)
          .all() as Array<{ project: string }>;

    return rows
      .map((row) => (typeof row.project === "string" ? row.project.trim() : ""))
      .filter(Boolean);
  }

  public getCanonicalProjectName(project: string): string {
    return this.canonicalizeProjectName(project);
  }

  public expandProjectSelection(
    project: string,
    scope: "observations" | "sessions" = "observations"
  ): string[] {
    const trimmed = project.trim();
    if (!trimmed) {
      return [];
    }

    if (this.isExplicitRawProjectSelection(trimmed)) {
      if (trimmed.includes("::")) {
        return [normalizePathLike(trimmed)];
      }
      try {
        return [this.normalizeProjectInput(trimmed)];
      } catch {
        return [normalizeExplicitProjectPath(trimmed)];
      }
    }

    const canonical = this.canonicalizeProjectName(trimmed);
    const members = this.loadDistinctProjects(scope)
      .filter((candidate) => this.canonicalizeProjectName(candidate) === canonical)
      .sort((lhs, rhs) => lhs.localeCompare(rhs));

    if (members.length > 0) {
      return members;
    }

    try {
      return [this.normalizeProjectInput(trimmed)];
    } catch {
      return [normalizePathLike(trimmed)];
    }
  }

  public projectMatchesSelection(selection: string, project: string): boolean {
    const selected = selection.trim();
    const candidate = project.trim();
    if (!selected || !candidate) {
      return false;
    }

    if (this.isExplicitRawProjectSelection(selected)) {
      if (selected.includes("::")) {
        return normalizePathLike(selected) === normalizePathLike(candidate);
      }
      return normalizeExplicitProjectPath(selected) === normalizeExplicitProjectPath(candidate);
    }

    return this.canonicalizeProjectName(selected) === this.canonicalizeProjectName(candidate);
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
      localModelId: this.config.embeddingModel,
      localModelsDir: this.config.localModelsDir,
      dimension: this.config.vectorDimension,
      openaiApiKey: this.config.openaiApiKey,
      openaiEmbedModel: this.config.openaiEmbedModel,
      ollamaBaseUrl: this.config.ollamaBaseUrl,
      ollamaEmbedModel: this.config.ollamaEmbedModel,
      proApiKey: this.config.proApiKey,
      proApiUrl: this.config.proApiUrl,
      adaptiveJaThreshold: this.config.adaptiveJaThreshold,
      adaptiveCodeThreshold: this.config.adaptiveCodeThreshold,
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

  private embeddingProviderUsesLocalModels(): boolean {
    return this.embeddingProvider.name === "local" || this.embeddingProvider.usesLocalModels === true;
  }

  private getEmbeddingReadiness(): EmbeddingReadiness {
    this.refreshEmbeddingHealth();

    const requiresReadiness =
      this.embeddingProviderUsesLocalModels() ||
      !!this.embeddingProvider.ready;

    if (!requiresReadiness) {
      return {
        required: false,
        ready: true,
        state: "not_required",
        retryable: false,
        providerStatus: this.embeddingHealth.status,
        details: this.embeddingHealth.details,
      };
    }

    if (this.embeddingHealth.status === "healthy") {
      return {
        required: true,
        ready: true,
        state: "ready",
        retryable: false,
        providerStatus: this.embeddingHealth.status,
        details: this.embeddingHealth.details,
      };
    }

    const details = this.embeddingHealth.details || "local embedding provider is not ready";
    const lowered = details.toLowerCase();
    const failed =
      lowered.includes("failed to load") ||
      lowered.includes("failed to initialize") ||
      lowered.includes("inference failed");

    return {
      required: true,
      ready: false,
      state: failed ? "failed" : "warming",
      retryable: !failed,
      providerStatus: this.embeddingHealth.status,
      details,
    };
  }

  private createEmbeddingReadinessError(
    context: string,
    error: unknown,
    override?: Partial<EmbeddingReadiness> & { code?: string }
  ): EmbeddingReadinessError {
    const providerError = (error instanceof Error ? error : new Error(String(error))) as EmbeddingProviderError;
    const readinessBase = this.getEmbeddingReadiness();
    const readiness: EmbeddingReadiness = {
      ...readinessBase,
      ...override,
      required: override?.required ?? readinessBase.required,
      ready: override?.ready ?? readinessBase.ready,
      state: override?.state ?? readinessBase.state,
      retryable: override?.retryable ?? providerError.retryable ?? readinessBase.retryable,
      providerStatus: override?.providerStatus ?? readinessBase.providerStatus,
      details: override?.details ?? providerError.message ?? readinessBase.details,
    };
    const code = override?.code ?? providerError.code ?? readiness.state;
    return new EmbeddingReadinessError(`${context}: ${readiness.details}`, readiness, code);
  }

  private ensureEmbeddingReadyForSync(mode: EmbeddingPrimeMode): void {
    const readiness = this.getEmbeddingReadiness();
    if (!readiness.required || readiness.ready) {
      return;
    }

    throw new EmbeddingReadinessError(
      mode === "query"
        ? "search embedding is not ready yet; retry after /health/ready reports ready"
        : "write embedding is not ready yet; retry after /health/ready reports ready",
      readiness
    );
  }

  private embedContentSync(content: string, mode: EmbeddingPrimeMode): number[] {
    try {
      this.ensureEmbeddingReadyForSync(mode);
      if (mode === "query" && typeof this.embeddingProvider.embedQuery === "function") {
        return this.embeddingProvider.embedQuery(content || "");
      }
      return this.embeddingProvider.embed(content || "");
    } catch (error) {
      throw this.createEmbeddingReadinessError(
        mode === "query" ? "search embedding is unavailable" : "write embedding is unavailable",
        error,
        {
          ready: false,
          retryable: true,
        }
      );
    }
  }

  private resolveEmbeddings(text: string, mode: EmbeddingPrimeMode): ResolvedEmbeddingVariants {
    const normalized = text || "";
    const primaryVector = normalizeVectorDimension(
      this.embedContentSync(normalized, mode),
      this.config.vectorDimension
    );
    const route =
      typeof this.embeddingProvider.routeFor === "function"
        ? this.embeddingProvider.routeFor(normalized)
        : null;
    const analysis =
      typeof this.embeddingProvider.analyze === "function"
        ? this.embeddingProvider.analyze(normalized)
        : null;
    const primaryModel =
      typeof this.embeddingProvider.primaryModelFor === "function"
        ? this.embeddingProvider.primaryModelFor(normalized)
        : this.vectorModelVersion;

    let secondary: ResolvedEmbeddingVariant | null = null;
    if (typeof this.embeddingProvider.embedSecondary === "function") {
      const secondaryVector = this.embeddingProvider.embedSecondary(normalized, mode);
      if (secondaryVector && secondaryVector.length > 0) {
        secondary = {
          model:
            typeof this.embeddingProvider.secondaryModelFor === "function"
              ? this.embeddingProvider.secondaryModelFor(normalized) || this.vectorModelVersion
              : this.vectorModelVersion,
          vector: normalizeVectorDimension(secondaryVector, this.config.vectorDimension),
        };
      }
    }

    return {
      route,
      analysis,
      primary: {
        model: primaryModel,
        vector: primaryVector,
      },
      secondary,
    };
  }

  private getQueryPrimeVariants(query: string): string[] {
    const normalized = query || "";
    if (
      this.embeddingProvider.name !== "adaptive" ||
      typeof this.embeddingProvider.routeFor !== "function"
    ) {
      return [normalized];
    }

    try {
      const expanded = expandQuery(normalized, this.embeddingProvider.routeFor(normalized));
      return [...new Set([expanded.original, ...expanded.expanded].filter(Boolean))];
    } catch {
      return [normalized];
    }
  }

  private async prepareEmbeddingForSync(text: string, mode: EmbeddingPrimeMode): Promise<void> {
    try {
      if (this.embeddingProviderUsesLocalModels()) {
        this.ensureEmbeddingReadyForSync(mode);
      }
      const normalized = text || "";
      if (mode === "query") {
        if (typeof this.embeddingProvider.primeQuery === "function") {
          for (const variant of this.getQueryPrimeVariants(normalized)) {
            await this.embeddingProvider.primeQuery(variant);
          }
          return;
        }
        if (typeof this.embeddingProvider.prime === "function") {
          for (const variant of this.getQueryPrimeVariants(normalized)) {
            await this.embeddingProvider.prime(variant);
          }
          return;
        }
        if (typeof this.embeddingProvider.embedQuery === "function") {
          for (const variant of this.getQueryPrimeVariants(normalized)) {
            this.embeddingProvider.embedQuery(variant);
          }
          return;
        }
      }

      if (typeof this.embeddingProvider.prime === "function") {
        await this.embeddingProvider.prime(normalized);
        return;
      }

      this.embeddingProvider.embed(normalized);
    } catch (error) {
      throw this.createEmbeddingReadinessError(
        mode === "query" ? "search embedding preparation failed" : "write embedding preparation failed",
        error
      );
    }
  }

  private extractEventEmbeddingSeed(event: EventEnvelope): string {
    const payload =
      typeof event.payload === "string"
        ? (() => {
            try {
              const parsed = JSON.parse(event.payload);
              return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { content: event.payload };
            } catch {
              return { content: event.payload };
            }
          })()
        : event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : {};

    const promptRaw = payload.prompt;
    const contentRaw = payload.content;
    const commandRaw = payload.command;

    return (
      (typeof contentRaw === "string" && contentRaw.trim()) ||
      (typeof promptRaw === "string" && promptRaw.trim()) ||
      (typeof commandRaw === "string" && commandRaw.trim()) ||
      JSON.stringify(payload).slice(0, 4000)
    );
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

  async prepareRecordEventEmbedding(event: EventEnvelope): Promise<void> {
    await this.prepareEmbeddingForSync(this.extractEventEmbeddingSeed(event), "passage");
  }

  async prepareSearchEmbedding(query: string): Promise<void> {
    await this.prepareEmbeddingForSync(query, "query");
  }

  async primeEmbedding(text: string, mode: EmbeddingPrimeMode = "passage"): Promise<number[]> {
    const normalized = text || "";
    if (mode === "query") {
      if (typeof this.embeddingProvider.primeQuery === "function") {
        let first: number[] | null = null;
        for (const variant of this.getQueryPrimeVariants(normalized)) {
          const primed = await this.embeddingProvider.primeQuery(variant);
          if (first === null) {
            first = primed;
          }
        }
        return first ?? this.embeddingProvider.primeQuery(normalized);
      }
      if (typeof this.embeddingProvider.embedQuery === "function") {
        let first: number[] | null = null;
        for (const variant of this.getQueryPrimeVariants(normalized)) {
          const embedded = this.embeddingProvider.embedQuery(variant);
          if (first === null) {
            first = embedded;
          }
        }
        return Promise.resolve(first ?? this.embeddingProvider.embedQuery(normalized));
      }
    }

    if (typeof this.embeddingProvider.prime === "function") {
      return this.embeddingProvider.prime(normalized);
    }

    return Promise.resolve(this.embeddingProvider.embed(normalized));
  }

  getEmbeddingRuntimeInfo(): {
    provider: { name: string; model: string; dimension: number };
    vectorModelVersion: string;
    health: EmbeddingHealth;
    readiness: EmbeddingReadiness;
    supports: {
      embedQuery: boolean;
      prime: boolean;
      primeQuery: boolean;
      cacheStats: boolean;
      ready: boolean;
    };
    cacheStats: EmbeddingCacheStats | null;
  } {
    this.refreshEmbeddingHealth();

    return {
      provider: {
        name: this.embeddingProvider.name,
        model: this.embeddingProvider.model,
        dimension: this.embeddingProvider.dimension,
      },
      vectorModelVersion: this.vectorModelVersion,
      health: { ...this.embeddingHealth },
      readiness: this.getEmbeddingReadiness(),
      supports: {
        embedQuery: typeof this.embeddingProvider.embedQuery === "function",
        prime: typeof this.embeddingProvider.prime === "function",
        primeQuery: typeof this.embeddingProvider.primeQuery === "function",
        cacheStats: typeof this.embeddingProvider.cacheStats === "function",
        ready: !!this.embeddingProvider.ready,
      },
      cacheStats:
        typeof this.embeddingProvider.cacheStats === "function"
          ? this.embeddingProvider.cacheStats()
          : null,
    };
  }

  private startBackgroundWorkers(): void {
    this.ingestCoord.startTimers();
  }

  getStreamEventsSince(lastEventId: number, limitInput?: number): StreamEvent[] {
    return this.eventRec.getStreamEventsSince(lastEventId, limitInput);
  }

  getLatestStreamEventId(): number {
    return this.eventRec.getLatestStreamEventId();
  }

  private upsertSessionSummary(
    sessionId: string,
    platform: string,
    project: string,
    summary: string,
    endedAt: string,
    summaryMode: string
  ): void {
    ensureSession(this.db, sessionId, platform, project, endedAt);
    this.db
      .query(`
        UPDATE mem_sessions
        SET ended_at = ?, summary = ?, summary_mode = ?, updated_at = ?
        WHERE session_id = ?
      `)
      .run(endedAt, summary, summaryMode, nowIso(), sessionId);
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
    return this.eventRec.recordEvent(event, options);
  }

  async recordEventQueued(
    event: EventEnvelope,
    options: { allowQueue: boolean } = { allowQueue: true }
  ): Promise<ApiResponse | "queue_full"> {
    await this.prepareRecordEventEmbedding(event);
    return this.eventRec.recordEventQueued(event, options);
  }

  private platformVisibilityFilterSql(alias: string): string {
    if (this.config.antigravityIngestEnabled === false) {
      return ` AND ${alias}.platform <> 'antigravity' `;
    }
    return "";
  }

  private makeEmbeddingUnavailableResponse(
    startedAt: number,
    filters: Record<string, unknown>,
    error: unknown,
    context: string
  ): ApiResponse {
    const readinessError = error instanceof EmbeddingReadinessError
      ? error
      : this.createEmbeddingReadinessError(context, error);
    const response = makeErrorResponse(startedAt, readinessError.message, filters);
    Object.assign(response.meta, {
      embedding_provider: this.embeddingProvider.name,
      embedding_provider_status: readinessError.readiness.providerStatus,
      embedding_provider_details: readinessError.readiness.details,
      embedding_readiness_required: readinessError.readiness.required,
      embedding_ready: readinessError.readiness.ready,
      embedding_readiness_state: readinessError.readiness.state,
      embedding_readiness_retryable: readinessError.readiness.retryable,
      embedding_error_code: readinessError.code,
    });
    return response;
  }

  search(request: SearchRequest): ApiResponse {
    const startedAt = performance.now();
    try {
      return this.obsStore.search(request);
    } catch (error) {
      return this.makeEmbeddingUnavailableResponse(
        startedAt,
        request as unknown as Record<string, unknown>,
        error,
        "search embedding is unavailable"
      );
    }
  }

  async searchPrepared(request: SearchRequest): Promise<ApiResponse> {
    await this.prepareSearchEmbedding(request.query || "");
    const response = this.search(request);

    // S58-008: LLM リランク（HARNESS_MEM_LLM_ENHANCE=true の場合のみ）
    const llmConfig = buildLlmRerankerConfigFromEnv();
    if (llmConfig.enabled && response.ok && Array.isArray(response.items) && response.items.length > 0) {
      try {
        const candidates = (response.items as Array<Record<string, unknown>>)
          .filter((item) => typeof item.id === "string")
          .map((item) => ({
            id: item.id as string,
            title: typeof item.title === "string" ? item.title : "",
            content: typeof item.content === "string" ? item.content : "",
            score: typeof (item.scores as Record<string, unknown> | undefined)?.final === "number"
              ? (item.scores as Record<string, number>).final
              : 0,
          }));

        const reranked = await llmRerank(request.query || "", candidates, llmConfig);
        const scoreById = new Map(reranked.map((r) => [r.id, r.score]));

        (response.items as Array<Record<string, unknown>>).sort((a, b) => {
          const aScore = scoreById.get(a.id as string) ?? 0;
          const bScore = scoreById.get(b.id as string) ?? 0;
          return bScore - aScore;
        });

        // metadata に llm_rerank フラグを追記
        (response.meta as Record<string, unknown>).llm_rerank = true;
      } catch {
        // graceful degradation: LLM リランク失敗時は元の順序を維持
        (response.meta as Record<string, unknown>).llm_rerank = false;
      }
    } else {
      (response.meta as Record<string, unknown>).llm_rerank = false;
    }

    // S58-009: LLM 不在判定（HARNESS_MEM_LLM_ENHANCE=true かつ no_memory=true のときのみ）
    if (
      llmConfig.enabled &&
      response.no_memory === true &&
      Array.isArray(response.items) &&
      response.items.length > 0
    ) {
      try {
        const topItem = (response.items as Array<Record<string, unknown>>)[0];
        const topCandidate = {
          title: typeof topItem.title === "string" ? topItem.title : "",
          content: typeof topItem.content === "string" ? topItem.content : "",
          score:
            typeof (topItem.scores as Record<string, unknown> | undefined)?.final === "number"
              ? (topItem.scores as Record<string, number>).final
              : 0,
        };
        const apiKey =
          llmConfig.apiKey ??
          (llmConfig.provider === "anthropic"
            ? process.env.ANTHROPIC_API_KEY
            : process.env.OPENAI_API_KEY) ??
          "";
        const checkResult = await llmNoMemoryCheck(request.query || "", topCandidate, {
          provider: llmConfig.provider,
          model: llmConfig.model,
          apiKey,
        });
        if (checkResult.has_memory) {
          response.no_memory = false;
          response.no_memory_reason = "LLM determined the memory is relevant";
        }
      } catch {
        // graceful degradation: 元の no_memory 判定を維持
      }
    }

    return response;
  }

  feed(request: FeedRequest): ApiResponse {
    return this.obsStore.feed(request);
  }

  searchFacets(request: SearchFacetsRequest): ApiResponse {
    return this.obsStore.searchFacets(request);
  }

  async timeline(request: TimelineRequest): Promise<ApiResponse> {
    const startedAt = performance.now();
    try {
      return this.obsStore.timeline(request);
    } catch (error) {
      return this.makeEmbeddingUnavailableResponse(
        startedAt,
        request as unknown as Record<string, unknown>,
        error,
        "timeline embedding is unavailable"
      );
    }
  }

  getObservations(request: GetObservationsRequest): ApiResponse {
    return this.obsStore.getObservations(request);
  }

  sessionsList(request: SessionsListRequest): ApiResponse {
    return this.sessionMgr.sessionsList(request);
  }

  sessionThread(request: SessionThreadRequest): ApiResponse {
    return this.sessionMgr.sessionThread(request);
  }

  /**
   * 複数の observation を一括ソフトデリート（privacy_tags に "deleted" を付与）する。
   */
  bulkDeleteObservations(request: { ids: string[]; user_id?: string; team_id?: string }): ApiResponse {
    const startedAt = performance.now();
    const { ids } = request;
    if (!ids || ids.length === 0) {
      return makeErrorResponse(startedAt, "ids is required and must not be empty", request as unknown as Record<string, unknown>);
    }
    if (ids.length > 500) {
      return makeErrorResponse(startedAt, `ids length exceeds maximum of 500 (got ${ids.length})`, request as unknown as Record<string, unknown>);
    }
    const deleted: string[] = [];
    const skipped: string[] = [];
    for (const id of ids) {
      try {
        const existing = this.db.query(`SELECT id, privacy_tags, user_id, team_id FROM mem_observations WHERE id = ?`).get(id) as { id: string; privacy_tags: string; user_id: string; team_id: string | null } | null;
        if (!existing) {
          skipped.push(id);
          continue;
        }
        // TEAM-005: テナント分離 — member は自分 or 同チームの observation のみ削除可
        if (request.user_id) {
          const isOwner = existing.user_id === request.user_id;
          const isSameTeam = request.team_id ? existing.team_id === request.team_id : false;
          if (!isOwner && !isSameTeam) {
            skipped.push(id);
            continue;
          }
        }
        const tags: string[] = existing.privacy_tags ? JSON.parse(existing.privacy_tags) : [];
        if (!tags.includes("deleted")) {
          tags.push("deleted");
        }
        this.db.query(`UPDATE mem_observations SET privacy_tags = ? WHERE id = ?`).run(JSON.stringify(tags), id);
        deleted.push(id);
      } catch {
        skipped.push(id);
      }
    }
    return makeResponse(
      startedAt,
      [{ deleted, skipped }],
      { ids },
      { deleted_count: deleted.length, skipped_count: skipped.length }
    );
  }

  /**
   * observation の team_id を更新してチームに共有する。
   * 冪等: 既に同じ team_id が設定済みの場合も成功を返す。
   */
  shareObservationToTeam(request: { observation_id: string; team_id: string; user_id?: string }): ApiResponse {
    const startedAt = performance.now();
    const { observation_id, team_id, user_id } = request;

    if (!observation_id || !observation_id.trim()) {
      return makeErrorResponse(startedAt, "observation_id is required", request as unknown as Record<string, unknown>);
    }
    if (!team_id || !team_id.trim()) {
      return makeErrorResponse(startedAt, "team_id is required", request as unknown as Record<string, unknown>);
    }

    // observation の存在チェック
    const existing = this.db
      .query(`SELECT id, user_id, team_id, privacy_tags_json FROM mem_observations WHERE id = ?`)
      .get(observation_id) as { id: string; user_id: string; team_id: string | null; privacy_tags_json: string } | null;

    if (!existing) {
      return makeErrorResponse(startedAt, `Observation '${observation_id}' not found`, request as unknown as Record<string, unknown>);
    }

    // 削除済みの場合はエラー
    const privacyTags: string[] = existing.privacy_tags_json ? JSON.parse(existing.privacy_tags_json) : [];
    if (privacyTags.includes("deleted")) {
      return makeErrorResponse(startedAt, `Observation '${observation_id}' has been deleted`, request as unknown as Record<string, unknown>);
    }

    // 権限チェック: user_id が指定された場合、observation の所有者のみ共有可能
    if (user_id && existing.user_id && existing.user_id !== "default" && existing.user_id !== user_id) {
      return makeErrorResponse(startedAt, "Permission denied: you can only share your own observations", request as unknown as Record<string, unknown>);
    }

    // team の存在チェック
    const team = this.db
      .query(`SELECT team_id FROM mem_teams WHERE team_id = ?`)
      .get(team_id) as { team_id: string } | null;

    if (!team) {
      return makeErrorResponse(startedAt, `Team '${team_id}' not found`, request as unknown as Record<string, unknown>);
    }

    // 冪等: 既に同じ team_id が設定済みの場合はそのまま成功
    if (existing.team_id === team_id) {
      this.writeAuditLog("write.share_to_team", "observation", observation_id, {
        team_id,
        idempotent: true,
        user_id: user_id ?? "system",
      });
      return makeResponse(
        startedAt,
        [{ observation_id, team_id, already_shared: true }],
        { observation_id, team_id },
        { shared: true, idempotent: true }
      );
    }

    // team_id を UPDATE
    this.db
      .query(`UPDATE mem_observations SET team_id = ?, updated_at = ? WHERE id = ?`)
      .run(team_id, nowIso(), observation_id);

    this.writeAuditLog("write.share_to_team", "observation", observation_id, {
      team_id,
      previous_team_id: existing.team_id ?? null,
      user_id: user_id ?? "system",
    });

    return makeResponse(
      startedAt,
      [{ observation_id, team_id, already_shared: false }],
      { observation_id, team_id },
      { shared: true, idempotent: false }
    );
  }

  /**
   * 観察データを JSON 形式でエクスポートする。
   */
  exportObservations(request: { project?: string; limit?: number; include_private?: boolean; user_id?: string; team_id?: string }): ApiResponse {
    const startedAt = performance.now();
    const { project, limit = 1000, include_private = false } = request;
    try {
      let sql = `
        SELECT id, platform, project, session_id, event_type, title, content,
               created_at, tags, privacy_tags
        FROM mem_observations
        WHERE 1=1
      `;
      const params: unknown[] = [];
      if (project) {
        sql += ` AND project = ?`;
        params.push(project);
      }
      if (!include_private) {
        sql += ` AND (privacy_tags IS NULL OR privacy_tags NOT LIKE '%"deleted"%')`;
      }
      // TEAM-005: テナント分離
      if (request.user_id) {
        if (request.team_id) {
          sql += ` AND (user_id = ? OR team_id = ?)`;
          params.push(request.user_id, request.team_id);
        } else {
          sql += ` AND user_id = ?`;
          params.push(request.user_id);
        }
      }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      const rows = this.db.query(sql).all(...(params as any[]));
      return makeResponse(startedAt, rows as Record<string, unknown>[], { project, limit, include_private }, { ranking: "export_v1" });
    } catch (err) {
      return makeErrorResponse(startedAt, `export failed: ${String(err)}`, request as unknown as Record<string, unknown>);
    }
  }

  /**
   * S74-004: fact_key の時系列変遷を取得する。
   * superseded_by チェーンを辿り、active fact を特定する。
   */
  getFactHistory(request: FactHistoryRequest): ApiResponse {
    const startedAt = performance.now();
    const { fact_key, project, limit = 100 } = request;

    if (!fact_key) {
      return makeErrorResponse(startedAt, "fact_key is required", request as unknown as Record<string, unknown>);
    }

    try {
      let sql = `
        SELECT fact_id, fact_type, fact_key, fact_value, confidence,
               valid_from, valid_to, superseded_by, created_at
        FROM mem_facts
        WHERE fact_key = ?
          AND merged_into_fact_id IS NULL
      `;
      const params: unknown[] = [fact_key];

      if (project) {
        const normalizedProject = this.normalizeProjectInput(project);
        sql += ` AND project = ?`;
        params.push(normalizedProject);
      }
      sql += ` ORDER BY created_at ASC LIMIT ?`;
      params.push(limit);

      const rows = this.db.query(sql).all(...(params as any[])) as Array<{
        fact_id: string;
        fact_type: string;
        fact_key: string;
        fact_value: string;
        confidence: number;
        valid_from: string | null;
        valid_to: string | null;
        superseded_by: string | null;
        created_at: string;
      }>;

      const entries = rows.map((row) => ({
        ...row,
        is_active: (row.superseded_by === null || row.superseded_by === undefined) && row.valid_to === null,
      }));

      return makeResponse(
        startedAt,
        entries as unknown as Record<string, unknown>[],
        { fact_key, project, limit },
        { ranking: "fact_history_v1" },
      );
    } catch (err) {
      return makeErrorResponse(startedAt, `getFactHistory failed: ${String(err)}`, request as unknown as Record<string, unknown>);
    }
  }

  recordCheckpoint(request: RecordCheckpointRequest): ApiResponse {
    return this.sessionMgr.recordCheckpoint(request);
  }

  finalizeSession(request: FinalizeSessionRequest): ApiResponse {
    return this.sessionMgr.finalizeSession(request);
  }

  resolveSessionChain(correlationId: string, project: string): ApiResponse {
    return this.sessionMgr.resolveSessionChain(correlationId, project);
  }


  resumePack(request: ResumePackRequest): ApiResponse {
    return this.obsStore.resumePack(request);
  }

  health(): ApiResponse {
    const startedAt = performance.now();
    this.refreshEmbeddingHealth();
    const embeddingReadiness = this.getEmbeddingReadiness();

    const sessions = this.db.query(`SELECT COUNT(*) AS count FROM mem_sessions`).get() as { count: number };
    const events = this.db.query(`SELECT COUNT(*) AS count FROM mem_events`).get() as { count: number };
    const observations = this.db.query(`SELECT COUNT(*) AS count FROM mem_observations`).get() as { count: number };
    const queue = this.db.query(`SELECT COUNT(*) AS count FROM mem_retry_queue`).get() as { count: number };

    const dbPath = resolveHomePath(this.config.dbPath);
    const dbSize = existsSync(dbPath) ? statSync(dbPath).size : 0;

    const managedDegraded = this.managedRequired && (!this.managedBackend || !this.managedBackend.isConnected());
    const embeddingDegraded = embeddingReadiness.required && !embeddingReadiness.ready;

    return makeResponse(
      startedAt,
      [
        {
          status: managedDegraded || embeddingDegraded ? "degraded" : "ok",
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
          embedding_ready: embeddingReadiness.ready,
          embedding_readiness_required: embeddingReadiness.required,
          embedding_readiness_state: embeddingReadiness.state,
          embedding_readiness_retryable: embeddingReadiness.retryable,
          features: {
            capture: this.config.captureEnabled,
            retrieval: this.config.retrievalEnabled,
            injection: this.config.injectionEnabled,
            embedding_provider: this.embeddingProvider.name,
            embedding_model: this.embeddingProvider.model,
            reranker_enabled: this.rerankerEnabled,
            reranker_name: this.reranker?.name || null,
            consolidation_enabled: this.config.consolidationEnabled !== false,
            consolidation_interval_ms: clampLimit(Number(this.config.consolidationIntervalMs || 60000), 60000, 5000, 600000),
            codex_history_ingest: this.config.codexHistoryEnabled,
            codex_sessions_root: resolveHomePath(this.config.codexSessionsRoot),
            codex_ingest_interval_ms: this.config.codexIngestIntervalMs,
            codex_backfill_hours: this.config.codexBackfillHours,
            opencode_history_ingest: this.config.opencodeIngestEnabled !== false,
            opencode_storage_root: resolveHomePath(this.config.opencodeStorageRoot || DEFAULT_OPENCODE_STORAGE_ROOT),
            opencode_db_path: this.config.opencodeDbPath || "",
            opencode_ingest_interval_ms: clampLimit(Number(this.config.opencodeIngestIntervalMs || DEFAULT_OPENCODE_INGEST_INTERVAL_MS), DEFAULT_OPENCODE_INGEST_INTERVAL_MS, 1000, 300000),
            opencode_backfill_hours: clampLimit(Number(this.config.opencodeBackfillHours || DEFAULT_OPENCODE_BACKFILL_HOURS), DEFAULT_OPENCODE_BACKFILL_HOURS, 1, 24 * 365),
            cursor_history_ingest: this.config.cursorIngestEnabled !== false,
            cursor_events_path: resolveHomePath(this.config.cursorEventsPath || DEFAULT_CURSOR_EVENTS_PATH),
            cursor_ingest_interval_ms: clampLimit(Number(this.config.cursorIngestIntervalMs || DEFAULT_CURSOR_INGEST_INTERVAL_MS), DEFAULT_CURSOR_INGEST_INTERVAL_MS, 1000, 300000),
            cursor_backfill_hours: clampLimit(Number(this.config.cursorBackfillHours || DEFAULT_CURSOR_BACKFILL_HOURS), DEFAULT_CURSOR_BACKFILL_HOURS, 1, 24 * 365),
            antigravity_history_ingest: this.config.antigravityIngestEnabled !== false,
            antigravity_workspace_roots: computeAntigravityWorkspaceRoots(this.config),
            antigravity_logs_root: resolveHomePath(this.config.antigravityLogsRoot || DEFAULT_ANTIGRAVITY_LOGS_ROOT),
            antigravity_workspace_storage_root: resolveHomePath(this.config.antigravityWorkspaceStorageRoot || DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT),
            antigravity_ingest_interval_ms: clampLimit(Number(this.config.antigravityIngestIntervalMs || DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS), DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS, 1000, 300000),
            antigravity_backfill_hours: clampLimit(Number(this.config.antigravityBackfillHours || DEFAULT_ANTIGRAVITY_BACKFILL_HOURS), DEFAULT_ANTIGRAVITY_BACKFILL_HOURS, 1, 24 * 365),
            gemini_history_ingest: this.config.geminiIngestEnabled !== false,
            gemini_events_path: resolveHomePath(this.config.geminiEventsPath || DEFAULT_GEMINI_EVENTS_PATH),
            gemini_ingest_interval_ms: clampLimit(Number(this.config.geminiIngestIntervalMs || DEFAULT_GEMINI_INGEST_INTERVAL_MS), DEFAULT_GEMINI_INGEST_INTERVAL_MS, 1000, 300000),
            gemini_backfill_hours: clampLimit(Number(this.config.geminiBackfillHours || DEFAULT_GEMINI_BACKFILL_HOURS), DEFAULT_GEMINI_BACKFILL_HOURS, 1, 24 * 365),
            claude_code_history_ingest: this.config.claudeCodeIngestEnabled !== false,
            claude_code_projects_root: resolveHomePath(this.config.claudeCodeProjectsRoot || DEFAULT_CLAUDE_CODE_PROJECTS_ROOT),
            claude_code_ingest_interval_ms: clampLimit(Number(this.config.claudeCodeIngestIntervalMs || DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS), DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS, 1000, 300000),
            claude_code_backfill_hours: clampLimit(Number(this.config.claudeCodeBackfillHours || DEFAULT_CLAUDE_CODE_BACKFILL_HOURS), DEFAULT_CLAUDE_CODE_BACKFILL_HOURS, 1, 24 * 365),
            search_ranking: this.config.searchRanking || DEFAULT_SEARCH_RANKING,
            search_expand_links: this.config.searchExpandLinks !== false,
          },
          managed_backend: this.managedBackend ? this.managedBackend.getStatus() : null,
          warnings: [
            ...this.embeddingWarnings,
            ...(embeddingDegraded
              ? [
                  embeddingReadiness.state === "failed"
                    ? `embedding provider blocked: ${embeddingReadiness.details}`
                    : `embedding provider warming: ${embeddingReadiness.details}`,
                ]
              : []),
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

  readiness(): ApiResponse {
    const startedAt = performance.now();
    const embeddingReadiness = this.getEmbeddingReadiness();
    const managedReady = !this.managedRequired || !!this.managedBackend?.isConnected();
    const ready = managedReady && (!embeddingReadiness.required || embeddingReadiness.ready);

    return makeResponse(
      startedAt,
      [
        {
          status: ready ? "ready" : "not_ready",
          ready,
          backend_mode: this.config.backendMode || "local",
          embedding_provider: this.embeddingProvider.name,
          embedding_provider_status: embeddingReadiness.providerStatus,
          embedding_provider_details: embeddingReadiness.details,
          embedding_ready: embeddingReadiness.ready,
          embedding_readiness_required: embeddingReadiness.required,
          embedding_readiness_state: embeddingReadiness.state,
          embedding_readiness_retryable: embeddingReadiness.retryable,
          managed_ready: managedReady,
          managed_backend: this.managedBackend ? this.managedBackend.getStatus() : null,
        },
      ],
      {},
      { ranking: "ready_v1", ready }
    );
  }

  metrics(): ApiResponse {
    const startedAt = performance.now();
    this.refreshEmbeddingHealth();
    const embeddingReadiness = this.getEmbeddingReadiness();

    const vectorCoverage = this.db
      .query(`
        SELECT
          (SELECT COUNT(*) FROM mem_vectors) AS mem_vectors_count,
          (SELECT COUNT(*) FROM mem_observations) AS observations_count
      `)
      .get() as { mem_vectors_count: number; observations_count: number } | null;

    const vecMapTables = this.db
      .query<{ name: string }, []>(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND (name = 'mem_vectors_vec_map' OR name LIKE 'mem_vectors_vec_map_%')`,
      )
      .all();
    let vecMapCount = 0;
    for (const row of vecMapTables) {
      const tableCount = this.db
        .query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${row.name}`)
        .get();
      vecMapCount += Number(tableCount?.count ?? 0);
    }

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
          embedding_ready: embeddingReadiness.ready,
          embedding_readiness_required: embeddingReadiness.required,
          embedding_readiness_state: embeddingReadiness.state,
          embedding_readiness_retryable: embeddingReadiness.retryable,
          reranker_enabled: this.rerankerEnabled,
          reranker_name: this.reranker?.name || null,
          coverage: {
            observations: Number(vectorCoverage?.observations_count ?? 0),
            mem_vectors: Number(vectorCoverage?.mem_vectors_count ?? 0),
            mem_vectors_vec_map: vecMapCount,
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
    if (this.config.consolidationEnabled === false) {
      return;
    }
    enqueueConsolidationJob(this.db, project, sessionId, reason);
  }

  async runConsolidation(request: ConsolidationRunRequest = {}): Promise<ApiResponse> {
    const startedAt = performance.now();
    if (this.config.consolidationEnabled === false) {
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
    return this.cfgMgr.getConsolidationStatus();
  }

  getAuditLog(request: AuditLogRequest = {}): ApiResponse {
    return this.cfgMgr.getAuditLog(request);
  }

  projectsStats(request: ProjectsStatsRequest = {}): ApiResponse {
    return this.cfgMgr.projectsStats(request);
  }

  startClaudeMemImport(request: ClaudeMemImportRequest): ApiResponse {
    return this.ingestCoord.startClaudeMemImport(request);
  }

  getImportJobStatus(request: ImportJobStatusRequest): ApiResponse {
    return this.ingestCoord.getImportJobStatus(request);
  }

  verifyClaudeMemImport(request: VerifyImportRequest): ApiResponse {
    return this.ingestCoord.verifyClaudeMemImport(request);
  }

  backup(options?: { destDir?: string }): ApiResponse {
    return this.cfgMgr.backup(options);
  }

  reindexVectors(limitInput?: number): ApiResponse {
    return this.cfgMgr.reindexVectors(limitInput);
  }

  createLink(request: CreateLinkRequest): ApiResponse {
    const startedAt = performance.now();
    const { from_observation_id, to_observation_id, relation, weight = 1.0 } = request;

    if (!from_observation_id || !to_observation_id || !relation) {
      return makeErrorResponse(startedAt, "from_observation_id, to_observation_id, relation are required", request as unknown as Record<string, unknown>);
    }

    if (from_observation_id === to_observation_id) {
      return makeErrorResponse(startedAt, "self-referential link is not allowed", {
        from_observation_id,
        to_observation_id,
        relation,
      });
    }

    const validRelations: string[] = ["updates", "extends", "derives", "follows", "shared_entity", "contradicts", "causes", "part_of"];
    if (!validRelations.includes(relation)) {
      return makeErrorResponse(startedAt, `invalid relation type: ${relation}. Must be one of: ${validRelations.join(", ")}`, request as unknown as Record<string, unknown>);
    }

    try {
      const current = nowIso();
      this.db
        .query(`
          INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(from_observation_id, to_observation_id, relation, weight, current);

      return makeResponse(
        startedAt,
        [{ from_observation_id, to_observation_id, relation, weight, created_at: current }],
        { from_observation_id, to_observation_id, relation }
      );
    } catch (err) {
      return makeErrorResponse(startedAt, `failed to create link: ${String(err)}`, request as unknown as Record<string, unknown>);
    }
  }

  getLinks(request: GetLinksRequest): ApiResponse {
    const startedAt = performance.now();
    const { observation_id, relation, depth: rawDepth } = request;
    const depth = Math.min(Math.max(rawDepth ?? 1, 1), 5);

    if (!observation_id) {
      return makeErrorResponse(startedAt, "observation_id is required", request as unknown as Record<string, unknown>);
    }

    try {
      type LinkRow = {
        from_observation_id: string;
        to_observation_id: string;
        relation: string;
        weight: number;
        created_at: string;
      };

      const allRows: LinkRow[] = [];
      // BFS: フロンティアとして処理済みの observation_id を管理（循環防止）
      const processedIds = new Set<string>([observation_id]);
      let frontier = [observation_id];

      for (let d = 0; d < depth && frontier.length > 0; d++) {
        const placeholders = frontier.map(() => "?").join(", ");
        let sql = `
          SELECT from_observation_id, to_observation_id, relation, weight, created_at
          FROM mem_links
          WHERE from_observation_id IN (${placeholders})
        `;
        const params: unknown[] = [...frontier];

        if (relation) {
          sql += ` AND relation = ?`;
          params.push(relation);
        }

        sql += ` ORDER BY created_at DESC`;

        const rows = this.db.query(sql).all(...(params as any[])) as LinkRow[];
        allRows.push(...rows);

        // 次フロンティア: 未処理の to_observation_id のみ
        const nextFrontier: string[] = [];
        for (const row of rows) {
          if (!processedIds.has(row.to_observation_id)) {
            processedIds.add(row.to_observation_id);
            nextFrontier.push(row.to_observation_id);
          }
        }
        frontier = nextFrontier;
      }

      // TEAM-005: テナント分離 — link 先 observation の所有権でフィルタ
      if (request.user_id) {
        const linkedIds = new Set<string>();
        for (const row of allRows) {
          linkedIds.add(row.from_observation_id);
          linkedIds.add(row.to_observation_id);
        }
        const idsArray = [...linkedIds];
        if (idsArray.length > 0) {
          const placeholders = idsArray.map(() => "?").join(", ");
          let ownerSql = `SELECT id FROM mem_observations WHERE id IN (${placeholders})`;
          const ownerParams: unknown[] = [...idsArray];
          if (request.team_id) {
            ownerSql += ` AND (user_id = ? OR team_id = ?)`;
            ownerParams.push(request.user_id, request.team_id);
          } else {
            ownerSql += ` AND user_id = ?`;
            ownerParams.push(request.user_id);
          }
          const allowedIds = new Set(
            (this.db.query(ownerSql).all(...(ownerParams as any[])) as Array<{ id: string }>).map(r => r.id)
          );
          const filteredRows = allRows.filter(
            r => allowedIds.has(r.from_observation_id) && allowedIds.has(r.to_observation_id)
          );
          return makeResponse(startedAt, filteredRows, { observation_id, relation, depth });
        }
      }

      return makeResponse(startedAt, allRows, { observation_id, relation, depth });
    } catch (err) {
      return makeErrorResponse(startedAt, `failed to get links: ${String(err)}`, request as unknown as Record<string, unknown>);
    }
  }


  getSubgraph(entity: string, depth: number, options?: { project?: string; limit?: number; user_id?: string; team_id?: string }) {
    return this.obsStore.getSubgraph(entity, depth, options);
  }

  // ---------------------------------------------------------------------------
  // Analytics API (V5-006)
  // ---------------------------------------------------------------------------

  async usageStats(params: UsageParams): Promise<UsageStats> {
    return this.analyticsSvc.getUsageStats(params);
  }

  async entityDistribution(params: EntityParams): Promise<EntityStats[]> {
    return this.analyticsSvc.getEntityDistribution(params);
  }

  async timelineStats(params: TimelineParams): Promise<TimelineStats> {
    return this.analyticsSvc.getTimelineStats(params);
  }

  async overviewStats(params: OverviewParams): Promise<OverviewStats> {
    return this.analyticsSvc.getOverview(params);
  }

  ingestCodexHistory(): ApiResponse {
    return this.ingestCoord.ingestCodexHistory();
  }

  ingestOpencodeHistory(): ApiResponse {
    return this.ingestCoord.ingestOpencodeHistory();
  }

  ingestCursorHistory(): ApiResponse {
    return this.ingestCoord.ingestCursorHistory();
  }

  ingestAntigravityHistory(): ApiResponse {
    return this.ingestCoord.ingestAntigravityHistory();
  }

  ingestGeminiHistory(): ApiResponse {
    return this.ingestCoord.ingestGeminiHistory();
  }

  ingestClaudeCodeHistory(): ApiResponse {
    return this.ingestCoord.ingestClaudeCodeHistory();
  }

  /**
   * IMP-010: GitHub Issues を harness-mem に取り込む。
   *
   * request.json に `gh issue list --json ...` の出力を渡す。
   * request.repo に "owner/repo" 形式のリポジトリ名を渡す。
   */
  ingestGitHubIssues(request: {
    repo: string;
    json: string;
    project?: string;
    platform?: string;
    session_id?: string;
  }): ApiResponse {
    return this.ingestCoord.ingestGitHubIssues(request);
  }

  ingestKnowledgeFile(request: {
    file_path: string;
    content: string;
    kind?: "decisions_md" | "adr";
    project?: string;
    platform?: string;
    session_id?: string;
  }): ApiResponse {
    return this.ingestCoord.ingestKnowledgeFile(request);
  }

  async ingestAudio(request: {
    audioBuffer: Buffer;
    filename: string;
    project?: string;
    session_id?: string;
    tags?: string[];
    language?: string;
    provider?: "whisper-local" | "openai-whisper";
    whisperEndpoint?: string;
    openaiApiKey?: string;
  }): Promise<{ ok: boolean; observation_id?: string; transcript?: string; duration_seconds?: number; error?: string }> {
    const { ingestAudio } = await import("../ingest/audio-ingester.js");
    return ingestAudio({
      core: this,
      audioBuffer: request.audioBuffer,
      filename: request.filename,
      project: request.project,
      session_id: request.session_id,
      tags: request.tags,
      language: request.language,
      ingesterConfig: {
        provider: request.provider,
        whisperEndpoint: request.whisperEndpoint,
        openaiApiKey: request.openaiApiKey,
      },
    });
  }

  shutdown(signal: string): void {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    this.ingestCoord.stopTimers();

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
      this.db.close(process.platform === "win32");
    } catch {
      // ignore close errors
    }

    try {
      writeFileSync(this.heartbeatPath, JSON.stringify({ pid: process.pid, ts: nowIso(), state: `stopped:${signal}` }));
    } catch {
      // best effort
    }
  }

  /**
   * COMP-006: メモリ圧縮エンジン
   * strategy: "prune" | "merge" | "none"
   * - prune: 低 confidence (<0.5) のファクトを soft-delete（superseded_by を設定）
   * - merge: 同一 fact_key の重複ファクトを最新1件に統合（merged_into_fact_id を設定）
   * - none: 統計のみ返す
   * dry_run=true: 実際には変更しない
   *
   * observations_before/after はアクティブなファクト数を返す（ファクト圧縮のため）
   */
  compressMemory(request: {
    strategy: "prune" | "merge" | "none";
    project?: string;
    dry_run?: boolean;
  }): { ok: boolean; strategy: string; observations_before: number; observations_after: number; pruned_count: number; merged_count: number } {
    const { strategy, project, dry_run = false } = request;

    const countActiveFacts = (proj?: string): number => {
      if (proj) {
        const row = this.db.query(
          `SELECT COUNT(*) AS c FROM mem_facts
           WHERE project = ?
             AND merged_into_fact_id IS NULL
             AND superseded_by IS NULL
             AND valid_to IS NULL`
        ).get(proj) as { c?: number } | null;
        return Number(row?.c ?? 0);
      }
      const row = this.db.query(
        `SELECT COUNT(*) AS c FROM mem_facts
         WHERE merged_into_fact_id IS NULL
           AND superseded_by IS NULL
           AND valid_to IS NULL`
      ).get() as { c?: number } | null;
      return Number(row?.c ?? 0);
    };

    const obsBefore = countActiveFacts(project);

    if (strategy === "none" || dry_run) {
      return {
        ok: true,
        strategy,
        observations_before: obsBefore,
        observations_after: obsBefore,
        pruned_count: 0,
        merged_count: 0,
      };
    }

    let prunedCount = 0;
    let mergedCount = 0;
    const now = nowIso();

    if (strategy === "prune") {
      // prune: confidence < 0.5 のアクティブなファクトを valid_to で soft-delete
      const projectClause = project ? `AND project = ?` : "";
      const pruneParams: unknown[] = project ? [now, now, project] : [now, now];

      const result = this.db.query(
        `UPDATE mem_facts
         SET valid_to = ?, updated_at = ?
         WHERE confidence < 0.5
           AND merged_into_fact_id IS NULL
           AND superseded_by IS NULL
           AND valid_to IS NULL
           ${projectClause}`
      ).run(...(pruneParams as []));
      prunedCount = Number((result as { changes?: number }).changes ?? 0);
    }

    if (strategy === "merge") {
      // merge: 同一 project + fact_key の重複ファクトを最新1件に統合
      const projectClause = project ? `AND project = ?` : "";
      const mergeParams: unknown[] = project ? [project] : [];

      // 重複する fact_key ごとに、最新を除く古いファクトを merged_into_fact_id で統合
      const duplicates = this.db.query(
        `SELECT fact_key, MAX(created_at) AS latest_at, COUNT(*) AS cnt
         FROM mem_facts
         WHERE merged_into_fact_id IS NULL
           AND superseded_by IS NULL
           AND valid_to IS NULL
           ${projectClause}
         GROUP BY fact_key
         HAVING COUNT(*) > 1
         LIMIT 200`
      ).all(...(mergeParams as [])) as Array<{ fact_key: string; latest_at: string; cnt: number }>;

      for (const dup of duplicates) {
        const keepParams: unknown[] = project
          ? [dup.fact_key, dup.latest_at, project]
          : [dup.fact_key, dup.latest_at];
        const projectFilt = project ? `AND project = ?` : "";

        const keepRow = this.db.query(
          `SELECT fact_id FROM mem_facts
           WHERE fact_key = ?
             AND created_at = ?
             AND merged_into_fact_id IS NULL
             AND superseded_by IS NULL
             AND valid_to IS NULL
             ${projectFilt}
           LIMIT 1`
        ).get(...(keepParams as [])) as { fact_id: string } | null;

        if (!keepRow) continue;
        const keepId = keepRow.fact_id;

        const dupFactParams: unknown[] = project
          ? [dup.fact_key, keepId, project]
          : [dup.fact_key, keepId];
        const projectFilt2 = project ? `AND project = ?` : "";

        const dupResult = this.db.query(
          `UPDATE mem_facts
           SET merged_into_fact_id = ?, updated_at = ?
           WHERE fact_key = ?
             AND fact_id != ?
             AND merged_into_fact_id IS NULL
             AND superseded_by IS NULL
             AND valid_to IS NULL
             ${projectFilt2}`
        ).run(keepId, now, ...(dupFactParams as []));
        mergedCount += Number((dupResult as { changes?: number }).changes ?? 0);
      }
    }

    const obsAfter = countActiveFacts(project);

    try {
      this.writeAuditLog("admin.compress", "facts", "", {
        strategy,
        project: project || "*",
        observations_before: obsBefore,
        observations_after: obsAfter,
        pruned_count: prunedCount,
        merged_count: mergedCount,
      });
    } catch {
      // best effort
    }

    return {
      ok: true,
      strategy,
      observations_before: obsBefore,
      observations_after: obsAfter,
      pruned_count: prunedCount,
      merged_count: mergedCount,
    };
  }

  /**
   * TEAM-010: ナレッジマップ + 利用統計
   * ファクト分布（fact_type 別）、プロジェクト別観察数、総合統計を返す。
   */
  knowledgeStats(_request: Record<string, unknown>): ApiResponse {
    const startedAt = performance.now();

    // ファクト分布（fact_type 別カウント）
    const factsByType = this.db.query(
      `SELECT fact_type, COUNT(*) AS count
       FROM mem_facts
       WHERE merged_into_fact_id IS NULL
         AND superseded_by IS NULL
         AND valid_to IS NULL
       GROUP BY fact_type
       ORDER BY count DESC`
    ).all() as Array<{ fact_type: string; count: number }>;

    // プロジェクト別観察数
    const obsByProject = this.db.query(
      `SELECT project, COUNT(*) AS count
       FROM mem_observations
       GROUP BY project
       ORDER BY count DESC
       LIMIT 50`
    ).all() as Array<{ project: string; count: number }>;

    // 総合統計
    const totals = this.db.query(
      `SELECT
         (SELECT COUNT(*) FROM mem_observations) AS total_observations,
         (SELECT COUNT(*) FROM mem_facts
          WHERE merged_into_fact_id IS NULL AND superseded_by IS NULL AND valid_to IS NULL) AS total_active_facts,
         (SELECT COUNT(*) FROM mem_facts) AS total_facts_all,
         (SELECT COUNT(*) FROM mem_sessions) AS total_sessions,
         (SELECT COUNT(*) FROM mem_links) AS total_links`
    ).get() as {
      total_observations: number;
      total_active_facts: number;
      total_facts_all: number;
      total_sessions: number;
      total_links: number;
    } | null;

    return makeResponse(
      startedAt,
      [
        {
          facts_by_type: factsByType.map((r) => ({ fact_type: r.fact_type, count: Number(r.count) })),
          observations_by_project: obsByProject.map((r) => ({ project: r.project, count: Number(r.count) })),
          total_observations: Number(totals?.total_observations ?? 0),
          total_facts: Number(totals?.total_active_facts ?? 0),
          total_facts_including_merged: Number(totals?.total_facts_all ?? 0),
          total_sessions: Number(totals?.total_sessions ?? 0),
          total_links: Number(totals?.total_links ?? 0),
        },
      ],
      _request,
      { ranking: "knowledge_stats_v1" }
    );
  }

  /**
   * 生の SQLite Database インスタンスを返す。
   * Team API など server.ts から直接 DB にアクセスする必要がある用途のみ使用する。
   */
  getRawDb(): Database {
    return this.db;
  }
}
