/**
 * NEXT-014: MCP 認証自動注入 テスト
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  resolveAuthIdentity,
  resolveUserId,
  resolveTeamId,
  type AuthInjectionConfig,
} from "../mcp-server/src/auth-inject";

describe("NEXT-014: MCP 認証自動注入", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env before each test
    delete process.env.HARNESS_MEM_USER_ID;
    delete process.env.HARNESS_MEM_TEAM_ID;
    delete process.env.USER;
    delete process.env.LOGNAME;
  });

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  test("resolveUserId が環境変数 HARNESS_MEM_USER_ID を優先する", () => {
    process.env.HARNESS_MEM_USER_ID = "test-user-from-env";
    const result = resolveUserId({});
    expect(result).toBe("test-user-from-env");
  });

  test("resolveUserId が USER 環境変数からフォールバックする", () => {
    process.env.USER = "sysuser";
    const result = resolveUserId({});
    expect(result).toBe("sysuser");
  });

  test("resolveUserId が hostname を最終フォールバックとして使用する", () => {
    const result = resolveUserId({ hostname: "myhost" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("resolveTeamId が環境変数 HARNESS_MEM_TEAM_ID を優先する", () => {
    process.env.HARNESS_MEM_TEAM_ID = "my-team";
    const result = resolveTeamId({ user_id: "user1" });
    expect(result).toBe("my-team");
  });

  test("resolveTeamId が tokenMap から team_id を解決する", () => {
    const config: AuthInjectionConfig = {
      tokenMap: { "user1": "team-alpha", "user2": "team-beta" },
    };
    const result = resolveTeamId({ user_id: "user1", config });
    expect(result).toBe("team-alpha");
  });

  test("resolveTeamId が tokenMap にない場合は user_id を返す", () => {
    const config: AuthInjectionConfig = {
      tokenMap: { "user1": "team-alpha" },
    };
    const result = resolveTeamId({ user_id: "unknown-user", config });
    expect(result).toBe("unknown-user");
  });

  test("resolveAuthIdentity が user_id と team_id を返す", () => {
    process.env.HARNESS_MEM_USER_ID = "alice";
    process.env.HARNESS_MEM_TEAM_ID = "engineering";
    const identity = resolveAuthIdentity({});
    expect(identity.user_id).toBe("alice");
    expect(identity.team_id).toBe("engineering");
  });
});
