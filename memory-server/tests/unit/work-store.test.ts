import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { configureDatabase, initSchema } from "../../src/db/schema";
import { WORK_DEPENDENCY_RELATIONS, createWorkStore, type WorkStore } from "../../src/workgraph/work-store";

function makeDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  return db;
}

describe("WorkStore", () => {
  let db: Database;
  let store: WorkStore;
  let tick: number;

  beforeEach(() => {
    db = makeDb();
    tick = 1_779_000_000_000;
    store = createWorkStore(db, {
      now: () => new Date(tick += 1_000).toISOString(),
    });
  });

  afterEach(() => {
    db.close();
  });

  test("upserts and gets work items with schema defaults", () => {
    const created = store.createWorkItem({
      workId: "S125-003",
      title: "Add WorkStore MVP",
      project: "/repo/harness-mem",
      sourceType: "plans",
      sourceRef: "plans:S125-003",
      metadata: { owner: "worker-s125-003" },
    });

    expect(created.workId).toBe("S125-003");
    expect(created.description).toBe("");
    expect(created.status).toBe("open");
    expect(created.priority).toBe(2);
    expect(created.workType).toBe("task");
    expect(created.createdBy).toBe("system");
    expect(created.metadata.owner).toBe("worker-s125-003");

    const updated = store.upsertWorkItem({
      workId: "S125-003",
      title: "Add additive WorkGraph schema and WorkStore MVP",
      project: "/repo/harness-mem",
      status: "in_progress",
      priority: 1,
    });

    expect(updated.title).toBe("Add additive WorkGraph schema and WorkStore MVP");
    expect(updated.status).toBe("in_progress");
    expect(updated.priority).toBe(1);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(store.getWorkItem("S125-003")?.title).toBe(updated.title);
  });

  test("adds validated idempotent dependencies and cascades deletes", () => {
    store.createWorkItem({ workId: "work-a", title: "A", project: "proj" });
    store.createWorkItem({ workId: "work-b", title: "B", project: "proj" });

    for (const relation of WORK_DEPENDENCY_RELATIONS) {
      const dep = store.addDependency({
        fromWorkId: "work-a",
        toWorkId: "work-b",
        relation,
        metadata: { relation },
      });
      expect(dep.relation).toBe(relation);
    }

    store.addDependency({ fromWorkId: "work-a", toWorkId: "work-b", relation: "blocks" });
    expect(store.listDependencies("work-a")).toHaveLength(WORK_DEPENDENCY_RELATIONS.length);
    expect(store.listDependencies("work-b", "to")).toHaveLength(WORK_DEPENDENCY_RELATIONS.length);

    expect(() =>
      store.addDependency({ fromWorkId: "work-a", toWorkId: "work-b", relation: "invalid_relation" })
    ).toThrow(/invalid work dependency relation/);

    db.query(`DELETE FROM mem_work_items WHERE work_id = ?`).run("work-b");
    expect(store.listDependencies()).toHaveLength(0);
  });

  test("records work events and evidence links with cascade cleanup", () => {
    store.createWorkItem({ workId: "work-a", title: "A", project: "proj" });

    const event = store.recordEvent({
      eventId: "evt-work-a-1",
      workId: "work-a",
      eventType: "imported",
      actor: "codex",
      sessionId: "sess-1",
      payload: { source: "Plans.md" },
    });
    expect(event).toMatchObject({
      eventId: "evt-work-a-1",
      workId: "work-a",
      eventType: "imported",
      actor: "codex",
      sessionId: "sess-1",
      payload: { source: "Plans.md" },
    });

    const link = store.addLink({
      workId: "work-a",
      targetType: "observation",
      targetId: "obs-1",
      relation: "evidence",
    });
    expect(link).toMatchObject({
      workId: "work-a",
      targetType: "observation",
      targetId: "obs-1",
      relation: "evidence",
    });

    store.addLink({ workId: "work-a", targetType: "observation", targetId: "obs-1", relation: "evidence" });
    expect(store.listEvents("work-a")).toHaveLength(1);
    expect(store.listLinks("work-a")).toHaveLength(1);
    expect(store.listLinksByTarget("observation", "obs-1")).toHaveLength(1);

    db.query(`DELETE FROM mem_work_items WHERE work_id = ?`).run("work-a");
    expect(store.listEvents("work-a")).toHaveLength(0);
    expect(store.listLinksByTarget("observation", "obs-1")).toHaveLength(0);
  });
});
