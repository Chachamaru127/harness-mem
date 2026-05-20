/**
 * One-shot child process for deferred observation derived data.
 *
 * Checkpoint writes are durable first, then the daemon schedules this bounded
 * child to materialize vectors/entities/links/nuggets without blocking HTTP.
 */

import { HarnessMemCore, getConfig } from "../core/harness-mem-core";

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

async function parseRequest(): Promise<{ observation_id: string }> {
  const payload = await readPayload("observation materialize request");
  const parsed = JSON.parse(payload) as Partial<{ observation_id: unknown }>;
  if (typeof parsed.observation_id !== "string" || parsed.observation_id.trim().length === 0) {
    throw new Error("observation materialization child requires observation_id");
  }
  return { observation_id: parsed.observation_id.trim() };
}

async function main(): Promise<void> {
  const request = await parseRequest();
  const core = new HarnessMemCore({
    ...getConfig(),
    backgroundWorkersEnabled: false,
  });
  try {
    const response = core.materializeObservationDerivedData(request.observation_id);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    core.shutdown("observation-materialize-child");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
