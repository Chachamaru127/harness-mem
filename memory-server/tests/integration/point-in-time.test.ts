/**
 * COMP-003: Point-in-time クエリ のテスト
 *
 * search API の `as_of` パラメータで過去時点のデータのみを返す機能を検証する。
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

describe("COMP-003: Point-in-time クエリ", () => {
  test("as_of を指定すると過去時点の観察のみが返る", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-pit-filter-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      // 1日前のイベント
      const pastTime = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      // 現在のイベント
      const nowTime = new Date().toISOString();
      // 過去と現在の中間
      const midTime = new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString();

      core.recordEvent({
        event_id: "pit-past-event",
        platform: "claude",
        project: "pit-test",
        session_id: "session-pit-1",
        event_type: "user_prompt",
        ts: pastTime,
        payload: { content: "過去のデータポイント アルゴリズム設計" },
        tags: [],
        privacy_tags: [],
      });

      core.recordEvent({
        event_id: "pit-now-event",
        platform: "claude",
        project: "pit-test",
        session_id: "session-pit-1",
        event_type: "user_prompt",
        ts: nowTime,
        payload: { content: "現在のデータポイント アルゴリズム設計" },
        tags: [],
        privacy_tags: [],
      });

      // as_of = 中間時刻: 過去のイベントのみ返る
      const pitResult = core.search({
        query: "アルゴリズム設計",
        project: "pit-test",
        include_private: true,
        limit: 10,
        as_of: midTime,
      });

      expect(pitResult.ok).toBe(true);
      const ids = (pitResult.items as Array<{ id: string }>).map((i) => i.id);

      // 過去のイベント由来の観察は含まれる
      const pastObs = (pitResult.items as Array<{ id: string; created_at: string }>)
        .filter((i) => new Date(i.created_at) <= new Date(midTime));
      expect(pastObs.length).toBeGreaterThan(0);

      // 現在（midTime 以降）のイベント由来の観察は含まれない
      const futureObs = (pitResult.items as Array<{ id: string; created_at: string }>)
        .filter((i) => new Date(i.created_at) > new Date(midTime));
      expect(futureObs.length).toBe(0);

      // as_of なし: 両方含まれる
      const allResult = core.search({
        query: "アルゴリズム設計",
        project: "pit-test",
        include_private: true,
        limit: 10,
      });
      expect(allResult.ok).toBe(true);
      expect(allResult.items.length).toBeGreaterThan(pitResult.items.length);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("as_of が未来日時の場合は全件返る", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-pit-future-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      const nowTime = new Date().toISOString();
      const futureTime = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

      core.recordEvent({
        event_id: "pit-now-2",
        platform: "claude",
        project: "pit-future",
        session_id: "session-pit-2",
        event_type: "user_prompt",
        ts: nowTime,
        payload: { content: "データベース設計パターン" },
        tags: [],
        privacy_tags: [],
      });

      const resultFuture = core.search({
        query: "データベース 設計",
        project: "pit-future",
        include_private: true,
        limit: 10,
        as_of: futureTime,
      });

      const resultNow = core.search({
        query: "データベース 設計",
        project: "pit-future",
        include_private: true,
        limit: 10,
      });

      expect(resultFuture.ok).toBe(true);
      expect(resultNow.ok).toBe(true);
      // 未来時点でも現在データは全件返る
      expect(resultFuture.items.length).toBe(resultNow.items.length);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("as_of より後に作成された観察は除外される", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-pit-exclude-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      // 過去 2 日前と 1 日前のイベント
      const twoDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString();
      const oneDayAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      const asOfThreshold = new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(); // 1.5日前

      core.recordEvent({
        event_id: "pit-old",
        platform: "claude",
        project: "pit-exclude",
        session_id: "session-pit-3",
        event_type: "user_prompt",
        ts: twoDaysAgo,
        payload: { content: "古い設計方針 API エンドポイント" },
        tags: [],
        privacy_tags: [],
      });

      core.recordEvent({
        event_id: "pit-newer",
        platform: "claude",
        project: "pit-exclude",
        session_id: "session-pit-3",
        event_type: "user_prompt",
        ts: oneDayAgo,
        payload: { content: "新しい設計方針 API エンドポイント" },
        tags: [],
        privacy_tags: [],
      });

      // as_of = 1.5日前: 2日前のデータのみ返る
      const result = core.search({
        query: "設計方針 API エンドポイント",
        project: "pit-exclude",
        include_private: true,
        limit: 10,
        as_of: asOfThreshold,
      });

      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);

      // 閾値以降（1日前）の観察は含まれない
      for (const item of result.items as Array<{ created_at: string }>) {
        expect(new Date(item.created_at) <= new Date(asOfThreshold)).toBe(true);
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("as_of より前のデータが存在しない場合は空配列を返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-pit-empty-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      const nowTime = new Date().toISOString();
      const veryOldTime = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString(); // 1年前

      core.recordEvent({
        event_id: "pit-recent",
        platform: "claude",
        project: "pit-empty",
        session_id: "session-pit-4",
        event_type: "user_prompt",
        ts: nowTime,
        payload: { content: "最近のデータのみ" },
        tags: [],
        privacy_tags: [],
      });

      // as_of = 1年前: データがないので空
      const result = core.search({
        query: "最近のデータ",
        project: "pit-empty",
        include_private: true,
        limit: 10,
        as_of: veryOldTime,
      });

      expect(result.ok).toBe(true);
      expect(result.items.length).toBe(0);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
