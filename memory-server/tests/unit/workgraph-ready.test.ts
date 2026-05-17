import { describe, expect, test } from "bun:test";
import {
  calculateReadyMetrics,
  evaluateWorkReadiness,
  type ReadyDependency,
  type ReadyLease,
  type ReadyWorkItem,
} from "../../src/workgraph/ready";

const now = "2026-05-17T10:00:00.000Z";

const fixtureWorkItems: ReadyWorkItem[] = [
  { workId: "done-blocker", title: "Closed blocker", status: "closed" },
  { workId: "open-blocker", title: "Open blocker", status: "open" },
  { workId: "checkpoint-gate", title: "Approval gate", status: "open" },
  { workId: "ready-task", title: "Ready task", status: "open" },
  { workId: "blocked-task", title: "Blocked task", status: "open" },
  { workId: "checkpoint-task", title: "Checkpoint task", status: "open" },
  { workId: "new-replacement", title: "New replacement", status: "open" },
  { workId: "old-task", title: "Old task", status: "open" },
  { workId: "canonical-duplicate", title: "Canonical duplicate", status: "open" },
  { workId: "duplicate-task", title: "Duplicate task", status: "open" },
  { workId: "leased-task", title: "Leased task", status: "open" },
  { workId: "in-progress-task", title: "Busy task", status: "in_progress" },
  { workId: "closed-task", title: "Closed task", status: "closed" },
  { workId: "related-task", title: "Related task", status: "open" },
];

const fixtureDependencies: ReadyDependency[] = [
  { fromWorkId: "done-blocker", toWorkId: "ready-task", relation: "blocks" },
  { fromWorkId: "open-blocker", toWorkId: "blocked-task", relation: "blocks" },
  { fromWorkId: "checkpoint-gate", toWorkId: "checkpoint-task", relation: "checkpoint" },
  { fromWorkId: "new-replacement", toWorkId: "old-task", relation: "supersedes" },
  { fromWorkId: "canonical-duplicate", toWorkId: "duplicate-task", relation: "duplicates" },
  { fromWorkId: "ready-task", toWorkId: "related-task", relation: "related" },
  { fromWorkId: "ready-task", toWorkId: "related-task", relation: "discovered_from" },
  { fromWorkId: "ready-task", toWorkId: "related-task", relation: "parent_child" },
];

const fixtureLeases: ReadyLease[] = [
  {
    target: "work:leased-task",
    agentId: "codex-worker",
    status: "active",
    expiresAt: "2026-05-17T10:10:00.000Z",
  },
  {
    target: "work:ready-task",
    agentId: "old-worker",
    status: "active",
    expiresAt: "2026-05-17T09:59:00.000Z",
  },
];

describe("WorkGraph ready algorithm", () => {
  test("returns ready work and fixed-fixture metrics", () => {
    const result = evaluateWorkReadiness({
      workItems: fixtureWorkItems,
      dependencies: fixtureDependencies,
      activeLeases: fixtureLeases,
      now,
    });

    expect(result.readyWorkIds).toEqual([
      "canonical-duplicate",
      "checkpoint-gate",
      "new-replacement",
      "open-blocker",
      "ready-task",
      "related-task",
    ]);

    const metrics = calculateReadyMetrics(result, {
      expectedReadyWorkIds: [
        "canonical-duplicate",
        "checkpoint-gate",
        "new-replacement",
        "open-blocker",
        "ready-task",
        "related-task",
      ],
      expectedBlockedWorkIds: [
        "blocked-task",
        "checkpoint-task",
        "old-task",
        "duplicate-task",
        "leased-task",
        "in-progress-task",
        "closed-task",
      ],
    });

    expect(metrics.ready_precision).toBeGreaterThanOrEqual(0.95);
    expect(metrics.blocker_recall).toBeGreaterThanOrEqual(0.95);
  });

  test("explains blocking relations", () => {
    const result = evaluateWorkReadiness({
      workItems: fixtureWorkItems,
      dependencies: fixtureDependencies,
      now,
    });

    expect(result.reasonsByWorkId["blocked-task"]).toContainEqual(
      expect.objectContaining({ code: "blocked_by", relatedWorkId: "open-blocker" })
    );
    expect(result.reasonsByWorkId["checkpoint-task"]).toContainEqual(
      expect.objectContaining({ code: "checkpoint_waiting", relatedWorkId: "checkpoint-gate" })
    );
    expect(result.reasonsByWorkId["old-task"]).toContainEqual(
      expect.objectContaining({ code: "superseded", relatedWorkId: "new-replacement" })
    );
    expect(result.reasonsByWorkId["duplicate-task"]).toContainEqual(
      expect.objectContaining({ code: "duplicate", relatedWorkId: "canonical-duplicate" })
    );
  });

  test("filters active work leases but ignores expired and non-work leases", () => {
    const result = evaluateWorkReadiness({
      workItems: [
        { workId: "leased-task", status: "open" },
        { workId: "expired-lease-task", status: "open" },
        { workId: "file-lease-task", status: "open" },
      ],
      activeLeases: [
        {
          target: "work:leased-task",
          agentId: "codex-worker",
          status: "active",
          expiresAt: "2026-05-17T10:10:00.000Z",
        },
        {
          target: "work:expired-lease-task",
          agentId: "old-worker",
          status: "active",
          expiresAt: "2026-05-17T09:59:00.000Z",
        },
        {
          target: "file:memory-server/src/workgraph/ready.ts",
          agentId: "file-worker",
          status: "active",
          expiresAt: "2026-05-17T10:10:00.000Z",
        },
      ],
      now,
    });

    expect(result.readyWorkIds).toEqual(["expired-lease-task", "file-lease-task"]);
    expect(result.reasonsByWorkId["leased-task"]).toContainEqual(
      expect.objectContaining({
        code: "leased",
        lease: expect.objectContaining({ target: "work:leased-task", agentId: "codex-worker" }),
      })
    );
  });

  test("only open status can be ready", () => {
    const result = evaluateWorkReadiness({
      workItems: [
        { workId: "todo", status: "open" },
        { workId: "busy", status: "in_progress" },
        { workId: "blocked", status: "blocked" },
        { workId: "done", status: "closed" },
        { workId: "later", status: "deferred" },
      ],
      now,
    });

    expect(result.readyWorkIds).toEqual(["todo"]);
    expect(result.reasonsByWorkId["busy"]).toContainEqual(expect.objectContaining({ code: "status" }));
    expect(result.reasonsByWorkId["blocked"]).toContainEqual(expect.objectContaining({ code: "status" }));
    expect(result.reasonsByWorkId["done"]).toContainEqual(expect.objectContaining({ code: "status" }));
    expect(result.reasonsByWorkId["later"]).toContainEqual(expect.objectContaining({ code: "status" }));
  });
});
