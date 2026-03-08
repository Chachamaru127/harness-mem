/**
 * S43-008: multi-hop factual extraction hardening
 *
 * TDD: These tests capture the desired improvements for multi-hop normalization:
 * - Causal fact prioritization for "why" questions
 * - Shorter, more precise answers (not full sentence chains)
 * - Japanese causal marker detection
 * - Temporal boundary multi-hop (why + when)
 */

import { describe, expect, test } from "bun:test";
import { normalizeLocomoAnswer } from "./locomo-answer-normalizer";

describe("S43-008: multi-hop factual extraction hardening", () => {
  // ----------------------------------------------------------------
  // Why-question: causal fact should be prioritized
  // ----------------------------------------------------------------

  test("why-question: extracts causal fact over generic state fact", () => {
    const result = normalizeLocomoAnswer({
      question: "Why did she start going to the gym?",
      kind: "multi_hop",
      rawAnswer: "She joined a fitness community. Her doctor recommended regular exercise because she had low energy.",
      evidence: [
        {
          id: "ev-1",
          sentence: "She joined a fitness community.",
          score: 0.85,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "ev-2",
          sentence: "Her doctor recommended regular exercise because she had low energy.",
          score: 0.80,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    // Should lead with the causal evidence, not the state observation
    expect(result.normalized).toContain("doctor recommended");
    expect(result.normalized.length).toBeLessThan(200);
  });

  test("why-question: Japanese causal marker triggers cause relation", () => {
    const result = normalizeLocomoAnswer({
      question: "なぜ彼女はジムに通い始めたのですか？",
      kind: "multi_hop",
      rawAnswer: "フィットネスコミュニティに参加しました。医者に運動を勧められたので、通い始めました。",
      evidence: [
        {
          id: "ev-1",
          sentence: "フィットネスコミュニティに参加しました。",
          score: 0.85,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "ev-2",
          sentence: "医者に運動を勧められたので、通い始めました。",
          score: 0.80,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    // Japanese causal (ので) should be prioritized
    expect(result.normalized).toContain("医者");
    expect(result.normalized.length).toBeLessThan(200);
  });

  // ----------------------------------------------------------------
  // Temporal boundary: "why" + "when" combined query
  // ----------------------------------------------------------------

  test("temporal boundary multi-hop: returns concise answer for why+when", () => {
    const result = normalizeLocomoAnswer({
      question: "What made her decide to apply and when did she do it?",
      kind: "multi_hop",
      rawAnswer: "She applied in March after her mentor encouraged her. The support gave her confidence.",
      evidence: [
        {
          id: "ev-1",
          sentence: "She applied in March after her mentor encouraged her.",
          score: 0.9,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "ev-2",
          sentence: "The support gave her confidence.",
          score: 0.7,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    // Should be a single short answer
    expect(result.normalized.length).toBeLessThan(220);
    expect(result.normalized).not.toMatch(/\.\s+\w/); // ideally no multi-sentence
  });

  // ----------------------------------------------------------------
  // Short-answer normalization: no hallucination beyond evidence
  // ----------------------------------------------------------------

  test("multi_hop: does not repeat filler/transition words", () => {
    const result = normalizeLocomoAnswer({
      question: "Why did she join the counseling program?",
      kind: "multi_hop",
      rawAnswer: "She joined. Additionally, she also participated. Furthermore, she benefited.",
      evidence: [
        {
          id: "ev-1",
          sentence: "Her friend referred her to the counseling program because she was feeling overwhelmed.",
          score: 0.9,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(result.normalized).not.toMatch(/additionally|furthermore|also participated/i);
    expect(result.normalized.length).toBeLessThan(200);
  });

  test("multi_hop: single high-quality evidence returns short answer", () => {
    const result = normalizeLocomoAnswer({
      question: "What motivated her to start her own business?",
      kind: "multi_hop",
      rawAnswer: "She started her business because she wanted financial independence.",
      evidence: [
        {
          id: "ev-1",
          sentence: "She started her business because she wanted financial independence.",
          score: 0.95,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(result.normalized).toContain("financial independence");
    expect(result.normalized.length).toBeLessThanOrEqual(100);
  });

  // ----------------------------------------------------------------
  // Causal relation detection: Japanese causal markers
  // ----------------------------------------------------------------

  test("multi_hop: Japanese ため/から/ので → cause relation prioritized", () => {
    const result = normalizeLocomoAnswer({
      question: "なぜ彼女はカウンセリングを始めましたか？",
      kind: "multi_hop",
      rawAnswer: "カウンセリングプログラムに参加しました。友人に紹介されたから参加しました。",
      evidence: [
        {
          id: "ev-1",
          sentence: "カウンセリングプログラムに参加しました。",
          score: 0.85,
        },
        {
          id: "ev-2",
          sentence: "友人に紹介されたから参加しました。",
          score: 0.80,
        },
      ],
    });

    // Causal evidence (から) should appear in summary
    expect(result.normalized).toContain("紹介");
  });

  // ----------------------------------------------------------------
  // multi_hop_reasoning structure
  // ----------------------------------------------------------------

  test("multi_hop reasoning trace has facts with correct cause relation", () => {
    const result = normalizeLocomoAnswer({
      question: "Why did she join the support group?",
      kind: "multi_hop",
      rawAnswer: "She felt alone. She joined because her therapist suggested it.",
      evidence: [
        {
          id: "ev-1",
          sentence: "She felt alone.",
          score: 0.7,
        },
        {
          id: "ev-2",
          sentence: "She joined because her therapist suggested it.",
          score: 0.9,
        },
      ],
    });

    const facts = result.multi_hop_reasoning?.facts ?? [];
    const causeFact = facts.find((f) => f.relation === "cause");
    expect(causeFact).toBeDefined();
    expect(causeFact?.fact).toContain("therapist");
  });

  test("multi_hop reasoning trace has facts with Japanese cause relation", () => {
    const result = normalizeLocomoAnswer({
      question: "なぜ彼女はサポートグループに参加しましたか？",
      kind: "multi_hop",
      rawAnswer: "孤独を感じていました。セラピストに勧められたので参加しました。",
      evidence: [
        {
          id: "ev-1",
          sentence: "孤独を感じていました。",
          score: 0.7,
        },
        {
          id: "ev-2",
          sentence: "セラピストに勧められたので参加しました。",
          score: 0.9,
        },
      ],
    });

    const facts = result.multi_hop_reasoning?.facts ?? [];
    const causeFact = facts.find((f) => f.relation === "cause");
    expect(causeFact).toBeDefined();
    expect(causeFact?.fact).toContain("セラピスト");
  });
});
