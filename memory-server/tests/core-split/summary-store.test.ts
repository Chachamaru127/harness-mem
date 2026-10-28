import { describe, expect, test } from "bun:test";
import { createTestDb, insertTestObservation } from "./test-helpers";
import {
  claimSummaryJob,
  completeSummaryJob,
  failSummaryJob,
  insertSummaryObservation,
  linkSummaryToSources,
  startSummaryJob,
} from "../../src/core/summary-store";

type TestDb = ReturnType<typeof createTestDb>;

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

type JobRow = {
  session_id: string;
  project: string;
  model: string;
  status: string;
  summary_observation_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type SummaryRow = {
  id: string;
  event_id: string | null;
  platform: string;
  project: string;
  session_id: string;
  title: string;
  content: string;
  content_redacted: string;
  tags_json: string;
  privacy_tags_json: string;
  observation_type: string;
  memory_type: string;
  content_dedupe_hash: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type LinkRow = {
  from_observation_id: string;
  to_observation_id: string;
  relation: string;
  created_at: string;
};

function columns(db: TestDb): ColumnInfo[] {
  return db.query<ColumnInfo, []>("PRAGMA table_info(mem_summary_jobs)").all();
}

function job(db: TestDb, sessionId: string, model: string): JobRow | null {
  return db
    .query<JobRow, [string, string]>(
      `SELECT session_id, project, model, status, summary_observation_id, error, created_at, updated_at
       FROM mem_summary_jobs WHERE session_id = ? AND model = ?`,
    )
    .get(sessionId, model);
}

function jobCount(db: TestDb): number {
  return Number(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mem_summary_jobs").get()?.count ?? 0,
  );
}

function insertJob(
  db: TestDb,
  overrides: Partial<{ session_id: string; project: string; model: string; status: string; created_at: string; updated_at: string }> = {},
  mode: "ignore" | "strict" = "ignore",
): void {
  const row = {
    session_id: "sess-raw",
    project: "proj-raw",
    model: "model-raw",
    status: "pending",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
  const verb = mode === "ignore" ? "INSERT OR IGNORE" : "INSERT";
  db.query(
    `${verb} INTO mem_summary_jobs(session_id, project, model, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.session_id, row.project, row.model, row.status, row.created_at, row.updated_at);
}

describe("mem_summary_jobs schema", () => {
  test("table exists with the columns required by the S-row job contract", () => {
    const db = createTestDb();
    try {
      const names = columns(db).map((column) => column.name);
      expect(names).toEqual([
        "id",
        "session_id",
        "project",
        "model",
        "status",
        "summary_observation_id",
        "error",
        "created_at",
        "updated_at",
      ]);

      const byName = new Map(columns(db).map((column) => [column.name, column]));
      expect(byName.get("id")).toMatchObject({ type: "INTEGER", pk: 1 });
      expect(byName.get("session_id")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("project")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("model")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("status")).toMatchObject({ type: "TEXT", notnull: 1 });
      // summary_observation_id and error stay nullable until the job finishes.
      expect(byName.get("summary_observation_id")).toMatchObject({ type: "TEXT", notnull: 0 });
      expect(byName.get("error")).toMatchObject({ type: "TEXT", notnull: 0 });
      expect(byName.get("created_at")).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(byName.get("updated_at")).toMatchObject({ type: "TEXT", notnull: 1 });
    } finally {
      db.close();
    }
  });

  test("status CHECK accepts exactly the five contract states and rejects anything else", () => {
    const db = createTestDb();
    try {
      for (const [index, status] of ["pending", "running", "completed", "failed", "blocked"].entries()) {
        insertJob(db, { session_id: "sess-status", model: `model-${index}`, status });
      }
      expect(jobCount(db)).toBe(5);

      expect(() => insertJob(db, { session_id: "sess-status", model: "model-bad", status: "paused" }, "strict")).toThrow();
      expect(jobCount(db)).toBe(5);
    } finally {
      db.close();
    }
  });

  test("declared indexes exist: status/created_at lookup and UNIQUE(session_id, model)", () => {
    const db = createTestDb();
    try {
      const indexes = new Map(
        db.query<IndexRow, []>("PRAGMA index_list(mem_summary_jobs)").all().map((row) => [row.name, row]),
      );

      expect(indexes.get("idx_mem_summary_jobs_status")?.unique).toBe(0);
      const statusColumns = db
        .query<{ name: string }, []>("PRAGMA index_info(idx_mem_summary_jobs_status)")
        .all().map((row) => row.name);
      expect(statusColumns).toEqual(["status", "created_at"]);

      // UNIQUE(session_id, model) in the table DDL materializes as an
      // auto-index; find it by shape instead of by generated name.
      const uniquePairs = indexes
        .values()
        .filter((row) => row.unique === 1)
        .map((row) =>
          db.query<{ name: string }, []>(`PRAGMA index_info(${row.name})`).all().map((column) => column.name),
        );
      expect(uniquePairs.some((pair) => pair.join(",") === "session_id,model")).toBe(true);

      // The UNIQUE constraint is load-bearing: a strict duplicate (session_id, model) fails.
      insertJob(db, { session_id: "sess-unique", model: "model-unique" });
      expect(() =>
        insertJob(db, { session_id: "sess-unique", model: "model-unique" }, "strict"),
      ).toThrow();
      expect(jobCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("summary job state machine", () => {
  test("claimSummaryJob: first claim inserts pending, repeats never overwrite the row", () => {
    const db = createTestDb();
    try {
      const key = { sessionId: "sess-claim", project: "proj-claim", model: "glm-5.3-flash" };

      expect(claimSummaryJob(db, key)).toBe(true);
      const first = job(db, key.sessionId, key.model);
      expect(first).toMatchObject({
        session_id: "sess-claim",
        project: "proj-claim",
        model: "glm-5.3-flash",
        status: "pending",
        summary_observation_id: null,
        error: null,
      });

      // Second claim is a no-op: the row, its status and timestamps are unchanged.
      expect(claimSummaryJob(db, key)).toBe(false);
      expect(job(db, key.sessionId, key.model)).toEqual(first);

      // A claim after the job moved past pending must not reset it either.
      expect(startSummaryJob(db, key)).toBe(true);
      expect(claimSummaryJob(db, key)).toBe(false);
      expect(job(db, key.sessionId, key.model)?.status).toBe("running");

      // A different model on the same session is a separate job.
      expect(claimSummaryJob(db, { ...key, model: "gemma4" })).toBe(true);
      expect(jobCount(db)).toBe(2);
    } finally {
      db.close();
    }
  });

  test("startSummaryJob: only a pending row moves to running, once", () => {
    const db = createTestDb();
    try {
      const key = { sessionId: "sess-start", project: "proj-start", model: "glm-5.3-flash" };

      // No row: nothing to start, and start never creates a row.
      expect(startSummaryJob(db, key)).toBe(false);
      expect(job(db, key.sessionId, key.model)).toBeNull();

      expect(claimSummaryJob(db, key)).toBe(true);
      expect(startSummaryJob(db, key)).toBe(true);
      expect(job(db, key.sessionId, key.model)?.status).toBe("running");

      // Already running: no second start.
      expect(startSummaryJob(db, key)).toBe(false);
      expect(job(db, key.sessionId, key.model)?.status).toBe("running");

      // A finished job cannot be restarted without an explicit reset.
      completeSummaryJob(db, key, "sum-start-done");
      expect(startSummaryJob(db, key)).toBe(false);
      expect(job(db, key.sessionId, key.model)?.status).toBe("completed");
    } finally {
      db.close();
    }
  });

  test("completeSummaryJob records the S row id and clears a stale error", () => {
    const db = createTestDb();
    try {
      const key = { sessionId: "sess-complete", project: "proj-complete", model: "glm-5.3-flash" };
      claimSummaryJob(db, key);
      failSummaryJob(db, key, "http 429");
      expect(job(db, key.sessionId, key.model)).toMatchObject({ status: "failed", error: "http 429" });

      // Retry path: the worker loop resets failed -> pending (outside this
      // store), then the state machine runs again to completion.
      db.query(
        "UPDATE mem_summary_jobs SET status = 'pending' WHERE session_id = ? AND model = ?",
      ).run(key.sessionId, key.model);
      expect(startSummaryJob(db, key)).toBe(true);
      completeSummaryJob(db, key, "sum-complete-1");

      expect(job(db, key.sessionId, key.model)).toMatchObject({
        status: "completed",
        summary_observation_id: "sum-complete-1",
        error: null,
      });

      // Re-completing with the same id is idempotent.
      completeSummaryJob(db, key, "sum-complete-1");
      expect(job(db, key.sessionId, key.model)).toMatchObject({
        status: "completed",
        summary_observation_id: "sum-complete-1",
        error: null,
      });
    } finally {
      db.close();
    }
  });

  test("failSummaryJob records the error and leaves the S row id empty", () => {
    const db = createTestDb();
    try {
      const key = { sessionId: "sess-fail", project: "proj-fail", model: "glm-5.3-flash" };
      claimSummaryJob(db, key);
      startSummaryJob(db, key);
      failSummaryJob(db, key, "model timeout after 60s");

      expect(job(db, key.sessionId, key.model)).toMatchObject({
        status: "failed",
        error: "model timeout after 60s",
        summary_observation_id: null,
      });
    } finally {
      db.close();
    }
  });
});

describe("summary observation store", () => {
  test("insertSummaryObservation writes an S row with the contract columns and default tag", () => {
    const db = createTestDb();
    try {
      insertTestObservation(db, { id: "src-sum-1", session_id: "sess-summary", project: "proj-summary" });
      insertSummaryObservation(db, {
        id: "sum-obs-1",
        project: "proj-summary",
        sessionId: "sess-summary",
        title: "セッション要約",
        content: "決定: B案を採用。理由: コスト。未解決: 予算枠。",
      });

      const row = db
        .query<SummaryRow, [string]>(
          `SELECT id, event_id, platform, project, session_id, title, content, content_redacted,
                  tags_json, privacy_tags_json, observation_type, memory_type,
                  content_dedupe_hash, archived_at, created_at, updated_at
           FROM mem_observations WHERE id = ?`,
        )
        .get("sum-obs-1");
      expect(row).toEqual({
        id: "sum-obs-1",
        event_id: null,
        platform: "harness",
        project: "proj-summary",
        session_id: "sess-summary",
        title: "セッション要約",
        content: "決定: B案を採用。理由: コスト。未解決: 予算枠。",
        content_redacted: "決定: B案を採用。理由: コスト。未解決: 予算枠。",
        tags_json: '["summary"]',
        privacy_tags_json: "[]",
        observation_type: "summary",
        memory_type: "semantic",
        content_dedupe_hash: null,
        archived_at: null,
        created_at: expect.any(String) as unknown as string,
        updated_at: expect.any(String) as unknown as string,
      });
    } finally {
      db.close();
    }
  });

  test("insertSummaryObservation honors explicit tags", () => {
    const db = createTestDb();
    try {
      insertTestObservation(db, { id: "src-sum-2", session_id: "sess-tags", project: "proj-summary" });
      insertSummaryObservation(db, {
        id: "sum-obs-2",
        project: "proj-summary",
        sessionId: "sess-tags",
        title: "セッション要約",
        content: "内容",
        tags: ["summary", "session-end"],
      });

      const row = db
        .query<{ tags_json: string }, [string]>("SELECT tags_json FROM mem_observations WHERE id = ?")
        .get("sum-obs-2");
      expect(JSON.parse(row?.tags_json ?? "[]")).toEqual(["summary", "session-end"]);
    } finally {
      db.close();
    }
  });

  test("insertSummaryObservation rejects a session that does not exist", () => {
    const db = createTestDb();
    try {
      expect(() =>
        insertSummaryObservation(db, {
          id: "sum-obs-missing-session",
          project: "proj-summary",
          sessionId: "no-such-session",
          title: "t",
          content: "c",
        }),
      ).toThrow();

      expect(
        db
          .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM mem_observations WHERE id = ?")
          .get("sum-obs-missing-session")?.count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("summarizes links", () => {
  test("linkSummaryToSources inserts relation='summarizes' rows and is idempotent per pair", () => {
    const db = createTestDb();
    try {
      const sessionId = "sess-links";
      insertTestObservation(db, { id: "src-a", session_id: sessionId, project: "proj-links" });
      insertTestObservation(db, { id: "src-b", session_id: sessionId, project: "proj-links" });
      insertTestObservation(db, { id: "src-c", session_id: sessionId, project: "proj-links" });
      insertSummaryObservation(db, {
        id: "sum-l",
        project: "proj-links",
        sessionId,
        title: "リンク元の要約",
        content: "内容",
      });

      const t0 = "2026-10-20T00:00:00.000Z";
      expect(linkSummaryToSources(db, "sum-l", ["src-a", "src-b"], t0)).toBe(2);

      const rows = db
        .query<LinkRow, []>(
          `SELECT from_observation_id, to_observation_id, relation, created_at
           FROM mem_links WHERE from_observation_id = 'sum-l' ORDER BY to_observation_id`,
        )
        .all();
      expect(rows).toEqual([
        { from_observation_id: "sum-l", to_observation_id: "src-a", relation: "summarizes", created_at: t0 },
        { from_observation_id: "sum-l", to_observation_id: "src-b", relation: "summarizes", created_at: t0 },
      ]);

      // Re-linking the same pairs adds nothing and reports zero.
      expect(linkSummaryToSources(db, "sum-l", ["src-a", "src-b"], t0)).toBe(0);

      // Mixed input: only the new pair counts.
      expect(linkSummaryToSources(db, "sum-l", ["src-a", "src-c"], t0)).toBe(1);
      expect(
        Number(
          db
            .query<{ count: number }, [string]>(
              "SELECT COUNT(*) AS count FROM mem_links WHERE from_observation_id = ?",
            )
            .get("sum-l")?.count ?? 0,
        ),
      ).toBe(3);

      // A source id that does not exist fails loudly: OR IGNORE does not
      // swallow foreign key violations.
      expect(() => linkSummaryToSources(db, "sum-l", ["ghost"], t0)).toThrow();
      expect(
        Number(
          db
            .query<{ count: number }, [string]>(
              "SELECT COUNT(*) AS count FROM mem_links WHERE from_observation_id = ?",
            )
            .get("sum-l")?.count ?? 0,
        ),
      ).toBe(3);
    } finally {
      db.close();
    }
  });

  test("CASCADE: deleting a source drops its links; deleting the session drops the S row and every remaining link", () => {
    const db = createTestDb();
    try {
      expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);

      const sessionId = "sess-cascade";
      insertTestObservation(db, { id: "src-casc-1", session_id: sessionId, project: "proj-cascade" });
      insertTestObservation(db, { id: "src-casc-2", session_id: sessionId, project: "proj-cascade" });
      insertSummaryObservation(db, {
        id: "sum-casc",
        project: "proj-cascade",
        sessionId,
        title: "要約",
        content: "内容",
      });
      const t0 = "2026-10-20T00:00:00.000Z";
      expect(linkSummaryToSources(db, "sum-casc", ["src-casc-1", "src-casc-2"], t0)).toBe(2);

      // Observation delete cascades on the to-side of mem_links.
      db.query("DELETE FROM mem_observations WHERE id = 'src-casc-1'").run();
      expect(
        Number(
          db
            .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mem_links WHERE to_observation_id = 'src-casc-1'")
            .get()?.count ?? 0,
        ),
      ).toBe(0);
      expect(
        Number(
          db
            .query<{ count: number }, [string]>(
              "SELECT COUNT(*) AS count FROM mem_links WHERE from_observation_id = ?",
            )
            .get("sum-casc")?.count ?? 0,
        ),
      ).toBe(1);

      // Session delete cascades to every observation of the session (source
      // and S row alike), and their links follow.
      db.query("DELETE FROM mem_sessions WHERE session_id = ?").run(sessionId);
      expect(
        Number(
          db
            .query<{ count: number }, [string]>(
              "SELECT COUNT(*) AS count FROM mem_observations WHERE session_id = ?",
            )
            .get(sessionId)?.count ?? 0,
        ),
      ).toBe(0);
      expect(
        Number(
          db
            .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mem_links WHERE from_observation_id = 'sum-casc'")
            .get()?.count ?? 0,
        ),
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});