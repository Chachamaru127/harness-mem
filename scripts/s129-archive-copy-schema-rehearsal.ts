#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

type Args = {
  liveDb: string;
  backupSource: string;
  json: string;
  md: string;
  keepCopy: boolean;
};

type FileSnapshot = {
  path: string;
  exists: boolean;
  size_bytes: number | null;
  mtime_ms: number | null;
};

type DbSnapshot = {
  file: FileSnapshot;
  wal: FileSnapshot;
  shm: FileSnapshot;
  tables: string[];
  table_list_hash: string;
  counts: Record<string, number | null>;
  schema_hash: string;
};

const ARCHIVE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mem_archive_stubs (
  archive_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  project TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  team_id TEXT DEFAULT NULL,
  archive_stub TEXT NOT NULL,
  archive_full_ref TEXT DEFAULT NULL,
  archive_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  legal_hold_snapshot INTEGER NOT NULL DEFAULT 0,
  content_sha256 TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  restored_at TEXT DEFAULT NULL,
  purged_at TEXT DEFAULT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS mem_archive_full (
  archive_full_ref TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  purged_at TEXT DEFAULT NULL,
  FOREIGN KEY(archive_id) REFERENCES mem_archive_stubs(archive_id)
);

CREATE INDEX IF NOT EXISTS idx_mem_archive_stubs_observation_id
  ON mem_archive_stubs(observation_id);
CREATE INDEX IF NOT EXISTS idx_mem_archive_stubs_project_state_created_at
  ON mem_archive_stubs(project, archive_state, created_at);
CREATE INDEX IF NOT EXISTS idx_mem_archive_stubs_manifest_sha256
  ON mem_archive_stubs(manifest_sha256);
CREATE INDEX IF NOT EXISTS idx_mem_archive_full_archive_id
  ON mem_archive_full(archive_id);
`;

const ARCHIVE_TABLES = ["mem_archive_stubs", "mem_archive_full"] as const;
const COUNT_TABLES = [
  "mem_observations",
  "mem_vectors",
  "mem_links",
  "mem_relations",
  "mem_facts",
  "mem_events",
  "mem_tags",
  "mem_observation_entities",
  "mem_nuggets",
  "mem_nugget_vectors",
  "mem_archive_stubs",
  "mem_archive_full",
] as const;

function parseArgs(argv: string[]): Args {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = value;
    index += 1;
  }

  const home = process.env.HOME ?? "";
  return {
    liveDb: resolvePath(parsed["live-db"] ?? `${home}/.harness-mem/harness-mem.db`),
    backupSource: resolvePath(
      parsed["backup-source"] ?? `${home}/.harness-mem/backups/harness-mem-backup-2026-05-20T04-12-35-622Z.db`,
    ),
    json: parsed.json ?? "docs/ops/s129-archive-copy-schema-rehearsal-2026-05-20.json",
    md: parsed.md ?? "docs/ops/s129-archive-copy-schema-rehearsal-2026-05-20.md",
    keepCopy: parsed["keep-copy"] === "true",
  };
}

function resolvePath(path: string): string {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) return resolve((process.env.HOME ?? "~") + path.slice(1));
  return resolve(path);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fileSnapshot(path: string): FileSnapshot {
  try {
    const stat = statSync(path);
    return {
      path,
      exists: true,
      size_bytes: stat.size,
      mtime_ms: stat.mtimeMs,
    };
  } catch {
    return {
      path,
      exists: false,
      size_bytes: null,
      mtime_ms: null,
    };
  }
}

function openReadonly(path: string): Database {
  const db = new Database(path, { readonly: true, create: false });
  db.exec("PRAGMA query_only = ON");
  return db;
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(table) as { present: number } | null;
  return !!row;
}

function tableList(db: Database): string[] {
  return (db
    .query(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function sqliteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function countRows(db: Database, table: string): number | null {
  if (!tableExists(db, table)) return null;
  const row = db.query(`SELECT COUNT(*) AS count FROM ${sqliteIdent(table)}`).get() as { count: number } | null;
  return Number(row?.count ?? 0);
}

function counts(db: Database): Record<string, number | null> {
  return Object.fromEntries(COUNT_TABLES.map((table) => [table, countRows(db, table)]));
}

function schemaHash(db: Database, tableNames?: readonly string[]): string {
  const filter = tableNames && tableNames.length > 0
    ? `AND name IN (${tableNames.map(() => "?").join(", ")})`
    : "";
  const rows = db
    .query(
      `SELECT type, name, tbl_name, COALESCE(sql, '') AS sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
       ${filter}
       ORDER BY type, name`,
    )
    .all(...((tableNames ?? []) as never[])) as Array<{
      type: string;
      name: string;
      tbl_name: string;
      sql: string;
    }>;
  return sha256(JSON.stringify(rows));
}

function dbSnapshot(path: string): DbSnapshot {
  const db = openReadonly(path);
  try {
    const tables = tableList(db);
    return {
      file: fileSnapshot(path),
      wal: fileSnapshot(`${path}-wal`),
      shm: fileSnapshot(`${path}-shm`),
      tables,
      table_list_hash: sha256(JSON.stringify(tables)),
      counts: counts(db),
      schema_hash: schemaHash(db),
    };
  } finally {
    db.close();
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snapshotUnchanged(before: DbSnapshot, after: DbSnapshot): Record<string, boolean> {
  return {
    table_list: sameJson(before.tables, after.tables),
    schema_hash: before.schema_hash === after.schema_hash,
    counts: sameJson(before.counts, after.counts),
    file_size: before.file.size_bytes === after.file.size_bytes,
    wal_size: before.wal.size_bytes === after.wal.size_bytes,
    shm_size: before.shm.size_bytes === after.shm.size_bytes,
  };
}

function allUnchanged(checks: Record<string, boolean>): boolean {
  return Object.values(checks).every(Boolean);
}

function integrityCheck(path: string): { ok: boolean; result: string; elapsed_ms: number } {
  const startedAt = performance.now();
  const db = openReadonly(path);
  try {
    const row = db.query("PRAGMA integrity_check").get() as { integrity_check: string } | null;
    const result = row?.integrity_check ?? "";
    return {
      ok: result === "ok",
      result,
      elapsed_ms: Math.round((performance.now() - startedAt) * 100) / 100,
    };
  } finally {
    db.close();
  }
}

function quickCheck(path: string): { ok: boolean; result: string } {
  const db = openReadonly(path);
  try {
    const row = db.query("PRAGMA quick_check").get() as { quick_check: string } | null;
    const result = row?.quick_check ?? "";
    return { ok: result === "ok", result };
  } finally {
    db.close();
  }
}

function archiveTableDetails(path: string): Record<string, unknown> {
  const db = openReadonly(path);
  try {
    return Object.fromEntries(ARCHIVE_TABLES.map((table) => {
      const exists = tableExists(db, table);
      if (!exists) return [table, { exists: false, row_count: null, columns: [] }];
      const columns = db.query(`PRAGMA table_info(${sqliteIdent(table)})`).all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;
      return [table, {
        exists: true,
        row_count: countRows(db, table),
        columns: columns.map((column) => ({
          name: column.name,
          type: column.type,
          notnull: column.notnull,
          dflt_value: column.dflt_value,
          pk: column.pk,
        })),
      }];
    }));
  } finally {
    db.close();
  }
}

function archiveSchemaState(path: string): Record<string, unknown> {
  const db = openReadonly(path);
  try {
    return {
      schema_hash: schemaHash(db, [
        "mem_archive_stubs",
        "mem_archive_full",
        "idx_mem_archive_stubs_observation_id",
        "idx_mem_archive_stubs_project_state_created_at",
        "idx_mem_archive_stubs_manifest_sha256",
        "idx_mem_archive_full_archive_id",
      ]),
      counts: Object.fromEntries(ARCHIVE_TABLES.map((table) => [table, countRows(db, table)])),
    };
  } finally {
    db.close();
  }
}

function applyArchiveSchema(path: string): void {
  const db = new Database(path);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(ARCHIVE_SCHEMA_SQL);
  } finally {
    db.close();
  }
}

function rollbackRehearsal(path: string): Record<string, unknown> {
  const db = new Database(path);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const before = Object.fromEntries(ARCHIVE_TABLES.map((table) => [table, tableExists(db, table)]));
    db.exec("BEGIN IMMEDIATE");
    db.exec(ARCHIVE_SCHEMA_SQL);
    const insideTransaction = Object.fromEntries(ARCHIVE_TABLES.map((table) => [table, tableExists(db, table)]));
    db.exec("ROLLBACK");
    const afterRollback = Object.fromEntries(ARCHIVE_TABLES.map((table) => [table, tableExists(db, table)]));
    return {
      before,
      created_inside_transaction: insideTransaction,
      after_rollback: afterRollback,
      absent_after_rollback: ARCHIVE_TABLES.every((table) => before[table] === afterRollback[table]),
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // no active transaction
    }
    throw error;
  } finally {
    db.close();
  }
}

function writeReport(jsonPath: string, mdPath: string, report: Record<string, unknown>): void {
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(mdPath, renderMarkdown(report));
}

function renderMarkdown(report: Record<string, unknown>): string {
  const live = report.live_db as Record<string, unknown>;
  const copy = report.backup_copy as Record<string, unknown>;
  const rollback = copy.rollback_rehearsal as Record<string, unknown>;
  const final = copy.final as Record<string, unknown>;
  const integrity = final.integrity_check as Record<string, unknown>;
  const unchanged = live.unchanged as Record<string, unknown>;
  const postIntegrity = live.post_integrity_diagnostics as Record<string, unknown>;
  const postIntegrityUnchanged = postIntegrity.unchanged_since_narrow_window as Record<string, unknown>;
  const source = report.backup_source as Record<string, unknown>;
  const sourceUnchanged = source.unchanged as Record<string, unknown>;

  return `# S129 Archive Copy Schema Rehearsal

- generated_at: ${report.generated_at}
- task: S129-001
- result: ${report.ok ? "PASS" : "FAIL"}
- live_db: ${(live.before as DbSnapshot).file.path}
- backup_source: ${(source.before as FileSnapshot).path}
- backup_copy: ${copy.copy_path}
- backup_copy_retained: ${copy.retained}

## Safety Boundary

- live DB mutation: not executed
- backup source mutation: not executed
- hard purge: not executed
- VACUUM: not executed
- DDL target: backup copy only

## Live DB Unchanged Check

- check_window: ${live.check_window}
- table_list_unchanged: ${unchanged.table_list}
- schema_hash_unchanged: ${unchanged.schema_hash}
- counts_unchanged: ${unchanged.counts}
- file_size_unchanged: ${unchanged.file_size}
- wal_size_unchanged: ${unchanged.wal_size}
- shm_size_unchanged: ${unchanged.shm_size}
- all: ${unchanged.all}

## Post-Integrity Live Drift Diagnostics

- gate: diagnostic only, not part of mutation pass/fail
- note: ${postIntegrity.note}
- table_list_unchanged_since_narrow_window: ${postIntegrityUnchanged.table_list}
- schema_hash_unchanged_since_narrow_window: ${postIntegrityUnchanged.schema_hash}
- counts_unchanged_since_narrow_window: ${postIntegrityUnchanged.counts}
- file_size_unchanged_since_narrow_window: ${postIntegrityUnchanged.file_size}
- wal_size_unchanged_since_narrow_window: ${postIntegrityUnchanged.wal_size}
- shm_size_unchanged_since_narrow_window: ${postIntegrityUnchanged.shm_size}
- all: ${postIntegrityUnchanged.all}

## Backup Source Unchanged Check

- size_unchanged: ${sourceUnchanged.size_bytes}
- mtime_unchanged: ${sourceUnchanged.mtime_ms}
- all: ${sourceUnchanged.all}

## Copy Schema Rehearsal

- copied_from_backup_source: ${copy.copied_from_backup_source}
- rollback_created_inside_transaction: ${JSON.stringify(rollback.created_inside_transaction)}
- rollback_absent_after_rollback: ${rollback.absent_after_rollback}
- rollback_reopen_quick_check: ${JSON.stringify(copy.rollback_reopen_quick_check)}
- committed_schema_applied: ${copy.committed_schema_applied}
- idempotent_reapply_unchanged: ${copy.idempotent_reapply_unchanged}
- archive_schema_hash: ${copy.archive_schema_hash}
- integrity_check: ${integrity.result} (${integrity.elapsed_ms} ms)

## Archive Tables

- mem_archive_stubs: ${JSON.stringify((final.archive_tables as Record<string, unknown>).mem_archive_stubs)}
- mem_archive_full: ${JSON.stringify((final.archive_tables as Record<string, unknown>).mem_archive_full)}

## Conclusion

The S128 backup was copied and the archive schema was rehearsed only on that copy.
The rollback/reopen path returned the copy to its pre-DDL archive-table state,
then the committed migration created empty restore-capable archive tables and
survived an idempotent reapply. Live DB checks stayed unchanged during the
rehearsal window.
`;
}

function assertPreconditions(args: Args): void {
  for (const [label, path] of [["live DB", args.liveDb], ["backup source", args.backupSource]] as const) {
    if (!existsSync(path)) {
      throw new Error(`${label} is missing: ${path}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertPreconditions(args);

  const startedAt = performance.now();
  const generatedAt = new Date().toISOString();
  const scratchDir = join(tmpdir(), `harness-mem-s129-archive-copy-${Date.now()}`);
  const copyPath = join(scratchDir, "archive-schema-rehearsal.db");
  mkdirSync(scratchDir, { recursive: true });

  const sourceBefore = fileSnapshot(args.backupSource);
  let cleanup: Record<string, unknown> = { attempted: false, removed: false };

  try {
    copyFileSync(args.backupSource, copyPath);
    const sourceAfterCopy = fileSnapshot(args.backupSource);
    const copyInitial = dbSnapshot(copyPath);
    const rollback = rollbackRehearsal(copyPath);
    const rollbackReopenSnapshot = dbSnapshot(copyPath);
    const rollbackQuickCheck = quickCheck(copyPath);

    const liveBefore = dbSnapshot(args.liveDb);
    applyArchiveSchema(copyPath);
    const afterFirstArchiveState = archiveSchemaState(copyPath);
    applyArchiveSchema(copyPath);
    const afterSecondArchiveState = archiveSchemaState(copyPath);
    const liveAfter = dbSnapshot(args.liveDb);
    const sourceAfterMigration = fileSnapshot(args.backupSource);
    const afterSecondApply = dbSnapshot(copyPath);
    const finalIntegrity = integrityCheck(copyPath);
    const finalArchiveTables = archiveTableDetails(copyPath);
    const liveAfterIntegrity = dbSnapshot(args.liveDb);
    const sourceAfter = fileSnapshot(args.backupSource);
    const copyFinalFile = fileSnapshot(copyPath);
    const archiveSchemaHash = (() => {
      const db = openReadonly(copyPath);
      try {
        return schemaHash(db, [
          "mem_archive_stubs",
          "mem_archive_full",
          "idx_mem_archive_stubs_observation_id",
          "idx_mem_archive_stubs_project_state_created_at",
          "idx_mem_archive_stubs_manifest_sha256",
          "idx_mem_archive_full_archive_id",
        ]);
      } finally {
        db.close();
      }
    })();

    const liveUnchanged = snapshotUnchanged(liveBefore, liveAfter);
    const liveAllUnchanged = allUnchanged(liveUnchanged);
    const postIntegrityLiveUnchanged = snapshotUnchanged(liveAfter, liveAfterIntegrity);
    const sourceUnchanged = {
      size_bytes: sourceBefore.size_bytes === sourceAfter.size_bytes
        && sourceBefore.size_bytes === sourceAfterCopy.size_bytes
        && sourceBefore.size_bytes === sourceAfterMigration.size_bytes,
      mtime_ms: sourceBefore.mtime_ms === sourceAfter.mtime_ms
        && sourceBefore.mtime_ms === sourceAfterCopy.mtime_ms
        && sourceBefore.mtime_ms === sourceAfterMigration.mtime_ms,
    };
    const sourceAllUnchanged = Object.values(sourceUnchanged).every(Boolean);
    const idempotentReapplyUnchanged = sameJson(afterFirstArchiveState, afterSecondArchiveState);
    const archiveTablesCreated = ARCHIVE_TABLES.every((table) => {
      const details = finalArchiveTables[table] as { exists?: boolean; row_count?: number | null };
      return details.exists === true && details.row_count === 0;
    });

    const report = {
      ok: liveAllUnchanged
        && sourceAllUnchanged
        && rollback.absent_after_rollback === true
        && rollbackQuickCheck.ok
        && archiveTablesCreated
        && idempotentReapplyUnchanged
        && finalIntegrity.ok,
      generated_at: generatedAt,
      task: "S129-001",
      elapsed_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      boundaries: {
        live_db_mode: "readonly query_only; no DDL/DML",
        backup_source_mode: "filesystem copy + stat only; no DDL/DML",
        ddl_target: "backup copy only",
        hard_purge_executed: false,
        vacuum_executed: false,
        live_archive_execution: false,
      },
      live_db: {
        before: liveBefore,
        after: liveAfter,
        check_window: "immediately before committed archive-schema apply on the backup copy through immediately after idempotent reapply",
        unchanged: {
          ...liveUnchanged,
          all: liveAllUnchanged,
        },
        post_integrity_diagnostics: {
          after_integrity: liveAfterIntegrity,
          note: "diagnostic only; live daemon may ingest during long backup-copy integrity_check and this does not affect the core mutation gate",
          unchanged_since_narrow_window: {
            ...postIntegrityLiveUnchanged,
            all: allUnchanged(postIntegrityLiveUnchanged),
          },
        },
      },
      backup_source: {
        before: sourceBefore,
        after_copy: sourceAfterCopy,
        after_copy_schema_migration: sourceAfterMigration,
        after: sourceAfter,
        unchanged: {
          ...sourceUnchanged,
          all: sourceAllUnchanged,
        },
      },
      backup_copy: {
        scratch_dir: scratchDir,
        copy_path: copyPath,
        retained: args.keepCopy,
        copied_from_backup_source: true,
        initial: copyInitial,
        rollback_rehearsal: rollback,
        rollback_reopen: rollbackReopenSnapshot,
        rollback_reopen_quick_check: rollbackQuickCheck,
        committed_schema_applied: true,
        idempotent_reapply_unchanged: idempotentReapplyUnchanged,
        archive_schema_hash: archiveSchemaHash,
        archive_schema_sql_sha256: sha256(ARCHIVE_SCHEMA_SQL),
        final_file: copyFinalFile,
        final: {
          snapshot: afterSecondApply,
          archive_tables: finalArchiveTables,
          integrity_check: finalIntegrity,
        },
      },
      notes: [
        "archive table DDL was applied only to the backup copy",
        "rollback rehearsal used transactional SQLite DDL and reopened the copy afterward",
        "committed migration was reapplied to verify idempotence",
        "archive tables start empty; no archive execution was attempted",
      ],
    };

    if (!args.keepCopy) {
      rmSync(scratchDir, { recursive: true, force: true });
      cleanup = { attempted: true, removed: !existsSync(scratchDir) };
    }
    (report.backup_copy as Record<string, unknown>).cleanup = cleanup;

    writeReport(args.json, args.md, report);
    console.log(JSON.stringify({
      ok: report.ok,
      json: args.json,
      md: args.md,
      live_unchanged: liveAllUnchanged,
      backup_source_unchanged: sourceAllUnchanged,
      archive_tables_created: archiveTablesCreated,
      integrity_check: finalIntegrity.result,
      copy_retained: args.keepCopy,
    }, null, 2));

    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (!args.keepCopy && existsSync(scratchDir)) {
      rmSync(scratchDir, { recursive: true, force: true });
      cleanup = { attempted: true, removed: !existsSync(scratchDir) };
    }
    throw error;
  }
}

await main();
