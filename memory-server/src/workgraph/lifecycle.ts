import type { Database } from "bun:sqlite";
import type { LeaseRow, LeaseStore, TenantScope } from "../lease/lease-store";
import { createWorkStore, type WorkItemRow } from "./work-store";

export interface ClaimWorkInput {
  workId: string;
  project: string;
  agentId: string;
  sessionId?: string | null;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
  tenant?: TenantScope;
  now?: string;
}

export interface CloseWorkInput {
  workId: string;
  project: string;
  agentId: string;
  leaseId?: string;
  reason?: string;
  sessionId?: string | null;
  tenant?: TenantScope;
  now?: string;
}

export type ClaimWorkResult =
  | {
      ok: true;
      work: WorkItemRow;
      lease: LeaseRow;
      eventId: string;
    }
  | {
      ok: false;
      error: "not_found" | "invalid_status" | "already_leased" | "invalid_target" | "invalid_agent_id" | "invalid_ttl";
      details?: string;
      heldBy?: string;
      expiresAt?: string;
      leaseId?: string;
    };

export type CloseWorkResult =
  | {
      ok: true;
      work: WorkItemRow;
      lease: LeaseRow;
      eventId: string;
    }
  | {
      ok: false;
      error: "not_found" | "lease_not_found" | "not_owner" | "lease_release_failed" | "invalid_status";
      details?: string;
    };

export interface ClaimLeaseMetrics {
  claim_lease_success_rate: number;
}

const WORK_LEASE_PREFIX = "work:";

export function claimWork(db: Database, leaseStore: LeaseStore, input: ClaimWorkInput): ClaimWorkResult {
  const now = input.now ?? new Date().toISOString();
  const store = createWorkStore(db, { now: () => now });
  const work = getScopedWork(store, input.workId, input.project);
  if (!work) {
    return { ok: false, error: "not_found" };
  }
  if (work.status === "closed") {
    return { ok: false, error: "invalid_status", details: "closed work cannot be claimed" };
  }

  const tx = db.transaction((): ClaimWorkResult => {
    const leaseResult = leaseStore.acquire({
      target: workTarget(input.workId),
      agentId: input.agentId,
      project: input.project,
      ttlMs: input.ttlMs,
      metadata: {
        ...(input.metadata ?? {}),
        work_id: input.workId,
        action: "claim",
      },
      userId: input.tenant?.userId,
      teamId: input.tenant?.teamId,
    });
    if (!leaseResult.ok) {
      return {
        ok: false,
        error: leaseResult.error,
        details: "details" in leaseResult ? leaseResult.details : undefined,
        heldBy: leaseResult.error === "already_leased" ? leaseResult.heldBy : undefined,
        expiresAt: leaseResult.error === "already_leased" ? leaseResult.expiresAt : undefined,
        leaseId: leaseResult.error === "already_leased" ? leaseResult.leaseId : undefined,
      };
    }

    const updated = store.upsertWorkItem({
      ...work,
      status: "in_progress",
      assignee: input.agentId,
      sessionId: input.sessionId ?? work.sessionId,
      updatedAt: now,
      metadataJson: work.metadataJson,
    });
    const eventId = `work:${input.workId}:claimed:${leaseResult.lease.leaseId}`;
    store.recordEvent({
      eventId,
      workId: input.workId,
      eventType: "claimed",
      actor: input.agentId,
      sessionId: input.sessionId ?? work.sessionId,
      createdAt: now,
      payload: {
        lease_id: leaseResult.lease.leaseId,
        target: leaseResult.lease.target,
      },
    });
    store.addLink({
      workId: input.workId,
      targetType: "lease",
      targetId: leaseResult.lease.leaseId,
      relation: "claimed",
      createdAt: now,
    });
    return {
      ok: true,
      work: updated,
      lease: leaseResult.lease,
      eventId,
    };
  });

  return tx();
}

export function closeWork(db: Database, leaseStore: LeaseStore, input: CloseWorkInput): CloseWorkResult {
  const now = input.now ?? new Date().toISOString();
  const store = createWorkStore(db, { now: () => now });
  const work = getScopedWork(store, input.workId, input.project);
  if (!work) {
    return { ok: false, error: "not_found" };
  }
  if (work.status === "closed") {
    return { ok: false, error: "invalid_status", details: "work is already closed" };
  }

  const lease = resolveActiveWorkLease(leaseStore, input);
  if (!lease) {
    return { ok: false, error: "lease_not_found" };
  }

  const tx = db.transaction((): CloseWorkResult => {
    const release = leaseStore.release(lease.leaseId, input.agentId, input.tenant);
    if (!release.ok || !release.lease) {
      return {
        ok: false,
        error: release.error === "not_owner" ? "not_owner" : "lease_release_failed",
        details: release.error,
      };
    }

    const updated = store.upsertWorkItem({
      ...work,
      status: "closed",
      assignee: input.agentId,
      sessionId: input.sessionId ?? work.sessionId,
      updatedAt: now,
      closedAt: now,
      closeReason: input.reason ?? "closed",
      metadataJson: work.metadataJson,
    });
    const eventId = `work:${input.workId}:closed:${lease.leaseId}`;
    store.recordEvent({
      eventId,
      workId: input.workId,
      eventType: "closed",
      actor: input.agentId,
      sessionId: input.sessionId ?? work.sessionId,
      createdAt: now,
      payload: {
        lease_id: lease.leaseId,
        reason: input.reason ?? "closed",
      },
    });
    store.addLink({
      workId: input.workId,
      targetType: "lease",
      targetId: lease.leaseId,
      relation: "released",
      createdAt: now,
    });
    return {
      ok: true,
      work: updated,
      lease: release.lease,
      eventId,
    };
  });

  return tx();
}

export function calculateClaimLeaseMetrics(results: ClaimWorkResult[]): ClaimLeaseMetrics {
  if (results.length === 0) {
    return { claim_lease_success_rate: 1 };
  }
  const successes = results.filter((result) => result.ok && result.lease.status === "active").length;
  return {
    claim_lease_success_rate: successes / results.length,
  };
}

function getScopedWork(store: ReturnType<typeof createWorkStore>, workId: string, project: string): WorkItemRow | null {
  const work = store.getWorkItem(workId);
  if (!work || work.project !== project) {
    return null;
  }
  return work;
}

function resolveActiveWorkLease(leaseStore: LeaseStore, input: CloseWorkInput): LeaseRow | null {
  const target = workTarget(input.workId);
  const candidates = input.leaseId
    ? [leaseStore.get(input.leaseId)].filter((lease): lease is LeaseRow => lease !== null)
    : leaseStore.listActive(target);
  return candidates.find((lease) =>
    lease.status === "active" &&
    lease.target === target &&
    lease.agentId === input.agentId &&
    (lease.project === null || lease.project === input.project)
  ) ?? null;
}

function workTarget(workId: string): string {
  return `${WORK_LEASE_PREFIX}${workId}`;
}
