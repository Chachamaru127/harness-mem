/**
 * TEAM-006: PII フィルタリング のテスト
 *
 * MCP→VPS 送信前に PII（個人情報）を除去/置換することを検証する。
 * フィルタ対象: 電話番号、メールアドレス、LINE ID、住所パターン
 */
import { describe, expect, test } from "bun:test";
import { applyPiiFilter, type PiiRule } from "../../src/pii/pii-filter";

const DEFAULT_RULES: PiiRule[] = [
  { name: "phone", pattern: "0\\d{1,4}[-‐−]?\\d{1,4}[-‐−]?\\d{3,4}", replacement: "[PHONE]" },
  { name: "email", pattern: "[\\w.+\\-]+@[\\w.\\-]+\\.\\w+", replacement: "[EMAIL]" },
  { name: "line_id", pattern: "@[a-zA-Z0-9_.]{3,20}", replacement: "[LINE_ID]" },
];

describe("TEAM-006: PII フィルタリング", () => {
  test("電話番号をマスクする", () => {
    const result = applyPiiFilter("電話番号は 03-1234-5678 です", DEFAULT_RULES);
    expect(result).toContain("[PHONE]");
    expect(result).not.toContain("03-1234-5678");
  });

  test("メールアドレスをマスクする", () => {
    const result = applyPiiFilter("連絡先: ohashi@example.com までご連絡ください", DEFAULT_RULES);
    expect(result).toContain("[EMAIL]");
    expect(result).not.toContain("ohashi@example.com");
  });

  test("LINE ID をマスクする", () => {
    const result = applyPiiFilter("LINEのIDは @ohashi_it です", DEFAULT_RULES);
    expect(result).toContain("[LINE_ID]");
    expect(result).not.toContain("@ohashi_it");
  });

  test("複数の PII を同時にマスクする", () => {
    const input = "電話: 090-1234-5678、メール: tanaka@example.com";
    const result = applyPiiFilter(input, DEFAULT_RULES);
    expect(result).toContain("[PHONE]");
    expect(result).toContain("[EMAIL]");
    expect(result).not.toContain("090-1234-5678");
    expect(result).not.toContain("tanaka@example.com");
  });

  test("PII が含まれない文字列はそのまま返す", () => {
    const input = "今日の天気は晴れです";
    const result = applyPiiFilter(input, DEFAULT_RULES);
    expect(result).toBe(input);
  });

  test("ルールが空の場合はテキストをそのまま返す", () => {
    const input = "電話: 03-1234-5678";
    const result = applyPiiFilter(input, []);
    expect(result).toBe(input);
  });
});
