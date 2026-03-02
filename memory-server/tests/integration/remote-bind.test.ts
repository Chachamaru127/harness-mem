import { describe, expect, test } from "bun:test";
import { checkRemoteBindSafety } from "../../src/server";

describe("remote bind safety check", () => {
  test("ローカルバインド(127.0.0.1)はトークン不要で安全", () => {
    const origToken = process.env.HARNESS_MEM_ADMIN_TOKEN;
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    try {
      expect(checkRemoteBindSafety("127.0.0.1")).toBeNull();
    } finally {
      if (origToken !== undefined) process.env.HARNESS_MEM_ADMIN_TOKEN = origToken;
      else delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    }
  });

  test("ローカルバインド(localhost)はトークン不要で安全", () => {
    const origToken = process.env.HARNESS_MEM_ADMIN_TOKEN;
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    try {
      expect(checkRemoteBindSafety("localhost")).toBeNull();
    } finally {
      if (origToken !== undefined) process.env.HARNESS_MEM_ADMIN_TOKEN = origToken;
      else delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    }
  });

  test("リモートバインドでトークン未設定の場合はエラーメッセージを返す", () => {
    const origToken = process.env.HARNESS_MEM_ADMIN_TOKEN;
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    try {
      const result = checkRemoteBindSafety("0.0.0.0");
      expect(result).not.toBeNull();
      expect(result).toContain("HARNESS_MEM_ADMIN_TOKEN");
    } finally {
      if (origToken !== undefined) process.env.HARNESS_MEM_ADMIN_TOKEN = origToken;
      else delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    }
  });

  test("リモートバインドでトークン設定済みの場合はnullを返しリモートモードログを出力する", () => {
    const origToken = process.env.HARNESS_MEM_ADMIN_TOKEN;
    process.env.HARNESS_MEM_ADMIN_TOKEN = "test-token-remote-safe";
    const messages: string[] = [];
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = (...args: unknown[]) => messages.push(args.join(" "));
    console.error = (...args: unknown[]) => messages.push(args.join(" "));
    try {
      const result = checkRemoteBindSafety("0.0.0.0");
      expect(result).toBeNull();
      // リモートモード起動ログが出力されること
      expect(
        messages.some(
          (m) =>
            m.includes("リモートモード") ||
            m.includes("remote mode") ||
            m.includes("REMOTE")
        )
      ).toBe(true);
    } finally {
      console.warn = origWarn;
      console.error = origError;
      if (origToken !== undefined) process.env.HARNESS_MEM_ADMIN_TOKEN = origToken;
      else delete process.env.HARNESS_MEM_ADMIN_TOKEN;
    }
  });
});
