/**
 * §S109-002 (b) — contradiction_scan → InjectEnvelope bridge tests.
 *
 * Scope: pure helper tests. We don't drive consolidation_run end-to-end
 * here (that path is exercised by existing contradiction-detector and
 * contradiction-resolution tests); instead we feed synthesised
 * `ContradictionDetectorResult` objects into the bridge and assert:
 *
 *   1. envelope.kind === "contradiction"
 *   2. signals[] non-empty and contains both observation_ids
 *   3. prose contains every signal verbatim (via validateProseContainsSignals)
 *   4. inject_traces has the row keyed by trace_id and queryable by session_id
 *   5. zero contradictions → no envelope, no row written
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildContradictionEnvelope,
  recordContradictionEnvelopes,
  SYSTEM_CONSOLIDATION_SESSION_ID,
} from "../../src/inject/contradiction-envelope";
import {
  validateProseContainsSignals,
} from "../../src/inject/envelope";
import {
  InjectTraceStore,
  ensureInjectTracesSchema,
} from "../../src/inject/trace-store";
import type {
  ContradictionDetectorResult,
  ContradictionPair,
} from "../../src/consolidation/contradiction-detector";

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

function pair(over: Partial<ContradictionPair> = {}): ContradictionPair {
  return {
    older_id: "obs_old_1",
    newer_id: "obs_new_2",
    project: "p",
    concept: "deploy",
    jaccard: 0.82,
    verdict: { contradiction: true, confidence: 0.91, reason: "target changed from aws to gcp" },
    ...over,
  };
}

function result(
  contradictions: ContradictionPair[],
): ContradictionDetectorResult {
  return {
    scanned_groups: 1,
    candidate_pairs: contradictions.length,
    contradictions,
    links_created: contradictions.length,
    jaccard_threshold: 0.3,
    min_confidence: 0.7,
  };
}

describe("contradiction_scan envelope bridge (§S109-002 b)", () => {
  test("buildContradictionEnvelope: kind, signals, prose grounding", () => {
    const env = buildContradictionEnvelope(pair());
    expect(env.structured.kind).toBe("contradiction");
    expect(env.structured.action_hint).toBe("warn_user_before_act");
    // signals must include both observation ids and at least one extra token
    expect(env.structured.signals).toContain("obs_old_1");
    expect(env.structured.signals).toContain("obs_new_2");
    expect(env.structured.signals.length).toBeGreaterThanOrEqual(3);
    // prose grounding contract
    const v = validateProseContainsSignals(env);
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
    // confidence: prefer adjudicator verdict
    expect(env.structured.confidence).toBeCloseTo(0.91, 5);
  });

  test("buildContradictionEnvelope: falls back to jaccard when verdict has no confidence", () => {
    const env = buildContradictionEnvelope(
      pair({ verdict: undefined, jaccard: 0.55 }),
    );
    expect(env.structured.confidence).toBeCloseTo(0.55, 5);
    // signals[] still contains the observation ids
    expect(env.structured.signals.slice(0, 2)).toEqual([
      "obs_old_1",
      "obs_new_2",
    ]);
    expect(validateProseContainsSignals(env).ok).toBe(true);
  });

  test("recordContradictionEnvelopes: persists one row per pair, retrievable by session", () => {
    const db = createDb();
    const sessionId = "sess_test_1";
    const r = result([
      pair({ older_id: "A1", newer_id: "B1", concept: "deploy" }),
      pair({
        older_id: "A2",
        newer_id: "B2",
        concept: "database",
        verdict: {
          contradiction: true,
          confidence: 0.88,
          reason: "engine swapped postgres for mysql",
        },
      }),
    ]);
    const envs = recordContradictionEnvelopes(db, r, sessionId);
    expect(envs.length).toBe(2);

    const store = new InjectTraceStore(db);
    const rows = store.getTracesBySession(sessionId);
    expect(rows.length).toBe(2);
    for (const env of envs) {
      const row = store.getTraceById(env.structured.trace_id);
      expect(row).not.toBeNull();
      expect(row?.kind).toBe("contradiction");
      expect(row?.session_id).toBe(sessionId);
      expect(row?.action_hint).toBe("warn_user_before_act");
      expect(row?.signals).toEqual(env.structured.signals);
      expect(row?.prose).toBe(env.prose);
      expect(row?.consumed).toBe(0);
    }
  });

  test("recordContradictionEnvelopes: empty contradictions writes nothing and returns []", () => {
    const db = createDb();
    const envs = recordContradictionEnvelopes(db, result([]));
    expect(envs).toEqual([]);
    // table is empty
    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM inject_traces`)
      .get();
    expect(count?.n).toBe(0);
  });

  test("recordContradictionEnvelopes: defaults to system_consolidation session id", () => {
    const db = createDb();
    const envs = recordContradictionEnvelopes(db, result([pair()]));
    expect(envs.length).toBe(1);
    const store = new InjectTraceStore(db);
    const rows = store.getTracesBySession(SYSTEM_CONSOLIDATION_SESSION_ID);
    expect(rows.length).toBe(1);
    expect(rows[0]?.session_id).toBe("system_consolidation");
  });
});
