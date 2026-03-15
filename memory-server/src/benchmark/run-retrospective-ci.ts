/**
 * §54 S54-004: Retrospective-Eval CI ラッパー
 *
 * 使用方法: bun run memory-server/src/benchmark/run-retrospective-ci.ts [db-path]
 * 環境変数: HARNESS_MEM_DB_PATH — DB パス（引数より優先度低）
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { runRetrospectiveEval, sampleSearchHits, type RetroReport } from "./retrospective-eval";
import { Database } from "bun:sqlite";

export const RESULTS_DIR = join(import.meta.dir, "results");
export const LATEST_PATH = join(RESULTS_DIR, "retrospective-latest.json");
export const HISTORY_PATH = join(RESULTS_DIR, "retrospective-history.jsonl");
export const MIN_SEARCH_HITS = 10;
export const REGRESSION_THRESHOLD = 0.05; // -5pp で失敗

export function resolveDbPath(arg?: string): string {
  if (arg && existsSync(arg)) return resolve(arg);
  const envPath = process.env.HARNESS_MEM_DB_PATH;
  if (envPath && existsSync(envPath)) return resolve(envPath);
  const defaultPath = join(homedir(), ".harness-mem", "harness-mem.db");
  if (existsSync(defaultPath)) return defaultPath;
  throw new Error("No harness-mem.db found. Provide path as argument or set HARNESS_MEM_DB_PATH.");
}

export function checkMinSearchHits(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const hits = sampleSearchHits(db, MIN_SEARCH_HITS);
    return hits.length;
  } finally {
    db.close();
  }
}

export function loadPreviousReport(): RetroReport | null {
  if (!existsSync(LATEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LATEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function checkRegression(
  current: RetroReport,
  previous: RetroReport | null
): { passed: boolean; message: string } {
  if (!previous || previous.algo_v34.n_queries === 0) {
    return { passed: true, message: "No previous baseline to compare against." };
  }
  const delta = current.algo_v34.recall_at_10 - previous.algo_v34.recall_at_10;
  if (delta < -REGRESSION_THRESHOLD) {
    return {
      passed: false,
      message: `Regression detected: recall@10 dropped ${(-delta * 100).toFixed(1)}pp (${previous.algo_v34.recall_at_10.toFixed(4)} → ${current.algo_v34.recall_at_10.toFixed(4)})`,
    };
  }
  return {
    passed: true,
    message: `OK: recall@10 delta=${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`,
  };
}

// CLI
if (import.meta.main) {
  const dbPath = resolveDbPath(process.argv[2]);
  console.log(`[retro-ci] DB: ${dbPath}`);

  const hitCount = checkMinSearchHits(dbPath);
  if (hitCount < MIN_SEARCH_HITS) {
    console.log(`[retro-ci] SKIP: Only ${hitCount} search_hit entries found (need ${MIN_SEARCH_HITS}+)`);
    process.exit(0); // スキップ（失敗ではない）
  }
  console.log(`[retro-ci] Found ${hitCount} search_hit entries`);

  mkdirSync(RESULTS_DIR, { recursive: true });

  const previous = loadPreviousReport();
  const report = await runRetrospectiveEval(dbPath, 100, LATEST_PATH);

  // Append to history
  appendFileSync(
    HISTORY_PATH,
    JSON.stringify({
      ...report,
      _ci_run_at: new Date().toISOString(),
    }) + "\n"
  );

  const regression = checkRegression(report, previous);
  console.log(`[retro-ci] ${regression.message}`);
  console.log(
    `[retro-ci] v34 recall@10=${report.algo_v34.recall_at_10.toFixed(4)}, queries=${report.algo_v34.n_queries}`
  );

  process.exit(regression.passed ? 0 : 1);
}
