/**
 * TEAM-003: Team CRUD エンドポイント テスト
 *
 * startHarnessMemServer を起動し、HTTP 経由で 5本のエンドポイントを検証する。
 *   POST   /v1/admin/teams        - チーム作成
 *   GET    /v1/admin/teams        - チーム一覧
 *   GET    /v1/admin/teams/:id    - チーム詳細
 *   PUT    /v1/admin/teams/:id    - チーム更新
 *   DELETE /v1/admin/teams/:id    - チーム削除
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

interface Runtime {
  baseUrl: string;
  stop: () => void;
}

function createRuntime(name: string): Runtime {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-team-crud-${name}-`));
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

async function adminPost(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // HARNESS_MEM_ADMIN_TOKEN 未設定時はローカルホストから全許可
    },
    body: JSON.stringify(body),
  });
}

async function adminGet(baseUrl: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: "GET" });
}

async function adminPut(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function adminDelete(baseUrl: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("TEAM-003: Team CRUD API", () => {
  let runtime: Runtime;

  beforeEach(() => {
    runtime = createRuntime("test");
  });

  afterEach(() => {
    runtime.stop();
  });

  test("POST /v1/admin/teams — チーム作成が成功する", async () => {
    const res = await adminPost(runtime.baseUrl, "/v1/admin/teams", {
      team_id: "team-create-001",
      name: "Engineering",
      description: "Engineering team",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].team_id).toBe("team-create-001");
    expect(items[0].name).toBe("Engineering");
    expect(items[0].description).toBe("Engineering team");
  });

  test("GET /v1/admin/teams — チーム一覧が取得できる", async () => {
    // 事前にチームを2件作成
    await adminPost(runtime.baseUrl, "/v1/admin/teams", { team_id: "team-list-001", name: "Team A" });
    await adminPost(runtime.baseUrl, "/v1/admin/teams", { team_id: "team-list-002", name: "Team B" });

    const res = await adminGet(runtime.baseUrl, "/v1/admin/teams");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(2);
    const ids = items.map((t) => t.team_id);
    expect(ids).toContain("team-list-001");
    expect(ids).toContain("team-list-002");
  });

  test("GET /v1/admin/teams/:id — 個別チームが取得できる", async () => {
    await adminPost(runtime.baseUrl, "/v1/admin/teams", {
      team_id: "team-get-001",
      name: "Marketing",
      description: "Marketing team",
    });

    const res = await adminGet(runtime.baseUrl, "/v1/admin/teams/team-get-001");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].team_id).toBe("team-get-001");
    expect(items[0].name).toBe("Marketing");
  });

  test("PUT /v1/admin/teams/:id — チーム情報が更新できる", async () => {
    await adminPost(runtime.baseUrl, "/v1/admin/teams", {
      team_id: "team-update-001",
      name: "OldName",
    });

    const res = await adminPut(runtime.baseUrl, "/v1/admin/teams/team-update-001", {
      name: "NewName",
      description: "Updated description",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("NewName");
    expect(items[0].description).toBe("Updated description");
  });

  test("DELETE /v1/admin/teams/:id — チームが削除できる", async () => {
    await adminPost(runtime.baseUrl, "/v1/admin/teams", {
      team_id: "team-delete-001",
      name: "ToDelete",
    });

    const res = await adminDelete(runtime.baseUrl, "/v1/admin/teams/team-delete-001");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);

    // 削除後は 404 が返る
    const getRes = await adminGet(runtime.baseUrl, "/v1/admin/teams/team-delete-001");
    expect(getRes.status).toBe(404);
  });
});
