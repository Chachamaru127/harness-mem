#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { getConfig } from "../memory-server/src/core/core-utils";
import { runSummaryBatch } from "../memory-server/src/core/summary-runner";

const sessionLimit = Number(process.argv[2] ?? 1);
if (!Number.isInteger(sessionLimit) || sessionLimit < 1 || sessionLimit > 100) throw new Error("session limit must be 1..100");
const config = getConfig();
if (!["codex-app-server", "claude-code"].includes(config.summaryBackend ?? "") || !config.summaryEnabled || !config.cloudLlmEnabled) throw new Error("explicit cloud summary opt-in required");
config.summaryConcurrency = 4;
config.clairicEnabled = false;
const db = new Database(config.dbPath);
db.exec("PRAGMA busy_timeout=30000");
try {
  for (let offset = 0, batch = 1; offset < sessionLimit; batch++) {
    config.summaryMaxSessions = Math.min(4, sessionLimit - offset);
    let result;
    try {
      result = await runSummaryBatch(db, config);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const reason = typeof code === "string" && /^SQLITE_[A-Z_]+$/.test(code) ? code : "summary_batch_setup_error";
      console.error(JSON.stringify({ batch, concurrency: 4, model: config.summaryModel,
        scanned: 0, summarized: 0, blocked: 0, failed: 1, failureReasons: [reason] }));
      process.exitCode = 1;
      break;
    }
    console.log(JSON.stringify({ batch, concurrency: 4, model: config.summaryModel, ...result }));
    if (result.failed || result.skipped === "no_sessions") break;
    offset += config.summaryMaxSessions;
    await Bun.sleep(1000);
  }
} finally { db.close(); }
