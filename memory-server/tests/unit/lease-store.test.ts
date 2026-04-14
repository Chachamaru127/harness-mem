/**
 * S81-A02: Lease primitive unit tests.
 *
 * DoD: 2 つの agent が同一 target を lease すると後発は
 * `{error:"already_leased", heldBy, expiresAt}` を返す。TTL 超過で以降の
 * acquire が成功する。schema parity (mem_leases table) が存在する。
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/db/schema";
import {
  createLeaseStore,
  DEFAULT_LEASE_TTL_MS,
  MAX_LEASE_TTL_MS,
  type LeaseStore,
} from "../../src/lease/lease-store";

function makeDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("lease-store S81-A02", () => {
  let db: Database;
  let t: number;
  let store: LeaseStore;

  beforeEach(() => {
    db = makeDb();
    t = 1_000_000_000_000; // fixed start
    store = createLeaseStore(db, { now: () => t });
  });

  test("first acquire succeeds and returns lease payload", () => {
    const res = store.acquire({ target: "file:/foo.ts", agentId: "claude-1", ttlMs: 5_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lease.target).toBe("file:/foo.ts");
    expect(res.lease.agentId).toBe("claude-1");
    expect(res.lease.ttlMs).toBe(5_000);
    expect(res.lease.status).toBe("active");
    expect(new Date(res.lease.expiresAt).getTime()).toBe(t + 5_000);
  });

  test("concurrent acquire by second agent returns already_leased", () => {
    const a = store.acquire({ target: "action:deploy", agentId: "claude-1" });
    expect(a.ok).toBe(true);
    const b = store.acquire({ target: "action:deploy", agentId: "codex-1" });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.error).toBe("already_leased");
    if (b.error !== "already_leased") return;
    expect(b.heldBy).toBe("claude-1");
    expect(b.expiresAt).toBe((a as { ok: true; lease: { expiresAt: string } }).lease.expiresAt);
  });

  test("TTL expiry unblocks subsequent acquires", () => {
    const first = store.acquire({ target: "shared-resource", agentId: "a", ttlMs: 1_000 });
    expect(first.ok).toBe(true);
    // Contention during TTL window.
    const blocked = store.acquire({ target: "shared-resource", agentId: "b" });
    expect(blocked.ok).toBe(false);
    // Advance past expiration.
    t += 1_500;
    const success = store.acquire({ target: "shared-resource", agentId: "b" });
    expect(success.ok).toBe(true);
    if (!success.ok) return;
    expect(success.lease.agentId).toBe("b");
  });

  test("release is idempotent and scoped to the owner", () => {
    const a = store.acquire({ target: "x", agentId: "owner" });
    if (!a.ok) throw new Error("acquire failed");
    const wrong = store.release(a.lease.leaseId, "not-owner");
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toBe("not_owner");

    const ok = store.release(a.lease.leaseId, "owner");
    expect(ok.ok).toBe(true);
    expect(ok.lease?.status).toBe("released");

    // After release, other agents can acquire.
    const reacquire = store.acquire({ target: "x", agentId: "another" });
    expect(reacquire.ok).toBe(true);
  });

  test("renew extends expires_at while preserving lease_id", () => {
    const a = store.acquire({ target: "y", agentId: "owner", ttlMs: 10_000 });
    if (!a.ok) throw new Error("acquire failed");
    const originalId = a.lease.leaseId;
    t += 5_000;
    const r = store.renew(originalId, "owner", 20_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lease?.leaseId).toBe(originalId);
    expect(r.lease?.ttlMs).toBe(20_000);
    expect(new Date(r.lease!.expiresAt).getTime()).toBe(t + 20_000);
  });

  test("renew rejects non-owner and expired leases", () => {
    const a = store.acquire({ target: "z", agentId: "owner", ttlMs: 1_000 });
    if (!a.ok) throw new Error("acquire failed");
    expect(store.renew(a.lease.leaseId, "intruder").ok).toBe(false);
    t += 2_000;
    const r = store.renew(a.lease.leaseId, "owner");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("expired");
  });

  test("invalid inputs are rejected with typed error codes", () => {
    expect(store.acquire({ target: "", agentId: "x" }).ok).toBe(false);
    expect(store.acquire({ target: "t", agentId: "" }).ok).toBe(false);
    const tooLong = store.acquire({ target: "t", agentId: "x", ttlMs: MAX_LEASE_TTL_MS + 1 });
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.error).toBe("invalid_ttl");
  });

  test("default TTL applies when not specified", () => {
    const a = store.acquire({ target: "default-ttl", agentId: "x" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.lease.ttlMs).toBe(DEFAULT_LEASE_TTL_MS);
    expect(new Date(a.lease.expiresAt).getTime()).toBe(t + DEFAULT_LEASE_TTL_MS);
  });

  test("listActive reflects current lease state", () => {
    store.acquire({ target: "t1", agentId: "a" });
    store.acquire({ target: "t2", agentId: "b" });
    expect(store.listActive()).toHaveLength(2);
    expect(store.listActive("t1")).toHaveLength(1);
    expect(store.listActive("t1")[0]?.agentId).toBe("a");
  });

  test("schema parity: mem_leases table exists with expected columns", () => {
    const cols = db
      .query(`PRAGMA table_info(mem_leases)`)
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "acquired_at",
        "agent_id",
        "expires_at",
        "lease_id",
        "metadata_json",
        "project",
        "released_at",
        "renewed_at",
        "status",
        "target",
        "ttl_ms",
      ].sort()
    );
  });
});
