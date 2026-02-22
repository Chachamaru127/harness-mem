/**
 * ShadowSync - dual-write and shadow-read orchestrator for hybrid mode.
 *
 * In hybrid mode:
 * 1. All writes go to SQLite first (primary), then async replicated to managed backend
 * 2. Shadow reads execute against managed backend in parallel (results compared, not used)
 * 3. Discrepancies are logged to audit_log for monitoring
 * 4. When shadow quality metrics meet SLA, the system can be promoted to managed-primary
 *
 * Lifecycle:
 *   hybrid/shadow → hybrid/verified → managed (promotion) → managed (cutover)
 *   At any point: managed → local (rollback)
 */

export type ShadowPhase = "off" | "shadow" | "verified" | "promoted";

export interface ShadowConfig {
  /** Current shadow phase. */
  phase: ShadowPhase;
  /** Whether to enable dual-write (write to both local + managed). */
  dualWriteEnabled: boolean;
  /** Whether to enable shadow-read (compare managed results). */
  shadowReadEnabled: boolean;
  /** Managed backend endpoint. */
  managedEndpoint: string;
  /** Managed backend API key. */
  managedApiKey: string;
}

export interface ShadowMetrics {
  /** Total writes to primary (SQLite). */
  primary_writes: number;
  /** Successful replications to managed backend. */
  managed_replications: number;
  /** Failed replications (queued for retry). */
  replication_failures: number;
  /** Shadow reads executed. */
  shadow_reads: number;
  /** Shadow reads that matched primary. */
  shadow_matches: number;
  /** Shadow reads that diverged from primary. */
  shadow_divergences: number;
  /** Shadow read match rate (0-1). */
  shadow_match_rate: number;
}

/**
 * ShadowSyncManager tracks dual-write and shadow-read metrics.
 *
 * This is the control plane for the hybrid → managed migration.
 * It doesn't execute the actual writes/reads (those happen in the adapter layer),
 * but tracks metrics and determines when the system is ready for promotion.
 */
export class ShadowSyncManager {
  private metrics: ShadowMetrics = {
    primary_writes: 0,
    managed_replications: 0,
    replication_failures: 0,
    shadow_reads: 0,
    shadow_matches: 0,
    shadow_divergences: 0,
    shadow_match_rate: 0,
  };

  private config: ShadowConfig;

  constructor(config: Partial<ShadowConfig> = {}) {
    this.config = {
      phase: config.phase || "off",
      dualWriteEnabled: config.dualWriteEnabled ?? false,
      shadowReadEnabled: config.shadowReadEnabled ?? false,
      managedEndpoint: config.managedEndpoint || "",
      managedApiKey: config.managedApiKey || "",
    };
  }

  /** Get current shadow phase. */
  getPhase(): ShadowPhase {
    return this.config.phase;
  }

  /** Get current metrics. */
  getMetrics(): ShadowMetrics {
    return { ...this.metrics };
  }

  /** Record a primary write (always to SQLite). */
  recordPrimaryWrite(): void {
    this.metrics.primary_writes++;
  }

  /** Record a successful replication to managed backend. */
  recordReplication(success: boolean): void {
    if (success) {
      this.metrics.managed_replications++;
    } else {
      this.metrics.replication_failures++;
    }
  }

  /** Record a shadow read comparison result. */
  recordShadowRead(matched: boolean): void {
    this.metrics.shadow_reads++;
    if (matched) {
      this.metrics.shadow_matches++;
    } else {
      this.metrics.shadow_divergences++;
    }
    this.metrics.shadow_match_rate =
      this.metrics.shadow_reads > 0
        ? this.metrics.shadow_matches / this.metrics.shadow_reads
        : 0;
  }

  /** Check if the system meets promotion criteria. */
  isReadyForPromotion(): {
    ready: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    // Minimum sample size
    if (this.metrics.shadow_reads < 100) {
      reasons.push(`Insufficient shadow reads: ${this.metrics.shadow_reads}/100`);
    }

    // Match rate >= 95%
    if (this.metrics.shadow_match_rate < 0.95) {
      reasons.push(
        `Shadow match rate too low: ${(this.metrics.shadow_match_rate * 100).toFixed(1)}% (need >=95%)`
      );
    }

    // Replication failure rate < 1%
    const totalReplications = this.metrics.managed_replications + this.metrics.replication_failures;
    const failureRate = totalReplications > 0
      ? this.metrics.replication_failures / totalReplications
      : 0;
    if (failureRate > 0.01) {
      reasons.push(
        `Replication failure rate too high: ${(failureRate * 100).toFixed(1)}% (need <1%)`
      );
    }

    return {
      ready: reasons.length === 0,
      reasons,
    };
  }

  /** Transition to the next shadow phase. */
  advancePhase(): ShadowPhase {
    switch (this.config.phase) {
      case "off":
        this.config.phase = "shadow";
        this.config.dualWriteEnabled = true;
        this.config.shadowReadEnabled = true;
        break;
      case "shadow": {
        const { ready } = this.isReadyForPromotion();
        if (ready) {
          this.config.phase = "verified";
        }
        break;
      }
      case "verified":
        this.config.phase = "promoted";
        break;
      case "promoted":
        // Already at final phase
        break;
    }
    return this.config.phase;
  }

  /** Rollback to local-only mode. */
  rollback(): void {
    this.config.phase = "off";
    this.config.dualWriteEnabled = false;
    this.config.shadowReadEnabled = false;
  }

  /** Export config for persistence. */
  toJSON(): ShadowConfig {
    return { ...this.config };
  }
}
