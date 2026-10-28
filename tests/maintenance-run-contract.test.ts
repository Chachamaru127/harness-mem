import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BUN = process.execPath;
const RUNNER = join(ROOT, "scripts/maintenance-run.ts");
const OFFLINE = join(ROOT, "scripts/forget-maintenance-offline.ts");
const LAUNCHD = join(ROOT, "launchd");
const INSTALLER = join(ROOT, "scripts/install-maintenance-jobs.sh");

function sandbox(): { root: string; stateDir: string; dbPath: string; env: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), "maintenance-run-"));
  const stateDir = join(root, "state");
  const dbPath = join(stateDir, "harness-mem.db");
  return {
    root,
    stateDir,
    dbPath,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      HARNESS_MEM_HOME: stateDir,
      HARNESS_MEM_DB_PATH: dbPath,
    },
  };
}

function run(args: string[], env: Record<string, string>) {
  const result = spawnSync(BUN, args, { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJson(stdout: string): Record<string, unknown> {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error(`no JSON in output: ${stdout.slice(0, 400)}`);
  return JSON.parse(stdout.slice(start)) as Record<string, unknown>;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function bootstrapDatabase(env: Record<string, string>, dbPath: string): void {
  const result = run([OFFLINE, "--archive-only", "--db-path", dbPath], env);
  if (result.status !== 0) {
    throw new Error(`database bootstrap failed: ${result.stderr || result.stdout}`);
  }
}

describe("maintenance runner", () => {
  test("monitor is read-only and writes a report", () => {
    const box = sandbox();
    bootstrapDatabase(box.env, box.dbPath);
    const result = run([RUNNER, "--job", "weekly-monitor", "--json", "--db-path", box.dbPath, "--state-dir", box.stateDir, "--health-url", "off"], box.env);
    expect(result.status).toBe(0);
    const report = parseJson(result.stdout);
    const metrics = report.metrics as Record<string, number>;
    expect(metrics.active_observations).toBe(0);
    expect(metrics.archived_observations).toBe(0);
    expect(report.alerts).toEqual([]);
    const reportPath = String(report.report_path);
    expect(reportPath.startsWith(join(box.stateDir, "maintenance", "reports"))).toBe(true);
    expect(existsSync(reportPath)).toBe(true);
    const latestText = String(report.latest_text);
    expect(existsSync(latestText)).toBe(true);
    const summary = readFileSync(latestText, "utf8");
    expect(summary).toContain("weekly-monitor");
    expect(summary).toContain("異常なし");
    expect(existsSync(String(report.latest_json))).toBe(true);
  });

  test("hard purge never selects pipeline summary observations", () => {
    const box = sandbox();
    bootstrapDatabase(box.env, box.dbPath);
    const db = new Database(box.dbPath);
    const now = "2026-10-27T00:00:00.000Z";
    db.query("INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at) VALUES ('s1','claude','p',?,?,?)").run(now, now, now);
    for (const id of ["obs-summary", "obs-plain"]) {
      db.query(`INSERT INTO mem_observations(id, platform, project, session_id, content, content_redacted, tags_json, privacy_tags_json, created_at, updated_at, archived_at)
                VALUES (?, 'claude', 'p', 's1', 'x', 'x', '[]', '[]', ?, ?, ?)`).run(id, now, now, now);
      db.query(`INSERT INTO mem_archive_stubs(archive_id, observation_id, project, session_id, user_id, archive_stub, archive_state, reason, content_sha256, manifest_sha256, created_at)
                VALUES (?, ?, 'p', 's1', 'u', '{}', 'archived', 'test', 'h', 'h', ?)`).run(`a-${id}`, id, now);
    }
    db.query(`INSERT INTO mem_summary_jobs(session_id, project, model, status, summary_observation_id, created_at, updated_at)
              VALUES ('s1', 'p', 'claude-haiku-5-5', 'completed', 'obs-summary', ?, ?)`).run(now, now);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    const backupPath = join(box.root, "backup.db");
    copyFileSync(box.dbPath, backupPath);
    const result = run([OFFLINE, "--db-path", box.dbPath, "--backup-path", backupPath, "--backup-sha256", sha256(backupPath)], box.env);
    // The plain row then reaches the backup-coverage gate (no payload in this fixture); the summary row never does.
    expect(result.stderr).toContain("excluded 1 pipeline summary rows");
    expect(result.stderr).toContain("obs-plain");
    expect(result.stderr).not.toContain("obs-summary");
  });

  test("purge and vacuum jobs are report-only without --execute", () => {
    const box = sandbox();
    bootstrapDatabase(box.env, box.dbPath);
    for (const job of ["weekly-purge", "monthly-vacuum"]) {
      const result = run([RUNNER, "--job", job, "--json", "--db-path", box.dbPath, "--state-dir", box.stateDir], box.env);
      expect(result.status).toBe(0);
      const report = parseJson(result.stdout);
      expect(report.executed).toBe(false);
      expect(report.skipped).toBe("plan_only");
      expect(typeof report.command).toBe("string");
    }
  });

  test("hourly archive reports instead of spawning without --execute", () => {
    const box = sandbox();
    bootstrapDatabase(box.env, box.dbPath);
    const result = run([RUNNER, "--job", "hourly-archive", "--json", "--db-path", box.dbPath, "--state-dir", box.stateDir], box.env);
    expect(result.status).toBe(0);
    const report = parseJson(result.stdout);
    expect(report.started).toBe(false);
    expect(readdirSync(box.stateDir)).not.toContain("hourly-archive.pid");
  });

  test("--execute for purge and vacuum rejects missing backup evidence", () => {
    const box = sandbox();
    bootstrapDatabase(box.env, box.dbPath);
    for (const job of ["weekly-purge", "monthly-vacuum"]) {
      const result = run([RUNNER, "--job", job, "--execute", "--db-path", box.dbPath, "--state-dir", box.stateDir], box.env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--backup-path is required");
    }
  });

  test("vacuum-only requires --execute before touching the database", () => {
    const box = sandbox();
    bootstrapDatabase(box.env, box.dbPath);
    const sha = "a".repeat(64);
    const result = run([OFFLINE, "--vacuum-only", "--backup-path", box.dbPath, "--backup-sha256", sha, "--db-path", box.dbPath], box.env);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--vacuum-only requires --execute");
  });

  test("vacuum-only compacts a verified backup copy", () => {
    const box = sandbox();
    bootstrapDatabase(box.env, box.dbPath);
    const backupPath = join(box.root, "backup.db");
    copyFileSync(box.dbPath, backupPath);
    const result = run(
      [
        OFFLINE,
        "--vacuum-only",
        "--execute",
        "--allow-running-daemon",
        "--backup-path",
        backupPath,
        "--backup-sha256",
        sha256(backupPath),
        "--db-path",
        box.dbPath,
        "--reason",
        "test-vacuum-only",
      ],
      box.env,
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const report = parseJson(result.stdout);
    expect(report.mode).toBe("offline_vacuum_only");
    const compact = report.compact as Record<string, unknown>;
    expect(compact.execute).toBe(true);
    expect(typeof compact.reclaimed_bytes).toBe("number");
    expect((report.restore_drill as Record<string, unknown>).ok).toBe(true);
  });
});

describe("maintenance launchd wiring", () => {
  const templates = [
    ["hourly-archive", ["--job", "hourly-archive", "--execute"]],
    ["weekly-monitor", ["--job", "weekly-monitor"]],
    ["monthly-vacuum", ["--job", "monthly-vacuum"]],
  ] as const;

  test("every template runs maintenance-run.ts with its own job", () => {
    for (const [job, expectedArgs] of templates) {
      const path = join(LAUNCHD, `jp.canai.harness-mem.maintenance-${job}.plist.template`);
      const text = readFileSync(path, "utf8");
      expect(text).toContain("jp.canai.harness-mem.maintenance-" + job);
      expect(text).toContain("__BUN__");
      expect(text).toContain("__REPO_ROOT__/scripts/maintenance-run.ts");
      for (const arg of expectedArgs) {
        expect(text).toContain(`<string>${arg}</string>`);
      }
      expect(text).toContain("<key>StartCalendarInterval</key>");
    }
  });

  test("only the archive job executes; irreversible jobs never run from launchd", () => {
    for (const [job] of templates) {
      const text = readFileSync(join(LAUNCHD, `jp.canai.harness-mem.maintenance-${job}.plist.template`), "utf8");
      if (job === "hourly-archive") {
        expect(text).toContain("<string>--execute</string>");
      } else {
        expect(text).not.toContain("<string>--execute</string>");
      }
    }
  });

  test("installer renders placeholders and supports print-only mode", () => {
    const result = spawnSync("bash", [INSTALLER, "--print", "--jobs", "weekly-monitor"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<key>Label</key>");
    expect(result.stdout).not.toContain("__REPO_ROOT__");
    expect(result.stdout).toContain("maintenance-run.ts");
  });
});
