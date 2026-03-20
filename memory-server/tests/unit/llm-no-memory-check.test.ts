/**
 * S58-009: LLM 不在判定のユニットテスト
 *
 * 実際の LLM API は呼び出さず、fetch をモックして動作を検証する。
 */
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { llmNoMemoryCheck, buildLlmRerankerConfigFromEnv } from "../../src/rerank/llm-reranker";

// ---------------------------------------------------------------------------
// サンプルデータ
// ---------------------------------------------------------------------------

const sampleCandidate = {
  title: "パーサーの決定",
  content: "新しいパーサー戦略を採用した",
  score: 0.05, // 閾値 0.1 以下
};

const sampleQuery = "パーサー戦略について教えて";

// ---------------------------------------------------------------------------
// fetch モックヘルパー
// ---------------------------------------------------------------------------

function mockFetchOpenAI(responseText: string) {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: responseText } }],
        }),
      text: () => Promise.resolve(responseText),
    } as unknown as Response)
  );
}

function mockFetchAnthropic(responseText: string) {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: responseText }],
        }),
      text: () => Promise.resolve(responseText),
    } as unknown as Response)
  );
}

function mockFetchError(error: Error) {
  globalThis.fetch = mock(() => Promise.reject(error));
}

function mockFetchApiError(status: number) {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: false,
      status,
      text: () => Promise.resolve("API Error"),
    } as unknown as Response)
  );
}

// ---------------------------------------------------------------------------
// llmNoMemoryCheck — OpenAI
// ---------------------------------------------------------------------------

describe("llmNoMemoryCheck (OpenAI)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("LLM が Yes と回答した場合 has_memory: true を返す", async () => {
    mockFetchOpenAI("Yes");
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "openai",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(true);
  });

  test("LLM が yes（小文字）と回答した場合 has_memory: true を返す", async () => {
    mockFetchOpenAI("yes");
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "openai",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(true);
  });

  test("LLM が No と回答した場合 has_memory: false を返す", async () => {
    mockFetchOpenAI("No");
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "openai",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(false);
  });

  test("LLM が no（小文字）と回答した場合 has_memory: false を返す", async () => {
    mockFetchOpenAI("no");
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "openai",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(false);
  });

  test("API エラー時は has_memory: false を返す（graceful degradation）", async () => {
    mockFetchApiError(500);
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "openai",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(false);
  });

  test("fetch 例外時は has_memory: false を返す（graceful degradation）", async () => {
    mockFetchError(new Error("network error"));
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "openai",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// llmNoMemoryCheck — Anthropic
// ---------------------------------------------------------------------------

describe("llmNoMemoryCheck (Anthropic)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("Anthropic: LLM が Yes と回答した場合 has_memory: true を返す", async () => {
    mockFetchAnthropic("Yes");
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "anthropic",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(true);
  });

  test("Anthropic: LLM が No と回答した場合 has_memory: false を返す", async () => {
    mockFetchAnthropic("No");
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "anthropic",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(false);
  });

  test("Anthropic: API エラー時は has_memory: false を返す", async () => {
    mockFetchApiError(429);
    const result = await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "anthropic",
      apiKey: "test-key",
    });
    expect(result.has_memory).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildLlmRerankerConfigFromEnv — LLM 無効時の確認
// ---------------------------------------------------------------------------

describe("buildLlmRerankerConfigFromEnv — LLM 無効時", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      HARNESS_MEM_LLM_ENHANCE: process.env.HARNESS_MEM_LLM_ENHANCE,
    };
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  test("HARNESS_MEM_LLM_ENHANCE 未設定時は enabled: false", () => {
    delete process.env.HARNESS_MEM_LLM_ENHANCE;
    const config = buildLlmRerankerConfigFromEnv();
    expect(config.enabled).toBe(false);
  });

  test("HARNESS_MEM_LLM_ENHANCE=false 時は enabled: false", () => {
    process.env.HARNESS_MEM_LLM_ENHANCE = "false";
    const config = buildLlmRerankerConfigFromEnv();
    expect(config.enabled).toBe(false);
  });

  test("HARNESS_MEM_LLM_ENHANCE=true 時は enabled: true", () => {
    process.env.HARNESS_MEM_LLM_ENHANCE = "true";
    const config = buildLlmRerankerConfigFromEnv();
    expect(config.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// llmNoMemoryCheck — モデル指定
// ---------------------------------------------------------------------------

describe("llmNoMemoryCheck — モデル指定", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedBody: Record<string, unknown>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("モデル未指定時は openai でデフォルト gpt-4o-mini を使用する", async () => {
    globalThis.fetch = mock((_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "Yes" } }],
          }),
        text: () => Promise.resolve("Yes"),
      } as unknown as Response);
    });

    await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "openai",
      apiKey: "test-key",
    });
    expect(capturedBody.model).toBe("gpt-4o-mini");
  });

  test("モデル指定時はそのモデルを使用する", async () => {
    globalThis.fetch = mock((_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "Yes" } }],
          }),
        text: () => Promise.resolve("Yes"),
      } as unknown as Response);
    });

    await llmNoMemoryCheck(sampleQuery, sampleCandidate, {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
    });
    expect(capturedBody.model).toBe("gpt-4o");
  });
});
