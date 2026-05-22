/**
 * Persistent worker for normal search.
 *
 * The daemon owns HTTP and readiness; this process owns synchronous sqlite-vec
 * KNN, lexical search, and local embedding warm-up. Protocol is newline-delimited JSON over
 * stdin/stdout so the parent can keep one warm worker instead of launching a
 * fresh Bun process per search.
 */

import { createInterface } from "node:readline";
import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
import { initializeTelemetry, recordRecallTelemetry, resolveHarnessMemVersion, shutdownTelemetry } from "../telemetry/otel";
import type { ApiResponse, SearchRequest } from "../core/types";

interface SearchWorkerRequestEnvelope {
  id?: unknown;
  request?: unknown;
}

interface SearchWorkerResponseEnvelope {
  type?: string;
  pid?: number;
  id: string;
  ok: boolean;
  response?: ApiResponse;
  error?: string;
  warmup_ms?: number | null;
  warmup_error?: string;
}

interface SearchWorkerWarmupState {
  done: boolean;
  warmup_ms: number | null;
  warmup_error?: string;
}

function writeProtocol(message: Record<string, unknown> | SearchWorkerResponseEnvelope): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseSearchRequest(raw: unknown): SearchRequest {
  const parsed = raw as Partial<SearchRequest>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("search worker request must be an object");
  }
  if (typeof parsed.query !== "string" || parsed.query.trim().length === 0) {
    throw new Error("search worker requires query");
  }
  return parsed as SearchRequest;
}

function parseEnvelope(line: string): { id: string; request: SearchRequest } {
  const parsed = JSON.parse(line) as SearchWorkerRequestEnvelope;
  if (typeof parsed.id !== "string" || parsed.id.trim().length === 0) {
    throw new Error("search worker envelope requires id");
  }
  return {
    id: parsed.id,
    request: parseSearchRequest(parsed.request),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function recallScope(request: SearchRequest): "project_session" | "project" | "session" | "none" {
  if (request.project && request.session_id) return "project_session";
  if (request.project) return "project";
  if (request.session_id) return "session";
  return "none";
}

async function warmWorker(core: HarnessMemCore): Promise<{ warmup_ms: number; warmup_error?: string }> {
  const startedAt = performance.now();
  try {
    await core.primeEmbedding(
      process.env.HARNESS_MEM_SEARCH_WORKER_PRIME_TEXT || "harness mem search worker warmup",
      "query",
    );
    return { warmup_ms: Number((performance.now() - startedAt).toFixed(2)) };
  } catch (error) {
    return {
      warmup_ms: Number((performance.now() - startedAt).toFixed(2)),
      warmup_error: errorMessage(error).slice(0, 1_000),
    };
  }
}

function isEmbeddingReady(core: HarnessMemCore): boolean {
  const response = core.readiness();
  const item = response.items[0] as { embedding_ready?: unknown; embedding_readiness_state?: unknown } | undefined;
  return item?.embedding_ready !== false && item?.embedding_readiness_state !== "warming";
}

async function runSearch(
  core: HarnessMemCore,
  id: string,
  request: SearchRequest,
  warmupState: SearchWorkerWarmupState,
): Promise<void> {
  const startedAt = performance.now();
  try {
    let effectiveRequest = request;
    let workerFallback: Record<string, unknown> | null = null;
    if (request.safe_mode !== true && request.vector_search !== false) {
      if (warmupState.done && isEmbeddingReady(core)) {
        await core.primeEmbedding(request.query || "", "query");
      } else {
        effectiveRequest = {
          ...request,
          safe_mode: true,
          vector_search: false,
          expand_links: false,
          graph_depth: 0,
          graph_weight: 0,
        };
        workerFallback = {
          fallback: "safe_lexical",
          warmup_pending: !warmupState.done,
          warmup_ms: warmupState.warmup_ms,
          warmup_error: warmupState.warmup_error,
        };
      }
    }
    const response = core.search(effectiveRequest);
    if (workerFallback) {
      response.meta = {
        ...response.meta,
        search_worker: workerFallback,
      };
    }
    recordRecallTelemetry(
      "recall.worker",
      {
        "harness.result": response.ok ? "ok" : "error",
        "recall.scope": recallScope(request),
        "recall.project_present": Boolean(request.project),
        "recall.session_present": Boolean(request.session_id),
        "recall.include_private": request.include_private === true,
        "recall.safe_mode": request.safe_mode === true,
        "recall.limit": request.limit ?? 20,
        "recall.worker.mode": "persistent_worker_process",
        "recall.worker.fallback": workerFallback ? "safe_lexical" : "none",
        "recall.worker.warmup_pending": !warmupState.done,
        "recall.worker.queue_depth": 0,
      },
      {
        recall_latency_ms: Number((performance.now() - startedAt).toFixed(2)),
        fallback_count: workerFallback ? 1 : 0,
        worker_queue_depth: 0,
      },
    );
    writeProtocol({ id, ok: true, response });
  } catch (error) {
    recordRecallTelemetry(
      "recall.worker",
      {
        "harness.result": "error",
        "harness.error_code": "search_worker_error",
        "recall.scope": recallScope(request),
        "recall.project_present": Boolean(request.project),
        "recall.session_present": Boolean(request.session_id),
        "recall.include_private": request.include_private === true,
        "recall.safe_mode": request.safe_mode === true,
        "recall.limit": request.limit ?? 20,
        "recall.worker.mode": "persistent_worker_process",
        "recall.worker.queue_depth": 0,
      },
      {
        recall_latency_ms: Number((performance.now() - startedAt).toFixed(2)),
        worker_queue_depth: 0,
      },
    );
    writeProtocol({ id, ok: false, error: errorMessage(error).slice(0, 2_000) });
  }
}

async function main(): Promise<void> {
  initializeTelemetry({
    serviceName: "harness-mem-search-worker",
    serviceVersion: resolveHarnessMemVersion(),
    component: "search-worker",
    resourceAttributes: {
      "harness.worker.kind": "search",
    },
  });
  const core = new HarnessMemCore({
    ...getConfig(),
    backgroundWorkersEnabled: false,
  });
  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      core.shutdown(reason);
    } finally {
      const telemetry = await shutdownTelemetry(reason);
      if (telemetry.exporter.last_flush_ok === false) {
        console.error(`telemetry flush failed: ${telemetry.exporter.last_flush_error}`);
      }
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  const warmupState: SearchWorkerWarmupState = {
    done: false,
    warmup_ms: null,
  };
  writeProtocol({
    type: "ready",
    pid: process.pid,
    warmup_ms: null,
  });
  void warmWorker(core).then((warmup) => {
    warmupState.done = true;
    warmupState.warmup_ms = warmup.warmup_ms;
    warmupState.warmup_error = warmup.warmup_error;
    writeProtocol({
      type: "warmup",
      pid: process.pid,
      ...warmup,
    });
  });

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (shuttingDown) {
        break;
      }
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const { id, request } = parseEnvelope(trimmed);
        await runSearch(core, id, request, warmupState);
      } catch (error) {
        writeProtocol({
          id: "unknown",
          ok: false,
          error: errorMessage(error).slice(0, 2_000),
        });
      }
    }
  } finally {
    core.shutdown("search-worker-eof");
    const telemetry = await shutdownTelemetry("search-worker-eof");
    if (telemetry.exporter.last_flush_ok === false) {
      console.error(`telemetry flush failed: ${telemetry.exporter.last_flush_error}`);
    }
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
