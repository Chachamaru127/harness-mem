import { createInterface } from "node:readline";
import { Database } from "bun:sqlite";
import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
import {
  PERIODIC_INGEST_SOURCES,
  type PeriodicIngestSource,
} from "../core/ingest-coordinator";

function parseEnvelope(line: string): { id: string; source: PeriodicIngestSource } {
  const value = JSON.parse(line) as { id?: unknown; source?: unknown };
  if (typeof value.id !== "string" || !value.id) throw new Error("invalid request id");
  if (typeof value.source !== "string" || !PERIODIC_INGEST_SOURCES.includes(value.source as PeriodicIngestSource)) {
    throw new Error("invalid periodic ingest source");
  }
  return { id: value.id, source: value.source as PeriodicIngestSource };
}

function writeReply(
  id: string,
  result: { ok: boolean; error_code?: string; retryable?: boolean }
): void {
  process.stdout.write(`${JSON.stringify({ id, ...result })}\n`);
}

async function main(): Promise<void> {
  const core = new HarnessMemCore({ ...getConfig(), backgroundWorkersEnabled: false });
  let stopping = false;
  let embeddingWarmed = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    await core.shutdown(signal);
    process.exit(0);
  };
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (stopping || !line.trim()) continue;
      let id = "invalid";
      try {
        const request = parseEnvelope(line);
        id = request.id;
        if (!embeddingWarmed) {
          try {
            await core.warmEmbedding("harness mem ingest warmup", "passage");
            embeddingWarmed = true;
          } catch {
            writeReply(id, { ok: false, error_code: "embedding_temporarily_unavailable", retryable: true });
            continue;
          }
        }
        const testDelayMs = process.env.NODE_ENV === "test"
          ? Number(process.env.HARNESS_MEM_TEST_INGEST_WORKER_BLOCK_MS || 0)
          : 0;
        if (Number.isFinite(testDelayMs) && testDelayMs > 0) {
          const testDb = new Database(getConfig().dbPath);
          const iterations = Math.min(25_000_000, Math.max(1, Math.floor(testDelayMs * 12_500)));
          testDb.query(`
            WITH RECURSIVE counter(value) AS (
              VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < ?
            )
            SELECT sum(value) FROM counter
          `).get(iterations);
          testDb.close();
        }
        writeReply(id, await core.runPeriodicIngestTickLocal(request.source));
      } catch {
        writeReply(id, { ok: false, error_code: "worker_failure" });
      }
    }
  } finally {
    await core.shutdown("periodic-ingest-worker-eof");
  }
}

void main();
