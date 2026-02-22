import { describe, expect, mock, test } from "bun:test";
import { ClaudeMemLocomoAdapter } from "./locomo-claude-mem-adapter";

describe("LOCOMO claude-mem adapter", () => {
  test("maps claude-mem response into locomo benchmark record schema", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toContain("/v1/search");
      const headers = (init?.headers || {}) as Record<string, string>;
      expect(headers["x-harness-mem-token"]).toBe("claude-mem-token");
      expect(headers.authorization).toBe("Bearer claude-mem-token");
      return new Response(
        JSON.stringify({
          ok: true,
          items: [{ content: "The user moved to Seattle in 2024." }],
          meta: {},
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    });

    const adapter = new ClaudeMemLocomoAdapter({
      baseUrl: "http://claude-mem.local",
      token: "claude-mem-token",
      project: "locomo-test",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const record = await adapter.answerQuestion({
      sample_id: "sample-1",
      question_id: "q1",
      question: "Where did I move?",
      answer: "Seattle",
      category: "profile",
    });

    expect(record.sample_id).toBe("sample-1");
    expect(record.prediction.toLowerCase()).toContain("seattle");
    expect(record.f1).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
