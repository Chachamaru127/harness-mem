/**
 * One-shot child process for checkpoint writes.
 *
 * The daemon owns HTTP and readiness; this child owns synchronous SQLite
 * checkpoint persistence so a stuck write cannot freeze the daemon event loop.
 */

import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
import type { RecordCheckpointRequest } from "../core/types";

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

async function parseCheckpointRequest(): Promise<RecordCheckpointRequest> {
  const payload = await readPayload("checkpoint request");
  if (!payload) {
    throw new Error("missing checkpoint request JSON");
  }
  const parsed = JSON.parse(payload) as Partial<RecordCheckpointRequest>;
  if (
    typeof parsed.session_id !== "string" ||
    typeof parsed.title !== "string" ||
    typeof parsed.content !== "string" ||
    parsed.session_id.trim().length === 0 ||
    parsed.title.trim().length === 0 ||
    parsed.content.trim().length === 0
  ) {
    throw new Error("checkpoint child requires session_id, title, and content");
  }
  return {
    platform: typeof parsed.platform === "string" ? parsed.platform : undefined,
    project: typeof parsed.project === "string" ? parsed.project : undefined,
    session_id: parsed.session_id,
    title: parsed.title,
    content: parsed.content,
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string") : [],
    privacy_tags: Array.isArray(parsed.privacy_tags)
      ? parsed.privacy_tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

async function main(): Promise<void> {
  const request = await parseCheckpointRequest();
  const core = new HarnessMemCore({
    ...getConfig(),
    backgroundWorkersEnabled: false,
  });
  try {
    const response = await core.recordCheckpointQueued(request);
    if (response === "queue_full") {
      process.stdout.write(`${JSON.stringify({ ok: false, error: "write queue full, retry later" })}\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    core.shutdown("checkpoint-child");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
