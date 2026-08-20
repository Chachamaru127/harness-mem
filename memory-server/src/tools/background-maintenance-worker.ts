import { createInterface } from "node:readline";
import { Database } from "bun:sqlite";
import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
import type { ConsolidationRunRequest } from "../core/types";
import {
  resolveSchedulerConsolidationLimit,
  type MaintenanceTask,
} from "../core/background-maintenance-worker-client";

type WorkerTask = MaintenanceTask | "recover_consolidation";

interface RequestEnvelope {
  id: string;
  task: WorkerTask;
  request?: ConsolidationRunRequest;
}

function parseEnvelope(line: string): RequestEnvelope {
  const value = JSON.parse(line) as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) throw new Error("invalid request id");
  if (value.task !== "consolidation" && value.task !== "wal_checkpoint" && value.task !== "recover_consolidation") {
    throw new Error("invalid maintenance task");
  }
  const request = value.request && typeof value.request === "object"
    ? value.request as ConsolidationRunRequest
    : undefined;
  return { id: value.id, task: value.task, request };
}

function writeReply(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function testBlockIfConfigured(): Promise<void> {
  if (process.env.NODE_ENV !== "test") return;
  const blockMs = Number(process.env.HARNESS_MEM_TEST_MAINTENANCE_WORKER_BLOCK_MS || 0);
  if (!Number.isFinite(blockMs) || blockMs <= 0) return;
  const testDb = new Database(":memory:");
  const iterations = Math.min(30_000_000, Math.max(1, Math.floor(blockMs * 15_000)));
  testDb.query(`
    WITH RECURSIVE counter(value) AS (
      VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < ?
    ) SELECT sum(value) FROM counter
  `).get(iterations);
  testDb.close();
}

async function main(): Promise<void> {
  const core = new HarnessMemCore({ ...getConfig(), backgroundWorkersEnabled: false });
  core.recoverMaintenanceConsolidationJobs();
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    await core.shutdown(signal);
    process.exit(0);
  };
  process.once("SIGTERM", () => {
    if (process.env.NODE_ENV === "test" && process.env.HARNESS_MEM_TEST_MAINTENANCE_IGNORE_TERM === "1") return;
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (stopping || !line.trim()) continue;
      let id = "invalid";
      let task: WorkerTask | null = null;
      try {
        const request = parseEnvelope(line);
        id = request.id;
        task = request.task;
        const startedAt = Date.now();
        if (request.task === "recover_consolidation") {
          writeReply({ id, ok: true, result: { recovered: true } });
          continue;
        }
        await testBlockIfConfigured();
        if (request.task === "wal_checkpoint") {
          const result = core.runMaintenanceWalCheckpoint();
          writeReply({ id, ok: true, result, progress: { ...result, elapsed_ms: Date.now() - startedAt } });
          continue;
        }
        const result = await core.runConsolidation(request.request ?? {
          reason: "scheduler",
          limit: resolveSchedulerConsolidationLimit(),
        });
        const item = result.items[0] && typeof result.items[0] === "object"
          ? result.items[0] as Record<string, unknown>
          : {};
        writeReply({ id, ok: true, result, progress: { ...item, elapsed_ms: Date.now() - startedAt } });
      } catch (error) {
        if (task === "consolidation") core.recoverMaintenanceConsolidationJobs();
        const code = (error as { code?: unknown } | null)?.code;
        writeReply({ id, ok: false, error_code: typeof code === "string" ? code : "maintenance_failed" });
      }
    }
  } finally {
    await core.shutdown("background-maintenance-worker-eof");
  }
}

void main();
