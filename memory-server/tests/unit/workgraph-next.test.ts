import { describe, expect, test } from "bun:test";
import { calculateNextActionMetrics, rankNextWork, type NextWorkItem } from "../../src/workgraph/next";
import type { ReadyDependency, ReadyLease } from "../../src/workgraph/ready";

const now = "2026-05-17T10:00:00.000Z";

const fixtureWorkItems: NextWorkItem[] = [
  {
    workId: "S125-009",
    title: "Next scoring and HTTP query",
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
    title: "Opt-in MCP work tools",
    status: "open",
    priority: 1,
    updatedAt: "2026-05-17T09:40:00.000Z",
  },
  {
    workId: "S125-013",
    title: "Hook suggestions",
    status: "open",
    priority: 0,
    updatedAt: "2026-05-17T09:59:00.000Z",
  },
  {
    workId: "S125-014",
    title: "UI explainability",
    status: "closed",
    priority: 0,
    updatedAt: "2026-05-17T09:59:00.000Z",
  },
  {
    workId: "S125-015",
    title: "Release gate",
    status: "open",
    priority: 2,
    updatedAt: "2026-05-10T09:00:00.000Z",
  },
];

const fixtureDependencies: ReadyDependency[] = [
  { fromWorkId: "S125-009", toWorkId: "S125-010", relation: "blocks" },
  { fromWorkId: "S125-009", toWorkId: "S125-011", relation: "blocks" },
  { fromWorkId: "S125-012", toWorkId: "S125-013", relation: "blocks" },
  { fromWorkId: "S125-014", toWorkId: "S125-015", relation: "blocks" },
];

describe("WorkGraph next scoring", () => {
  test("prioritizes ready work by priority, blocker impact, recency, and session continuity", () => {
    const result = rankNextWork({
      workItems: fixtureWorkItems,
      dependencies: fixtureDependencies,
      currentSessionId: "session-s125",
      now,
    });

    expect(result.next?.workId).toBe("S125-009");
    expect(result.candidates.map((candidate) => candidate.workId)).toEqual([
      "S125-009",
      "S125-012",
      "S125-015",
    ]);
    expect(result.candidates[0]?.reasons.map((reason) => reason.code)).toEqual([
      "priority",
      "blocker_impact",
      "recency",
      "session_continuity",
    ]);

    const metrics = calculateNextActionMetrics(result, { expectedNextWorkId: "S125-009" });
    expect(metrics.next_action_accuracy).toBeGreaterThanOrEqual(0.8);
  });

  test("excludes active leased work from next candidates", () => {
    const activeLeases: ReadyLease[] = [
      {
        target: "work:S125-009",
        agentId: "codex-worker",
        status: "active",
        expiresAt: "2026-05-17T10:10:00.000Z",
      },
    ];

    const result = rankNextWork({
      workItems: fixtureWorkItems,
      dependencies: fixtureDependencies,
      activeLeases,
      currentSessionId: "session-s125",
      now,
    });

    expect(result.next?.workId).toBe("S125-012");
    expect(result.readiness.reasonsByWorkId["S125-009"]).toContainEqual(
      expect.objectContaining({ code: "leased" })
    );
  });
});
