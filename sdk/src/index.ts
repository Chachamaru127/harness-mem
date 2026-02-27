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
} from "./types.js";
