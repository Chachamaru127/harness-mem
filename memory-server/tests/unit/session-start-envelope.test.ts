/**
 * §S109-002 (d) — SessionStart artifact → InjectEnvelope bridge tests.
 *
 * Pure helper tests, mirroring tests/unit/skill-suggestion-envelope.test.ts.
 * We don't drive resume_pack end-to-end here (existing resume_pack tests
 * cover that path); instead we feed synthesised continuity_briefing
 * artifacts into the bridge and assert:
 *
 *   1. envelope.kind === "recall_chain" / action_hint === "read_before_edit"
 *   2. signals[] non-empty and contains chain_top + source_session_id
 *   3. prose contains every signal verbatim (validateProseContainsSignals)
 *   4. inject_traces persists exactly one row keyed by trace_id
 *   5. null / empty artifact → no envelope, no row written
 *   6. idempotency: a recent matching trace blocks re-persist
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildSessionStartEnvelope,
  recordSessionStartEnvelope,
  type SessionStartArtifact,
} from "../../src/inject/session-start-envelope";
import { validateProseContainsSignals } from "../../src/inject/envelope";
import {
  InjectTraceStore,
  ensureInjectTracesSchema,
} from "../../src/inject/trace-store";

const openDbs: Database[] = [];
function createDb(): Database {
  const db = new Database(":memory:");
  ensureInjectTracesSchema(db);
  openDbs.push(db);
  return db;
}
afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close();
});

function artifact(over: Partial<SessionStartArtifact> = {}): SessionStartArtifact {
  return {
    source_session_id: "sess_continuity_42",
    cited_item_ids: ["obs_top_1", "obs_anchor_2", "obs_anchor_3"],
    includes_summary: true,
    includes_latest_interaction: true,
    source_scope: "chain",
    content: "# Continuity Briefing\n## Current Focus\n- chain top",
    ...over,
  };
}

describe("session_start envelope bridge (§S109-002 d)", () => {
  test("buildSessionStartEnvelope: kind, signals, prose grounding", () => {
    const env = buildSessionStartEnvelope(artifact());
    expect(env).not.toBeNull();
    expect(env!.structured.kind).toBe("recall_chain");
    expect(env!.structured.action_hint).toBe("read_before_edit");
    // chain_top must be the first signal — load-bearing for idempotency.
    expect(env!.structured.signals[0]).toBe("obs_top_1");
    expect(env!.structured.signals).toContain("sess_continuity_42");
    expect(env!.structured.signals).toContain("obs_anchor_2");
    // prose grounding contract: all signals verbatim in prose
    const v = validateProseContainsSignals(env!);
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
    // confidence: heuristic default within (0,1]
    expect(env!.structured.confidence).toBeGreaterThan(0);
    expect(env!.structured.confidence).toBeLessThanOrEqual(1);
  });

  test("recordSessionStartEnvelope: persists one row, retrievable by session", () => {
    const db = createDb();
    const sessionId = "sess_test_start_1";
    const env = recordSessionStartEnvelope(db, artifact(), sessionId);
    expect(env).not.toBeNull();

    const store = new InjectTraceStore(db);
    const rows = store.getTracesBySession(sessionId);
    expect(rows.length).toBe(1);
    const row = store.getTraceById(env!.structured.trace_id);
    expect(row).not.toBeNull();
    expect(row?.kind).toBe("recall_chain");
    expect(row?.action_hint).toBe("read_before_edit");
    expect(row?.session_id).toBe(sessionId);
    expect(row?.signals).toEqual(env!.structured.signals);
    expect(row?.prose).toBe(env!.prose);
    expect(row?.consumed).toBe(0);
  });

  test("recordSessionStartEnvelope: null artifact → no envelope, no row", () => {
    const db = createDb();
    const env = recordSessionStartEnvelope(db, null, "sess_test_start_2");
    expect(env).toBeNull();
    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM inject_traces`)
      .get();
    expect(count?.n).toBe(0);
  });

  test("recordSessionStartEnvelope: empty artifact (no anchors, no session) → no row", () => {
    const db = createDb();
    const env = recordSessionStartEnvelope(
      db,
      { cited_item_ids: [], source_session_id: null },
      "sess_test_start_3",
    );
    expect(env).toBeNull();
    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM inject_traces`)
      .get();
    expect(count?.n).toBe(0);
  });

  test("recordSessionStartEnvelope: idempotency window blocks re-persist for same chain_top", () => {
    const db = createDb();
    const sessionId = "sess_test_start_idem";
    const t0 = 1_700_000_000_000;
    const first = recordSessionStartEnvelope(db, artifact(), sessionId, t0);
    expect(first).not.toBeNull();

    // Same artifact, 1 minute later → should be skipped (within 5m window).
    const second = recordSessionStartEnvelope(
      db,
      artifact(),
      sessionId,
      t0 + 60_000,
    );
    expect(second).toBeNull();

    const store = new InjectTraceStore(db);
    expect(store.getTracesBySession(sessionId).length).toBe(1);

    // Same artifact, 6 minutes later → window expired, should persist again.
    const third = recordSessionStartEnvelope(
      db,
      artifact(),
      sessionId,
      t0 + 6 * 60_000,
    );
    expect(third).not.toBeNull();
    expect(store.getTracesBySession(sessionId).length).toBe(2);

    // A different chain_top within the window should NOT be skipped.
    const fourth = recordSessionStartEnvelope(
      db,
      artifact({
        cited_item_ids: ["obs_top_DIFFERENT", "obs_anchor_2", "obs_anchor_3"],
      }),
      sessionId,
      t0 + 60_000, // still within original window
    );
    expect(fourth).not.toBeNull();
  });
});
