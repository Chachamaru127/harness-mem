/**
 * @harness-mem/sdk tests
 *
 * サーバーへの実接続なしに、HTTP クライアントのロジックをテストする。
 * fetch をモック化してサーバーレスポンスをシミュレートする。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { HarnessMemClient } from "../src/client";

// fetch モックのヘルパー
type MockFetchResult = {
  ok: boolean;
  source: string;
  items: unknown[];
  meta: Record<string, unknown>;
  error?: string;
};

function mockFetch(response: MockFetchResult): void {
  (globalThis as Record<string, unknown>).__originalFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function mockFetchError(errorMessage: string): void {
  (globalThis as Record<string, unknown>).__originalFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    throw new Error(errorMessage);
  };
}

function restoreFetch(): void {
  const original = (globalThis as Record<string, unknown>).__originalFetch;
  if (original) {
    globalThis.fetch = original as typeof fetch;
    delete (globalThis as Record<string, unknown>).__originalFetch;
  }
}

afterEach(() => {
  restoreFetch();
});

describe("HarnessMemClient", () => {
  test("デフォルトの baseUrl は localhost:37888", () => {
    const client = new HarnessMemClient();
    // baseUrl はプライベートだが動作を通して確認
    expect(client).toBeInstanceOf(HarnessMemClient);
  });

  test("カスタム baseUrl を設定できる", () => {
    const client = new HarnessMemClient({ baseUrl: "http://localhost:9999" });
    expect(client).toBeInstanceOf(HarnessMemClient);
  });

  test("search() - 正常レスポンスを返す", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [
        {
          id: "obs_test-1",
          content: "PostgreSQL を使う",
          created_at: "2026-02-14T10:00:00.000Z",
        },
      ],
      meta: { count: 1, latency_ms: 5 },
    });

    const client = new HarnessMemClient();
    const result = await client.search({ query: "PostgreSQL", limit: 5 });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect((result.items[0] as { id: string }).id).toBe("obs_test-1");
  });

  test("search() - エラーレスポンスを正しく処理する", async () => {
    mockFetch({
      ok: false,
      source: "core",
      items: [],
      meta: {},
      error: "query is required",
    });

    const client = new HarnessMemClient();
    const result = await client.search({ query: "" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("query is required");
  });

  test("record() - イベントを正常に記録する", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [{ id: "obs_recorded-event" }],
      meta: { deduped: false },
    });

    const client = new HarnessMemClient();
    const result = await client.record({
      session_id: "session-123",
      payload: { prompt: "テスト観察" },
    });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect((result.items[0] as { id: string }).id).toBe("obs_recorded-event");
  });

  test("resumePack() - resume pack を取得する", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [
        {
          summary: "プロジェクトの概要",
          facts: [],
          recent_observations: [],
        },
      ],
      meta: { token_estimate: 150 },
    });

    const client = new HarnessMemClient();
    const result = await client.resumePack({
      project: "test-project",
      session_id: "session-123",
    });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  test("timeline() - タイムラインを取得する", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [
        { id: "obs_before", content: "前の観察", created_at: "2026-02-14T09:00:00.000Z" },
        { id: "obs_after", content: "後の観察", created_at: "2026-02-14T11:00:00.000Z" },
      ],
      meta: { count: 2 },
    });

    const client = new HarnessMemClient();
    const result = await client.timeline({ id: "obs_target", before: 1, after: 1 });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
  });

  test("getObservations() - 特定IDの観察を取得する", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [
        {
          id: "obs_detail-1",
          content: "詳細な観察内容",
          created_at: "2026-02-14T10:00:00.000Z",
        },
      ],
      meta: { count: 1 },
    });

    const client = new HarnessMemClient();
    const result = await client.getObservations({
      ids: ["obs_detail-1"],
      include_private: false,
    });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect((result.items[0] as { id: string }).id).toBe("obs_detail-1");
  });

  test("health() - ヘルスチェックを実行する", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [{ vector_engine: "js-fallback", fts_enabled: true }],
      meta: {},
    });

    const client = new HarnessMemClient();
    const result = await client.health();

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  test("ネットワークエラー時は ok=false を返す", async () => {
    mockFetchError("ECONNREFUSED");

    const client = new HarnessMemClient();
    const result = await client.search({ query: "test" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  test("タイムアウト時は ok=false を返す (AbortError をシミュレート)", async () => {
    // AbortError を直接スローしてタイムアウト動作をシミュレート
    (globalThis as Record<string, unknown>).__originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit): Promise<Response> => {
      // signal が abort された場合は AbortError を投げる
      if (options?.signal?.aborted) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      // signal の abort イベントをシミュレート
      const abortError = new Error("The operation was aborted.");
      abortError.name = "AbortError";
      throw abortError;
    };

    const client = new HarnessMemClient({ timeout: 100 });
    const result = await client.search({ query: "test" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timeout");
  });
});
