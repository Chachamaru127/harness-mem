/**
 * @harness-mem/sdk - Team API tests
 *
 * TEAM-006: client.teams namespace のテスト
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

let lastFetchUrl = "";
let lastFetchMethod = "";
let lastFetchBody: unknown = undefined;

function mockFetch(response: MockFetchResult): void {
  (globalThis as Record<string, unknown>).__originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    lastFetchUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    lastFetchMethod = init?.method ?? "GET";
    lastFetchBody = init?.body ? JSON.parse(init.body as string) : undefined;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
  lastFetchUrl = "";
  lastFetchMethod = "";
  lastFetchBody = undefined;
});

describe("HarnessMemClient.teams", () => {
  test("teams.create() - チームを作成し POST /v1/admin/teams を呼ぶ", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [
        {
          team_id: "team_001",
          name: "Engineering",
          description: "Engineering team",
          created_at: "2026-03-04T00:00:00.000Z",
        },
      ],
      meta: {},
    });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.create({ name: "Engineering", description: "Engineering team" });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect((result.items[0] as { team_id: string }).team_id).toBe("team_001");
    expect(lastFetchUrl).toContain("/v1/admin/teams");
    expect(lastFetchMethod).toBe("POST");
    expect((lastFetchBody as { name: string }).name).toBe("Engineering");
  });

  test("teams.list() - チーム一覧を取得し GET /v1/admin/teams を呼ぶ", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [
        { team_id: "team_001", name: "Engineering", created_at: "2026-03-04T00:00:00.000Z" },
        { team_id: "team_002", name: "Design", created_at: "2026-03-04T00:00:00.000Z" },
      ],
      meta: { count: 2 },
    });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.list();

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(lastFetchUrl).toBe("http://localhost:37888/v1/admin/teams");
    expect(lastFetchMethod).toBe("GET");
  });

  test("teams.get() - 特定チームを取得し GET /v1/admin/teams/:id を呼ぶ", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [{ team_id: "team_001", name: "Engineering" }],
      meta: {},
    });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.get("team_001");

    expect(result.ok).toBe(true);
    expect(lastFetchUrl).toContain("/v1/admin/teams/team_001");
    expect(lastFetchMethod).toBe("GET");
  });

  test("teams.update() - チームを更新し PUT /v1/admin/teams/:id を呼ぶ", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [{ team_id: "team_001", name: "Engineering Updated" }],
      meta: {},
    });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.update("team_001", { name: "Engineering Updated" });

    expect(result.ok).toBe(true);
    expect(lastFetchUrl).toContain("/v1/admin/teams/team_001");
    expect(lastFetchMethod).toBe("PUT");
    expect((lastFetchBody as { name: string }).name).toBe("Engineering Updated");
  });

  test("teams.delete() - チームを削除し DELETE /v1/admin/teams/:id を呼ぶ", async () => {
    mockFetch({ ok: true, source: "core", items: [], meta: {} });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.delete("team_001");

    expect(result.ok).toBe(true);
    expect(lastFetchUrl).toContain("/v1/admin/teams/team_001");
    expect(lastFetchMethod).toBe("DELETE");
  });

  test("teams.addMember() - メンバーを追加し POST /v1/admin/teams/:id/members を呼ぶ", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [{ team_id: "team_001", user_id: "user_alice", role: "member" }],
      meta: {},
    });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.addMember("team_001", { user_id: "user_alice", role: "member" });

    expect(result.ok).toBe(true);
    expect(lastFetchUrl).toContain("/v1/admin/teams/team_001/members");
    expect(lastFetchMethod).toBe("POST");
    expect((lastFetchBody as { user_id: string }).user_id).toBe("user_alice");
    expect((lastFetchBody as { role: string }).role).toBe("member");
  });

  test("teams.getMembers() - メンバー一覧を取得し GET /v1/admin/teams/:id/members を呼ぶ", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [
        { team_id: "team_001", user_id: "user_alice", role: "admin" },
        { team_id: "team_001", user_id: "user_bob", role: "member" },
      ],
      meta: { count: 2 },
    });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.getMembers("team_001");

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(lastFetchUrl).toContain("/v1/admin/teams/team_001/members");
    expect(lastFetchMethod).toBe("GET");
  });

  test("teams.updateMemberRole() - ロールを更新し PATCH /v1/admin/teams/:id/members/:userId を呼ぶ", async () => {
    mockFetch({
      ok: true,
      source: "core",
      items: [{ team_id: "team_001", user_id: "user_bob", role: "admin" }],
      meta: {},
    });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.updateMemberRole("team_001", "user_bob", { role: "admin" });

    expect(result.ok).toBe(true);
    expect(lastFetchUrl).toContain("/v1/admin/teams/team_001/members/user_bob");
    expect(lastFetchMethod).toBe("PATCH");
    expect((lastFetchBody as { role: string }).role).toBe("admin");
  });

  test("teams.removeMember() - メンバーを削除し DELETE /v1/admin/teams/:id/members/:userId を呼ぶ", async () => {
    mockFetch({ ok: true, source: "core", items: [], meta: {} });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    const result = await client.teams.removeMember("team_001", "user_bob");

    expect(result.ok).toBe(true);
    expect(lastFetchUrl).toContain("/v1/admin/teams/team_001/members/user_bob");
    expect(lastFetchMethod).toBe("DELETE");
  });

  test("teams.create() - teamId に特殊文字が含まれる場合も URL エンコードされる", async () => {
    mockFetch({ ok: true, source: "core", items: [], meta: {} });

    const client = new HarnessMemClient({ baseUrl: "http://localhost:37888" });
    await client.teams.get("team/with spaces");

    expect(lastFetchUrl).toContain("team%2Fwith%20spaces");
  });
});
