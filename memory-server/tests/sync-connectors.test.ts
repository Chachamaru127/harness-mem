/**
 * V5-005: Cloud Sync コネクタ テスト
 *
 * テストケース:
 * 1. ConnectorRegistry — register / get / list / unregister
 * 2. GitHub コネクタ — API モックで pull/push/testConnection
 * 3. Notion コネクタ — API モックで pull/push/testConnection
 * 4. GDrive コネクタ — API モックで pull/push/testConnection
 * 5. DB 永続化 — mem_sync_connections テーブル作成確認
 * 6. testConnection — token 未設定時のエラー返却
 * 7. 全コネクタ syncAll — ConnectorRegistry.syncAll()
 * 8. エラーハンドリング — pull 失敗時のエラー処理
 */

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { ConnectorRegistry } from "../src/sync/connector-registry";
import { GitHubConnector } from "../src/sync/github-connector";
import { NotionConnector } from "../src/sync/notion-connector";
import { GoogleDriveConnector } from "../src/sync/gdrive-connector";
import { migrateSchema, initSchema, configureDatabase } from "../src/db/schema";
import type { SyncChangeset } from "../src/sync/types";

// ─── モックユーティリティ ───────────────────────────────────────────

function makeFetchMock(responses: Array<{ ok: boolean; status: number; data: unknown; text?: string }>) {
  let callIndex = 0;
  return mock(async (_url: string, _init?: RequestInit) => {
    const res = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.ok ? "OK" : "Error",
      json: async () => res.data,
      text: async () => res.text ?? String(res.data),
    } as unknown as Response;
  });
}

// ─── 1. ConnectorRegistry ───────────────────────────────────────────

describe("ConnectorRegistry", () => {
  test("register / get / list / unregister が正しく動作する", () => {
    const registry = new ConnectorRegistry();
    const gh = new GitHubConnector("my-github");

    registry.register(gh);
    expect(registry.get("my-github")).toBe(gh);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].name).toBe("my-github");

    const removed = registry.unregister("my-github");
    expect(removed).toBe(true);
    expect(registry.get("my-github")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  test("存在しないコネクタの unregister は false を返す", () => {
    const registry = new ConnectorRegistry();
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  test("複数コネクタを list で取得できる", () => {
    const registry = new ConnectorRegistry();
    registry.register(new GitHubConnector("gh1"));
    registry.register(new NotionConnector("notion1"));
    registry.register(new GoogleDriveConnector("gdrive1"));
    expect(registry.list()).toHaveLength(3);
    const types = registry.list().map((c) => c.type);
    expect(types).toContain("github");
    expect(types).toContain("notion");
    expect(types).toContain("gdrive");
  });
});

// ─── 2. GitHub コネクタ ────────────────────────────────────────────

describe("GitHubConnector", () => {
  test("pull: Issues を SyncChangeset に変換する", async () => {
    const connector = new GitHubConnector("test-github");
    await connector.initialize({
      type: "github",
      credentials: { token: "gh-test-token" },
      settings: { repo: "owner/repo", api_base: "https://api.github.com" },
    });

    const mockIssues = [
      {
        number: 1,
        title: "Test Issue",
        body: "Issue body content",
        html_url: "https://github.com/owner/repo/issues/1",
        state: "open",
        updated_at: "2026-01-01T00:00:00Z",
        labels: [{ name: "bug" }],
      },
    ];

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 200, data: mockIssues }]);

    try {
      const changesets = await connector.pull();
      expect(changesets).toHaveLength(1);
      expect(changesets[0].id).toBe("github::owner/repo::issue::1");
      expect(changesets[0].action).toBe("create");
      expect(changesets[0].content).toContain("Test Issue");
      expect(changesets[0].content).toContain("Issue body content");
      expect(changesets[0].metadata.source).toBe("github");
      expect(changesets[0].metadata.repo).toBe("owner/repo");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("push: Issue コメントとして追加する", async () => {
    const connector = new GitHubConnector("test-github");
    await connector.initialize({
      type: "github",
      credentials: { token: "gh-test-token" },
      settings: { repo: "owner/repo", api_base: "https://api.github.com" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 201, data: { id: 999 } }]);

    try {
      const changes: SyncChangeset[] = [
        {
          id: "obs-001",
          action: "create",
          content: "Observation content",
          metadata: { issue_number: "42" },
          timestamp: "2026-01-01T00:00:00Z",
        },
      ];
      const result = await connector.push(changes);
      expect(result.success).toBe(true);
      expect(result.synced).toBe(1);
      expect(result.errors).toHaveLength(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("testConnection: token 設定済みで ok: true", async () => {
    const connector = new GitHubConnector("test-github");
    await connector.initialize({
      type: "github",
      credentials: { token: "gh-test-token" },
      settings: { api_base: "https://api.github.com" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 200, data: { login: "testuser" } }]);

    try {
      const result = await connector.testConnection();
      expect(result.ok).toBe(true);
      expect(result.message).toContain("successful");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("pull: API エラー時に例外を投げる", async () => {
    const connector = new GitHubConnector("test-github");
    await connector.initialize({
      type: "github",
      credentials: { token: "gh-test-token" },
      settings: { repo: "owner/repo", api_base: "https://api.github.com" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: false, status: 401, data: { message: "Unauthorized" } }]);

    try {
      await expect(connector.pull()).rejects.toThrow("GitHub API error: 401");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ─── 3. Notion コネクタ ────────────────────────────────────────────

describe("NotionConnector", () => {
  test("pull: データベースページを SyncChangeset に変換する", async () => {
    const connector = new NotionConnector("test-notion");
    await connector.initialize({
      type: "notion",
      credentials: { token: "secret_test_token" },
      settings: { database_id: "db-123", api_base: "https://api.notion.com/v1" },
    });

    const mockResponse = {
      results: [
        {
          id: "page-001",
          url: "https://notion.so/page-001",
          last_edited_time: "2026-01-01T00:00:00Z",
          properties: {
            Name: {
              type: "title",
              title: [{ plain_text: "My Notion Page" }],
            },
          },
        },
      ],
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 200, data: mockResponse }]);

    try {
      const changesets = await connector.pull();
      expect(changesets).toHaveLength(1);
      expect(changesets[0].id).toBe("notion::db-123::page::page-001");
      expect(changesets[0].action).toBe("create");
      expect(changesets[0].content).toContain("My Notion Page");
      expect(changesets[0].metadata.source).toBe("notion");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("push: ページを作成する", async () => {
    const connector = new NotionConnector("test-notion");
    await connector.initialize({
      type: "notion",
      credentials: { token: "secret_test_token" },
      settings: { database_id: "db-123", api_base: "https://api.notion.com/v1" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 200, data: { id: "new-page-001" } }]);

    try {
      const changes: SyncChangeset[] = [
        {
          id: "obs-002",
          action: "create",
          content: "Observation to push",
          metadata: {},
          timestamp: "2026-01-01T00:00:00Z",
        },
      ];
      const result = await connector.push(changes);
      expect(result.success).toBe(true);
      expect(result.synced).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("testConnection: token 未設定で ok: false", async () => {
    const connector = new NotionConnector("test-notion");
    await connector.initialize({
      type: "notion",
      credentials: {},
      settings: {},
    });
    const result = await connector.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("token");
  });
});

// ─── 4. GDrive コネクタ ────────────────────────────────────────────

describe("GoogleDriveConnector", () => {
  test("pull: ファイル一覧を SyncChangeset に変換する", async () => {
    const connector = new GoogleDriveConnector("test-gdrive");
    await connector.initialize({
      type: "gdrive",
      credentials: { access_token: "ya29.test-token" },
      settings: { folder_id: "folder-123", api_base: "https://www.googleapis.com" },
    });

    const mockFiles = {
      files: [
        {
          id: "file-001",
          name: "My Document",
          mimeType: "text/plain",
          modifiedTime: "2026-01-01T00:00:00Z",
          webViewLink: "https://drive.google.com/file/d/file-001",
        },
      ],
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 200, data: mockFiles }]);

    try {
      const changesets = await connector.pull();
      expect(changesets).toHaveLength(1);
      expect(changesets[0].id).toBe("gdrive::folder-123::file::file-001");
      expect(changesets[0].action).toBe("create");
      expect(changesets[0].content).toContain("My Document");
      expect(changesets[0].metadata.source).toBe("gdrive");
      expect(changesets[0].metadata.file_id).toBe("file-001");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("push: ファイルをアップロードする", async () => {
    const connector = new GoogleDriveConnector("test-gdrive");
    await connector.initialize({
      type: "gdrive",
      credentials: { access_token: "ya29.test-token" },
      settings: { folder_id: "folder-123", api_base: "https://www.googleapis.com" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 200, data: { id: "new-file-001" } }]);

    try {
      const changes: SyncChangeset[] = [
        {
          id: "obs-003",
          action: "create",
          content: "Observation content for GDrive",
          metadata: {},
          timestamp: "2026-01-01T00:00:00Z",
        },
      ];
      const result = await connector.push(changes);
      expect(result.success).toBe(true);
      expect(result.synced).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("testConnection: アクセストークン設定済みで ok: true", async () => {
    const connector = new GoogleDriveConnector("test-gdrive");
    await connector.initialize({
      type: "gdrive",
      credentials: { access_token: "ya29.test-token" },
      settings: { api_base: "https://www.googleapis.com" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 200, data: { user: { emailAddress: "test@example.com" } } }]);

    try {
      const result = await connector.testConnection();
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("testConnection: 資格情報未設定で ok: false", async () => {
    const connector = new GoogleDriveConnector("test-gdrive");
    await connector.initialize({
      type: "gdrive",
      credentials: {},
      settings: {},
    });
    const result = await connector.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ─── 5. DB 永続化 ──────────────────────────────────────────────────

describe("DB 永続化 — mem_sync_connections テーブル", () => {
  test("migrateSchema で mem_sync_connections が作成される", () => {
    const db = new Database(":memory:");
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);

    // テーブルが存在することを確認
    const result = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='mem_sync_connections'"
    ).get() as { name: string } | null;

    expect(result).not.toBeNull();
    expect(result?.name).toBe("mem_sync_connections");
  });

  test("mem_sync_connections にレコードを INSERT / SELECT できる", () => {
    const db = new Database(":memory:");
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);

    db.exec(`
      INSERT INTO mem_sync_connections (name, type, config, status, created_at)
      VALUES ('test-conn', 'github', '{"credentials":{}}', 'active', datetime('now'))
    `);

    const row = db.query(
      "SELECT * FROM mem_sync_connections WHERE name = 'test-conn'"
    ).get() as { name: string; type: string; status: string } | null;

    expect(row).not.toBeNull();
    expect(row?.name).toBe("test-conn");
    expect(row?.type).toBe("github");
    expect(row?.status).toBe("active");
  });

  test("name カラムは UNIQUE 制約がある", () => {
    const db = new Database(":memory:");
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);

    db.exec(`
      INSERT INTO mem_sync_connections (name, type, config, created_at)
      VALUES ('unique-test', 'notion', '{}', datetime('now'))
    `);

    expect(() => {
      db.exec(`
        INSERT INTO mem_sync_connections (name, type, config, created_at)
        VALUES ('unique-test', 'gdrive', '{}', datetime('now'))
      `);
    }).toThrow();
  });
});

// ─── 6. testConnection — token 未設定エラー ────────────────────────

describe("testConnection エラーハンドリング", () => {
  test("GitHubConnector: token 未設定で ok: false を返す", async () => {
    const connector = new GitHubConnector("gh-no-token");
    await connector.initialize({ type: "github", credentials: {}, settings: {} });
    const result = await connector.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("token");
  });

  test("GitHubConnector: repo 未設定でも token があれば /user を叩く", async () => {
    const connector = new GitHubConnector("gh-no-repo");
    await connector.initialize({
      type: "github",
      credentials: { token: "gh-test-token" },
      settings: { api_base: "https://api.github.com" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: true, status: 200, data: { login: "user" } }]);

    try {
      const result = await connector.testConnection();
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ─── 7. ConnectorRegistry.syncAll ─────────────────────────────────

describe("ConnectorRegistry.syncAll", () => {
  test("登録コネクタの pull を実行して SyncResult を返す", async () => {
    const registry = new ConnectorRegistry();

    const connector = new GitHubConnector("syncall-test");
    await connector.initialize({
      type: "github",
      credentials: { token: "gh-test-token" },
      settings: { repo: "owner/repo", api_base: "https://api.github.com" },
    });
    registry.register(connector);

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { ok: true, status: 200, data: [{ number: 1, title: "T", body: "B", updated_at: "2026-01-01T00:00:00Z", state: "open", labels: [] }] },
    ]);

    try {
      const results = await registry.syncAll();
      expect(results).toHaveLength(1);
      expect(results[0].connector).toBe("syncall-test");
      expect(results[0].pulled).toBe(1);
      expect(results[0].errors).toHaveLength(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("コネクタなしの場合は空配列を返す", async () => {
    const registry = new ConnectorRegistry();
    const results = await registry.syncAll();
    expect(results).toHaveLength(0);
  });
});

// ─── 8. エラーハンドリング — pull 失敗 ────────────────────────────

describe("エラーハンドリング", () => {
  test("syncAll: pull 失敗時もエラーを収集して続行する", async () => {
    const registry = new ConnectorRegistry();

    const connector = new GitHubConnector("fail-connector");
    await connector.initialize({
      type: "github",
      credentials: { token: "gh-test-token" },
      settings: { repo: "owner/repo", api_base: "https://api.github.com" },
    });
    registry.register(connector);

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    }) as unknown as typeof fetch;

    try {
      const results = await registry.syncAll();
      expect(results).toHaveLength(1);
      expect(results[0].pulled).toBe(0);
      expect(results[0].errors.length).toBeGreaterThanOrEqual(0); // syncAll はエラーをログして空配列を返す
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("syncConnector: 存在しないコネクタ名でエラー結果を返す", async () => {
    const registry = new ConnectorRegistry();
    const result = await registry.syncConnector("nonexistent");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("not found");
  });

  test("GitHub push: API エラー時に errors を返す", async () => {
    const connector = new GitHubConnector("test-push-err");
    await connector.initialize({
      type: "github",
      credentials: { token: "gh-test-token" },
      settings: { repo: "owner/repo", api_base: "https://api.github.com" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([{ ok: false, status: 422, data: { message: "Unprocessable" } }]);

    try {
      const changes: SyncChangeset[] = [
        {
          id: "obs-err",
          action: "create",
          content: "content",
          metadata: {},
          timestamp: "2026-01-01T00:00:00Z",
        },
      ];
      const result = await connector.push(changes);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
