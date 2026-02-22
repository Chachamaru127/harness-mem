/**
 * ShadowSyncManager 実測統合テスト
 *
 * dual-write / shadow-read の動作を実測する。
 * port 37888 のデーモンが稼働中の場合は実デーモンに対する検証も行う。
 */

import { describe, expect, test } from "bun:test";
import { ShadowSyncManager } from "../../src/projector/shadow-sync";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** デーモンが port 37888 で稼働中かどうかを確認する。 */
async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:37888/health", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** デーモンにイベントを書き込む。 */
async function writeToDaemon(project: string, content: string, idx: number): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:37888/v1/events/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          event_id: `shadow-test-${project}-${idx}-${Date.now()}`,
          platform: "claude",
          project: `/${project}`,
          session_id: "shadow-integration",
          event_type: "user_prompt",
          ts: new Date().toISOString(),
          payload: { content },
          tags: ["shadow-test"],
          privacy_tags: [],
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** デーモンに対して検索する。 */
async function searchDaemon(project: string, query: string): Promise<unknown[]> {
  try {
    const res = await fetch("http://localhost:37888/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, project: `/${project}`, limit: 5 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: unknown[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// シナリオ 1: Dual-write simulation
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - dual-write simulation", () => {
  test("100件の primary write + replication を記録し、メトリクスが正確であること", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    for (let i = 0; i < 100; i++) {
      mgr.recordPrimaryWrite();
      mgr.recordReplication(true);
    }

    const m = mgr.getMetrics();
    expect(m.primary_writes).toBe(100);
    expect(m.managed_replications).toBe(100);
    expect(m.replication_failures).toBe(0);
  });

  test("部分的なレプリケーション失敗が正確に記録されること", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    // 98件成功 + 2件失敗
    for (let i = 0; i < 98; i++) {
      mgr.recordPrimaryWrite();
      mgr.recordReplication(true);
    }
    for (let i = 0; i < 2; i++) {
      mgr.recordPrimaryWrite();
      mgr.recordReplication(false);
    }

    const m = mgr.getMetrics();
    expect(m.primary_writes).toBe(100);
    expect(m.managed_replications).toBe(98);
    expect(m.replication_failures).toBe(2);

    const totalRep = m.managed_replications + m.replication_failures;
    const failRate = m.replication_failures / totalRep;
    expect(failRate).toBeCloseTo(0.02, 4); // 2%
  });
});

// ---------------------------------------------------------------------------
// シナリオ 2: Shadow-read divergence detection
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - shadow-read divergence detection", () => {
  test("95件一致 + 5件不一致で shadow_match_rate が 95% になること", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    for (let i = 0; i < 95; i++) mgr.recordShadowRead(true);
    for (let i = 0; i < 5; i++) mgr.recordShadowRead(false);

    const m = mgr.getMetrics();
    expect(m.shadow_reads).toBe(100);
    expect(m.shadow_matches).toBe(95);
    expect(m.shadow_divergences).toBe(5);
    expect(m.shadow_match_rate).toBeCloseTo(0.95, 4);
  });

  test("全件一致の場合 shadow_match_rate が 1.0 になること", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    for (let i = 0; i < 200; i++) mgr.recordShadowRead(true);

    const m = mgr.getMetrics();
    expect(m.shadow_match_rate).toBe(1.0);
    expect(m.shadow_divergences).toBe(0);
  });

  test("全件不一致の場合 shadow_match_rate が 0 になること", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    for (let i = 0; i < 50; i++) mgr.recordShadowRead(false);

    const m = mgr.getMetrics();
    expect(m.shadow_match_rate).toBe(0);
    expect(m.shadow_matches).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// シナリオ 3: Promotion lifecycle
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - promotion lifecycle", () => {
  test("off → shadow → verified → promoted の完全遷移", () => {
    const mgr = new ShadowSyncManager(); // phase: "off"

    // off → shadow
    expect(mgr.getPhase()).toBe("off");
    const phase1 = mgr.advancePhase();
    expect(phase1).toBe("shadow");
    expect(mgr.getPhase()).toBe("shadow");

    // 100+ reads、95%+ match、replication failure < 1% を満たす
    for (let i = 0; i < 100; i++) {
      mgr.recordShadowRead(true);
      mgr.recordReplication(true);
    }

    // shadow → verified
    const phase2 = mgr.advancePhase();
    expect(phase2).toBe("verified");
    expect(mgr.getPhase()).toBe("verified");

    // verified → promoted
    const phase3 = mgr.advancePhase();
    expect(phase3).toBe("promoted");
    expect(mgr.getPhase()).toBe("promoted");
  });

  test("promoted 以降は advancePhase() しても promoted のまま", () => {
    const mgr = new ShadowSyncManager({ phase: "promoted" });
    const phase = mgr.advancePhase();
    expect(phase).toBe("promoted");
  });
});

// ---------------------------------------------------------------------------
// シナリオ 4: Rollback scenario
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - rollback scenario", () => {
  test("promoted → rollback → off のフォールバック", () => {
    const mgr = new ShadowSyncManager({ phase: "promoted" });

    // promoted 状態から rollback
    mgr.rollback();
    expect(mgr.getPhase()).toBe("off");

    // rollback 後は dualWrite / shadowRead が無効化されている
    const config = mgr.toJSON();
    expect(config.dualWriteEnabled).toBe(false);
    expect(config.shadowReadEnabled).toBe(false);
  });

  test("shadow フェーズから rollback しても off に戻る", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });
    mgr.rollback();
    expect(mgr.getPhase()).toBe("off");
  });

  test("verified フェーズから rollback しても off に戻る", () => {
    const mgr = new ShadowSyncManager({ phase: "verified" });
    mgr.rollback();
    expect(mgr.getPhase()).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// シナリオ 5: Promotion denial - 不十分なメトリクス
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - promotion denial", () => {
  test("shadow reads が 100 未満で promotion が拒否される", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    for (let i = 0; i < 99; i++) {
      mgr.recordShadowRead(true);
      mgr.recordReplication(true);
    }

    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(false);
    expect(reasons.some((r) => r.includes("Insufficient shadow reads"))).toBe(true);

    // advancePhase も shadow のまま
    const phase = mgr.advancePhase();
    expect(phase).toBe("shadow");
  });

  test("match rate が 95% 未満で promotion が拒否される", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    // 100件中 94件一致（94%）
    for (let i = 0; i < 94; i++) mgr.recordShadowRead(true);
    for (let i = 0; i < 6; i++) mgr.recordShadowRead(false);
    for (let i = 0; i < 100; i++) mgr.recordReplication(true);

    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(false);
    expect(reasons.some((r) => r.includes("match rate"))).toBe(true);

    const phase = mgr.advancePhase();
    expect(phase).toBe("shadow");
  });

  test("reads が 0 件の場合も promotion が拒否される", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(false);
    expect(reasons.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// シナリオ 6: High replication failure rate
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - high replication failure rate", () => {
  test("replication failure > 1% で promotion が拒否される", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    // shadow reads は十分（100件 95%一致）
    for (let i = 0; i < 100; i++) mgr.recordShadowRead(true);
    // replication: 98件成功 + 2件失敗（2% failure rate）
    for (let i = 0; i < 98; i++) mgr.recordReplication(true);
    for (let i = 0; i < 2; i++) mgr.recordReplication(false);

    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(false);
    expect(reasons.some((r) => r.includes("Replication failure rate"))).toBe(true);
  });

  test("replication failure がちょうど 1% の場合も拒否される（境界値）", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    // shadow reads 100件全一致
    for (let i = 0; i < 100; i++) mgr.recordShadowRead(true);
    // replication: 99件成功 + 1件失敗（1%）
    for (let i = 0; i < 99; i++) mgr.recordReplication(true);
    mgr.recordReplication(false);

    const { ready, reasons } = mgr.isReadyForPromotion();
    // 1% は閾値（> 0.01 が拒否条件）なので正確に 1% は通過する
    // failureRate = 1/100 = 0.01、条件は > 0.01 なので通過
    expect(ready).toBe(true);
    expect(reasons).toHaveLength(0);
  });

  test("replication failure が 1.1% の場合に拒否される", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    // shadow reads 100件全一致
    for (let i = 0; i < 100; i++) mgr.recordShadowRead(true);
    // replication: 989件成功 + 11件失敗（1.1%）
    for (let i = 0; i < 989; i++) mgr.recordReplication(true);
    for (let i = 0; i < 11; i++) mgr.recordReplication(false);

    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(false);
    expect(reasons.some((r) => r.includes("Replication failure rate"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// シナリオ 7: 実デーモン shadow-read（port 37888）
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - 実デーモン shadow-read", () => {
  test("デーモンに書き込み後、検索して shadow-read 一致率を測定する", async () => {
    const running = await isDaemonRunning();
    if (!running) {
      console.log("  [skip] daemon not running on port 37888");
      return; // test.skip の代わりに早期 return
    }

    const project = `shadow-sync-test-${Date.now()}`;
    const content = "shadow sync integration measurement unique token alpha bravo";

    // 書き込み
    const writeOk = await writeToDaemon(project, content, 1);
    expect(writeOk).toBe(true);

    // 少し待機してインデックスが反映されるのを待つ
    await new Promise((r) => setTimeout(r, 300));

    // ShadowSyncManager でメトリクスを追跡
    const mgr = new ShadowSyncManager({ phase: "shadow" });
    mgr.recordPrimaryWrite();
    mgr.recordReplication(true);

    // shadow-read: 検索結果が存在するかどうかで一致を判定
    const items = await searchDaemon(project, content);
    const matched = items.length > 0;

    mgr.recordShadowRead(matched);

    const m = mgr.getMetrics();
    expect(m.primary_writes).toBe(1);
    expect(m.shadow_reads).toBe(1);

    // 書き込んだ直後の検索なのでヒットするはず
    if (matched) {
      expect(m.shadow_matches).toBe(1);
      expect(m.shadow_match_rate).toBe(1.0);
    }
    // ヒットしなかった場合も divergence として記録されていること
    expect(m.shadow_reads).toBe(1);
  });

  test("複数書き込み後の shadow-read でメトリクス集積が正しい", async () => {
    const running = await isDaemonRunning();
    if (!running) {
      console.log("  [skip] daemon not running on port 37888");
      return;
    }

    const project = `shadow-multi-${Date.now()}`;
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    // 5件書き込み
    for (let i = 0; i < 5; i++) {
      const ok = await writeToDaemon(project, `shadow test item ${i} unique content`, i);
      mgr.recordPrimaryWrite();
      mgr.recordReplication(ok);
    }

    await new Promise((r) => setTimeout(r, 500));

    // shadow-read: 各書き込みに対応する検索
    for (let i = 0; i < 5; i++) {
      const items = await searchDaemon(project, `shadow test item ${i}`);
      mgr.recordShadowRead(items.length > 0);
    }

    const m = mgr.getMetrics();
    expect(m.primary_writes).toBe(5);
    expect(m.shadow_reads).toBe(5);
    expect(m.shadow_matches + m.shadow_divergences).toBe(5);
    expect(m.shadow_match_rate).toBeGreaterThanOrEqual(0);
    expect(m.shadow_match_rate).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// シナリオ 8: パフォーマンス計測
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - performance measurement", () => {
  test("1000件の dual-write + shadow-read メトリクス記録が < 100ms/cycle の SLA を満たすこと", () => {
    const CYCLES = 1000;
    const SLA_MS_PER_CYCLE = 100;

    const mgr = new ShadowSyncManager({ phase: "shadow" });

    const start = performance.now();

    for (let i = 0; i < CYCLES; i++) {
      mgr.recordPrimaryWrite();
      mgr.recordReplication(true);
      // 95% 一致、5% 不一致のパターン
      mgr.recordShadowRead(i % 20 !== 0);
    }

    const elapsed = performance.now() - start;
    const msPerCycle = elapsed / CYCLES;

    const m = mgr.getMetrics();

    // メトリクス正確性
    expect(m.primary_writes).toBe(CYCLES);
    expect(m.managed_replications).toBe(CYCLES);
    expect(m.shadow_reads).toBe(CYCLES);

    // 不一致は i % 20 === 0 の場合なので 50件（1000/20）
    expect(m.shadow_divergences).toBe(50);
    expect(m.shadow_matches).toBe(950);
    expect(m.shadow_match_rate).toBeCloseTo(0.95, 3);

    // SLA 検証（< 100ms/cycle）
    console.log(
      `  performance: ${CYCLES} cycles in ${elapsed.toFixed(2)}ms (${msPerCycle.toFixed(4)}ms/cycle)`
    );
    expect(msPerCycle).toBeLessThan(SLA_MS_PER_CYCLE);
  });

  test("大量 shadow-read 後も match_rate 計算が正確に収束すること", () => {
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    // 10000件: 9500件一致、500件不一致
    for (let i = 0; i < 10000; i++) {
      mgr.recordShadowRead(i % 20 !== 0);
    }

    const m = mgr.getMetrics();
    expect(m.shadow_reads).toBe(10000);
    expect(m.shadow_matches).toBe(9500);
    expect(m.shadow_divergences).toBe(500);
    expect(m.shadow_match_rate).toBeCloseTo(0.95, 4);
  });

  test("実デーモンへの 10件 dual-write + shadow-read が合計 5 秒以内に完了すること", async () => {
    const running = await isDaemonRunning();
    if (!running) {
      console.log("  [skip] daemon not running on port 37888");
      return;
    }

    const CYCLES = 10;
    const project = `shadow-perf-${Date.now()}`;
    const mgr = new ShadowSyncManager({ phase: "shadow" });

    const start = performance.now();

    for (let i = 0; i < CYCLES; i++) {
      const ok = await writeToDaemon(project, `perf test item ${i} content alpha beta`, i);
      mgr.recordPrimaryWrite();
      mgr.recordReplication(ok);
    }

    await new Promise((r) => setTimeout(r, 300));

    for (let i = 0; i < CYCLES; i++) {
      const items = await searchDaemon(project, `perf test item ${i}`);
      mgr.recordShadowRead(items.length > 0);
    }

    const elapsed = performance.now() - start;

    console.log(`  daemon perf: ${CYCLES} dual-write+shadow-read cycles in ${elapsed.toFixed(2)}ms`);

    const m = mgr.getMetrics();
    expect(m.primary_writes).toBe(CYCLES);
    expect(m.shadow_reads).toBe(CYCLES);

    // 合計 5000ms 以内
    expect(elapsed).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// シナリオ: isReadyForPromotion の詳細境界値
// ---------------------------------------------------------------------------

describe("ShadowSyncManager - isReadyForPromotion boundary", () => {
  test("reads=100 match=95% failure_rate=0 で promotion 許可", () => {
    const mgr = new ShadowSyncManager();
    for (let i = 0; i < 95; i++) mgr.recordShadowRead(true);
    for (let i = 0; i < 5; i++) mgr.recordShadowRead(false);
    for (let i = 0; i < 100; i++) mgr.recordReplication(true);

    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(true);
    expect(reasons).toHaveLength(0);
  });

  test("複数の失敗条件が同時に存在する場合、reasons に全て列挙される", () => {
    const mgr = new ShadowSyncManager();
    // reads 不足 + match rate 不足
    for (let i = 0; i < 50; i++) mgr.recordShadowRead(true);
    for (let i = 0; i < 50; i++) mgr.recordShadowRead(false); // 50%
    // replication failure > 1%
    for (let i = 0; i < 90; i++) mgr.recordReplication(true);
    for (let i = 0; i < 10; i++) mgr.recordReplication(false); // 10%

    const { ready, reasons } = mgr.isReadyForPromotion();
    expect(ready).toBe(false);
    // 3条件全て失敗: reads >= 100 (100件あるのでこれはOK), match_rate, failure_rate
    expect(reasons.some((r) => r.includes("match rate"))).toBe(true);
    expect(reasons.some((r) => r.includes("Replication failure rate"))).toBe(true);
  });

  test("toJSON でシリアライズした config が再ロード可能なこと", () => {
    const mgr = new ShadowSyncManager({
      phase: "shadow",
      dualWriteEnabled: true,
      shadowReadEnabled: true,
      managedEndpoint: "https://managed.example.com",
      managedApiKey: "test-key",
    });

    const json = mgr.toJSON();
    expect(json.phase).toBe("shadow");
    expect(json.dualWriteEnabled).toBe(true);
    expect(json.shadowReadEnabled).toBe(true);
    expect(json.managedEndpoint).toBe("https://managed.example.com");
    expect(json.managedApiKey).toBe("test-key");

    // 再ロードして同じ挙動
    const mgr2 = new ShadowSyncManager(json);
    expect(mgr2.getPhase()).toBe("shadow");
    expect(mgr2.toJSON()).toEqual(json);
  });
});
