/**
 * S43-006: current-value shortest-span + response compression
 *
 * TDD: These tests define the desired behavior.
 * - English current-value span extraction
 * - over-answer rate measurement
 * - filler text removal for current-value queries
 */

import { describe, expect, test } from "bun:test";
import {
  extractCurrentValueSpan,
  measureOverAnswerRate,
  compressCurrentValueResponse,
  type OverAnswerResult,
} from "../../src/core/current-value-compression";

// ---------------------------------------------------------------------------
// extractCurrentValueSpan
// ---------------------------------------------------------------------------

describe("extractCurrentValueSpan: English patterns", () => {
  test("extracts value from 'X is currently Y'", () => {
    const span = extractCurrentValueSpan("The default region is currently Tokyo.");
    expect(span).toBe("Tokyo");
  });

  test("extracts value from 'currently using X'", () => {
    const span = extractCurrentValueSpan("We are currently using GitHub Actions for CI.");
    expect(span).toBe("GitHub Actions");
  });

  test("extracts value from 'now using X'", () => {
    const span = extractCurrentValueSpan("The team is now using Bun as the runtime.");
    expect(span).toBe("Bun");
  });

  test("extracts value from 'X is the current Y'", () => {
    const span = extractCurrentValueSpan("PostgreSQL is the current database.");
    expect(span).toBe("PostgreSQL");
  });

  test("extracts value from 'default is X'", () => {
    const span = extractCurrentValueSpan("The default branch is main.");
    expect(span).toBe("main");
  });

  test("extracts value from 'active plan is X'", () => {
    const span = extractCurrentValueSpan("The active plan is Pro.");
    expect(span).toBe("Pro");
  });

  test("returns null when no current-value pattern matches", () => {
    const span = extractCurrentValueSpan("We used to use Jenkins before switching.");
    expect(span).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(extractCurrentValueSpan("")).toBeNull();
  });
});

describe("extractCurrentValueSpan: Japanese patterns (existing behavior preserved)", () => {
  test("extracts from '今は X を使っています'", () => {
    const span = extractCurrentValueSpan("今は GitHub Actions を使っています。");
    expect(span).toBe("GitHub Actions");
  });

  test("extracts from '現在は X です'", () => {
    const span = extractCurrentValueSpan("現在は PostgreSQL です。");
    expect(span).toBe("PostgreSQL");
  });

  test("extracts from '今の X は Y です'", () => {
    const span = extractCurrentValueSpan("今の default region は Tokyo です。");
    expect(span).toBe("Tokyo");
  });
});

// ---------------------------------------------------------------------------
// compressCurrentValueResponse
// ---------------------------------------------------------------------------

describe("compressCurrentValueResponse", () => {
  test("returns just the span when it can be extracted", () => {
    const text = "The default region is currently Tokyo. Previously it was us-east-1. We moved for latency reasons.";
    const result = compressCurrentValueResponse(text);
    expect(result).toBe("Tokyo");
  });

  test("drops leading filler sentences when span not found", () => {
    const text = "Currently, the team is working on several improvements. The CI system is GitHub Actions.";
    const result = compressCurrentValueResponse(text);
    // Should drop leading filler and return the core statement
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain("GitHub Actions");
  });

  test("returns first sentence when text is already concise (≤120 chars)", () => {
    const text = "The current CI is GitHub Actions.";
    const result = compressCurrentValueResponse(text);
    expect(result).toBe("The current CI is GitHub Actions.");
  });

  test("strips leading filler cue words", () => {
    const text = "Actually, the current plan is Pro. We upgraded last month after evaluating costs.";
    const result = compressCurrentValueResponse(text);
    expect(result).not.toMatch(/^Actually/i);
  });

  test("handles Japanese filler stripping", () => {
    const text = "ちなみに今のプランは Pro です。先月コスト評価の後にアップグレードしました。";
    const result = compressCurrentValueResponse(text);
    expect(result).not.toMatch(/^ちなみに/);
  });

  test("returns original text when nothing to compress", () => {
    const text = "Pro";
    const result = compressCurrentValueResponse(text);
    expect(result).toBe("Pro");
  });
});

// ---------------------------------------------------------------------------
// measureOverAnswerRate
// ---------------------------------------------------------------------------

describe("measureOverAnswerRate", () => {
  const samples: Array<{ query: string; response: string }> = [
    {
      query: "What is the current CI?",
      response: "The current CI is GitHub Actions. Previously we used Jenkins. We also evaluated CircleCI but decided against it.",
    },
    {
      query: "今の CI は何ですか？",
      response: "今は GitHub Actions を使っています。",
    },
    {
      query: "What database are we using now?",
      response: "Currently PostgreSQL. We migrated from MySQL two years ago for better JSON support.",
    },
    {
      query: "今のプランは？",
      response: "今はエンタープライズプランです。以前はスタータープランでした。いくつかの理由でアップグレードしました。",
    },
  ];

  test("returns a rate between 0 and 1", () => {
    const result: OverAnswerResult = measureOverAnswerRate(samples);
    expect(result.rate).toBeGreaterThanOrEqual(0);
    expect(result.rate).toBeLessThanOrEqual(1);
  });

  test("over-answer rate is below threshold of 0.5 for mixed samples", () => {
    const result: OverAnswerResult = measureOverAnswerRate(samples);
    // 4 samples: 2 are over-answers (multi-sentence with filler), 2 are concise
    expect(result.rate).toBeLessThanOrEqual(0.5);
  });

  test("returns total and overAnswerCount", () => {
    const result: OverAnswerResult = measureOverAnswerRate(samples);
    expect(result.total).toBe(4);
    expect(result.overAnswerCount).toBeGreaterThanOrEqual(0);
    expect(result.overAnswerCount).toBeLessThanOrEqual(4);
  });

  test("all concise responses → rate = 0", () => {
    const concise = [
      { query: "What is the current CI?", response: "GitHub Actions." },
      { query: "今の DB は？", response: "PostgreSQL です。" },
    ];
    const result = measureOverAnswerRate(concise);
    expect(result.rate).toBe(0);
  });

  test("all verbose responses → rate = 1", () => {
    const verbose = [
      {
        query: "What is the current CI?",
        response: "Currently we use GitHub Actions. Before that we used Jenkins. We also evaluated CircleCI. The switch happened in 2023.",
      },
      {
        query: "今の DB は？",
        response: "今は PostgreSQL を使っています。以前は MySQL でした。移行の理由はいくつかあります。まず、JSON サポートが優れていること。次にパフォーマンスが良いこと。",
      },
    ];
    const result = measureOverAnswerRate(verbose);
    expect(result.rate).toBe(1);
  });

  test("empty input returns rate = 0", () => {
    const result = measureOverAnswerRate([]);
    expect(result.rate).toBe(0);
    expect(result.total).toBe(0);
    expect(result.overAnswerCount).toBe(0);
  });
});
