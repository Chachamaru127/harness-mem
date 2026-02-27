/**
 * IMP-007: VS Code 拡張 - HTTP クライアント単体テスト
 *
 * HarnessMemApiClient の fetch ベース HTTP ロジックをテストする。
 * VS Code API には依存しないため、bun test で実行可能。
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { HarnessMemApiClient } from "../src/client";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetchOk(body: object, status = 200): void {
  globalThis.fetch = async (): Promise<Response> =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

function mockFetchAbort(): void {
  globalThis.fetch = async (): Promise<Response> => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  };
}

function mockFetchNetworkError(): void {
  globalThis.fetch = async (): Promise<Response> => {
    throw new TypeError("Failed to fetch");
  };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ---------------------------------------------------------------------------
// search()
// ---------------------------------------------------------------------------
describe("HarnessMemApiClient.search()", () => {
  it("正常レスポンスを返す", async () => {
    const payload = {
      ok: true,
      items: [{ id: "obs_1", content: "test content", title: "Test" }],
      meta: {},
    };
    mockFetchOk(payload);

    const client = new HarnessMemApiClient("http://localhost:37888");
    const result = await client.search({ query: "test", limit: 5 });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("obs_1");
  });

  it("空の結果セットを正しく処理する", async () => {
    mockFetchOk({ ok: true, items: [], meta: {} });

    const client = new HarnessMemApiClient("http://localhost:37888");
    const result = await client.search({ query: "nothing" });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  it("サーバーエラーレスポンスを返す", async () => {
    mockFetchOk({ ok: false, items: [], meta: {}, error: "Internal error" });

    const client = new HarnessMemApiClient("http://localhost:37888");
    const result = await client.search({ query: "test" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Internal error");
  });
});

// ---------------------------------------------------------------------------
// timeline()
// ---------------------------------------------------------------------------
describe("HarnessMemApiClient.timeline()", () => {
  it("タイムラインアイテムを返す", async () => {
    const payload = {
      ok: true,
      items: [
        { id: "obs_1", content: "before", created_at: "2026-01-01" },
        { id: "obs_2", content: "current", created_at: "2026-01-02" },
        { id: "obs_3", content: "after", created_at: "2026-01-03" },
      ],
      meta: {},
    };
    mockFetchOk(payload);

    const client = new HarnessMemApiClient("http://localhost:37888");
    const result = await client.timeline({ id: "obs_2", before: 1, after: 1 });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.items[1].id).toBe("obs_2");
  });

  it("エラー応答を正しく処理する", async () => {
    mockFetchOk({ ok: false, items: [], meta: {}, error: "Not found" });

    const client = new HarnessMemApiClient("http://localhost:37888");
    const result = await client.timeline({ id: "obs_unknown" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Not found");
  });
});

// ---------------------------------------------------------------------------
// health()
// ---------------------------------------------------------------------------
describe("HarnessMemApiClient.health()", () => {
  it("ヘルスチェックが成功する", async () => {
    mockFetchOk({ ok: true, items: [], meta: { status: "healthy" } });

    const client = new HarnessMemApiClient("http://localhost:37888");
    const result = await client.health();

    expect(result.ok).toBe(true);
  });

  it("サーバー停止時はエラーを返す", async () => {
    mockFetchNetworkError();

    const client = new HarnessMemApiClient("http://localhost:37888");
    const result = await client.health();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("fetch");
  });
});

// ---------------------------------------------------------------------------
// タイムアウト
// ---------------------------------------------------------------------------
describe("HarnessMemApiClient タイムアウト", () => {
  it("AbortError をタイムアウトメッセージに変換する", async () => {
    mockFetchAbort();

    const client = new HarnessMemApiClient("http://localhost:37888", 100);
    const result = await client.search({ query: "test" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });
});

// ---------------------------------------------------------------------------
// リクエスト構造
// ---------------------------------------------------------------------------
describe("HarnessMemApiClient リクエスト構造", () => {
  it("search() は正しいパスとボディでリクエストを送信する", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input);
      capturedBody = (init?.body as string) || "";
      return new Response(JSON.stringify({ ok: true, items: [], meta: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = new HarnessMemApiClient("http://localhost:37888");
    await client.search({ query: "memory test", project: "my-project", limit: 10 });

    expect(capturedUrl).toBe("http://localhost:37888/v1/search");
    const body = JSON.parse(capturedBody);
    expect(body.query).toBe("memory test");
    expect(body.project).toBe("my-project");
    expect(body.limit).toBe(10);
  });

  it("timeline() は正しいパスでリクエストを送信する", async () => {
    let capturedUrl = "";

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ ok: true, items: [], meta: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = new HarnessMemApiClient("http://localhost:37888");
    await client.timeline({ id: "obs_abc", before: 3, after: 3 });

    expect(capturedUrl).toBe("http://localhost:37888/v1/timeline");
  });
});
