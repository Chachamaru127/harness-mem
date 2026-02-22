import { describe, expect, test } from "bun:test";
import { ShadowSyncManager } from "../../src/projector/shadow-sync";

describe("ShadowSyncManager", () => {
  test("starts in 'off' phase by default", () => {
    const mgr = new ShadowSyncManager();
    expect(mgr.getPhase()).toBe("off");
  });

  test("tracks primary writes", () => {
    const mgr = new ShadowSyncManager();
    mgr.recordPrimaryWrite();
    mgr.recordPrimaryWrite();
    expect(mgr.getMetrics().primary_writes).toBe(2);
  });

  test("tracks replication success and failure", () => {
    const mgr = new ShadowSyncManager();
    mgr.recordReplication(true);
    mgr.recordReplication(true);
    mgr.recordReplication(false);
    const metrics = mgr.getMetrics();
    expect(metrics.managed_replications).toBe(2);
    expect(metrics.replication_failures).toBe(1);
  });

  test("tracks shadow read matches and divergences", () => {
    const mgr = new ShadowSyncManager();
    mgr.recordShadowRead(true);
    mgr.recordShadowRead(true);
    mgr.recordShadowRead(false);
    const metrics = mgr.getMetrics();
    expect(metrics.shadow_reads).toBe(3);
    expect(metrics.shadow_matches).toBe(2);
    expect(metrics.shadow_divergences).toBe(1);
    expect(metrics.shadow_match_rate).toBeCloseTo(2 / 3, 4);
  });

  test("advancePhase: off → shadow", () => {
    const mgr = new ShadowSyncManager();
    const next = mgr.advancePhase();
    expect(next).toBe("shadow");
    expect(mgr.getPhase()).toBe("shadow");
  });

  test("advancePhase: shadow → verified (when ready)", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });
    // Need 100+ shadow reads with 95%+ match rate
    for (let i = 0; i < 100; i++) {
      mgr.recordShadowRead(true);
      mgr.recordReplication(true);
    }
    const next = mgr.advancePhase();
    expect(next).toBe("verified");
  });

  test("advancePhase: shadow stays shadow (when not ready)", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });
    // Only 10 reads - insufficient
    for (let i = 0; i < 10; i++) {
      mgr.recordShadowRead(true);
    }
    const next = mgr.advancePhase();
    expect(next).toBe("shadow");
  });

  test("advancePhase: verified → promoted", () => {
    const mgr = new ShadowSyncManager({ phase: "verified" });
    const next = mgr.advancePhase();
    expect(next).toBe("promoted");
  });

  test("isReadyForPromotion requires 100+ shadow reads", () => {
    const mgr = new ShadowSyncManager();
    for (let i = 0; i < 50; i++) {
      mgr.recordShadowRead(true);
    }
    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(false);
    expect(reasons.some((r) => r.includes("Insufficient"))).toBe(true);
  });

  test("isReadyForPromotion requires 95%+ match rate", () => {
    const mgr = new ShadowSyncManager();
    for (let i = 0; i < 90; i++) mgr.recordShadowRead(true);
    for (let i = 0; i < 10; i++) mgr.recordShadowRead(false);
    // 100 reads, 90% match rate
    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(false);
    expect(reasons.some((r) => r.includes("match rate"))).toBe(true);
  });

  test("isReadyForPromotion passes with good metrics", () => {
    const mgr = new ShadowSyncManager();
    for (let i = 0; i < 100; i++) {
      mgr.recordShadowRead(true);
      mgr.recordReplication(true);
    }
    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(true);
    expect(reasons).toHaveLength(0);
  });

  test("rollback resets to off", () => {
    const mgr = new ShadowSyncManager({ phase: "verified" });
    mgr.rollback();
    expect(mgr.getPhase()).toBe("off");
  });

  test("toJSON returns serializable config", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow", managedEndpoint: "pg://localhost" });
    const json = mgr.toJSON();
    expect(json.phase).toBe("shadow");
    expect(json.managedEndpoint).toBe("pg://localhost");
  });
});
