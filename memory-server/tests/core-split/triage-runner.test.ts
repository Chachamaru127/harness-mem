import { describe, expect, test } from "bun:test";
import { createTestConfig, createTestDb, insertTestObservation } from "./test-helpers";
import { runTriageBatch, type TriageClientLike } from "../../src/core/triage-runner";
import type { TriageDecision, TriageItem } from "../../src/core/jev-client";

function fakeClient(
  decide: (items: TriageItem[]) => TriageDecision[] = (items) =>
    items.map((item, index) => ({
      observationId: item.observationId,
      score: index === 0 ? 0.9 : 0.1,
      durable: null,
      decision: index === 0 ? "keep" : "compact",
      fallback: false,
    })),
): TriageClientLike & { calls: TriageItem[][] } {
  const calls: TriageItem[][] = [];
  return {
    calls,
    async triage(items) {
      calls.push(items);
      return decide(items);
    },
  };
}

function baseConfig(overrides: Parameters<typeof createTestConfig>[0] = {}) {
  return createTestConfig({
    triageEnabled: true,
    cloudLlmEnabled: true,
    cloudflareAccountId: "acc",
    cloudflareApiToken: "token",
    triageModel: "typesafe/jev-1.14.0",
    triageThreshold: 0.3,
    triageMaxPerTick: 100,
    ...overrides,
  });
}

function rows(db: ReturnType<typeof createTestDb>) {
  return db
    .query<{ observation_id: string; decision: string; fallback: number; score: number | null }, []>(
      "SELECT observation_id, decision, fallback, score FROM mem_triage_decisions ORDER BY observation_id",
    )
    .all();
}

describe("runTriageBatch", () => {
  test("disabled makes no calls and records nothing", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-disabled" });
    const client = fakeClient();
    const result = await runTriageBatch(db, baseConfig({ triageEnabled: false }), client);
    expect(result.skipped).toBe("disabled");
    expect(client.calls).toHaveLength(0);
    expect(rows(db)).toHaveLength(0);
  });

  test("missing cloud credentials skips before scanning", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-nocreds" });
    const client = fakeClient();
    const result = await runTriageBatch(
      db,
      baseConfig({ cloudflareAccountId: undefined, cloudflareApiToken: undefined }),
      client,
    );
    expect(result.skipped).toBe("missing_credentials");
    expect(client.calls).toHaveLength(0);
  });

  test("scanner-blocked rows stay in P and never reach the client", async () => {
    const db = createTestDb();
    insertTestObservation(db, {
      id: "obs-secret",
      content: "api_key = abcdef1234567890 secret value",
      privacy_tags: [],
    });
    const client = fakeClient();
    const result = await runTriageBatch(db, baseConfig(), client);
    expect(client.calls).toHaveLength(0);
    expect(result.kept).toBe(1);
    expect(result.fallback).toBe(1);
    expect(result.retryableFailures ?? 0).toBe(0);
    const stored = rows(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ observation_id: "obs-secret", decision: "keep", fallback: 1, score: null });
  });

  test("allowed rows are decided and recorded in the input order", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-keep", content: "方針として、次回からこの手順を使う。理由は再現性のため。", created_at: "2026-10-02T00:00:00.000Z" });
    insertTestObservation(db, { id: "obs-compact", content: "テストを実行しています。3件中1件が完了しました。", created_at: "2026-10-01T00:00:00.000Z" });
    const client = fakeClient();
    const result = await runTriageBatch(db, baseConfig(), client);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].map((item) => item.observationId)).toEqual(["obs-keep", "obs-compact"]);
    expect(result).toMatchObject({ scanned: 2, decided: 2, kept: 1, compacted: 1, fallback: 0 });
    expect(rows(db)).toEqual([
      { observation_id: "obs-compact", decision: "compact", fallback: 0, score: 0.1 },
      { observation_id: "obs-keep", decision: "keep", fallback: 0, score: 0.9 },
    ]);
  });

  test("a second run is idempotent and selects no rows", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-once", content: "再利用する手順をここに決めた。" });
    const first = await runTriageBatch(db, baseConfig(), fakeClient());
    expect(first.decided).toBe(1);
    const second = await runTriageBatch(db, baseConfig(), fakeClient());
    expect(second.skipped).toBe("no_rows");
    expect(rows(db)).toHaveLength(1);
  });

  test("a model change stops the worker", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-model" });
    await runTriageBatch(db, baseConfig(), fakeClient());
    const client = fakeClient();
    const changed = await runTriageBatch(db, baseConfig({ triageModel: "typesafe/jev-9.9.9" }), client);
    expect(changed.skipped).toBe("model_changed");
    expect(client.calls).toHaveLength(0);
  });

  test("prefilter keeps durable types without calling the client", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-dec", session_id: "s1", observation_type: "decision" });
    insertTestObservation(db, { id: "obs-sum", session_id: "s1", observation_type: "summary" });
    insertTestObservation(db, { id: "obs-ctx-a", session_id: "s1", observation_type: "context" });
    insertTestObservation(db, { id: "obs-ctx-b", session_id: "s1", observation_type: "context" });
    const client = fakeClient();
    const result = await runTriageBatch(db, baseConfig({ triagePrefilterEnabled: true }), client);
    expect(client.calls).toHaveLength(1);
    expect(new Set(client.calls[0]!.map((item) => item.observationId))).toEqual(
      new Set(["obs-ctx-a", "obs-ctx-b"]),
    );
    expect(result).toMatchObject({ scanned: 4, decided: 4, kept: 3, compacted: 1, fallback: 0 });
    const decisions = db
      .query<{ observation_id: string; decision: string; fallback: number; score: number | null; batch_id: string }, []>(
        "SELECT observation_id, decision, fallback, score, batch_id FROM mem_triage_decisions ORDER BY observation_id",
      )
      .all();
    expect(decisions.map((row) => row.observation_id)).toEqual(["obs-ctx-a", "obs-ctx-b", "obs-dec", "obs-sum"]);
    for (const id of ["obs-dec", "obs-sum"]) {
      expect(decisions.find((row) => row.observation_id === id)).toMatchObject({
        decision: "keep",
        fallback: 0,
        score: 1,
        batch_id: expect.stringMatching(/^heuristic-/),
      });
    }
    for (const id of ["obs-ctx-a", "obs-ctx-b"]) {
      expect(decisions.find((row) => row.observation_id === id)).toMatchObject({
        fallback: 0,
        batch_id: expect.stringMatching(/^triage-/),
      });
    }
  });

  test("a thrown client error keeps every row and marks fallback", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-throw-1" });
    insertTestObservation(db, { id: "obs-throw-2" });
    const client: TriageClientLike = {
      async triage() {
        throw new Error("network down");
      },
    };
    const result = await runTriageBatch(db, baseConfig(), client);
    expect(result).toMatchObject({ decided: 2, kept: 2, compacted: 0, fallback: 2, retryableFailures: 2 });
    expect(rows(db).every((row) => row.decision === "keep" && row.fallback === 1 && row.score === null)).toBe(true);
  });

  test("a transient fallback is retried and updated", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-retry", content: "再利用する手順をここに決めた。" });
    const failing: TriageClientLike = {
      async triage() {
        throw new Error("429");
      },
    };
    await runTriageBatch(db, baseConfig(), failing);
    expect(rows(db)[0]).toMatchObject({ decision: "keep", fallback: 1, score: null });

    const result = await runTriageBatch(db, baseConfig(), fakeClient());
    expect(result.skipped).toBeUndefined();
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ decision: "keep", fallback: 0, score: 0.9 });
  });

  test("a scanner-blocked row is not retried", async () => {
    const db = createTestDb();
    insertTestObservation(db, {
      id: "obs-blocked-once",
      content: "password = supersecret123",
    });
    await runTriageBatch(db, baseConfig(), fakeClient());
    expect(rows(db)).toHaveLength(1);
    const second = await runTriageBatch(db, baseConfig(), fakeClient());
    expect(second.skipped).toBe("no_rows");
  });

  test("persists the durable probability", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-durable", content: "決定: BLOB で持つ。理由は容量。" });
    const client = fakeClient((items) =>
      items.map((item) => ({
        observationId: item.observationId,
        score: 0.9,
        durable: 0.85,
        decision: "keep" as const,
        fallback: false,
      })),
    );
    await runTriageBatch(db, baseConfig(), client);
    const row = db
      .query<{ durable: number | null }, []>(
        "SELECT durable FROM mem_triage_decisions WHERE observation_id = 'obs-durable'",
      )
      .get();
    expect(row?.durable).toBeCloseTo(0.85, 5);
  });

  test("respects triageMaxPerTick", async () => {
    const db = createTestDb();
    for (let i = 0; i < 5; i += 1) {
      insertTestObservation(db, { id: `obs-limit-${i}`, content: `再利用する手順 ${i}`, created_at: `2026-10-0${i + 1}T00:00:00.000Z` });
    }
    const client = fakeClient();
    const result = await runTriageBatch(db, baseConfig({ triageMaxPerTick: 2 }), client);
    expect(result.scanned).toBe(2);
    expect(client.calls[0]).toHaveLength(2);
  });

  test("reports model failure reasons without including source content", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "failed-item", content: "本文は診断ログへ含めない" });
    const client = fakeClient((items) => items.map((item) => ({
      observationId: item.observationId, score: null, durable: null,
      decision: "keep" as const, fallback: true, failureReason: "http_429" as const,
    })));
    const result = await runTriageBatch(db, baseConfig(), client);
    expect(result.failureReasons).toEqual({ http_429: 1 });
    expect(result.retryableFailures).toBe(1);
    expect(JSON.stringify(result)).not.toContain("本文は診断ログへ含めない");
    db.close();
  });

  test("retains request-rejected input and does not send it again", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "rejected-item", content: "大きな入力は原文を残して保留する" });
    const client = fakeClient((items) => items.map((item) => ({
      observationId: item.observationId, score: null, durable: null,
      decision: "keep" as const, fallback: true, failureReason: "http_400" as const,
    })));
    expect((await runTriageBatch(db, baseConfig(), client)).failureReasons).toEqual({ http_400: 1 });
    expect((await runTriageBatch(db, baseConfig(), client)).skipped).toBe("no_rows");
    expect(client.calls).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ decision: "keep", fallback: 1 });
    expect(db.query("SELECT content FROM mem_observations WHERE id = 'rejected-item'").get()).toEqual({ content: "大きな入力は原文を残して保留する" });
    db.close();
  });
});
