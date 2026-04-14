/**
 * S80-D01: circuit breaker unit tests.
 *
 * DoD: provider 故意落としテストで cooldown 時間は他 provider、復帰後に
 * 元が戻る 3-run test PASS。
 */
import { describe, expect, test } from "bun:test";
import { createCircuitBreaker } from "../../src/embedding/circuit-breaker";
import { createFallbackEmbeddingProvider, withCircuitBreaker } from "../../src/embedding/fallback";
import type { EmbeddingProvider } from "../../src/embedding/types";

describe("circuit-breaker S80-D01", () => {
  test("starts closed and allows requests", () => {
    const b = createCircuitBreaker();
    expect(b.status().state).toBe("closed");
    expect(b.shouldSkip()).toBe(false);
  });

  test("opens after N consecutive failures (threshold=3)", () => {
    let t = 1_000;
    const b = createCircuitBreaker({ now: () => t, failureThreshold: 3, cooldownMs: 60_000 });
    b.recordFailure("net");
    expect(b.status().state).toBe("closed");
    b.recordFailure("net");
    expect(b.status().state).toBe("closed");
    b.recordFailure("net");
    const st = b.status();
    expect(st.state).toBe("open");
    expect(st.consecutiveFailures).toBe(3);
    expect(st.openedAt).toBe(1_000);
    expect(st.nextProbeAt).toBe(61_000);
    expect(b.shouldSkip()).toBe(true);
  });

  test("recordSuccess resets the counter mid-sequence", () => {
    const b = createCircuitBreaker({ failureThreshold: 3 });
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    expect(b.status().state).toBe("closed");
    expect(b.status().consecutiveFailures).toBe(1);
  });

  test("cooldown blocks requests, half-open permits one probe after cooldown", () => {
    let t = 0;
    const b = createCircuitBreaker({
      now: () => t,
      failureThreshold: 3,
      cooldownMs: 60_000,
    });
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    expect(b.shouldSkip()).toBe(true);

    // Mid-cooldown: still skipping.
    t = 30_000;
    expect(b.shouldSkip()).toBe(true);

    // Cooldown elapsed: transitions to half-open on inspection.
    t = 60_001;
    expect(b.shouldSkip()).toBe(false); // half-open lets the probe through
    expect(b.allowProbe()).toBe(true);
    // Second concurrent probe is blocked until this one completes.
    expect(b.allowProbe()).toBe(false);
  });

  test("half-open: probe success closes the breaker", () => {
    let t = 0;
    const b = createCircuitBreaker({
      now: () => t,
      failureThreshold: 3,
      cooldownMs: 60_000,
    });
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    t = 60_500;
    expect(b.allowProbe()).toBe(true);
    b.recordSuccess();
    const st = b.status();
    expect(st.state).toBe("closed");
    expect(st.consecutiveFailures).toBe(0);
    expect(st.openedAt).toBeNull();
  });

  test("half-open: probe failure re-opens with fresh cooldown", () => {
    let t = 0;
    const b = createCircuitBreaker({
      now: () => t,
      failureThreshold: 3,
      cooldownMs: 60_000,
    });
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    // Elapsed cooldown.
    t = 60_500;
    expect(b.allowProbe()).toBe(true);
    // Probe fails.
    t = 60_600;
    b.recordFailure("still broken");
    const st = b.status();
    expect(st.state).toBe("open");
    expect(st.openedAt).toBe(60_600);
    expect(st.nextProbeAt).toBe(120_600);
  });

  test("3-run flap recovery: down → cooldown → probe → recovered", () => {
    // Simulates the DoD's 3-run expectation by executing the full breaker
    // lifecycle three times back to back.
    let t = 0;
    const b = createCircuitBreaker({
      now: () => t,
      failureThreshold: 3,
      cooldownMs: 60_000,
    });
    for (let run = 1; run <= 3; run += 1) {
      b.recordFailure();
      b.recordFailure();
      b.recordFailure();
      expect(b.status().state).toBe("open");
      // During cooldown requests skip.
      t += 30_000;
      expect(b.shouldSkip()).toBe(true);
      // After cooldown the probe succeeds → closed.
      t += 31_000;
      expect(b.allowProbe()).toBe(true);
      b.recordSuccess();
      expect(b.status().state).toBe("closed");
      // Move the clock forward a little before the next run so timestamps
      // remain monotonic.
      t += 1_000;
    }
  });

  test("reset() restores closed state", () => {
    const b = createCircuitBreaker({ failureThreshold: 2 });
    b.recordFailure();
    b.recordFailure();
    expect(b.status().state).toBe("open");
    b.reset();
    expect(b.status().state).toBe("closed");
    expect(b.status().consecutiveFailures).toBe(0);
  });

  test("failureThreshold clamps to ≥1", () => {
    const b = createCircuitBreaker({ failureThreshold: 0 });
    b.recordFailure();
    // Threshold clamped to 1 → opens immediately.
    expect(b.status().state).toBe("open");
  });
});

/**
 * S80-D01 DoD integration: breaker-wrapped provider routes to a secondary
 * provider while the primary is in cooldown, then recovers on probe success.
 */
describe("withCircuitBreaker S80-D01 integration", () => {
  function makeFlakyProvider(shouldFail: { v: boolean }): EmbeddingProvider {
    return {
      name: "flaky",
      model: "flaky-model",
      dimension: 16,
      embed(): number[] {
        if (shouldFail.v) {
          throw new Error("simulated network failure");
        }
        return Array(16).fill(0.1);
      },
      health() {
        return { status: shouldFail.v ? "degraded" : "healthy" };
      },
    };
  }

  test("cooldown window routes to fallback provider, probe success restores primary (3 runs)", () => {
    for (let run = 1; run <= 3; run += 1) {
      let t = run * 1_000_000;
      const fail = { v: true };
      const primary = makeFlakyProvider(fail);
      const fallback = createFallbackEmbeddingProvider({ dimension: 16 });
      const wrapped = withCircuitBreaker(primary, {
        now: () => t,
        failureThreshold: 3,
        cooldownMs: 60_000,
        fallbackTo: fallback,
      });

      // 3 failures: wrapper transparently diverts to fallback on each throw
      // while the breaker counter still climbs on the primary.
      for (let i = 0; i < 3; i += 1) {
        const v = wrapped.embed("hello");
        expect(v).toHaveLength(16);
      }
      // Breaker is now open. Primary would continue to throw, but the wrapper
      // diverts to fallback without invoking primary.
      expect(wrapped.breaker.status().state).toBe("open");
      const duringCooldown = wrapped.embed("hello");
      // Fallback is the local hash embedder: non-throwing, length-matching.
      expect(duringCooldown).toHaveLength(16);
      expect(wrapped.health().status).toBe("degraded");

      // Fast-forward past cooldown, primary becomes healthy, probe succeeds.
      t += 61_000;
      fail.v = false;
      const recovered = wrapped.embed("hello");
      expect(recovered).toEqual(Array(16).fill(0.1));
      expect(wrapped.breaker.status().state).toBe("closed");
      expect(wrapped.health().status).toBe("healthy");
    }
  });

  test("primary recovery without fallback: probe failure re-opens", () => {
    let t = 0;
    const fail = { v: true };
    const primary = makeFlakyProvider(fail);
    const wrapped = withCircuitBreaker(primary, {
      now: () => t,
      failureThreshold: 3,
      cooldownMs: 60_000,
      // intentionally omit fallbackTo
    });
    for (let i = 0; i < 3; i += 1) {
      expect(() => wrapped.embed("x")).toThrow();
    }
    expect(wrapped.breaker.status().state).toBe("open");
    t = 60_500;
    // Half-open probe still fails → re-open.
    expect(() => wrapped.embed("x")).toThrow();
    expect(wrapped.breaker.status().state).toBe("open");
  });
});
