/**
 * IMP-002: メモリ関係性タイプ拡張テスト (updates/extends/derives)
 *
 * テストケース:
 * 1. 正常: updates リンク - 同一トピックの新旧ファクト → 旧→新に updates リンク作成
 * 2. 正常: extends リンク - 補足情報の追加 → 既存→新に extends リンク作成
 * 3. 正常: 検索除外 - updates で上書きされた観察を検索 → 最新のみ返却
 * 4. 境界: 自己参照 - 同一 observation → リンク作成されない
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-links-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "test-project",
    session_id: "session-links-test",
    event_type: "user_prompt",
    ts: "2026-02-14T00:00:00.000Z",
    payload: { prompt: "test observation" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("IMP-002: メモリ関係性タイプ拡張 (updates/extends/derives)", () => {
  test("正常: updates リンク - 同一トピックの新旧ファクトにupdatesリンクを作成できる", () => {
    const core = new HarnessMemCore(createConfig("updates-link"));
    try {
      // 古い観察
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "old-fact-event",
          ts: "2026-02-14T10:00:00.000Z",
          payload: { prompt: "DB は MySQL を使う" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;

      // 新しい観察
      const newResult = core.recordEvent(
        baseEvent({
          event_id: "new-fact-event",
          ts: "2026-02-14T11:00:00.000Z",
          payload: { prompt: "DB は PostgreSQL を使う" },
        })
      );
      const newObsId = (newResult.items[0] as { id: string }).id;

      // 手動で updates リンクを作成
      const linkResult = core.createLink({
        from_observation_id: oldObsId,
        to_observation_id: newObsId,
        relation: "updates",
        weight: 1.0,
      });

      expect(linkResult.ok).toBe(true);

      // リンクが正しく作成されたことを確認
      const links = core.getLinks({ observation_id: oldObsId });
      const linkItems = links.items as Array<{ from_observation_id: string; to_observation_id: string; relation: string }>;
      const updatesLink = linkItems.find((l) => l.relation === "updates");
      expect(updatesLink).toBeDefined();
      expect(updatesLink?.from_observation_id).toBe(oldObsId);
      expect(updatesLink?.to_observation_id).toBe(newObsId);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: extends リンク - 補足情報にextendsリンクを作成できる", () => {
    const core = new HarnessMemCore(createConfig("extends-link"));
    try {
      // 元の観察
      const baseResult = core.recordEvent(
        baseEvent({
          event_id: "base-fact-event",
          ts: "2026-02-14T10:00:00.000Z",
          payload: { prompt: "認証には JWT を使う" },
        })
      );
      const baseObsId = (baseResult.items[0] as { id: string }).id;

      // 補足情報
      const extResult = core.recordEvent(
        baseEvent({
          event_id: "ext-fact-event",
          ts: "2026-02-14T11:00:00.000Z",
          payload: { prompt: "JWT の有効期限は 1 時間に設定する" },
        })
      );
      const extObsId = (extResult.items[0] as { id: string }).id;

      // extends リンクを作成
      const linkResult = core.createLink({
        from_observation_id: baseObsId,
        to_observation_id: extObsId,
        relation: "extends",
        weight: 0.8,
      });

      expect(linkResult.ok).toBe(true);

      // リンクが正しく作成されたことを確認
      const links = core.getLinks({ observation_id: baseObsId });
      const linkItems = links.items as Array<{ from_observation_id: string; to_observation_id: string; relation: string; weight: number }>;
      const extendsLink = linkItems.find((l) => l.relation === "extends");
      expect(extendsLink).toBeDefined();
      expect(extendsLink?.from_observation_id).toBe(baseObsId);
      expect(extendsLink?.to_observation_id).toBe(extObsId);
      expect(extendsLink?.weight).toBeCloseTo(0.8, 5);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: 検索除外 - updatesで上書きされた観察は検索で最新のみ返却", () => {
    const core = new HarnessMemCore(createConfig("search-exclude"));
    try {
      // 古い観察（updatesされる側）
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "obsolete-event",
          ts: "2026-02-14T09:00:00.000Z",
          payload: { prompt: "データベース設定: MySQL バージョン 5.7 を使用する旧設定" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;

      // 新しい観察（updatesする側）
      const newResult = core.recordEvent(
        baseEvent({
          event_id: "latest-event",
          ts: "2026-02-14T10:00:00.000Z",
          payload: { prompt: "データベース設定: PostgreSQL バージョン 16 を使用する最新設定" },
        })
      );
      const newObsId = (newResult.items[0] as { id: string }).id;

      // updates リンクを作成（旧→新）
      core.createLink({
        from_observation_id: oldObsId,
        to_observation_id: newObsId,
        relation: "updates",
        weight: 1.0,
      });

      // 検索して、updatesされた旧観察が除外されていることを確認
      const searchResult = core.search({
        query: "データベース設定",
        project: "test-project",
        include_private: true,
        exclude_updated: true,
      });

      const resultIds = (searchResult.items as Array<{ id: string }>).map((item) => item.id);

      // 最新観察が含まれること
      expect(resultIds).toContain(newObsId);
      // 旧観察（updatesされた）が除外されること
      expect(resultIds).not.toContain(oldObsId);
    } finally {
      core.shutdown("test");
    }
  });

  test("境界: 自己参照 - 同一observationへのリンクは作成されない", () => {
    const core = new HarnessMemCore(createConfig("self-ref"));
    try {
      const result = core.recordEvent(
        baseEvent({
          event_id: "self-ref-event",
          ts: "2026-02-14T10:00:00.000Z",
          payload: { prompt: "自己参照テスト観察" },
        })
      );
      const obsId = (result.items[0] as { id: string }).id;

      // 自己参照リンクを試みる
      const linkResult = core.createLink({
        from_observation_id: obsId,
        to_observation_id: obsId,
        relation: "updates",
        weight: 1.0,
      });

      // エラーになること
      expect(linkResult.ok).toBe(false);

      // リンクが作成されていないことを確認
      const links = core.getLinks({ observation_id: obsId });
      const linkItems = links.items as Array<{ from_observation_id: string; to_observation_id: string; relation: string }>;
      const selfLinks = linkItems.filter(
        (l) => l.from_observation_id === obsId && l.to_observation_id === obsId && l.relation === "updates"
      );
      expect(selfLinks).toHaveLength(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("derives リンク - スキーマ定義として作成できる (Phase 3 本格実装前のプレースホルダー)", () => {
    const core = new HarnessMemCore(createConfig("derives-link"));
    try {
      const srcResult = core.recordEvent(
        baseEvent({
          event_id: "src-derives-event",
          ts: "2026-02-14T10:00:00.000Z",
          payload: { prompt: "ユーザーはTypeScriptを好む" },
        })
      );
      const srcObsId = (srcResult.items[0] as { id: string }).id;

      const dstResult = core.recordEvent(
        baseEvent({
          event_id: "dst-derives-event",
          ts: "2026-02-14T11:00:00.000Z",
          payload: { prompt: "ユーザーはJavaScriptエコシステムを活用する" },
        })
      );
      const dstObsId = (dstResult.items[0] as { id: string }).id;

      // derives リンクを作成
      const linkResult = core.createLink({
        from_observation_id: srcObsId,
        to_observation_id: dstObsId,
        relation: "derives",
        weight: 0.5,
      });

      expect(linkResult.ok).toBe(true);

      const links = core.getLinks({ observation_id: srcObsId });
      const linkItems = links.items as Array<{ relation: string }>;
      const derivesLink = linkItems.find((l) => l.relation === "derives");
      expect(derivesLink).toBeDefined();
    } finally {
      core.shutdown("test");
    }
  });
});
