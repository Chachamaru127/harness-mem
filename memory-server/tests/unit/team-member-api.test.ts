/**
 * TEAM-004: メンバー管理エンドポイント テスト
 *
 * POST   /v1/admin/teams/:id/members — メンバー追加
 * GET    /v1/admin/teams/:id/members — メンバー一覧取得
 * PATCH  /v1/admin/teams/:id/members/:userId — メンバーロール更新
 * DELETE /v1/admin/teams/:id/members/:userId — メンバー削除
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(): {
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-team-member-api-"));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };

  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const ADMIN_TOKEN = "team-member-api-test-token";

function adminHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "authorization": `Bearer ${ADMIN_TOKEN}`,
  };
}

async function createTeam(baseUrl: string, teamId: string): Promise<void> {
  await fetch(`${baseUrl}/v1/admin/teams`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ team_id: teamId, name: `Team ${teamId}` }),
  });
}

let runtime: ReturnType<typeof createRuntime>;

beforeEach(() => {
  process.env.HARNESS_MEM_ADMIN_TOKEN = ADMIN_TOKEN;
  runtime = createRuntime();
});

afterEach(() => {
  runtime.stop();
  delete process.env.HARNESS_MEM_ADMIN_TOKEN;
});

describe("TEAM-004: POST /v1/admin/teams/:id/members — メンバー追加", () => {
  test("メンバー追加が成功し 201 を返す", async () => {
    const teamId = "team-add-member";
    await createTeam(runtime.baseUrl, teamId);

    const res = await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ user_id: "user-001", role: "member" }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; items: Array<{ team_id: string; user_id: string; role: string }> };
    expect(json.ok).toBe(true);
    expect(json.items[0].team_id).toBe(teamId);
    expect(json.items[0].user_id).toBe("user-001");
    expect(json.items[0].role).toBe("member");
  });
});

describe("TEAM-004: GET /v1/admin/teams/:id/members — メンバー一覧取得", () => {
  test("メンバー一覧が取得できる", async () => {
    const teamId = "team-list-members";
    await createTeam(runtime.baseUrl, teamId);

    // メンバー追加
    await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ user_id: "user-a", role: "admin" }),
    });
    await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ user_id: "user-b", role: "member" }),
    });

    const res = await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members`, {
      method: "GET",
      headers: adminHeaders(),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; items: Array<{ user_id: string }> };
    expect(json.ok).toBe(true);
    expect(json.items).toHaveLength(2);
    const userIds = json.items.map((m) => m.user_id);
    expect(userIds).toContain("user-a");
    expect(userIds).toContain("user-b");
  });
});

describe("TEAM-004: PATCH /v1/admin/teams/:id/members/:userId — メンバーロール更新", () => {
  test("メンバーロールが更新できる", async () => {
    const teamId = "team-update-role";
    await createTeam(runtime.baseUrl, teamId);

    await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ user_id: "user-role", role: "member" }),
    });

    const res = await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members/user-role`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ role: "admin" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; items: Array<{ user_id: string; role: string }> };
    expect(json.ok).toBe(true);
    expect(json.items[0].user_id).toBe("user-role");
    expect(json.items[0].role).toBe("admin");
  });
});

describe("TEAM-004: DELETE /v1/admin/teams/:id/members/:userId — メンバー削除", () => {
  test("メンバーが削除できる", async () => {
    const teamId = "team-remove-member";
    await createTeam(runtime.baseUrl, teamId);

    await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ user_id: "user-del", role: "member" }),
    });

    const res = await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members/user-del`, {
      method: "DELETE",
      headers: adminHeaders(),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; items: Array<{ user_id: string; removed: boolean }> };
    expect(json.ok).toBe(true);
    expect(json.items[0].user_id).toBe("user-del");
    expect(json.items[0].removed).toBe(true);

    // 削除後はメンバー一覧に含まれない
    const listRes = await fetch(`${runtime.baseUrl}/v1/admin/teams/${teamId}/members`, {
      method: "GET",
      headers: adminHeaders(),
    });
    const listJson = await listRes.json() as { items: Array<{ user_id: string }> };
    expect(listJson.items.find((m) => m.user_id === "user-del")).toBeUndefined();
  });
});
