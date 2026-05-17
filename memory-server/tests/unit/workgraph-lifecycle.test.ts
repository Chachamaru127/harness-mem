import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initSchema, configureDatabase } from "../../src/db/schema";
import { createLeaseStore, type LeaseStore } from "../../src/lease/lease-store";
import { calculateClaimLeaseMetrics, claimWork, closeWork } from "../../src/workgraph/lifecycle";
import { createWorkStore, type WorkStore } from "../../src/workgraph/work-store";

function makeDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  return db;
}

describe("WorkGraph lifecycle lease integration", () => {
  let db: Database;
  let store: WorkStore;
  let leaseStore: LeaseStore;
  let nowMs: number;

  beforeEach(() => {
    db = makeDb();
    nowMs = Date.parse("2026-05-17T10:00:00.000Z");
    leaseStore = createLeaseStore(db, {
      now: () => nowMs,
      idGenerator: () => `lease-${nowMs}`,
    });
    store = createWorkStore(db, {
      now: () => new Date(nowMs).toISOString(),
    });
    store.upsertWorkItem({
      workId: "S125-010",
      title: "Claim and close integration",
      project: "/repo/harness-mem",
      status: "open",
      priority: 1,
      createdAt: "2026-05-17T09:00:00.000Z",
      updatedAt: "2026-05-17T09:00:00.000Z",
    });
  });

  afterEach(() => {
    db.close();
  });

  test("claim acquires a work lease and moves scoped work to in_progress", () => {
    const result = claimWork(db, leaseStore, {
      workId: "S125-010",
      project: "/repo/harness-mem",
      agentId: "codex-agent",
      sessionId: "session-1",
      ttlMs: 600_000,
      now: "2026-05-17T10:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("claim failed");
    expect(result.work.status).toBe("in_progress");
    expect(result.work.assignee).toBe("codex-agent");
    expect(result.lease.target).toBe("work:S125-010");
    expect(result.lease.status).toBe("active");
    expect(store.listEvents("S125-010").map((event) => event.eventType)).toContain("claimed");
    expect(store.listLinks("S125-010")).toContainEqual(
      expect.objectContaining({ targetType: "lease", targetId: result.lease.leaseId, relation: "claimed" })
    );

    const metrics = calculateClaimLeaseMetrics([result]);
    expect(metrics.claim_lease_success_rate).toBeGreaterThanOrEqual(0.98);
  });

  test("double claim returns already_leased and leaves status assigned to the first agent", () => {
    const first = claimWork(db, leaseStore, {
      workId: "S125-010",
      project: "/repo/harness-mem",
      agentId: "agent-a",
      now: "2026-05-17T10:00:00.000Z",
    });
    const second = claimWork(db, leaseStore, {
      workId: "S125-010",
      project: "/repo/harness-mem",
      agentId: "agent-b",
      now: "2026-05-17T10:01:00.000Z",
    });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: "already_leased", heldBy: "agent-a" });
    expect(store.getWorkItem("S125-010")).toMatchObject({
      status: "in_progress",
      assignee: "agent-a",
    });
  });

  test("close releases the existing lease and marks work closed in one lifecycle step", () => {
    const claimed = claimWork(db, leaseStore, {
      workId: "S125-010",
      project: "/repo/harness-mem",
      agentId: "agent-a",
      now: "2026-05-17T10:00:00.000Z",
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) throw new Error("claim failed");

    const closed = closeWork(db, leaseStore, {
      workId: "S125-010",
      project: "/repo/harness-mem",
      agentId: "agent-a",
      leaseId: claimed.lease.leaseId,
      reason: "Fixed and tested",
      now: "2026-05-17T10:05:00.000Z",
    });

    expect(closed.ok).toBe(true);
    if (!closed.ok) throw new Error("close failed");
    expect(closed.work.status).toBe("closed");
    expect(closed.work.closeReason).toBe("Fixed and tested");
    expect(closed.lease.status).toBe("released");
    expect(store.listEvents("S125-010").map((event) => event.eventType)).toEqual(["claimed", "closed"]);
  });

  test("close release failure keeps work in progress and lease active", () => {
    const claimed = claimWork(db, leaseStore, {
      workId: "S125-010",
      project: "/repo/harness-mem",
      agentId: "agent-a",
      now: "2026-05-17T10:00:00.000Z",
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) throw new Error("claim failed");

    const closed = closeWork(db, leaseStore, {
      workId: "S125-010",
      project: "/repo/harness-mem",
      agentId: "agent-b",
      leaseId: claimed.lease.leaseId,
      reason: "wrong owner",
      now: "2026-05-17T10:05:00.000Z",
    });

    expect(closed).toMatchObject({ ok: false, error: "lease_not_found" });
    expect(store.getWorkItem("S125-010")).toMatchObject({
      status: "in_progress",
      assignee: "agent-a",
      closedAt: null,
    });
    expect(leaseStore.get(claimed.lease.leaseId)).toMatchObject({ status: "active" });
  });
});
