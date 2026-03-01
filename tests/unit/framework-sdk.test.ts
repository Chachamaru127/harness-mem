/**
 * NEXT-009: フレームワーク SDK（Python/TS）のユニットテスト
 *
 * LangChain / LlamaIndex 互換インターフェースを検証する。
 *
 * テスト内容:
 * 1. HarnessMemLangChainMemory が save_context / load_memory_variables を持つ
 * 2. save_context が HarnessMemClient.record を呼び出す
 * 3. load_memory_variables が search 結果を文字列にフォーマットして返す
 * 4. HarnessMemLlamaIndexMemory が put / get インターフェースを持つ
 */
import { describe, expect, test, mock } from "bun:test";
import {
  HarnessMemLangChainMemory,
  HarnessMemLlamaIndexMemory,
} from "../../sdk/src/integrations";

describe("NEXT-009: LangChain 互換メモリインターフェース", () => {
  // テスト1: HarnessMemLangChainMemory が LangChain Memory インターフェースを実装する
  test("HarnessMemLangChainMemory が save_context / load_memory_variables メソッドを持つ", () => {
    const mockClient = {
      record: async () => ({ ok: true, items: [], source: "mock", meta: {} }),
      search: async () => ({ ok: true, items: [], source: "mock", meta: {} }),
    };
    const memory = new HarnessMemLangChainMemory({
      client: mockClient as never,
      project: "test-project",
      session_id: "test-session",
    });
    expect(typeof memory.save_context).toBe("function");
    expect(typeof memory.load_memory_variables).toBe("function");
    expect(typeof memory.clear).toBe("function");
    expect(memory.memory_key).toBe("chat_history");
  });

  // テスト2: save_context が client.record を呼び出す
  test("save_context が HarnessMemClient.record を呼び出す", async () => {
    let recordCalled = false;
    let recordedPayload: Record<string, unknown> = {};

    const mockClient = {
      record: async (input: { payload: Record<string, unknown> }) => {
        recordCalled = true;
        recordedPayload = input.payload;
        return { ok: true, items: [], source: "mock", meta: {} };
      },
      search: async () => ({ ok: true, items: [], source: "mock", meta: {} }),
    };

    const memory = new HarnessMemLangChainMemory({
      client: mockClient as never,
      project: "test-project",
      session_id: "test-session",
    });

    await memory.save_context(
      { input: "TypeScript の質問をした" },
      { output: "TypeScript は静的型付け言語です" }
    );

    expect(recordCalled).toBe(true);
    expect(typeof recordedPayload.content).toBe("string");
    expect(String(recordedPayload.content)).toContain("TypeScript");
  });

  // テスト3: load_memory_variables が検索結果を文字列に変換して返す
  test("load_memory_variables が search 結果をフォーマットして返す", async () => {
    const mockClient = {
      record: async () => ({ ok: true, items: [], source: "mock", meta: {} }),
      search: async () => ({
        ok: true,
        source: "mock",
        meta: {},
        items: [
          { id: "obs-1", content: "TypeScript は静的型付け言語です", title: "TypeScript 回答" },
          { id: "obs-2", content: "Bun は高速なランタイムです", title: "Bun 回答" },
        ],
      }),
    };

    const memory = new HarnessMemLangChainMemory({
      client: mockClient as never,
      project: "test-project",
      session_id: "test-session",
    });

    const result = await memory.load_memory_variables({ input: "TypeScript について" });
    expect(result).toHaveProperty("chat_history");
    expect(typeof result.chat_history).toBe("string");
    expect(result.chat_history).toContain("TypeScript");
  });
});

describe("NEXT-009: LlamaIndex 互換メモリインターフェース", () => {
  // テスト4: HarnessMemLlamaIndexMemory が put / get インターフェースを持つ
  test("HarnessMemLlamaIndexMemory が put / get / getAll メソッドを持つ", async () => {
    let recorded: unknown[] = [];
    let searched = false;

    const mockClient = {
      record: async (input: unknown) => {
        recorded.push(input);
        return { ok: true, items: [], source: "mock", meta: {} };
      },
      search: async () => {
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
      client: mockClient as never,
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
