/**
 * ObservationProjector - materializes observations and related views from events.
 *
 * Reads from the event store and projects into:
 * - mem_observations (with tsvector for FTS)
 * - mem_sessions (upsert session metadata)
 * - mem_tags (tag associations)
 * - mem_vectors (pgvector embeddings)
 */
import type { PostgresStorageAdapter } from "../db/postgres-adapter";
import type { Projector, ProjectionResult, StoredEvent } from "./types";

export class ObservationProjector implements Projector {
  readonly name = "observation-projector";

  constructor(private readonly adapter: PostgresStorageAdapter) {}

  async project(events: StoredEvent[]): Promise<ProjectionResult> {
    let eventsProjected = 0;
    const projectionsUpdated = new Set<string>();
    const errors: string[] = [];

    for (const event of events) {
      try {
        // Ensure session exists
        await this.adapter.runAsync(
          `INSERT INTO mem_sessions (session_id, platform, project, workspace_uid, started_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()`,
          [event.session_id, event.platform, event.project, event.workspace_uid, event.ts]
        );
        projectionsUpdated.add("mem_sessions");

        // Create observation from event
        if (event.observation_id) {
          const payload = JSON.parse(event.payload_json || "{}");
          const title = typeof payload.title === "string" ? payload.title : null;
          const content = typeof payload.content === "string" ? payload.content : JSON.stringify(payload);
          const contentRedacted = typeof payload.content_redacted === "string"
            ? payload.content_redacted
            : content;

          await this.adapter.runAsync(
            `INSERT INTO mem_observations (
              id, event_id, platform, project, workspace_uid, session_id,
              title, content, content_redacted, observation_type,
              tags_json, privacy_tags_json, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
              content = EXCLUDED.content,
              content_redacted = EXCLUDED.content_redacted,
              updated_at = NOW()`,
            [
              event.observation_id,
              event.event_id,
              event.platform,
              event.project,
              event.workspace_uid,
              event.session_id,
              title,
              content,
              contentRedacted,
              event.event_type === "checkpoint" ? "checkpoint" : "context",
              event.tags_json,
              event.privacy_tags_json,
            ]
          );
          projectionsUpdated.add("mem_observations");

          // Project tags
          const tags: string[] = JSON.parse(event.tags_json || "[]");
          for (const tag of tags) {
            await this.adapter.runAsync(
              `INSERT INTO mem_tags (observation_id, tag, tag_type, created_at)
               VALUES ($1, $2, 'user', NOW())
               ON CONFLICT DO NOTHING`,
              [event.observation_id, tag]
            );
          }
          if (tags.length > 0) {
            projectionsUpdated.add("mem_tags");
          }
        }

        eventsProjected++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Event ${event.event_id}: ${message}`);
      }
    }

    return {
      events_projected: eventsProjected,
      projections_updated: [...projectionsUpdated],
      errors,
    };
  }

  async rebuild(): Promise<ProjectionResult> {
    // Full rebuild: truncate derived tables and re-project all events.
    // This is expensive and should only be used for recovery.
    await this.adapter.execAsync("TRUNCATE mem_observations, mem_tags, mem_vectors CASCADE");

    // Read all events and project them
    const events = await this.adapter.queryAllAsync<StoredEvent>(
      "SELECT * FROM mem_events ORDER BY ts ASC"
    );

    return this.project(events);
  }
}
