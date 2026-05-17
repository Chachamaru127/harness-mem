import type { LeaseRow } from "../lease/lease-store";
import type { WorkDependencyRelation, WorkDependencyRow, WorkItemRow } from "./work-store";

export type ReadyBlockReasonCode =
  | "status"
  | "blocked_by"
  | "checkpoint_waiting"
  | "superseded"
  | "duplicate"
  | "leased";

export interface ReadyWorkItem {
  workId: string;
  title?: string;
  status: string;
}

export interface ReadyDependency {
  fromWorkId: string;
  toWorkId: string;
  relation: WorkDependencyRelation | string;
}

export interface ReadyLease {
  target: string;
  agentId?: string;
  status: string;
  expiresAt: string;
}

export interface ReadyBlockReason {
  code: ReadyBlockReasonCode;
  message: string;
  relatedWorkId?: string;
  lease?: {
    target: string;
    agentId?: string;
    expiresAt: string;
  };
}

export interface WorkReadinessDecision {
  workId: string;
  ready: boolean;
  reasons: ReadyBlockReason[];
}

export interface WorkReadinessResult {
  readyWorkIds: string[];
  decisions: WorkReadinessDecision[];
  reasonsByWorkId: Record<string, ReadyBlockReason[]>;
}

export interface EvaluateWorkReadinessInput {
  workItems: Array<ReadyWorkItem | WorkItemRow>;
  dependencies?: Array<ReadyDependency | WorkDependencyRow>;
  activeLeases?: Array<ReadyLease | LeaseRow>;
  now?: Date | string | number;
}

export interface ReadyMetricsFixture {
  expectedReadyWorkIds: string[];
  expectedBlockedWorkIds: string[];
}

export interface ReadyMetrics {
  ready_precision: number;
  blocker_recall: number;
}

const READY_STATUS = "open";
const LEASE_TARGET_PREFIX = "work:";

export function evaluateWorkReadiness(input: EvaluateWorkReadinessInput): WorkReadinessResult {
  const nowMs = toTime(input.now ?? Date.now());
  const workItems = input.workItems.map((item) => ({
    workId: item.workId,
    title: item.title,
    status: item.status,
  }));
  const statusByWorkId = new Map(workItems.map((item) => [item.workId, item.status]));
  const reasonsByWorkId = Object.fromEntries(workItems.map((item) => [item.workId, [] as ReadyBlockReason[]]));

  for (const item of workItems) {
    if (item.status !== READY_STATUS) {
      reasonsByWorkId[item.workId].push({
        code: "status",
        message: `work status is ${item.status}`,
      });
    }
  }

  for (const dependency of input.dependencies ?? []) {
    applyDependencyReason(dependency, statusByWorkId, reasonsByWorkId);
  }

  for (const lease of input.activeLeases ?? []) {
    if (!isActiveWorkLease(lease, nowMs)) continue;
    const workId = lease.target.slice(LEASE_TARGET_PREFIX.length);
    const reasons = reasonsByWorkId[workId];
    if (!reasons) continue;
    reasons.push({
      code: "leased",
      message: `work is leased by ${lease.agentId ?? "unknown agent"}`,
      lease: {
        target: lease.target,
        ...(lease.agentId ? { agentId: lease.agentId } : {}),
        expiresAt: lease.expiresAt,
      },
    });
  }

  const decisions = workItems
    .map((item) => ({
      workId: item.workId,
      ready: reasonsByWorkId[item.workId].length === 0,
      reasons: reasonsByWorkId[item.workId],
    }))
    .sort((a, b) => a.workId.localeCompare(b.workId));

  return {
    readyWorkIds: decisions.filter((decision) => decision.ready).map((decision) => decision.workId),
    decisions,
    reasonsByWorkId,
  };
}

export function calculateReadyMetrics(result: WorkReadinessResult, fixture: ReadyMetricsFixture): ReadyMetrics {
  const ready = new Set(result.readyWorkIds);
  const expectedReady = new Set(fixture.expectedReadyWorkIds);
  const expectedBlocked = new Set(fixture.expectedBlockedWorkIds);
  const trueReady = [...ready].filter((workId) => expectedReady.has(workId)).length;
  const blockedFound = [...expectedBlocked].filter((workId) => !ready.has(workId)).length;

  return {
    ready_precision: ratio(trueReady, ready.size),
    blocker_recall: ratio(blockedFound, expectedBlocked.size),
  };
}

function applyDependencyReason(
  dependency: ReadyDependency | WorkDependencyRow,
  statusByWorkId: Map<string, string>,
  reasonsByWorkId: Record<string, ReadyBlockReason[]>
): void {
  const fromStatus = statusByWorkId.get(dependency.fromWorkId);
  if (dependency.relation === "blocks" && fromStatus !== "closed") {
    addReason(reasonsByWorkId, dependency.toWorkId, {
      code: "blocked_by",
      message: `blocked by ${dependency.fromWorkId}`,
      relatedWorkId: dependency.fromWorkId,
    });
    return;
  }

  if (dependency.relation === "checkpoint" && fromStatus !== "closed") {
    addReason(reasonsByWorkId, dependency.toWorkId, {
      code: "checkpoint_waiting",
      message: `waiting on checkpoint ${dependency.fromWorkId}`,
      relatedWorkId: dependency.fromWorkId,
    });
    return;
  }

  if (dependency.relation === "supersedes") {
    addReason(reasonsByWorkId, dependency.toWorkId, {
      code: "superseded",
      message: `superseded by ${dependency.fromWorkId}`,
      relatedWorkId: dependency.fromWorkId,
    });
    return;
  }

  if (dependency.relation === "duplicates") {
    addReason(reasonsByWorkId, dependency.toWorkId, {
      code: "duplicate",
      message: `duplicate of ${dependency.fromWorkId}`,
      relatedWorkId: dependency.fromWorkId,
    });
  }
}

function addReason(
  reasonsByWorkId: Record<string, ReadyBlockReason[]>,
  workId: string,
  reason: ReadyBlockReason
): void {
  const reasons = reasonsByWorkId[workId];
  if (!reasons) return;
  reasons.push(reason);
}

function isActiveWorkLease(lease: ReadyLease | LeaseRow, nowMs: number): boolean {
  return lease.status === "active" && lease.target.startsWith(LEASE_TARGET_PREFIX) && toTime(lease.expiresAt) > nowMs;
}

function toTime(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
