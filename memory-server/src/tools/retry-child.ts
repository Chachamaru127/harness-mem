/**
 * One-shot child process for retry queue ticks.
 *
 * The daemon owns HTTP and readiness; this child owns the potentially heavy
 * retry-queue SQLite scan and replay work.
 */

import { HarnessMemCore, getConfig } from "../core/harness-mem-core";

interface RetryChildPayload {
  force?: unknown;
}

async function readPayload(): Promise<RetryChildPayload> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of process.stdin) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text) as RetryChildPayload;
}

async function main(): Promise<void> {
  const payload = await readPayload();
  const core = new HarnessMemCore({
    ...getConfig(),
    backgroundWorkersEnabled: false,
  });
  try {
    const response = core.processRetryQueueNow(payload.force === true);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    core.shutdown("retry-child");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
