/**
 * NEXT-009: フレームワーク SDK（Python/TS）のユニットテスト
 *
 * LangChain / LlamaIndex 互換インターフェースを検証する。
 *
 * テスト内容:
 * 1. HarnessMemLangChainMemory が saveContext / loadMemoryVariables を持つ
 * 2. HarnessMemLlamaIndexMemory が put / get インターフェースを持つ
 * 3. HarnessMemClientLike 型互換性 — satisfies コンパイル時検証
 */
import { describe, expect, test } from "bun:test";
import {
  HarnessMemLlamaIndexMemory,
  type HarnessMemClientLike,
} from "../../sdk/src/integrations";
import { HarnessMemLangChainMemory } from "../../sdk/src/langchain-memory";
import type { RecordEventInput, SearchInput, ApiResponse, SearchResultItem } from "../../sdk/src/types";

describe("NEXT-009: LangChain 互換メモリインターフェース", () => {
  // テスト1: HarnessMemLangChainMemory が LangChain Memory インターフェースを実装する
  test("HarnessMemLangChainMemory が saveContext / loadMemoryVariables メソッドを持つ", () => {
    const memory = new HarnessMemLangChainMemory({
      baseUrl: "http://localhost:0",
      project: "test-project",
      session_id: "test-session",
    });
    expect(typeof memory.saveContext).toBe("function");
    expect(typeof memory.loadMemoryVariables).toBe("function");
    expect(typeof memory.clear).toBe("function");
    expect(memory.memoryVariables).toEqual(["history"]);
  });

  // テスト2: カスタム memoryKey が反映される
  test("カスタム memoryKey が memoryVariables に反映される", () => {
    const memory = new HarnessMemLangChainMemory({
      baseUrl: "http://localhost:0",
      project: "test-project",
      session_id: "test-session",
      memoryKey: "chat_history",
    });
    expect(memory.memoryVariables).toEqual(["chat_history"]);
  });

  // テスト3: clear が no-op で正常終了する
  test("clear が no-op で正常終了する", async () => {
    const memory = new HarnessMemLangChainMemory({
      baseUrl: "http://localhost:0",
      project: "test-project",
      session_id: "test-session",
    });
    await expect(memory.clear()).resolves.toBeUndefined();
  });
});

describe("NEXT-009: LlamaIndex 互換メモリインターフェース", () => {
  // テスト4: HarnessMemLlamaIndexMemory が put / get インターフェースを持つ
  test("HarnessMemLlamaIndexMemory が put / get / getAll メソッドを持つ", async () => {
    let recorded: unknown[] = [];
    let searched = false;

    const mockClient: HarnessMemClientLike = {
      record: async (input: RecordEventInput): Promise<ApiResponse<unknown>> => {
        recorded.push(input);
        return { ok: true, items: [], source: "mock", meta: {} };
      },
      search: async (_input: SearchInput): Promise<ApiResponse<SearchResultItem>> => {
        searched = true;
        return {
          ok: true,
          source: "mock",
          meta: {},
          items: [{ id: "obs-1", content: "テストメモリ", title: "メモリタイトル" }],
        };
      },
    };

    const memory = new HarnessMemLlamaIndexMemory({
      client: mockClient,
      project: "llama-project",
      session_id: "llama-session",
    });

    expect(typeof memory.put).toBe("function");
    expect(typeof memory.get).toBe("function");
    expect(typeof memory.getAll).toBe("function");

    // put が record を呼び出すことを確認
    await memory.put({ role: "user", content: "こんにちは" });
    expect(recorded.length).toBeGreaterThan(0);

    // get が search を呼び出すことを確認
    const results = await memory.get("こんにちは");
    expect(searched).toBe(true);
    expect(Array.isArray(results)).toBe(true);
  });
});

describe("NEXT-009: HarnessMemClientLike 型互換性検証", () => {
  // テスト5: satisfies によるコンパイル時型互換性検証（LangChain 用モック）
  test("LangChain 用モックが HarnessMemClientLike を satisfies で満たす", () => {
    const mockClient = {
      record: async (_input: RecordEventInput): Promise<ApiResponse<unknown>> =>
        ({ ok: true as const, items: [], source: "mock", meta: {} }),
      search: async (_input: SearchInput): Promise<ApiResponse<SearchResultItem>> =>
        ({ ok: true as const, items: [], source: "mock", meta: {} }),
    } satisfies HarnessMemClientLike;

    expect(typeof mockClient.record).toBe("function");
    expect(typeof mockClient.search).toBe("function");
  });

  // テスト6: satisfies によるコンパイル時型互換性検証（LlamaIndex 用モック）
  test("LlamaIndex 用モックが HarnessMemClientLike を satisfies で満たす", () => {
    const llamaMockClient = {
      record: async (_input: RecordEventInput): Promise<ApiResponse<unknown>> =>
        ({ ok: true as const, items: [], source: "llamaindex-mock", meta: {} }),
      search: async (_input: SearchInput): Promise<ApiResponse<SearchResultItem>> =>
        ({ ok: true as const, items: [], source: "llamaindex-mock", meta: {} }),
    } satisfies HarnessMemClientLike;

    expect(typeof llamaMockClient.record).toBe("function");
    expect(typeof llamaMockClient.search).toBe("function");
  });
});
