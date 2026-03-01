/**
 * COMP-008: URL コネクター テスト
 *
 * テストケース:
 * 1. 正常: 有効なHTTP URLからコンテンツを取得してパースできる
 * 2. セキュリティ: プライベートIP（127.0.0.1）はブロックされる
 * 3. セキュリティ: プライベートIP（192.168.x.x）はブロックされる
 * 4. セキュリティ: メタデータサービスIP（169.254.169.254）はブロックされる
 * 5. セキュリティ: 内部IP（10.x.x.x）はブロックされる
 * 6. 境界: HTTPSでないURLはブロックまたは許可（設定に依存）
 */

import { describe, expect, test } from "bun:test";
import {
  isPrivateOrReservedHost,
  validateUrlForFetch,
  type UrlValidationResult,
} from "../../src/ingest/url-connector";

describe("COMP-008: URL コネクター - SSRF 防止", () => {
  test("正常: 公開ドメインはブロックされない", () => {
    const result = validateUrlForFetch("https://example.com/page");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("セキュリティ: localhost はブロックされる", () => {
    const result = validateUrlForFetch("http://localhost:8080/api");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF");
  });

  test("セキュリティ: 127.0.0.1 はブロックされる", () => {
    const result = validateUrlForFetch("http://127.0.0.1:3000/secret");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF");
  });

  test("セキュリティ: 192.168.x.x はブロックされる", () => {
    const result = validateUrlForFetch("http://192.168.1.100/internal");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF");
  });

  test("セキュリティ: 169.254.169.254（メタデータサービス）はブロックされる", () => {
    const result = validateUrlForFetch("http://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF");
  });

  test("セキュリティ: 10.x.x.x はブロックされる", () => {
    const result = validateUrlForFetch("http://10.0.0.1/admin");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF");
  });

  test("セキュリティ: 172.16.x.x はブロックされる", () => {
    const result = validateUrlForFetch("http://172.16.0.1/private");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF");
  });

  test("境界: file:// スキームはブロックされる", () => {
    const result = validateUrlForFetch("file:///etc/passwd");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("境界: 不正なURLはブロックされる", () => {
    const result = validateUrlForFetch("not-a-valid-url");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("isPrivateOrReservedHost: ループバックアドレスを検出", () => {
    expect(isPrivateOrReservedHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("127.255.255.255")).toBe(true);
    expect(isPrivateOrReservedHost("::1")).toBe(true);
  });

  test("isPrivateOrReservedHost: プライベートアドレスを検出", () => {
    expect(isPrivateOrReservedHost("10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("10.255.255.255")).toBe(true);
    expect(isPrivateOrReservedHost("192.168.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("172.31.255.255")).toBe(true);
  });

  test("isPrivateOrReservedHost: 公開アドレスは false を返す", () => {
    expect(isPrivateOrReservedHost("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedHost("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedHost("example.com")).toBe(false);
  });
});
