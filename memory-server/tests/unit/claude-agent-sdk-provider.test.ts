/**
 * S81-C02: Claude Agent SDK provider unit tests.
 *
 * DoD: ANTHROPIC_API_KEY 未設定かつ Claude subscription あり環境で
 * consolidation の LLM 呼び出しが成功、provider switch log が記録される。
 * 本セッションでは SDK 未インストール環境を前提とし、fallback 経路と
 * availability 検出の両方を確認する。
 */
import { describe, expect, test } from "bun:test";
import {
  ClaudeAgentSDKProvider,
  detectAgentSDKAvailability,
  tryCreateClaudeAgentSDKProvider,
  type AgentSDKLoader,
} from "../../src/llm/claude-agent-sdk-provider";

type QueryMessage = {
  type: string;
  message?: { content?: Array<{ type: string; text?: string }> };
};

type MaybeQueryFn = (args: { prompt: string; options?: unknown }) => AsyncIterable<QueryMessage>;

/**
 * Build a fake SDK query function that replays a fixed list of text
 * fragments as `assistant` messages. Returned as `unknown` and coerced
 * via the `AgentSDKLoader` contract so tests do not need `any`.
 */
function makeFakeQuery(outputs: string[]): MaybeQueryFn {
  return function fake() {
    return (async function* () {
      for (const text of outputs) {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text }] },
        };
      }
    })();
  };
}

/**
 * Build a loader that returns the provided fake query function, or `null`
 * to simulate a missing SDK install. The fake function is upcast via
 * `unknown` so the loader satisfies the `AgentSDKLoader` contract without
 * the test file importing the internal SDK query type.
 */
function makeLoader(fn: MaybeQueryFn | null): AgentSDKLoader {
  type LoadReturn = Awaited<ReturnType<AgentSDKLoader["load"]>>;
  return {
    async load(): Promise<LoadReturn> {
      return (fn === null ? null : (fn as unknown as LoadReturn));
    },
  };
}


describe("claude-agent-sdk-provider S81-C02", () => {
  test("detectAgentSDKAvailability reports unavailable when loader returns null", async () => {
    const result = await detectAgentSDKAvailability(makeLoader(null));
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not installed/);
  });

  test("detectAgentSDKAvailability prefers subscription when no API key", async () => {
    const result = await detectAgentSDKAvailability(
      makeLoader(makeFakeQuery([])),
      () => false
    );
    expect(result.available).toBe(true);
    expect(result.source).toBe("subscription");
  });

  test("detectAgentSDKAvailability uses api-key source when detector returns true", async () => {
    const result = await detectAgentSDKAvailability(
      makeLoader(makeFakeQuery([])),
      () => true
    );
    expect(result.available).toBe(true);
    expect(result.source).toBe("api-key");
  });

  test("tryCreateClaudeAgentSDKProvider returns null when SDK is missing", async () => {
    const provider = await tryCreateClaudeAgentSDKProvider(
      { provider: "anthropic" },
      { loader: makeLoader(null) }
    );
    expect(provider).toBeNull();
  });

  test("tryCreateClaudeAgentSDKProvider returns provider when SDK loads", async () => {
    const provider = await tryCreateClaudeAgentSDKProvider(
      { provider: "anthropic" },
      {
        loader: makeLoader(makeFakeQuery(["hello"])),
        availability: { available: true, source: "subscription" },
      }
    );
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("claude-agent-sdk");
  });

  test("generate concatenates assistant text blocks from the SDK stream", async () => {
    const events: string[] = [];
    const provider = new ClaudeAgentSDKProvider(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      {
        loader: makeLoader(makeFakeQuery(["part-A", " ", "part-B"])),
        logger: (ev) => events.push(ev),
      }
    );
    const out = await provider.generate("ping");
    expect(out).toBe("part-A part-B");
    // At least one provider-switch log should be emitted once the loader runs.
    expect(events.some((e) => e === "llm.provider.switch")).toBe(true);
  });

  test("generate throws with a fallback-friendly message when SDK is missing", async () => {
    const provider = new ClaudeAgentSDKProvider(
      { provider: "anthropic" },
      { loader: makeLoader(null) }
    );
    await expect(provider.generate("hello")).rejects.toThrow(/fall back to another provider/);
  });

  test("embed refuses to hallucinate vectors — caller must route to embedding registry", async () => {
    const provider = new ClaudeAgentSDKProvider(
      { provider: "anthropic" },
      { loader: makeLoader(makeFakeQuery([])) }
    );
    await expect(provider.embed("x")).rejects.toThrow(/embedding/);
  });

  test("testConnection reports availability reason when SDK is missing", async () => {
    const provider = new ClaudeAgentSDKProvider(
      { provider: "anthropic" },
      { loader: makeLoader(null) }
    );
    const res = await provider.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not installed/);
  });
});
