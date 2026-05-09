/**
 * §S109-002 (c) — skill_suggestion → InjectEnvelope bridge tests.
 *
 * Pure helper tests, mirroring tests/unit/contradiction-scan-envelope.test.ts.
 * We don't drive finalize_session end-to-end here (existing finalize tests
 * cover that path); instead we feed synthesised SkillSuggestion objects
 * into the bridge and assert:
 *
 *   1. envelope.kind === "suggest" / action_hint === "consider_before_decide"
 *   2. signals[] non-empty and contains title + source_session_id
 *   3. prose contains every signal verbatim (validateProseContainsSignals)
 *   4. inject_traces persists exactly one row keyed by trace_id
 *   5. null suggestion → no envelope, no row written
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildSkillSuggestionEnvelope,
  recordSkillSuggestionEnvelope,
} from "../../src/inject/skill-suggestion-envelope";
import { validateProseContainsSignals } from "../../src/inject/envelope";
import {
  InjectTraceStore,
  ensureInjectTracesSchema,
} from "../../src/inject/trace-store";
import type { SkillSuggestion } from "../../src/core/types";

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

function suggestion(over: Partial<SkillSuggestion> = {}): SkillSuggestion {
  return {
    title: "kickoff → shipped feature",
    steps: [
      { order: 1, summary: "open issue", obs_id: "obs_step_1" },
      { order: 2, summary: "draft plan", obs_id: "obs_step_2" },
      { order: 3, summary: "implement core", obs_id: "obs_step_3" },
      { order: 4, summary: "review", obs_id: "obs_step_4" },
      { order: 5, summary: "merge & ship", obs_id: "obs_step_5" },
    ],
    tools_used: [],
    estimated_duration_min: 42,
    source_session_id: "sess_abc_123",
    created_at: "2026-05-09T00:00:00.000Z",
    ...over,
  };
}

describe("skill_suggestion envelope bridge (§S109-002 c)", () => {
  test("buildSkillSuggestionEnvelope: kind, signals, prose grounding", () => {
    const env = buildSkillSuggestionEnvelope(suggestion());
    expect(env.structured.kind).toBe("suggest");
    expect(env.structured.action_hint).toBe("consider_before_decide");
    // signals[] must contain title + source_session_id
    expect(env.structured.signals).toContain("kickoff → shipped feature");
    expect(env.structured.signals).toContain("sess_abc_123");
    // signals[] must include at least the first and last step obs_id
    expect(env.structured.signals).toContain("obs_step_1");
    expect(env.structured.signals).toContain("obs_step_5");
    // prose grounding contract: all signals verbatim in prose
    const v = validateProseContainsSignals(env);
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
    // confidence: heuristic default
    expect(env.structured.confidence).toBeGreaterThan(0);
    expect(env.structured.confidence).toBeLessThanOrEqual(1);
  });

  test("recordSkillSuggestionEnvelope: persists one row, retrievable by session", () => {
    const db = createDb();
    const sessionId = "sess_test_skill_1";
    const env = recordSkillSuggestionEnvelope(db, suggestion(), sessionId);
    expect(env).not.toBeNull();

    const store = new InjectTraceStore(db);
    const rows = store.getTracesBySession(sessionId);
    expect(rows.length).toBe(1);
    const row = store.getTraceById(env!.structured.trace_id);
    expect(row).not.toBeNull();
    expect(row?.kind).toBe("suggest");
    expect(row?.action_hint).toBe("consider_before_decide");
    expect(row?.session_id).toBe(sessionId);
    expect(row?.signals).toEqual(env!.structured.signals);
    expect(row?.prose).toBe(env!.prose);
    expect(row?.consumed).toBe(0);
  });

  test("recordSkillSuggestionEnvelope: null suggestion → no envelope, no row written", () => {
    const db = createDb();
    const env = recordSkillSuggestionEnvelope(db, null, "sess_test_skill_2");
    expect(env).toBeNull();
    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM inject_traces`)
      .get();
    expect(count?.n).toBe(0);
  });

  test("recordSkillSuggestionEnvelope: undefined suggestion → no envelope, no row written", () => {
    const db = createDb();
    const env = recordSkillSuggestionEnvelope(
      db,
      undefined,
      "sess_test_skill_3",
    );
    expect(env).toBeNull();
    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM inject_traces`)
      .get();
    expect(count?.n).toBe(0);
  });

  test("buildSkillSuggestionEnvelope: minimal steps still produces valid prose grounding", () => {
    // Edge case: steps array has only 1 item (in practice detector requires
    // 5+, but the builder should not crash on degenerate input).
    const env = buildSkillSuggestionEnvelope(
      suggestion({
        steps: [{ order: 1, summary: "lone step", obs_id: "obs_only" }],
      }),
    );
    expect(env.structured.signals).toContain("obs_only");
    const v = validateProseContainsSignals(env);
    expect(v.ok).toBe(true);
  });
});
