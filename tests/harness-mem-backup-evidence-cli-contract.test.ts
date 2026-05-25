import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI = readFileSync(join(ROOT, "scripts/harness-mem"), "utf8");
const CLIENT = readFileSync(join(ROOT, "scripts/harness-mem-client.sh"), "utf8");
const OFFLINE = readFileSync(join(ROOT, "scripts/forget-maintenance-offline.ts"), "utf8");

describe("harness-mem backup evidence CLI contract", () => {
  test("exposes preverified backup evidence without exposing hard purge execute", () => {
    expect(CLI).toContain("backup-evidence");
    expect(CLI).toContain("--backup-path <path>");
    expect(CLI).toContain("--backup-sha256 <hex>");
    expect(CLI).toContain("--candidate-id <id>");
    expect(CLI).toContain("--ttl-seconds <n>");
    expect(CLI).toContain("backup_evidence_impl");
    expect(CLI).toContain("candidate_ids: $candidate_ids");
    expect(CLI).not.toContain("hard-purge execute");
  });

  test("thin client posts to the server-owned backup evidence endpoint", () => {
    expect(CLIENT).toContain("admin-backup-evidence");
    expect(CLIENT).toContain("/v1/admin/forget/backup-evidence");
    expect(CLIENT).toContain("HARNESS_MEM_ADMIN_BACKUP_EVIDENCE_TIMEOUT_SEC");
    expect(CLIENT).toContain("HARNESS_MEM_CLIENT_TIMEOUT_SEC:-8");
    expect(CLIENT).toContain("admin_backup_evidence_failed");
  });

  test("exposes archive-first forget maintenance without hard purge automation", () => {
    expect(CLI).toContain("forget-maintenance");
    expect(CLI).toContain("forget_maintenance_impl");
    expect(CLI).toContain("--force");
    expect(CLIENT).toContain("admin-forget-maintenance");
    expect(CLIENT).toContain("/v1/admin/forget/maintenance");
    expect(CLIENT).toContain("HARNESS_MEM_ADMIN_FORGET_MAINTENANCE_TIMEOUT_SEC");
    expect(CLI).not.toContain("forget-maintenance hard-purge");
  });

  test("offline maintenance runner supports archive-first cleanup through core gates", () => {
    expect(OFFLINE).toContain("--archive-only");
    expect(OFFLINE).toContain("offline_archive_only");
    expect(OFFLINE).toContain("--archive-first");
    expect(OFFLINE).toContain("offline_archive_first_hard_purge");
    expect(OFFLINE).toContain("core.adminForgetArchive");
    expect(OFFLINE).toContain("core.adminForgetBackupEvidence");
    expect(OFFLINE).toContain("core.adminForgetHardPurge");
    expect(OFFLINE).toContain("--limit <1..5000>");
  });

  test("offline maintenance runner gates compaction behind explicit execute", () => {
    expect(OFFLINE).toContain("--compact");
    expect(OFFLINE).toContain("Run VACUUM after execute");
    expect(OFFLINE).toContain("--compact requires --execute");
    expect(OFFLINE).toContain("admin.vacuum.execute");
    expect(OFFLINE).toContain("compactDatabase(core, config.dbPath");
  });

  test("offline maintenance runner supports stale vector cache pruning", () => {
    expect(OFFLINE).toContain("--prune-stale-vectors");
    expect(OFFLINE).toContain("--current-vector-model");
    expect(OFFLINE).toContain("offline_prune_stale_vectors");
    expect(OFFLINE).toContain("admin.vector_cache_prune.execute");
    expect(OFFLINE).toContain("DELETE FROM mem_vectors");
  });
});
