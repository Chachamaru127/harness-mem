import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { verifyObservation } from "../../src/core/verify";
import { configureDatabase, initSchema } from "../../src/db/schema";
import { createSignalStore } from "../../src/lease/signal-store";
import { handoffWork } from "../../src/workgraph/lifecycle";
import { createWorkStore, type WorkStore } from "../../src/workgraph/work-store";

function makeDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  return db;
}

describe("WorkGraph provenance links", () => {
  let db: Database;
  let store: WorkStore;

  beforeEach(() => {
    db = makeDb();
    store = createWorkStore(db, { now: () => "2026-05-17T10:00:00.000Z" });
  });

  afterEach(() => {
    db.close();
  });

  test("resolves work -> observation evidence path for verify-style provenance", () => {
    db.query(
      `INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "sess-workgraph",
      "codex",
      "proj",
      "2026-05-17T09:00:00.000Z",
      "2026-05-17T09:00:00.000Z",
      "2026-05-17T09:00:00.000Z"
    );
    db.query(
      `INSERT INTO mem_events(
        event_id, platform, project, session_id, event_type, ts, payload_json,
        tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "event-workgraph",
      "codex",
      "proj",
      "sess-workgraph",
      "checkpoint",
      "2026-05-17T09:10:00.000Z",
      "{}",
      "[]",
      "[]",
      "dedupe-workgraph",
      "obs-workgraph",
      "2026-05-17T09:10:00.000Z"
    );
    db.query(
      `INSERT INTO mem_observations(
        id, event_id, platform, project, session_id, title, content, content_redacted,
        tags_json, privacy_tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "obs-workgraph",
      "event-workgraph",
      "codex",
      "proj",
      "sess-workgraph",
      "WorkGraph evidence",
      "S125-007 linked evidence",
      "S125-007 linked evidence",
      "[]",
      "[]",
      "2026-05-17T09:10:00.000Z",
      "2026-05-17T09:10:00.000Z"
    );

    store.createWorkItem({
      workId: "S125-007",
      title: "Work events / evidence links",
      project: "proj",
      sourceType: "plans",
      sourceRef: "plans:S125-007",
    });
    store.addLink({
      workId: "S125-007",
      targetType: "observation",
      targetId: "obs-workgraph",
      relation: "evidence",
    });

    const path = db
      .query(
        `SELECT w.work_id, l.target_type, l.relation, o.id AS observation_id, o.title, e.event_id
          FROM mem_work_items w
          JOIN mem_work_links l ON l.work_id = w.work_id
          JOIN mem_observations o ON o.id = l.target_id
          LEFT JOIN mem_events e ON e.event_id = o.event_id
          WHERE w.work_id = ? AND l.target_type = 'observation'`
      )
      .get("S125-007") as Record<string, unknown> | null;

    expect(path).toMatchObject({
      work_id: "S125-007",
      target_type: "observation",
      relation: "evidence",
      observation_id: "obs-workgraph",
      title: "WorkGraph evidence",
      event_id: "event-workgraph",
    });
  });

  test("handoff links signal thread to session and verify-able observation provenance", () => {
    db.query(
      `INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "sess-handoff",
      "codex",
      "proj",
      "2026-05-17T09:00:00.000Z",
      "2026-05-17T09:00:00.000Z",
      "2026-05-17T09:00:00.000Z"
    );
    db.query(
      `INSERT INTO mem_events(
        event_id, platform, project, session_id, event_type, ts, payload_json,
        tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "event-handoff",
      "codex",
      "proj",
      "sess-handoff",
      "tool_use",
      "2026-05-17T09:10:00.000Z",
      JSON.stringify({ tool_name: "Write", file_path: "memory-server/src/workgraph/lifecycle.ts" }),
      "[]",
      "[]",
      "dedupe-handoff",
      "obs-handoff",
      "2026-05-17T09:10:00.000Z"
    );
    db.query(
      `INSERT INTO mem_observations(
        id, event_id, platform, project, session_id, title, content, content_redacted,
        tags_json, privacy_tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "obs-handoff",
      "event-handoff",
      "codex",
      "proj",
      "sess-handoff",
      "Handoff evidence",
      "S125-011 handoff evidence",
      "S125-011 handoff evidence",
      "[]",
      "[]",
      "2026-05-17T09:10:00.000Z",
      "2026-05-17T09:10:00.000Z"
    );

    store.createWorkItem({
      workId: "S125-011",
      title: "Handoff / verify integration",
      project: "proj",
      sourceType: "plans",
      sourceRef: "plans:S125-011",
    });

    const signalStore = createSignalStore(db, {
      now: () => Date.parse("2026-05-17T10:00:00.000Z"),
      idGenerator: () => "signal-handoff",
    });
    const handoff = handoffWork(db, signalStore, {
      workId: "S125-011",
      project: "proj",
      fromAgent: "codex",
      toAgent: "claude",
      content: "Please verify lifecycle provenance.",
      sessionId: "sess-handoff",
      observationId: "obs-handoff",
      now: "2026-05-17T10:00:00.000Z",
    });
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) throw new Error("handoff failed");

    const path = db
      .query(
        `SELECT s.thread_id, session_link.target_id AS session_id, obs_link.target_id AS observation_id
          FROM mem_work_links signal_link
          JOIN mem_signals s ON s.signal_id = signal_link.target_id
          JOIN mem_work_links session_link
            ON session_link.work_id = signal_link.work_id
           AND session_link.target_type = 'session'
          JOIN mem_work_links obs_link
            ON obs_link.work_id = signal_link.work_id
           AND obs_link.target_type = 'observation'
          WHERE signal_link.work_id = ?
            AND signal_link.target_type = 'signal'`
      )
      .get("S125-011") as Record<string, unknown> | null;
    const verified = verifyObservation(db, { observation_id: "obs-handoff" });

    expect(path).toMatchObject({
      thread_id: handoff.signal.threadId,
      session_id: "sess-handoff",
      observation_id: "obs-handoff",
    });
    expect(verified.ok).toBe(true);
    expect(verified.provenance?.file_path).toBe("memory-server/src/workgraph/lifecycle.ts");
    expect(verified.provenance?.action).toBe("create");
  });
});
