import { Database } from "bun:sqlite";
import { configureDatabase, initSchema } from "../db/schema";
import { createLeaseStore } from "../lease/lease-store";
import { calculateClaimLeaseMetrics, claimWork } from "../workgraph/lifecycle";
import { calculateNextActionMetrics, rankNextWork, type NextWorkItem } from "../workgraph/next";
import { importPlansToWorkGraphDryRun } from "../workgraph/plans-importer";
import {
  calculateReadyMetrics,
  evaluateWorkReadiness,
  type ReadyDependency,
  type ReadyLease,
  type ReadyWorkItem,
} from "../workgraph/ready";
import { createWorkStore } from "../workgraph/work-store";
import { runWorkHintActionabilitySmoke } from "./work-hint-actionability-smoke";

export type WorkGraphGateMode = "warn" | "enforce";
export type WorkGraphGateTier = "green" | "yellow" | "red";

export interface WorkGraphReleaseGateMetrics {
  plans_import_fidelity: number;
  ready_precision: number;
  blocker_recall: number;
  next_action_accuracy: number;
  duplicate_work_rate: number;
  claim_lease_success_rate: number;
  work_hint_consumed_rate: number;
}

export interface WorkGraphReleaseGateResult {
  mode: WorkGraphGateMode;
  tier: WorkGraphGateTier;
  passed: boolean;
  failed_metrics: string[];
  metrics: WorkGraphReleaseGateMetrics;
  thresholds: {
    plans_import_fidelity_min: 0.98;
    ready_precision_min: 0.95;
    blocker_recall_min: 0.95;
    next_action_accuracy_min: 0.8;
    duplicate_work_rate_max: 0.05;
    claim_lease_success_rate_min: 0.98;
    work_hint_consumed_rate_yellow_min: 0.3;
    work_hint_consumed_rate_green_min: 0.6;
  };
}

const NOW = "2026-05-17T10:00:00.000Z";
const PROJECT = "/repo/harness-mem";

const PLANS_FIXTURE = `
## §125 WorkGraph Task Continuity MVP — cc:TODO
| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S125-001 | **Spec freeze** — lock scope | spec passes | - | cc:完了 [abc1234] |
| S125-002 | **Parser dry-run** — parse active rows | parser passes | S125-001 | cc:完了 [def5678] |
| S125-003 | **Schema MVP** — add work tables | schema passes | S125-001, S125-002 | cc:完了 [aaa1111] |
| S125-004 | **Import model** — map parser to work store | import passes | S125-002, S125-003 | cc:TODO |
| S125-005 | **Ready algorithm** — block/lease readiness | ready passes | S125-003, S125-004 | cc:TODO |
`;

const READY_WORK_ITEMS: ReadyWorkItem[] = [
  { workId: "done-blocker", status: "closed" },
  { workId: "open-blocker", status: "open" },
  { workId: "ready-task", status: "open" },
  { workId: "blocked-task", status: "open" },
  { workId: "checkpoint-gate", status: "open" },
  { workId: "checkpoint-task", status: "open" },
  { workId: "canonical-duplicate", status: "open" },
  { workId: "duplicate-task", status: "open" },
  { workId: "leased-task", status: "open" },
];

const READY_DEPENDENCIES: ReadyDependency[] = [
  { fromWorkId: "done-blocker", toWorkId: "ready-task", relation: "blocks" },
  { fromWorkId: "open-blocker", toWorkId: "blocked-task", relation: "blocks" },
  { fromWorkId: "checkpoint-gate", toWorkId: "checkpoint-task", relation: "checkpoint" },
  { fromWorkId: "canonical-duplicate", toWorkId: "duplicate-task", relation: "duplicates" },
];

const READY_LEASES: ReadyLease[] = [
  {
    target: "work:leased-task",
    agentId: "codex-worker",
    status: "active",
    expiresAt: "2026-05-17T10:10:00.000Z",
  },
];

const NEXT_WORK_ITEMS: NextWorkItem[] = [
  {
    workId: "S125-009",
    title: "Next query API",
    status: "open",
    priority: 1,
    updatedAt: "2026-05-17T09:55:00.000Z",
    sessionId: "session-s125",
  },
  {
    workId: "S125-010",
    title: "Claim integration",
    status: "open",
    priority: 1,
    updatedAt: "2026-05-17T09:50:00.000Z",
  },
  {
    workId: "S125-011",
    title: "Handoff integration",
    status: "open",
    priority: 2,
    updatedAt: "2026-05-17T09:45:00.000Z",
  },
  {
    workId: "S125-012",
    title: "MCP exposure",
    status: "open",
    priority: 1,
    updatedAt: "2026-05-17T09:40:00.000Z",
  },
];

const NEXT_DEPENDENCIES: ReadyDependency[] = [
  { fromWorkId: "S125-009", toWorkId: "S125-010", relation: "blocks" },
  { fromWorkId: "S125-009", toWorkId: "S125-011", relation: "blocks" },
];

export function runWorkGraphReleaseGateSmoke(
  mode: WorkGraphGateMode = "warn",
): WorkGraphReleaseGateResult {
  const plansImport = importPlansToWorkGraphDryRun(PLANS_FIXTURE, {
    project: PROJECT,
    expectedWorkItemCount: 5,
  });

  const readiness = evaluateWorkReadiness({
    workItems: READY_WORK_ITEMS,
    dependencies: READY_DEPENDENCIES,
    activeLeases: READY_LEASES,
    now: NOW,
  });
  const readyMetrics = calculateReadyMetrics(readiness, {
    expectedReadyWorkIds: ["canonical-duplicate", "checkpoint-gate", "open-blocker", "ready-task"],
    expectedBlockedWorkIds: ["blocked-task", "checkpoint-task", "duplicate-task", "leased-task"],
  });

  const next = rankNextWork({
    workItems: NEXT_WORK_ITEMS,
    dependencies: NEXT_DEPENDENCIES,
    currentSessionId: "session-s125",
    now: NOW,
  });
  const nextMetrics = calculateNextActionMetrics(next, {
    expectedNextWorkId: "S125-009",
  });

  const metrics: WorkGraphReleaseGateMetrics = {
    plans_import_fidelity: round4(plansImport.metrics.plans_import_fidelity),
    ready_precision: round4(readyMetrics.ready_precision),
    blocker_recall: round4(readyMetrics.blocker_recall),
    next_action_accuracy: round4(nextMetrics.next_action_accuracy),
    duplicate_work_rate: round4(calculateDuplicateWorkRate(plansImport)),
    claim_lease_success_rate: round4(calculateClaimLeaseSuccessRate()),
    work_hint_consumed_rate: runWorkHintActionabilitySmoke().work_hint_consumed_rate,
  };

  const thresholds = {
    plans_import_fidelity_min: 0.98,
    ready_precision_min: 0.95,
    blocker_recall_min: 0.95,
    next_action_accuracy_min: 0.8,
    duplicate_work_rate_max: 0.05,
    claim_lease_success_rate_min: 0.98,
    work_hint_consumed_rate_yellow_min: 0.3,
    work_hint_consumed_rate_green_min: 0.6,
  } as const;

  const failed = failedMetrics(metrics, thresholds);
  const passed = failed.length === 0;
  return {
    mode,
    tier: passed ? "green" : metrics.work_hint_consumed_rate >= thresholds.work_hint_consumed_rate_yellow_min ? "yellow" : "red",
    passed,
    failed_metrics: failed,
    metrics,
    thresholds,
  };
}

function calculateDuplicateWorkRate(
  plansImport: ReturnType<typeof importPlansToWorkGraphDryRun>,
): number {
  const db = makeDb();
  try {
    const store = createWorkStore(db);
    for (let pass = 0; pass < 2; pass += 1) {
      for (const item of plansImport.workItems) {
        store.upsertWorkItem(item);
      }
      for (const dependency of plansImport.dependencies) {
        store.addDependency(dependency);
      }
    }
    const workRows = store.listWorkItems(PROJECT).length;
    const dependencyRows = store.listDependencies().length;
    const expectedRows = plansImport.workItems.length + plansImport.dependencies.length;
    const actualRows = workRows + dependencyRows;
    return expectedRows === 0 ? 0 : Math.max(0, actualRows - expectedRows) / expectedRows;
  } finally {
    db.close();
  }
}

function calculateClaimLeaseSuccessRate(): number {
  const db = makeDb();
  try {
    const store = createWorkStore(db);
    const leaseStore = createLeaseStore(db, {
      now: () => Date.parse(NOW),
      idGenerator: () => "lease-workgraph-gate",
    });
    store.upsertWorkItem({
      workId: "S125-claim",
      title: "Claim fixture",
      project: PROJECT,
      status: "open",
      priority: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const claim = claimWork(db, leaseStore, {
      workId: "S125-claim",
      project: PROJECT,
      agentId: "gate-agent",
      sessionId: "session-gate",
      ttlMs: 600_000,
      now: NOW,
    });
    return calculateClaimLeaseMetrics([claim]).claim_lease_success_rate;
  } finally {
    db.close();
  }
}

function failedMetrics(
  metrics: WorkGraphReleaseGateMetrics,
  thresholds: WorkGraphReleaseGateResult["thresholds"],
): string[] {
  const failed: string[] = [];
  if (metrics.plans_import_fidelity < thresholds.plans_import_fidelity_min) failed.push("plans_import_fidelity");
  if (metrics.ready_precision < thresholds.ready_precision_min) failed.push("ready_precision");
  if (metrics.blocker_recall < thresholds.blocker_recall_min) failed.push("blocker_recall");
  if (metrics.next_action_accuracy < thresholds.next_action_accuracy_min) failed.push("next_action_accuracy");
  if (metrics.duplicate_work_rate > thresholds.duplicate_work_rate_max) failed.push("duplicate_work_rate");
  if (metrics.claim_lease_success_rate < thresholds.claim_lease_success_rate_min) failed.push("claim_lease_success_rate");
  if (metrics.work_hint_consumed_rate < thresholds.work_hint_consumed_rate_yellow_min) failed.push("work_hint_consumed_rate");
  return failed;
}

function makeDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  return db;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

if (import.meta.main) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(runWorkGraphReleaseGateSmoke(), null, 2));
}
