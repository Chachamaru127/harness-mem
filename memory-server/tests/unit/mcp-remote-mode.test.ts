/**
 * TEAM-002: MCP Server リモート接続対応 のテスト
 *
 * mcp-server/src/tools/memory.ts の getBaseUrl(), isRemoteMode(), buildApiHeaders() をテストする。
 * bun で実行するため、memory-server のテストディレクトリに配置。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";

// memory.ts を直接 import する（bun は TypeScript を直接実行可能）
import {
  getBaseUrl,
  isRemoteMode,
  buildApiHeaders,
} from "../../../mcp-server/src/tools/memory.ts";

type EnvSnapshot = {
  HARNESS_MEM_REMOTE_URL?: string;
  HARNESS_MEM_REMOTE_TOKEN?: string;
  HARNESS_MEM_ADMIN_TOKEN?: string;
  HARNESS_MEM_HOST?: string;
  HARNESS_MEM_PORT?: string;
};

function snapshotEnv(): EnvSnapshot {
  return {
    HARNESS_MEM_REMOTE_URL: process.env.HARNESS_MEM_REMOTE_URL,
    HARNESS_MEM_REMOTE_TOKEN: process.env.HARNESS_MEM_REMOTE_TOKEN,
    HARNESS_MEM_ADMIN_TOKEN: process.env.HARNESS_MEM_ADMIN_TOKEN,
    HARNESS_MEM_HOST: process.env.HARNESS_MEM_HOST,
    HARNESS_MEM_PORT: process.env.HARNESS_MEM_PORT,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key as keyof EnvSnapshot];
    } else {
      process.env[key as keyof EnvSnapshot] = value;
    }
  }
}

describe("TEAM-002: MCP Server リモート接続対応", () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    // クリーンな状態でテスト開始
    delete process.env.HARNESS_MEM_REMOTE_URL;
    delete process.env.HARNESS_MEM_REMOTE_TOKEN;
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    delete process.env.HARNESS_MEM_HOST;
    delete process.env.HARNESS_MEM_PORT;
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  describe("isRemoteMode()", () => {
    test("HARNESS_MEM_REMOTE_URL 未設定 → false", () => {
      expect(isRemoteMode()).toBe(false);
    });

    test("HARNESS_MEM_REMOTE_URL 設定済み → true", () => {
      process.env.HARNESS_MEM_REMOTE_URL = "https://vps.example.com";
      expect(isRemoteMode()).toBe(true);
    });

    test("HARNESS_MEM_REMOTE_URL が空文字 → false", () => {
      process.env.HARNESS_MEM_REMOTE_URL = "";
      expect(isRemoteMode()).toBe(false);
    });
  });

  describe("getBaseUrl()", () => {
    test("HARNESS_MEM_REMOTE_URL 未設定 → ローカル URL を返す", () => {
      const url = getBaseUrl();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    });

    test("HARNESS_MEM_REMOTE_URL 設定済み → リモート URL を返す", () => {
      process.env.HARNESS_MEM_REMOTE_URL = "https://vps.example.com";
      expect(getBaseUrl()).toBe("https://vps.example.com");
    });

    test("HARNESS_MEM_REMOTE_URL の末尾スラッシュは除去される", () => {
      process.env.HARNESS_MEM_REMOTE_URL = "https://vps.example.com/";
      expect(getBaseUrl()).toBe("https://vps.example.com");
    });

    test("ローカルモード: HARNESS_MEM_HOST と HARNESS_MEM_PORT が反映される", () => {
      process.env.HARNESS_MEM_HOST = "192.168.1.1";
      process.env.HARNESS_MEM_PORT = "38000";
      expect(getBaseUrl()).toBe("http://192.168.1.1:38000");
    });
  });

  describe("buildApiHeaders()", () => {
    test("ローカルモード: HARNESS_MEM_ADMIN_TOKEN が Authorization ヘッダーに入る", () => {
      process.env.HARNESS_MEM_ADMIN_TOKEN = "local-secret";
      const headers = buildApiHeaders();
      expect(headers.authorization).toBe("Bearer local-secret");
      expect(headers["x-harness-mem-token"]).toBe("local-secret");
    });

    test("リモートモード: HARNESS_MEM_REMOTE_TOKEN が優先される", () => {
      process.env.HARNESS_MEM_REMOTE_URL = "https://vps.example.com";
      process.env.HARNESS_MEM_REMOTE_TOKEN = "remote-token-xyz";
      process.env.HARNESS_MEM_ADMIN_TOKEN = "local-secret";
      const headers = buildApiHeaders();
      expect(headers.authorization).toBe("Bearer remote-token-xyz");
      expect(headers["x-harness-mem-token"]).toBe("remote-token-xyz");
    });

    test("リモートモード: HARNESS_MEM_REMOTE_TOKEN 未設定なら HARNESS_MEM_ADMIN_TOKEN にフォールバック", () => {
      process.env.HARNESS_MEM_REMOTE_URL = "https://vps.example.com";
      process.env.HARNESS_MEM_ADMIN_TOKEN = "local-fallback";
      const headers = buildApiHeaders();
      expect(headers.authorization).toBe("Bearer local-fallback");
    });

    test("トークン未設定 → Authorization ヘッダーなし", () => {
      const headers = buildApiHeaders();
      expect(headers.authorization).toBeUndefined();
      expect(headers["x-harness-mem-token"]).toBeUndefined();
    });

    test("content-type は常に application/json", () => {
      const headers = buildApiHeaders();
      expect(headers["content-type"]).toBe("application/json");
    });
  });
});
