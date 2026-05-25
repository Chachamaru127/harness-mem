#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
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

function auditOfflineCompact(core: HarnessMemCore, details: Record<string, unknown>): void {
  core.getRawDb()
    .query(`
      INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
      VALUES ('admin.vacuum.execute', 'offline-runner', 'database', '', ?, ?)
    `)
    .run(JSON.stringify(details), new Date().toISOString());
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
      if (!args.execute || Number(archivePlanItem.candidate_count ?? 0) === 0) {
        console.log(JSON.stringify({
          ok: true,
          mode: "offline_archive_only",
          execute: false,
          archive_first: true,
          candidate_count: Number(archivePlanItem.candidate_count ?? 0),
          before,
          archive_plan: {
            manifest_sha256: archivePlanItem.manifest_sha256,
            candidate_count: archivePlanItem.candidate_count,
            cross_store_impact: archivePlanItem.cross_store_impact,
          },
          skipped: Number(archivePlanItem.candidate_count ?? 0) === 0 ? "no_archive_candidates" : "execute_required",
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
      const archiveExecutedItem = firstItem(executed);
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
        candidate_count: Number(archiveExecutedItem.candidate_count ?? 0),
        archive_executed: {
          manifest_sha256: archiveExecutedItem.manifest_sha256,
          candidate_count: archiveExecutedItem.candidate_count,
          archived_count: archiveExecutedItem.archived_count,
          skipped_legal_hold: archiveExecutedItem.skipped_legal_hold,
          skipped_already_archived: archiveExecutedItem.skipped_already_archived,
          restore_supported: archiveExecutedItem.restore_supported,
        },
        before,
        after,
        next_step: "create a backup of this post-archive database, then rerun without --archive-only to hard-purge archived rows",
      }, null, 2));
      return;
    }
    if (args.pruneStaleVectors) {
      const staleBefore = staleVectorRows(core, args.currentVectorModel);
      const vectorRowsBefore = vectorModelRows(core);
      const totalRows = staleBefore.reduce((sum, row) => sum + row.rows, 0);
      const totalBytes = staleBefore.reduce((sum, row) => sum + row.vector_json_bytes, 0);
      if (!args.execute || totalRows === 0) {
        console.log(JSON.stringify({
          ok: true,
          mode: "offline_prune_stale_vectors",
          execute: false,
          current_vector_model: args.currentVectorModel,
          stale_vector_rows: staleBefore,
          removable_rows: totalRows,
          removable_vector_json_bytes: totalBytes,
          before,
          vector_rows_before: vectorRowsBefore,
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
      const compact = args.compact
        ? compactDatabase(core, config.dbPath, {
            mode: "offline_prune_stale_vectors",
            current_vector_model: args.currentVectorModel,
            backup_path: args.backupPath,
            backup_sha256: expectedSha,
            reason: args.reason,
          })
        : null;
      console.log(JSON.stringify({
        ok: true,
        mode: "offline_prune_stale_vectors",
        execute: true,
        compact_requested: args.compact,
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
        console.log(JSON.stringify({
          ok: true,
          mode: "offline_archive_first_hard_purge",
          execute: false,
          candidate_count: 0,
          before,
          archive_plan: archivePlanItem,
          skipped: "no_archive_candidates",
        }, null, 2));
        return;
      }
      if (!args.execute) {
        console.log(JSON.stringify({
          ok: true,
          mode: "offline_archive_first_hard_purge",
          execute: false,
          archive_first: true,
          candidate_count: Number(archivePlanItem.candidate_count ?? 0),
          before,
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
      console.log(JSON.stringify({
        ok: true,
        mode: args.archiveFirst ? "offline_archive_first_hard_purge" : "offline_hard_purge_archived",
        execute: false,
        candidate_count: 0,
        before,
        skipped: "no_archived_candidates",
      }, null, 2));
      return;
    }

    const evidence = core.adminForgetBackupEvidence({
      backup_path: args.backupPath,
      backup_sha256: expectedSha,
      candidate_ids: candidateIds,
      ttl_seconds: 3600,
    });
    if (!evidence.ok) {
      hardFail(`backup evidence failed: ${evidence.error ?? "unknown"}`);
    }
    const evidenceItem = firstItem(evidence);
    const token = String(evidenceItem.preverified_backup_evidence_token ?? "");
    if (!token) hardFail("backup evidence did not return a token");

    const plan = core.adminForgetHardPurge({
      target_ids: candidateIds,
      preverified_backup_evidence_token: token,
      retention_days: 0,
    });
    if (!plan.ok) {
      hardFail(`hard purge plan failed: ${plan.error ?? "unknown"}`);
    }
    const planItem = firstItem(plan);

    let executed: ApiResponse | null = null;
    if (args.execute) {
      executed = core.adminForgetHardPurge({
        target_ids: candidateIds,
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
    }

    const after = {
      active_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL`),
      archived_observations: count(core, `SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL`),
      archive_archived: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'archived'`),
      archive_purged: count(core, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'purged'`),
      freelist_count: count(core, `SELECT freelist_count AS count FROM pragma_freelist_count`),
      page_size: count(core, `SELECT page_size AS count FROM pragma_page_size`),
    };
    const compact = args.compact
      ? compactDatabase(core, config.dbPath, {
          mode: args.archiveFirst ? "offline_archive_first_hard_purge" : "offline_hard_purge_archived",
          archive_first: args.archiveFirst,
          candidate_count: candidateIds.length,
          candidate_ids: candidateIds,
          backup_path: args.backupPath,
          backup_sha256: expectedSha,
          reason: args.reason,
        })
      : null;

    console.log(JSON.stringify({
      ok: true,
      mode: args.archiveFirst ? "offline_archive_first_hard_purge" : "offline_hard_purge_archived",
      execute: args.execute,
      archive_first: args.archiveFirst,
      compact_requested: args.compact,
      candidate_count: candidateIds.length,
      candidate_ids: candidateIds,
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
      evidence: {
        token_sha256: evidenceItem.token_sha256,
        candidate_coverage_sha256: evidenceItem.candidate_coverage_sha256,
        integrity_check: evidenceItem.integrity_check,
        expires_at: evidenceItem.expires_at,
      },
      plan: {
        manifest_hash: planItem.manifest_hash,
        expires_at: planItem.expires_at,
        candidate_count: planItem.candidate_count,
        backup: planItem.backup,
        archive: planItem.archive,
      },
      executed: executed ? firstItem(executed) : null,
      before,
      after,
      reclaimable_bytes_estimate: after.freelist_count * after.page_size,
      compact,
    }, null, 2));
  } finally {
    core.shutdown("offline-runner");
  }
}

main().catch((error) => {
  hardFail(error instanceof Error ? error.message : String(error));
});
