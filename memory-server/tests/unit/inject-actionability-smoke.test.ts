/**
 * §S109-004 — inject-actionability smoke harness unit tests (TDD)
 *
 * Verifies:
 *   1. JSON shape returned by `runInjectActionabilitySmoke()`
 *   2. delivered_rate / consumed_rate ranges
 *   3. tier decision boundary (red / yellow / green / edge cases)
 *   4. hooks_health_summary is a stable, serializable string
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SMOKE_FIXTURE,
  decideTier,
  runInjectActionabilitySmoke,
  type SmokeFixture,
} from "../../src/benchmark/inject-actionability-smoke";

describe("runInjectActionabilitySmoke (§S109-004)", () => {
  test("returns the documented JSON shape with valid ranges", () => {
    const result = runInjectActionabilitySmoke({ nowMs: 1_700_000_000_000 });

    // shape
    expect(typeof result.delivered_rate).toBe("number");
    expect(typeof result.consumed_rate).toBe("number");
    expect(typeof result.fixture_size).toBe("number");
    expect(typeof result.consumed_count).toBe("number");
    expect(typeof result.hooks_health_summary).toBe("string");
    expect(["green", "yellow", "red"]).toContain(result.tier);

    // ranges
    expect(result.delivered_rate).toBeGreaterThanOrEqual(0);
    expect(result.delivered_rate).toBeLessThanOrEqual(1);
    expect(result.consumed_rate).toBeGreaterThanOrEqual(0);
    expect(result.consumed_rate).toBeLessThanOrEqual(1);
    expect(result.fixture_size).toBe(DEFAULT_SMOKE_FIXTURE.length);
    expect(result.consumed_count).toBeGreaterThanOrEqual(0);
    expect(result.consumed_count).toBeLessThanOrEqual(result.fixture_size);
  });

  test("default fixture lands a green tier (delivered=1.0, consumed≈0.6)", () => {
    const result = runInjectActionabilitySmoke({ nowMs: 1_700_000_000_000 });
    expect(result.delivered_rate).toBe(1);
    // 6 of 10 fixtures are wantConsume=true
    expect(result.consumed_count).toBe(6);
    expect(result.consumed_rate).toBe(0.6);
    expect(result.tier).toBe("green");
  });

  test("hooks_health_summary covers all three tracked hook surfaces", () => {
    const result = runInjectActionabilitySmoke({ nowMs: 1_700_000_000_000 });
    expect(result.hooks_health_summary).toContain("session_start=");
    expect(result.hooks_health_summary).toContain("user_prompt_submit=");
    expect(result.hooks_health_summary).toContain("stop=");
    // With nowMs == fired_at base, all hooks should be classified alive.
    expect(result.hooks_health_summary).toContain("alive");
  });

  test("zero-consume fixture lands red tier", () => {
    // All 10 envelopes fire, but no signal hits the next-turn artifact.
    const fixture: SmokeFixture[] = DEFAULT_SMOKE_FIXTURE.map((f) => ({
      ...f,
      wantConsume: false,
      artifact: { user_text: "no signal here" },
    }));
    const result = runInjectActionabilitySmoke({
      fixture,
      nowMs: 1_700_000_000_000,
    });
    expect(result.delivered_rate).toBe(1);
    expect(result.consumed_rate).toBe(0);
    expect(result.tier).toBe("red");
  });

  test("yellow tier triggers at consumed_rate=0.3", () => {
    // 10 envelopes, 3 consumed → 0.3 (boundary, inclusive lower bound for yellow).
    // Synthesize a fixture whose first 3 entries have signal-matching artifacts and
    // the remaining 7 do not — this avoids depending on which DEFAULT entries
    // happen to be wantConsume-compatible.
    const consumeable: SmokeFixture = {
      kind: "recall_chain",
      signals: ["plans/§S109"],
      action_hint: "read_before_edit",
      confidence: 0.7,
      prose: "plans/§S109 を読んでください。",
      artifact: { user_text: "Reading plans/§S109 now." },
      wantConsume: true,
    };
    const nonconsumeable: SmokeFixture = {
      kind: "recall_chain",
      signals: ["other-signal"],
      action_hint: "read_before_edit",
      confidence: 0.5,
      prose: "other-signal を読んでください。",
      artifact: { user_text: "irrelevant" },
      wantConsume: false,
    };
    const fixture: SmokeFixture[] = [
      ...Array(3).fill(consumeable),
      ...Array(7).fill(nonconsumeable),
    ];
    const result = runInjectActionabilitySmoke({
      fixture,
      nowMs: 1_700_000_000_000,
    });
    expect(result.delivered_rate).toBe(1);
    expect(result.consumed_count).toBe(3);
    expect(result.consumed_rate).toBe(0.3);
    expect(result.tier).toBe("yellow");
  });
});

describe("decideTier (§S109-004 boundary table)", () => {
  test("delivered_rate < 0.95 ⇒ red regardless of consumed_rate", () => {
    expect(decideTier(0.94, 1.0)).toBe("red");
    expect(decideTier(0.5, 0.9)).toBe("red");
    expect(decideTier(0.0, 1.0)).toBe("red");
  });

  test("consumed_rate < 0.30 ⇒ red", () => {
    expect(decideTier(1.0, 0.0)).toBe("red");
    expect(decideTier(1.0, 0.2999)).toBe("red");
    expect(decideTier(0.95, 0.29)).toBe("red");
  });

  test("0.30 ≤ consumed_rate < 0.60 ⇒ yellow", () => {
    expect(decideTier(1.0, 0.3)).toBe("yellow");
    expect(decideTier(0.95, 0.45)).toBe("yellow");
    expect(decideTier(1.0, 0.5999)).toBe("yellow");
  });

  test("delivered ≥ 0.95 AND consumed ≥ 0.60 ⇒ green", () => {
    expect(decideTier(0.95, 0.6)).toBe("green");
    expect(decideTier(1.0, 0.75)).toBe("green");
    expect(decideTier(1.0, 1.0)).toBe("green");
  });

  test("edge: delivered exactly at 0.95 with low consumed still red", () => {
    expect(decideTier(0.95, 0.29)).toBe("red");
  });
});
