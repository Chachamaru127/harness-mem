import { describe, expect, test } from "bun:test";
import { OpenRouterBudget } from "../lib/openrouter-budget";

describe("OpenRouter budget guard", () => {
  test("tracks spend and blocks when cap exceeded", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"score":1}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const budget = new OpenRouterBudget("test-key", 0.001, async () => mockResponse);

    await budget.chatJson<{ score: number }>({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "user", content: "grade" }],
      max_tokens: 32,
    });

    expect(budget.spent).toBeGreaterThan(0);
    expect(() => budget.assertCanSpend(1)).toThrow(/budget exceeded/);
  });
});
