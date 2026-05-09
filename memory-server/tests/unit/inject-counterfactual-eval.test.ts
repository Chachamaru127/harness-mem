/**
 * §S109-005 — inject-counterfactual-eval unit tests.
 *
 * Verifies:
 *   (a) DEFAULT fixture produces effective_rate >= 0.30 (baseline DoD)
 *   (b) all-wantConsume=true / all signals hit → effective_rate == 1.0, tier=green
 *   (c) all wantConsume=false → effective_rate == 0.0, tier=red
 *   (d) decideEffectiveTier boundary table
 *   (e) empty fixture → effective_rate == 0, tier=red, fixture_size == 0
 *   (f) without_inject path returns consumed=false when signals are empty
 *       (counterfactual baseline robustness)
 */

import { describe, expect, test } from "bun:test";
import {
  decideEffectiveTier,
  runInjectCounterfactualEval,
  type CounterfactualEvalOptions,
} from "../../src/benchmark/inject-counterfactual-eval";
import {
  DEFAULT_SMOKE_FIXTURE,
  type SmokeFixture,
} from "../../src/benchmark/inject-actionability-smoke";

// ---------------------------------------------------------------------------
// Shared nowMs for determinism
// ---------------------------------------------------------------------------
const FIXED_NOW_MS = 1_700_000_000_000;

const BASE_OPTS: CounterfactualEvalOptions = {
  nowMs: FIXED_NOW_MS,
  sessionId: "test_counterfactual",
};

// ---------------------------------------------------------------------------
// (a) DEFAULT fixture — baseline DoD: effective_rate >= 0.30
// ---------------------------------------------------------------------------
describe("runInjectCounterfactualEval — DEFAULT fixture (§S109-005 DoD baseline)", () => {
  test("(a) DEFAULT fixture: effective_rate >= 0.30", () => {
    const result = runInjectCounterfactualEval(BASE_OPTS);

    expect(result.schema_version).toBe(1);
    expect(typeof result.run_id).toBe("string");
    expect(result.fixture_size).toBe(DEFAULT_SMOKE_FIXTURE.length);
    expect(result.effective_rate).toBeGreaterThanOrEqual(0.3);
    expect(["green", "yellow", "red"]).toContain(result.tier);
  });

  test("(a) result JSON shape is fully populated", () => {
    const result = runInjectCounterfactualEval(BASE_OPTS);

    // with_inject path
    expect(typeof result.with_inject.consumed_count).toBe("number");
    expect(typeof result.with_inject.consumed_rate).toBe("number");
    // without_inject path
    expect(typeof result.without_inject.consumed_count).toBe("number");
    expect(typeof result.without_inject.consumed_rate).toBe("number");
    // effective
    expect(typeof result.effective_count).toBe("number");
    expect(typeof result.effective_rate).toBe("number");
    expect(result.effective_rate).toBeGreaterThanOrEqual(0);
    expect(result.effective_rate).toBeLessThanOrEqual(1);
    // thresholds passthrough
    expect(result.decisions_md_d8_thresholds.green_min).toBe(0.5);
    expect(result.decisions_md_d8_thresholds.red_max).toBe(0.2);
    expect(result.fired_at_ms).toBe(FIXED_NOW_MS);
  });
});

// ---------------------------------------------------------------------------
// (b) All wantConsume=true, all signals hit → effective_rate == 1.0, tier=green
// ---------------------------------------------------------------------------
describe("runInjectCounterfactualEval — all-consumed fixture", () => {
  test("(b) all wantConsume=true, all signals hit → effective_rate=1.0, tier=green", () => {
    // Build a fixture where every entry is wantConsume=true AND the artifact
    // echoes the signal verbatim. Signals must be present in the artifact so
    // detectConsumed returns consumed=true for the with_inject path.
    const allConsumed: SmokeFixture[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "recall_chain" as const,
      signals: [`unique-signal-${i}`],
      action_hint: "read_before_edit" as const,
      confidence: 0.8,
      prose: `unique-signal-${i} を読んでください。`,
      artifact: { user_text: `Processing unique-signal-${i} as instructed.` },
      wantConsume: true,
    }));

    const result = runInjectCounterfactualEval({
      ...BASE_OPTS,
      fixture: allConsumed,
    });

    expect(result.fixture_size).toBe(5);
    expect(result.with_inject.consumed_count).toBe(5);
    // without_inject path has empty signals — consumed=false for all
    expect(result.without_inject.consumed_count).toBe(0);
    expect(result.effective_count).toBe(5);
    expect(result.effective_rate).toBe(1.0);
    expect(result.tier).toBe("green");
  });
});

// ---------------------------------------------------------------------------
// (c) All wantConsume=false → effective_rate == 0.0, tier=red
// ---------------------------------------------------------------------------
describe("runInjectCounterfactualEval — no-consume fixture", () => {
  test("(c) all wantConsume=false → effective_rate=0.0, tier=red", () => {
    const noConsume: SmokeFixture[] = DEFAULT_SMOKE_FIXTURE.map((f) => ({
      ...f,
      wantConsume: false,
      artifact: { user_text: "nothing matches here" },
    }));

    const result = runInjectCounterfactualEval({
      ...BASE_OPTS,
      fixture: noConsume,
    });

    expect(result.with_inject.consumed_count).toBe(0);
    expect(result.without_inject.consumed_count).toBe(0);
    expect(result.effective_count).toBe(0);
    expect(result.effective_rate).toBe(0);
    expect(result.tier).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// (d) decideEffectiveTier boundary table
// ---------------------------------------------------------------------------
describe("decideEffectiveTier (§S109-005 D8 boundary table)", () => {
  test("(d) rate >= 0.50 → green", () => {
    expect(decideEffectiveTier(0.5)).toBe("green");
    expect(decideEffectiveTier(0.75)).toBe("green");
    expect(decideEffectiveTier(1.0)).toBe("green");
  });

  test("(d) 0.20 <= rate < 0.50 → yellow", () => {
    expect(decideEffectiveTier(0.2)).toBe("yellow");
    expect(decideEffectiveTier(0.35)).toBe("yellow");
    expect(decideEffectiveTier(0.4999)).toBe("yellow");
  });

  test("(d) rate < 0.20 → red", () => {
    expect(decideEffectiveTier(0.19)).toBe("red");
    expect(decideEffectiveTier(0.0)).toBe("red");
    expect(decideEffectiveTier(0.1999)).toBe("red");
  });

  test("(d) boundary: decideEffectiveTier(0.5) === green", () => {
    expect(decideEffectiveTier(0.5)).toBe("green");
  });

  test("(d) boundary: decideEffectiveTier(0.2) === yellow", () => {
    expect(decideEffectiveTier(0.2)).toBe("yellow");
  });

  test("(d) boundary: decideEffectiveTier(0.19) === red", () => {
    expect(decideEffectiveTier(0.19)).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// (e) Empty fixture → effective_rate == 0, tier=red, fixture_size == 0
// ---------------------------------------------------------------------------
describe("runInjectCounterfactualEval — empty fixture", () => {
  test("(e) empty fixture → fixture_size=0, effective_rate=0, tier=red", () => {
    const result = runInjectCounterfactualEval({ ...BASE_OPTS, fixture: [] });

    expect(result.fixture_size).toBe(0);
    expect(result.with_inject.consumed_count).toBe(0);
    expect(result.with_inject.consumed_rate).toBe(0);
    expect(result.without_inject.consumed_count).toBe(0);
    expect(result.without_inject.consumed_rate).toBe(0);
    expect(result.effective_count).toBe(0);
    expect(result.effective_rate).toBe(0);
    expect(result.tier).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// (f) without_inject path: empty signals → detectConsumed always returns false
// ---------------------------------------------------------------------------
describe("runInjectCounterfactualEval — counterfactual baseline robustness", () => {
  test("(f) without_inject consumed_count is always 0 (ghost envelope has empty signals)", () => {
    // Use a fixture with very distinctive signals that ARE present in artifacts,
    // so with_inject will consume but without_inject (ghost envelope) will not.
    const fixture: SmokeFixture[] = [
      {
        kind: "risk_warn",
        signals: ["force-push-UNIQUE-XYZ"],
        action_hint: "warn_user_before_act",
        confidence: 0.9,
        prose: "force-push-UNIQUE-XYZ は禁止です。",
        artifact: { user_text: "Avoided force-push-UNIQUE-XYZ as warned." },
        wantConsume: true,
      },
    ];

    const result = runInjectCounterfactualEval({
      ...BASE_OPTS,
      fixture,
    });

    // with_inject should consume (signal is in artifact)
    expect(result.with_inject.consumed_count).toBe(1);
    // without_inject must NOT consume (ghost envelope has empty signals[])
    expect(result.without_inject.consumed_count).toBe(0);
    // effective = 1 (with consumed, without not consumed)
    expect(result.effective_count).toBe(1);
    expect(result.effective_rate).toBe(1.0);
  });

  test("(f) without_inject returns consumed=false even when artifact echoes signal verbatim", () => {
    // The ghost envelope has signals=[], so detectConsumed short-circuits to false
    // regardless of what the artifact says.
    const fixture: SmokeFixture[] = [
      {
        kind: "suggest",
        signals: ["release-checklist-ALPHA"],
        action_hint: "consider_before_decide",
        confidence: 0.7,
        prose: "release-checklist-ALPHA を確認してください。",
        artifact: { user_text: "Checking release-checklist-ALPHA now." },
        wantConsume: true,
      },
    ];

    const result = runInjectCounterfactualEval({
      ...BASE_OPTS,
      fixture,
    });

    expect(result.without_inject.consumed_count).toBe(0);
    expect(result.without_inject.consumed_rate).toBe(0);
  });
});
