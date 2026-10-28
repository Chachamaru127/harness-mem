#!/usr/bin/env bun
/**
 * Dedicated Stage 1 triage loop. Runs the same runTriageBatch used by the
 * daemon, but back-to-back, so triage does not wait behind summary,
 * consolidation, or WAL checkpoint tasks in the maintenance worker.
 *
 * The daemon's own triage timer must be off (HARNESS_MEM_TRIAGE_ENABLED=0 in
 * run-daemon.sh); running both would call Jev twice for the same rows.
 *
 * Usage: ~/.harness-mem/run-triage-loop.sh
 */
import { Database } from "bun:sqlite";
import { getConfig } from "../memory-server/src/core/harness-mem-core";
import { runTriageBatch } from "../memory-server/src/core/triage-runner";

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const maxBatches = Number(value("--max-batches") ?? Infinity);
const limit = value("--limit");
const concurrency = value("--concurrency");
if (maxBatches !== Infinity && (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100)) throw new Error("max batches must be 1..100");
if (limit && (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 1000)) throw new Error("limit must be 1..1000");
if (concurrency && (!Number.isInteger(Number(concurrency)) || Number(concurrency) < 1 || Number(concurrency) > 8)) throw new Error("concurrency must be 1..8");
const config = getConfig();
if (limit) config.triageMaxPerTick = Number(limit);
if (concurrency) config.triageConcurrency = Number(concurrency);
if (config.triageEnabled !== true || config.cloudLlmEnabled !== true) {
  console.error(JSON.stringify({ error: "triage_disabled", ts: new Date().toISOString() }));
  process.exit(1);
}

const db = new Database(config.dbPath);
db.exec("PRAGMA busy_timeout=30000;");

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

let batches = 0;
while (!stopping && batches < maxBatches) {
  try {
    const result = await runTriageBatch(db, config);
    batches++;
    if (result.skipped === "no_rows") {
      console.log(JSON.stringify({ ...result, ts: new Date().toISOString() }));
      if (args.includes("--idle-exit")) break;
      await Bun.sleep(60_000);
      continue;
    }
    if (result.skipped) {
      console.error(JSON.stringify({ ...result, ts: new Date().toISOString() }));
      break;
    }
    console.log(JSON.stringify({ ...result, ts: new Date().toISOString() }));
    if (result.retryableFailures) break;
    await Bun.sleep(1_000);
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        ts: new Date().toISOString(),
      }),
    );
    if (maxBatches !== Infinity) break;
    await Bun.sleep(5_000);
  }
}

db.close();
