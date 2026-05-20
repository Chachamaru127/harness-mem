import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import type { HermesStateIngestRequest } from "../ingest/hermes-state";
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
import {
  runForgetPolicy,
  type ForgetPolicyOptions,
  type ForgetPolicyResult,
} from "../consolidation/forget-policy";
import {
  detectContradictions,
  type ContradictionAdjudicator,
  type ContradictionDetectorResult,
} from "../consolidation/contradiction-detector";
import { recordContradictionEnvelopes } from "../inject/contradiction-envelope";
import { createClaudeProviderAsync, createLLMProvider } from "../llm/registry";
import { ManagedBackend, type ManagedBackendStatus } from "../projector/managed-backend";
import { collectEnvironmentSnapshot, type EnvironmentSnapshot } from "../system-environment/collector";
import { TtlCache } from "../system-environment/cache";
import { SessionManager } from "./session-manager";
import { EventRecorder } from "./event-recorder";
import { ObservationStore } from "./observation-store";
import { verifyObservation as verifyObservationTrace } from "./verify.js";
import { SqliteObservationRepository } from "../db/repositories/SqliteObservationRepository.js";
import { IngestCoordinator } from "./ingest-coordinator";
import { ConfigManager, type ReindexVectorsOptions, type RepairSqliteVecMapOptions } from "./config-manager";
import { AnalyticsService } from "./analytics";
import { createPartialFinalizeScheduler, type PartialFinalizeScheduler } from "./partial-finalize-scheduler";
import { createReindexVectorsScheduler, type ReindexVectorsScheduler } from "./reindex-vectors-scheduler";
import {
  createVectorBackfillWorker,
  type VectorBackfillOperation,
  type VectorBackfillStartOptions,
  type VectorBackfillWorker,
} from "./vector-backfill-worker";
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
  normalizeTemporalTimestamp,
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
    CleanupDuplicatesRequest,
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
    CleanupDuplicatesRequest,
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

type AdminHardPurgeRequest = {
  project?: string;
  target_ids?: string[];
  limit?: number;
  retention_days?: number;
  execute?: boolean;
  manifest_hash?: string;
  manifest_expires_at?: string;
  candidate_count?: number;
  backup_sha256?: string;
  backup_path?: string;
  temp_test_backup_token?: string;
  retention_ack?: boolean;
  archive_ack?: boolean;
  confirmation?: string;
};

type HardPurgeCandidateRow = {
  id: string;
  project: string;
  archived_at: string | null;
  privacy_tags_json: string;
  tags_json: string;
};

type BackupEvidence = {
  provided: boolean;
  backup_sha256: string | null;
  backup_path: string | null;
  temp_test_backup_token_sha256: string | null;
  kind: "backup_file" | "sha256_metadata" | "temp_test_token" | "missing";
  integrity_check: {
    checked: boolean;
    ok: boolean;
    result: string | null;
    error: string | null;
  };
};

type HardPurgeManifest = {
  schema_version: "s127-hard-purge-v1";
  operation: "admin.hard_purge";
  generated_at: string;
  expires_at: string;
  project: string | null;
  candidate_ids: string[];
  candidate_count: number;
  impact: Record<string, number>;
  backup_sha256: string | null;
  backup: BackupEvidence & { required: true };
  retention: {
    minimum_archived_days: number;
    satisfied: boolean;
    blockers: Array<{ observation_id: string; archived_at: string | null; reason: string }>;
  };
  archive: {
    archive_tables_present: boolean;
    archived_only: boolean;
    archived_count: number;
    archive_stub_count: number;
    archive_full_count: number;
    restore_capable_count: number;
    restore_capable_full_count: number;
    restore_capable_full_observation_count: number;
    missing_restore_capable_archive_ids: string[];
    archive_states: Record<string, number>;
  };
  legal_hold: {
    allowed: boolean;
    blockers: string[];
  };
  manifest_hash: string;
  confirmation_phrase: string;
};

type HardPurgePrepareResult =
  | { ok: true; manifest: HardPurgeManifest; rows: HardPurgeCandidateRow[] }
  | { ok: false; error: string };

export function buildVectorBackfillChildCommand(
  scriptPath: string,
  operation: VectorBackfillOperation,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath, JSON.stringify(operation)];
  return platform === "win32" ? runCommand : ["nice", "-n", "10", ...runCommand];
}

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

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalizeJson(record[key]);
    }
    return sorted;
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function uniqueSortedStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

// getConfig は core-utils.ts から re-export
export { getConfig } from "./core-utils.js";

export function parseVectorBackfillChildResponse(stdout: string, stderr = ""): ApiResponse {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let lastJsonError: unknown = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as ApiResponse;
    } catch (error) {
      lastJsonError = error;
    }
  }
  const detail = lastJsonError instanceof Error ? lastJsonError.message : "no JSON response found";
  throw new Error(
    `vector backfill child returned invalid JSON: ${detail}; stderr=${stderr.trim()} stdout=${stdout.trim()}`,
  );
}

interface ProjectNormalizationOptions {
  preferredRoots?: string[];
}

/**
 * S81-B03: parse an LLM contradiction verdict from raw text. Handles both
 * JSON mode providers (OpenAI/Ollama force JSON object output) and plain
 * text providers (Claude Agent SDK or Anthropic direct). Degrades to
 * {contradiction: false, confidence: 0} on any parse failure so an
 * untrustworthy response can never create a spurious `superseded` link.
 */
function parseContradictionVerdict(raw: string): {
  contradiction: boolean;
  confidence: number;
  reason: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { contradiction: false, confidence: 0, reason: "empty response" };
  }
  // Try JSON first (OpenAI/Ollama force JSON mode).
  const jsonCandidates: string[] = [];
  if (trimmed.startsWith("{")) {
    jsonCandidates.push(trimmed);
  }
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch && jsonMatch[0] !== trimmed) {
    jsonCandidates.push(jsonMatch[0]);
  }
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        contradiction?: unknown;
        reason?: unknown;
        verdict?: unknown;
        answer?: unknown;
      };
      const contradictionVal =
        parsed.contradiction ?? parsed.verdict ?? parsed.answer;
      if (typeof contradictionVal === "boolean") {
        return {
          contradiction: contradictionVal,
          confidence: 0.9,
          reason:
            typeof parsed.reason === "string" ? parsed.reason : candidate,
        };
      }
      if (typeof contradictionVal === "string") {
        const lower = contradictionVal.trim().toLowerCase();
        if (lower === "yes" || lower === "true") {
          return {
            contradiction: true,
            confidence: 0.9,
            reason:
              typeof parsed.reason === "string" ? parsed.reason : candidate,
          };
        }
        if (lower === "no" || lower === "false") {
          return {
            contradiction: false,
            confidence: 0.9,
            reason:
              typeof parsed.reason === "string" ? parsed.reason : candidate,
          };
        }
      }
    } catch {
      // fall through to plain text path
    }
  }
  // Plain text fallback (Claude Agent SDK / Anthropic direct non-JSON).
  const lowered = trimmed.toLowerCase();
  // Label-style lines like `contradiction: false`, `contradiction = true`,
  // `contradiction - no`, etc. Codex round 7 P1: previously matched the
  // `contradiction` prefix alone and reported true, yielding bogus
  // `superseded` links when the model returned `contradiction: false`.
  const labelMatch = lowered.match(/^contradiction\s*[:=\-]\s*(.+)$/);
  if (labelMatch) {
    const value = labelMatch[1].trim();
    if (/^(yes|true)\b/.test(value)) {
      return { contradiction: true, confidence: 0.9, reason: trimmed };
    }
    if (/^(no|false)\b/.test(value)) {
      return { contradiction: false, confidence: 0.9, reason: trimmed };
    }
    return { contradiction: false, confidence: 0, reason: `ambiguous label: ${trimmed.slice(0, 80)}` };
  }
  if (/^(yes|true)\b/.test(lowered)) {
    return { contradiction: true, confidence: 0.9, reason: trimmed };
  }
  if (/^(no|false|agree)\b/.test(lowered)) {
    return { contradiction: false, confidence: 0.9, reason: trimmed };
  }
  return { contradiction: false, confidence: 0, reason: `unparseable: ${trimmed.slice(0, 80)}` };
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
  // S81-A01: walk up from `existingPath` looking for a *real* git repo
  // (dir containing .git/HEAD, or worktree pointer file). Nested src/ dirs
  // inside a genuine repo collapse onto its root; sibling folders that
  // merely share an ancestor containing an empty `.git/` (fake or dotfiles)
  // are not collapsed — confirmed via `.git/HEAD` existence check.
  const start = normalizePathLike(existingPath);
  if (!start.startsWith("/")) {
    return null;
  }

  let cursor = start;
  const MAX_WALKS = 64;
  for (let i = 0; i < MAX_WALKS; i += 1) {
    const gitMarker = join(cursor, ".git");
    if (existsSync(gitMarker)) {
      try {
        const markerStat = statSync(gitMarker);
        if (markerStat.isDirectory()) {
          if (existsSync(join(gitMarker, "HEAD"))) {
            return realpathOrNormalized(cursor);
          }
        } else if (markerStat.isFile()) {
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
    }
    const parent = normalizePathLike(resolve(cursor, ".."));
    if (!parent || parent === cursor) {
      return null;
    }
    if (parent === "/" || /^[A-Za-z]:\/?$/.test(parent)) {
      return null;
    }
    cursor = parent;
  }
  return null;
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
  private readonly hardPurgePlanExpirations = new Map<string, string>();
  /** §91-002: partial-finalize scheduler (opt-in via config.partialFinalizeEnabled) */
  private partialFinalizeScheduler!: PartialFinalizeScheduler;
  /** S89-003: vector reindex backfill scheduler (opt-in via config.reindexVectorsEnabled) */
  private reindexVectorsScheduler!: ReindexVectorsScheduler;
  /** S124-007: out-of-request vector compact rebuild + reindex worker */
  private vectorBackfillWorker!: VectorBackfillWorker;

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
      recordEventQueued: (event, options) => this.recordEventQueued(event, options),
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
      getVecTableReady: () => this.vecTableReady,
      setVecTableReady: (ready) => {
        this.vecTableReady = ready;
      },
      getVectorModelVersion: () => this.vectorModelVersion,
      embeddingProviderName: this.embeddingProvider.name,
      getEmbeddingHealthStatus: () => this.embeddingHealth.status,
      reindexObservationVector: (id, content, createdAt) =>
        this.eventRec.reindexObservationVector(id, content, createdAt),
      prepareReindexEmbedding: async (content) => {
        await this.primeEmbedding(content, "passage");
      },
      prepareReindexEmbeddings: async (contents) => {
        await this.primeEmbeddingsBatch(contents, "passage");
      },
      isAntigravityIngestEnabled: () => this.config.antigravityIngestEnabled !== false,
    });

    this.analyticsSvc = new AnalyticsService({
      db: {
        query: (sql: string, params?: unknown[]) => ({
          all: () => this.db.query(sql).all(...((params ?? []) as SQLQueryBindings[])),
        }),
      },
    });

    // §91-002: partial-finalize scheduler
    this.partialFinalizeScheduler = createPartialFinalizeScheduler(
      {
        db: this.db,
        finalizeSession: (req) => this.sessionMgr.finalizeSession(req),
        shouldSkipTick: () => this.vectorBackfillWorker?.isRunning() === true,
      },
      {
        enabled: this.config.partialFinalizeEnabled === true,
        intervalMs: this.config.partialFinalizeIntervalMs
          ? Math.max(5000, Number(this.config.partialFinalizeIntervalMs))
          : 300_000,
      }
    );

    // S89-003: vector reindex backfill scheduler
    this.reindexVectorsScheduler = createReindexVectorsScheduler(
      {
        db: this.db,
        reindexVectors: (limit) => this.reindexVectors(limit),
      },
      {
        enabled: this.config.reindexVectorsEnabled === true,
        intervalMs: this.config.reindexVectorsIntervalMs
          ? Math.max(5000, Number(this.config.reindexVectorsIntervalMs))
          : 600_000,
        batchSize: this.config.reindexVectorsBatchSize
          ? Math.max(1, Math.min(10000, Number(this.config.reindexVectorsBatchSize)))
          : 100,
      }
    );

    this.vectorBackfillWorker = createVectorBackfillWorker({
      db: this.db,
      getVectorModelVersion: () => this.vectorModelVersion,
      getVectorDimension: () => this.config.vectorDimension,
      repairSqliteVecMap: (options) => this.repairSqliteVecMap(options),
      reindexVectors: (limit) => this.reindexVectors(limit),
      runExternalOperation: (operation) => this.runVectorBackfillOperationOutOfProcess(operation),
      writeAuditLog: (action, targetType, targetId, details) =>
        this.writeAuditLog(action, targetType, targetId, details ?? {}),
    }, {
      autoSchedule: process.env.NODE_ENV !== "test",
    });
  }

  private async runVectorBackfillOperationOutOfProcess(
    operation: VectorBackfillOperation,
  ): Promise<ApiResponse> {
    const scriptPath = fileURLToPath(new URL("../tools/vector-backfill-tick.ts", import.meta.url));
    const compactOnlyEnv =
      operation.type === "compact"
        ? {
            HARNESS_MEM_EMBEDDING_PROVIDER: "fallback",
            HARNESS_MEM_EMBEDDING_MODEL: VECTOR_MODEL_VERSION,
          }
        : {};
    const reindexEnv =
      operation.type === "reindex"
        ? {
            HARNESS_MEM_REINDEX_PRIME_BATCH_SIZE: String(Math.min(Math.max(operation.limit, 1), 128)),
          }
        : {};
    const proc = Bun.spawn({
      cmd: buildVectorBackfillChildCommand(scriptPath, operation),
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...compactOnlyEnv,
        ...reindexEnv,
        NODE_ENV: "test",
        HARNESS_MEM_DB_PATH: this.config.dbPath,
        HARNESS_MEM_VECTOR_BACKFILL_CHILD: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`vector backfill child exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
    }
    return parseVectorBackfillChildResponse(stdout, stderr);
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
        const variants = this.getQueryPrimeVariants(normalized);
        if (typeof this.embeddingProvider.primeBatch === "function") {
          await this.embeddingProvider.primeBatch(variants, "query");
          return;
        }
        if (typeof this.embeddingProvider.primeQuery === "function") {
          for (const variant of variants) {
            await this.embeddingProvider.primeQuery(variant);
          }
          return;
        }
        if (typeof this.embeddingProvider.prime === "function") {
          for (const variant of variants) {
            await this.embeddingProvider.prime(variant);
          }
          return;
        }
        if (typeof this.embeddingProvider.embedQuery === "function") {
          for (const variant of variants) {
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

  async primeEmbeddingsBatch(texts: string[], mode: EmbeddingPrimeMode = "passage"): Promise<number[][]> {
    const normalizedTexts = texts.map((text) => text || "");
    if (normalizedTexts.length === 0) {
      return [];
    }

    if (typeof this.embeddingProvider.primeBatch === "function") {
      return this.embeddingProvider.primeBatch(normalizedTexts, mode);
    }

    return Promise.all(normalizedTexts.map((text) => this.primeEmbedding(text, mode)));
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
    // §91-002: start partial-finalize scheduler (no-op when enabled=false)
    this.partialFinalizeScheduler.start();
    // S89-003: start reindex backfill scheduler (no-op when enabled=false)
    this.reindexVectorsScheduler.start();
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

  private collectObservationLifecycleImpact(ids: string[]): Record<string, number> {
    const empty = {
      observations: 0,
      mem_vectors: 0,
      mem_links_touching: 0,
      mem_relations: 0,
      mem_facts: 0,
      mem_events: 0,
      mem_tags: 0,
      mem_observation_entities: 0,
      mem_nuggets: 0,
      mem_nugget_vectors: 0,
      mem_vectors_vec_map: 0,
      mem_entities_orphaned: 0,
      mem_archive_stubs: 0,
      mem_archive_full: 0,
    };
    if (ids.length === 0) {
      return empty;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const count = (sql: string, values: string[] = ids): number => {
      const row = this.db.query(sql).get(...(values as never[])) as { count: number } | null;
      return Number(row?.count ?? 0);
    };

    return {
      observations: ids.length,
      mem_vectors: count(`SELECT COUNT(*) AS count FROM mem_vectors WHERE observation_id IN (${placeholders})`),
      mem_links_touching: count(
        `SELECT COUNT(*) AS count FROM mem_links WHERE from_observation_id IN (${placeholders}) OR to_observation_id IN (${placeholders})`,
        [...ids, ...ids]
      ),
      mem_relations: count(`SELECT COUNT(*) AS count FROM mem_relations WHERE observation_id IN (${placeholders})`),
      mem_facts: count(`SELECT COUNT(*) AS count FROM mem_facts WHERE observation_id IN (${placeholders})`),
      mem_events: count(`SELECT COUNT(*) AS count FROM mem_events WHERE observation_id IN (${placeholders})`),
      mem_tags: count(`SELECT COUNT(*) AS count FROM mem_tags WHERE observation_id IN (${placeholders})`),
      mem_observation_entities: count(`SELECT COUNT(*) AS count FROM mem_observation_entities WHERE observation_id IN (${placeholders})`),
      mem_nuggets: count(`SELECT COUNT(*) AS count FROM mem_nuggets WHERE observation_id IN (${placeholders})`),
      mem_nugget_vectors: count(`SELECT COUNT(*) AS count FROM mem_nugget_vectors WHERE observation_id IN (${placeholders})`),
      mem_vectors_vec_map: this.countSqliteVecMapRows(ids),
      mem_entities_orphaned: count(
        `SELECT COUNT(*) AS count
         FROM mem_entities e
         WHERE EXISTS (
           SELECT 1 FROM mem_observation_entities oe
           WHERE oe.entity_id = e.id AND oe.observation_id IN (${placeholders})
         )
           AND NOT EXISTS (
             SELECT 1 FROM mem_observation_entities oe_live
             WHERE oe_live.entity_id = e.id AND oe_live.observation_id NOT IN (${placeholders})
           )`,
        [...ids, ...ids]
      ),
      mem_archive_stubs: this.tableExists("mem_archive_stubs")
        ? count(`SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE observation_id IN (${placeholders})`)
        : 0,
      mem_archive_full: this.countArchiveFullRows(ids),
    };
  }

  private tableExists(name: string): boolean {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return false;
    }
    const row = this.db
      .query(`SELECT 1 AS present FROM sqlite_master WHERE name = ? AND type IN ('table', 'view') LIMIT 1`)
      .get(name) as { present: number } | null;
    return !!row;
  }

  private quoteIdentifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`unsafe sqlite identifier: ${name}`);
    }
    return `"${name}"`;
  }

  private countSqliteVecMapRows(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(", ");
    const tables = this.db
      .query<{ name: string }, []>(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND (name = 'mem_vectors_vec_map' OR name LIKE 'mem_vectors_vec_map_%')`,
      )
      .all()
      .filter((row) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name));

    let total = 0;
    for (const row of tables) {
      const tableName = this.quoteIdentifier(row.name);
      const count = this.db
        .query(`SELECT COUNT(*) AS count FROM ${tableName} WHERE observation_id IN (${placeholders})`)
        .get(...(ids as never[])) as { count: number } | null;
      total += Number(count?.count ?? 0);
    }
    return total;
  }

  private countArchiveFullRows(ids: string[]): number {
    if (ids.length === 0 || !this.tableExists("mem_archive_stubs") || !this.tableExists("mem_archive_full")) {
      return 0;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const row = this.db
      .query(`
        SELECT COUNT(*) AS count
        FROM mem_archive_full f
        JOIN mem_archive_stubs s ON s.archive_id = f.archive_id
        WHERE s.observation_id IN (${placeholders})
      `)
      .get(...(ids as never[])) as { count: number } | null;
    return Number(row?.count ?? 0);
  }

  private countRestoreCapableArchiveFullObservations(ids: string[]): number {
    if (ids.length === 0 || !this.tableExists("mem_archive_stubs") || !this.tableExists("mem_archive_full")) {
      return 0;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const row = this.db
      .query(`
        SELECT COUNT(*) AS count
        FROM (
          SELECT DISTINCT s.observation_id
          FROM mem_archive_full f
          JOIN mem_archive_stubs s ON s.archive_id = f.archive_id
          WHERE s.observation_id IN (${placeholders})
            AND s.archive_state = 'archived'
            AND f.purged_at IS NULL
            AND f.payload_json IS NOT NULL
            AND trim(f.payload_json) <> ''
            AND trim(f.payload_json) <> '{}'
            AND f.payload_sha256 IS NOT NULL
            AND trim(f.payload_sha256) <> ''
        )
      `)
      .get(...(ids as never[])) as { count: number } | null;
    return Number(row?.count ?? 0);
  }

  private listMissingRestoreCapableArchiveIds(ids: string[]): string[] {
    if (ids.length === 0) {
      return [];
    }
    if (!this.tableExists("mem_archive_stubs") || !this.tableExists("mem_archive_full")) {
      return [...ids];
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .query<{ observation_id: string }, string[]>(`
        SELECT DISTINCT s.observation_id
        FROM mem_archive_full f
        JOIN mem_archive_stubs s ON s.archive_id = f.archive_id
        WHERE s.observation_id IN (${placeholders})
          AND s.archive_state = 'archived'
          AND f.purged_at IS NULL
          AND f.payload_json IS NOT NULL
          AND trim(f.payload_json) <> ''
          AND trim(f.payload_json) <> '{}'
          AND f.payload_sha256 IS NOT NULL
          AND trim(f.payload_sha256) <> ''
      `)
      .all(...ids);
    const present = new Set(rows.map((row) => row.observation_id));
    return ids.filter((id) => !present.has(id));
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
    if (request.safe_mode !== true && request.vector_search !== false) {
      await this.prepareSearchEmbedding(request.query || "");
    }
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

  /**
   * S81-C03: observation citation trace.
   * Resolves an observation back to its source event and (when possible)
   * to the CodeProvenance the event payload describes.
   */
  verifyObservation(request: {
    observation_id: string;
    include_private?: boolean;
    include_archived?: boolean;
    user_id?: string;
    team_id?: string;
  }): ApiResponse {
    const startedAt = performance.now();
    const result = verifyObservationTrace(this.db, request);
    const response = makeResponse(
      startedAt,
      [result as unknown as Record<string, unknown>],
      request as unknown as Record<string, unknown>,
      { verify_ok: result.ok }
    );
    if (!result.ok) {
      response.ok = false;
    }
    return response;
  }

  sessionsList(request: SessionsListRequest): ApiResponse {
    return this.sessionMgr.sessionsList(request);
  }

  sessionThread(request: SessionThreadRequest): ApiResponse {
    return this.sessionMgr.sessionThread(request);
  }

  adminForgetPlan(request: {
    project?: string;
    limit?: number;
    score_threshold?: number;
    protect_accessed?: boolean;
  }): ApiResponse {
    const startedAt = performance.now();
    const options: ForgetPolicyOptions = {
      dry_run: true,
      project: request.project,
      limit: request.limit,
      score_threshold: request.score_threshold,
      protect_accessed: request.protect_accessed,
    };
    const plan = runForgetPolicy(this.db, options);
    const candidateIds = plan.candidates.map((candidate) => candidate.observation_id);
    const impact = this.collectObservationLifecycleImpact(candidateIds);

    return makeResponse(
      startedAt,
      [{
        ...plan,
        mode: "dry_run_plan",
        hard_delete_supported: false,
        cross_store_impact: impact,
        safety: {
          mutates_memory: false,
          archive_first: true,
          hard_delete_requires_separate_risk_gate: true,
          legal_hold_trumps_ttl: true,
        },
      } as unknown as Record<string, unknown>],
      { ...request, dry_run: true },
      {
        candidate_count: candidateIds.length,
        scanned: plan.scanned,
        evicted: 0,
        ranking: "forget_plan_v1",
      } as Record<string, unknown>
    );
  }

  private isTempTestDatabase(): boolean {
    if (this.config.dbPath === ":memory:") {
      return true;
    }
    const resolvedDbPath = resolve(resolveHomePath(this.config.dbPath));
    const roots = [tmpdir(), "/tmp", "/private/tmp"].map((root) => resolve(root));
    return roots.some((root) => resolvedDbPath === root || resolvedDbPath.startsWith(`${root}/`));
  }

  private verifySqliteBackupIntegrity(backupPath: string): BackupEvidence["integrity_check"] {
    let backupDb: Database | null = null;
    try {
      backupDb = new Database(backupPath, { readonly: true });
      const row = backupDb
        .query(`PRAGMA integrity_check`)
        .get() as Record<string, string> | null;
      const result = row ? String(Object.values(row)[0] ?? "") : "";
      return {
        checked: true,
        ok: result === "ok",
        result: result || null,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        checked: true,
        ok: false,
        result: null,
        error: message,
      };
    } finally {
      try {
        backupDb?.close();
      } catch {
        // best effort
      }
    }
  }

  private resolveHardPurgeBackupEvidence(request: AdminHardPurgeRequest): BackupEvidence | { error: string } {
    const backupSha256Raw = typeof request.backup_sha256 === "string" ? request.backup_sha256.trim() : "";
    const backupSha256 = backupSha256Raw ? normalizeSha256(backupSha256Raw) : null;
    if (backupSha256Raw && !backupSha256) {
      return { error: "backup_sha256 must be a sha256 hex string" };
    }

    const backupPath = typeof request.backup_path === "string" && request.backup_path.trim()
      ? resolve(request.backup_path.trim())
      : null;
    if (backupPath) {
      if (!backupSha256) {
        return { error: "backup_sha256 is required when backup_path is provided" };
      }
      if (!existsSync(backupPath)) {
        return { error: "backup_path does not exist" };
      }
      const actual = sha256Hex(readFileSync(backupPath));
      if (actual !== backupSha256) {
        return { error: "backup_path sha256 does not match backup_sha256" };
      }
      const integrityCheck = this.verifySqliteBackupIntegrity(backupPath);
      if (!integrityCheck.ok) {
        return { error: `backup_path integrity_check failed: ${integrityCheck.error ?? integrityCheck.result ?? "unknown"}` };
      }
      return {
        provided: true,
        backup_sha256: backupSha256,
        backup_path: backupPath,
        temp_test_backup_token_sha256: null,
        kind: "backup_file",
        integrity_check: integrityCheck,
      };
    }

    const tempToken = typeof request.temp_test_backup_token === "string"
      ? request.temp_test_backup_token.trim()
      : "";
    if (tempToken) {
      if (!/^TEMP_TEST_BACKUP_[A-Za-z0-9_-]{8,}$/.test(tempToken)) {
        return { error: "temp_test_backup_token is invalid" };
      }
      if (!this.isTempTestDatabase()) {
        return { error: "temp_test_backup_token is allowed only for temp test databases" };
      }
      return {
        provided: true,
        backup_sha256: backupSha256,
        backup_path: backupPath,
        temp_test_backup_token_sha256: sha256Hex(tempToken),
        kind: "temp_test_token",
        integrity_check: {
          checked: false,
          ok: true,
          result: null,
          error: null,
        },
      };
    }

    if (backupSha256) {
      return {
        provided: false,
        backup_sha256: backupSha256,
        backup_path: null,
        temp_test_backup_token_sha256: null,
        kind: "sha256_metadata",
        integrity_check: {
          checked: false,
          ok: false,
          result: null,
          error: "backup_path is required for executable backup evidence",
        },
      };
    }

    return {
      provided: false,
      backup_sha256: null,
      backup_path: null,
      temp_test_backup_token_sha256: null,
      kind: "missing",
      integrity_check: {
        checked: false,
        ok: false,
        result: null,
        error: null,
      },
    };
  }

  private selectHardPurgeCandidateRows(request: AdminHardPurgeRequest): { ok: true; rows: HardPurgeCandidateRow[] } | { ok: false; error: string } {
    const targetIds = uniqueSortedStrings(request.target_ids);
    const limit = Math.min(Math.max(Math.trunc(request.limit ?? 100), 1), 500);
    const params: unknown[] = [];
    let rows: HardPurgeCandidateRow[] = [];

    if (targetIds.length > 500) {
      return { ok: false, error: "target_ids length exceeds maximum of 500" };
    }

    if (targetIds.length > 0) {
      const placeholders = targetIds.map(() => "?").join(", ");
      rows = this.db
        .query<HardPurgeCandidateRow, string[]>(`
          SELECT id, project, archived_at, privacy_tags_json, tags_json
          FROM mem_observations
          WHERE id IN (${placeholders})
          ORDER BY id ASC
        `)
        .all(...targetIds);
      const found = new Set(rows.map((row) => row.id));
      const missing = targetIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        return { ok: false, error: `hard purge target rows are missing: ${missing.join(", ")}` };
      }
    } else {
      let sql = `
        SELECT id, project, archived_at, privacy_tags_json, tags_json
        FROM mem_observations
        WHERE archived_at IS NOT NULL
      `;
      if (request.project) {
        sql += ` AND project = ?`;
        params.push(request.project);
      }
      sql += ` ORDER BY id ASC LIMIT ?`;
      params.push(limit);
      rows = this.db
        .query<HardPurgeCandidateRow, SQLQueryBindings[]>(sql)
        .all(...(params as SQLQueryBindings[]));
    }

    if (request.project) {
      const mismatched = rows.filter((row) => row.project !== request.project).map((row) => row.id);
      if (mismatched.length > 0) {
        return { ok: false, error: `hard purge target rows are outside project scope: ${mismatched.join(", ")}` };
      }
    }

    const unarchived = rows.filter((row) => !row.archived_at).map((row) => row.id);
    if (unarchived.length > 0) {
      return { ok: false, error: `hard purge rejects unarchived rows: ${unarchived.join(", ")}` };
    }

    const legalHold = rows
      .filter((row) => {
        const privacyTags = parseJsonStringArray(row.privacy_tags_json);
        const tags = parseJsonStringArray(row.tags_json);
        return privacyTags.includes("legal_hold") || tags.includes("legal_hold");
      })
      .map((row) => row.id);
    if (legalHold.length > 0) {
      return { ok: false, error: `hard purge rejects legal_hold rows: ${legalHold.join(", ")}` };
    }
    if (rows.length > 0 && this.tableExists("mem_archive_stubs")) {
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => "?").join(", ");
      const snapshotRows = this.db
        .query<{ observation_id: string }, string[]>(`
          SELECT observation_id
          FROM mem_archive_stubs
          WHERE observation_id IN (${placeholders})
            AND COALESCE(legal_hold_snapshot, 0) <> 0
          ORDER BY observation_id ASC
        `)
        .all(...ids);
      if (snapshotRows.length > 0) {
        return {
          ok: false,
          error: `hard purge rejects legal_hold archive snapshots: ${snapshotRows.map((row) => row.observation_id).join(", ")}`,
        };
      }
    }

    return { ok: true, rows };
  }

  private collectHardPurgeArchiveStatus(ids: string[]): HardPurgeManifest["archive"] {
    const archiveTablesPresent = this.tableExists("mem_archive_stubs") && this.tableExists("mem_archive_full");
    const archive: HardPurgeManifest["archive"] = {
      archive_tables_present: archiveTablesPresent,
      archived_only: true,
      archived_count: ids.length,
      archive_stub_count: 0,
      archive_full_count: 0,
      restore_capable_count: 0,
      restore_capable_full_count: 0,
      restore_capable_full_observation_count: 0,
      missing_restore_capable_archive_ids: [...ids],
      archive_states: {},
    };
    if (ids.length === 0 || !this.tableExists("mem_archive_stubs")) {
      return archive;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .query<{ archive_state: string; count: number }, string[]>(`
        SELECT archive_state, COUNT(*) AS count
        FROM mem_archive_stubs
        WHERE observation_id IN (${placeholders})
        GROUP BY archive_state
      `)
      .all(...ids);
    for (const row of rows) {
      archive.archive_states[row.archive_state || "unknown"] = Number(row.count ?? 0);
      archive.archive_stub_count += Number(row.count ?? 0);
    }
    archive.archive_full_count = this.countArchiveFullRows(ids);
    archive.restore_capable_count = Number(archive.archive_states.archived ?? 0);
    archive.restore_capable_full_count = this.countRestoreCapableArchiveFullObservations(ids);
    archive.restore_capable_full_observation_count = archive.restore_capable_full_count;
    archive.missing_restore_capable_archive_ids = this.listMissingRestoreCapableArchiveIds(ids);
    return archive;
  }

  private buildHardPurgeManifest(request: AdminHardPurgeRequest, rows: HardPurgeCandidateRow[]): HardPurgePrepareResult {
    const backupEvidence = this.resolveHardPurgeBackupEvidence(request);
    if ("error" in backupEvidence) {
      return { ok: false, error: backupEvidence.error };
    }

    const ids = rows.map((row) => row.id).sort();
    const minimumArchivedDays = Math.max(0, Math.trunc(request.retention_days ?? 0));
    const retentionMs = minimumArchivedDays * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const retentionBlockers = rows
      .map((row) => {
        if (!row.archived_at) {
          return { observation_id: row.id, archived_at: row.archived_at, reason: "not_archived" };
        }
        const archivedMs = Date.parse(row.archived_at);
        if (!Number.isFinite(archivedMs)) {
          return { observation_id: row.id, archived_at: row.archived_at, reason: "invalid_archived_at" };
        }
        if (retentionMs > 0 && nowMs - archivedMs < retentionMs) {
          return { observation_id: row.id, archived_at: row.archived_at, reason: "retention_window_not_elapsed" };
        }
        return null;
      })
      .filter((entry): entry is { observation_id: string; archived_at: string | null; reason: string } => entry !== null);

    const legalHoldBlockers = rows
      .filter((row) => {
        const privacyTags = parseJsonStringArray(row.privacy_tags_json);
        const tags = parseJsonStringArray(row.tags_json);
        return privacyTags.includes("legal_hold") || tags.includes("legal_hold");
      })
      .map((row) => row.id);

    const generatedAt = nowIso();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const stableManifest = {
      schema_version: "s127-hard-purge-v1" as const,
      operation: "admin.hard_purge" as const,
      project: request.project ?? null,
      candidate_ids: ids,
      candidate_count: ids.length,
      impact: this.collectObservationLifecycleImpact(ids),
      backup_sha256: backupEvidence.backup_sha256,
      backup: {
        required: true as const,
        provided: backupEvidence.provided,
        backup_sha256: backupEvidence.backup_sha256,
        backup_path: backupEvidence.backup_path,
        temp_test_backup_token_sha256: backupEvidence.temp_test_backup_token_sha256,
        kind: backupEvidence.kind,
        integrity_check: backupEvidence.integrity_check,
      },
      retention: {
        minimum_archived_days: minimumArchivedDays,
        satisfied: retentionBlockers.length === 0,
        blockers: retentionBlockers,
      },
      archive: this.collectHardPurgeArchiveStatus(ids),
      legal_hold: {
        allowed: legalHoldBlockers.length === 0,
        blockers: legalHoldBlockers,
      },
    };
    const manifestHash = sha256Hex(stableJson(stableManifest));
    const manifest: HardPurgeManifest = {
      ...stableManifest,
      generated_at: generatedAt,
      expires_at: expiresAt,
      manifest_hash: manifestHash,
      confirmation_phrase: `HARD_PURGE ${ids.length} OBSERVATIONS ${manifestHash.slice(0, 12)}`,
    };
    return { ok: true, manifest, rows };
  }

  private prepareHardPurgeManifest(request: AdminHardPurgeRequest): HardPurgePrepareResult {
    const selected = this.selectHardPurgeCandidateRows(request);
    if (!selected.ok) {
      return selected;
    }
    return this.buildHardPurgeManifest(request, selected.rows);
  }

  private assertHardPurgeExecuteGates(request: AdminHardPurgeRequest, manifest: HardPurgeManifest): string | null {
    if (request.execute !== true) {
      return null;
    }
    if (typeof request.manifest_hash !== "string" || !request.manifest_hash.trim()) {
      return "manifest_hash is required for hard purge execute";
    }
    const manifestHash = normalizeSha256(request.manifest_hash);
    if (!manifestHash) {
      return "manifest_hash must be a sha256 hex string";
    }
    if (manifestHash !== manifest.manifest_hash) {
      return "manifest_hash does not match current hard purge manifest";
    }
    if (typeof request.manifest_expires_at !== "string" || !request.manifest_expires_at.trim()) {
      return "manifest_expires_at is required for hard purge execute";
    }
    const plannedExpiresAt = this.hardPurgePlanExpirations.get(manifest.manifest_hash);
    if (!plannedExpiresAt) {
      return "manifest_hash has no active hard purge plan";
    }
    if (request.manifest_expires_at !== plannedExpiresAt) {
      return "manifest_expires_at does not match the active hard purge plan";
    }
    const manifestExpiresMs = Date.parse(request.manifest_expires_at);
    if (!Number.isFinite(manifestExpiresMs)) {
      return "manifest_expires_at must be a valid ISO timestamp";
    }
    if (Date.now() > manifestExpiresMs) {
      return "manifest_expires_at has expired for hard purge execute";
    }
    if (typeof request.candidate_count !== "number" || !Number.isFinite(request.candidate_count)) {
      return "candidate_count is required for hard purge execute";
    }
    if (Math.trunc(request.candidate_count) !== manifest.candidate_count) {
      return "candidate_count does not match current hard purge manifest";
    }
    if (manifest.candidate_count === 0) {
      return "hard purge execute requires at least one archived candidate";
    }
    if (request.retention_ack !== true) {
      return "retention_ack:true is required for hard purge execute";
    }
    if (request.archive_ack !== true) {
      return "archive_ack:true is required for hard purge execute";
    }
    if (!manifest.backup.provided) {
      return "backup_path plus backup_sha256, or temp_test_backup_token for temp DBs, is required for hard purge execute";
    }
    if (manifest.backup.kind === "backup_file" && !manifest.backup.integrity_check.ok) {
      return "backup integrity_check must be ok for hard purge execute";
    }
    if (!manifest.retention.satisfied) {
      return "retention window is not satisfied for hard purge execute";
    }
    if (
      !manifest.archive.archive_tables_present ||
      manifest.archive.archive_stub_count !== manifest.candidate_count ||
      manifest.archive.archive_full_count !== manifest.candidate_count ||
      manifest.archive.restore_capable_count !== manifest.candidate_count ||
      manifest.archive.restore_capable_full_count !== manifest.candidate_count ||
      manifest.archive.restore_capable_full_observation_count !== manifest.candidate_count ||
      manifest.archive.missing_restore_capable_archive_ids.length > 0 ||
      manifest.archive.archive_states.archived !== manifest.candidate_count
    ) {
      return "restore-capable archive stub and full archive row are required for every hard purge candidate";
    }
    if (!manifest.legal_hold.allowed) {
      return "legal_hold blocks hard purge execute";
    }
    if (request.confirmation !== manifest.confirmation_phrase) {
      return `confirmation must exactly equal: ${manifest.confirmation_phrase}`;
    }
    return null;
  }

  private runDelete(sql: string, values: unknown[] = []): number {
    this.db.query(sql).run(...(values as never[]));
    const row = this.db.query(`SELECT changes() AS changes`).get() as { changes: number } | null;
    return Number(row?.changes ?? 0);
  }

  private deleteSqliteVecRowsForHardPurge(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(", ");
    const mapTables = this.db
      .query<{ name: string }, []>(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND (name = 'mem_vectors_vec_map' OR name LIKE 'mem_vectors_vec_map_%')`,
      )
      .all()
      .filter((row) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name));

    let deleted = 0;
    for (const mapTableRow of mapTables) {
      const mapTable = this.quoteIdentifier(mapTableRow.name);
      const vecTableName = mapTableRow.name.replace(/^mem_vectors_vec_map/, "mem_vectors_vec");
      const vecTable = /^[A-Za-z_][A-Za-z0-9_]*$/.test(vecTableName) && this.tableExists(vecTableName)
        ? this.quoteIdentifier(vecTableName)
        : null;
      const rowIds = this.db
        .query<{ rowid: number }, string[]>(`SELECT rowid FROM ${mapTable} WHERE observation_id IN (${placeholders})`)
        .all(...ids)
        .map((row) => row.rowid)
        .filter((rowid) => typeof rowid === "number");

      if (rowIds.length > 0 && vecTable) {
        const rowPlaceholders = rowIds.map(() => "?").join(", ");
        deleted += this.runDelete(`DELETE FROM ${vecTable} WHERE rowid IN (${rowPlaceholders})`, rowIds);
      }
      deleted += this.runDelete(`DELETE FROM ${mapTable} WHERE observation_id IN (${placeholders})`, ids);
    }
    return deleted;
  }

  private executeHardPurgeCascade(manifest: HardPurgeManifest): Record<string, number> {
    const ids = manifest.candidate_ids;
    const placeholders = ids.map(() => "?").join(", ");
    const now = nowIso();
    const targetEntityIds = this.db
      .query<{ entity_id: number }, string[]>(
        `SELECT DISTINCT entity_id
         FROM mem_observation_entities
         WHERE observation_id IN (${placeholders})`,
      )
      .all(...ids)
      .map((row) => row.entity_id)
      .filter((entityId) => typeof entityId === "number");
    const counts: Record<string, number> = {
      sqlite_vec_rows: this.deleteSqliteVecRowsForHardPurge(ids),
      mem_nugget_vectors: this.runDelete(`DELETE FROM mem_nugget_vectors WHERE observation_id IN (${placeholders})`, ids),
      mem_nuggets: this.runDelete(`DELETE FROM mem_nuggets WHERE observation_id IN (${placeholders})`, ids),
      mem_vectors: this.runDelete(`DELETE FROM mem_vectors WHERE observation_id IN (${placeholders})`, ids),
      mem_links_touching: this.runDelete(
        `DELETE FROM mem_links WHERE from_observation_id IN (${placeholders}) OR to_observation_id IN (${placeholders})`,
        [...ids, ...ids],
      ),
      mem_relations: this.runDelete(`DELETE FROM mem_relations WHERE observation_id IN (${placeholders})`, ids),
      mem_tags: this.runDelete(`DELETE FROM mem_tags WHERE observation_id IN (${placeholders})`, ids),
      mem_observation_entities: this.runDelete(`DELETE FROM mem_observation_entities WHERE observation_id IN (${placeholders})`, ids),
      mem_facts: this.runDelete(`DELETE FROM mem_facts WHERE observation_id IN (${placeholders})`, ids),
      mem_events_deleted: 0,
      mem_events_unlinked: 0,
      mem_observations: 0,
      mem_entities_orphaned: 0,
      mem_archive_full_purged: 0,
      mem_archive_stubs_purged: 0,
    };

    const safeEventRows = this.db
      .query<{ event_id: string }, string[]>(`
        SELECT e.event_id
        FROM mem_events e
        WHERE e.observation_id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM mem_observations o
            WHERE o.event_id = e.event_id
              AND o.id NOT IN (${placeholders})
          )
      `)
      .all(...ids, ...ids);
    const safeEventIds = safeEventRows.map((row) => row.event_id);
    if (safeEventIds.length > 0) {
      const eventPlaceholders = safeEventIds.map(() => "?").join(", ");
      counts.mem_events_deleted = this.runDelete(
        `DELETE FROM mem_events WHERE event_id IN (${eventPlaceholders})`,
        safeEventIds,
      );
    }
    counts.mem_events_unlinked = this.runDelete(
      `UPDATE mem_events SET observation_id = NULL WHERE observation_id IN (${placeholders})`,
      ids,
    );

    counts.mem_observations = this.runDelete(`DELETE FROM mem_observations WHERE id IN (${placeholders})`, ids);
    if (targetEntityIds.length > 0) {
      const entityPlaceholders = targetEntityIds.map(() => "?").join(", ");
      counts.mem_entities_orphaned = this.runDelete(
        `DELETE FROM mem_entities
         WHERE id IN (${entityPlaceholders})
           AND NOT EXISTS (
             SELECT 1 FROM mem_observation_entities oe WHERE oe.entity_id = mem_entities.id
           )`,
        targetEntityIds,
      );
    }

    if (this.tableExists("mem_archive_stubs")) {
      if (this.tableExists("mem_archive_full")) {
        counts.mem_archive_full_purged = this.runDelete(
          `UPDATE mem_archive_full
           SET payload_json = '{}', purged_at = ?
           WHERE archive_id IN (
             SELECT archive_id FROM mem_archive_stubs WHERE observation_id IN (${placeholders})
           )`,
          [now, ...ids],
        );
      }
      counts.mem_archive_stubs_purged = this.runDelete(
        `UPDATE mem_archive_stubs
         SET archive_state = 'purged', purged_at = ?
         WHERE observation_id IN (${placeholders})`,
        [now, ...ids],
      );
    }

    this.writeAuditLog("admin.purge.execute", "observation", "", {
      manifest_hash: manifest.manifest_hash,
      candidate_count: manifest.candidate_count,
      candidate_ids: ids,
      backup_sha256: manifest.backup_sha256,
      backup_kind: manifest.backup.kind,
      counts,
    });

    return counts;
  }

  adminForgetHardPurge(request: AdminHardPurgeRequest): ApiResponse {
    const startedAt = performance.now();
    const initial = this.prepareHardPurgeManifest(request);
    if (!initial.ok) {
      return makeErrorResponse(startedAt, initial.error, request as unknown as Record<string, unknown>);
    }

    if (request.execute !== true) {
      const nowMs = Date.now();
      for (const [hash, expiresAt] of this.hardPurgePlanExpirations.entries()) {
        const expiresMs = Date.parse(expiresAt);
        if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
          this.hardPurgePlanExpirations.delete(hash);
        }
      }
      this.hardPurgePlanExpirations.set(initial.manifest.manifest_hash, initial.manifest.expires_at);
      return makeResponse(
        startedAt,
        [{
          mode: "hard_purge_plan",
          execute: false,
          ...initial.manifest,
        } as unknown as Record<string, unknown>],
        { ...request, execute: false },
        {
          candidate_count: initial.manifest.candidate_count,
          manifest_hash: initial.manifest.manifest_hash,
          ranking: "hard_purge_plan_v1",
        },
      );
    }

    const initialGateError = this.assertHardPurgeExecuteGates(request, initial.manifest);
    if (initialGateError) {
      return makeErrorResponse(startedAt, initialGateError, request as unknown as Record<string, unknown>);
    }

    let transactionStarted = false;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;

      const current = this.prepareHardPurgeManifest(request);
      if (!current.ok) {
        throw new Error(current.error);
      }
      const gateError = this.assertHardPurgeExecuteGates(request, current.manifest);
      if (gateError) {
        throw new Error(gateError);
      }

      const deleted_counts = this.executeHardPurgeCascade(current.manifest);
      this.hardPurgePlanExpirations.delete(current.manifest.manifest_hash);
      this.db.exec("COMMIT");
      transactionStarted = false;

      return makeResponse(
        startedAt,
        [{
          mode: "hard_purge_execute",
          execute: true,
          manifest_hash: current.manifest.manifest_hash,
          candidate_count: current.manifest.candidate_count,
          candidate_ids: current.manifest.candidate_ids,
          deleted_counts,
          restore_supported: false,
        } as unknown as Record<string, unknown>],
        { ...request, execute: true },
        {
          candidate_count: current.manifest.candidate_count,
          manifest_hash: current.manifest.manifest_hash,
          deleted_count: deleted_counts.mem_observations,
          ranking: "hard_purge_execute_v1",
        },
      );
    } catch (error) {
      if (transactionStarted) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Preserve the original failure.
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      return makeErrorResponse(startedAt, `hard purge execute failed: ${message}`, request as unknown as Record<string, unknown>);
    }
  }

  /**
   * 複数の observation を一括ソフトデリート（archived_at + deleted tag）する。
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
    const archivedAt = nowIso();
    for (const id of ids) {
      try {
        const existing = this.db.query(`SELECT id, privacy_tags_json, user_id, team_id FROM mem_observations WHERE id = ?`).get(id) as { id: string; privacy_tags_json: string; user_id: string; team_id: string | null } | null;
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
        const tags: string[] = existing.privacy_tags_json ? JSON.parse(existing.privacy_tags_json) : [];
        if (!tags.includes("deleted")) {
          tags.push("deleted");
        }
        this.db.query(`
          UPDATE mem_observations
          SET privacy_tags_json = ?, archived_at = COALESCE(archived_at, ?), updated_at = ?
          WHERE id = ?
        `).run(JSON.stringify(tags), archivedAt, archivedAt, id);
        deleted.push(id);
      } catch {
        skipped.push(id);
      }
    }
    if (deleted.length > 0) {
      this.writeAuditLog("admin.observation.bulk_delete", "observation", "", {
        ids: deleted,
        skipped,
        archived_at: archivedAt,
        user_id: request.user_id ?? "system",
        team_id: request.team_id ?? null,
      });
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
               event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at,
               superseded_by, created_at
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
        event_time: string | null;
        observed_at: string | null;
        valid_from: string | null;
        valid_to: string | null;
        supersedes: string | null;
        invalidated_at: string | null;
        superseded_by: string | null;
        created_at: string;
      }>;

      const entries = rows.map((row) => ({
        ...row,
        is_active:
          (row.superseded_by === null || row.superseded_by === undefined) &&
          row.valid_to === null &&
          row.invalidated_at === null,
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
            partial_finalize_enabled: this.config.partialFinalizeEnabled === true,
            partial_finalize_interval_ms: this.config.partialFinalizeIntervalMs
              ? Math.max(5000, Number(this.config.partialFinalizeIntervalMs))
              : 300_000,
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
    const currentVectorPredicate = this.vectorModelVersion.startsWith("adaptive:")
      ? "v.model LIKE 'adaptive:%'"
      : "v.model = ?";
    const currentVectorParams = this.vectorModelVersion.startsWith("adaptive:")
      ? []
      : [this.vectorModelVersion];

      const vectorCoverage = this.db
        .query(`
          SELECT
            (SELECT COUNT(*) FROM mem_vectors) AS mem_vectors_count,
            (SELECT COUNT(*) FROM mem_observations WHERE archived_at IS NULL) AS observations_count,
            (
              SELECT COUNT(DISTINCT o.id)
              FROM mem_observations o
              JOIN mem_vectors v ON v.observation_id = o.id
              WHERE o.archived_at IS NULL
                AND ${currentVectorPredicate}
            ) AS current_model_observations
        `)
        .get(...currentVectorParams) as {
          mem_vectors_count: number;
          observations_count: number;
          current_model_observations: number;
        } | null;
      const observationsCount = Number(vectorCoverage?.observations_count ?? 0);
      const currentModelObservations = Number(vectorCoverage?.current_model_observations ?? 0);
      const currentModelCoverage = observationsCount === 0 ? 1 : currentModelObservations / observationsCount;

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
              observations: observationsCount,
              mem_vectors: Number(vectorCoverage?.mem_vectors_count ?? 0),
              current_model_observations: currentModelObservations,
              vector_coverage: currentModelCoverage,
              target_coverage: 0.95,
              missing_current_model_vectors: Math.max(0, observationsCount - currentModelObservations),
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
    if ((request.reason || "manual") === "scheduler" && this.vectorBackfillWorker?.isRunning() === true) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        skipped: "vector_backfill_running",
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

    // S81-B03 (Codex round 12 P2): run contradiction detection BEFORE
    // forget_policy. If forget archived rows first, detectContradictions
    // (which filters `archived_at IS NULL`) would never see pairs that
    // involve a just-archived row, silently dropping findings in a
    // combined run.
    let contradiction: ContradictionDetectorResult | undefined;
    if (request.contradiction_scan) {
      const adjudicator = await this.buildContradictionAdjudicator();
      contradiction = await detectContradictions(this.db, {
        jaccard_threshold: request.contradiction_scan.jaccard_threshold,
        min_confidence: request.contradiction_scan.min_confidence,
        max_pairs_per_group: request.contradiction_scan.max_pairs_per_group,
        project: request.project,
        adjudicator,
      });
      try {
        this.writeAuditLog("admin.contradiction_scan.run", "observation", "", {
          scanned_groups: contradiction.scanned_groups,
          candidate_pairs: contradiction.candidate_pairs,
          confirmed: contradiction.contradictions.length,
          links_created: contradiction.links_created,
          jaccard_threshold: contradiction.jaccard_threshold,
          min_confidence: contradiction.min_confidence,
          project: request.project,
        });
      } catch {
        // best effort
      }
      // §S109-002 (b): persist one InjectEnvelope (kind=contradiction,
      // action_hint=warn_user_before_act) per confirmed pair into
      // inject_traces. Side-effect only — the consolidation_run response
      // shape is unchanged. Downstream surfaces (S109-003) read traces
      // back to compute consumed_rate.
      try {
        recordContradictionEnvelopes(
          this.db,
          contradiction,
          request.session_id,
        );
      } catch {
        // best effort: never let envelope persistence break consolidation.
      }
    }

    // S81-B02: Opt-in low-value eviction policy. Runs *after* the normal
    // consolidation pass AND after contradiction detection so fact
    // extraction, dedupe, and contradiction findings complete against
    // the full observation set first. Dry-run by default; wet mode
    // additionally requires HARNESS_MEM_AUTO_FORGET=1.
    let forget: ForgetPolicyResult | undefined;
    if (request.forget_policy) {
      forget = runForgetPolicy(
        this.db,
        {
          dry_run: request.forget_policy.dry_run,
          score_threshold: request.forget_policy.score_threshold,
          weights: request.forget_policy.weights,
          limit: request.forget_policy.limit,
          protect_accessed: request.forget_policy.protect_accessed,
          project: request.project,
        },
        (action, details) => {
          try {
            this.writeAuditLog(action, "observation", "", details);
          } catch {
            // best effort
          }
        }
      );
    }

    return makeResponse(
      startedAt,
      [
        {
          ...stats,
          reason: options.reason,
          ...(forget ? { forget_policy: forget } : {}),
          ...(contradiction ? { contradiction_scan: contradiction } : {}),
        },
      ],
      request as unknown as Record<string, unknown>,
      { ranking: "consolidation_v1" }
    );
  }

  /**
   * S81-B03: build the LLM-backed adjudicator used by contradiction
   * detection. Attempts the Claude Agent SDK provider (S81-C02) first, then
   * degrades gracefully: on any provider failure the pair is reported as
   * `{contradiction: false, confidence: 0}` so a flaky LLM can never create
   * spurious `superseded` links.
   */
  private async buildContradictionAdjudicator(): Promise<ContradictionAdjudicator> {
    // S81-B03 hardening: Codex round 2 P1 対応。
    // claude-agent-sdk が import できただけでは認証が通っている保証は
    // ないため (未ログイン / トークン失効で import は成功するが
    // generate が毎回失敗する)、adjudicator 側でランタイム失敗を検知し
    // openai/ollama への自動切替を行う。
    let primary: Awaited<ReturnType<typeof createClaudeProviderAsync>> | null = null;
    let primaryIsClaudeSDK = false;
    try {
      primary = await createClaudeProviderAsync({ provider: "anthropic" });
      // createClaudeProviderAsync returns the native Agent SDK provider
      // when available, otherwise it degrades to the registry default
      // (openai or ollama). Only the SDK case warrants spinning up a
      // separate non-claude fallback — otherwise primary and fallback
      // would be the same backend and every contradiction pair would
      // pay two failing network calls (Codex round 10 P2).
      primaryIsClaudeSDK = primary?.name === "claude-agent-sdk";
    } catch {
      primary = null;
    }
    // Non-claude fallback: only attempted when the primary is the
    // Claude SDK. If the SDK is unavailable, primary IS already the
    // registry default, so duplicating it would only add latency.
    let fallback: ReturnType<typeof createLLMProvider> | null = null;
    const ensureFallback = (): ReturnType<typeof createLLMProvider> | null => {
      if (fallback) return fallback;
      if (!primaryIsClaudeSDK) return null;
      try {
        fallback = createLLMProvider({ provider: undefined });
        if (fallback === primary) fallback = null;
      } catch {
        fallback = null;
      }
      return fallback;
    };

    if (!primary && !ensureFallback()) {
      return () => ({ contradiction: false, confidence: 0, reason: "llm unavailable" });
    }

    let primaryConsecutiveFailures = 0;
    const PRIMARY_FAILURE_BUDGET = 2;
    let primaryDisabled = !primary;

    const runOne = async (
      p: ReturnType<typeof createLLMProvider>,
      prompt: string
    ): Promise<{
      contradiction: boolean;
      confidence: number;
      reason: string;
    }> => {
      const raw = (await p.generate(prompt, { maxTokens: 80 })).trim();
      return parseContradictionVerdict(raw);
    };

    return async (a, b) => {
      const prompt = [
        "You are reviewing two observations that share a concept and have near-identical content.",
        "Decide if they contradict (i.e., one fact supersedes the other).",
        `Observation A (${a.observation_id}, ${a.created_at}):\n${a.content}`,
        `Observation B (${b.observation_id}, ${b.created_at}):\n${b.content}`,
        'Respond with STRICT JSON: {"contradiction": true|false, "reason": "<short explanation>"}. No other text.',
      ].join("\n\n");

      // 1) Primary (Claude SDK or registry default).
      if (!primaryDisabled && primary) {
        try {
          const verdict = await runOne(primary, prompt);
          primaryConsecutiveFailures = 0;
          return verdict;
        } catch {
          primaryConsecutiveFailures += 1;
          if (primaryConsecutiveFailures >= PRIMARY_FAILURE_BUDGET) {
            primaryDisabled = true;
          }
        }
      }

      // 2) Fallback (openai / ollama) — try once per call when primary failed
      // or is disabled. Lazy initialize so environments with a healthy
      // primary never pay the fallback setup cost.
      const fb = ensureFallback();
      if (fb) {
        try {
          return await runOne(fb, prompt);
        } catch {
          return { contradiction: false, confidence: 0, reason: "llm error (fallback failed)" };
        }
      }

      return { contradiction: false, confidence: 0, reason: "llm error" };
    };
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

    reindexVectors(limitInput?: number, options?: ReindexVectorsOptions): Promise<ApiResponse> {
      return this.cfgMgr.reindexVectors(limitInput, options);
    }

    repairSqliteVecMap(options: RepairSqliteVecMapOptions = {}): ApiResponse {
      return this.cfgMgr.repairSqliteVecMap(options);
    }

    startVectorBackfillWorker(options: VectorBackfillStartOptions = {}): ApiResponse {
      return this.vectorBackfillWorker.start(options);
    }

    stopVectorBackfillWorker(): ApiResponse {
      return this.vectorBackfillWorker.stop();
    }

    getVectorBackfillWorkerStatus(): ApiResponse {
      return this.vectorBackfillWorker.status();
    }

    cleanupDuplicateObservations(request: CleanupDuplicatesRequest = {}): ApiResponse {
      return this.cfgMgr.cleanupDuplicateObservations(request);
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

    // S78-D02: "supersedes" — (A, B, 'supersedes') means A supersedes B (B is made stale by A).
    // S81-B03: "superseded" — contradiction-detection output, newer → older, flagging older as demoted.
    // Both relation types coexist for the dual-ship of §78-D02 (independent supersedes API) and
    // §81-B03 (Jaccard+LLM detection writes). Downstream consumers must handle either.
    const validRelations: string[] = [
      "updates",
      "extends",
      "derives",
      "follows",
      "shared_entity",
      "contradicts",
      "causes",
      "part_of",
      "supersedes",
      "superseded",
    ];
    if (!validRelations.includes(relation)) {
      return makeErrorResponse(startedAt, `invalid relation type: ${relation}. Must be one of: ${validRelations.join(", ")}`, request as unknown as Record<string, unknown>);
    }

    try {
      const current = nowIso();
      const eventTime = normalizeTemporalTimestamp(request.event_time);
      const observedAt = normalizeTemporalTimestamp(request.observed_at) ?? current;
      const validFrom = normalizeTemporalTimestamp(request.valid_from);
      const validTo = normalizeTemporalTimestamp(request.valid_to);
      const supersedes =
        typeof request.supersedes === "string" && request.supersedes.trim()
          ? request.supersedes.trim()
          : relation === "supersedes"
            ? to_observation_id
            : null;
      const invalidatedAt = normalizeTemporalTimestamp(request.invalidated_at);

      this.db
        .query(`
          INSERT OR IGNORE INTO mem_links(
            from_observation_id, to_observation_id, relation, weight,
            event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          from_observation_id,
          to_observation_id,
          relation,
          weight,
          eventTime,
          observedAt,
          validFrom,
          validTo,
          supersedes,
          invalidatedAt,
          current,
        );

      return makeResponse(
        startedAt,
        [{
          from_observation_id,
          to_observation_id,
          relation,
          weight,
          event_time: eventTime,
          observed_at: observedAt,
          valid_from: validFrom,
          valid_to: validTo,
          supersedes,
          invalidated_at: invalidatedAt,
          created_at: current,
        }],
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
        event_time: string | null;
        observed_at: string | null;
        valid_from: string | null;
        valid_to: string | null;
        supersedes: string | null;
        invalidated_at: string | null;
        created_at: string;
      };

      const allRows: LinkRow[] = [];
      // BFS: フロンティアとして処理済みの observation_id を管理（循環防止）
      const processedIds = new Set<string>([observation_id]);
      let frontier = [observation_id];

      for (let d = 0; d < depth && frontier.length > 0; d++) {
        const placeholders = frontier.map(() => "?").join(", ");
        let sql = `
          SELECT from_observation_id, to_observation_id, relation, weight,
                 event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at,
                 created_at
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

  ingestHermesState(request: HermesStateIngestRequest): Promise<ApiResponse> {
    return this.ingestCoord.ingestHermesState(request);
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
    /** §78-D01: optional ISO timestamp after which the observation expires. */
    expires_at?: string;
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

    // §91-002: stop partial-finalize scheduler before stopping ingest timers
    this.partialFinalizeScheduler.stop();
    // S89-003: stop reindex backfill scheduler
    this.reindexVectorsScheduler.stop();
    if (process.env.HARNESS_MEM_VECTOR_BACKFILL_CHILD !== "1") {
      this.vectorBackfillWorker.stop();
    }
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
      const pruneParams: unknown[] = project ? [now, now, now, project] : [now, now, now];

      const result = this.db.query(
        `UPDATE mem_facts
         SET valid_to = ?, invalidated_at = ?, updated_at = ?
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
