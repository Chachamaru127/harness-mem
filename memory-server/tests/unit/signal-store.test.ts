/**
 * S81-A03: Signal primitive unit tests.
 *
 * DoD: Claude が送った signal を Codex の _read が取得でき、ack 済みは
 * 再取得されない。reply_to で thread が繋がる。
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/db/schema";
import { createSignalStore, type SignalStore } from "../../src/lease/signal-store";

function makeDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("signal-store S81-A03", () => {
  let db: Database;
  let store: SignalStore;
  let t: number;
  let counter: number;

  beforeEach(() => {
    db = makeDb();
    t = 1_000_000_000_000;
    counter = 0;
    store = createSignalStore(db, {
      now: () => t,
      idGenerator: () => `sig-${(counter += 1).toString().padStart(4, "0")}`,
    });
  });

  test("send → read by recipient, ack hides it on next read", () => {
    const sent = store.send({ from: "claude", to: "codex", content: "please rebase" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const before = store.read({ agentId: "codex" });
    expect(before).toHaveLength(1);
    expect(before[0]?.content).toBe("please rebase");
    expect(before[0]?.from).toBe("claude");

    // Non-recipient does not see it.
    const otherView = store.read({ agentId: "mallory" });
    expect(otherView.filter((s) => s.to === "codex")).toHaveLength(0);

    const acked = store.ack({ signalId: sent.signal.signalId, agentId: "codex" });
    expect(acked.ok).toBe(true);

    const after = store.read({ agentId: "codex" });
    expect(after).toHaveLength(0);
  });

  test("reply_to threads subsequent signals under the same thread_id", () => {
    const a = store.send({ from: "claude", to: "codex", content: "parent" });
    if (!a.ok) throw new Error("send failed");
    const threadId = a.signal.threadId;
    const b = store.send({
      from: "codex",
      to: "claude",
      content: "child reply",
      replyTo: a.signal.signalId,
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.signal.threadId).toBe(threadId);
    expect(b.signal.replyTo).toBe(a.signal.signalId);

    const thread = store.read({ agentId: "claude", threadId });
    expect(thread.some((s) => s.signalId === b.signal.signalId)).toBe(true);
  });

  test("broadcast (to=null) is visible to everyone until acked by one agent", () => {
    const sent = store.send({ from: "system", to: null, content: "maintenance window" });
    if (!sent.ok) throw new Error("broadcast failed");
    expect(store.read({ agentId: "alice" }).some((s) => s.signalId === sent.signal.signalId)).toBe(true);
    expect(store.read({ agentId: "bob" }).some((s) => s.signalId === sent.signal.signalId)).toBe(true);
    // Once acked, broadcast is no longer returned.
    store.ack({ signalId: sent.signal.signalId, agentId: "alice" });
    expect(store.read({ agentId: "bob" }).some((s) => s.signalId === sent.signal.signalId)).toBe(false);
  });

  test("expires_in_ms hides signal after deadline without requiring ack", () => {
    const sent = store.send({
      from: "ci",
      to: "worker",
      content: "transient ping",
      expiresInMs: 1_000,
    });
    if (!sent.ok) throw new Error("send failed");
    expect(store.read({ agentId: "worker" })).toHaveLength(1);
    t += 2_000;
    expect(store.read({ agentId: "worker" })).toHaveLength(0);
  });

  test("reply_to with missing parent is rejected", () => {
    const res = store.send({
      from: "x",
      to: "y",
      content: "orphan",
      replyTo: "does-not-exist",
    });
    expect(res.ok).toBe(false);
  });

  test("double ack returns already_acked", () => {
    const sent = store.send({ from: "a", to: "b", content: "once" });
    if (!sent.ok) throw new Error("send failed");
    expect(store.ack({ signalId: sent.signal.signalId, agentId: "b" }).ok).toBe(true);
    expect(store.ack({ signalId: sent.signal.signalId, agentId: "b" }).ok).toBe(false);
  });

  test("schema parity: mem_signals table exists with expected columns", () => {
    const cols = db
      .query(`PRAGMA table_info(mem_signals)`)
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "acked_at",
        "acked_by",
        "content",
        "expires_at",
        "from_agent",
        "project",
        "reply_to",
        "sent_at",
        "signal_id",
        "thread_id",
        "to_agent",
      ].sort()
    );
  });
});
