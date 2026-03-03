/**
 * NEXT-009: フレームワーク SDK - LangChain Memory 互換レイヤーのテスト
 *
 * HarnessMemLangChainMemory が LangChain BaseMemory に相当するインターフェース
 * (saveContext / loadMemoryVariables / clear) を正しく実装することを検証する。
 */
import { afterEach, describe, expect, test } from "bun:test";
import { HarnessMemLangChainMemory } from "../src/langchain-memory";

// fetch モックヘルパー
function mockFetch(response: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>).__origFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function restoreFetch(): void {
  const orig = (globalThis as Record<string, unknown>).__origFetch;
  if (orig) {
    globalThis.fetch = orig as typeof fetch;
    delete (globalThis as Record<string, unknown>).__origFetch;
  }
}

afterEach(() => {
  restoreFetch();
});

describe("HarnessMemLangChainMemory", () => {
  test("インスタンスを生成できる", () => {
    const mem = new HarnessMemLangChainMemory({
      project: "test-project",
      session_id: "session-001",
    });
    expect(mem).toBeInstanceOf(HarnessMemLangChainMemory);
  });

  test("memoryVariables が 'history' キーを返す", () => {
    const mem = new HarnessMemLangChainMemory({
      project: "test-project",
      session_id: "session-001",
    });
    expect(mem.memoryVariables).toContain("history");
  });

  test("saveContext() が harness-mem にイベントを記録する", async () => {
    mockFetch({ ok: true, source: "core", items: [{ id: "obs_001" }], meta: {} });
    const fetchCalls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      fetchCalls.push(url.toString());
      return origFetch(url, init);
    };

    const mem = new HarnessMemLangChainMemory({
      project: "test-project",
      session_id: "session-001",
    });

    await mem.saveContext(
      { input: "TypeScript の採用を検討している" },
      { output: "TypeScript は型安全性が高く、大規模開発に向いています" }
    );

    // イベント記録のエンドポイントが呼ばれたことを確認
    expect(fetchCalls.some((url) => url.includes("/v1/events/record") || url.includes("/v1/checkpoints"))).toBe(true);
  });

  test("loadMemoryVariables() がハーネスから検索結果を返す", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [
        { id: "obs_001", content: "TypeScript を採用することを決定した", created_at: "2026-01-01T00:00:00Z" },
        { id: "obs_002", content: "型定義のベストプラクティスを学んだ", created_at: "2026-01-02T00:00:00Z" },
      ],
      meta: { count: 2 },
    });

    const mem = new HarnessMemLangChainMemory({
      project: "test-project",
      session_id: "session-001",
    });

    const variables = await mem.loadMemoryVariables({ input: "TypeScript について教えて" });

    expect(variables).toHaveProperty("history");
    expect(typeof variables["history"]).toBe("string");
    expect(variables["history"]).toContain("TypeScript");
  });

  test("loadMemoryVariables() - 検索結果なしの場合は空文字を返す", async () => {
    mockFetch({ ok: true, source: "core", items: [], meta: { count: 0 } });

    const mem = new HarnessMemLangChainMemory({
      project: "test-project",
      session_id: "session-001",
    });

    const variables = await mem.loadMemoryVariables({ input: "全く関係ない質問" });

    expect(variables).toHaveProperty("history");
    expect(variables["history"]).toBe("");
  });

  test("clear() を呼んでもエラーにならない", async () => {
    const mem = new HarnessMemLangChainMemory({
      project: "test-project",
      session_id: "session-001",
    });
    // clear() は no-op（harness-mem はサーバー側で管理するため）
    await expect(mem.clear()).resolves.toBeUndefined();
  });
});
