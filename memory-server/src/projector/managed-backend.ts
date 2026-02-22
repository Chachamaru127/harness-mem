/**
 * ManagedBackend - orchestrates the PostgreSQL managed backend lifecycle.
 *
 * Responsibilities:
 * - Manages PostgresStorageAdapter connection
 * - Coordinates EventStore (append-only event log)
 * - Runs ObservationProjector (materialized views)
 * - Tracks ShadowSyncManager metrics (dual-write / shadow-read)
 * - Exposes connection state and shadow metrics for health/admin APIs
 *
 * Integration with HarnessMemCore:
 * - HarnessMemCore always uses SQLite for synchronous reads (local cache)
 * - ManagedBackend handles async replication to PostgreSQL
 * - In hybrid mode: SQLite is primary, PostgreSQL gets dual-writes + shadow-reads
 * - In managed mode: SQLite is local cache, PostgreSQL is source of truth
 */
import { PostgresStorageAdapter, type PgClientLike } from "../db/postgres-adapter";
import { POSTGRES_INIT_SQL } from "../db/postgres-schema";
import { PostgresEventStore } from "./event-store";
import { ObservationProjector } from "./observation-projector";
import { ShadowSyncManager, type ShadowMetrics, type ShadowPhase } from "./shadow-sync";
import type { StoredEvent } from "./types";

export type ManagedConnectionState = "connecting" | "connected" | "degraded" | "disconnected";

export interface ManagedBackendConfig {
  endpoint: string;
  apiKey: string;
  backendMode: "hybrid" | "managed";
  /** Workspace UID for multi-tenant isolation. */
  workspaceUid?: string;
}

export interface ManagedBackendStatus {
  connection_state: ManagedConnectionState;
  endpoint: string;
  backend_mode: "hybrid" | "managed";
  shadow_phase: ShadowPhase;
  shadow_metrics: ShadowMetrics;
  last_replication_at: string | null;
  last_error: string | null;
  replication_queue_size: number;
}

/**
 * ManagedBackend orchestrates PostgreSQL connection, replication, and shadow metrics.
 *
 * All async operations are fire-and-forget from HarnessMemCore's perspective:
 * - replicateEvent(): called after SQLite write, replicates to PostgreSQL
 * - shadowRead(): called after SQLite search, compares results
 * - Metrics track success/failure for promotion readiness
 */
export class ManagedBackend {
  /**
   * Shadow read match threshold: must align with promotion SLA (95%).
   * A shadow read is counted as "match" only when local-vs-managed overlap >= this value.
   */
  static readonly SHADOW_MATCH_THRESHOLD = 0.95;

  private adapter: PostgresStorageAdapter | null = null;
  private eventStore: PostgresEventStore | null = null;
  private projector: ObservationProjector | null = null;
  /** @internal Exposed for testing only. Production code should use ManagedBackend methods. */
  readonly shadow: ShadowSyncManager;

  private connectionState: ManagedConnectionState = "disconnected";
  private lastReplicationAt: string | null = null;
  private lastError: string | null = null;
  private replicationQueue: StoredEvent[] = [];
  private replicationInProgress = false;
  private readonly maxQueueSize = 1000;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: ManagedBackendConfig) {
    this.shadow = new ShadowSyncManager({
      phase: config.backendMode === "managed" ? "promoted" : "off",
      dualWriteEnabled: true,
      shadowReadEnabled: config.backendMode === "hybrid",
      managedEndpoint: config.endpoint,
      managedApiKey: config.apiKey,
    });
  }

  /** Initialize the PostgreSQL connection and schema. */
  async initialize(pgClient?: PgClientLike): Promise<void> {
    this.connectionState = "connecting";

    try {
      if (pgClient) {
        // Use provided client (for testing or custom connection pools)
        this.adapter = new PostgresStorageAdapter(pgClient);
      } else {
        // Dynamic import pg to avoid hard dependency when not in managed mode
        const pg = await import("pg").catch(() => null);
        if (!pg) {
          this.connectionState = "degraded";
          this.lastError = "pg module not installed. Run: bun add pg";
          return;
        }

        const pool = new pg.Pool({ connectionString: this.config.endpoint });
        this.adapter = new PostgresStorageAdapter(pool as unknown as PgClientLike);
      }

      // Initialize PostgreSQL schema
      await this.adapter.execAsync(POSTGRES_INIT_SQL);

      this.eventStore = new PostgresEventStore(this.adapter);
      this.projector = new ObservationProjector(this.adapter);
      this.connectionState = "connected";
      this.lastError = null;

      // Advance shadow phase to shadow if in hybrid mode
      if (this.config.backendMode === "hybrid" && this.shadow.getPhase() === "off") {
        this.shadow.advancePhase(); // off → shadow
      }

      // Start periodic queue flush
      this.flushTimer = setInterval(() => this.flushReplicationQueue(), 5000);
    } catch (err) {
      this.connectionState = "degraded";
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  /** Check if managed backend is available for operations. */
  isConnected(): boolean {
    return this.connectionState === "connected" && this.adapter !== null;
  }

  /** Get current status for health/admin APIs. */
  getStatus(): ManagedBackendStatus {
    return {
      connection_state: this.connectionState,
      endpoint: this.config.endpoint.replace(/:[^:@]*@/, ":***@"), // mask password
      backend_mode: this.config.backendMode,
      shadow_phase: this.shadow.getPhase(),
      shadow_metrics: this.shadow.getMetrics(),
      last_replication_at: this.lastReplicationAt,
      last_error: this.lastError,
      replication_queue_size: this.replicationQueue.length,
    };
  }

  /**
   * Replicate an event to the managed PostgreSQL backend.
   * Fire-and-forget: errors are tracked in shadow metrics, not thrown.
   */
  replicateEvent(event: StoredEvent): void {
    this.shadow.recordPrimaryWrite();

    if (!this.isConnected()) {
      this.shadow.recordReplication(false);
      this.enqueueForRetry(event);
      return;
    }

    // Enqueue and flush asynchronously
    this.enqueueForRetry(event);
    this.flushReplicationQueue().catch(() => {
      // fire-and-forget, errors tracked in metrics
    });
  }

  /**
   * Execute a shadow read against the managed backend.
   * Compares results with local SQLite results for quality metrics.
   * Fire-and-forget: results are not used for the actual response.
   */
  async shadowRead(
    query: string,
    localResultIds: string[],
    options: { project?: string; limit?: number } = {}
  ): Promise<void> {
    if (!this.isConnected() || !this.adapter || this.shadow.getPhase() === "off") {
      return;
    }

    try {
      // Execute search against PostgreSQL using tsvector
      const pgSql = `
        SELECT id FROM mem_observations
        WHERE search_vector @@ plainto_tsquery('english', $1)
        ${options.project ? "AND project = $2" : ""}
        ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
        LIMIT $${options.project ? 3 : 2}
      `;
      const params: unknown[] = [query];
      if (options.project) params.push(options.project);
      params.push(options.limit || 20);

      const pgResults = await this.adapter.queryAllAsync<{ id: string }>(pgSql, params);
      const pgIds = new Set(pgResults.map((r) => r.id));

      // Compare: check how many local results appear in PostgreSQL results
      const localSet = new Set(localResultIds);
      const intersection = localResultIds.filter((id) => pgIds.has(id));
      const matchRate = localResultIds.length > 0
        ? intersection.length / localResultIds.length
        : 1; // empty result = match

      // Match threshold aligned with promotion SLA (95%)
      this.shadow.recordShadowRead(matchRate >= ManagedBackend.SHADOW_MATCH_THRESHOLD);
    } catch (err) {
      // Shadow read failure: record as divergence
      this.shadow.recordShadowRead(false);
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  /** Attempt to promote from hybrid to managed mode. */
  attemptPromotion(): { promoted: boolean; phase: ShadowPhase; reasons: string[] } {
    const { ready, reasons } = this.shadow.isReadyForPromotion();
    if (ready) {
      this.shadow.advancePhase();
    }
    return {
      promoted: ready,
      phase: this.shadow.getPhase(),
      reasons,
    };
  }

  /** Shutdown: flush queue, close connections. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final queue flush attempt
    if (this.replicationQueue.length > 0 && this.isConnected()) {
      await this.flushReplicationQueue();
    }

    if (this.adapter) {
      this.adapter.close();
      this.adapter = null;
    }

    this.connectionState = "disconnected";
  }

  // ---- Private methods ----

  private enqueueForRetry(event: StoredEvent): void {
    if (this.replicationQueue.length >= this.maxQueueSize) {
      // Drop oldest events when queue is full
      this.replicationQueue.shift();
    }
    this.replicationQueue.push(event);
  }

  private async flushReplicationQueue(): Promise<void> {
    if (this.replicationInProgress || this.replicationQueue.length === 0) {
      return;
    }
    if (!this.eventStore) {
      return;
    }

    this.replicationInProgress = true;
    const batch = this.replicationQueue.splice(0, 100); // Process in batches of 100

    try {
      const result = await this.eventStore.append(batch);
      for (let i = 0; i < result.inserted + result.deduplicated; i++) {
        this.shadow.recordReplication(true);
      }
      this.lastReplicationAt = new Date().toISOString();
      this.lastError = null;

      // If there are projected events, run the projector
      if (result.inserted > 0 && this.projector) {
        await this.projector.project(batch).catch((err) => {
          this.lastError = `projection failed: ${err instanceof Error ? err.message : String(err)}`;
        });
      }
    } catch (err) {
      // Replication failed: put events back in queue and record failures
      this.replicationQueue.unshift(...batch);
      for (let i = 0; i < batch.length; i++) {
        this.shadow.recordReplication(false);
      }
      this.lastError = err instanceof Error ? err.message : String(err);
      this.connectionState = "degraded";
    } finally {
      this.replicationInProgress = false;
    }
  }
}
