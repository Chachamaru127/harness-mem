/**
 * §54 S54-005: audit-coverage-check ユニットテスト
 */

import { describe, test, expect } from "bun:test";
import { MIN_HITS_FOR_RETRO, RECOMMENDED_HITS, checkAuditCoverage } from "../../src/benchmark/audit-coverage-check";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

describe("audit-coverage-check constants", () => {
  test("MIN_HITS_FOR_RETRO is reasonable", () => {
    expect(MIN_HITS_FOR_RETRO).toBeGreaterThanOrEqual(5);
    expect(MIN_HITS_FOR_RETRO).toBeLessThanOrEqual(50);
  });

  test("RECOMMENDED_HITS > MIN_HITS_FOR_RETRO", () => {
    expect(RECOMMENDED_HITS).toBeGreaterThan(MIN_HITS_FOR_RETRO);
  });
});

const realDbPath = join(homedir(), ".harness-mem", "harness-mem.db");
const hasRealDb = existsSync(realDbPath);

describe("checkAuditCoverage (real DB)", () => {
  test.skipIf(!hasRealDb)("produces valid report from real DB", () => {
    const report = checkAuditCoverage(realDbPath);
    expect(report.schema_version).toBe("audit-coverage-v1");
    expect(typeof report.generated_at).toBe("string");
    expect(report.summary.total_audit_entries).toBeGreaterThanOrEqual(0);
    expect(report.summary.search_hit_count).toBeGreaterThanOrEqual(0);
    expect(typeof report.readiness.sufficient).toBe("boolean");
    expect(typeof report.readiness.recommendation).toBe("string");
  });
});
