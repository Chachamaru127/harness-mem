/**
 * §S109-002 (d) — UserPromptSubmit recall → InjectEnvelope bridge tests.
 *
 * Pure helper tests, mirroring tests/unit/skill-suggestion-envelope.test.ts.
 * We don't drive search end-to-end here (existing search/recall tests cover
 * that path); instead we feed synthesised observation lists into the bridge
 * and assert:
 *
 *   1. envelope.kind defaults to "recall_chain", action_hint
 *      "read_before_edit"
 *   2. signals[] non-empty: ids first, then distinguishing tokens
 *   3. prose contains every signal verbatim (validateProseContainsSignals)
 *   4. inject_traces persists exactly one row keyed by trace_id
 *   5. empty / null observations → no envelope, no row written
 *   6. kind="risk_warn" switches action_hint to "warn_user_before_act"
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildUserPromptRecallEnvelope,
  recordUserPromptRecallEnvelope,
  type RecalledObservation,
} from "../../src/inject/user-prompt-recall-envelope";
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

function obs(
  id: string,
  title: string,
  content = "",
): RecalledObservation {
  return { id, title, content };
}

const SAMPLE: RecalledObservation[] = [
  obs("obs_recall_top", "decision gate raised", "release blocker resolved"),
  obs("obs_recall_2", "review feedback on PR", ""),
  obs("obs_recall_3", "deployment notes", ""),
];

describe("user_prompt recall envelope bridge (§S109-002 d)", () => {
  test("buildUserPromptRecallEnvelope: default kind=recall_chain, signals + prose grounding", () => {
    const env = buildUserPromptRecallEnvelope(SAMPLE);
    expect(env).not.toBeNull();
    expect(env!.structured.kind).toBe("recall_chain");
    expect(env!.structured.action_hint).toBe("read_before_edit");
    // First signal must be the top observation id — load-bearing.
    expect(env!.structured.signals[0]).toBe("obs_recall_top");
    expect(env!.structured.signals).toContain("obs_recall_2");
    // distinguishing token from title should appear too
    expect(
      env!.structured.signals.some((s) => /decision|gate|raised/.test(s)),
    ).toBe(true);
    // prose grounding contract: all signals verbatim in prose
    const v = validateProseContainsSignals(env!);
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
    // confidence: heuristic default within (0,1]
    expect(env!.structured.confidence).toBeGreaterThan(0);
    expect(env!.structured.confidence).toBeLessThanOrEqual(1);
  });

  test("recordUserPromptRecallEnvelope: persists one row, retrievable by session", () => {
    const db = createDb();
    const sessionId = "sess_test_userprompt_1";
    const env = recordUserPromptRecallEnvelope(db, SAMPLE, sessionId);
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

  test("recordUserPromptRecallEnvelope: empty list → no envelope, no row", () => {
    const db = createDb();
    const env = recordUserPromptRecallEnvelope(db, [], "sess_test_userprompt_2");
    expect(env).toBeNull();
    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM inject_traces`)
      .get();
    expect(count?.n).toBe(0);
  });

  test("recordUserPromptRecallEnvelope: null/undefined → no envelope, no row", () => {
    const db = createDb();
    expect(
      recordUserPromptRecallEnvelope(db, null, "sess_test_userprompt_3"),
    ).toBeNull();
    expect(
      recordUserPromptRecallEnvelope(db, undefined, "sess_test_userprompt_3"),
    ).toBeNull();
    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM inject_traces`)
      .get();
    expect(count?.n).toBe(0);
  });

  test("buildUserPromptRecallEnvelope: kind=risk_warn switches action_hint", () => {
    const env = buildUserPromptRecallEnvelope(SAMPLE, "risk_warn");
    expect(env).not.toBeNull();
    expect(env!.structured.kind).toBe("risk_warn");
    expect(env!.structured.action_hint).toBe("warn_user_before_act");
    const v = validateProseContainsSignals(env!);
    expect(v.ok).toBe(true);
  });

  test("recordUserPromptRecallEnvelope: kind=risk_warn persists with correct kind", () => {
    const db = createDb();
    const sessionId = "sess_test_userprompt_risk";
    const env = recordUserPromptRecallEnvelope(
      db,
      SAMPLE,
      sessionId,
      "risk_warn",
    );
    expect(env).not.toBeNull();
    const store = new InjectTraceStore(db);
    const rows = store.getTracesBySession(sessionId);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe("risk_warn");
    expect(rows[0].action_hint).toBe("warn_user_before_act");
  });
});
