import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI = readFileSync(join(ROOT, "scripts/harness-mem"), "utf8");
const CLIENT = readFileSync(join(ROOT, "scripts/harness-mem-client.sh"), "utf8");

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
});
