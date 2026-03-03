/**
 * V5-009: LLM プロバイダー ユニットテスト
 *
 * テストケース:
 * 1. OllamaProvider.generate — 正常レスポンス
 * 2. OllamaProvider.generate — HTTP エラーで例外
 * 3. OllamaProvider.embed — 正常レスポンス (api/embed)
 * 4. OllamaProvider.embed — レガシー api/embeddings フォールバック
 * 5. OllamaProvider.testConnection — Ollama 起動中
 * 6. OllamaProvider.testConnection — 接続失敗
 * 7. OpenAIProvider.generate — 正常レスポンス
 * 8. OpenAIProvider.generate — API キー未設定で例外
 * 9. OpenAIProvider.embed — 正常レスポンス
 * 10. OpenAIProvider.testConnection — API キー未設定
 * 11. Registry: 自動フォールバック (API キーなし → Ollama)
 * 12. Registry: OPENAI_API_KEY があれば OpenAI を選択
 * 13. Registry: HARNESS_MEM_LLM_PROVIDER=ollama で明示指定
 * 14. detectOllamaAvailable — 起動中の場合 true
 * 15. detectOllamaAvailable — 停止中の場合 false
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OllamaProvider } from "../src/llm/ollama-provider";
import { OpenAIProvider } from "../src/llm/openai-provider";
import { createLLMProvider, detectOllamaAvailable } from "../src/llm/registry";

// ---------------------------------------------------------------------------
// fetch モックユーティリティ
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.HARNESS_MEM_LLM_PROVIDER;
  delete process.env.HARNESS_MEM_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.HARNESS_MEM_OLLAMA_HOST;
  delete process.env.HARNESS_MEM_FACT_LLM_MODEL;
});

function mockFetch(handler: (url: string, opts?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    return handler(urlStr, opts);
  };
}

function mockFetchResponse(body: unknown, status = 200) {
  mockFetch(() => new Response(JSON.stringify(body), { status }));
}

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

describe("OllamaProvider", () => {
  test("generate — 正常レスポンスで文字列を返す", async () => {
    const provider = new OllamaProvider({ provider: "ollama", endpoint: "http://localhost:11434" });

    mockFetchResponse({
      message: { content: '{"facts": []}' },
    });

    const result = await provider.generate("テストプロンプト", {
      systemPrompt: "JSON only",
    });
    expect(typeof result).toBe("string");
    expect(result).toBe('{"facts": []}');
  });

  test("generate — HTTP エラーで例外を投げる", async () => {
    const provider = new OllamaProvider({ provider: "ollama", endpoint: "http://localhost:11434" });

    mockFetchResponse({ error: "model not found" }, 404);

    await expect(provider.generate("テスト")).rejects.toThrow("Ollama generate failed: HTTP 404");
  });

  test("embed — /api/embed 正常レスポンス (embeddings 配列)", async () => {
    const provider = new OllamaProvider({ provider: "ollama", endpoint: "http://localhost:11434" });
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4];

    mockFetchResponse({ embeddings: [mockEmbedding] });

    const result = await provider.embed("テストテキスト");
    expect(result).toEqual(mockEmbedding);
  });

  test("embed — レガシー api/embeddings フォールバック (embedding 単体配列)", async () => {
    const provider = new OllamaProvider({ provider: "ollama", endpoint: "http://localhost:11434" });
    const mockEmbedding = [0.5, 0.6, 0.7];

    // レガシー形式: { embedding: [...] }
    mockFetchResponse({ embedding: mockEmbedding });

    const result = await provider.embed("レガシーテスト");
    expect(result).toEqual(mockEmbedding);
  });

  test("testConnection — Ollama 起動中は ok: true を返す", async () => {
    const provider = new OllamaProvider({ provider: "ollama", endpoint: "http://localhost:11434" });

    mockFetchResponse({ models: [] });

    const conn = await provider.testConnection();
    expect(conn.ok).toBe(true);
    expect(conn.message).toContain("available");
  });

  test("testConnection — 接続失敗は ok: false を返す", async () => {
    const provider = new OllamaProvider({ provider: "ollama", endpoint: "http://localhost:11434" });

    mockFetch(() => { throw new Error("ECONNREFUSED"); });

    const conn = await provider.testConnection();
    expect(conn.ok).toBe(false);
    expect(conn.message).toContain("connection failed");
  });
});

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

describe("OpenAIProvider", () => {
  test("generate — API キーあり・正常レスポンスで文字列を返す", async () => {
    const provider = new OpenAIProvider({ provider: "openai", apiKey: "sk-test-key" });

    mockFetchResponse({
      choices: [{ message: { content: '{"result": "ok"}' } }],
    });

    const result = await provider.generate("テストプロンプト");
    expect(result).toBe('{"result": "ok"}');
  });

  test("generate — API キー未設定で例外を投げる", async () => {
    delete process.env.HARNESS_MEM_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIProvider({ provider: "openai", apiKey: "" });

    await expect(provider.generate("テスト")).rejects.toThrow("OpenAI API key is not set");
  });

  test("embed — API キーあり・正常レスポンスで配列を返す", async () => {
    const provider = new OpenAIProvider({ provider: "openai", apiKey: "sk-test-key" });
    const mockEmbedding = [0.1, 0.2, 0.3];

    mockFetchResponse({
      data: [{ embedding: mockEmbedding }],
    });

    const result = await provider.embed("埋め込みテスト");
    expect(result).toEqual(mockEmbedding);
  });

  test("testConnection — API キー未設定は ok: false を返す", async () => {
    const provider = new OpenAIProvider({ provider: "openai", apiKey: "" });
    const conn = await provider.testConnection();
    expect(conn.ok).toBe(false);
    expect(conn.message).toContain("API key is not set");
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("createLLMProvider", () => {
  test("API キーなし → Ollama をデフォルトで返す", () => {
    delete process.env.HARNESS_MEM_LLM_PROVIDER;
    delete process.env.HARNESS_MEM_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const provider = createLLMProvider();
    expect(provider.name).toBe("ollama");
  });

  test("OPENAI_API_KEY あり → OpenAI を選択する", () => {
    delete process.env.HARNESS_MEM_LLM_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-auto-detected";

    const provider = createLLMProvider();
    expect(provider.name).toBe("openai");
  });

  test("HARNESS_MEM_LLM_PROVIDER=ollama で明示指定 → Ollama を返す", () => {
    process.env.OPENAI_API_KEY = "sk-has-key";
    process.env.HARNESS_MEM_LLM_PROVIDER = "ollama";

    // API キーがあっても明示指定が優先される
    const provider = createLLMProvider();
    expect(provider.name).toBe("ollama");
  });

  test("config.provider=openai で明示指定 → OpenAI を返す", () => {
    delete process.env.HARNESS_MEM_LLM_PROVIDER;

    const provider = createLLMProvider({ provider: "openai", apiKey: "sk-explicit" });
    expect(provider.name).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// detectOllamaAvailable
// ---------------------------------------------------------------------------

describe("detectOllamaAvailable", () => {
  test("Ollama 起動中は true を返す", async () => {
    mockFetchResponse({ models: [] });

    const result = await detectOllamaAvailable("http://localhost:11434");
    expect(result).toBe(true);
  });

  test("Ollama 停止中 (接続エラー) は false を返す", async () => {
    mockFetch(() => { throw new Error("ECONNREFUSED"); });

    const result = await detectOllamaAvailable("http://localhost:11434");
    expect(result).toBe(false);
  });
});
