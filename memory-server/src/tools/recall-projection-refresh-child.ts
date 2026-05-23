/**
 * One-shot child process for recall projection refresh.
 *
 * Recall returns degraded fallback immediately when projection is stale; this
 * child rebuilds the scoped hot projection without blocking daemon readiness.
 */

import { HarnessMemCore, getConfig } from "../core/harness-mem-core";

interface RecallProjectionRefreshChildRequest {
  project: string;
  limit?: number;
  include_private?: boolean;
}

async function readPayload(): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of process.stdin) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) {
    throw new Error("missing recall projection refresh request JSON");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function parseRequest(): Promise<RecallProjectionRefreshChildRequest> {
  const payload = await readPayload();
  if (typeof payload.project !== "string" || payload.project.trim().length === 0) {
    throw new Error("recall projection refresh child requires project");
  }
  const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
    ? Math.max(1, Math.floor(payload.limit))
    : undefined;
  return {
    project: payload.project.trim(),
    ...(limit ? { limit } : {}),
    include_private: payload.include_private === true,
  };
}

async function main(): Promise<void> {
  const request = await parseRequest();
  const core = new HarnessMemCore({
    ...getConfig(),
    backgroundWorkersEnabled: false,
  });
  try {
    const response = core.refreshRecallProjection(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    core.shutdown("recall-projection-refresh-child");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
