import { Database, type SQLQueryBindings } from "bun:sqlite";
import { spawn as spawnChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  configureDatabase as configureDb,
  initFtsIndex as initFtsFromDb,
  initSchema as initDbSchema,
  migrateSchema as migrateDbSchema,
} from "../db/schema";
import { runSearchDbMaintenanceIfDue } from "../db/search-maintenance";
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
  resolveEmbeddingShadowProviders,
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
import {
  llmRerank,
  llmNoMemoryCheck,
  buildLlmRerankerConfigFromEnv,
  buildSearchLlmRerankerConfigFromEnv,
} from "../rerank/llm-reranker.js";
import { queryRewriteMeta, rewriteSearchQueryIfEnabled } from "../retrieval/query-rewrite.js";
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
import { buildEmbeddingShadowManifest, type EmbeddingShadowManifest } from "../projector/shadow-sync";
import { collectEnvironmentSnapshot, type EnvironmentSnapshot } from "../system-environment/collector";
import { TtlCache } from "../system-environment/cache";
import { getTelemetryStatus, hashTelemetryValue, recordRecallTelemetry } from "../telemetry/otel";
import { SessionManager, buildCheckpointEvent } from "./session-manager";
import { EventRecorder } from "./event-recorder";
import { ObservationStore } from "./observation-store";
import {
  EXTERNAL_CHANNEL_BLOCKED_PRIVACY_TAGS,
  sanitizeItemsForExternalChannel,
  type ExternalChannelItem,
} from "./external-channel-policy";
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
  parseJsonSafe,
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
const DEFAULT_SEARCH_WORKER_SCALE_OBS_THRESHOLD = 100_000;
const DEFAULT_SEARCH_WORKER_SCALE_TIMEOUT_MS = 8_000;
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
const DEFAULT_RECALL_PROJECTION_REFRESH_CHILD_TIMEOUT_MS = 30_000;
const DEFAULT_RECALL_PROJECTION_REFRESH_CHILD_QUEUE_MAX = 1;
const DEFAULT_RECALL_PROJECTION_REFRESH_DEBOUNCE_MS = 1_000;
const DEFAULT_RECALL_PROJECTION_REFRESH_LIMIT = 5_000;
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
      code: "safe_lexical_fallback",
      fallback_path: "safe_lexical_child",
      retryable: true,
      user_action: "retry search; lexical-only results are returned",
    },
    {
      code: "in_process_degraded",
      fallback_path: "bounded_recent_lexical",
      retryable: true,
      user_action: "retry later for full hybrid search; degraded in-process results were returned",
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
interface RecallProjectionAutoRefreshRequest {
  project: string;
  include_private: boolean;
  limit: number;
  reason: "projection_missing" | "projection_stale";
  projection_generation: string | null;
  projection_source_watermark: string | null;
  current_source_watermark: string | null;
}
type RecallExplanationReason =
  | "scope_match"
  | "type_match"
  | "source_match"
  | "lexical_match"
  | "adr_provenance"
  | "work_ref"
  | "degraded_fallback";

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
  preverified_backup_evidence_token?: string;
  temp_test_backup_token?: string;
  retention_ack?: boolean;
  archive_ack?: boolean;
  confirmation?: string;
  readiness_only?: boolean;
};

type AdminBackupEvidenceRequest = {
  backup_path?: string;
  backup_sha256?: string;
  candidate_ids?: string[];
  target_ids?: string[];
  ttl_seconds?: number;
};

type AdminArchiveRequest = {
  project?: string;
  candidate_ids?: string[];
  target_ids?: string[];
  limit?: number;
  score_threshold?: number;
  protect_accessed?: boolean;
  execute?: boolean;
  manifest_sha256?: string;
  reason?: string;
};

type AdminArchiveRestoreRequest = {
  archive_id?: string;
  archive_full_ref?: string;
  execute?: boolean;
  reason?: string;
};

type AdminArchiveSearchRequest = {
  archive_id?: string;
  observation_id?: string;
  project?: string;
  archive_state?: string;
  manifest_sha256?: string;
  limit?: number;
};

type AdminForgetMaintenanceRequest = {
  reason?: string;
  force?: boolean;
  mode?: "dry-run" | "archive";
  limit?: number;
  score_threshold?: number;
  protect_accessed?: boolean;
  thresholds?: Partial<Record<keyof ForgetMaintenanceThresholds, number>>;
  vector_prune?: AdminVectorPruneRequest;
};

type AdminVectorPruneRequest = {
  project?: string;
  limit?: number;
  current_model?: string;
  execute?: boolean;
};

type ForgetMaintenanceMeasurements = {
  db_size_bytes: number | null;
  wal_size_bytes: number | null;
  active_observations: number;
  archived_observations: number;
  archived_vector_rows: number;
  stale_vector_rows: number;
  current_vector_model: string;
};

type ForgetMaintenanceThresholds = {
  db_size_bytes?: number;
  wal_size_bytes?: number;
  active_observations?: number;
  archived_observations?: number;
  stale_vector_rows?: number;
};

type ForgetAutonomyLevel =
  | "L0_report"
  | "L1_reversible_archive"
  | "L2_derived_cache_prune"
  | "L3_guarded_purge"
  | "L4_compact";

type ForgetAutonomyReportRequest = {
  candidate_ids?: string[];
  project?: string;
  protect_accessed?: boolean;
  autonomy_level?: ForgetAutonomyLevel;
  estimated_reclaim_bytes?: number;
  vector_prune_plan?: Record<string, unknown> | null;
};

type ForgetAutonomyReport = {
  autonomy_level: ForgetAutonomyLevel;
  estimated_reclaim_bytes: number;
  excluded_by_reason: Record<string, number>;
  legal_hold_count: number;
  durable_type_count: number;
  candidate_count: number;
  restore_required_before_purge: boolean;
  default_hard_purge: false;
  default_compact: false;
  excluded_counts_may_overlap: true;
};

type ArchiveCandidateRow = {
  id: string;
  project: string;
  session_id: string;
  user_id: string;
  team_id: string | null;
  content: string;
  content_redacted: string;
  raw_text: string | null;
  observation_type: string;
  memory_type: string;
  tags_json: string;
  privacy_tags_json: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type ArchiveManifest = {
  schema_version: "s129-archive-v1";
  operation: "admin.archive";
  candidate_ids: string[];
  candidate_count: number;
  cross_store_impact: Record<string, number>;
  manifest_sha256: string;
};

type ArchivePayload = {
  schema_version: "s129-archive-payload-v1";
  archive_id: string;
  observation_id: string;
  created_at: string;
  actor: "system";
  reason: string;
  content_sha256: string;
  manifest_sha256: string;
  cross_store_impact: Record<string, number>;
  rows: Record<string, Array<Record<string, unknown>>>;
};

type ArchiveStorageRow = {
  archive_id: string;
  observation_id: string;
  archive_full_ref: string | null;
  archive_state: string;
  reason: string;
  content_sha256: string;
  manifest_sha256: string;
  payload_json: string | null;
  payload_sha256: string | null;
  full_purged_at: string | null;
};

type ArchivePrepareResult =
  | { ok: true; manifest: ArchiveManifest; rows: ArchiveCandidateRow[] }
  | { ok: false; error: string };

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
  candidate_ids: string[] | null;
  candidate_coverage_sha256: string | null;
  temp_test_backup_token_sha256: string | null;
  preverified_backup_evidence_token_sha256: string | null;
  kind: "backup_file" | "sha256_metadata" | "temp_test_token" | "preverified_backup" | "missing";
  integrity_check: {
    checked: boolean;
    ok: boolean;
    result: string | null;
    error: string | null;
  };
};

type BackupFileSnapshot = {
  path: string;
  realpath: string;
  size_bytes: number;
  mtime_ms: number;
  mtime_iso: string;
};

type PreverifiedBackupEvidence = BackupFileSnapshot & {
  token_sha256: string;
  backup_sha256: string;
  candidate_ids: string[];
  candidate_coverage_sha256: string;
  created_at: string;
  expires_at: string;
  db_identity_sha256: string;
  integrity_check: BackupEvidence["integrity_check"];
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
  confirmation_phrase?: string;
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

export function buildRecallProjectionRefreshChildCommand(
  scriptPath: string,
  platform = process.platform,
): string[] {
  const runCommand = [process.execPath, "run", scriptPath];
  return platform === "win32" ? runCommand : ["nice", "-n", "10", ...runCommand];
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

function sha256FileHex(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

const AUTONOMOUS_FORGET_DURABLE_TYPES = new Set(["decision", "pattern", "preference", "lesson"]);
const AUTONOMOUS_FORGET_PRIVACY_TAGS = new Set(["private", "secret", "sensitive"]);

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
  private readonly hardPurgePlanExpirations = new Map<string, string>();
  private readonly preverifiedBackupEvidenceTokens = new Map<string, PreverifiedBackupEvidence>();
  /** §91-002: partial-finalize scheduler (opt-in via config.partialFinalizeEnabled) */
  private partialFinalizeScheduler!: PartialFinalizeScheduler;
  /** S89-003: vector reindex backfill scheduler (opt-in via config.reindexVectorsEnabled) */
  private reindexVectorsScheduler!: ReindexVectorsScheduler;
  /** S124-007: out-of-request vector compact rebuild + reindex worker */
  private vectorBackfillWorker!: VectorBackfillWorker;
  /** S132: opt-in restore-capable archive maintenance scheduler */
  private forgetMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private forgetMaintenanceRunning = false;
  private forgetMaintenanceBackoffUntilMs = 0;
  /** S127-002: warm persistent worker for normal vector search. */
  private searchWorker: PersistentSearchWorkerClient | null = null;
  private searchChildPending = 0;
  private cachedObservationCount: { value: number; checkedAtMs: number } | null = null;
  private eventChildPending = 0;
  private retryChildPending = 0;
  private checkpointChildPending = 0;
  private materializeChildPending = 0;
  private projectsStatsChildPending = 0;
  private recallProjectionRefreshChildPending = 0;
  private readonly recallProjectionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly recallProjectionRefreshInFlight = new Set<string>();

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
      getEmbeddingShadowManifest: () => this.getEmbeddingShadowManifest(),
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

  private getRecallProjectionRefreshChildScriptPath(): string {
    return fileURLToPath(new URL("../tools/recall-projection-refresh-child.ts", import.meta.url));
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

  private getRecallProjectionRefreshChildMaxPending(): number {
    return clampLimit(
      Number(
        process.env.HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD_QUEUE_MAX ||
          DEFAULT_RECALL_PROJECTION_REFRESH_CHILD_QUEUE_MAX,
      ),
      DEFAULT_RECALL_PROJECTION_REFRESH_CHILD_QUEUE_MAX,
      1,
      4,
    );
  }

  private recallProjectionRefreshChildTimeoutMs(): number {
    return clampLimit(
      Number(
        process.env.HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD_TIMEOUT_MS ||
          DEFAULT_RECALL_PROJECTION_REFRESH_CHILD_TIMEOUT_MS,
      ),
      DEFAULT_RECALL_PROJECTION_REFRESH_CHILD_TIMEOUT_MS,
      250,
      120_000,
    );
  }

  private recallProjectionRefreshDebounceMs(): number {
    return clampLimit(
      Number(
        process.env.HARNESS_MEM_RECALL_PROJECTION_REFRESH_DEBOUNCE_MS ||
          DEFAULT_RECALL_PROJECTION_REFRESH_DEBOUNCE_MS,
      ),
      DEFAULT_RECALL_PROJECTION_REFRESH_DEBOUNCE_MS,
      0,
      60_000,
    );
  }

  private recallProjectionRefreshLimit(): number {
    return clampLimit(
      Number(
        process.env.HARNESS_MEM_RECALL_PROJECTION_REFRESH_LIMIT ||
          DEFAULT_RECALL_PROJECTION_REFRESH_LIMIT,
      ),
      DEFAULT_RECALL_PROJECTION_REFRESH_LIMIT,
      1,
      DEFAULT_RECALL_PROJECTION_REFRESH_LIMIT,
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
    const base = worker.isReady()
      ? clampLimit(
          Number(process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS || DEFAULT_SEARCH_WORKER_TIMEOUT_MS),
          DEFAULT_SEARCH_WORKER_TIMEOUT_MS,
          250,
          60_000,
        )
      : clampLimit(
          Number(
            process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS ||
              process.env.HARNESS_MEM_SEARCH_CHILD_TIMEOUT_MS ||
              DEFAULT_SEARCH_WORKER_STARTUP_TIMEOUT_MS,
          ),
          DEFAULT_SEARCH_WORKER_STARTUP_TIMEOUT_MS,
          250,
          60_000,
        );

    const scaleThreshold = clampLimit(
      Number(process.env.HARNESS_MEM_SEARCH_SCALE_OBS_THRESHOLD || DEFAULT_SEARCH_WORKER_SCALE_OBS_THRESHOLD),
      DEFAULT_SEARCH_WORKER_SCALE_OBS_THRESHOLD,
      10_000,
      5_000_000,
    );
    const scaleTimeoutMs = clampLimit(
      Number(process.env.HARNESS_MEM_SEARCH_SCALE_TIMEOUT_MS || DEFAULT_SEARCH_WORKER_SCALE_TIMEOUT_MS),
      DEFAULT_SEARCH_WORKER_SCALE_TIMEOUT_MS,
      base,
      60_000,
    );
    if (this.getActiveObservationCount() >= scaleThreshold) {
      return Math.max(base, scaleTimeoutMs);
    }
    return base;
  }

  private getActiveObservationCount(): number {
    const nowMs = Date.now();
    if (this.cachedObservationCount && nowMs - this.cachedObservationCount.checkedAtMs < 60_000) {
      return this.cachedObservationCount.value;
    }
    let value = 0;
    try {
      const row = this.db
        .query(`SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL`)
        .get() as { count?: number } | null;
      value = Number(row?.count ?? 0);
    } catch {
      value = 0;
    }
    this.cachedObservationCount = { value, checkedAtMs: nowMs };
    return value;
  }

  private canReadLocalDb(): boolean {
    try {
      this.db.query("SELECT 1 AS ok").get();
      return true;
    } catch {
      return false;
    }
  }

  private maybeRunSearchDbMaintenance(): void {
    try {
      runSearchDbMaintenanceIfDue(this.db, {
        ftsEnabled: this.ftsEnabled,
        writeAudit: (action, targetType, targetId, details) => {
          this.writeAuditLog(action, targetType, targetId, details);
        },
      });
    } catch {
      // best effort
    }
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
    let fallbackMode: "child_process" | "in_process" | "empty_error" = "child_process";
    let fallbackFailedReason: string | null = null;
    try {
      fallback = await this.runSearchWithOneShotChild(safeRequest);
    } catch (fallbackError) {
      fallbackFailedReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      if (this.canReadLocalDb()) {
        fallback = this.obsStore.searchInProcessDegraded(request);
        fallbackMode = "in_process";
      } else {
        fallbackMode = "empty_error";
        fallback = makeErrorResponse(
          startedAt,
          `search offload failed and safe fallback failed: ${fallbackFailedReason}`,
          safeRequest as unknown as Record<string, unknown>,
        );
      }
    }
    const existingWarnings = Array.isArray(fallback.meta.warnings)
      ? (fallback.meta.warnings as string[])
      : [];
    const fallbackFailed = fallbackMode === "empty_error";
    const degradation = Array.isArray(fallback.meta.degradation)
      ? [...(fallback.meta.degradation as string[])]
      : fallbackMode === "in_process"
        ? ["safe_lexical_fallback", "in_process_degraded"]
        : ["safe_lexical_fallback"];
    fallback.meta = {
      ...fallback.meta,
      ...(fallbackFailed
        ? {
            error_code: "search_fallback_failed",
            http_status: 503,
          }
        : {}),
      degradation,
      warnings: [
        ...existingWarnings,
        fallbackFailed
          ? `search offload failed; safe lexical fallback also failed: ${reason.slice(0, 240)}`
          : fallbackMode === "in_process"
            ? `search offload failed; returned in-process degraded fallback: ${reason.slice(0, 240)}`
            : `search offload failed; returned safe lexical fallback: ${reason.slice(0, 240)}`,
      ],
      search_offload: {
        mode,
        fallback: fallbackFailed ? "none" : fallbackMode === "in_process" ? "in_process_degraded" : "safe_lexical",
        fallback_mode: fallbackMode,
        failed_reason: reason.slice(0, 500),
        ...(fallbackFailedReason ? { fallback_failed_reason: fallbackFailedReason.slice(0, 500) } : {}),
      },
    };
    if (!fallbackFailed) {
      fallback.ok = true;
      delete fallback.error;
      if (fallback.meta && typeof fallback.meta === "object") {
        delete (fallback.meta as Record<string, unknown>).http_status;
        delete (fallback.meta as Record<string, unknown>).error_code;
      }
    }
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
      db: this.db,
      openaiApiKey: this.config.openaiApiKey,
      openaiEmbedModel: this.config.openaiEmbedModel,
      ollamaBaseUrl: this.config.ollamaBaseUrl,
      ollamaEmbedModel: this.config.ollamaEmbedModel,
      proApiKey: this.config.proApiKey,
      proApiUrl: this.config.proApiUrl,
      proApiModel: this.config.proApiModel,
      proApiZdrEnforced: this.config.proApiZdrEnforced,
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

  private getEmbeddingShadowManifest(): EmbeddingShadowManifest | null {
    if ((process.env.HARNESS_MEM_EMBEDDING_SHADOW || "").trim() !== "1") {
      return null;
    }

    const modelIds = (process.env.HARNESS_MEM_EMBEDDING_SHADOW_MODELS || "")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    const row = this.db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count
         FROM mem_vectors v
         JOIN mem_observations o ON o.id = v.observation_id
         WHERE v.model = ? AND o.archived_at IS NULL`
      )
      .get(this.vectorModelVersion);

    return buildEmbeddingShadowManifest({
      defaultVectorModel: this.vectorModelVersion,
      defaultVectorDimension: this.config.vectorDimension,
      activeDefaultVectorRows: Number(row?.count ?? 0),
      candidates: resolveEmbeddingShadowProviders({
        modelIds,
        currentVectorModel: this.vectorModelVersion,
        currentVectorDimension: this.config.vectorDimension,
        localModelsDir: this.config.localModelsDir,
      }),
    });
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

    // §155-A03: 嘘 ready の修正。local ONNX provider は init 前から
    // status: "healthy" を返すが details は "lazy initialization pending" のまま、
    // という設計だった。details が warming/lazy/prime-required を示している間は
    // ready=false に倒し、health/readiness の契約を正直化する。
    const detailsRaw = this.embeddingHealth.details || "";
    const detailsLowered = detailsRaw.toLowerCase();
    const isWarmingFromDetails =
      detailsLowered.includes("lazy initialization pending") ||
      detailsLowered.includes("is still warming up") ||
      detailsLowered.includes("requires async prime");

    if (this.embeddingHealth.status === "healthy" && !isWarmingFromDetails) {
      return {
        required: true,
        ready: true,
        state: "ready",
        retryable: false,
        providerStatus: this.embeddingHealth.status,
        details: this.embeddingHealth.details,
      };
    }

    const details = detailsRaw || "local embedding provider is not ready";
    const lowered = detailsLowered;
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
    this.startForgetMaintenanceScheduler();
  }

  private startForgetMaintenanceScheduler(): void {
    if (this.config.forgetMaintenanceEnabled !== true) {
      return;
    }
    const intervalMs = clampLimit(this.config.forgetMaintenanceIntervalMs, 3600000, 60000, 24 * 60 * 60 * 1000);
    const healthBudgetMs = clampLimit(this.config.forgetMaintenanceHealthBudgetMs, 2000, 100, 60_000);
    const backoffMs = clampLimit(this.config.forgetMaintenanceBackoffMs, 300_000, 1_000, 24 * 60 * 60 * 1000);
    this.forgetMaintenanceTimer = setInterval(() => {
      if (this.shuttingDown || this.forgetMaintenanceRunning) return;
      if (Date.now() < this.forgetMaintenanceBackoffUntilMs) return;
      this.forgetMaintenanceRunning = true;
      const startedAt = performance.now();
      try {
        const schedulerLimit = Math.min(clampLimit(this.config.forgetMaintenanceLimit, 100, 1, 500), 100);
        const response = this.adminForgetMaintenance({
          reason: "scheduler",
          limit: schedulerLimit,
          mode: this.config.forgetMaintenanceMode === "archive" ? "archive" : "dry-run",
        });
        const durationMs = Math.round(performance.now() - startedAt);
        if (durationMs > healthBudgetMs) {
          this.forgetMaintenanceBackoffUntilMs = Date.now() + backoffMs;
          this.writeAuditLog("admin.forget_maintenance.backoff", "observation", "", {
            reason: "health_budget_exceeded",
            duration_ms: durationMs,
            health_budget_ms: healthBudgetMs,
            backoff_ms: backoffMs,
            mode: this.config.forgetMaintenanceMode,
            candidate_count: response.meta?.candidate_count,
          });
        }
      } catch (error) {
        this.forgetMaintenanceBackoffUntilMs = Date.now() + backoffMs;
        try {
          this.writeAuditLog("admin.forget_maintenance.error", "observation", "", {
            reason: "scheduler",
            error: error instanceof Error ? error.message : String(error),
            backoff_ms: backoffMs,
          });
        } catch {
          // best effort
        }
      } finally {
        this.forgetMaintenanceRunning = false;
      }
    }, intervalMs);
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

  private tableExists(name: string, db: Database = this.db): boolean {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return false;
    }
    const row = db
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

  private selectArchiveStorageRowsByObservationIds(ids: string[], db: Database = this.db): ArchiveStorageRow[] {
    if (ids.length === 0 || !this.tableExists("mem_archive_stubs", db) || !this.tableExists("mem_archive_full", db)) {
      return [];
    }
    const placeholders = ids.map(() => "?").join(", ");
    return db
      .query<ArchiveStorageRow, string[]>(`
        SELECT
          s.archive_id, s.observation_id, s.archive_full_ref, s.archive_state, s.reason,
          s.content_sha256, s.manifest_sha256,
          f.payload_json, f.payload_sha256, f.purged_at AS full_purged_at
        FROM mem_archive_stubs s
        LEFT JOIN mem_archive_full f ON f.archive_full_ref = s.archive_full_ref
        WHERE s.observation_id IN (${placeholders})
        ORDER BY s.observation_id ASC, s.created_at DESC, s.archive_id ASC
      `)
      .all(...ids);
  }

  private computeCandidateBackupCoverage(
    db: Database,
    candidateIds: string[],
  ): { candidate_ids: string[]; candidate_coverage_sha256: string } | { error: string } {
    const ids = uniqueSortedStrings(candidateIds);
    if (ids.length === 0) {
      return { error: "candidate_ids are required for backup evidence coverage" };
    }
    if (ids.length > 500) {
      return { error: "candidate_ids length exceeds maximum of 500" };
    }
    if (!this.tableExists("mem_observations", db)) {
      return { error: "backup candidate coverage requires mem_observations" };
    }
    if (!this.tableExists("mem_archive_stubs", db) || !this.tableExists("mem_archive_full", db)) {
      return { error: "backup candidate coverage requires mem_archive_stubs and mem_archive_full" };
    }

    const placeholders = ids.map(() => "?").join(", ");
    const observationRows = db
      .query<{ id: string }, string[]>(`
        SELECT id
        FROM mem_observations
        WHERE id IN (${placeholders})
        ORDER BY id ASC
      `)
      .all(...ids);
    const observed = new Set(observationRows.map((row) => row.id));
    const missingObservations = ids.filter((id) => !observed.has(id));
    if (missingObservations.length > 0) {
      return { error: `backup candidate coverage missing observations: ${missingObservations.join(", ")}` };
    }

    const rowsByObservation = new Map<string, ArchiveStorageRow[]>();
    for (const row of this.selectArchiveStorageRowsByObservationIds(ids, db)) {
      const rows = rowsByObservation.get(row.observation_id) ?? [];
      rows.push(row);
      rowsByObservation.set(row.observation_id, rows);
    }

    const candidates: Array<Record<string, unknown>> = [];
    const missingRestoreCapable: string[] = [];
    for (const id of ids) {
      let covered: Record<string, unknown> | null = null;
      for (const row of rowsByObservation.get(id) ?? []) {
        if (row.archive_state !== "archived") continue;
        const payloadValidation = this.validateArchivePayload(row);
        if (!payloadValidation.ok) continue;
        covered = {
          observation_id: id,
          archive_id: row.archive_id,
          archive_full_ref: row.archive_full_ref,
          archive_state: row.archive_state,
          content_sha256: row.content_sha256,
          manifest_sha256: row.manifest_sha256,
          payload_sha256: row.payload_sha256,
          payload_json_sha256: payloadValidation.payload_sha256,
        };
        break;
      }
      if (covered) {
        candidates.push(covered);
      } else {
        missingRestoreCapable.push(id);
      }
    }

    if (missingRestoreCapable.length > 0) {
      return {
        error: `backup candidate coverage missing restore-capable archive payloads: ${missingRestoreCapable.join(", ")}`,
      };
    }

    return {
      candidate_ids: ids,
      candidate_coverage_sha256: sha256Hex(stableJson({
        schema_version: "s130-backup-candidate-coverage-v1",
        candidate_ids: ids,
        candidates,
      })),
    };
  }

  private validateArchivePayload(row: ArchiveStorageRow): { ok: true; payload: ArchivePayload; payload_sha256: string } | { ok: false; error: string } {
    if (!row.archive_full_ref) return { ok: false, error: "archive full ref is missing" };
    if (row.full_purged_at) return { ok: false, error: "archive full payload is purged" };
    if (!row.payload_json || !row.payload_sha256) return { ok: false, error: "archive full payload is missing" };
    if (row.payload_json.trim() === "" || row.payload_json.trim() === "{}") {
      return { ok: false, error: "archive full payload is empty" };
    }
    const actualPayloadSha256 = sha256Hex(row.payload_json);
    if (actualPayloadSha256 !== row.payload_sha256) {
      return { ok: false, error: "payload_sha256 verification failed" };
    }
    let payload: ArchivePayload;
    try {
      payload = JSON.parse(row.payload_json) as ArchivePayload;
    } catch {
      return { ok: false, error: "archive payload_json is invalid" };
    }
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "archive payload_json must be an object" };
    }
    if (payload.schema_version !== "s129-archive-payload-v1") {
      return { ok: false, error: "archive payload schema_version is unsupported" };
    }
    if (payload.archive_id !== row.archive_id || payload.observation_id !== row.observation_id) {
      return { ok: false, error: "archive payload identity mismatch" };
    }
    if (payload.manifest_sha256 !== row.manifest_sha256) {
      return { ok: false, error: "manifest_sha256 verification failed" };
    }
    const observationRows = Array.isArray(payload.rows?.mem_observations)
      ? payload.rows.mem_observations
      : [];
    const observation = observationRows.find((entry) => entry.id === row.observation_id);
    if (!observation) {
      return { ok: false, error: "archive payload missing target observation row" };
    }
    const observationContent = typeof observation.content === "string" ? observation.content : "";
    const payloadContentSha256 = sha256Hex(observationContent);
    if (payload.content_sha256 !== payloadContentSha256 || row.content_sha256 !== payloadContentSha256) {
      return { ok: false, error: "content_sha256 verification failed" };
    }
    return { ok: true, payload, payload_sha256: actualPayloadSha256 };
  }

  private archivePayloadRowKey(tableName: string, row: Record<string, unknown>): string {
    const keyColumnsByTable: Record<string, string[]> = {
      mem_observations: ["id"],
      mem_vectors: ["observation_id", "model"],
      mem_links: ["id"],
      mem_relations: ["id"],
      mem_facts: ["fact_id"],
      mem_events: ["event_id"],
      mem_tags: ["observation_id", "tag", "tag_type"],
      mem_observation_entities: ["observation_id", "entity_id"],
      mem_entities: ["id"],
      mem_nuggets: ["nugget_id"],
      mem_nugget_vectors: ["nugget_id", "model"],
    };
    const columns = keyColumnsByTable[tableName] ?? [];
    return columns.map((column) => String(row[column] ?? "")).join("\u001f");
  }

  private archivePayloadTableKeys(tableName: string, rows: Array<Record<string, unknown>> | undefined): string[] {
    return [...new Set((rows ?? []).map((row) => this.archivePayloadRowKey(tableName, row)))].sort();
  }

  private archivePayloadComparableRow(tableName: string, row: Record<string, unknown>): Record<string, unknown> {
    const comparable: Record<string, unknown> = {};
    const excludedColumnsByTable: Record<string, Set<string>> = {
      mem_observations: new Set(["archived_at", "updated_at"]),
    };
    const excludedColumns = excludedColumnsByTable[tableName] ?? new Set<string>();
    for (const column of this.getTableColumnNames(tableName).sort()) {
      if (excludedColumns.has(column)) continue;
      if (Object.prototype.hasOwnProperty.call(row, column)) {
        comparable[column] = row[column];
      }
    }
    return comparable;
  }

  private archivePayloadRowContentHash(tableName: string, row: Record<string, unknown>): string {
    return sha256Hex(stableJson(this.archivePayloadComparableRow(tableName, row)));
  }

  private archivePayloadTableHashCounts(tableName: string, rows: Array<Record<string, unknown>> | undefined): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      const hash = this.archivePayloadRowContentHash(tableName, row);
      counts.set(hash, (counts.get(hash) ?? 0) + 1);
    }
    return counts;
  }

  private validateArchivePayloadCoversCurrentRows(row: ArchiveStorageRow, payload: ArchivePayload): string | null {
    const observation = this.db
      .query<ArchiveCandidateRow, [string]>(`
        SELECT
          id, project, session_id, user_id, team_id, content, content_redacted, raw_text,
          observation_type, memory_type, tags_json, privacy_tags_json, archived_at,
          created_at, updated_at
        FROM mem_observations
        WHERE id = ?
      `)
      .get(row.observation_id);
    if (!observation) {
      return "current observation row is missing";
    }
    const currentRows = this.collectArchivePayloadRows(observation);
    const contentCheckedTables = [
      "mem_observations",
      "mem_vectors",
      "mem_links",
      "mem_relations",
      "mem_facts",
      "mem_events",
      "mem_tags",
      "mem_observation_entities",
      "mem_entities",
      "mem_nuggets",
      "mem_nugget_vectors",
    ];
    for (const tableName of contentCheckedTables) {
      const currentCounts = this.archivePayloadTableHashCounts(tableName, currentRows[tableName]);
      const payloadCounts = this.archivePayloadTableHashCounts(tableName, payload.rows?.[tableName]);
      for (const [hash, count] of currentCounts.entries()) {
        if ((payloadCounts.get(hash) ?? 0) < count) {
          return `archive payload lifecycle coverage mismatch for ${tableName}`;
        }
      }
    }
    return null;
  }

  private summarizeSqliteVecRepair(response: ApiResponse): Record<string, unknown> {
    const item = (response.items[0] ?? {}) as Record<string, unknown>;
    const meta = (response.meta ?? {}) as Record<string, unknown>;
    const failed = Number(meta.failed ?? item.failed ?? 0);
    const skipped = Number(meta.skipped ?? item.skipped ?? 0);
    const repaired = Number(meta.repaired ?? item.repaired ?? 0);
    return {
      attempted: true,
      ok: response.ok === true && failed === 0,
      response_ok: response.ok === true,
      failed,
      skipped,
      repaired,
      meta: response.meta,
      error: response.error ?? null,
    };
  }

  private repairSqliteVecAfterArchiveRestore(vectorCount: number): Record<string, unknown> {
    const response = this.repairSqliteVecMap({
      execute: true,
      limit: Math.max(1, vectorCount),
      status_counts: false,
    });
    return this.summarizeSqliteVecRepair(response);
  }

  private getRestoreCapableArchiveObservationIds(ids: string[]): string[] {
    const present = new Set<string>();
    for (const row of this.selectArchiveStorageRowsByObservationIds(ids)) {
      if (row.archive_state !== "archived") continue;
      const payloadValidation = this.validateArchivePayload(row);
      if (!payloadValidation.ok) continue;
      if (this.validateArchivePayloadCoversCurrentRows(row, payloadValidation.payload)) continue;
      present.add(row.observation_id);
    }
    return [...present].sort();
  }

  private countRestoreCapableArchiveFullObservations(ids: string[]): number {
    return this.getRestoreCapableArchiveObservationIds(ids).length;
  }

  private listMissingRestoreCapableArchiveIds(ids: string[]): string[] {
    if (ids.length === 0) {
      return [];
    }
    const present = new Set(this.getRestoreCapableArchiveObservationIds(ids));
    return ids.filter((id) => !present.has(id));
  }

  private getTableColumnNames(tableName: string): string[] {
    if (!this.tableExists(tableName)) return [];
    const quoted = this.quoteIdentifier(tableName);
    return this.db
      .query<{ name: string }, []>(`PRAGMA table_info(${quoted})`)
      .all()
      .map((row) => row.name)
      .filter((name) => typeof name === "string" && name.length > 0);
  }

  private selectArchiveRows(tableName: string, whereSql: string, values: unknown[] = []): Array<Record<string, unknown>> {
    if (!this.tableExists(tableName)) return [];
    const quoted = this.quoteIdentifier(tableName);
    return this.db
      .query(`SELECT * FROM ${quoted} ${whereSql}`)
      .all(...(values as SQLQueryBindings[])) as Array<Record<string, unknown>>;
  }

  private insertArchiveRow(tableName: string, row: Record<string, unknown>, conflictMode: "IGNORE" | "REPLACE"): void {
    const tableColumns = this.getTableColumnNames(tableName);
    const columns = tableColumns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
    if (columns.length === 0) return;
    const quotedTable = this.quoteIdentifier(tableName);
    const quotedColumns = columns.map((column) => this.quoteIdentifier(column)).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map((column) => row[column]);
    this.db
      .query(`INSERT OR ${conflictMode} INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders})`)
      .run(...(values as SQLQueryBindings[]));
  }

  private insertOrReplaceArchiveRows(tableName: string, rows: Array<Record<string, unknown>> | undefined): void {
    for (const row of rows ?? []) {
      this.insertArchiveRow(tableName, row, "REPLACE");
    }
  }

  private insertOrIgnoreArchiveRows(tableName: string, rows: Array<Record<string, unknown>> | undefined): void {
    for (const row of rows ?? []) {
      this.insertArchiveRow(tableName, row, "IGNORE");
    }
  }

  private buildArchiveManifest(candidateIds: string[]): ArchiveManifest {
    const ids = uniqueSortedStrings(candidateIds);
    const stableManifest = {
      schema_version: "s129-archive-v1" as const,
      operation: "admin.archive" as const,
      candidate_ids: ids,
      candidate_count: ids.length,
      cross_store_impact: this.collectObservationLifecycleImpact(ids),
    };
    return {
      ...stableManifest,
      manifest_sha256: sha256Hex(stableJson(stableManifest)),
    };
  }

  private selectArchiveCandidateRows(request: AdminArchiveRequest): { ok: true; rows: ArchiveCandidateRow[] } | { ok: false; error: string } {
    let candidateIds = uniqueSortedStrings(
      (request.candidate_ids && request.candidate_ids.length > 0)
        ? request.candidate_ids
        : request.target_ids,
    );
    if (candidateIds.length > 500) {
      return { ok: false, error: "candidate_ids length exceeds maximum of 500" };
    }
    if (candidateIds.length === 0) {
      const plan = runForgetPolicy(this.db, {
        dry_run: true,
        project: request.project,
        limit: request.limit,
        score_threshold: request.score_threshold,
        protect_accessed: request.protect_accessed,
      });
      candidateIds = uniqueSortedStrings(plan.candidates.map((candidate) => candidate.observation_id));
    }
    if (candidateIds.length === 0) {
      return { ok: true, rows: [] };
    }

    const placeholders = candidateIds.map(() => "?").join(", ");
    const rows = this.db
      .query<ArchiveCandidateRow, string[]>(`
        SELECT
          id, project, session_id, user_id, team_id, content, content_redacted, raw_text,
          observation_type, memory_type, tags_json, privacy_tags_json, archived_at,
          created_at, updated_at
        FROM mem_observations
        WHERE id IN (${placeholders})
        ORDER BY id ASC
      `)
      .all(...candidateIds);
    const found = new Set(rows.map((row) => row.id));
    const missing = candidateIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      return { ok: false, error: `archive candidate rows are missing: ${missing.join(", ")}` };
    }
    if (request.project) {
      const mismatched = rows.filter((row) => row.project !== request.project).map((row) => row.id);
      if (mismatched.length > 0) {
        return { ok: false, error: `archive candidate rows are outside project scope: ${mismatched.join(", ")}` };
      }
    }
    return { ok: true, rows };
  }

  private prepareArchiveManifest(request: AdminArchiveRequest): ArchivePrepareResult {
    const selected = this.selectArchiveCandidateRows(request);
    if (!selected.ok) return selected;
    return {
      ok: true,
      rows: selected.rows,
      manifest: this.buildArchiveManifest(selected.rows.map((row) => row.id)),
    };
  }

  private hasLegalHold(row: Pick<ArchiveCandidateRow, "privacy_tags_json" | "tags_json">): boolean {
    const privacyTags = parseJsonStringArray(row.privacy_tags_json);
    const tags = parseJsonStringArray(row.tags_json);
    return privacyTags.includes("legal_hold") || tags.includes("legal_hold");
  }

  private collectArchivePayloadRows(row: Pick<ArchiveCandidateRow, "id" | "session_id">): ArchivePayload["rows"] {
    const observationRows = this.selectArchiveRows("mem_observations", "WHERE id = ?", [row.id]);
    const observation = observationRows[0] ?? {};
    const eventId = typeof observation.event_id === "string" && observation.event_id ? observation.event_id : null;
    const nuggets = this.selectArchiveRows("mem_nuggets", "WHERE observation_id = ? ORDER BY seq ASC, nugget_id ASC", [row.id]);
    const observationEntities = this.selectArchiveRows("mem_observation_entities", "WHERE observation_id = ? ORDER BY entity_id ASC", [row.id]);
    const entityIds = observationEntities
      .map((entry) => Number(entry.entity_id))
      .filter((entityId) => Number.isFinite(entityId));
    return {
      mem_sessions: this.selectArchiveRows("mem_sessions", "WHERE session_id = ?", [row.session_id]),
      mem_events: eventId
        ? this.selectArchiveRows("mem_events", "WHERE observation_id = ? OR event_id = ? ORDER BY ts ASC, event_id ASC", [row.id, eventId])
        : this.selectArchiveRows("mem_events", "WHERE observation_id = ? ORDER BY ts ASC, event_id ASC", [row.id]),
      mem_observations: observationRows,
      mem_vectors: this.selectArchiveRows("mem_vectors", "WHERE observation_id = ? ORDER BY model ASC", [row.id]),
      mem_links: this.selectArchiveRows(
        "mem_links",
        "WHERE from_observation_id = ? OR to_observation_id = ? ORDER BY id ASC",
        [row.id, row.id],
      ),
      mem_relations: this.selectArchiveRows("mem_relations", "WHERE observation_id = ? ORDER BY id ASC", [row.id]),
      mem_facts: this.selectArchiveRows("mem_facts", "WHERE observation_id = ? ORDER BY fact_id ASC", [row.id]),
      mem_tags: this.selectArchiveRows("mem_tags", "WHERE observation_id = ? ORDER BY tag_type ASC, tag ASC", [row.id]),
      mem_entities: entityIds.length > 0
        ? this.selectArchiveRows("mem_entities", `WHERE id IN (${entityIds.map(() => "?").join(", ")}) ORDER BY id ASC`, entityIds)
        : [],
      mem_observation_entities: observationEntities,
      mem_nuggets: nuggets,
      mem_nugget_vectors: this.selectArchiveRows("mem_nugget_vectors", "WHERE observation_id = ? ORDER BY nugget_id ASC, model ASC", [row.id]),
    };
  }

  private buildArchivePayload(
    row: ArchiveCandidateRow,
    archiveId: string,
    reason: string,
    manifest: ArchiveManifest,
    createdAt: string,
  ): { payload: ArchivePayload; contentSha256: string; payloadJson: string; payloadSha256: string } {
    const rows = this.collectArchivePayloadRows(row);
    const contentSha256 = sha256Hex(String(row.content ?? ""));
    const payload: ArchivePayload = {
      schema_version: "s129-archive-payload-v1",
      archive_id: archiveId,
      observation_id: row.id,
      created_at: createdAt,
      actor: "system",
      reason,
      content_sha256: contentSha256,
      manifest_sha256: manifest.manifest_sha256,
      cross_store_impact: manifest.cross_store_impact,
      rows,
    };
    const payloadJson = stableJson(payload);
    const payloadSha256 = sha256Hex(payloadJson);
    return { payload, contentSha256, payloadJson, payloadSha256 };
  }

  private restoreArchivePayloadRows(payload: ArchivePayload): void {
    const rows = payload.rows ?? {};
    this.insertOrIgnoreArchiveRows("mem_sessions", rows.mem_sessions);
    this.insertOrReplaceArchiveRows("mem_events", rows.mem_events);
    this.insertOrReplaceArchiveRows("mem_observations", rows.mem_observations);
    this.insertOrReplaceArchiveRows("mem_vectors", rows.mem_vectors);
    this.insertOrReplaceArchiveRows("mem_tags", rows.mem_tags);
    this.insertOrIgnoreArchiveRows("mem_entities", rows.mem_entities);
    this.insertOrReplaceArchiveRows("mem_observation_entities", rows.mem_observation_entities);
    this.insertOrReplaceArchiveRows("mem_links", rows.mem_links);
    this.insertOrReplaceArchiveRows("mem_relations", rows.mem_relations);
    this.insertOrReplaceArchiveRows("mem_facts", rows.mem_facts);
    this.insertOrReplaceArchiveRows("mem_nuggets", rows.mem_nuggets);
    this.insertOrReplaceArchiveRows("mem_nugget_vectors", rows.mem_nugget_vectors);
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
    const normalizedRequest = {
      ...request,
      project: this.normalizeRecallProjectScope(request.project),
    };
    try {
      const plan = buildRecallProjectionPlan(this.db, {
        project: normalizedRequest.project,
        limit: request.limit,
        includePrivate: request.include_private === true,
      });
      const response = makeResponse(startedAt, plan.items as unknown[], normalizedRequest as unknown as Record<string, unknown>, {
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
      this.recordRecallProjectionBuildTelemetry(startedAt, normalizedRequest, response, "dry_run", plan);
      return response;
    } catch (error) {
      const response = makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        normalizedRequest as unknown as Record<string, unknown>,
      );
      this.recordRecallProjectionBuildTelemetry(startedAt, normalizedRequest, response, "dry_run");
      return response;
    }
  }

  refreshRecallProjection(request: { project: string; limit?: number; include_private?: boolean }): ApiResponse {
    const startedAt = performance.now();
    const normalizedRequest = {
      ...request,
      project: this.normalizeRecallProjectScope(request.project),
    };
    try {
      const plan = materializeRecallProjection(this.db, {
        project: normalizedRequest.project,
        limit: request.limit,
        includePrivate: request.include_private === true,
      });
      this.repeatRecallCache.clear();
      const response = makeResponse(startedAt, plan.items as unknown[], normalizedRequest as unknown as Record<string, unknown>, {
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
      this.recordRecallProjectionBuildTelemetry(startedAt, normalizedRequest, response, "write", plan);
      return response;
    } catch (error) {
      const response = makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        normalizedRequest as unknown as Record<string, unknown>,
      );
      this.recordRecallProjectionBuildTelemetry(startedAt, normalizedRequest, response, "write");
      return response;
    }
  }

  deleteRecallProjection(request: { project: string }): ApiResponse {
    const startedAt = performance.now();
    const normalizedRequest = {
      ...request,
      project: this.normalizeRecallProjectScope(request.project),
    };
    try {
      const result = clearRecallProjection(this.db, normalizedRequest.project);
      this.repeatRecallCache.clear();
      return makeResponse(startedAt, [result], normalizedRequest as unknown as Record<string, unknown>, {
        ranking: "recall_projection_clear_v1",
        cache_cleared: true,
      });
    } catch (error) {
      return makeErrorResponse(
        startedAt,
        error instanceof Error ? error.message : String(error),
        normalizedRequest as unknown as Record<string, unknown>,
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

  private isRecallProjectionAutoRefreshEnabled(): boolean {
    if (envFalsy(process.env.HARNESS_MEM_RECALL_PROJECTION_AUTO_REFRESH)) {
      return false;
    }
    if (process.env.HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD === "1") {
      return false;
    }
    if (process.env.NODE_ENV === "test" && !envTruthy(process.env.HARNESS_MEM_RECALL_PROJECTION_AUTO_REFRESH)) {
      return false;
    }
    return true;
  }

  private recallProjectionRefreshKey(project: string, includePrivate: boolean): string {
    return `${includePrivate ? "private" : "public"}\u0000${project}`;
  }

  private scheduleRecallProjectionAutoRefresh(
    request: RecallProjectionAutoRefreshRequest,
  ): Record<string, unknown> {
    const key = this.recallProjectionRefreshKey(request.project, request.include_private);
    const keyHash = this.sha256Short(key, 20);
    const baseMeta = {
      version: "recall_projection_auto_refresh_v1",
      reason: request.reason,
      key_hash: keyHash,
      mode: "child_process",
      debounce_ms: this.recallProjectionRefreshDebounceMs(),
      timeout_ms: this.recallProjectionRefreshChildTimeoutMs(),
      current_source_watermark_hash: request.current_source_watermark
        ? hashTelemetryValue(request.current_source_watermark)
        : null,
      projection_source_watermark_hash: request.projection_source_watermark
        ? hashTelemetryValue(request.projection_source_watermark)
        : null,
    };

    if (!this.isRecallProjectionAutoRefreshEnabled()) {
      return { ...baseMeta, status: "disabled" };
    }
    if (!request.current_source_watermark || request.current_source_watermark === "0:") {
      return { ...baseMeta, status: "skipped_empty_source" };
    }
    if (this.recallProjectionRefreshInFlight.has(key)) {
      return {
        ...baseMeta,
        status: "in_flight",
        queue_depth: this.recallProjectionRefreshChildPending,
      };
    }
    if (this.recallProjectionRefreshTimers.has(key)) {
      return {
        ...baseMeta,
        status: "already_scheduled",
        queue_depth: this.recallProjectionRefreshChildPending + this.recallProjectionRefreshTimers.size,
      };
    }

    const maxPending = this.getRecallProjectionRefreshChildMaxPending();
    const queuedOrRunning = this.recallProjectionRefreshChildPending + this.recallProjectionRefreshTimers.size;
    if (queuedOrRunning >= maxPending) {
      return {
        ...baseMeta,
        status: "queue_full",
        queue_depth: queuedOrRunning,
        max_pending: maxPending,
      };
    }

    const timer = setTimeout(() => {
      this.recallProjectionRefreshTimers.delete(key);
      if (this.shuttingDown) {
        return;
      }
      if (this.recallProjectionRefreshChildPending >= this.getRecallProjectionRefreshChildMaxPending()) {
        this.pushRuntimeWarning(`recall projection refresh queue full: key=${keyHash}`);
        return;
      }

      this.recallProjectionRefreshChildPending += 1;
      this.recallProjectionRefreshInFlight.add(key);
      void this.runRecallProjectionRefreshOutOfProcess(request, keyHash)
        .then((response) => {
          if (!response.ok) {
            this.pushRuntimeWarning(
              `recall projection refresh child returned error: key=${keyHash} error=${String(response.meta.error_code ?? "unknown")}`,
            );
          }
        })
        .catch((error) => {
          this.pushRuntimeWarning(
            `recall projection refresh child failed: key=${keyHash} error=${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          this.recallProjectionRefreshInFlight.delete(key);
          this.recallProjectionRefreshChildPending = Math.max(0, this.recallProjectionRefreshChildPending - 1);
        });
    }, this.recallProjectionRefreshDebounceMs());
    const maybeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
    maybeTimer.unref?.();
    this.recallProjectionRefreshTimers.set(key, timer);

    return {
      ...baseMeta,
      status: "scheduled",
      queue_depth: queuedOrRunning + 1,
      max_pending: maxPending,
    };
  }

  private async runRecallProjectionRefreshOutOfProcess(
    request: RecallProjectionAutoRefreshRequest,
    keyHash: string,
  ): Promise<ApiResponse> {
    const startedAt = performance.now();
    const timeoutMs = this.recallProjectionRefreshChildTimeoutMs();
    const scriptPath = this.getRecallProjectionRefreshChildScriptPath();
    const childCommand = buildRecallProjectionRefreshChildCommand(scriptPath);
    const queueDepthAtStart = this.recallProjectionRefreshChildPending;
    let timedOut = false;
    const proc = spawnChildProcess(childCommand[0], childCommand.slice(1), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        HARNESS_MEM_DB_PATH: this.config.dbPath,
        HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD: "1",
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
      writeJsonToNodeChildStdin(proc.stdin, {
        project: request.project,
        limit: request.limit,
        include_private: request.include_private,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        readNodeChildStream(proc.stdout),
        readNodeChildStream(proc.stderr),
        exited,
      ]);
      if (exitCode !== 0) {
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited ${exitCode}`;
        throw new Error(`recall projection refresh child ${reason}: ${stderr.trim() || stdout.trim()}`);
      }
      const response = parseChildApiResponse(stdout, stderr, "recall projection refresh child");
      const offloadWallMs = Number((performance.now() - startedAt).toFixed(2));
      this.repeatRecallCache.clear();
      response.meta = {
        ...response.meta,
        latency_ms: offloadWallMs,
        recall_projection_refresh_offload: {
          mode: "child_process",
          key_hash: keyHash,
          reason: request.reason,
          timeout_ms: timeoutMs,
          wall_ms: offloadWallMs,
          child_latency_ms: typeof response.meta.latency_ms === "number" ? response.meta.latency_ms : null,
          cache_cleared: true,
        },
      };
      recordRecallTelemetry(
        "recall.projection.build",
        {
          ...this.recallScopeAttributes({
            project: request.project,
            include_private: request.include_private,
            limit: request.limit,
            safe_mode: true,
          }),
          "harness.operation": "auto_refresh",
          "harness.result": response.ok ? "ok" : "error",
          "harness.error_code": typeof response.meta.error_code === "string" ? response.meta.error_code : undefined,
          "recall.items_count": Array.isArray(response.items) ? response.items.length : 0,
          "recall.projection.generation": typeof response.meta.projection_generation === "string"
            ? response.meta.projection_generation
            : request.projection_generation ?? undefined,
          "recall.projection.status": response.ok ? "completed" : "failed",
          "recall.projection.source_watermark_hash": typeof response.meta.source_watermark === "string"
            ? hashTelemetryValue(response.meta.source_watermark)
            : undefined,
          "recall.projection.current_watermark_hash": request.current_source_watermark
            ? hashTelemetryValue(request.current_source_watermark)
            : undefined,
          "recall.projection.candidate_count": typeof response.meta.candidate_count === "number"
            ? response.meta.candidate_count
            : undefined,
          "recall.projection.planned_count": typeof response.meta.planned_count === "number"
            ? response.meta.planned_count
            : undefined,
          "recall.projection.skipped_count": typeof response.meta.skipped_count === "number"
            ? response.meta.skipped_count
            : undefined,
          "recall.projection.writes": typeof response.meta.writes === "number" ? response.meta.writes : 0,
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
    } catch (error) {
      const offloadWallMs = Number((performance.now() - startedAt).toFixed(2));
      recordRecallTelemetry(
        "recall.projection.build",
        {
          ...this.recallScopeAttributes({
            project: request.project,
            include_private: request.include_private,
            limit: request.limit,
            safe_mode: true,
          }),
          "harness.operation": "auto_refresh",
          "harness.result": "error",
          "harness.error_code": timedOut ? "recall_projection_refresh_timeout" : "recall_projection_refresh_failed",
          "recall.projection.status": "failed",
          "recall.projection.current_watermark_hash": request.current_source_watermark
            ? hashTelemetryValue(request.current_source_watermark)
            : undefined,
          "recall.worker.mode": "child_process",
          "recall.worker.queue_depth": queueDepthAtStart,
          "recall.worker.timeout_ms": timeoutMs,
        },
        {
          recall_latency_ms: offloadWallMs,
          worker_queue_depth: queueDepthAtStart,
        },
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }
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

  private normalizeRecallProjectScope(project: string): string {
    try {
      return this.normalizeProjectInput(project);
    } catch {
      return normalizePathLike(project.trim());
    }
  }

  async recallPrepared(request: RecallRuntimeRequest): Promise<ApiResponse> {
    const startedAt = performance.now();
    const query = request.query.trim();
    const rawProject = request.project?.trim() || undefined;
    const project = rawProject ? this.normalizeRecallProjectScope(rawProject) : undefined;
    const normalizedRequest: RecallRuntimeRequest = project === request.project
      ? request
      : { ...request, project };
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
      this.recordRecallProjectTelemetry(startedAt, normalizedRequest, response);
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
      this.recordRecallProjectTelemetry(startedAt, normalizedRequest, response);
      return response;
    }

    if (request.forensic === true) {
      return this.fallbackRecallSearch(normalizedRequest, "forensic_observation_search", startedAt, null, null);
    }

    if (!project) {
      return this.fallbackRecallSearch(normalizedRequest, "projection_project_scope_required", startedAt, null, null);
    }

    if (request.user_id || request.team_id) {
      return this.fallbackRecallSearch(normalizedRequest, "projection_access_filter_unsupported", startedAt, null, null);
    }

    const latestRun = this.getLatestRecallProjectionRun(project);
    const sourceWatermark = readRecallDataWatermark(this.db, { project });
    if (!latestRun) {
      const autoRefresh = this.scheduleRecallProjectionAutoRefresh({
        project,
        include_private: request.include_private === true,
        limit: this.recallProjectionRefreshLimit(),
        reason: "projection_missing",
        projection_generation: null,
        projection_source_watermark: null,
        current_source_watermark: sourceWatermark,
      });
      return this.fallbackRecallSearch(normalizedRequest, "projection_missing", startedAt, null, sourceWatermark, autoRefresh);
    }
    if (latestRun.source_watermark !== sourceWatermark) {
      const autoRefresh = this.scheduleRecallProjectionAutoRefresh({
        project,
        include_private: request.include_private === true,
        limit: this.recallProjectionRefreshLimit(),
        reason: "projection_stale",
        projection_generation: latestRun.generation,
        projection_source_watermark: latestRun.source_watermark,
        current_source_watermark: sourceWatermark,
      });
      return this.fallbackRecallSearch(normalizedRequest, "projection_stale", startedAt, latestRun, sourceWatermark, autoRefresh);
    }

    const items = this.searchRecallProjection({
      query,
      project,
      session_id: sessionId,
      limit,
      include_private: request.include_private === true,
    });

    if (items.length === 0) {
      return this.fallbackRecallSearch(normalizedRequest, "projection_no_match", startedAt, latestRun, sourceWatermark);
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
    this.recordRecallProjectTelemetry(startedAt, normalizedRequest, response, latestRun, sourceWatermark);
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
    autoRefresh?: Record<string, unknown>,
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
    if (autoRefresh) {
      fallback.meta.recall_projection_auto_refresh = autoRefresh;
    }
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
    const rewriteResult = await rewriteSearchQueryIfEnabled(request.query || "", {
      safeMode: request.safe_mode === true,
    });
    const effectiveRequest = rewriteResult.query === request.query
      ? request
      : { ...request, query: rewriteResult.query };
    const cacheLookup = this.lookupRepeatRecallCache(effectiveRequest, startedAt);
    if (cacheLookup?.response) {
      cacheLookup.response.meta.query_rewrite = queryRewriteMeta(rewriteResult);
      this.recordRecallSearchTelemetry(startedAt, effectiveRequest, cacheLookup.response);
      return cacheLookup.response;
    }
    const cacheCandidate = cacheLookup?.candidate ?? null;
    const shouldOffloadSearch = shouldRunSearchOutOfProcess(effectiveRequest, {
      vectorEngine: this.vectorEngine,
      dbPath: this.config.dbPath,
    });
    const offloadMode: SearchOffloadMode = shouldUsePersistentSearchWorker({
      vectorEngine: this.vectorEngine,
      dbPath: this.config.dbPath,
    })
      ? "persistent_worker"
      : "child_process";
    if (effectiveRequest.safe_mode !== true && effectiveRequest.vector_search !== false && !shouldOffloadSearch) {
      await this.prepareSearchEmbedding(effectiveRequest.query || "");
    }
    let response: ApiResponse;
    if (shouldOffloadSearch) {
      try {
        response = await this.runSearchOutOfProcess(effectiveRequest);
      } catch (error) {
        if (isSearchOffloadQueueFull(error)) {
          const rejected = this.makeSearchOffloadRejectedResponse(startedAt, effectiveRequest, error, offloadMode);
          rejected.meta.query_rewrite = queryRewriteMeta(rewriteResult);
          this.recordRecallSearchTelemetry(startedAt, effectiveRequest, rejected);
          return rejected;
        }
        if (isSearchOffloadUnavailable(error)) {
          if (error.reason === "timeout") {
            response = await this.searchWithSafeFallback(effectiveRequest, `${error.queueName} unavailable: ${error.reason}`, offloadMode);
          } else {
            const rejected = this.makeSearchOffloadRejectedResponse(startedAt, effectiveRequest, error, offloadMode);
            rejected.meta.query_rewrite = queryRewriteMeta(rewriteResult);
            this.recordRecallSearchTelemetry(startedAt, effectiveRequest, rejected);
            return rejected;
          }
        } else if (
          offloadMode === "persistent_worker" &&
          error instanceof Error &&
          error.message.includes("search worker request timed out")
        ) {
          response = await this.searchWithSafeFallback(
            effectiveRequest,
            error.message,
            offloadMode,
          );
        } else {
          response = await this.searchWithSafeFallback(
            effectiveRequest,
            error instanceof Error ? error.message : String(error),
            offloadMode,
          );
        }
      }
    } else {
      response = this.search(effectiveRequest);
    }
    response.meta.query_rewrite = queryRewriteMeta(rewriteResult);

    // S58-008 legacy / S154-702 local opt-in LLM rerank.
    const searchLlmConfig = buildSearchLlmRerankerConfigFromEnv();
    if (
      effectiveRequest.safe_mode !== true &&
      searchLlmConfig.enabled &&
      response.ok &&
      Array.isArray(response.items) &&
      response.items.length > 0
    ) {
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

        const reranked = await llmRerank(effectiveRequest.query || "", candidates, searchLlmConfig);
        const scoreById = new Map(reranked.map((r) => [r.id, r.score]));

        (response.items as Array<Record<string, unknown>>).sort((a, b) => {
          const aScore = scoreById.get(a.id as string) ?? 0;
          const bScore = scoreById.get(b.id as string) ?? 0;
          return bScore - aScore;
        });

        // metadata に llm_rerank フラグを追記
        (response.meta as Record<string, unknown>).llm_rerank = true;
        (response.meta as Record<string, unknown>).llm_rerank_provider = searchLlmConfig.provider;
        (response.meta as Record<string, unknown>).llm_rerank_top_k = searchLlmConfig.topK ?? 20;
      } catch {
        // graceful degradation: LLM リランク失敗時は元の順序を維持
        (response.meta as Record<string, unknown>).llm_rerank = false;
      }
    } else {
      (response.meta as Record<string, unknown>).llm_rerank = false;
    }

    // S58-009: LLM 不在判定（HARNESS_MEM_LLM_ENHANCE=true かつ no_memory=true のときのみ）
    const legacyLlmConfig = buildLlmRerankerConfigFromEnv();
    if (
      legacyLlmConfig.enabled &&
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
          legacyLlmConfig.apiKey ??
          (legacyLlmConfig.provider === "anthropic"
            ? process.env.ANTHROPIC_API_KEY
            : process.env.OPENAI_API_KEY) ??
          "";
        const checkResult = await llmNoMemoryCheck(effectiveRequest.query || "", topCandidate, {
          provider: legacyLlmConfig.provider,
          model: legacyLlmConfig.model,
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
    this.recordRecallSearchTelemetry(startedAt, effectiveRequest, finalResponse);
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
    const candidateIds = uniqueSortedStrings(plan.candidates.map((candidate) => candidate.observation_id));
    const archiveManifest = this.buildArchiveManifest(candidateIds);
    const impact = archiveManifest.cross_store_impact;

    return makeResponse(
      startedAt,
      [{
        ...plan,
        mode: "dry_run_plan",
        archive_first: true,
        candidate_ids: candidateIds,
        candidate_count: candidateIds.length,
        manifest_sha256: archiveManifest.manifest_sha256,
        manifest_hash: archiveManifest.manifest_sha256,
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

  adminForgetArchive(request: AdminArchiveRequest): ApiResponse {
    const startedAt = performance.now();
    const initial = this.prepareArchiveManifest(request);
    if (!initial.ok) {
      return makeErrorResponse(startedAt, initial.error, request as unknown as Record<string, unknown>);
    }

    if (request.execute !== true) {
      return makeResponse(
        startedAt,
        [{
          mode: "archive_plan",
          execute: false,
          archive_first: true,
          ...initial.manifest,
          candidates: initial.rows.map((row) => ({
            observation_id: row.id,
            project: row.project,
            archived_at: row.archived_at,
            legal_hold: this.hasLegalHold(row),
          })),
        } as unknown as Record<string, unknown>],
        { ...request, execute: false },
        {
          candidate_count: initial.manifest.candidate_count,
          manifest_sha256: initial.manifest.manifest_sha256,
          ranking: "archive_plan_v1",
        },
      );
    }

    const manifestSha256 = normalizeSha256(request.manifest_sha256);
    if (!manifestSha256) {
      return makeErrorResponse(startedAt, "manifest_sha256 is required for archive execute", request as unknown as Record<string, unknown>);
    }
    if (manifestSha256 !== initial.manifest.manifest_sha256) {
      return makeErrorResponse(startedAt, "manifest_sha256 does not match current archive manifest", request as unknown as Record<string, unknown>);
    }
    const reason = typeof request.reason === "string" && request.reason.trim() ? request.reason.trim() : "";
    if (!reason) {
      return makeErrorResponse(startedAt, "reason is required for archive execute", request as unknown as Record<string, unknown>);
    }
    if (initial.manifest.candidate_count === 0) {
      return makeErrorResponse(startedAt, "archive execute requires at least one candidate", request as unknown as Record<string, unknown>);
    }

    let transactionStarted = false;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const current = this.prepareArchiveManifest(request);
      if (!current.ok) {
        throw new Error(current.error);
      }
      if (manifestSha256 !== current.manifest.manifest_sha256) {
        throw new Error("manifest_sha256 does not match current archive manifest");
      }

      const archivedIds: string[] = [];
      const archiveIds: string[] = [];
      const skippedLegalHold: string[] = [];
      const skippedAlreadyArchived: string[] = [];
      const createdAt = nowIso();
      for (const row of current.rows) {
        if (this.hasLegalHold(row)) {
          skippedLegalHold.push(row.id);
          continue;
        }
        if (row.archived_at) {
          skippedAlreadyArchived.push(row.id);
          continue;
        }
        const existingArchive = this.db
          .query<{ archive_id: string }, [string]>(
            `SELECT archive_id FROM mem_archive_stubs WHERE observation_id = ? AND archive_state = 'archived' LIMIT 1`,
          )
          .get(row.id);
        if (existingArchive?.archive_id) {
          skippedAlreadyArchived.push(row.id);
          continue;
        }

        const archiveId = `archive_${sha256Hex(`${row.id}:${current.manifest.manifest_sha256}`).slice(0, 32)}`;
        const archiveFullRef = `sqlite:${archiveId}`;
        const { contentSha256, payloadJson, payloadSha256 } = this.buildArchivePayload(
          row,
          archiveId,
          reason,
          current.manifest,
          createdAt,
        );
        const archiveStub = stableJson({
          schema_version: "s129-archive-stub-v1",
          archive_id: archiveId,
          observation_id: row.id,
          project: row.project,
          session_id: row.session_id,
          user_id: row.user_id,
          team_id: row.team_id,
          observation_type: row.observation_type,
          memory_type: row.memory_type,
          content_sha256: contentSha256,
          manifest_sha256: current.manifest.manifest_sha256,
          created_at: createdAt,
        });
        const metadataJson = stableJson({
          schema_version: "s129-archive-stub-metadata-v1",
          impact: current.manifest.cross_store_impact,
          payload_sha256: payloadSha256,
        });

        this.db
          .query(`
            INSERT INTO mem_archive_stubs(
              archive_id, observation_id, project, session_id, user_id, team_id,
              archive_stub, archive_full_ref, archive_state, reason, legal_hold_snapshot,
              content_sha256, manifest_sha256, created_at, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'archived', ?, 0, ?, ?, ?, ?)
          `)
          .run(
            archiveId,
            row.id,
            row.project,
            row.session_id,
            row.user_id,
            row.team_id,
            archiveStub,
            archiveFullRef,
            reason,
            contentSha256,
            current.manifest.manifest_sha256,
            createdAt,
            metadataJson,
          );
        this.db
          .query(`
            INSERT INTO mem_archive_full(archive_full_ref, archive_id, payload_json, payload_sha256, created_at)
            VALUES (?, ?, ?, ?, ?)
          `)
          .run(archiveFullRef, archiveId, payloadJson, payloadSha256, createdAt);
        this.db
          .query(`UPDATE mem_observations SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`)
          .run(createdAt, createdAt, row.id);
        archivedIds.push(row.id);
        archiveIds.push(archiveId);
      }

      this.writeAuditLog("admin.archive.create", "archive", "", {
        manifest_sha256: current.manifest.manifest_sha256,
        candidate_count: current.manifest.candidate_count,
        archived_count: archivedIds.length,
        skipped_legal_hold: skippedLegalHold,
        skipped_already_archived: skippedAlreadyArchived,
        candidate_ids: current.manifest.candidate_ids,
        archived_ids: archivedIds,
        archive_ids: archiveIds,
        reason,
      });
      this.db.exec("COMMIT");
      transactionStarted = false;

      return makeResponse(
        startedAt,
        [{
          mode: "archive_execute",
          execute: true,
          manifest_sha256: current.manifest.manifest_sha256,
          candidate_ids: current.manifest.candidate_ids,
          candidate_count: current.manifest.candidate_count,
          archived_ids: archivedIds,
          archived_count: archivedIds.length,
          archive_ids: archiveIds,
          skipped_legal_hold: skippedLegalHold,
          skipped_already_archived: skippedAlreadyArchived,
          restore_supported: archiveIds.length > 0,
        } as unknown as Record<string, unknown>],
        { ...request, execute: true },
        {
          candidate_count: current.manifest.candidate_count,
          archived_count: archivedIds.length,
          manifest_sha256: current.manifest.manifest_sha256,
          ranking: "archive_execute_v1",
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
      return makeErrorResponse(startedAt, `archive execute failed: ${message}`, request as unknown as Record<string, unknown>);
    }
  }

  private collectForgetMaintenanceMeasurements(): ForgetMaintenanceMeasurements {
    const dbPath = resolve(resolveHomePath(this.config.dbPath));
    const dbSizeBytes = this.config.dbPath === ":memory:" || !existsSync(dbPath)
      ? null
      : statSync(dbPath).size;
    const walPath = `${dbPath}-wal`;
    const walSizeBytes = this.config.dbPath === ":memory:" || !existsSync(walPath)
      ? null
      : statSync(walPath).size;
    const active = this.db
      .query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL`)
      .get();
    const archived = this.db
      .query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL`)
      .get();
    const archivedVectorRows = this.db
      .query<{ count: number }, []>(
        `SELECT COUNT(*) AS count
         FROM mem_vectors v
         JOIN mem_observations o ON o.id = v.observation_id
         WHERE o.archived_at IS NOT NULL`,
      )
      .get();
    const currentVectorModel = this.config.forgetMaintenanceCurrentVectorModel || this.vectorModelVersion;
    const currentVectorModelIsAdaptiveFamily =
      !this.config.forgetMaintenanceCurrentVectorModel && currentVectorModel.startsWith("adaptive:");
    const staleVectorRows = currentVectorModelIsAdaptiveFamily
      ? this.db
          .query<{ count: number }, [number]>(
            `SELECT COUNT(*) AS count
             FROM mem_vectors
             WHERE model < 'adaptive:' OR model >= 'adaptive;' OR dimension <> ?`,
          )
          .get(this.config.vectorDimension)
      : this.db
          .query<{ count: number }, [string, number]>(
            `SELECT COUNT(*) AS count
             FROM mem_vectors
             WHERE model <> ? OR dimension <> ?`,
          )
          .get(currentVectorModel, this.config.vectorDimension);
    return {
      db_size_bytes: dbSizeBytes,
      wal_size_bytes: walSizeBytes,
      active_observations: Number(active?.count ?? 0),
      archived_observations: Number(archived?.count ?? 0),
      archived_vector_rows: Number(archivedVectorRows?.count ?? 0),
      stale_vector_rows: Number(staleVectorRows?.count ?? 0),
      current_vector_model: currentVectorModel,
    };
  }

  private forgetMaintenanceThresholds(request: AdminForgetMaintenanceRequest = {}): ForgetMaintenanceThresholds {
    const overrides = request.thresholds ?? {};
    return {
      db_size_bytes: overrides.db_size_bytes ?? this.config.forgetMaintenanceDbBytesThreshold,
      wal_size_bytes: overrides.wal_size_bytes ?? this.config.forgetMaintenanceWalBytesThreshold,
      active_observations: overrides.active_observations ?? this.config.forgetMaintenanceActiveObservationsThreshold,
      archived_observations: overrides.archived_observations ?? this.config.forgetMaintenanceArchivedObservationsThreshold,
      stale_vector_rows: overrides.stale_vector_rows ?? this.config.forgetMaintenanceStaleVectorRowsThreshold,
    };
  }

  private forgetMaintenanceTriggers(
    request: AdminForgetMaintenanceRequest,
    measurements: ForgetMaintenanceMeasurements,
    thresholds: ForgetMaintenanceThresholds,
  ): string[] {
    const triggers: string[] = [];
    const reason = (request.reason || "manual").trim() || "manual";
    if (request.force === true) {
      triggers.push("manual");
    }
    if (reason === "scheduler" && this.config.forgetMaintenanceScheduleEnabled === true) {
      triggers.push("schedule");
    }
    const dbThreshold = thresholds.db_size_bytes;
    if (typeof dbThreshold === "number" && measurements.db_size_bytes !== null && measurements.db_size_bytes > dbThreshold) {
      triggers.push("threshold:db_size_bytes");
    }
    const walThreshold = thresholds.wal_size_bytes;
    if (typeof walThreshold === "number" && measurements.wal_size_bytes !== null && measurements.wal_size_bytes > walThreshold) {
      triggers.push("threshold:wal_size_bytes");
    }
    const activeThreshold = thresholds.active_observations;
    if (typeof activeThreshold === "number" && measurements.active_observations > activeThreshold) {
      triggers.push("threshold:active_observations");
    }
    const archivedThreshold = thresholds.archived_observations;
    if (typeof archivedThreshold === "number" && measurements.archived_observations > archivedThreshold) {
      triggers.push("threshold:archived_observations");
    }
    const staleVectorRowsThreshold = thresholds.stale_vector_rows;
    if (typeof staleVectorRowsThreshold === "number" && measurements.stale_vector_rows > staleVectorRowsThreshold) {
      triggers.push("threshold:stale_vector_rows");
    }
    return triggers;
  }

  private sumTextBytesById(table: string, idColumn: string, columns: string[], ids: string[]): number {
    if (ids.length === 0 || !this.tableExists(table)) return 0;
    const quotedTable = this.quoteIdentifier(table);
    const tableColumns = new Set((this.db.query(`PRAGMA table_info(${quotedTable})`).all() as Array<{ name: string }>)
      .map((row) => row.name));
    if (!tableColumns.has(idColumn)) return 0;
    const usableColumns = columns.filter((column) => tableColumns.has(column));
    if (usableColumns.length === 0) return 0;
    const expression = usableColumns
      .map((column) => `COALESCE(LENGTH(${this.quoteIdentifier(column)}), 0)`)
      .join(" + ");
    const quotedIdColumn = this.quoteIdentifier(idColumn);
    let total = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const placeholders = chunk.map(() => "?").join(", ");
      const row = this.db
        .query(`SELECT COALESCE(SUM(${expression}), 0) AS bytes FROM ${quotedTable} WHERE ${quotedIdColumn} IN (${placeholders})`)
        .get(...(chunk as never[])) as { bytes: number } | null;
      total += Number(row?.bytes ?? 0);
    }
    return total;
  }

  private sumArchiveFullBytesByObservationId(ids: string[]): number {
    if (ids.length === 0 || !this.tableExists("mem_archive_full") || !this.tableExists("mem_archive_stubs")) return 0;
    let total = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const placeholders = chunk.map(() => "?").join(", ");
      const row = this.db
        .query(`
          SELECT COALESCE(SUM(COALESCE(LENGTH(f.payload_json), 0) + COALESCE(LENGTH(f.payload_sha256), 0)), 0) AS bytes
          FROM mem_archive_full f
          JOIN mem_archive_stubs s ON s.archive_id = f.archive_id
          WHERE s.observation_id IN (${placeholders})
        `)
        .get(...(chunk as never[])) as { bytes: number } | null;
      total += Number(row?.bytes ?? 0);
    }
    return total;
  }

  private estimateForgetReclaimBytes(candidateIds: string[]): number {
    const ids = uniqueSortedStrings(candidateIds);
    if (ids.length === 0) return 0;
    return [
      this.sumTextBytesById("mem_observations", "id", [
        "title",
        "content",
        "content_redacted",
        "raw_text",
        "tags_json",
        "privacy_tags_json",
        "content_dedupe_hash",
      ], ids),
      this.sumTextBytesById("mem_vectors", "observation_id", ["vector_json"], ids),
      this.sumTextBytesById("mem_events", "observation_id", ["payload_json", "tags_json", "privacy_tags_json", "dedupe_hash"], ids),
      this.sumTextBytesById("mem_facts", "observation_id", ["subject", "predicate", "object", "source", "metadata_json"], ids),
      this.sumTextBytesById("mem_relations", "observation_id", ["relation_type", "target", "metadata_json"], ids),
      this.sumTextBytesById("mem_tags", "observation_id", ["tag", "tag_type"], ids),
      this.sumTextBytesById("mem_nuggets", "observation_id", ["content", "content_hash"], ids),
      this.sumTextBytesById("mem_nugget_vectors", "observation_id", ["vector_json"], ids),
      this.sumTextBytesById("mem_archive_stubs", "observation_id", [
        "archive_stub",
        "archive_full_ref",
        "reason",
        "content_sha256",
        "manifest_sha256",
        "metadata_json",
      ], ids),
      this.sumArchiveFullBytesByObservationId(ids),
    ].reduce((sum, value) => sum + value, 0);
  }

  private collectForgetExclusionReport(request: {
    candidate_ids: string[];
    project?: string;
    protect_accessed?: boolean;
  }): { excluded_by_reason: Record<string, number>; legal_hold_count: number; durable_type_count: number } {
    const candidateSet = new Set(request.candidate_ids);
    const excluded: Record<string, number> = {
      legal_hold: 0,
      privacy_protected: 0,
      durable_type: 0,
      access_protected: 0,
      fresh_under_min_age: 0,
      already_archived: 0,
    };
    const params: unknown[] = [];
    let activeSql = `
      SELECT id, created_at, expires_at, access_count, observation_type, memory_type, tags_json, privacy_tags_json
      FROM mem_observations
      WHERE archived_at IS NULL
    `;
    let archivedSql = `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL`;
    if (request.project) {
      activeSql += ` AND project = ?`;
      archivedSql += ` AND project = ?`;
      params.push(request.project);
    }

    const protectAccessed = request.protect_accessed !== false;
    const nowMs = Date.now();
    const activeRows = this.db.query(activeSql).all(...(params as never[])) as Array<{
      id: string;
      created_at: string | null;
      expires_at: string | null;
      access_count: number | null;
      observation_type: string | null;
      memory_type: string | null;
      tags_json: string | null;
      privacy_tags_json: string | null;
    }>;
    const archivedRow = this.db.query(archivedSql).get(...(params as never[])) as { count: number } | null;
    excluded.already_archived = Number(archivedRow?.count ?? 0);

    let legalHoldCount = 0;
    let durableTypeCount = 0;
    for (const row of activeRows) {
      const privacyTags = parseJsonStringArray(row.privacy_tags_json).map((tag) => tag.toLowerCase());
      const tags = parseJsonStringArray(row.tags_json).map((tag) => tag.toLowerCase());
      const hasLegalHold = privacyTags.includes("legal_hold") || tags.includes("legal_hold");
      const hasPrivacyProtected = privacyTags.some((tag) => AUTONOMOUS_FORGET_PRIVACY_TAGS.has(tag));
      const observationType = (row.observation_type ?? "").toLowerCase();
      const memoryType = (row.memory_type ?? "").toLowerCase();
      const hasDurableType =
        AUTONOMOUS_FORGET_DURABLE_TYPES.has(observationType) ||
        AUTONOMOUS_FORGET_DURABLE_TYPES.has(memoryType);
      const expiresAtMs = row.expires_at ? Date.parse(row.expires_at) : Number.POSITIVE_INFINITY;
      const isExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
      const createdAtMs = row.created_at ? Date.parse(row.created_at) : Number.NaN;
      const ageDays = Number.isFinite(createdAtMs)
        ? Math.max(0, (nowMs - createdAtMs) / (24 * 60 * 60 * 1000))
        : 0;
      if (hasLegalHold) legalHoldCount += 1;
      if (hasDurableType) durableTypeCount += 1;
      if (candidateSet.has(row.id)) continue;
      if (hasLegalHold) excluded.legal_hold += 1;
      if (hasPrivacyProtected) excluded.privacy_protected += 1;
      if (hasDurableType && !isExpired) excluded.durable_type += 1;
      if (protectAccessed && Number(row.access_count ?? 0) > 0 && !isExpired) excluded.access_protected += 1;
      if (ageDays < 30 && !isExpired) excluded.fresh_under_min_age += 1;
    }

    return {
      excluded_by_reason: excluded,
      legal_hold_count: legalHoldCount,
      durable_type_count: durableTypeCount,
    };
  }

  adminForgetAutonomyReport(request: ForgetAutonomyReportRequest = {}): ForgetAutonomyReport {
    const candidateIds = uniqueSortedStrings(request.candidate_ids ?? []);
    const exclusionReport = this.collectForgetExclusionReport({
      candidate_ids: candidateIds,
      project: request.project,
      protect_accessed: request.protect_accessed,
    });
    const estimatedFromCandidates = this.estimateForgetReclaimBytes(candidateIds);
    const vectorPrunePlan = request.vector_prune_plan ?? null;
    const vectorPruneBytes = typeof vectorPrunePlan?.removable_vector_json_bytes === "number"
      ? Number(vectorPrunePlan.removable_vector_json_bytes)
      : typeof vectorPrunePlan?.deleted_vector_json_bytes_estimate === "number"
        ? Number(vectorPrunePlan.deleted_vector_json_bytes_estimate)
        : 0;
    return {
      autonomy_level: request.autonomy_level ?? "L0_report",
      estimated_reclaim_bytes: Math.max(0, Math.floor(request.estimated_reclaim_bytes ?? (estimatedFromCandidates + vectorPruneBytes))),
      excluded_by_reason: exclusionReport.excluded_by_reason,
      legal_hold_count: exclusionReport.legal_hold_count,
      durable_type_count: exclusionReport.durable_type_count,
      candidate_count: candidateIds.length,
      restore_required_before_purge: true,
      default_hard_purge: false,
      default_compact: false,
      excluded_counts_may_overlap: true,
    };
  }

  adminForgetMaintenance(request: AdminForgetMaintenanceRequest = {}): ApiResponse {
    const startedAt = performance.now();
    const measurements = this.collectForgetMaintenanceMeasurements();
    const thresholds = this.forgetMaintenanceThresholds(request);
    const triggers = uniqueSortedStrings(this.forgetMaintenanceTriggers(request, measurements, thresholds));
    const mode = request.mode === "archive" || this.config.forgetMaintenanceMode === "archive" ? "archive" : "dry-run";
    const baseMeta: Record<string, unknown> = {
      ranking: "forget_maintenance_v1",
      mode,
      triggers,
      measurements,
      thresholds,
    };

    if (triggers.length === 0) {
      const autonomyReport = this.adminForgetAutonomyReport({
        autonomy_level: "L0_report",
        protect_accessed: request.protect_accessed ?? this.config.forgetMaintenanceProtectAccessed,
      });
      return makeResponse(
        startedAt,
        [{
          mode: "forget_maintenance_skipped",
          execute: false,
          reason: request.reason || "manual",
          triggers,
          measurements,
          thresholds,
          ...autonomyReport,
          autonomy_report: autonomyReport,
        } as unknown as Record<string, unknown>],
        request as unknown as Record<string, unknown>,
        { ...baseMeta, ...autonomyReport, skipped: "thresholds_not_exceeded" },
      );
    }

    const archiveRequest: AdminArchiveRequest = {
      limit: request.limit ?? this.config.forgetMaintenanceLimit,
      score_threshold: request.score_threshold ?? this.config.forgetMaintenanceScoreThreshold,
      protect_accessed: request.protect_accessed ?? this.config.forgetMaintenanceProtectAccessed,
    };
    const plan = this.adminForgetArchive(archiveRequest);
    if (!plan.ok) {
      return makeErrorResponse(startedAt, plan.error || "forget maintenance archive plan failed", request as unknown as Record<string, unknown>);
    }
    const planItem = (plan.items[0] || {}) as Record<string, unknown>;
    const candidateCount = Number(planItem.candidate_count ?? 0);
    const candidateIds = stringArray(planItem.candidate_ids);
    const shouldPlanVectorPrune =
      !!request.vector_prune ||
      triggers.includes("threshold:archived_observations") ||
      triggers.includes("threshold:stale_vector_rows");
    const vectorPrunePlan = shouldPlanVectorPrune
      ? (this.adminForgetVectorPrune(request.vector_prune ?? {}).items[0] as Record<string, unknown> | undefined)
      : undefined;
    const autonomyReport = this.adminForgetAutonomyReport({
      autonomy_level: mode === "archive" && candidateCount > 0 ? "L1_reversible_archive" : "L0_report",
      candidate_ids: candidateIds,
      protect_accessed: archiveRequest.protect_accessed,
      vector_prune_plan: vectorPrunePlan ?? null,
    });
    this.writeAuditLog("admin.forget_maintenance.plan", "observation", "", {
      mode,
      reason: request.reason || "manual",
      triggers,
      measurements,
      thresholds,
      candidate_count: candidateCount,
      manifest_sha256: planItem.manifest_sha256,
      vector_prune_candidate_count: vectorPrunePlan?.candidate_count,
      autonomy_level: autonomyReport.autonomy_level,
      estimated_reclaim_bytes: autonomyReport.estimated_reclaim_bytes,
      excluded_by_reason: autonomyReport.excluded_by_reason,
      legal_hold_count: autonomyReport.legal_hold_count,
      durable_type_count: autonomyReport.durable_type_count,
    });

    if (mode !== "archive" || candidateCount === 0) {
      return makeResponse(
        startedAt,
        [{
          mode: "forget_maintenance_plan",
          execute: false,
          archive_first: true,
          triggers,
          measurements,
          thresholds,
          archive_plan: planItem,
          ...(vectorPrunePlan ? { vector_prune_plan: vectorPrunePlan } : {}),
          automatic_hard_purge: false,
          automatic_compact: false,
          ...autonomyReport,
          autonomy_report: autonomyReport,
        } as unknown as Record<string, unknown>],
        request as unknown as Record<string, unknown>,
        { ...baseMeta, ...autonomyReport, candidate_count: candidateCount, execute: false },
      );
    }

    const manifestSha = typeof planItem.manifest_sha256 === "string" ? planItem.manifest_sha256 : "";
    const executed = this.adminForgetArchive({
      ...archiveRequest,
      execute: true,
      manifest_sha256: manifestSha,
      reason: `forget-maintenance:${triggers.join("+")}`,
    });
    if (!executed.ok) {
      return makeErrorResponse(startedAt, executed.error || "forget maintenance archive execute failed", request as unknown as Record<string, unknown>);
    }

    return makeResponse(
      startedAt,
      [{
        mode: "forget_maintenance_archive",
        execute: true,
        archive_first: true,
        triggers,
        measurements,
        thresholds,
        archive: executed.items[0],
        ...(vectorPrunePlan ? { vector_prune_plan: vectorPrunePlan } : {}),
        automatic_hard_purge: false,
        automatic_compact: false,
        ...autonomyReport,
        autonomy_report: autonomyReport,
      } as unknown as Record<string, unknown>],
      request as unknown as Record<string, unknown>,
      {
        ...baseMeta,
        ...autonomyReport,
        candidate_count: candidateCount,
        archived_count: (executed.items[0] as Record<string, unknown> | undefined)?.archived_count,
        execute: true,
      },
    );
  }

  adminForgetStatus(): ApiResponse {
    const startedAt = performance.now();
    const measurements = this.collectForgetMaintenanceMeasurements();
    const archivedStateRows = this.db
      .query<{ archive_state: string; count: number }, []>(`
        SELECT archive_state, COUNT(*) AS count
        FROM mem_archive_stubs
        GROUP BY archive_state
      `)
      .all();
    const archiveStates = archivedStateRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.archive_state] = Number(row.count ?? 0);
      return acc;
    }, {});
    const auditRows = this.db
      .query<{ action: string; details_json: string; created_at: string }, []>(`
        SELECT action, details_json, created_at
        FROM mem_audit_log
        WHERE action IN (
          'admin.forget_maintenance.plan',
          'admin.forget_maintenance.backoff',
          'admin.forget_maintenance.error',
          'admin.archive.create',
          'admin.vacuum.execute',
          'admin.vector_cache_prune.execute'
        )
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `)
      .all();
    const lastByAction: Record<string, Record<string, unknown>> = {};
    for (const row of auditRows) {
      if (lastByAction[row.action]) continue;
      const details = parseJsonSafe(row.details_json);
      lastByAction[row.action] = {
        action: row.action,
        created_at: row.created_at,
        details: {
          mode: details.mode ?? null,
          reason: details.reason ?? null,
          candidate_count: details.candidate_count ?? null,
          archived_count: details.archived_count ?? null,
          deleted_rows: details.deleted_rows ?? null,
          deleted_count: details.deleted_count ?? null,
          reclaimed_bytes: details.reclaimed_bytes ?? (parseJsonSafe(details.after ?? {}).reclaimed_bytes ?? null),
          duration_ms: details.duration_ms ?? null,
          skipped: details.skipped ?? null,
          error: details.error ?? null,
        },
      };
    }
    const lastMaintenance = lastByAction["admin.forget_maintenance.plan"] ?? null;
    const lastArchive = lastByAction["admin.archive.create"] ?? null;
    const lastCompact = lastByAction["admin.vacuum.execute"] ?? null;
    const lastVectorPrune = lastByAction["admin.vector_cache_prune.execute"] ?? null;
    const backoffActive = Date.now() < this.forgetMaintenanceBackoffUntilMs;
    const nextRun = this.config.forgetMaintenanceEnabled === true
      ? {
          interval_ms: this.config.forgetMaintenanceIntervalMs,
          backoff_until: backoffActive ? new Date(this.forgetMaintenanceBackoffUntilMs).toISOString() : null,
          exact_next_run_at: null,
        }
      : null;
    const latestCompactDetails = lastCompact ? parseJsonSafe(lastCompact.details) : {};
    const reclaimedBytes = Number(latestCompactDetails.reclaimed_bytes ?? 0);
    const riskLevel = backoffActive
      ? "attention"
      : this.config.forgetMaintenanceMode === "archive"
        ? "low"
        : measurements.archived_observations > 0 || measurements.stale_vector_rows > 0
          ? "medium"
          : "low";
    return makeResponse(
      startedAt,
      [{
        mode: "forget_status",
        scheduler: {
          enabled: this.config.forgetMaintenanceEnabled === true,
          mode: this.config.forgetMaintenanceMode,
          running: this.forgetMaintenanceRunning,
          schedule_enabled: this.config.forgetMaintenanceScheduleEnabled === true,
          limit: this.config.forgetMaintenanceLimit,
          health_budget_ms: this.config.forgetMaintenanceHealthBudgetMs,
          backoff_ms: this.config.forgetMaintenanceBackoffMs,
          next_run: nextRun,
        },
        counts: {
          active_observations: measurements.active_observations,
          archived_observations: measurements.archived_observations,
          archive_states: archiveStates,
          archived_vector_rows: measurements.archived_vector_rows,
          stale_vector_rows: measurements.stale_vector_rows,
        },
        last_run: {
          maintenance: lastMaintenance,
          archive: lastArchive,
          vector_prune: lastVectorPrune,
          compact: lastCompact,
        },
        reclaim: {
          db_size_bytes: measurements.db_size_bytes,
          wal_size_bytes: measurements.wal_size_bytes,
          last_compact_reclaimed_bytes: Number.isFinite(reclaimedBytes) ? reclaimedBytes : 0,
        },
        restore_window: {
          archive_restore_supported: Number(archiveStates.archived ?? 0) > 0,
          hard_purge_requires_backup_evidence: true,
          compact_requires_restore_drill: true,
        },
        risk_level: riskLevel,
        safety: {
          raw_content_returned: false,
          tokens_returned: false,
          confirmation_phrases_returned: false,
          automatic_hard_purge: false,
          automatic_compact: false,
        },
      } as unknown as Record<string, unknown>],
      {},
      {
        ranking: "forget_status_v1",
        risk_level: riskLevel,
      },
    );
  }

  adminForgetVectorPrune(request: AdminVectorPruneRequest = {}): ApiResponse {
    const startedAt = performance.now();
    const limit = clampLimit(request.limit, 1000, 1, 10_000);
    const project = typeof request.project === "string" && request.project.trim()
      ? this.normalizeProjectInput(request.project.trim())
      : undefined;
    const currentModel = typeof request.current_model === "string" && request.current_model.trim()
      ? request.current_model.trim()
      : this.config.forgetMaintenanceCurrentVectorModel || this.vectorModelVersion;
    const currentModelIsAdaptiveFamily =
      !request.current_model &&
      !this.config.forgetMaintenanceCurrentVectorModel &&
      currentModel.startsWith("adaptive:");
    const params: unknown[] = [];
    let whereSql = "WHERE o.archived_at IS NOT NULL";
    if (project) {
      whereSql += " AND o.project = ?";
      params.push(project);
    }

    const countRow = this.db
      .query(`SELECT COUNT(*) AS count FROM mem_vectors v JOIN mem_observations o ON o.id = v.observation_id ${whereSql}`)
      .get(...(params as never[])) as { count: number } | null;
    const groupedRows = this.db
      .query(`
        SELECT v.model AS model, v.dimension AS dimension, COUNT(*) AS count
        FROM mem_vectors v
        JOIN mem_observations o ON o.id = v.observation_id
        ${whereSql}
        GROUP BY v.model, v.dimension
        ORDER BY count DESC, v.model ASC
      `)
      .all(...(params as never[])) as Array<{ model: string; dimension: number; count: number }>;
    const staleRows = currentModelIsAdaptiveFamily
      ? this.db
          .query(
            `SELECT COUNT(*) AS count
             FROM mem_vectors v
             JOIN mem_observations o ON o.id = v.observation_id
             ${whereSql}
               AND (v.model < 'adaptive:' OR v.model >= 'adaptive;' OR v.dimension <> ?)`,
          )
          .get(...(params as never[]), this.config.vectorDimension) as { count: number } | null
      : this.db
          .query(
            `SELECT COUNT(*) AS count
             FROM mem_vectors v
             JOIN mem_observations o ON o.id = v.observation_id
             ${whereSql}
               AND (v.model <> ? OR v.dimension <> ?)`,
          )
          .get(...(params as never[]), currentModel, this.config.vectorDimension) as { count: number } | null;
    const sampleRows = this.db
      .query(`
        SELECT v.observation_id AS observation_id, v.model AS model, v.dimension AS dimension,
               o.project AS project, o.archived_at AS archived_at
        FROM mem_vectors v
        JOIN mem_observations o ON o.id = v.observation_id
        ${whereSql}
        ORDER BY o.archived_at ASC, v.rowid ASC
        LIMIT ?
      `)
      .all(...(params as never[]), limit) as Array<Record<string, unknown>>;
    const sampleIds = [...new Set(sampleRows
      .map((row) => typeof row.observation_id === "string" ? row.observation_id : null)
      .filter((id): id is string => !!id))];

    const item = {
      mode: "archived_vector_prune_plan",
      dry_run: true,
      execute: false,
      requested_execute_rejected: request.execute === true,
      archived_only: true,
      project: project ?? null,
      current_model: currentModel,
      current_dimension: this.config.vectorDimension,
      candidate_count: Number(countRow?.count ?? 0),
      stale_candidate_count: Number(staleRows?.count ?? 0),
      grouped_by_model: groupedRows.map((row) => ({
        model: row.model,
        dimension: Number(row.dimension),
        count: Number(row.count),
        stale: currentModelIsAdaptiveFamily
          ? !row.model.startsWith("adaptive:") || Number(row.dimension) !== this.config.vectorDimension
          : row.model !== currentModel || Number(row.dimension) !== this.config.vectorDimension,
      })),
      samples: sampleRows,
      estimated_delete_counts: {
        mem_vectors: Number(countRow?.count ?? 0),
        mem_vectors_vec_map_sample_rows: this.countSqliteVecMapRows(sampleIds),
      },
    };

    return makeResponse(
      startedAt,
      [item as unknown as Record<string, unknown>],
      request as unknown as Record<string, unknown>,
      {
        ranking: "archived_vector_prune_dry_run_v1",
        candidate_count: item.candidate_count,
        stale_candidate_count: item.stale_candidate_count,
        execute: false,
      },
    );
  }

  adminForgetArchiveSearch(request: AdminArchiveSearchRequest): ApiResponse {
    const startedAt = performance.now();
    if (!this.tableExists("mem_archive_stubs")) {
      return makeResponse(
        startedAt,
        [],
        request as unknown as Record<string, unknown>,
        { ranking: "archive_stub_search_v1", archive_tables_present: false },
      );
    }

    const limit = clampLimit(request.limit, 50, 1, 500);
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];
    const addStringFilter = (column: string, value: string | undefined): void => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) return;
      conditions.push(`${column} = ?`);
      params.push(trimmed);
    };

    addStringFilter("archive_id", request.archive_id);
    addStringFilter("observation_id", request.observation_id);
    addStringFilter("project", request.project);
    addStringFilter("archive_state", request.archive_state);
    addStringFilter("manifest_sha256", normalizeSha256(request.manifest_sha256) ?? undefined);

    let sql = `
      SELECT
        archive_id,
        observation_id,
        project,
        session_id,
        user_id,
        team_id,
        archive_stub,
        archive_full_ref,
        archive_state,
        reason,
        legal_hold_snapshot,
        content_sha256,
        manifest_sha256,
        created_at,
        restored_at,
        purged_at,
        metadata_json
      FROM mem_archive_stubs
    `;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += " ORDER BY created_at DESC, archive_id ASC LIMIT ?";
    params.push(limit);

    const rows = this.db
      .query(sql)
      .all(...(params as never[])) as Array<Record<string, unknown>>;

    return makeResponse(
      startedAt,
      rows,
      request as unknown as Record<string, unknown>,
      {
        ranking: "archive_stub_search_v1",
        returned: rows.length,
        payload_json_returned: false,
        raw_content_returned: false,
      },
    );
  }

  adminForgetRestore(request: AdminArchiveRestoreRequest): ApiResponse {
    const startedAt = performance.now();
    const archiveId = typeof request.archive_id === "string" && request.archive_id.trim() ? request.archive_id.trim() : null;
    const archiveFullRef = typeof request.archive_full_ref === "string" && request.archive_full_ref.trim()
      ? request.archive_full_ref.trim()
      : null;
    if (!archiveId && !archiveFullRef) {
      return makeErrorResponse(startedAt, "archive_id or archive_full_ref is required", request as unknown as Record<string, unknown>);
    }
    const reason = typeof request.reason === "string" && request.reason.trim() ? request.reason.trim() : "";
    if (request.execute === true && !reason) {
      return makeErrorResponse(startedAt, "reason is required for restore execute", request as unknown as Record<string, unknown>);
    }

    const loadArchive = (): ArchiveStorageRow | null => this.db
      .query(`
        SELECT
          s.archive_id, s.observation_id, s.archive_full_ref, s.archive_state, s.reason,
          s.content_sha256, s.manifest_sha256,
          f.payload_json, f.payload_sha256, f.purged_at AS full_purged_at
        FROM mem_archive_stubs s
        LEFT JOIN mem_archive_full f ON f.archive_full_ref = s.archive_full_ref
        WHERE ${archiveId ? "s.archive_id = ?" : "s.archive_full_ref = ?"}
        LIMIT 1
      `)
      .get((archiveId ?? archiveFullRef) as string) as ArchiveStorageRow | null;

    const validateArchive = (): {
      ok: true;
      row: NonNullable<ReturnType<typeof loadArchive>>;
      payload: ArchivePayload;
      payload_sha256: string;
    } | { ok: false; error: string } => {
      const row = loadArchive();
      if (!row) return { ok: false, error: "archive not found" };
      if (row.archive_state === "purged") return { ok: false, error: "archive_purged" };
      const payloadValidation = this.validateArchivePayload(row);
      if (!payloadValidation.ok) return payloadValidation;
      const original = this.db
        .query<{ archived_at: string | null }, [string]>(`SELECT archived_at FROM mem_observations WHERE id = ?`)
        .get(row.observation_id);
      if (original && original.archived_at === null) {
        return { ok: false, error: "active original observation already exists" };
      }
      return { ok: true, row, payload: payloadValidation.payload, payload_sha256: payloadValidation.payload_sha256 };
    };

    const initial = validateArchive();
    if (!initial.ok) {
      return makeErrorResponse(startedAt, initial.error, request as unknown as Record<string, unknown>);
    }
    if (request.execute !== true) {
      return makeResponse(
        startedAt,
        [{
          mode: "archive_restore_plan",
          execute: false,
          archive_id: initial.row.archive_id,
          archive_full_ref: initial.row.archive_full_ref,
          observation_id: initial.row.observation_id,
          manifest_sha256: initial.row.manifest_sha256,
          payload_sha256: initial.payload_sha256,
          restore_supported: true,
        } as unknown as Record<string, unknown>],
        { ...request, execute: false },
        { manifest_sha256: initial.row.manifest_sha256, ranking: "archive_restore_plan_v1" },
      );
    }

    let transactionStarted = false;
    let restored: {
      row: ArchiveStorageRow;
      payload: ArchivePayload;
      payload_sha256: string;
      restored_at: string;
    } | null = null;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const current = validateArchive();
      if (!current.ok) {
        throw new Error(current.error);
      }
      this.restoreArchivePayloadRows(current.payload);
      const restoredAt = nowIso();
      const observationRows = current.payload.rows.mem_observations ?? [];
      const observation = observationRows[0] ?? {};
      const originalPrivacyTags = parseJsonStringArray(
        typeof observation.privacy_tags_json === "string" ? observation.privacy_tags_json : "[]",
      );
      const shouldKeepDeleted = /^user[_-]?delete|user_requested_delete$/i.test(current.row.reason);
      const restoredPrivacyTags = shouldKeepDeleted
        ? originalPrivacyTags
        : originalPrivacyTags.filter((tag) => tag !== "deleted");
      this.db
        .query(`UPDATE mem_observations SET archived_at = NULL, privacy_tags_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(restoredPrivacyTags), restoredAt, current.row.observation_id);
      const restoredObservation = this.db
        .query<{ archived_at: string | null }, [string]>(`SELECT archived_at FROM mem_observations WHERE id = ?`)
        .get(current.row.observation_id);
      if (!restoredObservation || restoredObservation.archived_at !== null) {
        throw new Error("restore did not rehydrate active observation");
      }
      this.db
        .query(`UPDATE mem_archive_stubs SET archive_state = 'restored', restored_at = ? WHERE archive_id = ?`)
        .run(restoredAt, current.row.archive_id);
      this.db.exec("COMMIT");
      transactionStarted = false;
      restored = {
        row: current.row,
        payload: current.payload,
        payload_sha256: current.payload_sha256,
        restored_at: restoredAt,
      };
    } catch (error) {
      if (transactionStarted) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Preserve the original failure.
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      return makeErrorResponse(startedAt, `archive restore failed: ${message}`, request as unknown as Record<string, unknown>);
    }
    if (!restored) {
      return makeErrorResponse(startedAt, "archive restore failed: restore result missing", request as unknown as Record<string, unknown>);
    }
    const vectorRepair = this.repairSqliteVecAfterArchiveRestore((restored.payload.rows.mem_vectors ?? []).length);
    this.writeAuditLog("admin.archive.restore", "archive", restored.row.archive_id, {
      archive_id: restored.row.archive_id,
      archive_full_ref: restored.row.archive_full_ref,
      observation_id: restored.row.observation_id,
      manifest_sha256: restored.row.manifest_sha256,
      payload_sha256: restored.payload_sha256,
      sqlite_vec_repair: vectorRepair,
      reason,
    });

    return makeResponse(
      startedAt,
      [{
        mode: "archive_restore_execute",
        execute: true,
        archive_id: restored.row.archive_id,
        archive_full_ref: restored.row.archive_full_ref,
        observation_id: restored.row.observation_id,
        manifest_sha256: restored.row.manifest_sha256,
        payload_sha256: restored.payload_sha256,
        restored_at: restored.restored_at,
        sqlite_vec_repair: vectorRepair,
      } as unknown as Record<string, unknown>],
      { ...request, execute: true },
      { manifest_sha256: restored.row.manifest_sha256, ranking: "archive_restore_execute_v1" },
    );
  }

  private currentDatabaseIdentitySha256(): string {
    if (this.config.dbPath === ":memory:") {
      return sha256Hex(stableJson({ db_path: ":memory:" }));
    }
    const dbPath = resolve(resolveHomePath(this.config.dbPath));
    try {
      const stat = statSync(dbPath);
      return sha256Hex(stableJson({
        db_path: dbPath,
        realpath: realpathSync(dbPath),
        dev: stat.dev,
        ino: stat.ino,
      }));
    } catch {
      return sha256Hex(stableJson({ db_path: dbPath, realpath: null, dev: null, ino: null }));
    }
  }

  private snapshotBackupFile(backupPath: string): BackupFileSnapshot | { error: string } {
    try {
      const stat = statSync(backupPath);
      if (!stat.isFile()) {
        return { error: "backup_path must be a file" };
      }
      return {
        path: backupPath,
        realpath: realpathSync(backupPath),
        size_bytes: stat.size,
        mtime_ms: stat.mtimeMs,
        mtime_iso: stat.mtime.toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `backup_path stat failed: ${message}` };
    }
  }

  private createPreverifiedBackupEvidenceToken(request: AdminBackupEvidenceRequest): { token: string; evidence: PreverifiedBackupEvidence } | { error: string } {
    const candidateIds = uniqueSortedStrings(
      (request.candidate_ids && request.candidate_ids.length > 0)
        ? request.candidate_ids
        : request.target_ids,
    );
    if (candidateIds.length === 0) {
      return { error: "candidate_ids or target_ids are required for backup evidence" };
    }
    if (candidateIds.length > 500) {
      return { error: "candidate_ids length exceeds maximum of 500" };
    }
    const backupSha256Raw = typeof request.backup_sha256 === "string" ? request.backup_sha256.trim() : "";
    const backupSha256 = normalizeSha256(backupSha256Raw);
    if (!backupSha256) {
      return { error: "backup_sha256 must be a sha256 hex string" };
    }
    const backupPath = typeof request.backup_path === "string" && request.backup_path.trim()
      ? resolve(request.backup_path.trim())
      : "";
    if (!backupPath) {
      return { error: "backup_path is required" };
    }
    if (!existsSync(backupPath)) {
      return { error: "backup_path does not exist" };
    }

    const snapshot = this.snapshotBackupFile(backupPath);
    if ("error" in snapshot) {
      return snapshot;
    }
    const actual = sha256FileHex(backupPath);
    if (actual !== backupSha256) {
      return { error: "backup_path sha256 does not match backup_sha256" };
    }
    const integrityCheck = this.verifySqliteBackupIntegrity(backupPath);
    if (!integrityCheck.ok) {
      return { error: `backup_path integrity_check failed: ${integrityCheck.error ?? integrityCheck.result ?? "unknown"}` };
    }
    let backupDb: Database | null = null;
    let coverage: { candidate_ids: string[]; candidate_coverage_sha256: string } | { error: string };
    try {
      backupDb = new Database(backupPath, { readonly: true });
      coverage = this.computeCandidateBackupCoverage(backupDb, candidateIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      coverage = { error: `backup candidate coverage failed: ${message}` };
    } finally {
      try {
        backupDb?.close();
      } catch {
        // best effort
      }
    }
    if ("error" in coverage) {
      return { error: coverage.error };
    }

    const ttlSeconds = request.ttl_seconds === undefined
      ? 5 * 60
      : Math.trunc(request.ttl_seconds);
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0 || ttlSeconds > 24 * 60 * 60) {
      return { error: "ttl_seconds must be an integer from 0 to 86400" };
    }
    const nowMs = Date.now();
    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
    const token = `preverified_backup_${randomBytes(32).toString("base64url")}`;
    const evidence: PreverifiedBackupEvidence = {
      ...snapshot,
      backup_sha256: backupSha256,
      candidate_ids: coverage.candidate_ids,
      candidate_coverage_sha256: coverage.candidate_coverage_sha256,
      token_sha256: sha256Hex(token),
      created_at: createdAt,
      expires_at: expiresAt,
      db_identity_sha256: this.currentDatabaseIdentitySha256(),
      integrity_check: integrityCheck,
    };
    this.preverifiedBackupEvidenceTokens.set(token, evidence);
    return { token, evidence };
  }

  private resolvePreverifiedBackupEvidence(
    token: string,
    requestedPath: string | null,
    requestedSha256: string | null,
    candidateIds: string[],
  ): BackupEvidence | { error: string } {
    if (!/^preverified_backup_[A-Za-z0-9_-]{16,}$/.test(token)) {
      return { error: "preverified_backup_evidence_token is invalid" };
    }
    const evidence = this.preverifiedBackupEvidenceTokens.get(token);
    if (!evidence) {
      return { error: "preverified_backup_evidence_token is unknown or consumed" };
    }
    const expiresMs = Date.parse(evidence.expires_at);
    if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
      this.preverifiedBackupEvidenceTokens.delete(token);
      return { error: "preverified_backup_evidence_token has expired" };
    }
    if (requestedPath && requestedPath !== evidence.path) {
      return { error: "preverified_backup_evidence_token backup_path mismatch" };
    }
    if (requestedSha256 && requestedSha256 !== evidence.backup_sha256) {
      return { error: "preverified_backup_evidence_token backup_sha256 mismatch" };
    }
    if (this.currentDatabaseIdentitySha256() !== evidence.db_identity_sha256) {
      return { error: "preverified_backup_evidence_token db identity mismatch" };
    }
    const expectedIds = uniqueSortedStrings(candidateIds);
    if (!Array.isArray(evidence.candidate_ids) || evidence.candidate_ids.length === 0 || !evidence.candidate_coverage_sha256) {
      return { error: "preverified_backup_evidence_token candidate coverage is missing" };
    }
    if (stableJson(evidence.candidate_ids) !== stableJson(expectedIds)) {
      return { error: "preverified_backup_evidence_token candidate_ids coverage mismatch" };
    }
    const currentCoverage = this.computeCandidateBackupCoverage(this.db, expectedIds);
    if ("error" in currentCoverage) {
      return { error: `preverified_backup_evidence_token current candidate coverage failed: ${currentCoverage.error}` };
    }
    if (currentCoverage.candidate_coverage_sha256 !== evidence.candidate_coverage_sha256) {
      return { error: "preverified_backup_evidence_token candidate coverage hash mismatch" };
    }
    const current = this.snapshotBackupFile(evidence.path);
    if ("error" in current) {
      return { error: current.error };
    }
    if (
      current.realpath !== evidence.realpath ||
      current.size_bytes !== evidence.size_bytes ||
      current.mtime_ms !== evidence.mtime_ms
    ) {
      return { error: "preverified_backup_evidence_token backup file stat changed" };
    }
    return {
      provided: true,
      backup_sha256: evidence.backup_sha256,
      backup_path: evidence.path,
      candidate_ids: evidence.candidate_ids,
      candidate_coverage_sha256: evidence.candidate_coverage_sha256,
      temp_test_backup_token_sha256: null,
      preverified_backup_evidence_token_sha256: evidence.token_sha256,
      kind: "preverified_backup",
      integrity_check: {
        checked: false,
        ok: true,
        result: "preverified",
        error: null,
      },
    };
  }

  private consumePreverifiedBackupEvidenceToken(request: AdminHardPurgeRequest, manifest: HardPurgeManifest): void {
    if (manifest.backup.kind !== "preverified_backup") {
      return;
    }
    const token = typeof request.preverified_backup_evidence_token === "string"
      ? request.preverified_backup_evidence_token.trim()
      : "";
    if (token) {
      this.preverifiedBackupEvidenceTokens.delete(token);
    }
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

  private resolveHardPurgeBackupEvidence(request: AdminHardPurgeRequest, candidateIds: string[]): BackupEvidence | { error: string } {
    const backupSha256Raw = typeof request.backup_sha256 === "string" ? request.backup_sha256.trim() : "";
    const backupSha256 = backupSha256Raw ? normalizeSha256(backupSha256Raw) : null;
    if (backupSha256Raw && !backupSha256) {
      return { error: "backup_sha256 must be a sha256 hex string" };
    }

    const backupPath = typeof request.backup_path === "string" && request.backup_path.trim()
      ? resolve(request.backup_path.trim())
      : null;
    const preverifiedToken = typeof request.preverified_backup_evidence_token === "string"
      ? request.preverified_backup_evidence_token.trim()
      : "";
    if (preverifiedToken) {
      return this.resolvePreverifiedBackupEvidence(preverifiedToken, backupPath, backupSha256, candidateIds);
    }

    if (backupPath) {
      if (!backupSha256) {
        return { error: "backup_sha256 is required when backup_path is provided" };
      }
      if (!existsSync(backupPath)) {
        return { error: "backup_path does not exist" };
      }
      const actual = sha256FileHex(backupPath);
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
        candidate_ids: null,
        candidate_coverage_sha256: null,
        temp_test_backup_token_sha256: null,
        preverified_backup_evidence_token_sha256: null,
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
        candidate_ids: null,
        candidate_coverage_sha256: null,
        temp_test_backup_token_sha256: sha256Hex(tempToken),
        preverified_backup_evidence_token_sha256: null,
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
        candidate_ids: null,
        candidate_coverage_sha256: null,
        temp_test_backup_token_sha256: null,
        preverified_backup_evidence_token_sha256: null,
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
      candidate_ids: null,
      candidate_coverage_sha256: null,
      temp_test_backup_token_sha256: null,
      preverified_backup_evidence_token_sha256: null,
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
    archive.restore_capable_full_count = this.countRestoreCapableArchiveFullObservations(ids);
    archive.restore_capable_count = archive.restore_capable_full_count;
    archive.restore_capable_full_observation_count = archive.restore_capable_full_count;
    archive.missing_restore_capable_archive_ids = this.listMissingRestoreCapableArchiveIds(ids);
    return archive;
  }

  private buildHardPurgeManifest(request: AdminHardPurgeRequest, rows: HardPurgeCandidateRow[]): HardPurgePrepareResult {
    const ids = rows.map((row) => row.id).sort();
    const backupEvidence = this.resolveHardPurgeBackupEvidence(request, ids);
    if ("error" in backupEvidence) {
      return { ok: false, error: backupEvidence.error };
    }

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
        candidate_ids: backupEvidence.candidate_ids,
        candidate_coverage_sha256: backupEvidence.candidate_coverage_sha256,
        temp_test_backup_token_sha256: backupEvidence.temp_test_backup_token_sha256,
        preverified_backup_evidence_token_sha256: backupEvidence.preverified_backup_evidence_token_sha256,
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
    };
    if (request.readiness_only !== true) {
      manifest.confirmation_phrase = `HARD_PURGE ${ids.length} OBSERVATIONS ${manifestHash.slice(0, 12)}`;
    }
    return { ok: true, manifest, rows };
  }

  private prepareHardPurgeManifest(request: AdminHardPurgeRequest): HardPurgePrepareResult {
    const selected = this.selectHardPurgeCandidateRows(request);
    if (!selected.ok) {
      return selected;
    }
    return this.buildHardPurgeManifest(request, selected.rows);
  }

  private assertHardPurgeExecuteGates(request: AdminHardPurgeRequest, manifest: HardPurgeManifest, requestedAtMs: number = Date.now()): string | null {
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
    if (requestedAtMs > manifestExpiresMs) {
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
      return "backup_path plus backup_sha256, preverified_backup_evidence_token, or temp_test_backup_token for temp DBs, is required for hard purge execute";
    }
    if (
      (manifest.backup.kind === "backup_file" || manifest.backup.kind === "preverified_backup") &&
      !manifest.backup.integrity_check.ok
    ) {
      return "backup integrity_check must be ok for hard purge execute";
    }
    if (manifest.backup.kind === "preverified_backup") {
      if (
        !manifest.backup.candidate_ids ||
        manifest.backup.candidate_ids.length === 0 ||
        !manifest.backup.candidate_coverage_sha256
      ) {
        return "preverified backup candidate coverage is required for hard purge execute";
      }
      if (stableJson(manifest.backup.candidate_ids) !== stableJson(manifest.candidate_ids)) {
        return "preverified backup candidate coverage does not match current hard purge manifest";
      }
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
    if (!manifest.confirmation_phrase) {
      return "confirmation phrase is unavailable for readiness-only hard purge plan";
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

  adminForgetBackupEvidence(request: AdminBackupEvidenceRequest): ApiResponse {
    const startedAt = performance.now();
    const created = this.createPreverifiedBackupEvidenceToken(request);
    if ("error" in created) {
      return makeErrorResponse(startedAt, created.error, request as unknown as Record<string, unknown>);
    }
    const { token, evidence } = created;
    this.writeAuditLog("admin.backup_evidence.create", "backup", evidence.path, {
      backup_sha256: evidence.backup_sha256,
      size_bytes: evidence.size_bytes,
      mtime_ms: evidence.mtime_ms,
      candidate_ids: evidence.candidate_ids,
      candidate_coverage_sha256: evidence.candidate_coverage_sha256,
      token_sha256: evidence.token_sha256,
      expires_at: evidence.expires_at,
      db_identity_sha256: evidence.db_identity_sha256,
    });
    return makeResponse(
      startedAt,
      [{
        mode: "backup_evidence",
        preverified_backup_evidence_token: token,
        backup_path: evidence.path,
        backup_sha256: evidence.backup_sha256,
        candidate_ids: evidence.candidate_ids,
        candidate_coverage_sha256: evidence.candidate_coverage_sha256,
        size_bytes: evidence.size_bytes,
        mtime_ms: evidence.mtime_ms,
        mtime_iso: evidence.mtime_iso,
        token_sha256: evidence.token_sha256,
        db_identity_sha256: evidence.db_identity_sha256,
        created_at: evidence.created_at,
        expires_at: evidence.expires_at,
        integrity_check: evidence.integrity_check,
      } as unknown as Record<string, unknown>],
      {
        backup_path: evidence.path,
        backup_sha256: evidence.backup_sha256,
        candidate_ids: evidence.candidate_ids,
        candidate_coverage_sha256: evidence.candidate_coverage_sha256,
        ttl_seconds: request.ttl_seconds,
      },
      {
        ranking: "preverified_backup_evidence_v1",
        backup_sha256: evidence.backup_sha256,
        candidate_coverage_sha256: evidence.candidate_coverage_sha256,
        size_bytes: evidence.size_bytes,
        expires_at: evidence.expires_at,
      },
    );
  }

  adminForgetHardPurge(request: AdminHardPurgeRequest): ApiResponse {
    const startedAt = performance.now();
    const requestedAtMs = Date.now();
    const initial = this.prepareHardPurgeManifest(request);
    if (!initial.ok) {
      return makeErrorResponse(startedAt, initial.error, request as unknown as Record<string, unknown>);
    }

    if (request.execute !== true) {
      const nowMs = Date.now();
      if (request.readiness_only !== true) {
        for (const [hash, expiresAt] of this.hardPurgePlanExpirations.entries()) {
          const expiresMs = Date.parse(expiresAt);
          if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
            this.hardPurgePlanExpirations.delete(hash);
          }
        }
        this.hardPurgePlanExpirations.set(initial.manifest.manifest_hash, initial.manifest.expires_at);
      }
      return makeResponse(
        startedAt,
        [{
          mode: request.readiness_only === true ? "hard_purge_readiness" : "hard_purge_plan",
          execute: false,
          ...initial.manifest,
        } as unknown as Record<string, unknown>],
        { ...request, execute: false },
        {
          candidate_count: initial.manifest.candidate_count,
          manifest_hash: initial.manifest.manifest_hash,
          ranking: request.readiness_only === true ? "hard_purge_readiness_v1" : "hard_purge_plan_v1",
        },
      );
    }

    const initialGateError = this.assertHardPurgeExecuteGates(request, initial.manifest, requestedAtMs);
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
      const gateError = this.assertHardPurgeExecuteGates(request, current.manifest, requestedAtMs);
      if (gateError) {
        throw new Error(gateError);
      }

      const deleted_counts = this.executeHardPurgeCascade(current.manifest);
      this.hardPurgePlanExpirations.delete(current.manifest.manifest_hash);
      this.db.exec("COMMIT");
      transactionStarted = false;
      this.consumePreverifiedBackupEvidenceToken(request, current.manifest);

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

  /**
   * S154-900: External-channel (Hermes business) read surface.
   *
   * Forces include_private=false / include_archived=false, then applies the
   * external-channel egress policy: observations tagged
   * private/internal/secret (or with malformed privacy_tags — fail-closed)
   * are excluded, and surviving title/content pass the deterministic
   * redactor (stripPrivateBlocks + redactSecrets). All memory reads bound
   * for an external channel MUST go through this method — resume_pack is
   * not an external-channel surface (see external-channel-policy.ts).
   */
  async searchForExternalChannel(request: SearchRequest): Promise<ApiResponse> {
    const response = await this.searchPrepared({
      ...request,
      include_private: false,
      include_archived: false,
    });
    if (!response.ok || !Array.isArray(response.items)) return response;
    const sanitized = sanitizeItemsForExternalChannel(response.items as ExternalChannelItem[]);
    response.items = sanitized.items;
    (response.meta as Record<string, unknown>).external_channel = {
      policy: "exclude+redact",
      blocked_privacy_tags: [...EXTERNAL_CHANNEL_BLOCKED_PRIVACY_TAGS],
      excluded_count: sanitized.excluded_count,
    };
    return response;
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

    const stats: ConsolidationRunStats = await runConsolidationOnce(this.db, options, {
      allowLocalDreamingObservationWrites:
        this.config.backendMode !== "hybrid" && this.config.backendMode !== "managed",
      materializeObservationDerivedData: (observationId) =>
        this.eventRec.materializeObservationDerivedData(observationId),
    });
    this.maybeRunSearchDbMaintenance();
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
      process.env.HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD === "1" ||
      process.env.HARNESS_MEM_VECTOR_BACKFILL_CHILD === "1" ||
      process.env.HARNESS_MEM_OBSERVATION_MATERIALIZE_CHILD === "1";

    for (const timer of this.recallProjectionRefreshTimers.values()) {
      clearTimeout(timer);
    }
    this.recallProjectionRefreshTimers.clear();

    if (this.searchWorker) {
      this.searchWorker.stop("core shutdown");
      this.searchWorker = null;
    }

    // §91-002: stop partial-finalize scheduler before stopping ingest timers
    this.partialFinalizeScheduler.stop();
    // S89-003: stop reindex backfill scheduler
    this.reindexVectorsScheduler.stop();
    if (this.forgetMaintenanceTimer) {
      clearInterval(this.forgetMaintenanceTimer);
      this.forgetMaintenanceTimer = null;
    }
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
