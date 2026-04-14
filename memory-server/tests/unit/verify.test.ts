/**
 * S81-C03: harness_mem_verify (citation trace) unit tests.
 *
 * DoD: 1 call で observation → (session_id, event_id, file_path, action)
 * が返り、`harness_mem_graph` の BFS と組合せて 2-hop 遡及が可能な
 * integration test PASS.
 *
 * 2-hop 遡及は Phase 2 (integration) で検証するため、ここでは core の
 * walk が確定的に動くこと、privacy / missing-row / broken-payload の各
 * エッジケースが期待通りの note を返すことを固める。
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/db/schema";
import { verifyObservation } from "../../src/core/verify";

function makeDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSession(db: Database, sessionId: string, project = "proj-a") {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, 'test', ?, ?, ?, ?)`
  ).run(sessionId, project, now, now, now);
}

function insertEvent(
  db: Database,
  eventId: string,
  sessionId: string,
  payload: Record<string, unknown>,
  opts: { eventType?: string; project?: string; payloadJson?: string } = {}
) {
  const now = new Date().toISOString();
  const payloadJson = opts.payloadJson ?? JSON.stringify(payload);
  db.query(
    `INSERT INTO mem_events(event_id, platform, project, session_id, event_type, ts,
       payload_json, tags_json, privacy_tags_json, dedupe_hash, created_at)
     VALUES (?, 'test', ?, ?, ?, ?, ?, '[]', '[]', ?, ?)`
  ).run(
    eventId,
    opts.project ?? "proj-a",
    sessionId,
    opts.eventType ?? "tool_use",
    now,
    payloadJson,
    `hash-${eventId}`,
    now
  );
}

function insertObservation(
  db: Database,
  id: string,
  sessionId: string,
  eventId: string | null,
  opts: { privacyTags?: string[]; project?: string; title?: string | null } = {}
) {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO mem_observations(id, event_id, platform, project, session_id, title, content,
       content_redacted, observation_type, memory_type, tags_json, privacy_tags_json,
       user_id, team_id, created_at, updated_at)
     VALUES (?, ?, 'test', ?, ?, ?, 'body', 'body-redacted', 'context', 'semantic',
       '[]', ?, 'default', NULL, ?, ?)`
  ).run(
    id,
    eventId,
    opts.project ?? "proj-a",
    sessionId,
    opts.title ?? "t",
    JSON.stringify(opts.privacyTags ?? []),
    now,
    now
  );
}

describe("verifyObservation S81-C03", () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  test("returns missing=true when observation_id is empty", () => {
    const r = verifyObservation(db, { observation_id: "" });
    expect(r.ok).toBe(false);
    expect(r.observation.missing).toBe(true);
    expect(r.notes).toContain("observation_id is required");
  });

  test("returns missing=true when observation row does not exist", () => {
    const r = verifyObservation(db, { observation_id: "nope" });
    expect(r.ok).toBe(false);
    expect(r.observation.missing).toBe(true);
    expect(r.notes).toContain("observation not found");
  });

  test("walks observation -> event -> provenance for a Write tool_use", () => {
    insertSession(db, "s-1");
    insertEvent(db, "e-1", "s-1", {
      tool_name: "Write",
      file_path: "src/components/Header.tsx",
    });
    insertObservation(db, "obs-1", "s-1", "e-1");

    const r = verifyObservation(db, { observation_id: "obs-1" });
    expect(r.ok).toBe(true);
    expect(r.observation.observation_id).toBe("obs-1");
    expect(r.observation.session_id).toBe("s-1");
    expect(r.event?.event_id).toBe("e-1");
    expect(r.event?.tool_name).toBe("Write");
    expect(r.provenance?.file_path).toBe("src/components/Header.tsx");
    expect(r.provenance?.action).toBe("create");
    expect(r.provenance?.language).toBe("typescript");
    expect(r.notes).toHaveLength(0);
  });

  test("walks Edit tool_use to an edit provenance", () => {
    insertSession(db, "s-2");
    insertEvent(db, "e-2", "s-2", {
      tool_name: "Edit",
      file_path: "scripts/deploy.sh",
      old_string: "echo a",
      new_string: "echo b",
    });
    insertObservation(db, "obs-2", "s-2", "e-2");

    const r = verifyObservation(db, { observation_id: "obs-2" });
    expect(r.ok).toBe(true);
    expect(r.provenance?.action).toBe("edit");
    expect(r.provenance?.language).toBe("shell");
  });

  test("returns ok=true but event=null when observation has no linked event_id", () => {
    insertSession(db, "s-3");
    insertObservation(db, "obs-3", "s-3", null);
    const r = verifyObservation(db, { observation_id: "obs-3" });
    expect(r.ok).toBe(true);
    expect(r.event).toBeNull();
    expect(r.provenance).toBeNull();
    expect(r.notes.some((n) => n.includes("no linked event_id"))).toBe(true);
  });

  test("marks event.missing=true when event row was trimmed", () => {
    insertSession(db, "s-4");
    // No event row inserted.
    insertObservation(db, "obs-4", "s-4", "e-4-missing");
    const r = verifyObservation(db, { observation_id: "obs-4" });
    expect(r.ok).toBe(true);
    expect(r.event?.missing).toBe(true);
    expect(r.provenance).toBeNull();
    expect(r.notes.some((n) => n.includes("event row missing"))).toBe(true);
  });

  test("flags payload_unparseable when event payload is not JSON", () => {
    insertSession(db, "s-5");
    // Insert with invalid payload JSON via the override.
    insertEvent(db, "e-5", "s-5", {}, { payloadJson: "not json" });
    insertObservation(db, "obs-5", "s-5", "e-5");
    const r = verifyObservation(db, { observation_id: "obs-5" });
    expect(r.ok).toBe(true);
    expect(r.event?.payload_unparseable).toBe(true);
    expect(r.provenance).toBeNull();
  });

  test("notes an unrecognised tool when extractor returns null", () => {
    insertSession(db, "s-6");
    insertEvent(db, "e-6", "s-6", { tool_name: "WeirdTool", foo: "bar" });
    insertObservation(db, "obs-6", "s-6", "e-6");
    const r = verifyObservation(db, { observation_id: "obs-6" });
    expect(r.ok).toBe(true);
    expect(r.event?.tool_name).toBe("WeirdTool");
    expect(r.provenance).toBeNull();
    expect(r.notes.some((n) => n.includes("WeirdTool"))).toBe(true);
  });

  test("hides provenance for private observations unless include_private=true", () => {
    insertSession(db, "s-7");
    insertEvent(db, "e-7", "s-7", { tool_name: "Write", file_path: "a.ts" });
    insertObservation(db, "obs-7", "s-7", "e-7", { privacyTags: ["private"] });

    // S81-C03 round 15 P2: private rows now surface the same shape as
    // a genuinely missing observation — no session_id / project /
    // platform / created_at leak — to prevent verify from being used
    // as a metadata oracle.
    const hidden = verifyObservation(db, { observation_id: "obs-7" });
    expect(hidden.ok).toBe(false);
    expect(hidden.observation.missing).toBe(true);
    expect(hidden.observation.event_id).toBeNull();
    expect(hidden.observation.session_id).toBeNull();
    expect(hidden.observation.project).toBeNull();
    expect(hidden.observation.platform).toBeNull();
    expect(hidden.observation.created_at).toBeNull();
    expect(hidden.event).toBeNull();
    expect(hidden.provenance).toBeNull();
    expect(hidden.notes).toEqual(["observation not found"]);

    const visible = verifyObservation(db, {
      observation_id: "obs-7",
      include_private: true,
    });
    expect(visible.ok).toBe(true);
    expect(visible.event?.event_id).toBe("e-7");
    expect(visible.provenance?.file_path).toBe("a.ts");
  });

  test("accepts an injected extractor for dependency-free testing", () => {
    insertSession(db, "s-8");
    insertEvent(db, "e-8", "s-8", { tool_name: "Anything" });
    insertObservation(db, "obs-8", "s-8", "e-8");

    const r = verifyObservation(
      db,
      { observation_id: "obs-8" },
      { extractor: () => ({ file_path: "stub.md", action: "read" }) }
    );
    expect(r.provenance?.file_path).toBe("stub.md");
    expect(r.provenance?.action).toBe("read");
  });
});
