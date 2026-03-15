/**
 * §54 S54-005: audit_log search_hit カバレッジ検証
 *
 * mem_audit_log の search_hit 蓄積状況を検査し、
 * retrospective-eval に十分なデータがあるかを判定する。
 *
 * 使用方法: bun run memory-server/src/benchmark/audit-coverage-check.ts <db-path> [output-path]
 */

import { Database } from "bun:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AuditCoverageReport {
  schema_version: "audit-coverage-v1";
  generated_at: string;
  db_path: string;
  summary: {
    total_audit_entries: number;
    search_hit_count: number;
    search_miss_count: number;
    unique_queries: number;
    unique_projects: number;
    date_range: { earliest: string | null; latest: string | null };
    avg_hits_per_query: number;
  };
  readiness: {
    min_hits_required: number;
    current_hits: number;
    sufficient: boolean;
    recommendation: string;
  };
  by_project: Array<{
    project: string;
    hit_count: number;
    unique_queries: number;
    latest_hit: string;
  }>;
}

export const MIN_HITS_FOR_RETRO = 10;
export const RECOMMENDED_HITS = 50;

export function checkAuditCoverage(dbPath: string): AuditCoverageReport {
  const db = new Database(dbPath, { readonly: true });
  try {
    // 1. 全体統計
    type CountRow = { cnt: number };
    const totalEntries = db.query<CountRow, []>(`SELECT COUNT(*) as cnt FROM mem_audit_log`).get()?.cnt ?? 0;

    const searchHitCount = db.query<CountRow, []>(
      `SELECT COUNT(*) as cnt FROM mem_audit_log WHERE action = 'search_hit'`
    ).get()?.cnt ?? 0;

    const searchMissCount = db.query<CountRow, []>(
      `SELECT COUNT(*) as cnt FROM mem_audit_log WHERE action = 'search_miss'`
    ).get()?.cnt ?? 0;

    // 2. ユニーククエリ数
    const uniqueQueries = db.query<CountRow, []>(`
      SELECT COUNT(DISTINCT json_extract(details_json, '$.query')) as cnt
      FROM mem_audit_log
      WHERE action = 'search_hit'
        AND json_extract(details_json, '$.query') IS NOT NULL
    `).get()?.cnt ?? 0;

    // 3. ユニークプロジェクト数
    const uniqueProjects = db.query<CountRow, []>(`
      SELECT COUNT(DISTINCT json_extract(details_json, '$.project')) as cnt
      FROM mem_audit_log
      WHERE action = 'search_hit'
    `).get()?.cnt ?? 0;

    // 4. 日付範囲
    type DateRow = { earliest: string | null; latest: string | null };
    const dateRange = db.query<DateRow, []>(`
      SELECT MIN(created_at) as earliest, MAX(created_at) as latest
      FROM mem_audit_log
      WHERE action = 'search_hit'
    `).get() ?? { earliest: null, latest: null };

    // 5. プロジェクト別統計
    type ProjectRow = { project: string; hit_count: number; unique_queries: number; latest_hit: string };
    const byProject = db.query<ProjectRow, []>(`
      SELECT
        json_extract(details_json, '$.project') as project,
        COUNT(*) as hit_count,
        COUNT(DISTINCT json_extract(details_json, '$.query')) as unique_queries,
        MAX(created_at) as latest_hit
      FROM mem_audit_log
      WHERE action = 'search_hit'
      GROUP BY project
      ORDER BY hit_count DESC
      LIMIT 20
    `).all();

    // 6. 十分性判定
    const sufficient = searchHitCount >= MIN_HITS_FOR_RETRO;
    let recommendation: string;
    if (searchHitCount === 0) {
      recommendation = "No search_hit data. Use harness-mem search to accumulate data.";
    } else if (searchHitCount < MIN_HITS_FOR_RETRO) {
      recommendation = `Need ${MIN_HITS_FOR_RETRO - searchHitCount} more search_hit entries for retrospective-eval.`;
    } else if (searchHitCount < RECOMMENDED_HITS) {
      recommendation = `Sufficient for basic eval. ${RECOMMENDED_HITS - searchHitCount} more hits recommended for statistical significance.`;
    } else {
      recommendation = "Excellent coverage. Ready for full retrospective evaluation.";
    }

    const avgHitsPerQuery = uniqueQueries > 0 ? searchHitCount / uniqueQueries : 0;

    return {
      schema_version: "audit-coverage-v1",
      generated_at: new Date().toISOString(),
      db_path: dbPath,
      summary: {
        total_audit_entries: totalEntries,
        search_hit_count: searchHitCount,
        search_miss_count: searchMissCount,
        unique_queries: uniqueQueries,
        unique_projects: uniqueProjects,
        date_range: dateRange,
        avg_hits_per_query: avgHitsPerQuery,
      },
      readiness: {
        min_hits_required: MIN_HITS_FOR_RETRO,
        current_hits: searchHitCount,
        sufficient,
        recommendation,
      },
      by_project: byProject,
    };
  } finally {
    db.close();
  }
}

// CLI
if (import.meta.main) {
  const [, , dbPathArg, outputPath] = process.argv;
  if (!dbPathArg) {
    console.error("Usage: bun audit-coverage-check.ts <db-path> [output-path]");
    process.exit(1);
  }

  const dbPath = resolve(dbPathArg);
  if (!existsSync(dbPath)) {
    console.error(`DB not found: ${dbPath}`);
    process.exit(1);
  }

  const report = checkAuditCoverage(dbPath);

  console.log(`[audit-coverage] DB: ${dbPath}`);
  console.log(`[audit-coverage] search_hit: ${report.summary.search_hit_count}, unique queries: ${report.summary.unique_queries}`);
  console.log(`[audit-coverage] Sufficient: ${report.readiness.sufficient ? "YES" : "NO"}`);
  console.log(`[audit-coverage] ${report.readiness.recommendation}`);

  if (report.by_project.length > 0) {
    console.log(`[audit-coverage] By project:`);
    for (const p of report.by_project) {
      console.log(`  ${p.project}: ${p.hit_count} hits, ${p.unique_queries} queries`);
    }
  }

  const reportJson = JSON.stringify(report, null, 2);

  if (outputPath) {
    writeFileSync(resolve(outputPath), reportJson);
    console.log(`[audit-coverage] Report written to ${outputPath}`);
  }

  process.exit(report.readiness.sufficient ? 0 : 1);
}
