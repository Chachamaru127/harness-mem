import {
  evaluateWorkReadiness,
  type EvaluateWorkReadinessInput,
  type ReadyDependency,
  type ReadyLease,
  type WorkReadinessResult,
} from "./ready";
import type { WorkDependencyRow, WorkItemRow } from "./work-store";

export interface NextWorkItem {
  workId: string;
  title?: string;
  status: string;
  priority?: number;
  updatedAt?: string;
  sessionId?: string | null;
}

export type NextScoreReasonCode = "priority" | "blocker_impact" | "recency" | "session_continuity";

export interface NextScoreReason {
  code: NextScoreReasonCode;
  score: number;
  message: string;
}

export interface NextWorkCandidate {
  rank: number;
  workId: string;
  title?: string;
  score: number;
  reasons: NextScoreReason[];
}

export interface RankNextWorkInput extends EvaluateWorkReadinessInput {
  workItems: Array<NextWorkItem | WorkItemRow>;
  dependencies?: Array<ReadyDependency | WorkDependencyRow>;
  activeLeases?: Array<ReadyLease>;
  currentSessionId?: string | null;
  readiness?: WorkReadinessResult;
  limit?: number;
}

export interface RankNextWorkResult {
  next: NextWorkCandidate | null;
  candidates: NextWorkCandidate[];
  readiness: WorkReadinessResult;
}

export interface NextActionMetricsFixture {
  expectedNextWorkId?: string;
  expectedNextWorkIds?: string[];
}

export interface NextActionMetrics {
  next_action_accuracy: number;
}

const DEFAULT_LIMIT = 10;

export function rankNextWork(input: RankNextWorkInput): RankNextWorkResult {
  const readiness = input.readiness ?? evaluateWorkReadiness(input);
  const ready = new Set(readiness.readyWorkIds);
  const nowMs = toTime(input.now ?? Date.now());
  const blockedByCandidate = countBlockedByCandidate(input.workItems, input.dependencies ?? []);

  const candidates = input.workItems
    .filter((item) => ready.has(item.workId))
    .map((item) => scoreCandidate(item, {
      blockedCount: blockedByCandidate.get(item.workId) ?? 0,
      currentSessionId: input.currentSessionId ?? null,
      nowMs,
    }))
    .sort(compareCandidates)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }))
    .slice(0, normalizeLimit(input.limit));

  return {
    next: candidates[0] ?? null,
    candidates,
    readiness,
  };
}

export function calculateNextActionMetrics(
  result: Pick<RankNextWorkResult, "next" | "candidates">,
  fixture: NextActionMetricsFixture
): NextActionMetrics {
  if (fixture.expectedNextWorkId) {
    return {
      next_action_accuracy: result.next?.workId === fixture.expectedNextWorkId ? 1 : 0,
    };
  }

  const expected = fixture.expectedNextWorkIds ?? [];
  if (expected.length === 0) {
    return { next_action_accuracy: 1 };
  }
  const ranked = result.candidates.slice(0, expected.length);
  const matches = expected.filter((workId, index) => ranked[index]?.workId === workId).length;
  return {
    next_action_accuracy: matches / expected.length,
  };
}

function scoreCandidate(
  item: NextWorkItem | WorkItemRow,
  context: { blockedCount: number; currentSessionId: string | null; nowMs: number }
): NextWorkCandidate {
  const reasons: NextScoreReason[] = [
    priorityScore(item.priority),
    blockerImpactScore(context.blockedCount),
    recencyScore(item.updatedAt, context.nowMs),
    sessionContinuityScore(item.sessionId ?? null, context.currentSessionId),
  ];
  const score = Number(reasons.reduce((sum, reason) => sum + reason.score, 0).toFixed(3));
  return {
    rank: 0,
    workId: item.workId,
    ...(item.title ? { title: item.title } : {}),
    score,
    reasons,
  };
}

function priorityScore(priority: number | undefined): NextScoreReason {
  const normalizedPriority = typeof priority === "number" && Number.isFinite(priority) ? priority : 2;
  const score = clamp(5 - normalizedPriority, 0, 5) * 8;
  return {
    code: "priority",
    score,
    message: `priority ${normalizedPriority}`,
  };
}

function blockerImpactScore(blockedCount: number): NextScoreReason {
  return {
    code: "blocker_impact",
    score: Math.min(5, Math.max(0, blockedCount)) * 10,
    message: blockedCount === 1 ? "unblocks 1 work item" : `unblocks ${blockedCount} work items`,
  };
}

function recencyScore(updatedAt: string | undefined, nowMs: number): NextScoreReason {
  const updatedMs = updatedAt ? toTime(updatedAt) : Number.NaN;
  if (!Number.isFinite(updatedMs)) {
    return { code: "recency", score: 0, message: "no updated_at timestamp" };
  }

  const ageHours = Math.max(0, (nowMs - updatedMs) / 3_600_000);
  const score =
    ageHours <= 1 ? 15 :
    ageHours <= 24 ? 10 :
    ageHours <= 24 * 7 ? 5 :
    0;
  return {
    code: "recency",
    score,
    message: `updated ${Number(ageHours.toFixed(2))} hours ago`,
  };
}

function sessionContinuityScore(sessionId: string | null, currentSessionId: string | null): NextScoreReason {
  if (sessionId && currentSessionId && sessionId === currentSessionId) {
    return { code: "session_continuity", score: 20, message: `continues session ${sessionId}` };
  }
  if (sessionId) {
    return { code: "session_continuity", score: 8, message: `has session ${sessionId}` };
  }
  return { code: "session_continuity", score: 0, message: "no session continuity" };
}

function countBlockedByCandidate(
  workItems: Array<NextWorkItem | WorkItemRow>,
  dependencies: Array<ReadyDependency | WorkDependencyRow>
): Map<string, number> {
  const statusByWorkId = new Map(workItems.map((item) => [item.workId, item.status]));
  const counts = new Map<string, number>();
  for (const dependency of dependencies) {
    if (dependency.relation !== "blocks") continue;
    const downstreamStatus = statusByWorkId.get(dependency.toWorkId);
    if (!downstreamStatus || downstreamStatus === "closed") continue;
    counts.set(dependency.fromWorkId, (counts.get(dependency.fromWorkId) ?? 0) + 1);
  }
  return counts;
}

function compareCandidates(left: NextWorkCandidate, right: NextWorkCandidate): number {
  if (right.score !== left.score) return right.score - left.score;
  const leftPriority = reasonScore(left, "priority");
  const rightPriority = reasonScore(right, "priority");
  if (rightPriority !== leftPriority) return rightPriority - leftPriority;
  return left.workId.localeCompare(right.workId);
}

function reasonScore(candidate: NextWorkCandidate, code: NextScoreReasonCode): number {
  return candidate.reasons.find((reason) => reason.code === code)?.score ?? 0;
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function toTime(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
