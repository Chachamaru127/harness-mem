#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { HarnessMemCore, getConfig, type ApiResponse, type Config } from "../memory-server/src/core/harness-mem-core";
import { resolveHomePath } from "../memory-server/src/core/core-utils";

type Args = {
  dbPath?: string;
  backupPath?: string;
  backupSha256?: string;
  project?: string;
  limit: number;
  execute: boolean;
  archiveFirst: boolean;
  archiveOnly: boolean;
  pruneStaleVectors: boolean;
  compact: boolean;
  batchSize: number;
  timeBudgetMs: number;
  checkpointPath?: string;
  resume: boolean;
  allowRunningDaemon: boolean;
  autonomousPurgeEnabled: boolean;
  retentionDays: number;
  maxPurgeRows?: number;
  minimumFreeBytes: number;
  profileHash?: string;
  reason: string;
  currentVectorModel: string;
  scoreThreshold?: number;
  protectAccessed?: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 100,
    execute: false,
    archiveFirst: false,
    archiveOnly: false,
    pruneStaleVectors: false,
    compact: false,
    batchSize: 100,
    timeBudgetMs: 0,
    resume: false,
    allowRunningDaemon: false,
    autonomousPurgeEnabled: false,
    retentionDays: 0,
    minimumFreeBytes: 0,
    reason: "offline-forget-maintenance",
    currentVectorModel: "adaptive:general:local:multilingual-e5",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db-path") {
      args.dbPath = argv[++i];
    } else if (arg === "--backup-path") {
      args.backupPath = argv[++i];
    } else if (arg === "--backup-sha256") {
      args.backupSha256 = argv[++i];
    } else if (arg === "--project") {
      args.project = argv[++i];
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (arg === "--batch-size") {
      args.batchSize = Number(argv[++i]);
    } else if (arg === "--time-budget-ms") {
      args.timeBudgetMs = Number(argv[++i]);
    } else if (arg === "--checkpoint-path") {
      args.checkpointPath = argv[++i];
    } else if (arg === "--resume") {
      args.resume = true;
    } else if (arg === "--allow-running-daemon") {
      args.allowRunningDaemon = true;
    } else if (arg === "--autonomous-purge-enabled") {
      args.autonomousPurgeEnabled = true;
    } else if (arg === "--retention-days") {
      args.retentionDays = Number(argv[++i]);
    } else if (arg === "--max-purge-rows") {
      args.maxPurgeRows = Number(argv[++i]);
    } else if (arg === "--minimum-free-bytes") {
      args.minimumFreeBytes = Number(argv[++i]);
    } else if (arg === "--profile-hash") {
      args.profileHash = argv[++i];
    } else if (arg === "--score-threshold") {
      args.scoreThreshold = Number(argv[++i]);
    } else if (arg === "--protect-accessed") {
      args.protectAccessed = true;
    } else if (arg === "--allow-accessed") {
      args.protectAccessed = false;
    } else if (arg === "--archive-first") {
      args.archiveFirst = true;
    } else if (arg === "--archive-only") {
      args.archiveOnly = true;
    } else if (arg === "--prune-stale-vectors") {
      args.pruneStaleVectors = true;
    } else if (arg === "--compact" || arg === "--vacuum") {
      args.compact = true;
    } else if (arg === "--current-vector-model") {
      args.currentVectorModel = argv[++i];
    } else if (arg === "--reason") {
      args.reason = argv[++i];
    } else if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 5000) {
    throw new Error("--limit must be an integer from 1 to 5000");
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > 1000) {
    throw new Error("--batch-size must be an integer from 1 to 1000");
  }
  if (!Number.isInteger(args.timeBudgetMs) || args.timeBudgetMs < 0) {
    throw new Error("--time-budget-ms must be a non-negative integer");
  }
  if (!Number.isInteger(args.retentionDays) || args.retentionDays < 0) {
    throw new Error("--retention-days must be a non-negative integer");
  }
  if (args.maxPurgeRows !== undefined && (!Number.isInteger(args.maxPurgeRows) || args.maxPurgeRows < 1 || args.maxPurgeRows > 5000)) {
    throw new Error("--max-purge-rows must be an integer from 1 to 5000");
  }
  if (!Number.isInteger(args.minimumFreeBytes) || args.minimumFreeBytes < 0) {
    throw new Error("--minimum-free-bytes must be a non-negative integer");
  }
  if (args.scoreThreshold !== undefined && !Number.isFinite(args.scoreThreshold)) {
    throw new Error("--score-threshold must be a number");
  }
  if (args.archiveFirst && !args.reason.trim()) {
    throw new Error("--reason must be non-empty when --archive-first is used");
  }
  if (!args.currentVectorModel.trim()) {
    throw new Error("--current-vector-model must be non-empty");
  }
  if (args.archiveFirst && args.pruneStaleVectors) {
    throw new Error("--archive-first and --prune-stale-vectors cannot be combined");
  }
  if (args.archiveOnly && args.archiveFirst) {
    throw new Error("--archive-only and --archive-first cannot be combined");
  }
  if (args.archiveOnly && args.pruneStaleVectors) {
    throw new Error("--archive-only and --prune-stale-vectors cannot be combined");
  }
  if (args.archiveOnly && args.compact) {
    throw new Error("--compact cannot be combined with --archive-only; compact after hard purge");
  }
  if (args.compact && !args.execute) {
    throw new Error("--compact requires --execute");
  }
  if (!args.archiveOnly) {
    if (!args.backupPath) throw new Error("--backup-path is required");
    if (!args.backupSha256 || !/^[a-fA-F0-9]{64}$/.test(args.backupSha256)) {
      throw new Error("--backup-sha256 must be a 64-character hex digest");
    }
  }
  return args;
}

function usage(code: number): never {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write([
    "Usage: bun run scripts/forget-maintenance-offline.ts --backup-path <db> --backup-sha256 <sha256> [--db-path <db>] [--limit <1..5000>] [--execute]",
    "",
    "Stops neither daemon nor LaunchAgent by itself. Run with the daemon stopped.",
    "Uses existing HarnessMemCore backup-evidence and hard-purge gates; it does not run raw DELETE SQL.",
    "",
    "Modes:",
    "  default          Hard-purge already archived rows only.",
    "  --archive-only  Archive candidates and stop before backup/hard-purge.",
    "  --archive-first Archive candidates first, then use backup evidence and hard-purge those archived rows.",
    "  --prune-stale-vectors",
    "                   Delete non-current vector cache rows only when the current vector already exists.",
    "  --compact        Run VACUUM after execute to reclaim file size. Requires --execute.",
    "  --batch-size <n> Process execute modes in small batches. Default 100.",
    "  --time-budget-ms <n>",
    "                   Stop after this many milliseconds and write checkpoint progress.",
    "  --checkpoint-path <path>",
    "                   JSON checkpoint for abort-safe resume.",
    "  --resume         Continue from an existing checkpoint.",
    "  --allow-running-daemon",
    "                   Override execute guard when the local daemon appears to be running.",
    "  --autonomous-purge-enabled",
    "                   Opt in to the local autonomous purge profile gate.",
    "  --retention-days <n>",
    "  --max-purge-rows <n>",
    "  --minimum-free-bytes <n>",
    "  --profile-hash <sha256>",
    "                   Confirmation-free local profile hash for autonomous purge.",
    "",
    "Filters:",
    "  --project <path>",
    "  --score-threshold <n>",
    "  --protect-accessed | --allow-accessed",
    "  --reason <text>",
    "  --current-vector-model <model>",
    "",
  ].join("\n"));
  process.exit(code);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

function hardFail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function firstItem(response: ApiResponse): Record<string, unknown> {
  return (response.items?.[0] ?? {}) as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function buildOfflineConfig(args: Args): Config {
  const config = getConfig();
  if (args.dbPath) {
    config.dbPath = args.dbPath;
  }
  config.backgroundWorkersEnabled = false;
  config.partialFinalizeEnabled = false;
  config.reindexVectorsEnabled = false;
  config.codexHistoryEnabled = false;
  config.opencodeIngestEnabled = false;
  config.cursorIngestEnabled = false;
  config.antigravityIngestEnabled = false;
  config.geminiIngestEnabled = false;
  config.claudeCodeIngestEnabled = false;
  return config;
}

function selectArchivedCandidateIds(core: HarnessMemCore, limit: number): string[] {
  const rows = core.getRawDb()
    .query<{ observation_id: string }, [number]>(`
      SELECT s.observation_id
      FROM mem_archive_stubs s
      JOIN mem_observations o ON o.id = s.observation_id
      WHERE s.archive_state = 'archived'
        AND o.archived_at IS NOT NULL
      ORDER BY s.created_at ASC, s.observation_id ASC
      LIMIT ?
    `)
    .all(Math.floor(limit));
  return rows.map((row) => row.observation_id);
}

function count(core: HarnessMemCore, sql: string): number {
  const row = core.getRawDb().query<{ count: number }, []>(sql).get();
  return Number(row?.count ?? 0);
}

function staleVectorRows(core: HarnessMemCore, currentModel: string): Array<{ model: string; rows: number; vector_json_bytes: number }> {
  return core.getRawDb()
    .query<{ model: string; rows: number; vector_json_bytes: number }, [string, string]>(`
      WITH current AS (
        SELECT observation_id FROM mem_vectors WHERE model = ?
      )
      SELECT model, COUNT(*) AS rows, COALESCE(SUM(LENGTH(vector_json)), 0) AS vector_json_bytes
      FROM mem_vectors
      WHERE model <> ?
        AND observation_id IN current
      GROUP BY model
      ORDER BY rows DESC, model ASC
    `)
    .all(currentModel, currentModel);
}

function vectorModelRows(core: HarnessMemCore): Array<{ model: string; rows: number; vector_json_bytes: number }> {
  return core.getRawDb()
    .query<{ model: string; rows: number; vector_json_bytes: number }, []>(`
      SELECT model, COUNT(*) AS rows, COALESCE(SUM(LENGTH(vector_json)), 0) AS vector_json_bytes
      FROM mem_vectors
      GROUP BY model
      ORDER BY rows DESC, model ASC
    `)
    .all();
}

function databaseSizeSnapshot(dbPath: string): Record<string, number | string | null> {
  const fileSize = (path: string): number => existsSync(path) ? statSync(path).size : 0;
  if (dbPath === ":memory:") {
    return {
      db_path: dbPath,
      db_bytes: null,
      wal_bytes: null,
      shm_bytes: null,
      total_bytes: null,
    };
  }
  const resolved = resolve(resolveHomePath(dbPath));
  const dbBytes = fileSize(resolved);
  const walBytes = fileSize(`${resolved}-wal`);
  const shmBytes = fileSize(`${resolved}-shm`);
  return {
    db_path: resolved,
    db_bytes: dbBytes,
    wal_bytes: walBytes,
    shm_bytes: shmBytes,
    total_bytes: dbBytes + walBytes + shmBytes,
  };
}

type OfflineCheckpoint = {
  schema_version: "s129-offline-lifecycle-checkpoint-v1";
  mode: string;
  db_path: string;
  processed_count: number;
  total_count: number;
  completed: boolean;
  updated_at: string;
  last_batch?: Record<string, unknown>;
};

function checkpointPathFor(args: Args, dbPath: string): string | undefined {
  if (args.checkpointPath) return resolve(resolveHomePath(args.checkpointPath));
  if (!args.execute || dbPath === ":memory:") return undefined;
  return `${resolve(resolveHomePath(dbPath))}.forget-maintenance.checkpoint.json`;
}

function readCheckpoint(path: string | undefined, mode: string, args: Args): OfflineCheckpoint | null {
  if (!path || !args.resume || !existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as OfflineCheckpoint;
  if (parsed.schema_version !== "s129-offline-lifecycle-checkpoint-v1") {
    throw new Error(`checkpoint schema mismatch: ${path}`);
  }
  if (parsed.mode !== mode) {
    throw new Error(`checkpoint mode mismatch: expected=${mode} actual=${parsed.mode}`);
  }
  return parsed;
}

function writeCheckpoint(path: string | undefined, checkpoint: OfflineCheckpoint): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function progressEnvelope(args: Args, mode: string, totalCount: number, processedCount: number, checkpointPath: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "s129-offline-progress-v1",
    mode,
    batch_size: args.batchSize,
    time_budget_ms: args.timeBudgetMs,
    checkpoint_path: checkpointPath ?? null,
    resume_requested: args.resume,
    total_count: totalCount,
    processed_count: processedCount,
    remaining_count: Math.max(0, totalCount - processedCount),
    completed: processedCount >= totalCount,
    ...extra,
  };
}

function chunkIds(ids: string[], batchSize: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    chunks.push(ids.slice(i, i + batchSize));
  }
  return chunks;
}

function stableProfileJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableProfileJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableProfileJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function autonomousPurgeProfile(args: Args, config: Config, candidateCount: number): Record<string, unknown> {
  const maxRows = Math.min(args.maxPurgeRows ?? args.limit, args.limit);
  const payload = {
    schema_version: "s129-autonomous-purge-profile-v1",
    enabled: args.autonomousPurgeEnabled,
    db_path: config.dbPath === ":memory:" ? ":memory:" : resolve(resolveHomePath(config.dbPath)),
    backup_path: args.backupPath ? resolve(resolveHomePath(args.backupPath)) : null,
    retention_days: args.retentionDays,
    max_rows: maxRows,
    minimum_free_bytes: args.minimumFreeBytes,
    legal_hold_exclusion: true,
  };
  const expectedHash = createHash("sha256").update(stableProfileJson(payload)).digest("hex");
  const suppliedHash = typeof args.profileHash === "string" ? args.profileHash.trim().toLowerCase() : "";
  const planOnlyReasons: string[] = [];
  if (!args.autonomousPurgeEnabled) planOnlyReasons.push("autonomous_purge_disabled");
  if (args.autonomousPurgeEnabled && !suppliedHash) planOnlyReasons.push("profile_hash_required");
  if (args.autonomousPurgeEnabled && suppliedHash && suppliedHash !== expectedHash) planOnlyReasons.push("profile_hash_mismatch");
  if (!args.backupPath || !args.backupSha256) planOnlyReasons.push("backup_required");
  return {
    ...payload,
    profile_hash: expectedHash,
    supplied_profile_hash: suppliedHash || null,
    candidate_count: candidateCount,
    can_execute_autonomously: args.autonomousPurgeEnabled && planOnlyReasons.length === 0,
    plan_only_reasons: planOnlyReasons,
  };
}

async function checkDaemonStoppedForExecute(args: Args, config: Config): Promise<Record<string, unknown>> {
  if (!args.execute) {
    return { checked: false, required: false };
  }
  const baseUrl = process.env.HARNESS_MEM_BASE_URL
    || process.env.HARNESS_MEM_URL
    || `http://${config.bindHost || "127.0.0.1"}:${config.bindPort || 8765}`;
  if (args.allowRunningDaemon) {
    return { checked: true, required: true, base_url: baseUrl, overridden: true };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 350);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health/ready`, { signal: controller.signal });
    if (response.ok) {
      throw new Error(`local daemon appears to be running at ${baseUrl}; stop it before --execute or pass --allow-running-daemon`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("local daemon appears")) {
      throw error;
    }
    return { checked: true, required: true, base_url: baseUrl, running: false };
  } finally {
    clearTimeout(timeout);
  }
  return { checked: true, required: true, base_url: baseUrl, running: false };
}

function auditOfflineCompact(core: HarnessMemCore, details: Record<string, unknown>): void {
  core.getRawDb()
    .query(`
      INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
      VALUES ('admin.vacuum.execute', 'offline-runner', 'database', '', ?, ?)
    `)
    .run(JSON.stringify(details), new Date().toISOString());
}

function backupRestoreDrill(backupPath: string | undefined): Record<string, unknown> {
  if (!backupPath) {
    return { checked: false, ok: false, error: "backup_path_required" };
  }
  let backupDb: Database | null = null;
  try {
    backupDb = new Database(resolve(resolveHomePath(backupPath)), { readonly: true });
    const row = backupDb.query(`PRAGMA quick_check`).get() as Record<string, string> | null;
    const result = row ? String(Object.values(row)[0] ?? "") : "";
    return {
      checked: true,
      ok: result === "ok",
      quick_check: result || null,
      error: result === "ok" ? null : "quick_check_failed",
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      quick_check: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      backupDb?.close();
    } catch {
      // best effort
    }
  }
}

function compactDatabase(core: HarnessMemCore, dbPath: string, details: Record<string, unknown>): Record<string, unknown> {
  const before = databaseSizeSnapshot(dbPath);
  const startedAt = Date.now();
  core.getRawDb().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  core.getRawDb().exec("VACUUM");
  core.getRawDb().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const afterVacuum = databaseSizeSnapshot(dbPath);
  const durationMs = Date.now() - startedAt;
  const totalBefore = typeof before.total_bytes === "number" ? before.total_bytes : null;
  const totalAfterVacuum = typeof afterVacuum.total_bytes === "number" ? afterVacuum.total_bytes : null;
  auditOfflineCompact(core, {
    ...details,
    before,
    after_vacuum: afterVacuum,
    duration_ms: durationMs,
    reclaimed_bytes: totalBefore !== null && totalAfterVacuum !== null ? Math.max(0, totalBefore - totalAfterVacuum) : null,
  });
  core.getRawDb().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const after = databaseSizeSnapshot(dbPath);
  const totalAfter = typeof after.total_bytes === "number" ? after.total_bytes : null;
  return {
    execute: true,
    before,
    after_vacuum: afterVacuum,
    after,
    duration_ms: durationMs,
    reclaimed_bytes: totalBefore !== null && totalAfter !== null ? Math.max(0, totalBefore - totalAfter) : null,
  };
}

function auditOfflineVectorPrune(core: HarnessMemCore, details: Record<string, unknown>): void {
  core.getRawDb()
    .query(`
      INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
      VALUES ('admin.vector_cache_prune.execute', 'offline-runner', 'mem_vectors', '', ?, ?)
    `)
    .run(JSON.stringify(details), new Date().toISOString());
}

function archiveRequest(args: Args): {
  project?: string;
  limit: number;
  score_threshold?: number;
  protect_accessed?: boolean;
} {
  return {
    project: args.project,
    limit: args.limit,
    score_threshold: args.scoreThreshold,
    protect_accessed: args.protectAccessed,
  };
}

function autonomyReport(
  core: HarnessMemCore,
  args: Args,
  input: {
    candidateIds?: string[];
    autonomyLevel: "L0_report" | "L1_reversible_archive" | "L2_derived_cache_prune" | "L3_guarded_purge" | "L4_compact";
    estimatedReclaimBytes?: number;
  },
): Record<string, unknown> {
  return core.adminForgetAutonomyReport({
    autonomy_level: input.autonomyLevel,
    candidate_ids: input.candidateIds ?? [],
    project: args.project,
    protect_accessed: args.protectAccessed,
    estimated_reclaim_bytes: input.estimatedReclaimBytes,
  }) as unknown as Record<string, unknown>;
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  let expectedSha = "";
  let backupStat: ReturnType<typeof statSync> | null = null;
  if (!args.archiveOnly) {
    expectedSha = args.backupSha256!.toLowerCase();
    const actualSha = await sha256File(args.backupPath!);
    if (actualSha !== expectedSha) {
      hardFail(`backup sha256 mismatch: expected=${expectedSha} actual=${actualSha}`);
    }
    backupStat = statSync(args.backupPath!);
  }
  const config = buildOfflineConfig(args);
  const daemonGuard = await checkDaemonStoppedForExecute(args, config);
  const checkpointPath = checkpointPathFor(args, config.dbPath);
  const core = new HarnessMemCore(config);
  try {
    const before = {
      active_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL`),
      archived_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL`),
      archive_archived: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'archived'`),
      archive_purged: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'purged'`),
    };
    if (args.archiveOnly) {
      const plan = core.adminForgetArchive(archiveRequest(args));
      if (!plan.ok) {
        hardFail(`archive plan failed: ${plan.error ?? "unknown"}`);
      }
      const archivePlanItem = firstItem(plan);
      const plannedCandidateIds = stringArray(archivePlanItem.candidate_ids);
      const planAutonomy = autonomyReport(core, args, {
        candidateIds: plannedCandidateIds,
        autonomyLevel: "L0_report",
      });
      if (!args.execute || Number(archivePlanItem.candidate_count ?? 0) === 0) {
        console.log(JSON.stringify({
          ok: true,
          mode: "offline_archive_only",
          execute: false,
          archive_first: true,
          ...planAutonomy,
          autonomy_report: planAutonomy,
          daemon_guard: daemonGuard,
          candidate_count: Number(archivePlanItem.candidate_count ?? 0),
          before,
          progress: progressEnvelope(
            args,
            "offline_archive_only",
            Number(archivePlanItem.candidate_count ?? 0),
            0,
            checkpointPath,
            { planned_batches: Math.ceil(Number(archivePlanItem.candidate_count ?? 0) / args.batchSize) },
          ),
          archive_plan: {
            manifest_sha256: archivePlanItem.manifest_sha256,
            candidate_count: archivePlanItem.candidate_count,
            cross_store_impact: archivePlanItem.cross_store_impact,
          },
          skipped: Number(archivePlanItem.candidate_count ?? 0) === 0 ? "no_archive_candidates" : "execute_required",
        }, null, 2));
        return;
      }

      const mode = "offline_archive_only";
      const checkpoint = readCheckpoint(checkpointPath, mode, args);
      let processedCount = checkpoint?.processed_count ?? 0;
      let archivedCount = 0;
      const executedBatches: Record<string, unknown>[] = [];
      const executedCandidateIds: string[] = [];
      const deadline = args.timeBudgetMs > 0 ? Date.now() + args.timeBudgetMs : Number.POSITIVE_INFINITY;
      let completed = false;
      while (processedCount < args.limit && Date.now() < deadline) {
        const batchLimit = Math.min(args.batchSize, args.limit - processedCount);
        const batchPlan = core.adminForgetArchive({ ...archiveRequest(args), limit: batchLimit });
        if (!batchPlan.ok) {
          hardFail(`archive batch plan failed: ${batchPlan.error ?? "unknown"}`);
        }
        const batchPlanItem = firstItem(batchPlan);
        const batchCandidateCount = Number(batchPlanItem.candidate_count ?? 0);
        if (batchCandidateCount === 0) {
          completed = true;
          break;
        }
        const executed = core.adminForgetArchive({
          ...archiveRequest(args),
          limit: batchLimit,
          execute: true,
          manifest_sha256: String(batchPlanItem.manifest_sha256 ?? ""),
          reason: args.reason.trim(),
        });
        if (!executed.ok) {
          hardFail(`archive execute failed: ${executed.error ?? "unknown"}`);
        }
        const archiveExecutedItem = firstItem(executed);
        const archivedIds = stringArray(archiveExecutedItem.archived_ids);
        archivedCount += Number(archiveExecutedItem.archived_count ?? archivedIds.length);
        executedCandidateIds.push(...archivedIds);
        processedCount += batchCandidateCount;
        const batch = {
          batch_index: executedBatches.length,
          candidate_count: batchCandidateCount,
          archived_count: Number(archiveExecutedItem.archived_count ?? archivedIds.length),
          manifest_sha256: archiveExecutedItem.manifest_sha256,
        };
        executedBatches.push(batch);
        writeCheckpoint(checkpointPath, {
          schema_version: "s129-offline-lifecycle-checkpoint-v1",
          mode,
          db_path: resolve(resolveHomePath(config.dbPath)),
          processed_count: processedCount,
          total_count: args.limit,
          completed: processedCount >= args.limit,
          updated_at: new Date().toISOString(),
          last_batch: batch,
        });
        if (batchCandidateCount < batchLimit) {
          completed = true;
          break;
        }
      }
      completed = completed || processedCount >= args.limit;
      const executedAutonomy = autonomyReport(core, args, {
        candidateIds: executedCandidateIds,
        autonomyLevel: "L1_reversible_archive",
      });
      const after = {
        active_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL`),
        archived_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL`),
        archive_archived: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'archived'`),
        archive_purged: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'purged'`),
      };
      console.log(JSON.stringify({
        ok: true,
        mode: "offline_archive_only",
        execute: true,
        archive_first: true,
        ...executedAutonomy,
        autonomy_report: executedAutonomy,
        daemon_guard: daemonGuard,
        candidate_count: executedCandidateIds.length,
        archive_executed: {
          archived_count: archivedCount,
          batches: executedBatches,
          restore_supported: archivedCount > 0,
        },
        before,
        after,
        progress: progressEnvelope(args, mode, args.limit, processedCount, checkpointPath, {
          completed,
          time_budget_exhausted: !completed && Date.now() >= deadline,
          batches: executedBatches,
        }),
        next_step: "create a backup of this post-archive database, then rerun without --archive-only to hard-purge archived rows",
      }, null, 2));
      return;
    }
    if (args.pruneStaleVectors) {
      const staleBefore = staleVectorRows(core, args.currentVectorModel);
      const vectorRowsBefore = vectorModelRows(core);
      const totalRows = staleBefore.reduce((sum, row) => sum + row.rows, 0);
      const totalBytes = staleBefore.reduce((sum, row) => sum + row.vector_json_bytes, 0);
      const autonomy = autonomyReport(core, args, {
        autonomyLevel: args.execute ? (args.compact ? "L4_compact" : "L2_derived_cache_prune") : "L0_report",
        estimatedReclaimBytes: totalBytes,
      });
      if (!args.execute || totalRows === 0) {
        console.log(JSON.stringify({
          ok: true,
          mode: "offline_prune_stale_vectors",
          execute: false,
          ...autonomy,
          autonomy_report: autonomy,
          daemon_guard: daemonGuard,
          current_vector_model: args.currentVectorModel,
          stale_vector_rows: staleBefore,
          removable_rows: totalRows,
          removable_vector_json_bytes: totalBytes,
          before,
          vector_rows_before: vectorRowsBefore,
          progress: progressEnvelope(args, "offline_prune_stale_vectors", totalRows, 0, checkpointPath, {
            planned_batches: Math.ceil(totalRows / args.batchSize),
          }),
          skipped: totalRows === 0 ? "no_stale_vectors_with_current_replacement" : "execute_required",
        }, null, 2));
        return;
      }

      core.getRawDb().exec("BEGIN IMMEDIATE");
      try {
        const result = core.getRawDb()
          .query(`
            DELETE FROM mem_vectors
            WHERE model <> ?
              AND EXISTS (
                SELECT 1
                FROM mem_vectors current
                WHERE current.observation_id = mem_vectors.observation_id
                  AND current.model = ?
              )
          `)
          .run(args.currentVectorModel, args.currentVectorModel) as { changes?: number };
        auditOfflineVectorPrune(core, {
          current_vector_model: args.currentVectorModel,
          deleted_rows: result.changes ?? totalRows,
          stale_vector_rows: staleBefore,
          backup_path: args.backupPath,
          backup_sha256: expectedSha,
          reason: args.reason,
        });
        core.getRawDb().exec("COMMIT");
      } catch (error) {
        core.getRawDb().exec("ROLLBACK");
        throw error;
      }

      const staleAfter = staleVectorRows(core, args.currentVectorModel);
      const vectorRowsAfter = vectorModelRows(core);
      const after = {
        active_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL`),
        archived_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL`),
        archive_archived: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'archived'`),
        archive_purged: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'purged'`),
        freelist_count: count(core, `SELECT freelist_count AS count FROM pragma_freelist_count`),
        page_size: count(core, `SELECT page_size AS count FROM pragma_page_size`),
      };
      const restoreDrill = args.compact ? backupRestoreDrill(args.backupPath) : null;
      if (args.compact && restoreDrill?.ok !== true) {
        hardFail(`restore drill failed before compact: ${String(restoreDrill?.error ?? "unknown")}`);
      }
      const compact = args.compact
        ? compactDatabase(core, config.dbPath, {
            mode: "offline_prune_stale_vectors",
            current_vector_model: args.currentVectorModel,
            backup_path: args.backupPath,
            backup_sha256: expectedSha,
            restore_drill: restoreDrill,
            reason: args.reason,
          })
        : null;
      console.log(JSON.stringify({
        ok: true,
        mode: "offline_prune_stale_vectors",
        execute: true,
        compact_requested: args.compact,
        ...autonomy,
        autonomy_report: autonomy,
        daemon_guard: daemonGuard,
        current_vector_model: args.currentVectorModel,
        deleted_rows_estimate: totalRows,
        deleted_vector_json_bytes_estimate: totalBytes,
        stale_vector_rows_before: staleBefore,
        stale_vector_rows_after: staleAfter,
        before,
        after,
        vector_rows_before: vectorRowsBefore,
        vector_rows_after: vectorRowsAfter,
        reclaimable_bytes_estimate: after.freelist_count * after.page_size,
        progress: progressEnvelope(args, "offline_prune_stale_vectors", totalRows, totalRows, checkpointPath),
        restore_drill: restoreDrill,
        compact,
        backup: {
          path: args.backupPath,
          sha256: expectedSha,
          size_bytes: backupStat!.size,
        },
      }, null, 2));
      return;
    }

    let archivePlanItem: Record<string, unknown> | null = null;
    let archiveExecutedItem: Record<string, unknown> | null = null;
    let candidateIds = selectArchivedCandidateIds(core, args.limit);
    if (args.archiveFirst) {
      const plan = core.adminForgetArchive(archiveRequest(args));
      if (!plan.ok) {
        hardFail(`archive plan failed: ${plan.error ?? "unknown"}`);
      }
      archivePlanItem = firstItem(plan);
      if (Number(archivePlanItem.candidate_count ?? 0) === 0) {
        const autonomy = autonomyReport(core, args, {
          candidateIds: stringArray(archivePlanItem.candidate_ids),
          autonomyLevel: "L0_report",
        });
        console.log(JSON.stringify({
          ok: true,
          mode: "offline_archive_first_hard_purge",
          execute: false,
          ...autonomy,
          autonomy_report: autonomy,
          daemon_guard: daemonGuard,
          candidate_count: 0,
          before,
          progress: progressEnvelope(args, "offline_archive_first_hard_purge", 0, 0, checkpointPath),
          archive_plan: archivePlanItem,
          skipped: "no_archive_candidates",
        }, null, 2));
        return;
      }
      if (!args.execute) {
        const autonomy = autonomyReport(core, args, {
          candidateIds: stringArray(archivePlanItem.candidate_ids),
          autonomyLevel: "L0_report",
        });
        console.log(JSON.stringify({
          ok: true,
          mode: "offline_archive_first_hard_purge",
          execute: false,
          archive_first: true,
          ...autonomy,
          autonomy_report: autonomy,
          daemon_guard: daemonGuard,
          candidate_count: Number(archivePlanItem.candidate_count ?? 0),
          before,
          progress: progressEnvelope(
            args,
            "offline_archive_first_hard_purge",
            Number(archivePlanItem.candidate_count ?? 0),
            0,
            checkpointPath,
            { planned_batches: Math.ceil(Number(archivePlanItem.candidate_count ?? 0) / args.batchSize) },
          ),
          archive_plan: {
            manifest_sha256: archivePlanItem.manifest_sha256,
            candidate_count: archivePlanItem.candidate_count,
            cross_store_impact: archivePlanItem.cross_store_impact,
          },
          hard_purge_planned: false,
          skipped: "archive_first_execute_required_before_hard_purge_plan",
        }, null, 2));
        return;
      }

      const executed = core.adminForgetArchive({
        ...archiveRequest(args),
        execute: true,
        manifest_sha256: String(archivePlanItem.manifest_sha256 ?? ""),
        reason: args.reason.trim(),
      });
      if (!executed.ok) {
        hardFail(`archive execute failed: ${executed.error ?? "unknown"}`);
      }
      archiveExecutedItem = firstItem(executed);
      candidateIds = stringArray(archiveExecutedItem.archived_ids);
    }
    if (candidateIds.length === 0) {
      const autonomy = autonomyReport(core, args, {
        autonomyLevel: "L0_report",
      });
      console.log(JSON.stringify({
        ok: true,
        mode: args.archiveFirst ? "offline_archive_first_hard_purge" : "offline_hard_purge_archived",
        execute: false,
        ...autonomy,
        autonomy_report: autonomy,
        daemon_guard: daemonGuard,
        candidate_count: 0,
        before,
        progress: progressEnvelope(
          args,
          args.archiveFirst ? "offline_archive_first_hard_purge" : "offline_hard_purge_archived",
          0,
          0,
          checkpointPath,
        ),
        skipped: "no_archived_candidates",
      }, null, 2));
      return;
    }
    if (args.autonomousPurgeEnabled) {
      const maxRows = Math.min(args.maxPurgeRows ?? args.limit, args.limit);
      candidateIds = candidateIds.slice(0, maxRows);
    }
    const purgeProfile = autonomousPurgeProfile(args, config, candidateIds.length);
    const autonomy = autonomyReport(core, args, {
      candidateIds,
      autonomyLevel: args.compact ? "L4_compact" : "L3_guarded_purge",
    });

    if (args.autonomousPurgeEnabled && args.execute && purgeProfile.can_execute_autonomously !== true) {
      console.log(JSON.stringify({
        ok: true,
        mode: args.archiveFirst ? "offline_archive_first_hard_purge" : "offline_hard_purge_archived",
        execute: false,
        requested_execute_rejected: true,
        archive_first: args.archiveFirst,
        compact_requested: args.compact,
        ...autonomy,
        autonomy_report: autonomy,
        daemon_guard: daemonGuard,
        autonomous_purge_profile: purgeProfile,
        candidate_count: candidateIds.length,
        candidate_ids: candidateIds,
        before,
        progress: progressEnvelope(
          args,
          args.archiveFirst ? "offline_archive_first_hard_purge" : "offline_hard_purge_archived",
          candidateIds.length,
          0,
          checkpointPath,
          { planned_batches: Math.ceil(candidateIds.length / Math.min(args.batchSize, 500)) },
        ),
        skipped: "autonomous_purge_profile_not_satisfied",
      }, null, 2));
      return;
    }

    const hardPurgeMode = args.archiveFirst ? "offline_archive_first_hard_purge" : "offline_hard_purge_archived";
    const hardPurgeBatchSize = Math.min(args.batchSize, 500);
    const hardPurgeBatches = chunkIds(candidateIds, hardPurgeBatchSize);
    const checkpoint = readCheckpoint(checkpointPath, hardPurgeMode, args);
    let processedCount = checkpoint?.processed_count ?? 0;
    const startBatchIndex = Math.floor(processedCount / hardPurgeBatchSize);
    const executedItems: Record<string, unknown>[] = [];
    const planBatches: Record<string, unknown>[] = [];
    const deadline = args.timeBudgetMs > 0 ? Date.now() + args.timeBudgetMs : Number.POSITIVE_INFINITY;
    let completed = false;
    let sampleEvidenceItem: Record<string, unknown> | null = null;
    let samplePlanItem: Record<string, unknown> | null = null;

    if (!args.execute) {
      const sampleIds = hardPurgeBatches[0] ?? [];
      const evidence = core.adminForgetBackupEvidence({
        backup_path: args.backupPath,
        backup_sha256: expectedSha,
        candidate_ids: sampleIds,
        ttl_seconds: 3600,
      });
      if (!evidence.ok) {
        hardFail(`backup evidence failed: ${evidence.error ?? "unknown"}`);
      }
      sampleEvidenceItem = firstItem(evidence);
      const token = String(sampleEvidenceItem.preverified_backup_evidence_token ?? "");
      if (!token) hardFail("backup evidence did not return a token");
      const plan = core.adminForgetHardPurge({
        target_ids: sampleIds,
        preverified_backup_evidence_token: token,
        retention_days: args.autonomousPurgeEnabled ? args.retentionDays : 0,
      });
      if (!plan.ok) {
        hardFail(`hard purge plan failed: ${plan.error ?? "unknown"}`);
      }
      samplePlanItem = firstItem(plan);
      planBatches.push({
        batch_index: 0,
        candidate_count: sampleIds.length,
        manifest_hash: samplePlanItem.manifest_hash,
        expires_at: samplePlanItem.expires_at,
      });
    } else {
      for (let batchIndex = startBatchIndex; batchIndex < hardPurgeBatches.length; batchIndex += 1) {
        if (Date.now() >= deadline) break;
        const batchIds = hardPurgeBatches[batchIndex];
        const evidence = core.adminForgetBackupEvidence({
          backup_path: args.backupPath,
          backup_sha256: expectedSha,
          candidate_ids: batchIds,
          ttl_seconds: 3600,
        });
        if (!evidence.ok) {
          hardFail(`backup evidence failed: ${evidence.error ?? "unknown"}`);
        }
        const evidenceItem = firstItem(evidence);
        const token = String(evidenceItem.preverified_backup_evidence_token ?? "");
        if (!token) hardFail("backup evidence did not return a token");
        const plan = core.adminForgetHardPurge({
          target_ids: batchIds,
          preverified_backup_evidence_token: token,
          retention_days: args.autonomousPurgeEnabled ? args.retentionDays : 0,
        });
        if (!plan.ok) {
          hardFail(`hard purge plan failed: ${plan.error ?? "unknown"}`);
        }
        const planItem = firstItem(plan);
        const executed = core.adminForgetHardPurge({
          target_ids: batchIds,
          execute: true,
          manifest_hash: String(planItem.manifest_hash ?? ""),
          manifest_expires_at: String(planItem.expires_at ?? ""),
          candidate_count: Number(planItem.candidate_count ?? 0),
          preverified_backup_evidence_token: token,
          retention_ack: true,
          archive_ack: true,
          confirmation: String(planItem.confirmation_phrase ?? ""),
        });
        if (!executed.ok) {
          hardFail(`hard purge execute failed: ${executed.error ?? "unknown"}`);
        }
        const executedItem = firstItem(executed);
        const batch = {
          batch_index: batchIndex,
          candidate_count: batchIds.length,
          purged_count: executedItem.purged_count,
          manifest_hash: planItem.manifest_hash,
          evidence_token_sha256: evidenceItem.token_sha256,
        };
        executedItems.push({ ...batch, executed: executedItem });
        processedCount += batchIds.length;
        writeCheckpoint(checkpointPath, {
          schema_version: "s129-offline-lifecycle-checkpoint-v1",
          mode: hardPurgeMode,
          db_path: resolve(resolveHomePath(config.dbPath)),
          processed_count: processedCount,
          total_count: candidateIds.length,
          completed: processedCount >= candidateIds.length,
          updated_at: new Date().toISOString(),
          last_batch: batch,
        });
      }
      completed = processedCount >= candidateIds.length;
    }

    const after = {
      active_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL`),
      archived_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL`),
      archive_archived: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'archived'`),
      archive_purged: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'purged'`),
      freelist_count: count(core, `SELECT freelist_count AS count FROM pragma_freelist_count`),
      page_size: count(core, `SELECT page_size AS count FROM pragma_page_size`),
    };
    const restoreDrill = args.compact && completed ? backupRestoreDrill(args.backupPath) : null;
    if (args.compact && completed && restoreDrill?.ok !== true) {
      hardFail(`restore drill failed before compact: ${String(restoreDrill?.error ?? "unknown")}`);
    }
    const compact = args.compact && (!args.execute || completed)
      ? compactDatabase(core, config.dbPath, {
          mode: hardPurgeMode,
          archive_first: args.archiveFirst,
          candidate_count: candidateIds.length,
          candidate_ids: candidateIds,
          backup_path: args.backupPath,
          backup_sha256: expectedSha,
          restore_drill: restoreDrill,
          reason: args.reason,
        })
      : null;

    console.log(JSON.stringify({
      ok: true,
      mode: hardPurgeMode,
      execute: args.execute,
      archive_first: args.archiveFirst,
      compact_requested: args.compact,
      ...autonomy,
      autonomy_report: autonomy,
      daemon_guard: daemonGuard,
      candidate_count: candidateIds.length,
      candidate_ids: candidateIds,
      autonomous_purge_profile: purgeProfile,
      archive_plan: archivePlanItem ? {
        manifest_sha256: archivePlanItem.manifest_sha256,
        candidate_count: archivePlanItem.candidate_count,
        cross_store_impact: archivePlanItem.cross_store_impact,
      } : null,
      archive_executed: archiveExecutedItem ? {
        manifest_sha256: archiveExecutedItem.manifest_sha256,
        candidate_count: archiveExecutedItem.candidate_count,
        archived_count: archiveExecutedItem.archived_count,
        skipped_legal_hold: archiveExecutedItem.skipped_legal_hold,
        skipped_already_archived: archiveExecutedItem.skipped_already_archived,
        restore_supported: archiveExecutedItem.restore_supported,
      } : null,
      backup: {
        path: args.backupPath,
        sha256: expectedSha,
        size_bytes: backupStat!.size,
      },
      evidence: sampleEvidenceItem ? {
        token_sha256: sampleEvidenceItem.token_sha256,
        candidate_coverage_sha256: sampleEvidenceItem.candidate_coverage_sha256,
        integrity_check: sampleEvidenceItem.integrity_check,
        expires_at: sampleEvidenceItem.expires_at,
      } : null,
      plan: {
        batch_size: hardPurgeBatchSize,
        batch_count: hardPurgeBatches.length,
        candidate_count: candidateIds.length,
        sample_batch: samplePlanItem ? {
          manifest_hash: samplePlanItem.manifest_hash,
          expires_at: samplePlanItem.expires_at,
          candidate_count: samplePlanItem.candidate_count,
          backup: samplePlanItem.backup,
          archive: samplePlanItem.archive,
        } : null,
        batches: planBatches,
      },
      executed: args.execute ? {
        batch_count: executedItems.length,
        batches: executedItems,
      } : null,
      before,
      after,
      reclaimable_bytes_estimate: after.freelist_count * after.page_size,
      progress: progressEnvelope(args, hardPurgeMode, candidateIds.length, processedCount, checkpointPath, {
        completed: args.execute ? completed : false,
        planned_batches: hardPurgeBatches.length,
        executed_batches: executedItems.length,
        time_budget_exhausted: args.execute && !completed && Date.now() >= deadline,
      }),
      restore_drill: restoreDrill,
      compact,
    }, null, 2));
  } finally {
    core.shutdown("offline-runner");
  }
}

main().catch((error) => {
  hardFail(error instanceof Error ? error.message : String(error));
});
