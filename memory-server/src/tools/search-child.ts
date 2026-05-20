/**
 * One-shot child process for normal search.
 *
 * The HTTP daemon awaits this process asynchronously, so synchronous SQLite
 * search work cannot freeze the daemon's Bun event loop.
 */

import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
import type { SearchRequest } from "../core/types";

async function readPayload(label: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of process.stdin) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) {
    throw new Error(`missing ${label} JSON`);
  }
  return text;
}

async function parseSearchRequest(): Promise<SearchRequest> {
  const payload = await readPayload("search request");
  if (!payload) {
    throw new Error("missing search request JSON");
  }
  const parsed = JSON.parse(payload) as Partial<SearchRequest>;
  if (typeof parsed.query !== "string" || parsed.query.trim().length === 0) {
    throw new Error("search child requires query");
  }
  return parsed as SearchRequest;
}

async function testDelayIfRequested(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  const delayMs = Number(process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS || 0);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await Bun.sleep(Math.min(5_000, Math.floor(delayMs)));
  }
}

async function main(): Promise<void> {
  const request = await parseSearchRequest();
  const core = new HarnessMemCore({
    ...getConfig(),
    backgroundWorkersEnabled: false,
  });
  try {
    await testDelayIfRequested();
    if (request.safe_mode !== true && request.vector_search !== false) {
      await core.primeEmbedding(request.query || "", "query");
    }
    const response = core.search(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    core.shutdown("search-child");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
