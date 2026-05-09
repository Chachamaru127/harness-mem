/**
 * §S109-003 — UX Acceptance + unit tests for inject observability.
 *
 * Covers:
 *   (a) signals echoed in next-turn → consumed=true, summary.consumed_rate=1
 *   (b) counterfactual: same artifact + no inject → lower consumed_rate
 *   (c) hooks_health stale → suggested_action="harness-mem doctor --fix"
 *
 * Plus 5 unit tests on aggregator / detector edge cases.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  InjectTraceStore,
  ensureInjectTracesSchema,
} from "../../src/inject/trace-store";
import { createInjectEnvelope } from "../../src/inject/envelope";
import { detectConsumed } from "../../src/inject/consume-detector";
import {
  aggregateInjectObservability,
  DEFAULT_HOOKS_STALE_CUTOFF_MS,
} from "../../src/inject/observability";

const openDbs: Database[] = [];

function createDb(): Database {
  const db = new Database(":memory:");
  openDbs.push(db);
  ensureInjectTracesSchema(db);
  return db;
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
});

// ──────────────────────────────────────────────────────────────────────
// UX Acceptance (D8): the three load-bearing behaviours.
// ──────────────────────────────────────────────────────────────────────
describe("UX Acceptance — §S109-003", () => {
  test("(a) signal echoed in next-turn tool_call ⇒ consumed=true and consumed_rate=1", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const env = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["foo.ts"],
      action_hint: "read_before_edit",
      confidence: 0.7,
      prose: "foo.ts is referenced here.",
    });
    const now = 1_700_000_000_000;
    store.recordTrace(env, "sess_a", now);

    // Simulate next turn: the agent edits foo.ts.
    const detection = detectConsumed(env, {
      tool_calls: [{ name: "Edit", input: { path: "foo.ts" } }],
    });
    expect(detection.consumed).toBe(true);
    expect(detection.evidence).toContain("foo.ts");
    expect(detection.evidence).toContain("tool_call:Edit");

    // Persist the consume.
    store.markConsumed(env.structured.trace_id, detection.evidence!, now + 1000);

    const obs = aggregateInjectObservability(db, "sess_a", { nowMs: now + 2000 });
    expect(obs.injects_in_session).toHaveLength(1);
    expect(obs.injects_in_session[0]!.consumed).toBe(true);
    expect(obs.injects_in_session[0]!.consumed_evidence).toContain("foo.ts");
    expect(obs.summary.delivered_count).toBe(1);
    expect(obs.summary.consumed_count).toBe(1);
    expect(obs.summary.consumed_rate).toBe(1);
    expect(obs.summary.effective_rate).toBeNull();
  });

  test("(b) counterfactual: same agent action + no inject ⇒ inject-side has higher consumed_rate", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const now = 1_700_000_000_000;

    // Session WITH inject: signals=["bar.ts"], agent edits bar.ts → consumed=true.
    const envWith = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["bar.ts"],
      action_hint: "read_before_edit",
      confidence: 0.7,
      prose: "bar.ts has prior context.",
    });
    store.recordTrace(envWith, "sess_with_inject", now);
    const detWith = detectConsumed(envWith, {
      tool_calls: [{ name: "Edit", input: { path: "bar.ts" } }],
    });
    expect(detWith.consumed).toBe(true);
    if (detWith.consumed) {
      store.markConsumed(envWith.structured.trace_id, detWith.evidence!, now + 1);
    }

    // Session WITHOUT inject: aggregator sees zero traces, consumed_rate=null.
    const obsWith = aggregateInjectObservability(db, "sess_with_inject", { nowMs: now + 5 });
    const obsWithout = aggregateInjectObservability(db, "sess_no_inject", { nowMs: now + 5 });

    expect(obsWith.summary.delivered_count).toBe(1);
    expect(obsWith.summary.consumed_rate).toBe(1);

    expect(obsWithout.summary.delivered_count).toBe(0);
    expect(obsWithout.summary.consumed_rate).toBeNull();

    // Counterfactual contract: inject-side rate must be strictly higher
    // than the no-inject side (treating null as 0 — no inject = no
    // possibility of consume).
    const withRate = obsWith.summary.consumed_rate ?? 0;
    const withoutRate = obsWithout.summary.consumed_rate ?? 0;
    expect(withRate).toBeGreaterThan(withoutRate);
  });

  test("(c) only stale recall_chain present ⇒ hooks_health.user_prompt_submit stale_Xd, suggested_action set", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const now = 1_700_000_000_000;
    const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;

    const env = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["legacy.ts"],
      action_hint: "read_before_edit",
      confidence: 0.6,
      prose: "legacy.ts is old.",
    });
    store.recordTrace(env, "sess_stale", fiveDaysAgo);

    const obs = aggregateInjectObservability(db, "sess_stale", { nowMs: now });

    // recall_chain → user_prompt_submit
    expect(obs.hooks_health.user_prompt_submit).toMatch(/^stale_\d+d$/);
    // session_start is bridged from recall_chain firing — same 5-day-old
    // trace flows into both slots, so session_start is also stale_Nd.
    expect(obs.hooks_health.session_start).toMatch(/^stale_\d+d$/);
    // stop kinds (contradiction/suggest) never fired ⇒ unwired
    expect(obs.hooks_health.stop).toBe("unwired");
    expect(obs.suggested_action).toBe("harness-mem doctor --fix");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Unit tests — aggregator / consume detector edge cases.
// ──────────────────────────────────────────────────────────────────────
describe("aggregateInjectObservability — edge cases", () => {
  test("empty session ⇒ delivered_count=0, consumed_rate=null", () => {
    const db = createDb();
    const obs = aggregateInjectObservability(db, "no_such_session", {
      nowMs: 1_700_000_000_000,
    });
    expect(obs.summary.delivered_count).toBe(0);
    expect(obs.summary.consumed_count).toBe(0);
    expect(obs.summary.consumed_rate).toBeNull();
    expect(obs.injects_in_session).toEqual([]);
  });

  test("hooks_health alive when within cutoff", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const now = 2_000_000_000_000;
    const env = createInjectEnvelope({
      kind: "contradiction",
      signals: ["A", "B"],
      action_hint: "warn_user_before_act",
      confidence: 0.9,
      prose: "A vs B contradiction.",
    });
    store.recordTrace(env, "sess_x", now - 1000);

    const obs = aggregateInjectObservability(db, "sess_x", { nowMs: now });
    expect(obs.hooks_health.stop).toBe("alive");
    // session_start and user_prompt_submit are unwired here, so suggested_action
    // is still set — alive on `stop` doesn't excuse the other two.
    expect(obs.suggested_action).toBe("harness-mem doctor --fix");
  });

  test("pending_contradictions counts unconsumed contradiction kind only", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const now = 1_800_000_000_000;

    const c1 = createInjectEnvelope({
      kind: "contradiction",
      signals: ["X", "Y"],
      action_hint: "warn_user_before_act",
      confidence: 0.95,
      prose: "X vs Y.",
    });
    const c2 = createInjectEnvelope({
      kind: "contradiction",
      signals: ["P", "Q"],
      action_hint: "warn_user_before_act",
      confidence: 0.88,
      prose: "P vs Q.",
    });
    const r1 = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["foo"],
      action_hint: "read_before_edit",
      confidence: 0.7,
      prose: "foo recalled.",
    });
    store.recordTrace(c1, "sess_p", now);
    store.recordTrace(c2, "sess_p", now + 10);
    store.recordTrace(r1, "sess_p", now + 20);
    // Mark c1 as consumed, c2 still pending.
    store.markConsumed(c1.structured.trace_id, "tool_call:Edit:X", now + 30);

    const obs = aggregateInjectObservability(db, "sess_p", { nowMs: now + 100 });
    expect(obs.pending_contradictions.count).toBe(1);
    expect(obs.pending_contradictions.top_pairs).toHaveLength(1);
    expect(obs.pending_contradictions.top_pairs[0]!.a).toBe("P");
    expect(obs.pending_contradictions.top_pairs[0]!.b).toBe("Q");
  });

  test("since/until window filters traces", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const env = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["t1"],
      action_hint: "read_before_edit",
      confidence: 0.6,
      prose: "t1 hit.",
    });
    store.recordTrace(env, "sess_w", 1000);

    const env2 = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["t2"],
      action_hint: "read_before_edit",
      confidence: 0.6,
      prose: "t2 hit.",
    });
    store.recordTrace(env2, "sess_w", 5000);

    const inWindow = aggregateInjectObservability(db, "sess_w", {
      sinceMs: 2000,
      untilMs: 6000,
      nowMs: 6000,
    });
    expect(inWindow.injects_in_session).toHaveLength(1);
    expect(inWindow.injects_in_session[0]!.signals).toEqual(["t2"]);
  });

  test("hooks_health stale cutoff exact boundary is alive", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const now = 3_000_000_000_000;
    const env = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["edge"],
      action_hint: "read_before_edit",
      confidence: 0.6,
      prose: "edge case.",
    });
    // exactly at the cutoff boundary (inclusive)
    store.recordTrace(env, "sess_edge", now - DEFAULT_HOOKS_STALE_CUTOFF_MS);
    const obs = aggregateInjectObservability(db, "sess_edge", { nowMs: now });
    expect(obs.hooks_health.user_prompt_submit).toBe("alive");
  });
});

describe("detectConsumed — edge cases", () => {
  test("empty signals ⇒ consumed=false", () => {
    const env = createInjectEnvelope({
      kind: "recall_chain",
      signals: [],
      action_hint: "no_action",
      confidence: 0.5,
      prose: "no signals here",
    });
    const r = detectConsumed(env, { user_text: "anything goes" });
    expect(r.consumed).toBe(false);
    expect(r.evidence).toBeNull();
  });

  test("user_text hit emits user_text:<signal> evidence", () => {
    const env = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["needle.md"],
      action_hint: "read_before_edit",
      confidence: 0.7,
      prose: "needle.md context.",
    });
    const r = detectConsumed(env, {
      user_text: "I will read needle.md before editing.",
    });
    expect(r.consumed).toBe(true);
    expect(r.evidence).toBe("user_text:needle.md");
  });

  test("only one signal of many needs to hit", () => {
    const env = createInjectEnvelope({
      kind: "contradiction",
      signals: ["alpha.ts", "beta.ts", "§D-3"],
      action_hint: "warn_user_before_act",
      confidence: 0.8,
      prose: "alpha.ts vs beta.ts re §D-3.",
    });
    const r = detectConsumed(env, {
      tool_calls: [{ name: "Read", input: { path: "beta.ts" } }],
    });
    expect(r.consumed).toBe(true);
    expect(r.evidence).toContain("beta.ts");
  });

  test("no haystack ⇒ consumed=false", () => {
    const env = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["x"],
      action_hint: "read_before_edit",
      confidence: 0.5,
      prose: "x stuff.",
    });
    const r = detectConsumed(env, {});
    expect(r.consumed).toBe(false);
    expect(r.evidence).toBeNull();
  });
});
