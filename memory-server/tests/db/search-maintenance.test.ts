import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema } from "../../src/db/schema";
import { runSearchDbMaintenanceIfDue } from "../../src/db/search-maintenance";

describe("search-maintenance", () => {
  test("runs ANALYZE once and respects interval", () => {
    const db = new Database(":memory:");
    configureDatabase(db);
    initSchema(db);

    const audits: Array<{ action: string; details: Record<string, unknown> }> = [];
    const writeAudit = (action: string, _targetType: string, _targetId: string, details: Record<string, unknown>) => {
      audits.push({ action, details });
      db.query(
        `INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(action, "test", "database", "", JSON.stringify(details), new Date().toISOString());
    };
    const first = runSearchDbMaintenanceIfDue(db, {
      ftsEnabled: false,
      writeAudit,
      force: true,
    });
    expect(first.ran).toBe(true);

    const second = runSearchDbMaintenanceIfDue(db, {
      ftsEnabled: false,
      writeAudit,
      nowMs: Date.now() + 1_000,
    });
    expect(second.ran).toBe(false);
    expect(second.reason).toBe("interval_not_elapsed");
    expect(audits.some((entry) => entry.action === "admin.search_db_maintenance")).toBe(true);
    db.close();
  });
});
