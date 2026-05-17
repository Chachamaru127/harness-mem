/**
 * One-shot child process for S124-007 vector backfill work.
 *
 * The daemon owns scheduling/status, but the expensive compact/reindex tick
 * runs in this separate Bun process so the HTTP server event loop stays
 * responsive.
 */

import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
import type { VectorBackfillOperation } from "../core/vector-backfill-worker";
import type { ApiResponse } from "../core/types";

function parseOperation(raw: string | undefined): VectorBackfillOperation {
  if (!raw) {
    throw new Error("missing vector backfill operation JSON");
  }
  const parsed = JSON.parse(raw) as Partial<VectorBackfillOperation>;
  if (parsed.type === "compact") {
    if (typeof parsed.model !== "string" || !parsed.model.trim()) {
      throw new Error("compact operation requires model");
    }
    if (typeof parsed.dimension !== "number" || !Number.isFinite(parsed.dimension)) {
      throw new Error("compact operation requires numeric dimension");
    }
    if (typeof parsed.limit !== "number" || !Number.isFinite(parsed.limit)) {
      throw new Error("compact operation requires numeric limit");
    }
    return {
      type: "compact",
      model: parsed.model,
      dimension: parsed.dimension,
      limit: parsed.limit,
      rebuild_before: typeof parsed.rebuild_before === "string" && parsed.rebuild_before.trim()
        ? parsed.rebuild_before.trim()
        : undefined,
    };
  }
  if (parsed.type === "reindex") {
    if (typeof parsed.limit !== "number" || !Number.isFinite(parsed.limit)) {
      throw new Error("reindex operation requires numeric limit");
    }
    return {
      type: "reindex",
      limit: parsed.limit,
      status_counts: parsed.status_counts === false ? false : true,
    };
  }
  throw new Error("unknown vector backfill operation type");
}

function numberFrom(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function responseItem(response: ApiResponse): Record<string, unknown> {
  return (Array.isArray(response.items) && response.items[0]
    ? response.items[0]
    : {}) as Record<string, unknown>;
}

function compactSubBatchCount(): number {
  const raw = Number(process.env.HARNESS_MEM_VECTOR_BACKFILL_COMPACT_SUB_BATCHES || 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(10, Math.trunc(raw)));
}

function mergeCompactResponses(
  lastResponse: ApiResponse,
  aggregate: {
    repaired: number;
    skipped: number;
    failed: number;
    sub_batches: number;
    sub_batch_size: number;
  },
): ApiResponse {
  const baseItem = responseItem(lastResponse);
  return {
    ...lastResponse,
    items: [
      {
        ...baseItem,
        repaired: aggregate.repaired,
        skipped: aggregate.skipped,
        failed: aggregate.failed,
        sub_batches: aggregate.sub_batches,
        sub_batch_size: aggregate.sub_batch_size,
      },
    ],
    meta: {
      ...lastResponse.meta,
      repaired: aggregate.repaired,
      skipped: aggregate.skipped,
      failed: aggregate.failed,
      sub_batches: aggregate.sub_batches,
      sub_batch_size: aggregate.sub_batch_size,
    },
  };
}

function runCompactOperation(core: HarnessMemCore, operation: Extract<VectorBackfillOperation, { type: "compact" }>): ApiResponse {
  const subBatches = compactSubBatchCount();
  let lastResponse: ApiResponse | null = null;
  const aggregate = {
    repaired: 0,
    skipped: 0,
    failed: 0,
    sub_batches: 0,
    sub_batch_size: operation.limit,
  };
  for (let index = 0; index < subBatches; index += 1) {
    const response = core.repairSqliteVecMap({
      model: operation.model,
      dimension: operation.dimension,
      limit: operation.limit,
      execute: true,
      rebuild_existing: true,
      rebuild_before: operation.rebuild_before,
      status_counts: false,
    });
    const item = responseItem(response);
    const repaired = numberFrom(item.repaired);
    aggregate.repaired += repaired;
    aggregate.skipped += numberFrom(item.skipped);
    aggregate.failed += numberFrom(item.failed);
    aggregate.sub_batches += 1;
    lastResponse = response;
    if (repaired === 0 || aggregate.failed > 0) {
      break;
    }
  }
  if (!lastResponse) {
    throw new Error("compact operation produced no response");
  }
  return mergeCompactResponses(lastResponse, aggregate);
}

async function main(): Promise<void> {
  const operation = parseOperation(process.argv[2]);
  const config = {
    ...getConfig(),
    backgroundWorkersEnabled: false,
  };
  const core = new HarnessMemCore(config);
  try {
    const response =
      operation.type === "compact"
        ? runCompactOperation(core, operation)
        : await core.reindexVectors(operation.limit, {
            status_counts: operation.status_counts !== false,
          });
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    core.shutdown("vector-backfill-child");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
