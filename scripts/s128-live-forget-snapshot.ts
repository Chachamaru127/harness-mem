#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runForgetPolicy } from "../memory-server/src/consolidation/forget-policy";

type Args = {
  db: string;
  json: string;
  md: string;
  limit: number;
  backupPath?: string;
  daemonUrl: string;
};

type CountRow = { count: number };
type LifecycleCounts = {
  observations: number;
  archived: number;
  expired: number;
  legal_hold: number;
  audit_log: number | null;
};
type Probe = Record<string, unknown>;

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) continue;
    const key = entry.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    index += 1;
  }

  const db = args.db ?? `${process.env.HOME}/.harness-mem/harness-mem.db`;
  const json = args.json ?? "docs/ops/s128-live-db-forget-snapshot-2026-05-20.json";
  const md = args.md ?? "docs/ops/s128-live-db-forget-snapshot-2026-05-20.md";
  const limit = Number.parseInt(args.limit ?? "1000", 10);
  return {
    db: resolve(db.replace(/^~(?=$|\/)/, process.env.HOME ?? "~")),
    json,
    md,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 1000,
    backupPath: args["backup-path"] ? resolve(args["backup-path"]) : undefined,
    daemonUrl: (args["daemon-url"] ?? "http://127.0.0.1:37888").replace(/\/$/, ""),
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1`)
    .get(name) as { present: number } | null;
  return !!row;
}

function count(db: Database, sql: string, values: unknown[] = []): number {
  const row = db.query(sql).get(...(values as never[])) as CountRow | null;
  return Number(row?.count ?? 0);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function lifecycleCounts(db: Database): LifecycleCounts {
  return {
    observations: count(db, "SELECT COUNT(*) AS count FROM mem_observations"),
    archived: count(db, "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL"),
    expired: count(
      db,
      "SELECT COUNT(*) AS count FROM mem_observations WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')"
    ),
    legal_hold: count(
      db,
      "SELECT COUNT(*) AS count FROM mem_observations WHERE privacy_tags_json LIKE '%legal_hold%' OR tags_json LIKE '%legal_hold%'"
    ),
    audit_log: tableExists(db, "mem_audit_log") ? count(db, "SELECT COUNT(*) AS count FROM mem_audit_log") : null,
  };
}

function contentCountsUnchanged(before: LifecycleCounts, after: LifecycleCounts): boolean {
  return before.observations === after.observations
    && before.archived === after.archived
    && before.expired === after.expired
    && before.legal_hold === after.legal_hold;
}

function countSqliteVecMapRows(db: Database, ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const tables = db
    .query<{ name: string }, []>(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND (name = 'mem_vectors_vec_map' OR name LIKE 'mem_vectors_vec_map_%')`
    )
    .all()
    .filter((row) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name));

  let total = 0;
  for (const table of tables) {
    total += count(db, `SELECT COUNT(*) AS count FROM "${table.name}" WHERE observation_id IN (${placeholders})`, ids);
  }
  return total;
}

function impactForIds(db: Database, ids: string[]): Record<string, number> {
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
    mem_archive_stubs: 0,
    mem_archive_full: 0,
  };
  if (ids.length === 0) return empty;
  const placeholders = ids.map(() => "?").join(", ");
  return {
    observations: ids.length,
    mem_vectors: count(db, `SELECT COUNT(*) AS count FROM mem_vectors WHERE observation_id IN (${placeholders})`, ids),
    mem_links_touching: count(
      db,
      `SELECT COUNT(*) AS count FROM mem_links WHERE from_observation_id IN (${placeholders}) OR to_observation_id IN (${placeholders})`,
      [...ids, ...ids]
    ),
    mem_relations: count(db, `SELECT COUNT(*) AS count FROM mem_relations WHERE observation_id IN (${placeholders})`, ids),
    mem_facts: count(db, `SELECT COUNT(*) AS count FROM mem_facts WHERE observation_id IN (${placeholders})`, ids),
    mem_events: count(db, `SELECT COUNT(*) AS count FROM mem_events WHERE observation_id IN (${placeholders})`, ids),
    mem_tags: count(db, `SELECT COUNT(*) AS count FROM mem_tags WHERE observation_id IN (${placeholders})`, ids),
    mem_observation_entities: count(
      db,
      `SELECT COUNT(*) AS count FROM mem_observation_entities WHERE observation_id IN (${placeholders})`,
      ids
    ),
    mem_nuggets: count(db, `SELECT COUNT(*) AS count FROM mem_nuggets WHERE observation_id IN (${placeholders})`, ids),
    mem_nugget_vectors: count(
      db,
      `SELECT COUNT(*) AS count FROM mem_nugget_vectors WHERE observation_id IN (${placeholders})`,
      ids
    ),
    mem_vectors_vec_map: countSqliteVecMapRows(db, ids),
    mem_archive_stubs: tableExists(db, "mem_archive_stubs")
      ? count(db, `SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE observation_id IN (${placeholders})`, ids)
      : 0,
    mem_archive_full: tableExists(db, "mem_archive_stubs") && tableExists(db, "mem_archive_full")
      ? count(
        db,
        `SELECT COUNT(*) AS count
         FROM mem_archive_full f
         JOIN mem_archive_stubs s ON s.archive_id = f.archive_id
         WHERE s.observation_id IN (${placeholders})`,
        ids
      )
      : 0,
  };
}

function scoreSummary(candidates: Array<{ score: number }>): Record<string, number | null> {
  if (candidates.length === 0) return { min: null, max: null, avg: null };
  const scores = candidates.map((candidate) => candidate.score);
  const sum = scores.reduce((acc, score) => acc + score, 0);
  return {
    min: Math.min(...scores),
    max: Math.max(...scores),
    avg: Math.round((sum / scores.length) * 10000) / 10000,
  };
}

function topProjects(candidates: Array<{ project: string }>): Array<{ project_hash: string; count: number }> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const projectHash = `project_${shortHash(candidate.project)}`;
    counts.set(projectHash, (counts.get(projectHash) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([projectHash, countValue]) => ({ project_hash: projectHash, count: countValue }))
    .sort((a, b) => b.count - a.count || a.project_hash.localeCompare(b.project_hash))
    .slice(0, 20);
}

function sampleCandidates(
  candidates: Array<{
    observation_id: string;
    project: string;
    score: number;
    factors: Record<string, number>;
    age_days: number;
    access_count: number;
    signal_score: number;
  }>
): Array<Record<string, unknown>> {
  return candidates.slice(0, 100).map((candidate) => ({
    candidate_hash: `obs_${shortHash(candidate.observation_id)}`,
    project_hash: `project_${shortHash(candidate.project)}`,
    score: candidate.score,
    factors: candidate.factors,
    age_days: candidate.age_days,
    access_count: candidate.access_count,
    signal_score: candidate.signal_score,
  }));
}

async function probeJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    const text = await response.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeProbe(kind: "health" | "metrics" | "forget_plan", probe: Probe): Probe {
  const base: Probe = { ok: probe.ok, status: probe.status };
  if (probe.error) {
    return { ...base, error: probe.error };
  }
  const body = probe.body as Record<string, unknown> | string | null;
  if (typeof body === "string" || body === null) {
    return { ...base, body };
  }
  const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  const first = items[0] ?? {};

  if (kind === "health") {
    return {
      ...base,
      service_status: first.status,
      pid: first.pid,
      backend_mode: first.backend_mode,
      vector_engine: first.vector_engine,
      vector_model: first.vector_model,
      embedding_provider_status: first.embedding_provider_status,
      counts_status: first.counts_status,
      latency_ms: meta.latency_ms,
    };
  }

  if (kind === "metrics") {
    return {
      ...base,
      coverage: first.coverage,
      retry_queue: first.retry_queue,
      consolidation_queue: first.consolidation_queue,
      facts: first.facts,
      latency_ms: meta.latency_ms,
    };
  }

  return {
    ...base,
    candidate_count: meta.candidate_count,
    scanned: meta.scanned,
    ranking: meta.ranking,
    safety: (first.safety ?? null) as unknown,
    hard_delete_supported: first.hard_delete_supported,
    latency_ms: meta.latency_ms,
  };
}

async function backupInfo(path?: string): Promise<Record<string, unknown> | null> {
  if (!path) return null;
  const sizeBytes = fileSize(path);
  let integrity = { checked: false, ok: false, result: null as string | null, error: null as string | null };
  try {
    const backupDb = new Database(path, { readonly: true });
    try {
      const row = backupDb.query(`PRAGMA integrity_check`).get() as Record<string, string> | null;
      const result = row ? String(Object.values(row)[0] ?? "") : "";
      integrity = { checked: true, ok: result === "ok", result: result || null, error: null };
    } finally {
      backupDb.close();
    }
  } catch (error) {
    integrity = {
      checked: true,
      ok: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    path,
    exists: existsSync(path),
    size_bytes: sizeBytes,
    sha256: existsSync(path) ? await sha256File(path) : null,
    integrity_check: integrity,
  };
}

function formatBytes(value: number | null): string {
  if (value === null) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let unit = units[0];
  for (let index = 0; index < units.length - 1 && n >= 1024; index += 1) {
    n /= 1024;
    unit = units[index + 1];
  }
  return `${Math.round(n * 10) / 10} ${unit}`;
}

function writeOutputs(jsonPath: string, mdPath: string, snapshot: Record<string, unknown>): void {
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const dbInfo = snapshot.db as Record<string, unknown>;
  const plan = snapshot.forget_plan as Record<string, unknown>;
  const impact = snapshot.cross_store_impact as Record<string, number>;
  const backup = snapshot.backup as Record<string, unknown> | null;
  const readiness = snapshot.hard_purge_readiness as Record<string, unknown>;
  const topProjectRows = (plan.top_projects as Array<Record<string, unknown>> | undefined) ?? [];
  const daemon = snapshot.daemon as Record<string, unknown>;
  const daemonHealth = daemon.health as Record<string, unknown>;
  const daemonMetrics = daemon.metrics as Record<string, unknown>;
  const forgetPlanEndpoint = daemon.forget_plan_endpoint as Record<string, unknown>;
  const hardPurgeEndpoint = daemon.hard_purge_endpoint as Record<string, unknown>;

  const lines = [
    "# S128 Live DB Forget Snapshot",
    "",
    `- generated_at: ${snapshot.generated_at}`,
    `- db_path: ${dbInfo.path}`,
    `- db_size: ${formatBytes(dbInfo.size_bytes as number | null)}`,
    `- wal_size: ${formatBytes(dbInfo.wal_size_bytes as number | null)}`,
    `- open_mode: readonly for plan snapshot`,
    "",
    "## Plan Summary",
    "",
    `- observations: ${dbInfo.observations}`,
    `- archived: ${dbInfo.archived}`,
    `- expired: ${dbInfo.expired}`,
    `- legal_hold: ${dbInfo.legal_hold}`,
    `- mutation_check: ${dbInfo.mutation_check}`,
    `- audit_log_drift_check: ${dbInfo.audit_log_drift_check}`,
    `- live_probe_drift_check: ${dbInfo.live_probe_drift_check}`,
    `- live_probe_audit_log_drift_check: ${dbInfo.live_probe_audit_log_drift_check}`,
    `- dry_run_candidate_count: ${plan.candidate_count}`,
    `- scanned: ${plan.scanned}`,
    `- score_summary: ${JSON.stringify(plan.score_summary)}`,
    "",
    "## Top Candidate Projects",
    "",
    ...topProjectRows.slice(0, 10).map((row) => `- ${row.project_hash}: ${row.count}`),
    "",
    "## Cross Store Impact",
    "",
    ...Object.entries(impact).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Daemon Probe",
    "",
    `- health: ${JSON.stringify(daemonHealth)}`,
    `- metrics: ${JSON.stringify(daemonMetrics)}`,
    `- forget_plan_endpoint: ${JSON.stringify(forgetPlanEndpoint)}`,
    `- hard_purge_endpoint: ${JSON.stringify(hardPurgeEndpoint)}`,
    "",
    "## Backup",
    "",
    backup
      ? `- path: ${backup.path}\n- size: ${formatBytes(backup.size_bytes as number | null)}\n- sha256: ${backup.sha256}\n- integrity_check: ${JSON.stringify(backup.integrity_check)}`
      : "- not yet attached",
    backup ? "- creation_method: operator-created WAL-safe backup; this script validates the supplied backup artifact" : "",
    "",
    "## Hard Purge Readiness",
    "",
    `- execute_ready: ${readiness.execute_ready}`,
    `- blockers: ${JSON.stringify(readiness.blockers)}`,
    "",
    "## Next Decision",
    "",
    "This artifact is a plan-only snapshot. It does not archive or hard-purge live rows.",
    "If disk reclamation is still desired, the next step is to decide whether to create restore-capable archive rows for selected candidates before any execute attempt.",
    "",
  ];
  writeFileSync(mdPath, `${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.db, { readonly: true });
  try {
    const beforeCounts = lifecycleCounts(db);
    const plan = runForgetPolicy(db, { dry_run: true, limit: args.limit });
    const candidateIds = plan.candidates.map((candidate) => candidate.observation_id);
    const impact = impactForIds(db, candidateIds);
    const afterLocalPlanCounts = lifecycleCounts(db);

    const endpointProbeBody = JSON.stringify({ limit: 1 });
    const healthProbe = await probeJson(`${args.daemonUrl}/health`);
    const metricsProbe = await probeJson(`${args.daemonUrl}/v1/admin/metrics`);
    const forgetPlanProbe = await probeJson(`${args.daemonUrl}/v1/admin/forget/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: endpointProbeBody,
    });
    const daemon = {
      url: args.daemonUrl,
      health: summarizeProbe("health", healthProbe),
      metrics: summarizeProbe("metrics", metricsProbe),
      forget_plan_endpoint: summarizeProbe("forget_plan", forgetPlanProbe),
      hard_purge_endpoint: {
        skipped: true,
        reason: "plan-only boundary: do not POST to hard-purge because prepare mode can generate a confirmation phrase",
      },
    };
    const afterProbeCounts = lifecycleCounts(db);
    const localPlanContentUnchanged = contentCountsUnchanged(beforeCounts, afterLocalPlanCounts);
    const liveProbeContentDrifted = !contentCountsUnchanged(afterLocalPlanCounts, afterProbeCounts);
    const localAuditDrifted = beforeCounts.audit_log !== afterLocalPlanCounts.audit_log;
    const probeAuditDrifted = afterLocalPlanCounts.audit_log !== afterProbeCounts.audit_log;
    const snapshot = {
      generated_at: new Date().toISOString(),
      db: {
        path: args.db,
        size_bytes: fileSize(args.db),
        wal_size_bytes: fileSize(`${args.db}-wal`),
        shm_size_bytes: fileSize(`${args.db}-shm`),
        observations: beforeCounts.observations,
        observations_after_plan: afterLocalPlanCounts.observations,
        archived: beforeCounts.archived,
        expired: beforeCounts.expired,
        legal_hold: beforeCounts.legal_hold,
        readonly_probe_counts_before: beforeCounts,
        readonly_probe_counts_after_local_plan: afterLocalPlanCounts,
        readonly_probe_counts_after_daemon_probe: afterProbeCounts,
        mutation_check: localPlanContentUnchanged ? "content_unchanged" : "content_changed",
        audit_log_drift_check: localAuditDrifted ? "changed" : "unchanged",
        live_probe_drift_check: liveProbeContentDrifted ? "content_changed" : "content_unchanged",
        live_probe_audit_log_drift_check: probeAuditDrifted ? "changed" : "unchanged",
        archive_tables: {
          mem_archive_stubs: tableExists(db, "mem_archive_stubs"),
          mem_archive_full: tableExists(db, "mem_archive_full"),
        },
      },
      daemon,
      forget_plan: {
        dry_run: plan.dry_run,
        evicted: plan.evicted,
        scanned: plan.scanned,
        candidate_count: plan.candidates.length,
        limit: args.limit,
        score_threshold: plan.score_threshold,
        weights: plan.weights,
        score_summary: scoreSummary(plan.candidates),
        top_projects: topProjects(plan.candidates),
        sample_candidates: sampleCandidates(plan.candidates),
        redaction: {
          project_names: "sha256-16 project hashes only",
          observation_ids: "sha256-16 candidate hashes only",
          content: "omitted",
        },
      },
      cross_store_impact: impact,
      backup: await backupInfo(args.backupPath),
      hard_purge_readiness: {
        execute_ready: false,
        blockers: [
          "live execute not requested",
          "forget candidates are dry-run soft-archive candidates, not restore-capable hard-purge candidates",
          tableExists(db, "mem_archive_stubs") ? null : "mem_archive_stubs table is absent",
          tableExists(db, "mem_archive_full") ? null : "mem_archive_full table is absent",
          count(db, "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL") > 0
            ? null
            : "no archived observations currently exist",
        ].filter(Boolean),
      },
    };

    writeOutputs(args.json, args.md, snapshot);
    console.log(JSON.stringify({
      ok: true,
      json: args.json,
      md: args.md,
      db_path: args.db,
      candidate_count: plan.candidates.length,
      backup_attached: !!args.backupPath,
    }, null, 2));
  } finally {
    db.close();
  }
}

await main();
