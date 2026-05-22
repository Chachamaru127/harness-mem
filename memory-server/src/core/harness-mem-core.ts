import { createHash } from "node:crypto";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { spawn as spawnChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
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
import { getTelemetryStatus, hashTelemetryValue, recordRecallTelemetry } from "../telemetry/otel";
import { SessionManager, buildCheckpointEvent } from "./session-manager";
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
  hasPrivateVisibilityTag,
  makeErrorResponse,
  makeResponse,
  normalizeTemporalTimestamp,
  normalizeVectorDimension,
  nowIso,
  parseArrayJson,
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
import {
  buildRecallProjectionPlan,
  clearRecallProjection,
  materializeRecallProjection,
  readRecallDataWatermark,
  type RecallProjectionPlan,
} from "../recall/projection.js";

const VECTOR_MODEL_VERSION = "local-hash-v3";
const HEARTBEAT_FILE = "~/.harness-mem/daemon.heartbeat";
const DEFAULT_ENVIRONMENT_CACHE_TTL_MS = 20_000;
const DEFAULT_SEARCH_CHILD_TIMEOUT_MS = 20_000;
const DEFAULT_SEARCH_CHILD_QUEUE_MAX = 1;
const DEFAULT_SEARCH_WORKER_TIMEOUT_MS = 3_000;
const DEFAULT_SEARCH_WORKER_STARTUP_TIMEOUT_MS = 20_000;
const DEFAULT_SEARCH_WORKER_QUEUE_MAX = 2;
const DEFAULT_EVENT_CHILD_TIMEOUT_MS = 8_000;
const DEFAULT_EVENT_CHILD_QUEUE_MAX = 1;
const DEFAULT_RETRY_CHILD_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_CHILD_QUEUE_MAX = 1;
const DEFAULT_CHECKPOINT_CHILD_TIMEOUT_MS = 8_000;
const DEFAULT_CHECKPOINT_CHILD_QUEUE_MAX = 1;
const DEFAULT_MATERIALIZE_CHILD_TIMEOUT_MS = 30_000;
const DEFAULT_MATERIALIZE_CHILD_QUEUE_MAX = 1;
const DEFAULT_PROJECTS_STATS_CHILD_TIMEOUT_MS = 8_000;
const DEFAULT_PROJECTS_STATS_CHILD_QUEUE_MAX = 1;
const DEFAULT_RUNTIME_WARNING_TTL_MS = 60_000;
const DEFAULT_REPEAT_RECALL_CACHE_TTL_MS = 60_000;
const MAX_REPEAT_RECALL_CACHE_TTL_MS = 300_000;
const REPEAT_RECALL_CACHE_CAPACITY = 128;
const RECALL_DEGRADATION_MANIFEST = {
  version: "recall_degradation_v1",
  recall_sla_latency_ms: 200,
  projection_sla_latency_ms: 50,
  ready_probe_policy: "no_exact_db_counts",
  reasons: [
    {
      code: "scope_required",
      fallback_path: "none",
      retryable: true,
      user_action: "send project or session_id, or set forensic=true for broad search",
    },
    {
      code: "projection_missing",
      fallback_path: "observation_search",
      retryable: true,
      user_action: "run recall projection refresh for the scoped project",
    },
    {
      code: "projection_stale",
      fallback_path: "observation_search",
      retryable: true,
      user_action: "refresh recall projection",
    },
    {
      code: "projection_no_match",
      fallback_path: "observation_search",
      retryable: false,
      user_action: "narrow query or refresh projection if new data was just recorded",
    },
    {
      code: "projection_project_scope_required",
      fallback_path: "observation_search",
      retryable: true,
      user_action: "send project scope for projection recall",
    },
    {
      code: "projection_access_filter_unsupported",
      fallback_path: "observation_search",
      retryable: false,
      user_action: "use observation search until projection stores user/team fields",
    },
    {
      code: "vector_unavailable",
      fallback_path: "lexical_or_projection",
      retryable: true,
      user_action: "check vector engine readiness; recall must still return lexical/projection results",
    },
    {
      code: "worker_timeout",
      fallback_path: "in_process_or_lexical",
      retryable: true,
      user_action: "retry or lower limit; recall must not block health readiness",
    },
    {
      code: "queue_full",
      fallback_path: "bounded_retry",
      retryable: true,
      user_action: "retry after the reported retry window",
    },
    {
      code: "otel_exporter_down",
      fallback_path: "local_no_export",
      retryable: true,
      user_action: "fix telemetry exporter; recall result path must continue",
    },
  ],
};
type EmbeddingPrimeMode = "passage" | "query";
type EmbeddingReadinessState = "not_required" | "ready" | "warming" | "failed";
interface RepeatRecallCacheEntry {
  storedAtMs: number;
  ttlMs: number;
  keyHash: string;
  knobsHash: string;
  dataWatermark: string;
  response: ApiResponse;
}
interface RepeatRecallCacheCandidate {
  key: string;
  keyHash: string;
  knobsHash: string;
  dataWatermark: string;
  ttlMs: number;
}
interface RecallRuntimeRequest {
  query: string;
  project?: string;
  session_id?: string;
  limit?: number;
  include_private?: boolean;
  forensic?: boolean;
  safe_mode?: boolean;
  user_id?: string;
  team_id?: string;
}
interface RecallProjectionSearchRow {
  recall_id: string;
  recall_type: string;
  project: string;
  workspace: string | null;
  tenant: string | null;
  session_id: string | null;
  source_type: string;
  source_id: string;
  source_ref: string;
  projection_generation: string;
  title: string | null;
  content_redacted: string;
  source_created_at: string | null;
  projected_at: string;
  valid_from: string | null;
  valid_to: string | null;
  privacy_tags_json: string | null;
  metadata_json: string | null;
}
interface RecallProjectionRunRow {
  generation: string;
  source_watermark: string;
  completed_at: string | null;
}
type RecallExplanationReason =
  | "scope_match"
  | "type_match"
  | "source_match"
  | "lexical_match"
  | "adr_provenance"
  | "work_ref"
  | "degraded_fallback";

export function buildVectorBackfillChildCommand(
  scriptPath: string,
  operation: VectorBackfillOperation,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath, JSON.stringify(operation)];
  return platform === "win32" ? runCommand : ["nice", "-n", "10", ...runCommand];
}

export function buildSearchChildCommand(
  scriptPath: string,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath];
  return runCommand;
}

export function buildSearchWorkerCommand(
  scriptPath: string,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath];
  return runCommand;
}

export function buildCheckpointChildCommand(
  scriptPath: string,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath];
  return runCommand;
}

export function buildMaterializeObservationChildCommand(
  scriptPath: string,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath];
  return platform === "win32" ? runCommand : ["nice", "-n", "10", ...runCommand];
}

export function buildEventChildCommand(
  scriptPath: string,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath];
  return runCommand;
}

export function buildRetryChildCommand(
  scriptPath: string,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath];
  return runCommand;
}

export function buildProjectsStatsChildCommand(
  scriptPath: string,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath];
  return runCommand;
}

function envTruthy(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function envFalsy(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no";
}

export function shouldRunSearchOutOfProcess(
  request: SearchRequest,
  options: {
    vectorEngine: VectorEngine;
    dbPath: string;
    env?: Record<string, string | undefined>;
  },
): boolean {
  const env = options.env ?? process.env;
  if (envTruthy(env.HARNESS_MEM_SEARCH_CHILD_PROCESS)) return false;
  if (envTruthy(env.HARNESS_MEM_SEARCH_WORKER_PROCESS)) return false;
  if (!options.dbPath || options.dbPath === ":memory:") return false;
  if (options.vectorEngine === "disabled") return false;

  const override = env.HARNESS_MEM_SEARCH_OFFLOAD;
  if (envFalsy(override)) return false;
  if (envTruthy(override)) return true;
  if (env.NODE_ENV === "test") return false;

  // Safe-mode search disables vector/graph expansion, but it can still be an
  // expensive scoped lexical scan on large local DBs. Keep it off the daemon
  // event loop in normal runtime so health/readiness stays responsive.
  if (request.safe_mode === true) return true;

  return true;
}

export function shouldUsePersistentSearchWorker(options: {
  vectorEngine: VectorEngine;
  dbPath: string;
  env?: Record<string, string | undefined>;
}): boolean {
  const env = options.env ?? process.env;
  if (envTruthy(env.HARNESS_MEM_SEARCH_CHILD_PROCESS)) return false;
  if (envTruthy(env.HARNESS_MEM_SEARCH_WORKER_PROCESS)) return false;
  if (!options.dbPath || options.dbPath === ":memory:") return false;
  if (options.vectorEngine === "disabled") return false;

  const override = env.HARNESS_MEM_SEARCH_WORKER;
  if (envFalsy(override)) return false;
  if (envTruthy(override)) return true;
  if (env.NODE_ENV === "test") return false;

  return true;
}

export function shouldRunCheckpointOutOfProcess(options: {
  dbPath: string;
  env?: Record<string, string | undefined>;
}): boolean {
  const env = options.env ?? process.env;
  if (envTruthy(env.HARNESS_MEM_CHECKPOINT_CHILD_PROCESS)) return false;
  if (!options.dbPath || options.dbPath === ":memory:") return false;

  const override = env.HARNESS_MEM_CHECKPOINT_OFFLOAD;
  if (envFalsy(override)) return false;
  if (envTruthy(override)) return true;
  if (env.NODE_ENV === "test") return false;

  return true;
}

export function shouldRunEventOutOfProcess(options: {
  dbPath: string;
  env?: Record<string, string | undefined>;
}): boolean {
  const env = options.env ?? process.env;
  if (envTruthy(env.HARNESS_MEM_EVENT_CHILD_PROCESS)) return false;
  if (envTruthy(env.HARNESS_MEM_CHECKPOINT_CHILD_PROCESS)) return false;
  if (!options.dbPath || options.dbPath === ":memory:") return false;

  const override = env.HARNESS_MEM_EVENT_OFFLOAD;
  if (envFalsy(override)) return false;
  if (envTruthy(override)) return true;
  if (env.NODE_ENV === "test") return false;

  return true;
}

export function shouldRunRetryQueueOutOfProcess(options: {
  dbPath: string;
  env?: Record<string, string | undefined>;
}): boolean {
  const env = options.env ?? process.env;
  if (envTruthy(env.HARNESS_MEM_RETRY_CHILD_PROCESS)) return false;
  if (!options.dbPath || options.dbPath === ":memory:") return false;

  const override = env.HARNESS_MEM_RETRY_OFFLOAD;
  if (envFalsy(override)) return false;
  if (envTruthy(override)) return true;
  if (env.NODE_ENV === "test") return false;

  return true;
}

export function shouldRunProjectsStatsOutOfProcess(options: {
  dbPath: string;
  env?: Record<string, string | undefined>;
}): boolean {
  const env = options.env ?? process.env;
  if (envTruthy(env.HARNESS_MEM_PROJECTS_STATS_CHILD_PROCESS)) return false;
  if (!options.dbPath || options.dbPath === ":memory:") return false;

  const override = env.HARNESS_MEM_PROJECTS_STATS_OFFLOAD;
  if (envFalsy(override)) return false;
  if (envTruthy(override)) return true;
  if (env.NODE_ENV === "test") return false;

  return true;
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

type SearchOffloadMode = "child_process" | "persistent_worker";

interface SearchWorkerRequestEnvelope {
  id: string;
  request: SearchRequest;
}

interface SearchWorkerResponseEnvelope {
  id?: string;
  ok?: boolean;
  response?: ApiResponse;
  error?: string;
  type?: "ready" | "warmup";
  pid?: number;
  warmup_ms?: number | null;
  warmup_error?: string;
}

interface SearchWorkerResult {
  response: ApiResponse;
  ready_at_start: boolean;
  pid: number | null;
  warmup_ms: number | null;
}

interface PendingSearchWorkerRequest {
  resolve: (value: SearchWorkerResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  readyAtStart: boolean;
}

class SearchOffloadQueueFullError extends Error {
  readonly code = "SEARCH_OFFLOAD_QUEUE_FULL";

  constructor(
    readonly queueName: string,
    readonly pending: number,
    readonly maxPending: number,
  ) {
    super(`${queueName} queue full: ${pending}/${maxPending}`);
    this.name = "SearchOffloadQueueFullError";
  }
}

function isSearchOffloadQueueFull(error: unknown): error is SearchOffloadQueueFullError {
  return error instanceof SearchOffloadQueueFullError;
}

class SearchOffloadUnavailableError extends Error {
  readonly code = "SEARCH_OFFLOAD_UNAVAILABLE";

  constructor(
    readonly queueName: string,
    readonly reason: string,
  ) {
    super(`${queueName} unavailable: ${reason}`);
    this.name = "SearchOffloadUnavailableError";
  }
}

function isSearchOffloadUnavailable(error: unknown): error is SearchOffloadUnavailableError {
  return error instanceof SearchOffloadUnavailableError;
}

type SearchWorkerProcess = ReturnType<typeof Bun.spawn>;
type SearchWorkerStdin = {
  write: (chunk: Uint8Array | string) => unknown;
  flush?: () => unknown;
  end?: () => unknown;
};

function truncateTail(value: string, maxLength = 4_000): string {
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}

function firstResponseObservationId(response: ApiResponse): string | null {
  const first = Array.isArray(response.items) ? response.items[0] : null;
  if (!first || typeof first !== "object") {
    return null;
  }
  const item = first as Record<string, unknown>;
  const id = item.id ?? item.observation_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

async function writeJsonToChildStdin(
  stdinWriter: SearchWorkerStdin | null | undefined,
  payload: unknown,
): Promise<void> {
  if (!stdinWriter) {
    throw new Error("child stdin unavailable");
  }
  const written = stdinWriter.write(`${JSON.stringify(payload)}\n`);
  if (written instanceof Promise) {
    await written;
  }
  const flushed = stdinWriter.flush?.();
  if (flushed instanceof Promise) {
    await flushed;
  }
  stdinWriter.end?.();
}

function readNodeChildStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function writeJsonToNodeChildStdin(
  stdinWriter: NodeJS.WritableStream | null | undefined,
  payload: unknown,
): void {
  if (!stdinWriter) {
    throw new Error("child stdin unavailable");
  }
  stdinWriter.end(`${JSON.stringify(payload)}\n`);
}

class PersistentSearchWorkerClient {
  private proc: SearchWorkerProcess | null = null;
  private stdinWriter: SearchWorkerStdin | null = null;
  private readonly pending = new Map<string, PendingSearchWorkerRequest>();
  private readonly encoder = new TextEncoder();
  private sequence = 0;
  private ready = false;
  private warmupComplete = false;
  private workerPid: number | null = null;
  private warmupMs: number | null = null;
  private stderrTail = "";

  constructor(
    private readonly options: {
      scriptPath: string;
      cwd: string;
      env: Record<string, string | undefined>;
      maxPending: number;
    },
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  isWarmupComplete(): boolean {
    return this.warmupComplete;
  }

  pendingDepth(): number {
    return this.pending.size;
  }

  ensureStarted(): void {
    if (this.proc && this.stdinWriter) {
      return;
    }
    const proc = Bun.spawn({
      cmd: buildSearchWorkerCommand(this.options.scriptPath),
      cwd: this.options.cwd,
      env: {
        ...this.options.env,
        HARNESS_MEM_SEARCH_CHILD_PROCESS: "1",
        HARNESS_MEM_SEARCH_WORKER_PROCESS: "1",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.proc = proc;
    this.ready = false;
    this.warmupComplete = false;
    this.workerPid = typeof proc.pid === "number" ? proc.pid : null;
    this.warmupMs = null;
    this.stderrTail = "";
    if (!proc.stdin) {
      this.killCurrentWorker("search worker stdin unavailable");
      throw new Error("search worker stdin unavailable");
    }
    this.stdinWriter = proc.stdin as SearchWorkerStdin;
    void this.readStdout(proc);
    void this.readStderr(proc);
    void proc.exited.then(
      (exitCode) => this.handleExit(proc, exitCode),
      (error) => this.handleExit(proc, null, error),
    );
  }

  async request(request: SearchRequest, timeoutMs: number): Promise<SearchWorkerResult> {
    this.ensureStarted();
    if (!this.proc || !this.stdinWriter) {
      throw new Error("search worker did not start");
    }
    if (this.pending.size >= this.options.maxPending) {
      throw new SearchOffloadQueueFullError("search worker", this.pending.size, this.options.maxPending);
    }

    const id = `search-${Date.now()}-${++this.sequence}`;
    const readyAtStart = this.ready;
    const envelope: SearchWorkerRequestEnvelope = { id, request };
    const payload = this.encoder.encode(`${JSON.stringify(envelope)}\n`);
    const promise = new Promise<SearchWorkerResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        reject(new Error(`search worker request timed out after ${timeoutMs}ms`));
        this.killCurrentWorker(`request timeout after ${timeoutMs}ms`);
      }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        readyAtStart,
      });
    });

    try {
      const written = this.stdinWriter.write(payload);
      if (written instanceof Promise) {
        await written;
      }
      const flushed = this.stdinWriter.flush?.();
      if (flushed instanceof Promise) {
        await flushed;
      }
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      this.killCurrentWorker(error instanceof Error ? error.message : String(error));
      throw error;
    }

    return promise;
  }

  stop(reason = "shutdown"): void {
    this.killCurrentWorker(reason);
  }

  private async readStdout(proc: SearchWorkerProcess): Promise<void> {
    const stdout = proc.stdout;
    if (!stdout || typeof stdout === "number") {
      return;
    }
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        buffer = this.consumeStdoutBuffer(buffer);
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        this.handleWorkerLine(buffer.trim());
      }
    } catch (error) {
      if (this.proc === proc) {
        this.killCurrentWorker(error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async readStderr(proc: SearchWorkerProcess): Promise<void> {
    const stderr = proc.stderr;
    if (!stderr || typeof stderr === "number") {
      return;
    }
    try {
      const text = await new Response(stderr).text();
      if (text.trim()) {
        this.stderrTail = truncateTail(`${this.stderrTail}\n${text.trim()}`);
      }
    } catch {
      // best effort: stderr exists only to improve fallback diagnostics.
    }
  }

  private consumeStdoutBuffer(buffer: string): string {
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      if (line) {
        this.handleWorkerLine(line);
      }
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
    return buffer;
  }

  private handleWorkerLine(line: string): void {
    if (!line.startsWith("{")) {
      return;
    }
    let message: SearchWorkerResponseEnvelope;
    try {
      message = JSON.parse(line) as SearchWorkerResponseEnvelope;
    } catch {
      this.stderrTail = truncateTail(`${this.stderrTail}\n${line}`);
      return;
    }

    if (message.type === "ready") {
      this.ready = true;
      this.workerPid = typeof message.pid === "number" ? message.pid : this.workerPid;
      this.warmupMs = typeof message.warmup_ms === "number" ? message.warmup_ms : null;
      if (message.warmup_error) {
        this.stderrTail = truncateTail(`${this.stderrTail}\nwarmup: ${message.warmup_error}`);
      }
      return;
    }

    if (message.type === "warmup") {
      this.workerPid = typeof message.pid === "number" ? message.pid : this.workerPid;
      this.warmupComplete = true;
      this.warmupMs = typeof message.warmup_ms === "number" ? message.warmup_ms : this.warmupMs;
      if (message.warmup_error) {
        this.stderrTail = truncateTail(`${this.stderrTail}\nwarmup: ${message.warmup_error}`);
      }
      return;
    }

    if (typeof message.id !== "string") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok === true && message.response) {
      pending.resolve({
        response: message.response,
        ready_at_start: pending.readyAtStart,
        pid: this.workerPid,
        warmup_ms: this.warmupMs,
      });
      return;
    }
    pending.reject(new Error(message.error || "search worker returned an error"));
  }

  private handleExit(proc: SearchWorkerProcess, exitCode: number | null, error?: unknown): void {
    if (this.proc !== proc) {
      return;
    }
    const detail = error instanceof Error
      ? error.message
      : `exit ${exitCode ?? "unknown"}`;
    const stderr = this.stderrTail.trim();
    this.proc = null;
    this.stdinWriter = null;
    this.ready = false;
    this.warmupComplete = false;
    this.workerPid = null;
    this.rejectAllPending(
      new Error(`search worker stopped (${detail})${stderr ? `: ${stderr}` : ""}`),
    );
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private killCurrentWorker(reason: string): void {
    const proc = this.proc;
    const stdinWriter = this.stdinWriter;
    this.proc = null;
    this.stdinWriter = null;
    this.ready = false;
    this.workerPid = null;
    this.rejectAllPending(new Error(`search worker stopped: ${reason}`));
    if (!proc) {
      return;
    }
    try {
      try {
        stdinWriter?.end?.();
      } catch {
        // best effort
      }
      proc.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, 1_000);
      void proc.exited.finally(() => clearTimeout(forceKill));
    } catch {
      // best effort
    }
  }
}

// getConfig は core-utils.ts から re-export
export { getConfig } from "./core-utils.js";

export function parseChildApiResponse(stdout: string, stderr = "", label = "child"): ApiResponse {
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
    `${label} returned invalid JSON: ${detail}; stderr=${stderr.trim()} stdout=${stdout.trim()}`,
  );
}

export function parseVectorBackfillChildResponse(stdout: string, stderr = ""): ApiResponse {
  return parseChildApiResponse(stdout, stderr, "vector backfill child");
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
  private runtimeWarnings: Array<{ message: string; expiresAtMs: number }> = [];
  private vectorModelVersion = VECTOR_MODEL_VERSION;
  private reranker: Reranker | null = null;
  private rerankerEnabled = false;
  private managedBackend: ManagedBackend | null = null;
  private readonly heartbeatPath: string;
  private shuttingDown = false;
  private readonly projectNormalizationRoots: string[];
  private readonly environmentSnapshotCache = new TtlCache<EnvironmentSnapshot>(DEFAULT_ENVIRONMENT_CACHE_TTL_MS);
  private readonly repeatRecallCache = new Map<string, RepeatRecallCacheEntry>();

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
  /** §91-002: partial-finalize scheduler (opt-in via config.partialFinalizeEnabled) */
  private partialFinalizeScheduler!: PartialFinalizeScheduler;
  /** S89-003: vector reindex backfill scheduler (opt-in via config.reindexVectorsEnabled) */
  private reindexVectorsScheduler!: ReindexVectorsScheduler;
  /** S124-007: out-of-request vector compact rebuild + reindex worker */
  private vectorBackfillWorker!: VectorBackfillWorker;
  /** S127-002: warm persistent worker for normal vector search. */
  private searchWorker: PersistentSearchWorkerClient | null = null;
  private searchChildPending = 0;
  private eventChildPending = 0;
  private retryChildPending = 0;
  private checkpointChildPending = 0;
  private materializeChildPending = 0;
  private projectsStatsChildPending = 0;

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
      this.startSearchWorkerIfNeeded();
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

  private async runSearchOutOfProcess(request: SearchRequest): Promise<ApiResponse> {
    if (shouldUsePersistentSearchWorker({
      vectorEngine: this.vectorEngine,
      dbPath: this.config.dbPath,
    })) {
      return this.runSearchWithPersistentWorker(request);
    }
    return this.runSearchWithOneShotChild(request);
  }

  private getSearchWorkerScriptPath(): string {
    return fileURLToPath(new URL("../tools/search-worker.ts", import.meta.url));
  }

  private getSearchChildScriptPath(): string {
    return fileURLToPath(new URL("../tools/search-child.ts", import.meta.url));
  }

  private getCheckpointChildScriptPath(): string {
    return fileURLToPath(new URL("../tools/checkpoint-child.ts", import.meta.url));
  }

  private getMaterializeObservationChildScriptPath(): string {
    return fileURLToPath(new URL("../tools/materialize-observation-child.ts", import.meta.url));
  }

  private getEventChildScriptPath(): string {
    return fileURLToPath(new URL("../tools/event-child.ts", import.meta.url));
  }

  private getRetryChildScriptPath(): string {
    return fileURLToPath(new URL("../tools/retry-child.ts", import.meta.url));
  }

  private getProjectsStatsChildScriptPath(): string {
    return fileURLToPath(new URL("../tools/projects-stats-child.ts", import.meta.url));
  }

  private getSearchWorkerMaxPending(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_SEARCH_WORKER_QUEUE_MAX || DEFAULT_SEARCH_WORKER_QUEUE_MAX),
      DEFAULT_SEARCH_WORKER_QUEUE_MAX,
      1,
      8,
    );
  }

  private getSearchChildMaxPending(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_SEARCH_CHILD_QUEUE_MAX || DEFAULT_SEARCH_CHILD_QUEUE_MAX),
      DEFAULT_SEARCH_CHILD_QUEUE_MAX,
      1,
      8,
    );
  }

  private getCheckpointChildMaxPending(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_CHECKPOINT_CHILD_QUEUE_MAX || DEFAULT_CHECKPOINT_CHILD_QUEUE_MAX),
      DEFAULT_CHECKPOINT_CHILD_QUEUE_MAX,
      1,
      8,
    );
  }

  private getMaterializeChildMaxPending(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_MATERIALIZE_CHILD_QUEUE_MAX || DEFAULT_MATERIALIZE_CHILD_QUEUE_MAX),
      DEFAULT_MATERIALIZE_CHILD_QUEUE_MAX,
      1,
      8,
    );
  }

  private getEventChildMaxPending(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_EVENT_CHILD_QUEUE_MAX || DEFAULT_EVENT_CHILD_QUEUE_MAX),
      DEFAULT_EVENT_CHILD_QUEUE_MAX,
      1,
      8,
    );
  }

  private getRetryChildMaxPending(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_RETRY_CHILD_QUEUE_MAX || DEFAULT_RETRY_CHILD_QUEUE_MAX),
      DEFAULT_RETRY_CHILD_QUEUE_MAX,
      1,
      8,
    );
  }

  private getProjectsStatsChildMaxPending(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_QUEUE_MAX || DEFAULT_PROJECTS_STATS_CHILD_QUEUE_MAX),
      DEFAULT_PROJECTS_STATS_CHILD_QUEUE_MAX,
      1,
      8,
    );
  }

  private projectsStatsChildTimeoutMs(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_TIMEOUT_MS || DEFAULT_PROJECTS_STATS_CHILD_TIMEOUT_MS),
      DEFAULT_PROJECTS_STATS_CHILD_TIMEOUT_MS,
      250,
      60_000,
    );
  }

  private startSearchWorkerIfNeeded(): void {
    if (!shouldUsePersistentSearchWorker({
      vectorEngine: this.vectorEngine,
      dbPath: this.config.dbPath,
    })) {
      return;
    }
    const worker = this.getOrCreateSearchWorker();
    try {
      worker.ensureStarted();
    } catch (error) {
      this.embeddingWarnings.push(
        `search worker start failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getOrCreateSearchWorker(): PersistentSearchWorkerClient {
    if (!this.searchWorker) {
      this.searchWorker = new PersistentSearchWorkerClient({
        scriptPath: this.getSearchWorkerScriptPath(),
        cwd: process.cwd(),
        env: {
          ...process.env,
          HARNESS_MEM_DB_PATH: this.config.dbPath,
        },
        maxPending: this.getSearchWorkerMaxPending(),
      });
    }
    return this.searchWorker;
  }

  private searchWorkerTimeoutMs(worker: PersistentSearchWorkerClient): number {
    if (worker.isReady()) {
      return clampLimit(
        Number(process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS || DEFAULT_SEARCH_WORKER_TIMEOUT_MS),
        DEFAULT_SEARCH_WORKER_TIMEOUT_MS,
        250,
        60_000,
      );
    }
    return clampLimit(
      Number(
        process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS ||
          process.env.HARNESS_MEM_SEARCH_CHILD_TIMEOUT_MS ||
          DEFAULT_SEARCH_WORKER_STARTUP_TIMEOUT_MS,
      ),
      DEFAULT_SEARCH_WORKER_STARTUP_TIMEOUT_MS,
      250,
      60_000,
    );
  }

  private checkpointChildTimeoutMs(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS || DEFAULT_CHECKPOINT_CHILD_TIMEOUT_MS),
      DEFAULT_CHECKPOINT_CHILD_TIMEOUT_MS,
      250,
      60_000,
    );
  }

  private materializeChildTimeoutMs(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_MATERIALIZE_CHILD_TIMEOUT_MS || DEFAULT_MATERIALIZE_CHILD_TIMEOUT_MS),
      DEFAULT_MATERIALIZE_CHILD_TIMEOUT_MS,
      250,
      120_000,
    );
  }

  private eventChildTimeoutMs(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_EVENT_CHILD_TIMEOUT_MS || DEFAULT_EVENT_CHILD_TIMEOUT_MS),
      DEFAULT_EVENT_CHILD_TIMEOUT_MS,
      250,
      60_000,
    );
  }

  private retryChildTimeoutMs(): number {
    return clampLimit(
      Number(process.env.HARNESS_MEM_RETRY_CHILD_TIMEOUT_MS || DEFAULT_RETRY_CHILD_TIMEOUT_MS),
      DEFAULT_RETRY_CHILD_TIMEOUT_MS,
      250,
      60_000,
    );
  }

  private async runSearchWithPersistentWorker(request: SearchRequest): Promise<ApiResponse> {
    const startedAt = performance.now();
    const worker = this.getOrCreateSearchWorker();
    worker.ensureStarted();
    const queueDepthAtStart = worker.pendingDepth();
    if (request.safe_mode !== true && request.vector_search !== false && !worker.isWarmupComplete()) {
      throw new SearchOffloadUnavailableError("search worker", "warming");
    }
    const timeoutMs = this.searchWorkerTimeoutMs(worker);
    const result = await worker.request(request, timeoutMs);
    const response = result.response;
    const offloadWallMs = Number((performance.now() - startedAt).toFixed(2));
    const workerLatencyMs =
      typeof response.meta.latency_ms === "number"
        ? response.meta.latency_ms
        : null;
    response.meta = {
      ...response.meta,
      latency_ms: offloadWallMs,
      search_offload: {
        mode: "persistent_worker",
        timeout_ms: timeoutMs,
        wall_ms: offloadWallMs,
        worker_latency_ms: workerLatencyMs,
        worker_ready_at_start: result.ready_at_start,
        worker_pid: result.pid,
        worker_warmup_ms: result.warmup_ms,
      },
    };
    recordRecallTelemetry(
      "recall.worker",
      {
        ...this.recallScopeAttributes({
          project: request.scope?.project ?? request.project,
          session_id: request.scope?.session_id ?? request.session_id,
          include_private: request.include_private,
          safe_mode: request.safe_mode,
          limit: request.limit,
        }),
        "harness.result": response.ok ? "ok" : "error",
        "recall.worker.mode": "persistent_worker",
        "recall.worker.ready": result.ready_at_start,
        "recall.worker.warmup_complete": result.warmup_ms !== null,
        "recall.worker.queue_depth": queueDepthAtStart,
        "recall.worker.timeout_ms": timeoutMs,
      },
      {
        recall_latency_ms: offloadWallMs,
        worker_queue_depth: queueDepthAtStart,
      },
    );
    return response;
  }

  private async runSearchWithOneShotChild(request: SearchRequest): Promise<ApiResponse> {
    const startedAt = performance.now();
    const scriptPath = this.getSearchChildScriptPath();
    const timeoutMs = clampLimit(
      Number(process.env.HARNESS_MEM_SEARCH_CHILD_TIMEOUT_MS || DEFAULT_SEARCH_CHILD_TIMEOUT_MS),
      DEFAULT_SEARCH_CHILD_TIMEOUT_MS,
      250,
      60_000,
    );
    const maxPending = this.getSearchChildMaxPending();
    const queueDepthAtStart = this.searchChildPending;
    if (this.searchChildPending >= maxPending) {
      throw new SearchOffloadQueueFullError("search child", this.searchChildPending, maxPending);
    }
    this.searchChildPending += 1;
    let timedOut = false;
    const proc = Bun.spawn({
      cmd: buildSearchChildCommand(scriptPath),
      cwd: process.cwd(),
      env: {
        ...process.env,
        HARNESS_MEM_DB_PATH: this.config.dbPath,
        HARNESS_MEM_SEARCH_CHILD_PROCESS: "1",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, 1_000);
      void proc.exited.finally(() => clearTimeout(forceKill));
    }, timeoutMs);
    try {
      await writeJsonToChildStdin(proc.stdin as SearchWorkerStdin | null, request);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited ${exitCode}`;
        throw new Error(`search child ${reason}: ${stderr.trim() || stdout.trim()}`);
      }
      const response = parseChildApiResponse(stdout, stderr, "search child");
      const offloadWallMs = Number((performance.now() - startedAt).toFixed(2));
      const childLatencyMs =
        typeof response.meta.latency_ms === "number"
          ? response.meta.latency_ms
          : null;
      response.meta = {
        ...response.meta,
        latency_ms: offloadWallMs,
        search_offload: {
          mode: "child_process",
          timeout_ms: timeoutMs,
          wall_ms: offloadWallMs,
          child_latency_ms: childLatencyMs,
        },
      };
      recordRecallTelemetry(
        "recall.worker",
        {
          ...this.recallScopeAttributes({
            project: request.scope?.project ?? request.project,
            session_id: request.scope?.session_id ?? request.session_id,
            include_private: request.include_private,
            safe_mode: request.safe_mode,
            limit: request.limit,
          }),
          "harness.result": response.ok ? "ok" : "error",
          "recall.worker.mode": "child_process",
          "recall.worker.queue_depth": queueDepthAtStart,
          "recall.worker.timeout_ms": timeoutMs,
        },
        {
          recall_latency_ms: offloadWallMs,
          worker_queue_depth: queueDepthAtStart,
        },
      );
      return response;
    } finally {
      clearTimeout(timer);
      this.searchChildPending = Math.max(0, this.searchChildPending - 1);
    }
  }

  private makeSearchOffloadRejectedResponse(
    startedAt: number,
    request: SearchRequest,
    error: SearchOffloadQueueFullError | SearchOffloadUnavailableError,
    mode: SearchOffloadMode,
  ): ApiResponse {
    const queueFull = error instanceof SearchOffloadQueueFullError;
    const reason = queueFull ? "queue_full" : error.reason;
    const response = makeErrorResponse(
      startedAt,
      `${error.queueName} is busy; retry later (${reason})`,
      request as unknown as Record<string, unknown>,
    );
    Object.assign(response.meta, {
      error_code: queueFull ? "search_offload_queue_full" : "search_offload_unavailable",
      http_status: 503,
      search_offload: {
        mode,
        fallback: "none",
        queue_full: queueFull,
        reason,
        ...(queueFull
          ? {
              pending: error.pending,
              max_pending: error.maxPending,
            }
          : {}),
      },
    });
    return response;
  }

  private async searchWithSafeFallback(
    request: SearchRequest,
    reason: string,
    mode: SearchOffloadMode = "child_process",
  ): Promise<ApiResponse> {
    const startedAt = performance.now();
    const safeRequest: SearchRequest = {
      ...request,
      safe_mode: true,
      vector_search: false,
      expand_links: false,
      graph_depth: 0,
      graph_weight: 0,
    };
    let fallback: ApiResponse;
    let fallbackMode: "child_process" | "empty_error" = "child_process";
    let fallbackFailedReason: string | null = null;
    try {
      fallback = await this.runSearchWithOneShotChild(safeRequest);
    } catch (fallbackError) {
      fallbackMode = "empty_error";
      fallbackFailedReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      fallback = makeErrorResponse(
        startedAt,
        `search offload failed and safe fallback failed: ${fallbackFailedReason}`,
        safeRequest as unknown as Record<string, unknown>,
      );
    }
    const existingWarnings = Array.isArray(fallback.meta.warnings)
      ? (fallback.meta.warnings as string[])
      : [];
    const fallbackFailed = fallbackMode === "empty_error";
    fallback.meta = {
      ...fallback.meta,
      ...(fallbackFailed
        ? {
            error_code: "search_fallback_failed",
            http_status: 503,
          }
        : {}),
      warnings: [
        ...existingWarnings,
        fallbackFailed
          ? `search offload failed; safe lexical fallback also failed: ${reason.slice(0, 240)}`
          : `search offload failed; returned safe lexical fallback: ${reason.slice(0, 240)}`,
      ],
      search_offload: {
        mode,
        fallback: fallbackFailed ? "none" : "safe_lexical",
        fallback_mode: fallbackMode,
        failed_reason: reason.slice(0, 500),
        ...(fallbackFailedReason ? { fallback_failed_reason: fallbackFailedReason.slice(0, 500) } : {}),
      },
    };
    return fallback;
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

  private processRetryQueue(force = false): void {
    if (this.shuttingDown && !force) {
      return;
    }
    if (!force && shouldRunRetryQueueOutOfProcess({ dbPath: this.config.dbPath })) {
      if (this.retryChildPending >= this.getRetryChildMaxPending()) {
        return;
      }
      void this.runRetryQueueOutOfProcess(false).catch((error) => {
        this.pushRuntimeWarning(
          `retry queue child failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
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

  processRetryQueueNow(force = false): ApiResponse {
    const startedAt = performance.now();
    this.processRetryQueue(force);
    return makeResponse(
      startedAt,
      [{ processed: true, force }],
      { force },
      { ranking: "retry_queue_v1" },
    );
  }

  private async runRetryQueueOutOfProcess(force: boolean): Promise<ApiResponse> {
    const startedAt = performance.now();
    const timeoutMs = this.retryChildTimeoutMs();
    const scriptPath = this.getRetryChildScriptPath();
    this.retryChildPending += 1;
    let timedOut = false;
    const proc = Bun.spawn({
      cmd: buildRetryChildCommand(scriptPath),
      cwd: process.cwd(),
      env: {
        ...process.env,
        HARNESS_MEM_DB_PATH: this.config.dbPath,
        HARNESS_MEM_RETRY_CHILD_PROCESS: "1",
        HARNESS_MEM_EMBEDDING_PROVIDER: "fallback",
        HARNESS_MEM_EMBEDDING_MODEL: VECTOR_MODEL_VERSION,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, 1_000);
      void proc.exited.finally(() => clearTimeout(forceKill));
    }, timeoutMs);
    try {
      await writeJsonToChildStdin(proc.stdin as SearchWorkerStdin | null, { force });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited ${exitCode}`;
        throw new Error(`retry queue child ${reason}: ${stderr.trim() || stdout.trim()}`);
      }
      const response = parseChildApiResponse(stdout, stderr, "retry queue child");
      const offloadWallMs = Number((performance.now() - startedAt).toFixed(2));
      response.meta = {
        ...response.meta,
        latency_ms: offloadWallMs,
        retry_offload: {
          mode: "child_process",
          timeout_ms: timeoutMs,
          wall_ms: offloadWallMs,
          child_latency_ms: typeof response.meta.latency_ms === "number" ? response.meta.latency_ms : null,
        },
      };
      return response;
    } finally {
      clearTimeout(timer);
      this.retryChildPending = Math.max(0, this.retryChildPending - 1);
    }
  }

  private pushRuntimeWarning(message: string, ttlMs = DEFAULT_RUNTIME_WARNING_TTL_MS): void {
    const now = Date.now();
    const nextWarnings = this.runtimeWarnings.filter(
      (warning) => warning.expiresAtMs > now && warning.message !== message,
    );
    nextWarnings.push({ message, expiresAtMs: now + ttlMs });
    this.runtimeWarnings = nextWarnings.slice(-10);
  }

  private currentRuntimeWarnings(): string[] {
    const now = Date.now();
    this.runtimeWarnings = this.runtimeWarnings.filter((warning) => warning.expiresAtMs > now);
    return this.runtimeWarnings.map((warning) => warning.message);
  }

  recordEvent(event: EventEnvelope, options: { allowQueue: boolean } = { allowQueue: true }): ApiResponse {
    return this.eventRec.recordEvent(event, options);
  }

  async recordEventQueued(
    event: EventEnvelope,
    options: { allowQueue: boolean; deferEmbedding?: boolean } = { allowQueue: true }
  ): Promise<ApiResponse | "queue_full"> {
    if (options.deferEmbedding !== true && shouldRunEventOutOfProcess({ dbPath: this.config.dbPath })) {
      if (this.eventChildPending >= this.getEventChildMaxPending()) {
        return "queue_full";
      }
      return this.runEventOutOfProcess(event);
    }
    if (options.deferEmbedding !== true) {
      await this.prepareRecordEventEmbedding(event);
    }
    return this.eventRec.recordEventQueued(event, options);
  }

  materializeObservationDerivedData(observationId: string): ApiResponse {
    const startedAt = performance.now();
    const normalizedId = typeof observationId === "string" ? observationId.trim() : "";
    if (!normalizedId) {
      return makeErrorResponse(startedAt, "observation_id is required", {});
    }

    try {
      const item = this.eventRec.materializeObservationDerivedData(normalizedId);
      return makeResponse(
        startedAt,
        [item],
        { observation_id: normalizedId },
        {
          ranking: "observation_materialize_v1",
          vector_engine: this.vectorEngine,
          embedding_provider: this.embeddingProvider.name,
          embedding_provider_status: this.embeddingHealth.status,
        },
      );
    } catch (error) {
      return makeErrorResponse(
        startedAt,
        `observation materialization failed: ${error instanceof Error ? error.message : String(error)}`,
        { observation_id: normalizedId },
      );
    }
  }

  private async runEventOutOfProcess(event: EventEnvelope): Promise<ApiResponse> {
    const startedAt = performance.now();
    const timeoutMs = this.eventChildTimeoutMs();
    const scriptPath = this.getEventChildScriptPath();
    this.eventChildPending += 1;
    let timedOut = false;
    const proc = Bun.spawn({
      cmd: buildEventChildCommand(scriptPath),
      cwd: process.cwd(),
      env: {
        ...process.env,
        HARNESS_MEM_DB_PATH: this.config.dbPath,
        HARNESS_MEM_EVENT_CHILD_PROCESS: "1",
        HARNESS_MEM_EMBEDDING_PROVIDER: "fallback",
        HARNESS_MEM_EMBEDDING_MODEL: VECTOR_MODEL_VERSION,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, 1_000);
      void proc.exited.finally(() => clearTimeout(forceKill));
    }, timeoutMs);
    try {
      await writeJsonToChildStdin(proc.stdin as SearchWorkerStdin | null, event);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited ${exitCode}`;
        throw new Error(`event child ${reason}: ${stderr.trim() || stdout.trim()}`);
      }
      const response = parseChildApiResponse(stdout, stderr, "event child");
      const offloadWallMs = Number((performance.now() - startedAt).toFixed(2));
      response.meta = {
        ...response.meta,
        latency_ms: offloadWallMs,
        event_offload: {
          mode: "child_process",
          timeout_ms: timeoutMs,
          wall_ms: offloadWallMs,
          child_latency_ms: typeof response.meta.latency_ms === "number" ? response.meta.latency_ms : null,
        },
      };
      return response;
    } catch (error) {
      const response = makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        {
          project: event.project,
          session_id: event.session_id,
          event_type: event.event_type,
        },
      );
      Object.assign(response.meta, {
        error_code: "event_offload_failed",
        http_status: 503,
        event_offload: {
          mode: "child_process",
          timeout_ms: timeoutMs,
          timed_out: timedOut,
        },
      });
      return response;
    } finally {
      clearTimeout(timer);
      this.eventChildPending = Math.max(0, this.eventChildPending - 1);
    }
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

  buildRecallProjection(request: { project: string; limit?: number; include_private?: boolean }): ApiResponse {
    const startedAt = performance.now();
    try {
      const plan = buildRecallProjectionPlan(this.db, {
        project: request.project,
        limit: request.limit,
        includePrivate: request.include_private === true,
      });
      const response = makeResponse(startedAt, plan.items as unknown[], request as unknown as Record<string, unknown>, {
        ranking: "recall_projection_dry_run_v1",
        projection_generation: plan.generation,
        source_watermark: plan.source_watermark,
        candidate_count: plan.candidate_count,
        planned_count: plan.planned_count,
        skipped_count: plan.skipped_count,
        skipped_reasons: plan.skipped_reasons,
        diagnostics: plan.diagnostics,
        writes: 0,
      });
      this.recordRecallProjectionBuildTelemetry(startedAt, request, response, "dry_run", plan);
      return response;
    } catch (error) {
      const response = makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        request as unknown as Record<string, unknown>,
      );
      this.recordRecallProjectionBuildTelemetry(startedAt, request, response, "dry_run");
      return response;
    }
  }

  refreshRecallProjection(request: { project: string; limit?: number; include_private?: boolean }): ApiResponse {
    const startedAt = performance.now();
    try {
      const plan = materializeRecallProjection(this.db, {
        project: request.project,
        limit: request.limit,
        includePrivate: request.include_private === true,
      });
      this.repeatRecallCache.clear();
      const response = makeResponse(startedAt, plan.items as unknown[], request as unknown as Record<string, unknown>, {
        ranking: "recall_projection_refresh_v1",
        projection_generation: plan.generation,
        source_watermark: plan.source_watermark,
        candidate_count: plan.candidate_count,
        planned_count: plan.planned_count,
        skipped_count: plan.skipped_count,
        skipped_reasons: plan.skipped_reasons,
        diagnostics: plan.diagnostics,
        writes: plan.items.length,
        cache_cleared: true,
      });
      this.recordRecallProjectionBuildTelemetry(startedAt, request, response, "write", plan);
      return response;
    } catch (error) {
      const response = makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        request as unknown as Record<string, unknown>,
      );
      this.recordRecallProjectionBuildTelemetry(startedAt, request, response, "write");
      return response;
    }
  }

  deleteRecallProjection(request: { project: string }): ApiResponse {
    const startedAt = performance.now();
    try {
      const result = clearRecallProjection(this.db, request.project);
      this.repeatRecallCache.clear();
      return makeResponse(startedAt, [result], request as unknown as Record<string, unknown>, {
        ranking: "recall_projection_clear_v1",
        cache_cleared: true,
      });
    } catch (error) {
      return makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        request as unknown as Record<string, unknown>,
      );
    }
  }

  recallDegradationManifest(): ApiResponse {
    const startedAt = performance.now();
    return makeResponse(startedAt, [RECALL_DEGRADATION_MANIFEST], {}, {
      ranking: "recall_degradation_manifest_v1",
    });
  }

  private recallScopeAttributes(request: {
    project?: string;
    session_id?: string;
    include_private?: boolean;
    safe_mode?: boolean;
    forensic?: boolean;
    limit?: number;
  }): Record<string, string | number | boolean> {
    const hasProject = typeof request.project === "string" && request.project.trim().length > 0;
    const hasSession = typeof request.session_id === "string" && request.session_id.trim().length > 0;
    const scope = hasProject && hasSession
      ? "project_session"
      : hasProject
        ? "project"
        : hasSession
          ? "session"
          : "none";
    return {
      "recall.scope": scope,
      "recall.project_present": hasProject,
      "recall.session_present": hasSession,
      "recall.include_private": request.include_private === true,
      "recall.safe_mode": request.safe_mode === true,
      "recall.forensic": request.forensic === true,
      "recall.limit": request.limit ?? 20,
    };
  }

  private projectionStalenessMs(projectionRun: RecallProjectionRunRow | null): number | undefined {
    if (!projectionRun?.completed_at) return undefined;
    const completedAt = Date.parse(projectionRun.completed_at);
    if (!Number.isFinite(completedAt)) return undefined;
    return Math.max(0, Date.now() - completedAt);
  }

  private countAdrRecallItems(items: unknown[]): number {
    return items.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.toLowerCase() : "";
      if (title.includes("adr-") || title.includes("[adr")) return true;
      const metadata = record.metadata;
      if (!metadata || typeof metadata !== "object") return false;
      const metadataRecord = metadata as Record<string, unknown>;
      const observationType = typeof metadataRecord.observation_type === "string"
        ? metadataRecord.observation_type.toLowerCase()
        : "";
      if (observationType.includes("adr")) return true;
      const tags = metadataRecord.tags;
      return Array.isArray(tags) && tags.some((tag) => typeof tag === "string" && tag.toLowerCase() === "adr");
    }).length;
  }

  private recordRecallProjectionBuildTelemetry(
    startedAt: number,
    request: { project: string; limit?: number; include_private?: boolean },
    response: ApiResponse,
    operation: "dry_run" | "write",
    plan?: RecallProjectionPlan,
  ): void {
    recordRecallTelemetry(
      "recall.projection.build",
      {
        ...this.recallScopeAttributes({
          project: request.project,
          include_private: request.include_private,
          limit: request.limit,
          safe_mode: true,
        }),
        "harness.operation": operation,
        "harness.result": response.ok ? "ok" : "error",
        "harness.error_code": typeof response.meta.error_code === "string" ? response.meta.error_code : undefined,
        "recall.items_count": Array.isArray(response.items) ? response.items.length : 0,
        "recall.projection.generation": plan?.generation,
        "recall.projection.status": response.ok ? "completed" : "failed",
        "recall.projection.source_watermark_hash": plan ? hashTelemetryValue(plan.source_watermark) : undefined,
        "recall.projection.candidate_count": plan?.candidate_count,
        "recall.projection.planned_count": plan?.planned_count,
        "recall.projection.skipped_count": plan?.skipped_count,
        "recall.projection.writes": operation === "write" && plan ? plan.items.length : 0,
      },
      {
        recall_latency_ms: typeof response.meta.latency_ms === "number"
          ? response.meta.latency_ms
          : Number((performance.now() - startedAt).toFixed(2)),
      },
    );
  }

  private recordRecallProjectTelemetry(
    startedAt: number,
    request: RecallRuntimeRequest,
    response: ApiResponse,
    projectionRun: RecallProjectionRunRow | null = null,
    sourceWatermark: string | null = null,
  ): void {
    const degraded = response.meta.recall_degraded === true;
    const items = Array.isArray(response.items) ? response.items : [];
    recordRecallTelemetry(
      "recall.project",
      {
        ...this.recallScopeAttributes({
          project: request.project,
          session_id: request.session_id,
          include_private: request.include_private,
          safe_mode: request.safe_mode !== false,
          forensic: request.forensic,
          limit: request.limit,
        }),
        "harness.result": response.ok ? "ok" : "error",
        "harness.error_code": typeof response.meta.error_code === "string" ? response.meta.error_code : undefined,
        "recall.items_count": items.length,
        "recall.degraded": degraded,
        "recall.degraded_reason": typeof response.meta.recall_degraded_reason === "string"
          ? response.meta.recall_degraded_reason
          : undefined,
        "recall.projection.generation": typeof response.meta.projection_generation === "string"
          ? response.meta.projection_generation
          : projectionRun?.generation,
        "recall.projection.source_watermark_hash": typeof response.meta.projection_source_watermark === "string"
          ? hashTelemetryValue(response.meta.projection_source_watermark)
          : projectionRun?.source_watermark
            ? hashTelemetryValue(projectionRun.source_watermark)
            : undefined,
        "recall.projection.current_watermark_hash": sourceWatermark ? hashTelemetryValue(sourceWatermark) : undefined,
      },
      {
        recall_latency_ms: typeof response.meta.latency_ms === "number"
          ? response.meta.latency_ms
          : Number((performance.now() - startedAt).toFixed(2)),
        fallback_count: degraded ? 1 : 0,
        projection_staleness_ms: this.projectionStalenessMs(projectionRun),
        adr_recall_count: this.countAdrRecallItems(items),
      },
    );
  }

  private recordRecallSearchTelemetry(
    startedAt: number,
    request: SearchRequest,
    response: ApiResponse,
  ): void {
    const meta = response.meta as Record<string, unknown>;
    const cache = meta.recall_cache && typeof meta.recall_cache === "object"
      ? meta.recall_cache as Record<string, unknown>
      : null;
    const offload = meta.search_offload && typeof meta.search_offload === "object"
      ? meta.search_offload as Record<string, unknown>
      : null;
    const cacheHit = typeof meta.recall_cache_hit === "boolean" ? meta.recall_cache_hit : undefined;
    const fallback = typeof offload?.fallback === "string" ? offload.fallback : undefined;
    const items = Array.isArray(response.items) ? response.items : [];
    recordRecallTelemetry(
      "recall.search",
      {
        ...this.recallScopeAttributes({
          project: request.scope?.project ?? request.project,
          session_id: request.scope?.session_id ?? request.session_id,
          include_private: request.include_private,
          safe_mode: request.safe_mode,
          limit: request.limit,
        }),
        "harness.result": response.ok ? "ok" : "error",
        "harness.error_code": typeof meta.error_code === "string" ? meta.error_code : undefined,
        "recall.items_count": items.length,
        "recall.cache.hit": cacheHit,
        "recall.cache.key_hash": typeof cache?.key_hash === "string" ? cache.key_hash : undefined,
        "recall.cache.knobs_hash": typeof cache?.knobs_hash === "string" ? cache.knobs_hash : undefined,
        "recall.cache.ttl_ms": typeof cache?.ttl_ms === "number" ? cache.ttl_ms : undefined,
        "recall.cache.age_ms": typeof cache?.age_ms === "number" ? cache.age_ms : undefined,
        "recall.cache.data_watermark_hash": typeof cache?.data_watermark === "string"
          ? hashTelemetryValue(cache.data_watermark)
          : undefined,
        "recall.worker.mode": typeof offload?.mode === "string" ? offload.mode : undefined,
        "recall.worker.fallback": fallback,
        "recall.worker.queue_depth": typeof offload?.pending === "number" ? offload.pending : undefined,
      },
      {
        recall_latency_ms: typeof meta.latency_ms === "number"
          ? meta.latency_ms
          : Number((performance.now() - startedAt).toFixed(2)),
        fallback_count: fallback && fallback !== "none" ? 1 : 0,
        worker_queue_depth: typeof offload?.pending === "number" ? offload.pending : undefined,
        recall_cache_hit_count: cacheHit === true ? 1 : 0,
        recall_cache_miss_count: cacheHit === false ? 1 : 0,
      },
    );
  }

  async recallPrepared(request: RecallRuntimeRequest): Promise<ApiResponse> {
    const startedAt = performance.now();
    const query = request.query.trim();
    const project = request.project?.trim() || undefined;
    const sessionId = request.session_id?.trim() || undefined;
    const limit = clampLimit(request.limit ?? 10, 10, 1, 50);
    const filters = {
      query,
      project,
      session_id: sessionId,
      limit,
      include_private: request.include_private === true,
      forensic: request.forensic === true,
      safe_mode: request.safe_mode !== false,
    };

    if (!query) {
      const response = makeErrorResponse(startedAt, "query is required", filters);
      response.meta.http_status = 400;
      this.recordRecallProjectTelemetry(startedAt, request, response);
      return response;
    }

    if (!project && !sessionId && request.forensic !== true) {
      const response = makeErrorResponse(
        startedAt,
        "recall requires project or session_id scope; set forensic=true for broad observation search",
        filters,
      );
      response.meta.http_status = 400;
      response.meta.recall_scope_required = true;
      response.meta.recall_degraded_reason = "scope_required";
      this.recordRecallProjectTelemetry(startedAt, request, response);
      return response;
    }

    if (request.forensic === true) {
      return this.fallbackRecallSearch(request, "forensic_observation_search", startedAt, null, null);
    }

    if (!project) {
      return this.fallbackRecallSearch(request, "projection_project_scope_required", startedAt, null, null);
    }

    if (request.user_id || request.team_id) {
      return this.fallbackRecallSearch(request, "projection_access_filter_unsupported", startedAt, null, null);
    }

    const latestRun = this.getLatestRecallProjectionRun(project);
    const sourceWatermark = readRecallDataWatermark(this.db, { project });
    if (!latestRun) {
      return this.fallbackRecallSearch(request, "projection_missing", startedAt, null, sourceWatermark);
    }
    if (latestRun.source_watermark !== sourceWatermark) {
      return this.fallbackRecallSearch(request, "projection_stale", startedAt, latestRun, sourceWatermark);
    }

    const items = this.searchRecallProjection({
      query,
      project,
      session_id: sessionId,
      limit,
      include_private: request.include_private === true,
    });

    if (items.length === 0) {
      return this.fallbackRecallSearch(request, "projection_no_match", startedAt, latestRun, sourceWatermark);
    }

    const response = makeResponse(startedAt, items, filters, {
      ranking: "recall_projection_v1",
      recall_runtime: true,
      recall_degraded: false,
      recall_scope: sessionId ? "project_session" : "project",
      projection_generation: latestRun.generation,
      projection_source_watermark: latestRun.source_watermark,
      projection_completed_at: latestRun.completed_at,
    });
    this.recordRecallProjectTelemetry(startedAt, request, response, latestRun, sourceWatermark);
    return response;
  }

  private getLatestRecallProjectionRun(project: string): RecallProjectionRunRow | null {
    return this.db
      .query(
        `SELECT generation, source_watermark, completed_at
         FROM mem_recall_projection_runs
         WHERE project = ? AND status = 'completed'
         ORDER BY completed_at DESC, started_at DESC
         LIMIT 1`
      )
      .get(project) as RecallProjectionRunRow | null;
  }

  private tokenizeRecallQuery(query: string): string[] {
    const normalized = query.trim().toLowerCase();
    const tokens = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
    const unique = [...new Set(tokens.filter((token) => token.length > 1))].slice(0, 12);
    return unique.length > 0 ? unique : [normalized].filter(Boolean);
  }

  private recallScopeLabel(request: { project?: string; session_id?: string; forensic?: boolean }): string {
    if (request.forensic === true) return "forensic";
    const hasProject = typeof request.project === "string" && request.project.trim().length > 0;
    const hasSession = typeof request.session_id === "string" && request.session_id.trim().length > 0;
    if (hasProject && hasSession) return "project_session";
    if (hasProject) return "project";
    if (hasSession) return "session";
    return "none";
  }

  private isSafeRecallExplanationString(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (/(secret|token|password|api[_-]?key|private[_-]?key|bearer\s+)/.test(lower)) return false;
    if (/(^|[\s"'=])\/Users\//.test(trimmed) || /[A-Za-z]:\\Users\\/.test(trimmed)) return false;
    return true;
  }

  private compactRecallExplanationString(value: unknown, maxLength = 120): string | undefined {
    if (typeof value !== "string") return undefined;
    const compact = value.replace(/\s+/g, " ").trim();
    if (!this.isSafeRecallExplanationString(compact)) return undefined;
    return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
  }

  private compactRecallExplanationList(value: unknown, maxItems = 4, maxLength = 80): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const items: string[] = [];
    for (const entry of value) {
      const compact = this.compactRecallExplanationString(entry, maxLength);
      if (!compact || seen.has(compact)) continue;
      seen.add(compact);
      items.push(compact);
      if (items.length >= maxItems) break;
    }
    return items;
  }

  private buildRecallProjectionExplanation(params: {
    row: RecallProjectionSearchRow;
    request: { project: string; session_id?: string };
    metadata: Record<string, unknown>;
    lexical: boolean;
  }): Record<string, unknown> {
    const provenance = params.metadata.provenance && typeof params.metadata.provenance === "object"
      ? params.metadata.provenance as Record<string, unknown>
      : {};
    const reasons: RecallExplanationReason[] = ["scope_match", "type_match", "source_match"];
    if (params.lexical) reasons.push("lexical_match");

    const sourceRef = this.compactRecallExplanationString(params.row.source_ref, 160);
    const workRefs = [
      ...this.compactRecallExplanationList(provenance.work_refs),
      ...this.compactRecallExplanationList(params.metadata.workRefs),
    ].filter((value, index, list) => list.indexOf(value) === index).slice(0, 4);
    const sourcePlansSection =
      this.compactRecallExplanationString(provenance.source_plans_section) ??
      this.compactRecallExplanationString(params.metadata.sourcePlansSection);

    const explanation: Record<string, unknown> = {
      version: "recall_explanation_v1",
      summary: "",
      reasons,
      scope: this.recallScopeLabel(params.request),
      type: params.row.recall_type,
      source: {
        type: params.row.source_type,
        ...(sourceRef ? { ref: sourceRef } : {}),
      },
    };

    if (params.row.source_type === "adr") {
      reasons.push("adr_provenance");
      const options = Array.isArray(params.metadata.options) ? params.metadata.options : [];
      const consequences = Array.isArray(params.metadata.consequences) ? params.metadata.consequences : [];
      const supersedes = this.compactRecallExplanationList(
        Array.isArray(provenance.supersedes) ? provenance.supersedes : params.metadata.supersedes,
      );
      explanation.adr = {
        ...(this.compactRecallExplanationString(params.metadata.status, 40)
          ? { status: this.compactRecallExplanationString(params.metadata.status, 40) }
          : {}),
        ...(sourcePlansSection ? { source_plans_section: sourcePlansSection } : {}),
        option_count: options.length,
        consequence_count: consequences.length,
        ...(supersedes.length > 0 ? { supersedes } : {}),
      };
    }

    if (workRefs.length > 0 || sourcePlansSection) {
      reasons.push("work_ref");
      explanation.work = {
        ...(workRefs.length > 0 ? { refs: workRefs } : {}),
        ...(sourcePlansSection ? { source_plans_section: sourcePlansSection } : {}),
      };
    }

    explanation.summary = reasons.join("+");
    return explanation;
  }

  private attachFallbackRecallExplanations(response: ApiResponse, request: RecallRuntimeRequest, reason: string): ApiResponse {
    if (!Array.isArray(response.items)) return response;
    response.items = response.items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const record = item as Record<string, unknown>;
      const sourceRef = typeof record.id === "string"
        ? this.compactRecallExplanationString(`observation:${record.id}`, 160)
        : undefined;
      const reasons: RecallExplanationReason[] = ["scope_match", "source_match", "degraded_fallback"];
      if (typeof record.observation_type === "string" || typeof record.memory_type === "string") {
        reasons.push("type_match");
      }
      if (record.reason) reasons.push("lexical_match");
      return {
        ...record,
        explanation: {
          version: "recall_explanation_v1",
          summary: reasons.join("+"),
          reasons,
          scope: this.recallScopeLabel(request),
          type: typeof record.observation_type === "string"
            ? record.observation_type
            : typeof record.memory_type === "string"
              ? record.memory_type
              : "observation",
          source: {
            type: "observation",
            ...(sourceRef ? { ref: sourceRef } : {}),
          },
          fallback: reason,
        },
      };
    });
    return response;
  }

  private searchRecallProjection(request: {
    query: string;
    project: string;
    session_id?: string;
    limit: number;
    include_private: boolean;
  }): Record<string, unknown>[] {
    const query = request.query.trim().toLowerCase();
    const terms = this.tokenizeRecallQuery(query);
    const params: SQLQueryBindings[] = [request.project];
    let sessionClause = "";
    if (request.session_id) {
      sessionClause = " AND session_id = ?";
      params.push(request.session_id);
    }
    params.push(Math.max(request.limit * 20, 100));
    const rows = this.db
      .query(
        `SELECT recall_id, recall_type, project, workspace, tenant, session_id, source_type, source_id,
                source_ref, projection_generation, title, content_redacted, source_created_at, projected_at,
                valid_from, valid_to, privacy_tags_json, metadata_json
         FROM mem_recall_items
         WHERE project = ?${sessionClause}
         ORDER BY COALESCE(source_created_at, projected_at) DESC, recall_id ASC
         LIMIT ?`
      )
      .all(...params) as RecallProjectionSearchRow[];

    const items: Record<string, unknown>[] = [];
    for (const row of rows) {
      const privacyTags = parseArrayJson(row.privacy_tags_json ?? "[]");
      if (!request.include_private && hasPrivateVisibilityTag(privacyTags)) {
        continue;
      }
      const title = row.title ?? "";
      const content = row.content_redacted ?? "";
      const metadata: Record<string, unknown> = row.metadata_json
        ? JSON.parse(row.metadata_json) as Record<string, unknown>
        : {};
      const titleLower = title.toLowerCase();
      const haystack = `${titleLower}\n${content.toLowerCase()}`;
      const exactQueryMatch = haystack.includes(query);
      let score = exactQueryMatch ? 3 : 0;
      let termMatch = false;
      for (const term of terms) {
        const titleMatch = titleLower.includes(term);
        const bodyMatch = haystack.includes(term);
        if (titleMatch) score += 2;
        if (bodyMatch) score += 1;
        termMatch = termMatch || titleMatch || bodyMatch;
      }
      if (score <= 0) {
        continue;
      }
      const explanation = this.buildRecallProjectionExplanation({
        row,
        request: {
          project: request.project,
          session_id: request.session_id,
        },
        metadata,
        lexical: exactQueryMatch || termMatch,
      });
      items.push({
        id: row.recall_id,
        recall_id: row.recall_id,
        title: row.title,
        content,
        snippet: content.slice(0, 240),
        score,
        recall_type: row.recall_type,
        project: row.project,
        workspace: row.workspace,
        tenant: row.tenant,
        session_id: row.session_id,
        source_type: row.source_type,
        source_id: row.source_id,
        source_ref: row.source_ref,
        projection_generation: row.projection_generation,
        source_created_at: row.source_created_at,
        projected_at: row.projected_at,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        privacy_tags: privacyTags,
        metadata,
        provenance: metadata.provenance ?? null,
        explanation,
      });
    }

    return items
      .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
      .slice(0, request.limit);
  }

  private async fallbackRecallSearch(
    request: RecallRuntimeRequest,
    reason: string,
    startedAt: number,
    projectionRun: RecallProjectionRunRow | null,
    sourceWatermark: string | null,
  ): Promise<ApiResponse> {
    const fallback = await this.searchPrepared({
      query: request.query,
      project: request.project,
      session_id: request.session_id,
      limit: request.limit,
      include_private: request.include_private === true,
      strict_project: true,
      safe_mode: request.safe_mode !== false,
      vector_search: request.safe_mode === false,
      expand_links: request.safe_mode === false,
      graph_depth: request.safe_mode === false ? undefined : 0,
      graph_weight: request.safe_mode === false ? undefined : 0,
      user_id: request.user_id,
      team_id: request.team_id,
    });
    Object.assign(fallback.meta, {
      latency_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      ranking: reason === "forensic_observation_search" ? "recall_forensic_observation_search_v1" : "recall_degraded_fallback_v1",
      recall_runtime: true,
      recall_degraded: reason !== "forensic_observation_search",
      recall_degraded_reason: reason,
      fallback_path: "observation_search",
      projection_generation: projectionRun?.generation ?? null,
      projection_source_watermark: projectionRun?.source_watermark ?? null,
      current_source_watermark: sourceWatermark,
    });
    this.attachFallbackRecallExplanations(fallback, request, reason);
    this.recordRecallProjectTelemetry(startedAt, request, fallback, projectionRun, sourceWatermark);
    return fallback;
  }

  private getRepeatRecallCacheTtlMs(): number {
    const raw = process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;
    if (raw === undefined || raw.trim() === "") {
      return DEFAULT_REPEAT_RECALL_CACHE_TTL_MS;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_REPEAT_RECALL_CACHE_TTL_MS;
    }
    return Math.min(MAX_REPEAT_RECALL_CACHE_TTL_MS, Math.floor(parsed));
  }

  private sha256Short(value: string, length = 16): string {
    return createHash("sha256").update(value).digest("hex").slice(0, length);
  }

  private cloneApiResponse(response: ApiResponse): ApiResponse {
    return JSON.parse(JSON.stringify(response)) as ApiResponse;
  }

  private getSearchCacheScope(request: SearchRequest): { project?: string; sessionId?: string } {
    return {
      project: request.scope?.project ?? request.project,
      sessionId: request.scope?.session_id ?? request.session_id,
    };
  }

  private buildRepeatRecallCacheCandidate(request: SearchRequest): RepeatRecallCacheCandidate | null {
    const ttlMs = this.getRepeatRecallCacheTtlMs();
    if (ttlMs <= 0) return null;
    if (!request.query || !request.query.trim()) return null;
    if (request.debug === true || request.include_archived === true) return null;
    const scope = this.getSearchCacheScope(request);
    if (!scope.project && !scope.sessionId) return null;

    const normalizedQueryHash = this.sha256Short(request.query.trim().replace(/\s+/g, " ").toLowerCase(), 24);
    const dataWatermark = readRecallDataWatermark(this.db, scope);
    const knobs = {
      as_of: request.as_of ?? null,
      branch: request.branch ?? null,
      expand_links: request.safe_mode === true ? false : request.expand_links !== false,
      graph_depth: request.safe_mode === true ? 0 : request.graph_depth ?? 0,
      graph_weight: request.safe_mode === true ? 0 : request.graph_weight ?? null,
      memory_type: request.memory_type ?? null,
      observation_type: request.observation_type ?? null,
      question_kind: request.question_kind ?? null,
      safe_mode: request.safe_mode === true,
      sort_by: request.sort_by ?? "relevance",
      strict_project: request.strict_project !== false,
      vector_search: request.safe_mode === true ? false : request.vector_search !== false,
    };
    const knobsHash = this.sha256Short(JSON.stringify(knobs), 16);
    const keyPayload = {
      normalized_query_hash: normalizedQueryHash,
      scope,
      recall_mode: "search_prepared_v1",
      result_shape: "api_response_v1",
      limit: request.limit ?? 20,
      include_private: request.include_private === true,
      forensic: false,
      since: request.since ?? null,
      until: request.until ?? null,
      knobs_hash: knobsHash,
      data_watermark: dataWatermark,
    };
    const key = JSON.stringify(keyPayload);
    return {
      key,
      keyHash: this.sha256Short(key, 16),
      knobsHash,
      dataWatermark,
      ttlMs,
    };
  }

  private lookupRepeatRecallCache(
    request: SearchRequest,
    startedAt: number,
  ): { response: ApiResponse | null; candidate: RepeatRecallCacheCandidate | null } | null {
    const candidate = this.buildRepeatRecallCacheCandidate(request);
    if (!candidate) return null;
    const cached = this.repeatRecallCache.get(candidate.key);
    if (!cached) {
      return { response: null, candidate };
    }
    const nowMs = Date.now();
    if (nowMs - cached.storedAtMs > cached.ttlMs || cached.dataWatermark !== candidate.dataWatermark) {
      this.repeatRecallCache.delete(candidate.key);
      return { response: null, candidate };
    }
    const response = this.cloneApiResponse(cached.response);
    response.meta = {
      ...response.meta,
      latency_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      recall_cache_hit: true,
      recall_cache: {
        hit: true,
        key_hash: cached.keyHash,
        knobs_hash: cached.knobsHash,
        age_ms: nowMs - cached.storedAtMs,
        ttl_ms: cached.ttlMs,
        data_watermark: cached.dataWatermark,
      },
    };
    return { response, candidate };
  }

  private storeRepeatRecallCache(candidate: RepeatRecallCacheCandidate | null, response: ApiResponse): ApiResponse {
    if (!candidate) return response;
    if (!response.ok) return response;
    const nextResponse = this.cloneApiResponse(response);
    nextResponse.meta = {
      ...nextResponse.meta,
      recall_cache_hit: false,
      recall_cache: {
        hit: false,
        key_hash: candidate.keyHash,
        knobs_hash: candidate.knobsHash,
        ttl_ms: candidate.ttlMs,
        data_watermark: candidate.dataWatermark,
      },
    };
    this.repeatRecallCache.set(candidate.key, {
      storedAtMs: Date.now(),
      ttlMs: candidate.ttlMs,
      keyHash: candidate.keyHash,
      knobsHash: candidate.knobsHash,
      dataWatermark: candidate.dataWatermark,
      response: this.cloneApiResponse(nextResponse),
    });
    while (this.repeatRecallCache.size > REPEAT_RECALL_CACHE_CAPACITY) {
      const oldest = this.repeatRecallCache.keys().next().value;
      if (typeof oldest !== "string") break;
      this.repeatRecallCache.delete(oldest);
    }
    return nextResponse;
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
    const startedAt = performance.now();
    const cacheLookup = this.lookupRepeatRecallCache(request, startedAt);
    if (cacheLookup?.response) {
      this.recordRecallSearchTelemetry(startedAt, request, cacheLookup.response);
      return cacheLookup.response;
    }
    const cacheCandidate = cacheLookup?.candidate ?? null;
    const shouldOffloadSearch = shouldRunSearchOutOfProcess(request, {
      vectorEngine: this.vectorEngine,
      dbPath: this.config.dbPath,
    });
    const offloadMode: SearchOffloadMode = shouldUsePersistentSearchWorker({
      vectorEngine: this.vectorEngine,
      dbPath: this.config.dbPath,
    })
      ? "persistent_worker"
      : "child_process";
    if (request.safe_mode !== true && request.vector_search !== false && !shouldOffloadSearch) {
      await this.prepareSearchEmbedding(request.query || "");
    }
    let response: ApiResponse;
    if (shouldOffloadSearch) {
      try {
        response = await this.runSearchOutOfProcess(request);
      } catch (error) {
        if (isSearchOffloadQueueFull(error) || isSearchOffloadUnavailable(error)) {
          const rejected = this.makeSearchOffloadRejectedResponse(startedAt, request, error, offloadMode);
          this.recordRecallSearchTelemetry(startedAt, request, rejected);
          return rejected;
        }
        if (
          offloadMode === "persistent_worker" &&
          error instanceof Error &&
          error.message.includes("search worker request timed out")
        ) {
          const rejected = this.makeSearchOffloadRejectedResponse(
            startedAt,
            request,
            new SearchOffloadUnavailableError("search worker", "timeout"),
            offloadMode,
          );
          this.recordRecallSearchTelemetry(startedAt, request, rejected);
          return rejected;
        }
        response = await this.searchWithSafeFallback(
          request,
          error instanceof Error ? error.message : String(error),
          offloadMode,
        );
      }
    } else {
      response = this.search(request);
    }

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

    const finalResponse = this.storeRepeatRecallCache(cacheCandidate, response);
    this.recordRecallSearchTelemetry(startedAt, request, finalResponse);
    return finalResponse;
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

  async recordCheckpointQueued(request: RecordCheckpointRequest): Promise<ApiResponse | "queue_full"> {
    if (shouldRunCheckpointOutOfProcess({ dbPath: this.config.dbPath })) {
      if (this.checkpointChildPending >= this.getCheckpointChildMaxPending()) {
        return "queue_full";
      }
      return this.runCheckpointOutOfProcess(request);
    }
    return this.recordEventQueued(buildCheckpointEvent(request), {
      allowQueue: true,
      deferEmbedding: true,
    });
  }

  private scheduleObservationMaterialization(observationId: string | null): Record<string, unknown> {
    if (!observationId) {
      return { status: "skipped", reason: "missing_observation_id" };
    }
    if (!this.config.dbPath || this.config.dbPath === ":memory:") {
      return { status: "skipped", reason: "in_memory_db" };
    }
    if (envFalsy(process.env.HARNESS_MEM_CHECKPOINT_MATERIALIZE)) {
      return { status: "disabled" };
    }
    if (this.materializeChildPending >= this.getMaterializeChildMaxPending()) {
      return {
        status: "queue_full",
        max_pending: this.getMaterializeChildMaxPending(),
      };
    }

    this.materializeChildPending += 1;
    void this.runObservationMaterializeOutOfProcess(observationId)
      .catch((error) => {
        this.pushRuntimeWarning(
          `checkpoint materialization child failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        this.materializeChildPending = Math.max(0, this.materializeChildPending - 1);
      });

    return {
      status: "scheduled",
      observation_id: observationId,
      mode: "child_process",
      timeout_ms: this.materializeChildTimeoutMs(),
    };
  }

  private async runObservationMaterializeOutOfProcess(observationId: string): Promise<ApiResponse> {
    const timeoutMs = this.materializeChildTimeoutMs();
    const scriptPath = this.getMaterializeObservationChildScriptPath();
    let timedOut = false;
    const proc = Bun.spawn({
      cmd: buildMaterializeObservationChildCommand(scriptPath),
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        HARNESS_MEM_DB_PATH: this.config.dbPath,
        HARNESS_MEM_OBSERVATION_MATERIALIZE_CHILD: "1",
        HARNESS_MEM_EMBEDDING_PROVIDER: "fallback",
        HARNESS_MEM_EMBEDDING_MODEL: VECTOR_MODEL_VERSION,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, 1_000);
      void proc.exited.finally(() => clearTimeout(forceKill));
    }, timeoutMs);
    try {
      await writeJsonToChildStdin(proc.stdin as SearchWorkerStdin | null, { observation_id: observationId });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited ${exitCode}`;
        throw new Error(`observation materialization child ${reason}: ${stderr.trim() || stdout.trim()}`);
      }
      return parseChildApiResponse(stdout, stderr, "observation materialization child");
    } finally {
      clearTimeout(timer);
    }
  }

  private async runCheckpointOutOfProcess(request: RecordCheckpointRequest): Promise<ApiResponse> {
    const startedAt = performance.now();
    const timeoutMs = this.checkpointChildTimeoutMs();
    const scriptPath = this.getCheckpointChildScriptPath();
    this.checkpointChildPending += 1;
    let timedOut = false;
    const proc = Bun.spawn({
      cmd: buildCheckpointChildCommand(scriptPath),
      cwd: process.cwd(),
      env: {
        ...process.env,
        HARNESS_MEM_DB_PATH: this.config.dbPath,
        HARNESS_MEM_CHECKPOINT_CHILD_PROCESS: "1",
        HARNESS_MEM_EMBEDDING_PROVIDER: "fallback",
        HARNESS_MEM_EMBEDDING_MODEL: VECTOR_MODEL_VERSION,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, 1_000);
      void proc.exited.finally(() => clearTimeout(forceKill));
    }, timeoutMs);
    try {
      await writeJsonToChildStdin(proc.stdin as SearchWorkerStdin | null, request);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited ${exitCode}`;
        throw new Error(`checkpoint child ${reason}: ${stderr.trim() || stdout.trim()}`);
      }
      const response = parseChildApiResponse(stdout, stderr, "checkpoint child");
      const offloadWallMs = Number((performance.now() - startedAt).toFixed(2));
      const materialization = this.scheduleObservationMaterialization(firstResponseObservationId(response));
      response.meta = {
        ...response.meta,
        latency_ms: offloadWallMs,
        checkpoint_offload: {
          mode: "child_process",
          timeout_ms: timeoutMs,
          wall_ms: offloadWallMs,
          child_latency_ms: typeof response.meta.latency_ms === "number" ? response.meta.latency_ms : null,
          derived_materialization: materialization,
        },
      };
      return response;
    } catch (error) {
      const response = makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        {
          project: request.project,
          session_id: request.session_id,
        },
      );
      Object.assign(response.meta, {
        error_code: "checkpoint_offload_failed",
        http_status: 503,
        checkpoint_offload: {
          mode: "child_process",
          timeout_ms: timeoutMs,
          timed_out: timedOut,
        },
      });
      return response;
    } finally {
      clearTimeout(timer);
      this.checkpointChildPending = Math.max(0, this.checkpointChildPending - 1);
    }
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

  health(options: { includeCounts?: boolean } = {}): ApiResponse {
    const startedAt = performance.now();
    this.refreshEmbeddingHealth();
    const embeddingReadiness = this.getEmbeddingReadiness();

    const includeCounts = options.includeCounts === true;
    const counts = includeCounts
      ? {
          sessions: Number((this.db.query(`SELECT COUNT(*) AS count FROM mem_sessions`).get() as { count: number }).count || 0),
          events: Number((this.db.query(`SELECT COUNT(*) AS count FROM mem_events`).get() as { count: number }).count || 0),
          observations: Number((this.db.query(`SELECT COUNT(*) AS count FROM mem_observations`).get() as { count: number }).count || 0),
          retry_queue: Number((this.db.query(`SELECT COUNT(*) AS count FROM mem_retry_queue`).get() as { count: number }).count || 0),
        }
      : undefined;

    const dbPath = resolveHomePath(this.config.dbPath);
    const dbSize = includeCounts && existsSync(dbPath) ? statSync(dbPath).size : null;

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
          telemetry: getTelemetryStatus(),
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
            ...this.currentRuntimeWarnings(),
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
          counts_status: includeCounts ? "exact" : "omitted",
          ...(counts ? { counts } : {}),
        },
      ],
      {},
      { ranking: "health_v1", counts_status: includeCounts ? "exact" : "omitted" }
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
          (SELECT COUNT(*) FROM mem_observations WHERE archived_at IS NULL) AS observations_count
      `)
      .get() as {
        mem_vectors_count: number;
        observations_count: number;
      } | null;
    const currentModelVectorRows = this.vectorModelVersion.startsWith("adaptive:")
      ? this.db
          .query<{ count: number }, []>(
            `SELECT COUNT(*) AS count FROM mem_vectors WHERE model >= 'adaptive:' AND model < 'adaptive;'`,
          )
          .get()
      : this.db
          .query<{ count: number }, [string]>(`SELECT COUNT(*) AS count FROM mem_vectors WHERE model = ?`)
          .get(this.vectorModelVersion);
    const observationsCount = Number(vectorCoverage?.observations_count ?? 0);
    const currentModelObservations = Math.min(observationsCount, Number(currentModelVectorRows?.count ?? 0));
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
              current_model_vector_rows: Number(currentModelVectorRows?.count ?? 0),
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

  async projectsStatsQueued(request: ProjectsStatsRequest = {}): Promise<ApiResponse> {
    const startedAt = performance.now();
    if (!shouldRunProjectsStatsOutOfProcess({ dbPath: this.config.dbPath })) {
      return this.projectsStats(request);
    }
    if (this.projectsStatsChildPending >= this.getProjectsStatsChildMaxPending()) {
      const response = makeErrorResponse(
        startedAt,
        "projects stats child queue full, retry later",
        request as unknown as Record<string, unknown>,
      );
      Object.assign(response.meta, {
        error_code: "projects_stats_offload_queue_full",
        http_status: 503,
        projects_stats_offload: {
          mode: "child_process",
          queue_full: true,
          pending: this.projectsStatsChildPending,
          max_pending: this.getProjectsStatsChildMaxPending(),
        },
      });
      return response;
    }
    return this.runProjectsStatsOutOfProcess(request);
  }

  private async runProjectsStatsOutOfProcess(request: ProjectsStatsRequest): Promise<ApiResponse> {
    const startedAt = performance.now();
    const timeoutMs = this.projectsStatsChildTimeoutMs();
    const scriptPath = this.getProjectsStatsChildScriptPath();
    this.projectsStatsChildPending += 1;
    let timedOut = false;
    const childCommand = buildProjectsStatsChildCommand(scriptPath);
    // Bun.spawn can synchronously stall the daemon here; node spawn keeps request setup off the hot path.
    const proc = spawnChildProcess(childCommand[0], childCommand.slice(1), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        HARNESS_MEM_DB_PATH: this.config.dbPath,
        HARNESS_MEM_PROJECTS_STATS_CHILD_PROCESS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = new Promise<number>((resolve, reject) => {
      proc.once("error", reject);
      proc.once("exit", (code, signal) => {
        resolve(code ?? (signal ? 1 : 0));
      });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, 1_000);
      void exited.finally(() => clearTimeout(forceKill));
    }, timeoutMs);
    try {
      writeJsonToNodeChildStdin(proc.stdin, request);
      const [stdout, stderr, exitCode] = await Promise.all([
        readNodeChildStream(proc.stdout),
        readNodeChildStream(proc.stderr),
        exited,
      ]);
      if (exitCode !== 0) {
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited ${exitCode}`;
        throw new Error(`projects stats child ${reason}: ${stderr.trim() || stdout.trim()}`);
      }
      const response = parseChildApiResponse(stdout, stderr, "projects stats child");
      const offloadWallMs = Number((performance.now() - startedAt).toFixed(2));
      response.meta = {
        ...response.meta,
        latency_ms: offloadWallMs,
        projects_stats_offload: {
          mode: "child_process",
          timeout_ms: timeoutMs,
          wall_ms: offloadWallMs,
          child_latency_ms: typeof response.meta.latency_ms === "number" ? response.meta.latency_ms : null,
        },
      };
      return response;
    } catch (error) {
      const response = makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        request as unknown as Record<string, unknown>,
      );
      Object.assign(response.meta, {
        error_code: "projects_stats_offload_failed",
        http_status: 503,
        projects_stats_offload: {
          mode: "child_process",
          timeout_ms: timeoutMs,
          timed_out: timedOut,
        },
      });
      return response;
    } finally {
      clearTimeout(timer);
      this.projectsStatsChildPending = Math.max(0, this.projectsStatsChildPending - 1);
    }
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
    const lightweightChild =
      process.env.HARNESS_MEM_SEARCH_CHILD_PROCESS === "1" ||
      process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS === "1" ||
      process.env.HARNESS_MEM_CHECKPOINT_CHILD_PROCESS === "1" ||
      process.env.HARNESS_MEM_EVENT_CHILD_PROCESS === "1" ||
      process.env.HARNESS_MEM_RETRY_CHILD_PROCESS === "1" ||
      process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_PROCESS === "1" ||
      process.env.HARNESS_MEM_VECTOR_BACKFILL_CHILD === "1" ||
      process.env.HARNESS_MEM_OBSERVATION_MATERIALIZE_CHILD === "1";

    if (this.searchWorker) {
      this.searchWorker.stop("core shutdown");
      this.searchWorker = null;
    }

    // §91-002: stop partial-finalize scheduler before stopping ingest timers
    this.partialFinalizeScheduler.stop();
    // S89-003: stop reindex backfill scheduler
    this.reindexVectorsScheduler.stop();
    if (process.env.HARNESS_MEM_VECTOR_BACKFILL_CHILD !== "1") {
      this.vectorBackfillWorker.stop();
    }
    this.ingestCoord.stopTimers();

    if (!lightweightChild) {
      this.processRetryQueue(true);
    }

    // Shutdown managed backend (fire-and-forget, best effort)
    if (this.managedBackend) {
      this.managedBackend.shutdown().catch(() => {});
      this.managedBackend = null;
    }

    if (!lightweightChild) {
      try {
        this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // best effort
      }
    }

    try {
      this.db.close(process.platform === "win32");
    } catch {
      // ignore close errors
    }

    if (!lightweightChild) {
      try {
        writeFileSync(this.heartbeatPath, JSON.stringify({ pid: process.pid, ts: nowIso(), state: `stopped:${signal}` }));
      } catch {
        // best effort
      }
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
