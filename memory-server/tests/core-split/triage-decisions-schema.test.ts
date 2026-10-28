import { describe, expect, test } from "bun:test";
import { createTestDb, insertTestObservation } from "./test-helpers";

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type IndexRow = {
  name: string;
  unique: number;
};

function columns(db: ReturnType<typeof createTestDb>): ColumnInfo[] {
  return db.query<ColumnInfo, []>("PRAGMA table_info(mem_triage_decisions)").all();
}

function insertDecision(
  db: ReturnType<typeof createTestDb>,
  overrides: Partial<{
    observation_id: string;
    project: string;
    model: string;
    threshold: number;
    score: number | null;
    decision: string;
    fallback: number;
    batch_id: string;
    created_at: string;
  }> = {},
  mode: "ignore" | "strict" = "ignore",
): void {
  const row = {
    observation_id: "obs-triage-1",
    project: "test-project",
    model: "typesafe/jev-1.14.0",
    threshold: 0.3,
    score: 0.72,
    decision: "keep",
    fallback: 0,
    batch_id: "batch-1",
    created_at: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
  const verb = mode === "ignore" ? "INSERT OR IGNORE" : "INSERT";
  db.query(
    `${verb} INTO mem_triage_decisions(
       observation_id, project, model, threshold, score, decision, fallback, batch_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.observation_id,
    row.project,
    row.model,
    row.threshold,
    row.score,
    row.decision,
    row.fallback,
    row.batch_id,
    row.created_at,
  );
}

describe("mem_triage_decisions schema", () => {
  test("table exists with the columns and constraints required by the triage contract", () => {
    const db = createTestDb();
    try {
      const names = columns(db).map((column) => column.name);
      expect(names).toEqual([
        "id",
        "observation_id",
        "project",
        "model",
        "threshold",
        "score",
        "durable",
        "decision",
        "fallback",
        "batch_id",
        "created_at",
      ]);

      const byName = new Map(columns(db).map((column) => [column.name, column]));
      expect(byName.get("id")).toMatchObject({ type: "INTEGER", pk: 1 });
      expect(byName.get("observation_id")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("project")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("model")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("threshold")).toMatchObject({ type: "REAL", notnull: 1 });
      expect(byName.get("score")).toMatchObject({ type: "REAL", notnull: 0 });
      expect(byName.get("decision")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("fallback")).toMatchObject({ type: "INTEGER", notnull: 1 });
      expect(byName.get("batch_id")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("created_at")).toMatchObject({ type: "TEXT", notnull: 1 });
    } finally {
      db.close();
    }
  });

  test("declared indexes exist: unique per (observation_id, model) and project/created lookup", () => {
    const db = createTestDb();
    try {
      const indexes = new Map(
        db.query<IndexRow, []>("PRAGMA index_list(mem_triage_decisions)")
          .all().map((row) => [row.name, row]),
      );

      expect(indexes.get("idx_mem_triage_decisions_obs_model")?.unique).toBe(1);
      expect(indexes.get("idx_mem_triage_decisions_project_created")?.unique).toBe(0);

      const obsModelColumns = db.query<{ name: string }, []>(
        "PRAGMA index_info(idx_mem_triage_decisions_obs_model)",
      ).all().map((row) => row.name);
      expect(obsModelColumns).toEqual(["observation_id", "model"]);

      const projectCreatedColumns = db.query<{ name: string }, []>(
        "PRAGMA index_info(idx_mem_triage_decisions_project_created)",
      ).all().map((row) => row.name);
      expect(projectCreatedColumns).toEqual(["project", "created_at"]);
    } finally {
      db.close();
    }
  });

  test("decision and fallback reject values outside the contract", () => {
    const db = createTestDb();
    try {
      const observationId = insertTestObservation(db, { id: "obs-check-constraints" });

      expect(() => insertDecision(db, { observation_id: observationId, decision: "drop" }, "strict")).toThrow();
      expect(() => insertDecision(db, { observation_id: observationId, fallback: 2 }, "strict")).toThrow();

      insertDecision(db, { observation_id: observationId, score: null, decision: "compact", fallback: 1 });
      const row = db.query<{ decision: string; fallback: number; score: number | null }, []>(
        "SELECT decision, fallback, score FROM mem_triage_decisions WHERE observation_id = ?",
      ).get(observationId);
      // score is nullable because a failed or partial answer is recorded as a
      // compaction candidate with no score and fallback = 1.
      expect(row).toEqual({ decision: "compact", fallback: 1, score: null });
    } finally {
      db.close();
    }
  });

  test("re-running the same (observation_id, model) with INSERT OR IGNORE is idempotent and keeps the first verdict", () => {
    const db = createTestDb();
    try {
      const observationId = insertTestObservation(db, { id: "obs-idempotent" });

      insertDecision(db, { observation_id: observationId, model: "typesafe/jev-1.14.0", decision: "keep", score: 0.8 });
      insertDecision(db, {
        observation_id: observationId,
        model: "typesafe/jev-1.14.0",
        decision: "compact",
        score: 0.1,
        batch_id: "batch-2",
        created_at: "2026-10-20T01:00:00.000Z",
      });

      const rows = db.query<{ decision: string; batch_id: string; score: number }, [string, string]>(
        `SELECT decision, batch_id, score FROM mem_triage_decisions
         WHERE observation_id = ? AND model = ?`,
      ).all(observationId, "typesafe/jev-1.14.0");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ decision: "keep", batch_id: "batch-1", score: 0.8 });

      // The same observation judged by another model version is a separate row.
      insertDecision(db, { observation_id: observationId, model: "clef-fallback", decision: "compact", score: 0.05 });
      expect(
        db.query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM mem_triage_decisions WHERE project = 'test-project'",
        ).get()?.count,
      ).toBe(2);
    } finally {
      db.close();
    }
  });

  test("foreign keys are on and deleting an observation cascades to its triage decisions", () => {
    const db = createTestDb();
    try {
      expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);

      const observationId = insertTestObservation(db, { id: "obs-cascade" });
      insertDecision(db, { observation_id: observationId });

      db.query("DELETE FROM mem_observations WHERE id = ?").run(observationId);

      expect(
        db.query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM mem_triage_decisions WHERE observation_id = ?",
        ).get(observationId)?.count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});
