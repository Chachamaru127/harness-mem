import { afterEach, describe, expect, test } from "bun:test";
import { createTestDb, insertTestObservation } from "../core-split/test-helpers";
import {
  buildRecallProjectionPlan,
  clearRecallProjection,
  materializeRecallProjection,
  readRecallDataWatermark,
} from "../../src/recall/projection";

describe("Recall projection", () => {
  const dbs: ReturnType<typeof createTestDb>[] = [];

  function db(): ReturnType<typeof createTestDb> {
    const next = createTestDb();
    dbs.push(next);
    return next;
  }

  afterEach(() => {
    while (dbs.length > 0) {
      dbs.pop()?.close();
    }
  });

  test("dry-run builds scoped recall items without writing projection rows", () => {
    const store = db();
    insertTestObservation(store, {
      id: "obs-decision",
      project: "proj-a",
      title: "Use local projection",
      content: "Decision: keep mem_observations as cold truth and use hot projection.",
      observation_type: "decision",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    insertTestObservation(store, {
      id: "obs-private",
      project: "proj-a",
      content: "private note should not project by default",
      privacy_tags: ["private"],
      created_at: "2026-05-22T00:01:00.000Z",
    });
    insertTestObservation(store, {
      id: "obs-other",
      project: "proj-b",
      content: "other project",
      created_at: "2026-05-22T00:02:00.000Z",
    });

    const plan = buildRecallProjectionPlan(store, {
      project: "proj-a",
      now: () => "2026-05-22T00:03:00.000Z",
    });

    expect(plan.project).toBe("proj-a");
    expect(plan.candidate_count).toBe(2);
    expect(plan.planned_count).toBe(1);
    expect(plan.skipped_reasons.private).toBe(1);
    expect(plan.items[0]).toMatchObject({
      recall_type: "decision",
      source_type: "observation",
      source_id: "obs-decision",
      source_ref: "observation:obs-decision",
      projection_generation: plan.generation,
    });

    const projected = store
      .query(`SELECT COUNT(*) AS count FROM mem_recall_items`)
      .get() as { count: number };
    expect(projected.count).toBe(0);
  });

  test("materialize is idempotent and clear removes project projection rows", () => {
    const store = db();
    insertTestObservation(store, {
      id: "obs-fact",
      project: "proj-a",
      content: "Repeat recall cache uses knobs hash and watermark.",
      created_at: "2026-05-22T00:00:00.000Z",
    });

    const first = materializeRecallProjection(store, {
      project: "proj-a",
      now: () => "2026-05-22T00:01:00.000Z",
    });
    const second = materializeRecallProjection(store, {
      project: "proj-a",
      now: () => "2026-05-22T00:02:00.000Z",
    });

    expect(second.generation).toBe(first.generation);
    const itemRows = store
      .query(`SELECT COUNT(*) AS count FROM mem_recall_items WHERE project = 'proj-a'`)
      .get() as { count: number };
    expect(itemRows.count).toBe(1);
    const runRows = store
      .query(`SELECT COUNT(*) AS count FROM mem_recall_projection_runs WHERE project = 'proj-a'`)
      .get() as { count: number };
    expect(runRows.count).toBe(1);

    const cleared = clearRecallProjection(store, "proj-a");
    expect(cleared.deleted_items).toBe(1);
    expect(cleared.deleted_runs).toBe(1);
  });

  test("watermark changes when scoped source observations change", () => {
    const store = db();
    insertTestObservation(store, {
      id: "obs-a",
      project: "proj-a",
      content: "first",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const before = readRecallDataWatermark(store, { project: "proj-a" });
    insertTestObservation(store, {
      id: "obs-b",
      project: "proj-a",
      content: "second",
      created_at: "2026-05-22T00:01:00.000Z",
    });
    expect(readRecallDataWatermark(store, { project: "proj-a" })).not.toBe(before);
  });
});
