/**
 * §S109-002 (a) — InjectTraceStore unit tests (TDD)
 *
 * In-memory bun:sqlite. Verifies the additive `inject_traces` table and the
 * minimal repository surface used by sub-cycle (b)/(c)/(d) to persist
 * envelope firings.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  InjectTraceStore,
  ensureInjectTracesSchema,
} from "../../src/inject/trace-store";
import { createInjectEnvelope } from "../../src/inject/envelope";

const openDbs: Database[] = [];

function createDb(): Database {
  const db = new Database(":memory:");
  openDbs.push(db);
  return db;
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
});

describe("InjectTraceStore (§S109-002 a)", () => {
  test("ensureInjectTracesSchema is idempotent (CREATE TABLE IF NOT EXISTS)", () => {
    const db = createDb();
    ensureInjectTracesSchema(db);
    // second call must not throw
    expect(() => ensureInjectTracesSchema(db)).not.toThrow();
  });

  test("recordTrace then getTraceById round-trips all envelope fields", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const env = createInjectEnvelope({
      kind: "contradiction",
      signals: ["MySQL", "PostgreSQL", "§D-2"],
      action_hint: "warn_user_before_act",
      confidence: 0.84,
      prose:
        "前は MySQL と決めましたが、§D-2 で PostgreSQL に変更した経緯があります。",
    });

    store.recordTrace(env, "sess_a", 1_700_000_000_000);

    const got = store.getTraceById(env.structured.trace_id);
    expect(got).not.toBeNull();
    expect(got!.trace_id).toBe(env.structured.trace_id);
    expect(got!.kind).toBe("contradiction");
    expect(got!.session_id).toBe("sess_a");
    expect(got!.fired_at).toBe(1_700_000_000_000);
    expect(got!.signals).toEqual(["MySQL", "PostgreSQL", "§D-2"]);
    expect(got!.action_hint).toBe("warn_user_before_act");
    expect(got!.confidence).toBeCloseTo(0.84, 6);
    expect(got!.prose).toContain("§D-2");
    expect(got!.consumed).toBe(0);
    expect(got!.consumed_at).toBeNull();
    expect(got!.consumed_evidence).toBeNull();
    expect(got!.effective).toBeNull();
  });

  test("recordTrace rejects duplicate trace_id (PRIMARY KEY constraint)", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const env = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["foo.ts"],
      action_hint: "read_before_edit",
      confidence: 0.7,
      prose: "foo.ts は §54 で rollback された経緯があります。",
    });
    store.recordTrace(env, "sess_dup", 1);
    expect(() => store.recordTrace(env, "sess_dup", 2)).toThrow();
  });

  test("getTracesBySession returns only traces for the given session, ordered by fired_at", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);

    const e1 = createInjectEnvelope({
      kind: "suggest",
      signals: ["one"],
      action_hint: "consider_before_decide",
      confidence: 0.5,
      prose: "one を検討してください。",
    });
    const e2 = createInjectEnvelope({
      kind: "suggest",
      signals: ["two"],
      action_hint: "consider_before_decide",
      confidence: 0.5,
      prose: "two を検討してください。",
    });
    const eOther = createInjectEnvelope({
      kind: "risk_warn",
      signals: ["danger"],
      action_hint: "warn_user_before_act",
      confidence: 0.9,
      prose: "danger があります。",
    });

    store.recordTrace(e1, "sess_x", 200);
    store.recordTrace(e2, "sess_x", 100);
    store.recordTrace(eOther, "sess_y", 150);

    const xs = store.getTracesBySession("sess_x");
    expect(xs).toHaveLength(2);
    expect(xs[0]!.fired_at).toBe(100);
    expect(xs[1]!.fired_at).toBe(200);
    expect(xs.every((r) => r.session_id === "sess_x")).toBe(true);

    const ys = store.getTracesBySession("sess_y");
    expect(ys).toHaveLength(1);
    expect(ys[0]!.kind).toBe("risk_warn");
  });

  test("markConsumed sets consumed=1, consumed_at and consumed_evidence", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    const env = createInjectEnvelope({
      kind: "contradiction",
      signals: ["alpha"],
      action_hint: "warn_user_before_act",
      confidence: 0.6,
      prose: "alpha を確認してください。",
    });
    store.recordTrace(env, "sess_c", 10);
    store.markConsumed(
      env.structured.trace_id,
      "user said: 'I will check alpha'",
      42,
    );

    const got = store.getTraceById(env.structured.trace_id);
    expect(got).not.toBeNull();
    expect(got!.consumed).toBe(1);
    expect(got!.consumed_at).toBe(42);
    expect(got!.consumed_evidence).toBe("user said: 'I will check alpha'");
  });

  test("getTraceById returns null for unknown trace_id", () => {
    const db = createDb();
    const store = new InjectTraceStore(db);
    expect(store.getTraceById("inj_2099-01-01_zzzzzzzz")).toBeNull();
  });
});
