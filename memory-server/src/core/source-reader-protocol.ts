import type { Config, EventEnvelope } from "./types";
import { redactContent } from "./event-recorder";
import { stripPrivateBlocks } from "./privacy-tags";

export const SOURCE_READER_MAX_PACKET_BYTES = 1024 * 1024;
export const SOURCE_READER_MAX_PATH_BYTES = 16 * 1024;
export const SOURCE_READER_SOURCES = ["codex", "opencode", "cursor", "antigravity", "gemini", "claude_code"] as const;
export type SourceReaderSource = typeof SOURCE_READER_SOURCES[number];
export type SourceReaderOperation =
  | { op: "meta_available" }
  | { op: "meta_get"; key: string }
  | { op: "meta_set"; key: string; value: string }
  | { op: "offset_get"; key: string }
  | { op: "offset_commit"; key: string; offset: number; expected: number | null; context?: { key: string; value: string } }
  | { op: "record"; event: EventEnvelope };

export function isReaderMetaKey(key: string): boolean {
  return key.startsWith("ingest.scheduler.") || key.startsWith("codex_rollout_context:")
    || key.startsWith("claude_code_context:") || key === "dedupe_claims.readiness"
    || key === "dedupe_claims.schema_version";
}

export function isReaderOffsetKey(key: string): boolean {
  return /^(codex|opencode|cursor|antigravity|gemini|claude_code)[a-z_]*:/.test(key);
}

/** Only source configuration crosses into a reader; credentials and memory DB settings do not. */
export function sourceReaderConfig(config: Config): Partial<Config> {
  const selected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (/^(codex|opencode|cursor|antigravity|gemini|claudeCode)/.test(key)) selected[key] = value;
  }
  return selected as Partial<Config>;
}

/** Context and nested payload fields must obey the same private-block exclusion as content. */
export function readerPrivateBlocks(value: unknown, tags: string[] = []): unknown {
  if (typeof value === "string") return redactContent(stripPrivateBlocks(value) ?? "", tags);
  if (Array.isArray(value)) return value.map((entry) => readerPrivateBlocks(entry, tags));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, readerPrivateBlocks(entry, tags)]));
  }
  return value;
}

export function sanitizeReaderEvent(event: EventEnvelope): EventEnvelope {
  const tags = Array.isArray(event.privacy_tags) ? event.privacy_tags : [];
  return {
    ...event,
    payload: readerPrivateBlocks(event.payload, tags) as EventEnvelope["payload"],
    metadata: readerPrivateBlocks(event.metadata, tags) as EventEnvelope["metadata"],
  };
}

export function sanitizeReaderContext(context: Record<string, unknown>, tags: string[] = []): Record<string, unknown> {
  return Object.fromEntries(Object.entries(context)
    .filter(([key]) => /^(project|session_id|sessionId|lastUserPrompt|lastAssistantContent|last_user_prompt|last_assistant_content)$/.test(key))
    .map(([key, value]) => [key,
    /^(lastUserPrompt|lastAssistantContent|last_user_prompt|last_assistant_content)$/.test(key)
      ? readerPrivateBlocks(value, tags) : value,
  ]));
}

export function encodeReaderPacket(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value) + "\n");
  if (bytes.length > SOURCE_READER_MAX_PACKET_BYTES) throw new Error("source_reader_packet_limit");
  return bytes;
}
