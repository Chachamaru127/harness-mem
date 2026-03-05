import { describe, expect, test } from "bun:test";
import { normalizeLocomoAnswer } from "./locomo-answer-normalizer";

describe("LOCOMO answer normalizer", () => {
  test("canonicalizes explicit temporal expressions to a single date style", () => {
    const fromDayMonth = normalizeLocomoAnswer({
      question: "When was the talk?",
      kind: "temporal",
      rawAnswer: "The talk happened on 7 May 2023.",
      evidence: [],
      referenceIso: "2026-01-01T00:00:00.000Z",
    });
    expect(fromDayMonth.normalized).toBe("May 7, 2023");

    const fromMonthDay = normalizeLocomoAnswer({
      question: "When was the talk?",
      kind: "temporal",
      rawAnswer: "It happened on May 7, 2023.",
      evidence: [],
      referenceIso: "2026-01-01T00:00:00.000Z",
    });
    expect(fromMonthDay.normalized).toBe("May 7, 2023");
  });

  test("resolves relative weekday using conversation reference time", () => {
    const normalized = normalizeLocomoAnswer({
      question: "When did it happen?",
      kind: "temporal",
      rawAnswer: "It happened last Saturday.",
      evidence: [],
      referenceIso: "2026-01-01T00:00:00.000Z",
    });
    expect(normalized.normalized).toBe("December 27, 2025");
    expect(normalized.notes).toContain("temporal:resolved_relative_weekday");
  });

  test("produces counterfactual answer in conclusion + reason format", () => {
    const normalized = normalizeLocomoAnswer({
      question: "Would I still pursue counseling if I hadn't received support?",
      kind: "multi_hop",
      category: "cat-3",
      rawAnswer: "The support group gave me courage to pursue counseling.",
      evidence: [
        {
          id: "obs-1",
          sentence: "The support group gave me courage to pursue counseling.",
          score: 0.9,
          created_at: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    expect(normalized.normalized).toContain("Likely no.");
    expect(normalized.normalized).toContain("Reason:");
    expect(normalized.multi_hop_reasoning?.format).toBe("counterfactual");
    expect((normalized.multi_hop_reasoning?.facts || []).length).toBeGreaterThan(0);
  });

  // SD-012: yes_no — emphatic "not only/just/merely" should NOT trigger false negatives
  test("SD-012: emphatic 'not only' constructions return Yes, not No", () => {
    const notOnly = normalizeLocomoAnswer({
      question: "Did she enjoy it?",
      kind: "yes_no",
      rawAnswer: "She was not only happy but absolutely thrilled.",
      evidence: [],
    });
    expect(notOnly.normalized).toBe("Yes");

    const notJust = normalizeLocomoAnswer({
      question: "Did he finish?",
      kind: "yes_no",
      rawAnswer: "He not just finished it but exceeded all expectations.",
      evidence: [],
    });
    expect(notJust.normalized).toBe("Yes");

    const notMerely = normalizeLocomoAnswer({
      question: "Was it enough?",
      kind: "yes_no",
      rawAnswer: "It was not merely sufficient but outstanding.",
      evidence: [],
    });
    expect(notMerely.normalized).toBe("Yes");

    // True negation should still return No
    const trueNegation = normalizeLocomoAnswer({
      question: "Did she pass?",
      kind: "yes_no",
      rawAnswer: "She did not pass the exam.",
      evidence: [],
    });
    expect(trueNegation.normalized).toBe("No");
  });
});

