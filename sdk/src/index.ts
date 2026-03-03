/**
 * @harness-mem/sdk
 *
 * TypeScript SDK for the harness-mem memory server.
 *
 * @example
 * ```typescript
 * import { HarnessMemClient } from "@harness-mem/sdk";
 *
 * const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
 *
 * // Record an event
 * await client.record({
 *   session_id: "session-123",
 *   payload: { prompt: "TypeScript を採用することを決定した" },
 * });
 *
 * // Search
 * const results = await client.search({
 *   query: "TypeScript 採用",
 *   limit: 5,
 * });
 * ```
 */

export { HarnessMemClient } from "./client.js";
export { HarnessMemLangChainMemory } from "./langchain-memory.js";
// NEXT-009: フレームワーク統合（integrations.ts）
export {
  HarnessMemLangChainMemory as LangChainMemory,
  HarnessMemLlamaIndexMemory,
} from "./integrations.js";
export type {
  LangChainMemoryOptions,
  LlamaIndexMemoryOptions,
  ChatMessage,
} from "./integrations.js";
export type {
  HarnessMemClientOptions,
  ApiResponse,
  RecordEventInput,
  SearchInput,
  SearchResultItem,
  ResumePackInput,
  TimelineInput,
  GetObservationsInput,
  ObservationItem,
  RecordCheckpointInput,
  FinalizeSessionInput,
  SessionFinalizeItem,
  ConsolidationRunInput,
  AuditLogInput,
  AuditLogItem,
  SearchFacetsInput,
} from "./types.js";
export type { HarnessMemLangChainMemoryOptions } from "./langchain-memory.js";
export { HarnessMemVercelProvider } from "./vercel-ai.js";
export type { VercelAIMessage, VercelProviderOptions } from "./vercel-ai.js";
export { setupClient } from "./setup.js";
export type { SupportedClient, SetupResult } from "./setup.js";
