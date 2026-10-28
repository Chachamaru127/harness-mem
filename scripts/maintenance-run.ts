#!/usr/bin/env bun
/**
 * Scheduled forget-maintenance runner.
 *
 * Four jobs, each safe by default:
 *   hourly-archive  Ensure the triage-driven archive loop is running.
 *   weekly-monitor  Read-only health/capacity report. Never writes to the DB.
 *   weekly-purge    Report purge eligibility. Executes only with backup evidence.
 *   monthly-vacuum  Report reclaimable space. Executes only with backup evidence,
 *                   and stops the daemon for the duration of VACUUM.
 *
 * Usage:
 *   bun run scripts/maintenance-run.ts --job weekly-monitor
 *   bun run scripts/maintenance-run.ts --job hourly-archive --execute
 *   bun run scripts/maintenance-run.ts --job weekly-purge --retention-days 7
 *   bun run scripts/maintenance-run.ts --job weekly-purge --execute \
 *     --backup-path ~/.harness-mem/backups/...db --backup-sha256 <64 hex>
 *
 * Defaults are report-only. Irreversible work (hard purge) and service-stopping
 * work (VACUUM) require both --execute and an existing backup file whose sha256
 * matches --backup-sha256.
 */
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type Job = "hourly-archive" | "weekly-monitor" | "weekly-purge" | "monthly-vacuum";

type Args = {
  job: Job;
  execute: boolean;
  json: boolean;
  stateDir: string;
  dbPath: string;
  limit: number;
  retentionDays: number;
  batchSize: number;
  backupPath?: string;
  backupSha256?: string;
  notify: "off" | "alerts" | "always";
  healthUrl: string;
  repoRoot: string;
};

const JOBS: Job[] = ["hourly-archive", "weekly-monitor", "weekly-purge", "monthly-vacuum"];

function usage(code: number): never {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write([
    "Usage: bun run scripts/maintenance-run.ts --job <job> [options]",
    "",
    "Jobs:",
    "  hourly-archive   Keep the archive loop running (skips when one is already up).",
    "  weekly-monitor   Read-only capacity/health report. Exit 2 on an alert.",
    "  weekly-purge     Purge eligibility report. --execute needs backup evidence.",
    "  monthly-vacuum   Reclaim file space. --execute needs backup evidence and",
    "                   stops the daemon (offline-stop) for the VACUUM.",
    "",
    "Options:",
    "  --execute                 Run the job instead of reporting the plan.",
    "  --json                    Print the report as JSON.",
    "  --state-dir <path>        Default: $HARNESS_MEM_HOME or ~/.harness-mem",
    "  --db-path <path>          Default: <state-dir>/harness-mem.db",
    "  --limit <n>               Purge candidates per run (1..5000, default 500).",
    "  --retention-days <n>      Minimum days since archived_at (default 7).",
    "  --batch-size <n>          Purge transaction size (1..1000, default 100).",
    "  --backup-path <path>      Required with --execute for purge and vacuum.",
    "  --backup-sha256 <hex>     Required with --execute for purge and vacuum.",
    "  --health-url <url|off>    Health endpoint to probe (default local daemon).",
    "                            'off' skips the probe, for monitoring another DB.",
    "  --notify <mode>           off | alerts | always (default alerts). A macOS",
    "                            notification is posted through osascript.",
    "  --help                    Show this help.",
    "",
    "Env:",
    "  HARNESS_MEM_MAINTENANCE_DB_MAX_BYTES   Monitor alert threshold (default 24GiB).",
    "  HARNESS_MEM_MAINTENANCE_FREELIST_MAX_BYTES",
    "                                         Monitor alert threshold (default 4GiB).",
    "",
  ].join("\n"));
  process.exit(code);
}

function repoRootFromScript(): string {
  return resolve(import.meta.dir, "..");
}

function parseArgs(argv: string[]): Args {
  const stateDir = process.env.HARNESS_MEM_HOME || join(homedir(), ".harness-mem");
  const args: Args = {
    job: "weekly-monitor",
    execute: false,
    json: false,
    stateDir,
    dbPath: process.env.HARNESS_MEM_DB_PATH || join(stateDir, "harness-mem.db"),
    limit: 500,
    retentionDays: 7,
    batchSize: 100,
    notify: "alerts",
    healthUrl: "",  // empty means http://127.0.0.1:<port>/health/ready
    repoRoot: repoRootFromScript(),
  };
  let jobGiven = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--job") {
      const value = argv[++i];
      if (!JOBS.includes(value as Job)) {
        throw new Error(`--job must be one of: ${JOBS.join(", ")}`);
      }
      args.job = value as Job;
      jobGiven = true;
    } else if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--state-dir") {
      args.stateDir = argv[++i];
    } else if (arg === "--db-path") {
      args.dbPath = argv[++i];
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (arg === "--retention-days") {
      args.retentionDays = Number(argv[++i]);
    } else if (arg === "--batch-size") {
      args.batchSize = Number(argv[++i]);
    } else if (arg === "--health-url") {
      args.healthUrl = (argv[++i] || "").trim();
    } else if (arg === "--notify") {
      const value = (argv[++i] || "").trim();
      if (value !== "off" && value !== "alerts" && value !== "always") {
        throw new Error("--notify must be off, alerts, or always");
      }
      args.notify = value;
    } else if (arg === "--backup-path") {
      args.backupPath = argv[++i];
    } else if (arg === "--backup-sha256") {
      args.backupSha256 = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!jobGiven) {
    throw new Error("--job is required");
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 5000) {
    throw new Error("--limit must be an integer from 1 to 5000");
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > 1000) {
    throw new Error("--batch-size must be an integer from 1 to 1000");
  }
  if (!Number.isInteger(args.retentionDays) || args.retentionDays < 0) {
    throw new Error("--retention-days must be a non-negative integer");
  }
  const needsBackup = args.execute && (args.job === "weekly-purge" || args.job === "monthly-vacuum");
  if (needsBackup) {
    if (!args.backupPath) throw new Error("--backup-path is required with --execute for this job");
    if (!args.backupSha256 || !/^[a-fA-F0-9]{64}$/.test(args.backupSha256)) {
      throw new Error("--backup-sha256 must be a 64-character hex digest");
    }
  }
  return args;
}

function maintenanceDir(args: Args): string {
  const dir = join(args.stateDir, "maintenance");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function reportPath(args: Args, name: string): string {
  const dir = join(maintenanceDir(args), "reports");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, `${name}-${stamp}.json`);
}

function writeReport(args: Args, name: string, report: Record<string, unknown>): string {
  const path = reportPath(args, name);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path;
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

async function runJsonCommand(command: string, commandArgs: string[], cwd: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  parsed: Record<string, unknown> | null;
}> {
  const proc = Bun.spawn([command, ...commandArgs], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr, parsed: parseLastJsonObject(stdout) };
}

function parseLastJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type HealthProbe =
  | { checked: false; ready: null; status: null; elapsed_ms: 0 }
  | { checked: true; ready: boolean; status: number | null; elapsed_ms: number };

async function probeHealthUrl(url: string, timeoutMs = 5000): Promise<HealthProbe> {
  if (url === "off") {
    return { checked: false, ready: null, status: null, elapsed_ms: 0 };
  }
  return { checked: true, ...(await fetchHealth(url, timeoutMs)) };
}

function healthTarget(args: Args): string {
  if (args.healthUrl) return args.healthUrl;
  return `http://127.0.0.1:${daemonPort()}/health/ready`;
}

async function fetchHealth(url: string, timeoutMs = 5000): Promise<{ ready: boolean; status: number | null; elapsed_ms: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.text();
    return { ready: response.ok, status: response.status, elapsed_ms: Date.now() - startedAt };
  } catch {
    return { ready: false, status: null, elapsed_ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

function daemonPort(): number {
  const raw = Number(process.env.HARNESS_MEM_PORT || 37888);
  return Number.isInteger(raw) && raw > 0 ? raw : 37888;
}

const ARCHIVE_LOOP_PATTERN = /bun(?:-?[^ ]*)?\s+.*scripts\/triage-compact-loop\.ts/;

/**
 * A bare `pgrep -f triage-compact-loop` also matches shells, editors, and log
 * commands that merely mention the name. Accept only a pid whose own command
 * line is the bun process running the loop script.
 */
function archiveLoopPids(): { pids: number[]; candidates: number } {
  const result = Bun.spawnSync(["pgrep", "-f", "triage-compact-loop"]);
  const candidates = result.stdout
    .toString()
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  const pids = candidates.filter((pid) => {
    const ps = Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="]);
    if (ps.exitCode !== 0) return false;
    return ARCHIVE_LOOP_PATTERN.test(ps.stdout.toString());
  });
  return { pids, candidates: candidates.length };
}

function count(db: Database, sql: string, ...params: Array<string | number>): number {
  const row = db.query<{ count: number }, Array<string | number>>(sql).get(...params);
  return Number(row?.count ?? 0);
}

type MonitorMetrics = {
  db_path: string;
  open_mode: "readonly" | "query_only";
  db_bytes: number;
  wal_bytes: number;
  active_observations: number;
  archived_observations: number;
  archive_stubs_archived: number;
  archive_stubs_purged: number;
  archived_last_7d: number;
  archived_8_to_30d: number;
  archived_31_to_90d: number;
  archived_over_90d: number;
  archived_missing_payload: number;
  freelist_pages: number;
  page_size: number;
  reclaimable_bytes: number;
  last_vacuum_at: string | null;
  last_purge_at: string | null;
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * WAL databases need an existing -shm before a read-only connection can read
 * them; an idle local DB has none, so fall back to a write handle pinned with
 * query_only. Both modes only read.
 */
function openReadOnly(dbPath: string): { db: Database; mode: "readonly" | "query_only" } {
  try {
    const db = new Database(dbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout = 5000");
    db.query("SELECT COUNT(*) AS count FROM sqlite_master").get();
    return { db, mode: "readonly" };
  } catch {
    const db = new Database(dbPath);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec("PRAGMA query_only = 1");
      return { db, mode: "query_only" };
    } catch (error) {
      db.close();
      throw error;
    }
  }
}

function readMetrics(dbPath: string): MonitorMetrics {
  const opened = openReadOnly(dbPath);
  const db = opened.db;
  try {
    const pageSize = count(db, "SELECT page_size AS count FROM pragma_page_size");
    const freelist = count(db, "SELECT freelist_count AS count FROM pragma_freelist_count");
    const dbBytes = existsSync(dbPath) ? statSync(dbPath).size : 0;
    const walPath = `${dbPath}-wal`;
    const walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
    const archived = count(db, "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL");
    const lastAudit = (action: string): string | null => {
      try {
        return db
          .query<{ created_at: string }, [string]>(
            "SELECT created_at FROM mem_audit_log WHERE action = ? ORDER BY created_at DESC LIMIT 1",
          )
          .get(action)?.created_at ?? null;
      } catch {
        return null;
      }
    };
    return {
      db_path: dbPath,
      open_mode: opened.mode,
      db_bytes: dbBytes,
      wal_bytes: walBytes,
      active_observations: count(db, "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL"),
      archived_observations: archived,
      archive_stubs_archived: count(db, "SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'archived'"),
      archive_stubs_purged: count(db, "SELECT COUNT(*) AS count FROM mem_archive_stubs WHERE archive_state = 'purged'"),
      archived_last_7d: count(
        db,
        "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL AND archived_at > ?",
        isoDaysAgo(7),
      ),
      archived_8_to_30d: count(
        db,
        "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL AND archived_at <= ? AND archived_at > ?",
        isoDaysAgo(7),
        isoDaysAgo(30),
      ),
      archived_31_to_90d: count(
        db,
        "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL AND archived_at <= ? AND archived_at > ?",
        isoDaysAgo(30),
        isoDaysAgo(90),
      ),
      archived_over_90d: count(
        db,
        "SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NOT NULL AND archived_at <= ?",
        isoDaysAgo(90),
      ),
      archived_missing_payload: count(
        db,
        `SELECT COUNT(*) AS count
           FROM mem_archive_stubs s
           JOIN mem_observations o ON o.id = s.observation_id
          WHERE s.archive_state = 'archived'
            AND o.archived_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM mem_archive_full f
               WHERE f.archive_id = s.archive_id
                 AND f.purged_at IS NULL
                 AND length(f.payload_json) > 0
            )`,
      ),
      freelist_pages: freelist,
      page_size: pageSize,
      reclaimable_bytes: freelist * pageSize,
      last_vacuum_at: lastAudit("admin.vacuum.execute"),
      last_purge_at: lastAudit("admin.hard_purge.execute"),
    };
  } finally {
    db.close();
  }
}

function envBytes(name: string, fallback: number): number {
  const raw = Number(process.env[name] || "");
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

const GiB = 1024 * 1024 * 1024;

function purgeCommand(args: Args): string {
  const backup = args.backupPath ?? "<backup-path>";
  const sha = args.backupSha256 ?? "<backup-sha256>";
  return [
    "bun run scripts/forget-maintenance-offline.ts",
    `--backup-path ${backup}`,
    `--backup-sha256 ${sha}`,
    `--limit ${args.limit}`,
    `--batch-size ${args.batchSize}`,
    `--retention-days ${args.retentionDays}`,
    "--execute",
    `--reason maintenance-weekly-purge`,
    `--checkpoint-path ${join(maintenanceDir(args), "purge-checkpoint.json")}`,
  ].join(" ");
}

async function jobHourlyArchive(args: Args): Promise<{ report: Record<string, unknown>; exitCode: number }> {
  const probe = archiveLoopPids();
  const running = probe.pids;
  const logPath = join(maintenanceDir(args), "hourly-archive.log");
  const pidPath = join(maintenanceDir(args), "hourly-archive.pid");
  const command = [
    "run",
    "scripts/triage-compact-loop.ts",
    "--db-path",
    args.dbPath,
    "--limit",
    "50",
    "--execute",
    "--prune-vectors",
    "--max-batches",
    "120",
    "--sleep-ms",
    "1000",
    "--time-budget-ms",
    "3300000",
    "--allow-running-daemon",
    "--reason",
    "maintenance-hourly-archive",
  ];
  const base = {
    job: args.job,
    execute: args.execute,
    running_pids: running,
    probe: { candidate_pids: probe.candidates },
    log_path: logPath,
  };
  if (running.length > 0) {
    return { report: { ...base, started: false, skipped: "archive_loop_already_running" }, exitCode: 0 };
  }
  if (!args.execute) {
    return {
      report: { ...base, started: false, skipped: "plan_only", command: `bun ${command.join(" ")}` },
      exitCode: 0,
    };
  }
  const logFd = openSync(logPath, "a");
  try {
    const child = spawn(process.execPath, command, {
      cwd: args.repoRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    writeFileSync(pidPath, `${child.pid ?? ""}\n`, "utf8");
    return { report: { ...base, started: true, pid: child.pid ?? null }, exitCode: 0 };
  } finally {
    closeSync(logFd);
  }
}

async function jobWeeklyMonitor(args: Args): Promise<{ report: Record<string, unknown>; exitCode: number }> {
  const metrics = readMetrics(args.dbPath);
  const health = await probeHealthUrl(healthTarget(args));
  const dbMax = envBytes("HARNESS_MEM_MAINTENANCE_DB_MAX_BYTES", 24 * GiB);
  const freelistMax = envBytes("HARNESS_MEM_MAINTENANCE_FREELIST_MAX_BYTES", 4 * GiB);
  const alerts: Array<{ code: string; detail: Record<string, unknown> }> = [];
  if (health.checked && !health.ready) {
    alerts.push({ code: "daemon_not_ready", detail: { ...health } });
  }
  if (metrics.archived_missing_payload > 0) {
    alerts.push({ code: "archived_missing_payload", detail: { count: metrics.archived_missing_payload } });
  }
  if (metrics.db_bytes > dbMax) {
    alerts.push({ code: "db_bytes_above_threshold", detail: { db_bytes: metrics.db_bytes, threshold: dbMax } });
  }
  if (metrics.reclaimable_bytes > freelistMax) {
    alerts.push({
      code: "freelist_above_threshold",
      detail: { reclaimable_bytes: metrics.reclaimable_bytes, threshold: freelistMax },
    });
  }
  const report = {
    job: args.job,
    generated_at: new Date().toISOString(),
    execute: args.execute,
    health,
    metrics,
    thresholds: { db_max_bytes: dbMax, freelist_max_bytes: freelistMax },
    purge_eligibility: {
      retention_days: args.retentionDays,
      eligible_archived_rows: countEligible(metrics, args.retentionDays),
      irreversible: true,
      command: purgeCommand(args),
    },
    alerts,
    ok: alerts.length === 0,
  };
  const path = writeReport(args, args.job, report);
  return { report: { ...report, report_path: path }, exitCode: alerts.length === 0 ? 0 : 2 };
}

async function jobWeeklyPurge(args: Args): Promise<{ report: Record<string, unknown>; exitCode: number }> {
  const metrics = readMetrics(args.dbPath);
  const health = await probeHealthUrl(healthTarget(args));
  const eligible = countEligible(metrics, args.retentionDays);
  const plan = {
    job: args.job,
    generated_at: new Date().toISOString(),
    execute: args.execute,
    retention_days: args.retentionDays,
    limit: args.limit,
    eligible_archived_rows: eligible,
    archived_by_age: {
      last_7d: metrics.archived_last_7d,
      from_8_to_30d: metrics.archived_8_to_30d,
      from_31_to_90d: metrics.archived_31_to_90d,
      over_90d: metrics.archived_over_90d,
    },
    archived_missing_payload: metrics.archived_missing_payload,
    daemon_health: health,
    irreversible: true,
    command: purgeCommand(args),
  };
  if (!args.execute) {
    const path = writeReport(args, args.job, plan);
    return { report: { ...plan, report_path: path, executed: false, skipped: "plan_only" }, exitCode: 0 };
  }
  const backupStat = statSync(args.backupPath!);
  const actualSha = sha256File(args.backupPath!);
  if (actualSha !== args.backupSha256!.toLowerCase()) {
    throw new Error(`backup sha256 mismatch: expected=${args.backupSha256} actual=${actualSha}`);
  }
  const offline = await runJsonCommand(
    process.execPath,
    [
      "run",
      "scripts/forget-maintenance-offline.ts",
      "--backup-path",
      resolve(args.backupPath!),
      "--backup-sha256",
      actualSha,
      "--db-path",
      args.dbPath,
      "--limit",
      String(args.limit),
      "--batch-size",
      String(args.batchSize),
      "--retention-days",
      String(args.retentionDays),
      "--execute",
      "--reason",
      "maintenance-weekly-purge",
      "--checkpoint-path",
      join(maintenanceDir(args), "purge-checkpoint.json"),
    ],
    args.repoRoot,
  );
  const report = {
    ...plan,
    executed: offline.exitCode === 0,
    backup: { path: resolve(args.backupPath!), sha256: actualSha, size_bytes: backupStat.size },
    offline_exit_code: offline.exitCode,
    offline_stderr: offline.stderr.trim() || null,
    offline: offline.parsed,
  };
  const path = writeReport(args, args.job, report);
  return { report: { ...report, report_path: path }, exitCode: offline.exitCode === 0 ? 0 : 1 };
}

function countEligible(metrics: MonitorMetrics, retentionDays: number): number {
  if (retentionDays <= 0) return metrics.archive_stubs_archived;
  if (retentionDays < 7) return metrics.archive_stubs_archived;
  if (retentionDays < 30) return metrics.archived_8_to_30d + metrics.archived_31_to_90d + metrics.archived_over_90d;
  if (retentionDays < 90) return metrics.archived_31_to_90d + metrics.archived_over_90d;
  return metrics.archived_over_90d;
}

async function jobMonthlyVacuum(args: Args): Promise<{ report: Record<string, unknown>; exitCode: number }> {
  const metrics = readMetrics(args.dbPath);
  const health = await probeHealthUrl(healthTarget(args));
  const vacuumCommand = [
    "bun run scripts/forget-maintenance-offline.ts",
    `--backup-path ${args.backupPath ?? "<backup-path>"}`,
    `--backup-sha256 ${args.backupSha256 ?? "<backup-sha256>"}`,
    "--vacuum-only",
    "--execute",
    "--reason maintenance-monthly-vacuum",
  ].join(" ");
  const plan = {
    job: args.job,
    generated_at: new Date().toISOString(),
    execute: args.execute,
    db_bytes: metrics.db_bytes,
    wal_bytes: metrics.wal_bytes,
    reclaimable_bytes: metrics.reclaimable_bytes,
    freelist_pages: metrics.freelist_pages,
    last_vacuum_at: metrics.last_vacuum_at,
    daemon_health: health,
    service_stop_required: true,
    command: vacuumCommand,
  };
  if (!args.execute) {
    const path = writeReport(args, args.job, plan);
    return { report: { ...plan, report_path: path, executed: false, skipped: "plan_only" }, exitCode: 0 };
  }
  const backupStat = statSync(args.backupPath!);
  const actualSha = sha256File(args.backupPath!);
  if (actualSha !== args.backupSha256!.toLowerCase()) {
    throw new Error(`backup sha256 mismatch: expected=${args.backupSha256} actual=${actualSha}`);
  }
  const stop = await runJsonCommand(join(args.repoRoot, "scripts/harness-memd"), ["offline-stop", "--quiet"], args.repoRoot);
  let vacuum: Awaited<ReturnType<typeof runJsonCommand>> | null = null;
  let start: Awaited<ReturnType<typeof runJsonCommand>> | null = null;
  let postHealth: HealthProbe | null = null;
  try {
    if (stop.exitCode !== 0) {
      throw new Error(`offline-stop failed: ${stop.stderr.trim() || stop.stdout.trim() || stop.exitCode}`);
    }
    vacuum = await runJsonCommand(
      process.execPath,
      [
        "run",
        "scripts/forget-maintenance-offline.ts",
        "--backup-path",
        resolve(args.backupPath!),
        "--backup-sha256",
        actualSha,
        "--db-path",
        args.dbPath,
        "--vacuum-only",
        "--execute",
        "--reason",
        "maintenance-monthly-vacuum",
      ],
      args.repoRoot,
    );
  } finally {
    start = await runJsonCommand(join(args.repoRoot, "scripts/harness-memd"), ["start", "--quiet"], args.repoRoot);
    postHealth = await probeHealthUrl(healthTarget(args), 30000);
  }
  const report = {
    ...plan,
    executed: vacuum?.exitCode === 0,
    backup: { path: resolve(args.backupPath!), sha256: actualSha, size_bytes: backupStat.size },
    offline_stop_exit_code: stop.exitCode,
    vacuum_exit_code: vacuum?.exitCode ?? null,
    vacuum_stderr: vacuum?.stderr.trim() || null,
    vacuum: vacuum?.parsed ?? null,
    offline_start_exit_code: start?.exitCode ?? null,
    health_after: postHealth,
  };
  const path = writeReport(args, args.job, report);
  return { report: { ...report, report_path: path }, exitCode: vacuum?.exitCode === 0 ? 0 : 1 };
}

function writeLatest(args: Args, job: Job, report: Record<string, unknown>): { json: string; text: string } {
  const dir = join(maintenanceDir(args), "reports");
  mkdirSync(dir, { recursive: true });
  const json = join(dir, `latest-${job}.json`);
  const text = join(dir, `latest-${job}.txt`);
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(text, `${summaryLine(job, report)}\n`, "utf8");
  return { json, text };
}

function summaryLine(job: Job, report: Record<string, unknown>): string {
  const stamp = String(report.generated_at ?? new Date().toISOString());
  if (job === "hourly-archive") {
    return `${stamp} hourly-archive ${report.started ? `started pid ${report.pid}` : String(report.skipped ?? "no-op")}`;
  }
  const m = report.metrics as MonitorMetrics | undefined;
  const parts = [`${stamp} ${job}`];
  if (m) {
    parts.push(`DB ${(m.db_bytes / GiB).toFixed(2)}GiB`);
    parts.push(`archive ${m.archive_stubs_archived}`);
    parts.push(`payload欠落 ${m.archived_missing_payload}`);
    parts.push(`回収可能 ${(m.reclaimable_bytes / GiB).toFixed(2)}GiB`);
  }
  if (typeof report.eligible_archived_rows === "number") {
    parts.push(`purge可能 ${report.eligible_archived_rows}`);
  }
  if (typeof report.reclaimable_bytes === "number" && !m) {
    parts.push(`回収可能 ${(Number(report.reclaimable_bytes) / GiB).toFixed(2)}GiB`);
  }
  const alerts = Array.isArray(report.alerts) ? report.alerts.length : 0;
  parts.push(alerts > 0 ? `異常 ${alerts}件` : "異常なし");
  return parts.join(" / ");
}

function sendNotification(title: string, body: string): { sent: boolean; error: string | null } {
  const script = [
    "on run argv",
    "display notification (item 1 of argv) with title (item 2 of argv)",
    "end run",
  ];
  const args: string[] = [];
  for (const line of script) {
    args.push("-e", line);
  }
  args.push(body, title);
  const result = Bun.spawnSync(["osascript", ...args]);
  if (result.exitCode === 0) return { sent: true, error: null };
  return {
    sent: false,
    error: (result.stderr.toString().trim() || `osascript exit ${result.exitCode}`).slice(0, 300),
  };
}

function printHuman(job: Job, report: Record<string, unknown>): void {
  const lines: string[] = [];
  if (job === "hourly-archive") {
    lines.push(
      `archive loop: ${report.started ? `started pid ${report.pid}` : `${String(report.skipped ?? "no-op")} pids=${JSON.stringify(report.running_pids ?? [])}`}`,
    );
  } else {
    const m = report.metrics as MonitorMetrics | undefined;
    if (m) {
      lines.push(`db ${(m.db_bytes / GiB).toFixed(2)} GiB (wal ${(m.wal_bytes / (1024 * 1024)).toFixed(0)} MiB)`);
      lines.push(`active ${m.active_observations} / archived ${m.archived_observations}`);
      lines.push(`archive stubs: archived ${m.archive_stubs_archived}, purged ${m.archive_stubs_purged}`);
      lines.push(`reclaimable ${(m.reclaimable_bytes / GiB).toFixed(2)} GiB (${m.freelist_pages} pages)`);
    }
    if (typeof report.eligible_archived_rows === "number") {
      lines.push(`purge eligible (>= ${report.retention_days} days): ${report.eligible_archived_rows}`);
    }
    if (report.command) lines.push(`command: ${report.command}`);
    if (Array.isArray(report.alerts) && report.alerts.length > 0) {
      lines.push(`alerts: ${report.alerts.map((a) => (a as { code: string }).code).join(", ")}`);
    }
  }
  if (report.report_path) lines.push(`report: ${report.report_path}`);
  if (report.latest_text) lines.push(`latest: ${report.latest_text}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const args = parseArgs(Bun.argv.slice(2));
  if (!existsSync(args.dbPath)) {
    throw new Error(`database not found: ${args.dbPath}`);
  }
  const runner =
    args.job === "hourly-archive"
      ? jobHourlyArchive
      : args.job === "weekly-monitor"
        ? jobWeeklyMonitor
        : args.job === "weekly-purge"
          ? jobWeeklyPurge
          : jobMonthlyVacuum;
  const { report, exitCode } = await runner(args);
  const withTiming: Record<string, unknown> = { ...report, duration_ms: Date.now() - startedAt };
  const latest = writeLatest(args, args.job, withTiming);
  const alerts = Array.isArray(withTiming.alerts) ? withTiming.alerts.length : 0;
  const shouldNotify = args.notify === "always" || (args.notify === "alerts" && alerts > 0);
  const notification = shouldNotify
    ? sendNotification(
        alerts > 0 ? `harness-mem: 異常 ${alerts}件` : "harness-mem 週次レポート",
        summaryLine(args.job, withTiming),
      )
    : null;
  const finished = { ...withTiming, latest_json: latest.json, latest_text: latest.text, notification };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(finished, null, 2)}\n`);
  } else {
    printHuman(args.job, finished);
  }
  // process.exit() drops buffered stdout when launchd redirects it to a file.
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`[maintenance-run] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
