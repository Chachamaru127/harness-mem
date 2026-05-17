import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORK_HINT_FIXTURE,
  decideWorkHintTier,
  runWorkHintActionabilitySmoke,
  type WorkHintFixture,
} from "../../src/benchmark/work-hint-actionability-smoke";

describe("runWorkHintActionabilitySmoke (§S125-013)", () => {
  test("emits work_hint_consumed_rate with green default fixture", () => {
    const result = runWorkHintActionabilitySmoke();

    expect(result.fixture_size).toBe(DEFAULT_WORK_HINT_FIXTURE.length);
    expect(result.work_hint_delivered_rate).toBe(1);
    expect(result.consumed_count).toBe(6);
    expect(result.work_hint_consumed_rate).toBe(0.6);
    expect(result.tier).toBe("green");
    expect(result.thresholds).toEqual({ yellow_min: 0.3, green_min: 0.6 });
  });

  test("yellow tier starts at work_hint_consumed_rate=0.3", () => {
    const consumed: WorkHintFixture = {
      workId: "S125-Y",
      title: "Yellow boundary",
      hintDelivered: true,
      artifactText: "Using S125-Y now.",
      wantConsume: true,
    };
    const missed: WorkHintFixture = {
      workId: "S125-M",
      title: "Missed hint",
      hintDelivered: true,
      artifactText: "unrelated",
      wantConsume: false,
    };

    const result = runWorkHintActionabilitySmoke([
      ...Array(3).fill(consumed),
      ...Array(7).fill(missed),
    ]);

    expect(result.work_hint_consumed_rate).toBe(0.3);
    expect(result.tier).toBe("yellow");
  });
});

describe("decideWorkHintTier (§S125-013 boundary table)", () => {
  test("red below 0.30, yellow below 0.60, green at 0.60+", () => {
    expect(decideWorkHintTier(0)).toBe("red");
    expect(decideWorkHintTier(0.2999)).toBe("red");
    expect(decideWorkHintTier(0.3)).toBe("yellow");
    expect(decideWorkHintTier(0.5999)).toBe("yellow");
    expect(decideWorkHintTier(0.6)).toBe("green");
    expect(decideWorkHintTier(1)).toBe("green");
  });
});
