/**
 * TEAM-004: マルチトークン認証 のテスト
 *
 * config.json の auth セクションに定義されたトークンマップで
 * 複数ユーザー認証ができることを検証する。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveTokenIdentity, loadAuthConfig, type TokenEntry, type AuthConfig } from "../../src/auth/token-resolver";

function makeAuthConfig(tokens: Record<string, TokenEntry>): AuthConfig {
  return {
    admin_token: "hm_admin_test_secret",
    tokens,
  };
}

describe("TEAM-004: マルチトークン認証", () => {
  test("admin_token で認証すると { role: 'admin' } が返る", () => {
    const config = makeAuthConfig({});
    const result = resolveTokenIdentity("hm_admin_test_secret", config);
    expect(result).not.toBeNull();
    expect(result?.role).toBe("admin");
    expect(result?.user_id).toBe("admin");
  });

  test("有効なユーザートークンで user_id / team_id / role が解決される", () => {
    const config = makeAuthConfig({
      "hm_user_ohashi_xxxxx": { user_id: "ohashi", team_id: "it-team", role: "member" },
    });
    const result = resolveTokenIdentity("hm_user_ohashi_xxxxx", config);
    expect(result).not.toBeNull();
    expect(result?.user_id).toBe("ohashi");
    expect(result?.team_id).toBe("it-team");
    expect(result?.role).toBe("member");
  });

  test("複数ユーザートークンがそれぞれ正しく解決される", () => {
    const config = makeAuthConfig({
      "hm_user_ohashi": { user_id: "ohashi", team_id: "it-team", role: "member" },
      "hm_user_tanaka": { user_id: "tanaka", team_id: "marketing", role: "member" },
    });
    const r1 = resolveTokenIdentity("hm_user_ohashi", config);
    const r2 = resolveTokenIdentity("hm_user_tanaka", config);
    expect(r1?.user_id).toBe("ohashi");
    expect(r2?.user_id).toBe("tanaka");
    expect(r2?.team_id).toBe("marketing");
  });

  test("不正なトークンは null を返す", () => {
    const config = makeAuthConfig({
      "hm_user_ohashi": { user_id: "ohashi", team_id: "it-team", role: "member" },
    });
    const result = resolveTokenIdentity("invalid_token_xyz", config);
    expect(result).toBeNull();
  });

  test("空トークンは null を返す", () => {
    const config = makeAuthConfig({});
    const result = resolveTokenIdentity("", config);
    expect(result).toBeNull();
  });

  test("loadAuthConfig はファイルから設定を読み取る", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-auth-cfg-"));
    try {
      const cfgPath = join(dir, "config.json");
      writeFileSync(cfgPath, JSON.stringify({
        auth: {
          admin_token: "hm_admin_from_file",
          tokens: {
            "hm_user_alice": { user_id: "alice", team_id: "dev", role: "member" },
          },
        },
      }));
      const loaded = loadAuthConfig(cfgPath);
      expect(loaded).not.toBeNull();
      expect(loaded?.admin_token).toBe("hm_admin_from_file");
      const r = resolveTokenIdentity("hm_user_alice", loaded!);
      expect(r?.user_id).toBe("alice");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
