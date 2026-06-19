/**
 * S78-D02: Contradiction resolution — supersedes relation type
 *
 * テストケース:
 * 1. 正常: supersedes リンク作成 — 新 fact が旧 fact を supersede できる
 * 2. 正常: 検索ランク — superseded 観察は non-superseded より rank が低い
 * 3. 正常: include_superseded=false — superseded 観察を除外
 * 4. 境界: include_superseded デフォルト(true) — superseded 観察は含むが後方
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
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-supersedes-${name}-`));
  cleanupPaths.push(dir);
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
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "test-project",
    session_id: "session-supersedes-test",
    event_type: "user_prompt",
    ts: "2026-04-15T00:00:00.000Z",
    payload: { prompt: "test observation" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("S78-D02: Contradiction resolution — supersedes relation", () => {
  test("正常: supersedes リンクを作成できる", () => {
    const core = new HarnessMemCore(createConfig("create-supersedes"));
    try {
      // 古い観察 (A: prod-v1 デプロイ)
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v1-event",
          ts: "2026-04-15T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v1 on 2026-04-15" },
        })
      );
      expect(oldResult.ok).toBe(true);
      const oldObsId = (oldResult.items[0] as { id: string }).id;
      expect(typeof oldObsId).toBe("string");

      // 新しい観察 (B: prod-v2 デプロイ)
      const newResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v2-event",
          ts: "2026-04-18T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v2 on 2026-04-18" },
        })
      );
      expect(newResult.ok).toBe(true);
      const newObsId = (newResult.items[0] as { id: string }).id;
      expect(typeof newObsId).toBe("string");

      // B supersedes A
      const linkResult = core.createLink({
        from_observation_id: newObsId,
        to_observation_id: oldObsId,
        relation: "supersedes",
        weight: 1.0,
      });
      expect(linkResult.ok).toBe(true);
      expect(linkResult.items).toHaveLength(1);
      const link = linkResult.items[0] as { relation: string; from_observation_id: string; to_observation_id: string };
      expect(link.relation).toBe("supersedes");
      expect(link.from_observation_id).toBe(newObsId);
      expect(link.to_observation_id).toBe(oldObsId);
    } finally {
      core.close?.();
    }
  });

  test("正常: superseded 観察は検索で non-superseded より rank が低い", () => {
    const core = new HarnessMemCore(createConfig("rank-supersedes"));
    try {
      // 古い観察 (superseded になる)
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v1-rank-event",
          ts: "2026-04-15T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v1 on 2026-04-15" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;

      // 新しい観察 (supersedes 側)
      const newResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v2-rank-event",
          ts: "2026-04-18T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v2 on 2026-04-18" },
        })
      );
      const newObsId = (newResult.items[0] as { id: string }).id;

      // B supersedes A
      core.createLink({
        from_observation_id: newObsId,
        to_observation_id: oldObsId,
        relation: "supersedes",
      });

      // デフォルト検索: 両方含まれる、B が A より上
      const searchResult = core.search({
        query: "deploy to prod",
        project: "test-project",
        include_superseded: true,
      });
      expect(searchResult.ok).toBe(true);
      const items = searchResult.items as Array<{ id: string; scores: { final: number } }>;
      expect(items.length).toBeGreaterThanOrEqual(2);

      const newItem = items.find((i) => i.id === newObsId);
      const oldItem = items.find((i) => i.id === oldObsId);
      expect(newItem).toBeDefined();
      expect(oldItem).toBeDefined();

      if (newItem && oldItem) {
        // B (新) は A (旧・superseded) より上位（index が小さい）
        const newIndex = items.findIndex((i) => i.id === newObsId);
        const oldIndex = items.findIndex((i) => i.id === oldObsId);
        expect(newIndex).toBeLessThan(oldIndex);
      }
    } finally {
      core.close?.();
    }
  });

  test("正常: include_superseded=false のとき superseded 観察を除外", () => {
    const core = new HarnessMemCore(createConfig("exclude-supersedes"));
    try {
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v1-excl-event",
          ts: "2026-04-15T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v1 on 2026-04-15" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;

      const newResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v2-excl-event",
          ts: "2026-04-18T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v2 on 2026-04-18" },
        })
      );
      const newObsId = (newResult.items[0] as { id: string }).id;

      // B supersedes A
      core.createLink({
        from_observation_id: newObsId,
        to_observation_id: oldObsId,
        relation: "supersedes",
      });

      // include_superseded=false: A (旧) を除外
      const searchResult = core.search({
        query: "deploy to prod",
        project: "test-project",
        include_superseded: false,
      });
      expect(searchResult.ok).toBe(true);
      const items = searchResult.items as Array<{ id: string }>;
      const ids = items.map((i) => i.id);
      expect(ids).not.toContain(oldObsId);
      expect(ids).toContain(newObsId);
    } finally {
      core.close?.();
    }
  });

  test("正常: include_superseded=false は contradiction detector の superseded relation も除外", () => {
    const core = new HarnessMemCore(createConfig("exclude-superseded-detector"));
    try {
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v1-detector-event",
          ts: "2026-04-15T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v1 on 2026-04-15" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;

      const newResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v2-detector-event",
          ts: "2026-04-18T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v2 on 2026-04-18" },
        })
      );
      const newObsId = (newResult.items[0] as { id: string }).id;

      core.createLink({
        from_observation_id: newObsId,
        to_observation_id: oldObsId,
        relation: "superseded",
      });

      const searchResult = core.search({
        query: "deploy to prod",
        project: "test-project",
        include_superseded: false,
      });
      expect(searchResult.ok).toBe(true);
      const ids = (searchResult.items as Array<{ id: string }>).map((i) => i.id);
      expect(ids).not.toContain(oldObsId);
      expect(ids).toContain(newObsId);
    } finally {
      core.close?.();
    }
  });

  test("境界: future valid_from の superseded relation は as_of 到達まで除外しない", () => {
    const core = new HarnessMemCore(createConfig("future-superseded-detector"));
    try {
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v1-future-event",
          ts: "2026-04-15T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v1 on 2026-04-15 legacy-prod-v1-token" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;

      const newResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v2-future-event",
          ts: "2026-04-18T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v2 on 2026-04-18 modern-prod-v2-token" },
        })
      );
      const newObsId = (newResult.items[0] as { id: string }).id;

      core.getRawDb()
        .query(`
          INSERT INTO mem_links(
            from_observation_id, to_observation_id, relation, weight,
            event_time, observed_at, valid_from, supersedes, created_at
          )
          VALUES (?, ?, 'superseded', 1.0, ?, ?, ?, ?, ?)
        `)
        .run(
          newObsId,
          oldObsId,
          "2999-01-01T00:00:00Z",
          "2026-04-18T10:00:00.000Z",
          "2999-01-01T00:00:00Z",
          oldObsId,
          "2026-04-18T10:00:00.000Z",
        );
      const deferredLink = core.getRawDb()
        .query(`SELECT valid_from FROM mem_links WHERE relation = 'superseded' AND to_observation_id = ?`)
        .get(oldObsId) as { valid_from: string | null };
      expect(deferredLink.valid_from).toBe("2999-01-01T00:00:00Z");

      const beforeCutover = core.search({
        query: "deploy to prod",
        project: "test-project",
        include_superseded: false,
        as_of: "2026-04-20T00:00:00Z",
      });
      expect(beforeCutover.ok).toBe(true);
      expect((beforeCutover.items as Array<{ id: string }>).map((i) => i.id)).toContain(oldObsId);

      const afterCutover = core.search({
        query: "deploy to prod",
        project: "test-project",
        include_superseded: false,
        as_of: "2999-01-02T00:00:00Z",
      });
      expect(afterCutover.ok).toBe(true);
      expect((afterCutover.items as Array<{ id: string }>).map((i) => i.id)).not.toContain(oldObsId);

      const beforeCutoverUpdatedRows = core.getRawDb()
        .query(`
          SELECT to_observation_id FROM mem_links
          WHERE relation = 'superseded'
            AND to_observation_id = ?
            AND (valid_from IS NULL OR julianday(valid_from) <= julianday(?))
        `)
        .all(oldObsId, "2026-04-20T00:00:00Z") as Array<{ to_observation_id: string }>;
      expect(beforeCutoverUpdatedRows).toHaveLength(0);

      const afterCutoverUpdatedRows = core.getRawDb()
        .query(`
          SELECT to_observation_id FROM mem_links
          WHERE relation = 'superseded'
            AND to_observation_id = ?
            AND (valid_from IS NULL OR julianday(valid_from) <= julianday(?))
        `)
        .all(oldObsId, "2999-01-02T00:00:00Z") as Array<{ to_observation_id: string }>;
      expect(afterCutoverUpdatedRows.map((row) => row.to_observation_id)).toContain(oldObsId);
    } finally {
      core.close?.();
    }
  });

  test("境界: valid_to を過ぎた superseded relation は include_superseded=false でも除外しない", () => {
    const core = new HarnessMemCore(createConfig("expired-superseded-detector"));
    try {
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v1-expiring-link-event",
          ts: "2026-04-15T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v1 on 2026-04-15 legacy-prod-v1-token" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;

      const newResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v2-expiring-link-event",
          ts: "2026-04-18T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v2 on 2026-04-18 modern-prod-v2-token" },
        })
      );
      const newObsId = (newResult.items[0] as { id: string }).id;

      core.getRawDb()
        .query(`
          INSERT INTO mem_links(
            from_observation_id, to_observation_id, relation, weight,
            event_time, observed_at, valid_from, valid_to, supersedes, created_at
          )
          VALUES (?, ?, 'superseded', 1.0, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          newObsId,
          oldObsId,
          "2026-04-18T10:00:00.000Z",
          "2026-04-18T10:00:00.000Z",
          "2026-04-18T00:00:00.000Z",
          "2026-04-19T00:00:00.000Z",
          oldObsId,
          "2026-04-18T10:00:00.000Z",
        );

      const duringLink = core.search({
        query: "deploy to prod legacy-prod-v1-token",
        project: "test-project",
        include_superseded: false,
        as_of: "2026-04-18T12:00:00.000Z",
      });
      expect(duringLink.ok).toBe(true);
      expect((duringLink.items as Array<{ id: string }>).map((item) => item.id)).not.toContain(oldObsId);

      const afterLinkExpiry = core.search({
        query: "deploy to prod legacy-prod-v1-token",
        project: "test-project",
        include_superseded: false,
        as_of: "2026-04-20T00:00:00.000Z",
      });
      expect(afterLinkExpiry.ok).toBe(true);
      expect((afterLinkExpiry.items as Array<{ id: string }>).map((item) => item.id)).toContain(oldObsId);

      const activeAfterExpiryRows = core.getRawDb()
        .query(`
          SELECT to_observation_id FROM mem_links
          WHERE relation = 'superseded'
            AND to_observation_id = ?
            AND (valid_from IS NULL OR julianday(valid_from) <= julianday(?))
            AND (valid_to IS NULL OR julianday(valid_to) > julianday(?))
        `)
        .all(oldObsId, "2026-04-20T00:00:00.000Z", "2026-04-20T00:00:00.000Z") as Array<{ to_observation_id: string }>;
      expect(activeAfterExpiryRows).toHaveLength(0);
    } finally {
      core.close?.();
    }
  });

  test("境界: as_of が invalidated_at より前なら temporal_state は superseded にしない", () => {
    const core = new HarnessMemCore(createConfig("asof-before-invalidated"));
    try {
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v1-invalidated-event",
          ts: "2026-04-15T10:00:00.000Z",
          payload: { prompt: "Current deploy target is prod-v1 on 2026-04-15" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;
      core.getRawDb()
        .query(`UPDATE mem_observations SET valid_to = ?, invalidated_at = ? WHERE id = ?`)
        .run("2026-04-18T00:00:00Z", "2026-04-20T00:00:00Z", oldObsId);

      const beforeInvalidation = core.search({
        query: "deploy target prod-v1",
        project: "test-project",
        as_of: "2026-04-16T00:00:00Z",
      });
      expect(beforeInvalidation.ok).toBe(true);
      const oldItem = (beforeInvalidation.items as Array<{ id: string; temporal_state?: string }>)
        .find((item) => item.id === oldObsId);
      expect(oldItem).toBeDefined();
      expect(oldItem?.temporal_state).not.toBe("superseded");
    } finally {
      core.close?.();
    }
  });

  test("境界: include_superseded デフォルト(true) — 両方含む", () => {
    const core = new HarnessMemCore(createConfig("default-supersedes"));
    try {
      const oldResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v1-def-event",
          ts: "2026-04-15T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v1 on 2026-04-15" },
        })
      );
      const oldObsId = (oldResult.items[0] as { id: string }).id;

      const newResult = core.recordEvent(
        baseEvent({
          event_id: "deploy-v2-def-event",
          ts: "2026-04-18T10:00:00.000Z",
          payload: { prompt: "Deploy to prod-v2 on 2026-04-18" },
        })
      );
      const newObsId = (newResult.items[0] as { id: string }).id;

      core.createLink({
        from_observation_id: newObsId,
        to_observation_id: oldObsId,
        relation: "supersedes",
      });

      // include_superseded 未指定 = デフォルト true: 両方返る
      const searchResult = core.search({
        query: "deploy to prod",
        project: "test-project",
      });
      expect(searchResult.ok).toBe(true);
      const items = searchResult.items as Array<{ id: string }>;
      const ids = items.map((i) => i.id);
      expect(ids).toContain(newObsId);
      expect(ids).toContain(oldObsId);
    } finally {
      core.close?.();
    }
  });
});
