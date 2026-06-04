import { type Database } from "bun:sqlite";
import { clampLimit } from "../core/core-utils.js";

const DEFAULT_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SearchDbMaintenanceResult {
  ran: boolean;
  reason: string;
  duration_ms?: number;
  fts_enabled?: boolean;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function lastMaintenanceAt(db: Database): string | null {
  try {
    const row = db
      .query(
        `SELECT created_at AS created_at
         FROM mem_audit_log
         WHERE action = 'admin.search_db_maintenance'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get() as { created_at?: string } | null;
    return typeof row?.created_at === "string" ? row.created_at : null;
  } catch {
    return null;
  }
}

export function runSearchDbMaintenanceIfDue(
  db: Database,
  options: {
    ftsEnabled?: boolean;
    writeAudit?: (action: string, targetType: string, targetId: string, details: Record<string, unknown>) => void;
    nowMs?: number;
    force?: boolean;
  } = {},
): SearchDbMaintenanceResult {
  const nowMs = options.nowMs ?? Date.now();
  const intervalMs = clampLimit(
    parsePositiveInt(process.env.HARNESS_MEM_SEARCH_MAINTENANCE_INTERVAL_MS, DEFAULT_MAINTENANCE_INTERVAL_MS),
    DEFAULT_MAINTENANCE_INTERVAL_MS,
    60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
  );
  const lastAt = lastMaintenanceAt(db);
  if (!options.force && lastAt) {
    const lastMs = Date.parse(lastAt);
    if (Number.isFinite(lastMs) && nowMs - lastMs < intervalMs) {
      return { ran: false, reason: "interval_not_elapsed" };
    }
  }

  const startedAt = performance.now();
  const ftsEnabled = options.ftsEnabled !== false;
  try {
    db.exec("ANALYZE mem_observations;");
    if (ftsEnabled) {
      db.exec("ANALYZE mem_observations_fts;");
      db.exec("INSERT INTO mem_observations_fts(mem_observations_fts) VALUES('optimize');");
    }
  } catch (error) {
    return {
      ran: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  try {
    options.writeAudit?.("admin.search_db_maintenance", "database", "", {
      duration_ms: durationMs,
      fts_enabled: ftsEnabled,
      interval_ms: intervalMs,
    });
  } catch {
    // best effort
  }

  return {
    ran: true,
    reason: "completed",
    duration_ms: durationMs,
    fts_enabled: ftsEnabled,
  };
}
