/**
 * Projector types - defines the event-store + projector pattern for managed backend.
 *
 * The projector separates:
 * - Event Store: append-only log of all events (source of truth)
 * - Projections: derived views materialized from events for query efficiency
 *
 * This allows the managed backend to maintain eventual consistency
 * while keeping the event log as the authoritative record.
 */

/** A raw event as stored in the event store (append-only). */
export interface StoredEvent {
  event_id: string;
  platform: string;
  project: string;
  workspace_uid: string;
  session_id: string;
  event_type: string;
  ts: string;
  payload_json: string;
  tags_json: string;
  privacy_tags_json: string;
  dedupe_hash: string;
  observation_id?: string;
  correlation_id?: string;
  created_at: string;
}

/** Projection update result. */
export interface ProjectionResult {
  events_projected: number;
  projections_updated: string[];
  errors: string[];
}

/**
 * Projector interface.
 *
 * A projector reads events from the event store and materializes
 * derived views (observations, sessions, vectors, etc.).
 */
export interface Projector {
  /** Project a batch of events into derived views. */
  project(events: StoredEvent[]): Promise<ProjectionResult>;

  /** Rebuild all projections from scratch (full re-projection). */
  rebuild(): Promise<ProjectionResult>;

  /** Name of this projector (for logging). */
  readonly name: string;
}

/**
 * EventStore interface for the managed backend.
 *
 * Events are append-only; the store supports dedupe via dedupe_hash.
 */
export interface EventStore {
  /** Append events to the store (deduplicating by dedupe_hash). */
  append(events: StoredEvent[]): Promise<{ inserted: number; deduplicated: number }>;

  /** Read events from the store, optionally filtered. */
  read(filter: EventStoreFilter): Promise<StoredEvent[]>;

  /** Get the latest event timestamp for a given source. */
  getLatestTimestamp(project: string, platform: string): Promise<string | null>;
}

export interface EventStoreFilter {
  project?: string;
  workspace_uid?: string;
  platform?: string;
  session_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}
