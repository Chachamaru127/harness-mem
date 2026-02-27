/**
 * @harness-mem/sdk - Type definitions
 */

export interface HarnessMemClientOptions {
  /** Server base URL. Defaults to http://localhost:37888 */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 10000 */
  timeout?: number;
}

/** API response envelope */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  source: string;
  items: T[];
  meta: Record<string, unknown>;
  error?: string;
}

/** Event to record */
export interface RecordEventInput {
  platform?: string;
  project?: string;
  session_id: string;
  event_type?: string;
  ts?: string;
  payload: Record<string, unknown>;
  tags?: string[];
  privacy_tags?: string[];
  correlation_id?: string;
}

/** Search request */
export interface SearchInput {
  query: string;
  project?: string;
  session_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  include_private?: boolean;
  expand_links?: boolean;
  strict_project?: boolean;
  exclude_updated?: boolean;
  debug?: boolean;
}

/** Search result item */
export interface SearchResultItem {
  id: string;
  event_id?: string;
  platform?: string;
  project?: string;
  session_id?: string;
  title?: string;
  content: string;
  observation_type?: string;
  created_at?: string;
  tags?: string[];
  privacy_tags?: string[];
  scores?: {
    lexical: number;
    vector: number;
    recency: number;
    tag_boost: number;
    importance: number;
    graph: number;
    final: number;
    rerank: number;
  };
}

/** Resume pack request */
export interface ResumePackInput {
  project: string;
  session_id?: string;
  correlation_id?: string;
  limit?: number;
  include_private?: boolean;
  resume_pack_max_tokens?: number;
}

/** Timeline request */
export interface TimelineInput {
  id: string;
  before?: number;
  after?: number;
  include_private?: boolean;
}

/** Get observations request */
export interface GetObservationsInput {
  ids: string[];
  include_private?: boolean;
  compact?: boolean;
}

/** Observation item */
export interface ObservationItem {
  id: string;
  event_id?: string;
  platform?: string;
  project?: string;
  session_id?: string;
  title?: string;
  content: string;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  privacy_tags?: string[];
}
