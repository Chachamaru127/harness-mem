import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { checkRemoteBindSafety } from "../../src/server";

describe("checkRemoteBindSafety", () => {
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env.HARNESS_MEM_ADMIN_TOKEN;
  });

  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    } else {
      process.env.HARNESS_MEM_ADMIN_TOKEN = savedToken;
    }
  });

  test("リモートバインド + トークン未設定 → エラーメッセージを返す", () => {
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    const result = checkRemoteBindSafety("0.0.0.0");
    expect(result).not.toBeNull();
    expect(result).toContain("HARNESS_MEM_ADMIN_TOKEN");
  });

  test("リモートバインド（空文字トークン）+ トークン未設定 → エラーメッセージを返す", () => {
    process.env.HARNESS_MEM_ADMIN_TOKEN = "";
    const result = checkRemoteBindSafety("0.0.0.0");
    expect(result).not.toBeNull();
    expect(result).toContain("HARNESS_MEM_ADMIN_TOKEN");
  });

  test("リモートバインド + トークン設定済み → null（正常）", () => {
    process.env.HARNESS_MEM_ADMIN_TOKEN = "secret-token-abc";
    const result = checkRemoteBindSafety("0.0.0.0");
    expect(result).toBeNull();
  });

  test("ローカルバインド（127.0.0.1）+ トークン未設定 → null（正常）", () => {
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    const result = checkRemoteBindSafety("127.0.0.1");
    expect(result).toBeNull();
  });

  test("ローカルバインド（localhost）+ トークン未設定 → null（正常）", () => {
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    const result = checkRemoteBindSafety("localhost");
    expect(result).toBeNull();
  });

  test("その他のホスト（192.168.x.x）+ トークン未設定 → エラーメッセージを返す", () => {
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    const result = checkRemoteBindSafety("192.168.1.100");
    expect(result).not.toBeNull();
  });
});
