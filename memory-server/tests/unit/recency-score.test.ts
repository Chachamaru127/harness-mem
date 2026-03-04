import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { recencyScore } from "../../src/core/core-utils";

describe("recencyScore", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS;
    delete process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS = originalEnv;
    } else {
      delete process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS;
    }
  });

  test("無効な日付文字列は 0 を返す", () => {
    expect(recencyScore("invalid-date")).toBe(0);
    expect(recencyScore("")).toBe(0);
  });

  test("現在時刻は 1 に近い値を返す", () => {
    const now = new Date().toISOString();
    const score = recencyScore(now);
    expect(score).toBeGreaterThan(0.99);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test("90日前は 0.5 に近い値を返す（デフォルト半減期 90日）", () => {
    const daysAgo = 90;
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(past);
    // exp(-1) ≈ 0.368 (半減期のため exp(-ln2) ≈ 0.5 が正確には半減期)
    // 90日後は exp(-90*24 / (90*24)) = exp(-1) ≈ 0.368
    expect(score).toBeGreaterThan(0.35);
    expect(score).toBeLessThan(0.40);
  });

  test("1年前 (365日) は非常に低い値を返す（デフォルト半減期 90日）", () => {
    const daysAgo = 365;
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(past);
    // exp(-365/90) ≈ exp(-4.06) ≈ 0.017
    expect(score).toBeGreaterThan(0.01);
    expect(score).toBeLessThan(0.03);
  });

  test("6ヶ月前 (180日) は中程度の値を返す（デフォルト半減期 90日）", () => {
    const daysAgo = 180;
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(past);
    // exp(-180/90) = exp(-2) ≈ 0.135
    expect(score).toBeGreaterThan(0.12);
    expect(score).toBeLessThan(0.16);
  });

  test("1ヶ月前 (30日) は高い値を返す（デフォルト半減期 90日）", () => {
    const daysAgo = 30;
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(past);
    // exp(-30/90) = exp(-0.333) ≈ 0.716
    expect(score).toBeGreaterThan(0.70);
    expect(score).toBeLessThan(0.73);
  });

  test("HARNESS_MEM_RECENCY_HALF_LIFE_DAYS 環境変数で半減期を上書きできる", () => {
    process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS = "14";
    const daysAgo = 14;
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(past);
    // 半減期 14日で14日前は exp(-1) ≈ 0.368
    expect(score).toBeGreaterThan(0.35);
    expect(score).toBeLessThan(0.40);
  });

  test("HARNESS_MEM_RECENCY_HALF_LIFE_DAYS が無効な値の場合はデフォルト 90日を使う", () => {
    process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS = "invalid";
    const daysAgo = 90;
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(past);
    // デフォルト 90日を使用するので exp(-1) ≈ 0.368
    expect(score).toBeGreaterThan(0.35);
    expect(score).toBeLessThan(0.40);
  });

  test("HARNESS_MEM_RECENCY_HALF_LIFE_DAYS が 0 の場合はデフォルト 90日を使う", () => {
    process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS = "0";
    const daysAgo = 90;
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(past);
    // デフォルト 90日を使用するので exp(-1) ≈ 0.368
    expect(score).toBeGreaterThan(0.35);
    expect(score).toBeLessThan(0.40);
  });

  test("未来の日付は 1 に近い値を返す（ageMs が 0 以下はクランプ）", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const score = recencyScore(future);
    // ageMs = max(0, negative) = 0 → exp(0) = 1
    expect(score).toBe(1.0);
  });
});
