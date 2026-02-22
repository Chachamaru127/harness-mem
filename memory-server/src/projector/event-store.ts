/**
 * PostgresEventStore - append-only event log backed by PostgreSQL.
 *
 * This is the source of truth for the managed backend.
 * Events are immutable once written; updates are expressed as new events.
 */
import type { PostgresStorageAdapter } from "../db/postgres-adapter";
import type { EventStore, EventStoreFilter, StoredEvent } from "./types";

export class PostgresEventStore implements EventStore {
  constructor(private readonly adapter: PostgresStorageAdapter) {}

  async append(events: StoredEvent[]): Promise<{ inserted: number; deduplicated: number }> {
    let inserted = 0;
    let deduplicated = 0;

    for (const event of events) {
      const count = await this.adapter.transactionAsync(async () => {
        // Ensure session exists before inserting event (FK: mem_events.session_id → mem_sessions).
        // started_at = first event's timestamp. ON CONFLICT DO NOTHING keeps the original.
        await this.adapter.runAsync(
          `INSERT INTO mem_sessions (session_id, platform, project, workspace_uid, started_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (session_id) DO NOTHING`,
          [event.session_id, event.platform, event.project, event.workspace_uid, event.ts]
        );

        return this.adapter.runAsync(
          `INSERT INTO mem_events (
            event_id, platform, project, workspace_uid, session_id,
            event_type, ts, payload_json, tags_json, privacy_tags_json,
            dedupe_hash, observation_id, correlation_id, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (dedupe_hash) DO NOTHING`,
          [
            event.event_id,
            event.platform,
            event.project,
            event.workspace_uid,
            event.session_id,
            event.event_type,
            event.ts,
            event.payload_json,
            event.tags_json,
            event.privacy_tags_json,
            event.dedupe_hash,
            event.observation_id || null,
            event.correlation_id || null,
            event.created_at,
          ]
        );
      });
      if (count > 0) {
        inserted++;
      } else {
        deduplicated++;
      }
    }

    return { inserted, deduplicated };
  }

  async read(filter: EventStoreFilter): Promise<StoredEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (filter.project) {
      paramIdx++;
      conditions.push(`project = $${paramIdx}`);
      params.push(filter.project);
    }
    if (filter.workspace_uid) {
      paramIdx++;
      conditions.push(`workspace_uid = $${paramIdx}`);
      params.push(filter.workspace_uid);
    }
    if (filter.platform) {
      paramIdx++;
      conditions.push(`platform = $${paramIdx}`);
      params.push(filter.platform);
    }
    if (filter.session_id) {
      paramIdx++;
      conditions.push(`session_id = $${paramIdx}`);
      params.push(filter.session_id);
    }
    if (filter.since) {
      paramIdx++;
      conditions.push(`ts >= $${paramIdx}`);
      params.push(filter.since);
    }
    if (filter.until) {
      paramIdx++;
      conditions.push(`ts <= $${paramIdx}`);
      params.push(filter.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ? `LIMIT ${Math.max(1, Math.floor(filter.limit))}` : "";
    const offset = filter.offset ? `OFFSET ${Math.max(0, Math.floor(filter.offset))}` : "";

    return this.adapter.queryAllAsync<StoredEvent>(
      `SELECT * FROM mem_events ${where} ORDER BY ts DESC ${limit} ${offset}`,
      params
    );
  }

  async getLatestTimestamp(project: string, platform: string): Promise<string | null> {
    const row = await this.adapter.queryOneAsync<{ ts: string }>(
      "SELECT ts FROM mem_events WHERE project = $1 AND platform = $2 ORDER BY ts DESC LIMIT 1",
      [project, platform]
    );
    return row?.ts ?? null;
  }
}
