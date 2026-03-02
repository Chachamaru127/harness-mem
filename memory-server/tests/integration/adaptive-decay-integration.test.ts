/**
 * COMP-002: 適応的メモリ減衰（Adaptive Decay）統合テスト
 *
 * 実際の検索スコアリングで decay tier が機能することを検証する。
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

function makeConfig(dir: string): Config {
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
  };
}

describe("COMP-002: Adaptive Decay 統合テスト", () => {
  test("search 結果に decay_tier フィールドが含まれる", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-decay-tier-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      core.recordEvent({
        platform: "claude",
        project: "decay-test",
        session_id: "session-decay-1",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: "機械学習モデルのトレーニングデータセットについて" },
        tags: [],
        privacy_tags: [],
      });

      const result = core.search({
        query: "機械学習 トレーニング",
        project: "decay-test",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);

      const item = result.items[0] as Record<string, unknown>;
      // decay_tier フィールドが存在し、有効な値であること
      expect(["hot", "warm", "cold"]).toContain(item.decay_tier);
      // access_count フィールドが存在すること
      expect(typeof item.access_count).toBe("number");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("未アクセスの観察は cold tier になる", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-decay-cold-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      core.recordEvent({
        platform: "claude",
        project: "decay-cold",
        session_id: "session-cold-1",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: "未アクセスのデータを確認する" },
        tags: [],
        privacy_tags: [],
      });

      const result = core.search({
        query: "未アクセス データ",
        project: "decay-cold",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);

      // 初回アクセス前（last_accessed_at が null）なので cold
      // ただし search 後は access_count が 1 になる
      const item = result.items[0] as Record<string, unknown>;
      expect(item.decay_tier).toBe("cold");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("search 後に access_count がインクリメントされる", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-decay-count-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      core.recordEvent({
        platform: "claude",
        project: "decay-count",
        session_id: "session-count-1",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: "アクセスカウントをテストするサンプルデータ" },
        tags: [],
        privacy_tags: [],
      });

      // 1回目の検索
      const result1 = core.search({
        query: "アクセスカウント テスト",
        project: "decay-count",
        include_private: true,
        limit: 10,
      });
      expect(result1.ok).toBe(true);
      expect(result1.items.length).toBeGreaterThan(0);
      const item1 = result1.items[0] as Record<string, unknown>;
      const count1 = item1.access_count as number;

      // 2回目の検索
      const result2 = core.search({
        query: "アクセスカウント テスト",
        project: "decay-count",
        include_private: true,
        limit: 10,
      });
      expect(result2.ok).toBe(true);
      expect(result2.items.length).toBeGreaterThan(0);
      const item2 = result2.items[0] as Record<string, unknown>;
      const count2 = item2.access_count as number;

      // 2回目の方が access_count が増えている
      expect(count2).toBeGreaterThan(count1);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
