/**
 * One-shot child process for event writes.
 *
 * The daemon owns HTTP and readiness; this child owns embedding preparation
 * and synchronous SQLite persistence for `/v1/events/record`.
 */

import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
import type { EventEnvelope } from "../core/types";

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

function toStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
}

async function parseEventRequest(): Promise<EventEnvelope> {
  const payload = await readPayload("event request");
  const parsed = JSON.parse(payload) as Partial<EventEnvelope>;
  if (
    typeof parsed.platform !== "string" ||
    typeof parsed.project !== "string" ||
    typeof parsed.session_id !== "string" ||
    typeof parsed.event_type !== "string" ||
    parsed.platform.trim().length === 0 ||
    parsed.project.trim().length === 0 ||
    parsed.session_id.trim().length === 0 ||
    parsed.event_type.trim().length === 0
  ) {
    throw new Error("event child requires platform, project, session_id, and event_type");
  }
  return {
    ...parsed,
    platform: parsed.platform,
    project: parsed.project,
    session_id: parsed.session_id,
    event_type: parsed.event_type,
    payload: parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {},
    metadata: parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : undefined,
    tags: toStringArray(parsed.tags),
    privacy_tags: toStringArray(parsed.privacy_tags),
  } as EventEnvelope;
}

async function testDelayIfRequested(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  const delayMs = Number(process.env.HARNESS_MEM_TEST_EVENT_CHILD_DELAY_MS || 0);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await Bun.sleep(Math.min(5_000, Math.floor(delayMs)));
  }
}

async function main(): Promise<void> {
  const event = await parseEventRequest();
  const core = new HarnessMemCore({
    ...getConfig(),
    backgroundWorkersEnabled: false,
  });
  try {
    await testDelayIfRequested();
    const response = await core.recordEventQueued(event);
    if (response === "queue_full") {
      process.stdout.write(`${JSON.stringify({ ok: false, error: "write queue full, retry later" })}\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    core.shutdown("event-child");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
