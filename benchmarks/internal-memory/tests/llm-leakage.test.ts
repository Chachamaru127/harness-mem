import { describe, expect, test } from "bun:test";
import { OpenRouterBudget } from "../lib/openrouter-budget";
import { hasLlmLeakage } from "../lib/real-data/llm-leakage";
import type { CandidateCase } from "../lib/real-data/types";

function sampleCase(overrides: Partial<CandidateCase> = {}): CandidateCase {
  return {
    case_id: "test-001",
    layer: "ja_coding",
    category: "real_ar",
    competency: "AR",
    language_profile: "ja",
    project: "bench-real-test",
    memories: [{ id: "m1", content: "認証方式は JWT を使う。" }],
    query: "認証方式は？",
    relevant_ids: ["m1"],
    expected_keywords: ["JWT"],
    source_round_ids: ["r1"],
    ...overrides,
  };
}

describe("llm leakage N=3", () => {
  test("heuristic rejects when query contains keyword", async () => {
    const c = sampleCase({ query: "JWT について教えて" });
    expect(await hasLlmLeakage(c, undefined, 3)).toBe(true);
  });

  test("mock judge: one can_answer true rejects (N=3)", async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls += 1;
      const canAnswer = calls === 2;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ can_answer: canAnswer }) } }],
          usage: { prompt_tokens: 50, completion_tokens: 20 },
        }),
        { status: 200 },
      );
    };
    const budget = new OpenRouterBudget("test-key", 30, mockFetch);
    process.env.OPENROUTER_API_KEY = "test-key";
    const c = sampleCase({ query: "認証方式は？", expected_keywords: ["JWT"] });
    expect(await hasLlmLeakage(c, budget, 3)).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
    delete process.env.OPENROUTER_API_KEY;
  });

  test("mock judge: all false passes leakage check", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"can_answer":false}' } }],
          usage: { prompt_tokens: 50, completion_tokens: 20 },
        }),
        { status: 200 },
      );
    const budget = new OpenRouterBudget("test-key", 30, mockFetch);
    process.env.OPENROUTER_API_KEY = "test-key";
    const c = sampleCase({ query: "認証方式は？", expected_keywords: ["JWT"] });
    expect(await hasLlmLeakage(c, budget, 3)).toBe(false);
    delete process.env.OPENROUTER_API_KEY;
  });
});
