import { describe, expect, test } from "bun:test";
import { classifyQuestion, routeQuery, HYBRID_WEIGHTS } from "../../src/retrieval/router";

describe("classifyQuestion", () => {
  test("classifies profile queries", () => {
    const result = classifyQuestion("Who is the author of this module?");
    expect(result.kind).toBe("profile");
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  test("classifies 'what is' as profile", () => {
    const result = classifyQuestion("What is the authentication system?");
    expect(result.kind).toBe("profile");
  });

  test("classifies 'tell me about' as profile", () => {
    const result = classifyQuestion("Tell me about the database schema");
    expect(result.kind).toBe("profile");
  });

  test("classifies timeline queries", () => {
    const result = classifyQuestion("When did the last deployment happen?");
    expect(result.kind).toBe("timeline");
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  test("classifies 'recently' queries as timeline", () => {
    const result = classifyQuestion("What changed recently in the auth module?");
    expect(result.kind).toBe("timeline");
  });

  test("classifies 'latest' queries as timeline", () => {
    const result = classifyQuestion("Show me the latest test results");
    expect(result.kind).toBe("timeline");
  });

  test("classifies graph queries", () => {
    const result = classifyQuestion("How does auth relate to the user module?");
    expect(result.kind).toBe("graph");
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  test("classifies 'depends on' as graph", () => {
    const result = classifyQuestion("What depends on the database module?");
    expect(result.kind).toBe("graph");
  });

  test("falls back to hybrid for general queries", () => {
    const result = classifyQuestion("memory management best practices");
    expect(result.kind).toBe("hybrid");
  });

  test("returns hybrid for empty query", () => {
    const result = classifyQuestion("");
    expect(result.kind).toBe("hybrid");
    expect(result.confidence).toBe(0);
  });
});

describe("routeQuery", () => {
  test("uses explicit kind when provided", () => {
    const result = routeQuery("some query", "vector");
    expect(result.kind).toBe("vector");
    expect(result.confidence).toBe(1.0);
  });

  test("classifies automatically when no explicit kind", () => {
    const result = routeQuery("When was the last commit?");
    expect(result.kind).toBe("timeline");
  });

  test("profile weights boost lexical and tag_boost", () => {
    const result = routeQuery("query", "profile");
    expect(result.weights.lexical).toBeGreaterThan(HYBRID_WEIGHTS.lexical);
    expect(result.weights.tag_boost).toBeGreaterThan(HYBRID_WEIGHTS.tag_boost);
  });

  test("timeline weights boost recency", () => {
    const result = routeQuery("query", "timeline");
    expect(result.weights.recency).toBeGreaterThan(HYBRID_WEIGHTS.recency);
  });

  test("graph weights boost graph", () => {
    const result = routeQuery("query", "graph");
    expect(result.weights.graph).toBeGreaterThan(HYBRID_WEIGHTS.graph);
  });

  test("vector weights boost vector", () => {
    const result = routeQuery("query", "vector");
    expect(result.weights.vector).toBeGreaterThan(HYBRID_WEIGHTS.vector);
  });

  test("all weight sets sum to approximately 1.0", () => {
    for (const kind of ["profile", "timeline", "graph", "vector", "hybrid"] as const) {
      const result = routeQuery("query", kind);
      const sum = Object.values(result.weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });
});
