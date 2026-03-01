/**
 * COMP-002: 適応的メモリ減衰（Adaptive Decay）のテスト
 *
 * 3-tier decay (hot/warm/cold) の動作を検証する。
 */
import { describe, expect, test } from "bun:test";
import {
  getDecayTier,
  getDecayMultiplier,
  applyDecayToScore,
  type DecayTier,
} from "../../src/core/adaptive-decay";

describe("COMP-002: 適応的メモリ減衰", () => {
  describe("getDecayTier()", () => {
    test("24時間以内のアクセス → hot", () => {
      const now = Date.now();
      const lastAccessedAt = new Date(now - 1000 * 60 * 60 * 12).toISOString(); // 12時間前
      expect(getDecayTier(lastAccessedAt, now)).toBe("hot");
    });

    test("24時間ちょうど → warm（境界は warm）", () => {
      const now = Date.now();
      const lastAccessedAt = new Date(now - 1000 * 60 * 60 * 24).toISOString(); // ぴったり24時間前
      expect(getDecayTier(lastAccessedAt, now)).toBe("warm");
    });

    test("7日以内のアクセス → warm", () => {
      const now = Date.now();
      const lastAccessedAt = new Date(now - 1000 * 60 * 60 * 48).toISOString(); // 48時間前
      expect(getDecayTier(lastAccessedAt, now)).toBe("warm");
    });

    test("7日より前のアクセス → cold", () => {
      const now = Date.now();
      const lastAccessedAt = new Date(now - 1000 * 60 * 60 * 24 * 8).toISOString(); // 8日前
      expect(getDecayTier(lastAccessedAt, now)).toBe("cold");
    });

    test("last_accessed_at が null（未アクセス）→ cold", () => {
      const now = Date.now();
      expect(getDecayTier(null, now)).toBe("cold");
    });
  });

  describe("getDecayMultiplier()", () => {
    test("hot → 1.0", () => {
      expect(getDecayMultiplier("hot")).toBe(1.0);
    });

    test("warm → 0.7", () => {
      expect(getDecayMultiplier("warm")).toBe(0.7);
    });

    test("cold → 0.4", () => {
      expect(getDecayMultiplier("cold")).toBe(0.4);
    });
  });

  describe("applyDecayToScore()", () => {
    test("hot のスコアは変わらない（乗数 1.0）", () => {
      expect(applyDecayToScore(0.8, "hot")).toBeCloseTo(0.8, 5);
    });

    test("warm のスコアは 70% になる", () => {
      expect(applyDecayToScore(0.8, "warm")).toBeCloseTo(0.56, 5);
    });

    test("cold のスコアは 40% になる", () => {
      expect(applyDecayToScore(0.8, "cold")).toBeCloseTo(0.32, 5);
    });

    test("スコアが 0 ならどの tier でも 0", () => {
      expect(applyDecayToScore(0, "hot")).toBe(0);
      expect(applyDecayToScore(0, "warm")).toBe(0);
      expect(applyDecayToScore(0, "cold")).toBe(0);
    });
  });
});
