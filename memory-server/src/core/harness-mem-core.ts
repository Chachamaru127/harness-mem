import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
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
import { parseCodexSessionsChunk } from "../ingest/codex-sessions";
import {
  resolveVectorEngine,
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
} from "../rerank/types";
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
import { IngestCoordinator } from "./ingest-coordinator";
import { ConfigManager } from "./config-manager";
import {
  clampLimit,
  DEFAULT_ANTIGRAVITY_BACKFILL_HOURS,
  DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS,
  DEFAULT_ANTIGRAVITY_LOGS_ROOT,
  DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT,
  DEFAULT_CURSOR_BACKFILL_HOURS,
  DEFAULT_CURSOR_EVENTS_PATH,
  DEFAULT_CURSOR_INGEST_INTERVAL_MS,
  DEFAULT_GEMINI_BACKFILL_HOURS,
  DEFAULT_GEMINI_EVENTS_PATH,
  DEFAULT_GEMINI_INGEST_INTERVAL_MS,
  DEFAULT_OPENCODE_BACKFILL_HOURS,
  DEFAULT_OPENCODE_DB_PATH,
  DEFAULT_OPENCODE_INGEST_INTERVAL_MS,
  DEFAULT_OPENCODE_STORAGE_ROOT,
  ensureDir,
  ensureSession,
  fileUriToPath,
  makeErrorResponse,
  makeResponse,
  nowIso,
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
  FeedRequest,
  FinalizeSessionRequest,
  GetLinksRequest,
  GetObservationsRequest,
  ImportJobStatusRequest,
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

const DEFAULT_DB_PATH = "~/.harness-mem/harness-mem.db";
const DEFAULT_BIND_HOST = "127.0.0.1";
const DEFAULT_BIND_PORT = 37888;
const DEFAULT_VECTOR_DIM = 256;
const DEFAULT_CODEX_SESSIONS_ROOT = "~/.codex/sessions";
const DEFAULT_CODEX_INGEST_INTERVAL_MS = 5000;
const DEFAULT_CODEX_BACKFILL_HOURS = 24;
const DEFAULT_SEARCH_RANKING = "hybrid_v3";
const DEFAULT_SEARCH_EXPAND_LINKS = true;
const VECTOR_MODEL_VERSION = "local-hash-v3";
const HEARTBEAT_FILE = "~/.harness-mem/daemon.heartbeat";
const DEFAULT_ENVIRONMENT_CACHE_TTL_MS = 20_000;

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no");
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
    this.initModules();
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
      embedContent: (content) => this.embeddingProvider.embed(content),
      getEmbeddingProviderName: () => this.embeddingProvider.name,
      getEmbeddingHealthStatus: () => this.embeddingHealth.status,
      getVectorModelVersion: () => this.vectorModelVersion,
      refreshEmbeddingHealth: () => this.refreshEmbeddingHealth(),
    });

    this.sessionMgr = new SessionManager({
      db: this.db,
      config: this.config,
      normalizeProject: (p) => this.normalizeProjectInput(p),
      platformVisibilityFilterSql: (alias) => this.platformVisibilityFilterSql(alias),
      recordEvent: (event) => this.recordEvent(event),
      appendStreamEvent: (type, data) => this.eventRec.appendStreamEvent(type, data),
      enqueueConsolidation: (proj, sess, reason) => this.enqueueConsolidation(proj, sess, reason),
    });

    this.obsStore = new ObservationStore({
      db: this.db,
      config: this.config,
      ftsEnabled: this.ftsEnabled,
      normalizeProject: (p) => this.normalizeProjectInput(p),
      platformVisibilityFilterSql: (alias) => this.platformVisibilityFilterSql(alias),
      writeAuditLog: (action, targetType, targetId, details) =>
        this.writeAuditLog(action, targetType, targetId, details),
      getVectorEngine: () => this.vectorEngine,
      getVectorModelVersion: () => this.vectorModelVersion,
      vectorDimension: this.config.vectorDimension,
      getVecTableReady: () => this.vecTableReady,
      setVecTableReady: (value) => { this.vecTableReady = value; },
      embedContent: (content) => this.embeddingProvider.embed(content),
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
    });

    this.cfgMgr = new ConfigManager({
      db: this.db,
      config: this.config,
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

  private startBackgroundWorkers(): void {
    this.heartbeatTimer = setInterval(() => {
      this.writeHeartbeat();
    }, 5000);

    if (this.config.codexHistoryEnabled) {
      this.ingestTimer = setInterval(() => {
        this.ingestCodexHistory();
      }, this.config.codexIngestIntervalMs);
    }

    if (this.config.opencodeIngestEnabled !== false) {
      this.opencodeIngestTimer = setInterval(() => {
        this.ingestOpencodeHistory();
      }, clampLimit(Number(this.config.opencodeIngestIntervalMs || DEFAULT_OPENCODE_INGEST_INTERVAL_MS), DEFAULT_OPENCODE_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (this.config.cursorIngestEnabled !== false) {
      this.cursorIngestTimer = setInterval(() => {
        this.ingestCursorHistory();
      }, clampLimit(Number(this.config.cursorIngestIntervalMs || DEFAULT_CURSOR_INGEST_INTERVAL_MS), DEFAULT_CURSOR_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (this.config.antigravityIngestEnabled !== false) {
      this.antigravityIngestTimer = setInterval(() => {
        this.ingestAntigravityHistory();
      }, clampLimit(Number(this.config.antigravityIngestIntervalMs || DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS), DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (this.config.geminiIngestEnabled !== false) {
      this.geminiIngestTimer = setInterval(() => {
        this.ingestGeminiHistory();
      }, clampLimit(Number(this.config.geminiIngestIntervalMs || DEFAULT_GEMINI_INGEST_INTERVAL_MS), DEFAULT_GEMINI_INGEST_INTERVAL_MS, 1000, 300000));
    }

    if (this.config.consolidationEnabled !== false) {
      let consolidationRunning = false;
      this.consolidationTimer = setInterval(() => {
        if (consolidationRunning) return;
        consolidationRunning = true;
        void this.runConsolidation({ reason: "scheduler", limit: 10 }).finally(() => {
          consolidationRunning = false;
        });
      }, clampLimit(Number(this.config.consolidationIntervalMs || 60000), 60000, 5000, 600000));
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

  getStreamEventsSince(lastEventId: number, limitInput?: number): StreamEvent[] {
    return this.eventRec.getStreamEventsSince(lastEventId, limitInput);
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
    return this.eventRec.recordEventQueued(event, options);
  }

  private platformVisibilityFilterSql(alias: string): string {
    if (this.config.antigravityIngestEnabled === false) {
      return ` AND ${alias}.platform <> 'antigravity' `;
    }
    return "";
  }

  search(request: SearchRequest): ApiResponse {
    return this.obsStore.search(request);
  }

  feed(request: FeedRequest): ApiResponse {
    return this.obsStore.feed(request);
  }

  searchFacets(request: SearchFacetsRequest): ApiResponse {
    return this.obsStore.searchFacets(request);
  }

  timeline(request: TimelineRequest): ApiResponse {
    return this.obsStore.timeline(request);
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

    const validRelations = ["updates", "extends", "derives", "follows", "shared_entity"];
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
    const { observation_id, relation } = request;

    if (!observation_id) {
      return makeErrorResponse(startedAt, "observation_id is required", request as unknown as Record<string, unknown>);
    }

    try {
      let sql = `
        SELECT from_observation_id, to_observation_id, relation, weight, created_at
        FROM mem_links
        WHERE from_observation_id = ?
      `;
      const params: unknown[] = [observation_id];

      if (relation) {
        sql += ` AND relation = ?`;
        params.push(relation);
      }

      sql += ` ORDER BY created_at DESC`;

      const rows = this.db.query(sql).all(...(params as any[])) as Array<{
        from_observation_id: string;
        to_observation_id: string;
        relation: string;
        weight: number;
        created_at: string;
      }>;

      return makeResponse(startedAt, rows, { observation_id, relation });
    } catch (err) {
      return makeErrorResponse(startedAt, `failed to get links: ${String(err)}`, request as unknown as Record<string, unknown>);
    }
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
