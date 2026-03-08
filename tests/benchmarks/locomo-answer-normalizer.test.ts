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

  test("S39-007: factual normalization expands exact name from evidence without inventing new text", () => {
    const normalized = normalizeLocomoAnswer({
      question: "What is the name of my online bakery?",
      kind: "factual",
      rawAnswer: "Sweet",
      evidence: [
        {
          id: "obs-1",
          sentence: "I launched my online bakery called SweetByte last summer.",
          score: 0.9,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(normalized.normalized).toBe("SweetByte");
    expect(normalized.notes).toContain("factual:evidence_bounded_span");
  });

  test("S39-007: factual normalization extracts exact item span instead of sentence lead", () => {
    const normalized = normalizeLocomoAnswer({
      question: "What is the best-selling item at my bakery?",
      kind: "factual",
      rawAnswer: "Our best seller is the almond croissant.",
      evidence: [
        {
          id: "obs-1",
          sentence: "Our best seller is the almond croissant.",
          score: 0.95,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(normalized.normalized).toBe("almond croissant");
    expect(normalized.notes).toContain("factual:evidence_bounded_span");
  });

  test("S39-007: factual normalization does not hallucinate missing evidence", () => {
    const normalized = normalizeLocomoAnswer({
      question: "What is the name of my online bakery?",
      kind: "factual",
      rawAnswer: "Sweet",
      evidence: [
        {
          id: "obs-1",
          sentence: "I launched my online bakery last summer.",
          score: 0.8,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(normalized.normalized).toBe("Sweet");
    expect(normalized.normalized).not.toBe("SweetByte");
  });

  test("S40-006: factual normalization extracts Japanese current value from evidence", () => {
    const normalized = normalizeLocomoAnswer({
      question: "今、使っている CI は何ですか？",
      kind: "factual",
      rawAnswer: "今は GitHub Actions を使っています。CircleCI の parallel build costs が上がり続けたからです。",
      evidence: [
        {
          id: "obs-1",
          sentence: "今は GitHub Actions を使っています。CircleCI の parallel build costs が上がり続けたからです。",
          score: 0.9,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(normalized.normalized).toBe("GitHub Actions");
    expect(normalized.notes).toContain("factual:evidence_bounded_span");
  });

  test("S40-006: factual normalization extracts Japanese reason clause without filler", () => {
    const normalized = normalizeLocomoAnswer({
      question: "CircleCI から移行した理由は何ですか？",
      kind: "factual",
      rawAnswer: "今は GitHub Actions を使っています。CircleCI の parallel build costs が上がり続けたからです。",
      evidence: [
        {
          id: "obs-1",
          sentence: "今は GitHub Actions を使っています。CircleCI の parallel build costs が上がり続けたからです。",
          score: 0.9,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(normalized.normalized).toBe("CircleCI の parallel build costs が上がり続けたから");
  });

  test("S40-006: temporal normalization extracts ordinal item from Japanese sequence sentence", () => {
    const normalized = normalizeLocomoAnswer({
      question: "最後に出た機能は何ですか？",
      kind: "temporal",
      rawAnswer: "順番は export to CSV が最初、audit logs が次、SAML が最後でした。",
      evidence: [
        {
          id: "obs-1",
          sentence: "順番は export to CSV が最初、audit logs が次、SAML が最後でした。",
          score: 0.95,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(normalized.normalized).toBe("SAML");
    expect(normalized.notes).toContain("temporal:ordinal_item_extract");
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

  test("S43: Japanese yes/no normalization returns No for current-value mismatch and exclusive list mismatch", () => {
    const currentMismatch = normalizeLocomoAnswer({
      question: "今も CircleCI を使っていますか？",
      kind: "yes_no",
      rawAnswer: "今は GitHub Actions を使っています。CircleCI の parallel build costs が上がり続けたからです。",
      evidence: [
        {
          id: "obs-1",
          sentence: "今は GitHub Actions を使っています。CircleCI の parallel build costs が上がり続けたからです。",
          score: 0.9,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(currentMismatch.normalized).toBe("No");

    const exclusiveMismatch = normalizeLocomoAnswer({
      question: "今の推奨 setup は codex だけですか？",
      kind: "yes_no",
      rawAnswer: "今の推奨 setup は codex, cursor, claude をまとめて指定します。",
      evidence: [
        {
          id: "obs-2",
          sentence: "今の推奨 setup は codex, cursor, claude をまとめて指定します。",
          score: 0.9,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(exclusiveMismatch.normalized).toBe("No");

    const timeMismatch = normalizeLocomoAnswer({
      question: "定期メンテナンスは今も 01:00 JST 開始ですか？",
      kind: "yes_no",
      rawAnswer: "今は 03:30 JST 開始です。late-night tickets が減ったので遅らせました。",
      evidence: [
        {
          id: "obs-3",
          sentence: "今は 03:30 JST 開始です。late-night tickets が減ったので遅らせました。",
          score: 0.9,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(timeMismatch.normalized).toBe("No");
  });
});
